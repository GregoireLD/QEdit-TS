/**
 * PSO .qst container parser / serialiser.
 *
 * A .qst file is a sequence of packets that embed one or more compressed
 * (and optionally encrypted) files (.bin, .dat, etc.).
 *
 * Four outer formats exist, detected from the first two bytes:
 *
 *   0x58 … → BB (Blue Burst) — size at bytes [0-1], cmd at byte [2]
 *                               8-byte header (4 base + 4 extra)
 *   0x3C 0x00 → PC           — size at bytes [0-1], cmd at byte [2]
 *                               4-byte header (same payload layout as GC)
 *   0x44 … → GC/DC server    — cmd at byte [0], size at bytes [2-3]
 *                               4-byte header
 *   0xA6 … → GC/DC download  — cmd at byte [0], size at bytes [2-3]
 *                               4-byte header + encryption wrapper on payload
 *
 * Xbox download quests use GC-style packets but with an 84-byte create header
 * that embeds additional Xbox folder metadata (detected on write by platform).
 *
 * Packet types:
 *   cmd 0x44 / 0xA6  → "file create"   — announces a new embedded file
 *   cmd 0x13 / 0xA7  → "file data"     — 1024-byte chunk of compressed data
 *
 * After all packets are read the embedded buffers are:
 *   1. optionally decrypted (download format only)
 *   2. PRS-decompressed
 */

import { QstFormat, BinVersion } from '../model/types';
import type { Quest, EmbeddedFile, SaveFormat, TargetPlatform } from '../model/types';
import { prsDecompress, prsCompress } from './prs';
import { parseEncryptedWrapper, buildEncryptedWrapper } from './encryption';
import { parseBin, serialiseBin } from './bin';
import { parseDat, serialiseDat } from './dat';
import { buildZip, readZip } from './zip';

// ─── QEdit ZIP metadata ────────────────────────────────────────────────────

const META_FILE = '_qedit.json';

interface ZipMeta {
  packaging:    string;
  platform:     string;
  isBBContainer: boolean;
  version:      number;
}

function encodeZipMeta(format: SaveFormat, quest: Quest): Uint8Array {
  const meta: ZipMeta = {
    packaging:    format.packaging,
    platform:     format.platform,
    isBBContainer: quest.bin.bbContainer,
    version:      1,
  };
  return new TextEncoder().encode(JSON.stringify(meta));
}

function readZipMeta(entries: Map<string, Uint8Array>): ZipMeta | null {
  const raw = entries.get(META_FILE);
  if (!raw) return null;
  try {
    return JSON.parse(new TextDecoder().decode(raw)) as ZipMeta;
  } catch {
    return null;
  }
}

// ─── Internal packet reading ───────────────────────────────────────────────

interface RawFile {
  name: string;
  expectedSize: number;
  data: Uint8Array;
  written: number;
}

function readCString(buf: Uint8Array, offset: number, maxLen: number): string {
  let end = offset;
  while (end < offset + maxLen && buf[end] !== 0) end++;
  return new TextDecoder('ascii').decode(buf.slice(offset, end));
}

/** Parse the raw packet stream, returning a map name→RawFile. */
function readPackets(buf: Uint8Array): { format: QstFormat; files: Map<string, RawFile> } {
  const files = new Map<string, RawFile>();
  let pos = 0;
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

  // Detect format from first two bytes
  const first = buf[0];
  let format: QstFormat;
  let isBB = false;
  let isGC = false; // true only for GC/DC cmd-first packets (NOT PC)

  if (first === 0x58) {
    format = QstFormat.BB;
    isBB = true;
  } else if (first === 0x3C && buf.length >= 3 && (buf[2] === 0x44 || buf[2] === 0xA6)) {
    // PC: size-first header [size_lo=0x3C, size_hi=0x00, cmd, ...]
    // Falls into the non-GC, non-BB path below: reads size from [0-1], cmd from [2], extraHeader=0.
    format = buf[2] === 0xA6 ? QstFormat.Download : QstFormat.GC;
  } else if (first === 0xA6 || buf[2] === 0xA6) {
    // GC/DC download: cmd-first [0xA6, ?, size_lo, size_hi]
    format = QstFormat.Download;
    isGC = true;
  } else {
    // GC/DC server: cmd-first [cmd, ?, size_lo, size_hi]
    format = QstFormat.GC;
    isGC = true;
  }

  while (pos + 4 <= buf.length) {
    let pktSize: number;
    let cmd: number;

    if (isGC) {
      // GC/DC: [cmd, ?, size_lo, size_hi]
      cmd     = buf[pos];
      pktSize = buf[pos + 2] | (buf[pos + 3] << 8);
    } else {
      // BB and PC: [size_lo, size_hi, cmd, ?]
      pktSize = buf[pos] | (buf[pos + 1] << 8);
      cmd     = buf[pos + 2];
    }

    if (pktSize < 4) break;

    // BB has 4 extra header bytes before the payload; PC and GC do not
    const extraHeader = isBB ? 4 : 0;
    const payloadOffset = pos + 4 + extraHeader;
    const payloadSize   = pktSize - 4 - extraHeader;

    if (payloadOffset + payloadSize > buf.length) break;

    const payload = buf.slice(payloadOffset, payloadOffset + payloadSize);

    if (cmd === 0x44 || cmd === 0xA6) {
      // File-create packet
      let nameOff: number;

      if (isGC) {
        // DC name is at payload[0x23]; GC/Xbox at payload[0x24].
        // Heuristic: if payload[0x23] looks like a filename char (≥ 3) it is DC.
        nameOff = payload[0x23] >= 3 ? 0x23 : 0x24;
      } else {
        // BB and PC: name always at payload[0x24]
        nameOff = 0x24;
      }

      const name = readCString(payload, nameOff, 16);
      const expectedSize = view.getUint32(payloadOffset + 0x34, true);

      if (name) {
        files.set(name, {
          name,
          expectedSize,
          data: new Uint8Array(expectedSize),
          written: 0,
        });
      }
    } else if (cmd === 0x13 || cmd === 0xA7) {
      // File-data packet
      // payload[0x00..0x0F] = filename (null-terminated)
      // payload[0x10..0x40F] = up to 1024 bytes of chunk data
      // payload[0x410..0x413] = actual chunk byte count (u32 LE)
      const name      = readCString(payload, 0x00, 16);
      const chunkSize = view.getUint32(payloadOffset + 0x410, true);
      const chunkData = payload.slice(0x10, 0x10 + chunkSize);

      const file = files.get(name);
      if (file) {
        file.data.set(chunkData, file.written);
        file.written += chunkSize;
      }
    }

    // Advance past this packet (BB pads to 8-byte boundary)
    let advance = pktSize;
    if (isBB && advance % 8 !== 0) advance += 8 - (advance % 8);
    pos += advance;
  }

  return { format, files };
}

// ─── Public: parse ─────────────────────────────────────────────────────────

export function parseQst(buf: Uint8Array): Quest {
  const { format, files } = readPackets(buf);
  const isDownload = format === QstFormat.Download;
  const isBB       = format === QstFormat.BB;

  const embedded: EmbeddedFile[] = [];
  let binFile: Uint8Array | undefined;
  let datFile: Uint8Array | undefined;

  for (const raw of files.values()) {
    let data = raw.data.slice(0, raw.written);

    // Download quests: decrypt first
    if (isDownload) {
      const { payload } = parseEncryptedWrapper(data);
      data = new Uint8Array(payload);
    }

    // PRS decompress (all formats except raw .bin filter index 1)
    try {
      data = new Uint8Array(prsDecompress(data));
    } catch {
      console.warn(`parseQst: PRS decompression failed for ${raw.name}, using raw`);
    }

    embedded.push({ name: raw.name, data });

    const lower = raw.name.toLowerCase();
    if (lower.endsWith('.bin')) binFile = data;
    if (lower.endsWith('.dat')) datFile = data;
  }

  if (!binFile) throw new Error('parseQst: no .bin file found in quest');
  if (!datFile) throw new Error('parseQst: no .dat file found in quest');

  const bin    = parseBin(binFile, isBB);
  const floors = parseDat(datFile);

  return {
    format,
    bin,
    floors,
    embeddedFiles: embedded,
    // episode and variantByArea are filled in by questStore after bytecode analysis
    episode:       1 as const,
    variantByArea: {},
  };
}

// ─── Public: parse standalone .bin/.dat ───────────────────────────────────

/** Try PRS decompression; if the raw bytes already look like a .bin header, return them as-is. */
function decompressOrRaw(data: Uint8Array): Uint8Array {
  if (data.length >= 4) {
    const seg0 = new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(0, true);
    if (seg0 === 0x1D4 || seg0 === 0x394 || seg0 === 4652) return data; // already raw
  }
  try {
    return new Uint8Array(prsDecompress(data));
  } catch {
    return data;
  }
}

/**
 * Parse a standalone .bin (+ optional .dat) as found in Compressed / Uncompressed saves.
 * Both files may be PRS-compressed or raw — auto-detected.
 * Returns the parsed Quest and the detected SaveFormat (packaging + platform).
 */
export function parseStandaloneBin(
  binData: Uint8Array,
  datData: Uint8Array | null,
): { quest: Quest; savedFormat: SaveFormat } {
  const rawBin = decompressOrRaw(binData);
  const rawDat = datData ? decompressOrRaw(datData) : null;

  // If decompressOrRaw returned a different reference, decompression happened.
  const isCompressed = rawBin !== binData;

  // BB format has seg0 = 4652 = 0x132C; use isBBContainer accordingly.
  const isBBContainer = rawBin.length >= 4 &&
    new DataView(rawBin.buffer, rawBin.byteOffset, rawBin.byteLength).getUint32(0, true) === 4652;

  const bin    = parseBin(rawBin, isBBContainer);
  const floors = rawDat ? parseDat(rawDat) : [];

  const platform: TargetPlatform =
    bin.version === BinVersion.BB ? 'BB' :
    bin.version === BinVersion.DC ? 'DC' : 'PC';

  return {
    quest: {
      format:        isBBContainer ? QstFormat.BB : QstFormat.GC,
      bin,
      floors,
      embeddedFiles: [
        { name: 'quest.bin', data: rawBin },
        ...(rawDat ? [{ name: 'quest.dat', data: rawDat }] : []),
      ],
      episode:       1 as const,
      variantByArea: {},
    },
    savedFormat: {
      packaging: isCompressed ? 'compressed' : 'uncompressed',
      platform,
    },
  };
}

// ─── Public: parse ZIP ─────────────────────────────────────────────────────

export function parseZipQuest(buf: Uint8Array): { quest: Quest; savedFormat: SaveFormat } {
  const entries = readZip(buf);
  const meta    = readZipMeta(entries);

  const packaging    = (meta?.packaging ?? 'project') as SaveFormat['packaging'];
  const platform     = (meta?.platform  ?? 'PC')      as SaveFormat['platform'];
  const isBBContainer = meta?.isBBContainer ?? false;

  const embedded: EmbeddedFile[] = [];
  let binFile: Uint8Array | undefined;
  let datFile: Uint8Array | undefined;

  for (const [name, rawData] of entries) {
    if (name === META_FILE) continue;

    let data = rawData;

    if (packaging === 'compressed') {
      try {
        data = new Uint8Array(prsDecompress(rawData));
      } catch {
        console.warn(`parseZipQuest: PRS decompression failed for "${name}", using raw bytes`);
      }
    }

    embedded.push({ name, data });
    const lower = name.toLowerCase();
    if (lower.endsWith('.bin')) binFile = data;
    if (lower.endsWith('.dat')) datFile = data;
  }

  if (!binFile) throw new Error('parseZipQuest: no .bin file found in ZIP');
  if (!datFile) throw new Error('parseZipQuest: no .dat file found in ZIP');

  const bin    = parseBin(binFile, isBBContainer);
  const floors = parseDat(datFile);

  const quest: Quest = {
    format:        isBBContainer ? QstFormat.BB : QstFormat.GC,
    bin,
    floors,
    embeddedFiles: embedded,
    episode:       1 as const,
    variantByArea: {},
  };

  return { quest, savedFormat: { packaging, platform } };
}

// ─── Public: serialise ─────────────────────────────────────────────────────

/** Re-serialise a quest back to a .qst byte stream in its original format. */
export function serialiseQst(quest: Quest): Uint8Array {
  const isBB = quest.format === QstFormat.BB;

  const binEntry = quest.embeddedFiles.find(f => f.name.toLowerCase().endsWith('.bin'));
  const datEntry = quest.embeddedFiles.find(f => f.name.toLowerCase().endsWith('.dat'));
  const binName  = binEntry?.name ?? 'quest.bin';
  const datName  = datEntry?.name ?? 'quest.dat';

  const files = [
    { name: datName, payload: prsCompress(serialiseDat(quest.floors)) },
    { name: binName, payload: prsCompress(serialiseBin(quest.bin))    },
  ];

  const questInfo: QuestInfo = {
    questNumber: quest.bin.questNumber,
    title:       quest.bin.title,
    language:    quest.bin.language,
  };
  return buildQstPackets(files, isBB ? 'BB' : 'GC', false, questInfo);
}

// ─── Packet builders ───────────────────────────────────────────────────────

function writeCString(buf: Uint8Array, offset: number, s: string, maxLen: number): void {
  const len = Math.min(s.length, maxLen - 1);
  for (let i = 0; i < len; i++) buf[offset + i] = s.charCodeAt(i) & 0x7f;
}

// Encode a title string to a fixed-length single-byte buffer (Delphi unitochar equivalent).
// Takes the low byte of each Unicode code point — correct for Latin and accurate for
// Shift-JIS code points that PSO DC/GC use (which all fit in one byte).
function encodeTitle(title: string, maxBytes: number, buf: Uint8Array, offset: number): void {
  for (let i = 0; i < maxBytes && i < title.length; i++) {
    buf[offset + i] = title.charCodeAt(i) & 0xFF;
  }
}

function buildCreatePacket(
  name: string,
  payloadSize: number,
  platform: TargetPlatform,
  isDownload: boolean,
  fileCount: number,
  questInfo: QuestInfo,
): Uint8Array {
  const isBB = platform === 'BB';
  const isPC = platform === 'PC';
  const isDC = platform === 'DC';
  const pktSize = isBB ? 0x58 : 0x3C;
  const buf     = new Uint8Array(pktSize);
  const view    = new DataView(buf.buffer);
  const extraFiles = fileCount > 2 ? fileCount - 2 : 0;

  if (isBB) {
    // [size_lo, size_hi, cmd, 0,  qnum_lo, qnum_hi, 0, 0,  payload…]
    // payload starts at [8]; name at payload[0x24]=[44]; payloadSize at payload[0x34]=[60]
    // filecount-2 at payload[0x22]=[42]; secondary "_j" name at payload[0x38]=[64]
    view.setUint16(0, pktSize, true);
    buf[2] = 0x44; // BB server only; no BB download format exists
    view.setUint16(4, questInfo.questNumber, true);
    if (extraFiles > 0) buf[42] = extraFiles;
    writeCString(buf, 44, name, 16);
    view.setUint32(60, payloadSize, true);
    const secondary = name.replace(/(\.[^.]+)$/, '_j$1');
    writeCString(buf, 64, secondary, 16);
  } else if (isPC) {
    // [size_lo, size_hi, cmd, qnum,  payload…]  — no title field
    // payload starts at [4]; name at payload[0x24]=[40]; payloadSize at payload[0x34]=[56]
    // filecount-2 at [38]
    view.setUint16(0, pktSize, true);
    buf[2] = isDownload ? 0xA6 : 0x44;
    buf[3] = questInfo.questNumber & 0xFF;
    if (extraFiles > 0) buf[38] = extraFiles;
    writeCString(buf, 40, name, 16);
    view.setUint32(56, payloadSize, true);
  } else {
    // GC/DC: [cmd, qnum, size_lo, size_hi,  title×32,  filecount?,  name,  payloadSize]
    // title "PSO/<title>" at [4..35]; filecount-2 at [38]
    // GC name at [40]=payload[0x24]; DC name at [39]=payload[0x23]
    buf[0] = isDownload ? 0xA6 : 0x44;
    buf[1] = questInfo.questNumber & 0xFF;
    view.setUint16(2, pktSize, true);
    encodeTitle('PSO/' + questInfo.title, 32, buf, 4);
    if (extraFiles > 0) buf[38] = extraFiles;
    writeCString(buf, isDC ? 39 : 40, name, 16);
    view.setUint32(56, payloadSize, true);
  }
  return buf;
}

function buildDataPacket(
  name: string,
  chunk: Uint8Array,
  platform: TargetPlatform,
  isDownload: boolean,
  chunkIndex: number,
): Uint8Array {
  const isBB = platform === 'BB';
  const isPC = platform === 'PC';
  const payloadBytes = 0x10 + 0x400 + 4; // 1044
  const headerBytes  = isBB ? 8 : 4;
  let pktSize        = headerBytes + payloadBytes;
  if (isBB && pktSize % 8 !== 0) pktSize += 8 - (pktSize % 8);

  const buf  = new Uint8Array(pktSize);
  const view = new DataView(buf.buffer);

  if (isBB) {
    // [size_lo, size_hi, cmd, 0,  chunkIdx, 0, 0, 0,  name×16, data×1024, chunkSize×4]
    view.setUint16(0, pktSize, true);
    buf[2] = isDownload ? 0xA7 : 0x13;
    buf[4] = chunkIndex & 0xFF;
    writeCString(buf, 8, name, 16);
    buf.set(chunk, 24);
    view.setUint32(1048, chunk.length, true);
  } else if (isPC) {
    // [size_lo, size_hi, cmd, chunkIdx,  name×16, data×1024, chunkSize×4]
    view.setUint16(0, pktSize, true);
    buf[2] = isDownload ? 0xA7 : 0x13;
    buf[3] = chunkIndex & 0xFF;
    writeCString(buf, 4, name, 16);
    buf.set(chunk, 20);
    view.setUint32(1044, chunk.length, true);
  } else {
    // GC/DC: [cmd, chunkIdx, size_lo, size_hi,  name×16, data×1024, chunkSize×4]
    buf[0] = isDownload ? 0xA7 : 0x13;
    buf[1] = chunkIndex & 0xFF;
    view.setUint16(2, pktSize, true);
    writeCString(buf, 4, name, 16);
    buf.set(chunk, 20);
    view.setUint32(1044, chunk.length, true);
  }
  return buf;
}

// Xbox download: 84-byte GC-style create packet with extra Xbox folder metadata.
// Layout confirmed against Delphi QEdit source (SaveDialog1 filter index 9).
const XBOX_LANG_SUFFIX = ['_j', '_e', '_g', '_f', '_s'];

function buildXboxCreatePacket(
  name: string,
  payloadSize: number,
  questNumber: number,
  title: string,
  language: number,
): Uint8Array {
  const pktSize = 0x54; // 84 bytes
  const buf     = new Uint8Array(pktSize);
  const view    = new DataView(buf.buffer);

  // GC-style header: [cmd=0xA6, 0, size_lo=0x54, size_hi=0x00]
  buf[0] = 0xA6;
  view.setUint16(2, pktSize, true);

  // Title "PSO/<title>" at bytes [4..35] (32 bytes, ASCII)
  const titleStr = 'PSO/' + title;
  for (let i = 0; i < 32 && i < titleStr.length; i++) {
    buf[4 + i] = titleStr.charCodeAt(i) & 0x7F;
  }

  // Quest number at bytes [36..37]
  view.setUint16(36, questNumber, true);

  // File name at bytes [40..55]
  writeCString(buf, 40, name, 16);

  // Payload size at bytes [56..59]
  view.setUint32(56, payloadSize, true);

  // Xbox folder filename at bytes [60..75]: name with language-specific .dat extension
  const suffix     = XBOX_LANG_SUFFIX[language] ?? '_e';
  const folderName = name.replace(/\.(bin|dat)$/i, suffix + '.dat');
  writeCString(buf, 60, folderName, 16);

  // Quest number again at [76..77], language byte at [79]
  view.setUint16(76, questNumber, true);
  buf[79] = ((language + 1) * 0x10) & 0xFF;

  return buf;
}

// ─── Format helpers ────────────────────────────────────────────────────────

/** Resolve the target BinVersion and bbContainer flag from a TargetPlatform. */
function resolveBinFormat(
  platform: TargetPlatform,
  currentVersion: BinVersion,
): { binVersion: BinVersion; bbContainer: boolean } {
  if (platform === 'BB') return { binVersion: BinVersion.BB, bbContainer: true };
  if (platform === 'DC') return { binVersion: BinVersion.DC, bbContainer: false };
  // PC / GC / Xbox: preserve current version unless it was BB (strip → PC)
  const binVersion = currentVersion === BinVersion.BB ? BinVersion.PC : currentVersion;
  return { binVersion, bbContainer: false };
}

interface QuestInfo {
  questNumber: number;
  title: string;
  language: number;
}

/** Build the packet stream (server or download .qst). */
function buildQstPackets(
  files: Array<{ name: string; payload: Uint8Array }>,
  platform: TargetPlatform,
  isDownload: boolean,
  questInfo?: QuestInfo,
): Uint8Array {
  const CHUNK  = 1024;
  const isXbox = platform === 'Xbox';
  const packets: Uint8Array[] = [];
  // Xbox data packets use GC-download layout (cmd-first, 0xA7)
  const dataPlatform: TargetPlatform = isXbox ? 'GC' : platform;

  for (const file of files) {
    if (isXbox && questInfo) {
      packets.push(buildXboxCreatePacket(
        file.name, file.payload.length,
        questInfo.questNumber, questInfo.title, questInfo.language,
      ));
    } else {
      const info = questInfo ?? { questNumber: 0, title: '', language: 0 };
      packets.push(buildCreatePacket(
        file.name, file.payload.length, platform, isDownload, files.length, info,
      ));
    }
    let off = 0;
    let chunkIndex = 0;
    while (off < file.payload.length) {
      const chunk = file.payload.slice(off, off + CHUNK);
      packets.push(buildDataPacket(
        file.name, chunk, dataPlatform, isDownload || isXbox, chunkIndex,
      ));
      off += CHUNK;
      chunkIndex++;
    }
  }

  const total = packets.reduce((s, p) => s + p.length, 0);
  const out   = new Uint8Array(total);
  let pos = 0;
  for (const p of packets) { out.set(p, pos); pos += p.length; }
  return out;
}

// ─── Public: serialise with explicit format ────────────────────────────────

export interface SaveResult {
  data: Uint8Array;
  ext: 'qst' | 'bin' | 'zip' | 'qpv3';
  /** Additional files to write alongside the primary file, keyed by extension. */
  extraFiles?: { ext: string; data: Uint8Array }[];
}

/**
 * Serialise a quest to the chosen packaging format and platform.
 * Returns the raw bytes and the appropriate file extension.
 *
 * 'server'       → .qst  (PSO server packets, PRS-compressed)
 * 'download'     → .qst  (PSO download packets, PRS-compressed + encrypted)
 * 'compressed'   → .bin + .dat  (PRS-compressed individual files, no packet wrapper)
 * 'uncompressed' → .bin + .dat  (raw individual files, no packet wrapper)
 * 'project'      → .zip  (all embedded files as-is; no platform re-encoding)
 * 'rawbin'       → .bin  (bare .bin file only)
 */
export function serialiseForSave(
  quest: Quest,
  format: SaveFormat,
): SaveResult {
  const { packaging, platform } = format;

  const binEntry  = quest.embeddedFiles.find(f => f.name.toLowerCase().endsWith('.bin'));
  const datEntry  = quest.embeddedFiles.find(f => f.name.toLowerCase().endsWith('.dat'));
  const otherFiles = quest.embeddedFiles.filter(
    f => !f.name.toLowerCase().endsWith('.bin') && !f.name.toLowerCase().endsWith('.dat'),
  );
  const binName = binEntry?.name ?? 'quest.bin';
  const datName = datEntry?.name ?? 'quest.dat';

  // 'project': no re-encoding — zip original embedded files as-is
  if (packaging === 'project') {
    const zipMap = new Map<string, Uint8Array>();
    zipMap.set(META_FILE, encodeZipMeta(format, quest));
    for (const ef of quest.embeddedFiles) zipMap.set(ef.name, ef.data);
    return { data: buildZip(zipMap), ext: 'zip' };
  }

  // For all other formats: re-encode .bin and .dat for the target platform
  const { binVersion, bbContainer } = resolveBinFormat(platform, quest.bin.version);
  const rawBin = serialiseBin(quest.bin, { targetVersion: binVersion, targetBbContainer: bbContainer });
  const rawDat = serialiseDat(quest.floors);

  if (packaging === 'rawbin') {
    return { data: rawBin, ext: 'bin' };
  }

  if (packaging === 'compressed' || packaging === 'uncompressed') {
    const compress = packaging === 'compressed';
    // PVR textures are already compressed — don't double-compress them.
    const shouldCompress = (name: string) => compress && !name.toLowerCase().endsWith('.pvr');
    return {
      data: compress ? prsCompress(rawBin) : rawBin,
      ext:  'bin',
      extraFiles: [
        { ext: 'dat', data: compress ? prsCompress(rawDat) : rawDat },
        ...otherFiles.map(ef => ({
          ext:  ef.name.split('.').pop() ?? ef.name,
          data: shouldCompress(ef.name) ? prsCompress(ef.data) : ef.data,
        })),
      ],
    };
  }

  // 'server' or 'download'
  const isDownload = packaging === 'download';

  const files: Array<{ name: string; payload: Uint8Array }> = [];

  // .dat first, .bin second (matches original serialiseQst order)
  for (const [name, raw] of [[datName, rawDat], [binName, rawBin]] as const) {
    const compressed = prsCompress(raw);
    const payload    = isDownload
      ? buildEncryptedWrapper(compressed, raw.length)
      : compressed;
    files.push({ name, payload });
  }

  // Pass through other embedded files
  for (const ef of otherFiles) {
    const compressed = prsCompress(ef.data);
    const payload    = isDownload
      ? buildEncryptedWrapper(compressed, ef.data.length)
      : compressed;
    files.push({ name: ef.name, payload });
  }

  const questInfo: QuestInfo = {
    questNumber: quest.bin.questNumber,
    title:       quest.bin.title,
    language:    quest.bin.language,
  };
  return { data: buildQstPackets(files, platform, isDownload, questInfo), ext: 'qst' };
}
