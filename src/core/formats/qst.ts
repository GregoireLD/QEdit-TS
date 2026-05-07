/**
 * PSO .qst container parser / serialiser.
 *
 * A .qst file is a sequence of packets that embed one or more compressed
 * (and optionally encrypted) files (.bin, .dat, etc.).
 *
 * Three outer formats exist, detected from the first byte:
 *
 *   0x58 → BB (Blue Burst)  — packet size at bytes [0-1], cmd at byte [2]
 *                              each packet has an 8-byte header (4 + 4 extra)
 *   0x44 → GC/DC server     — cmd at byte [0], size at bytes [2-3]
 *                              each packet has a 4-byte header
 *   0xA6 → DC download      — same layout as GC/DC + encryption wrapper
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

  // Detect format from first byte
  const first = buf[0];
  let format: QstFormat;
  let isBB = false;
  let isGC = false;

  if (first === 0x58) {
    format = QstFormat.BB;
    isBB = true;
  } else if (first === 0xA6 || (buf[2] === 0xA6)) {
    format = QstFormat.Download;
    isGC = true;
  } else {
    format = QstFormat.GC;
    isGC = true;
  }

  while (pos + 4 <= buf.length) {
    // Read the first 4 bytes of the packet
    let pktSize: number;
    let cmd: number;

    if (isGC) {
      // GC/DC/Download: [cmd, ?, size_lo, size_hi]
      cmd     = buf[pos];
      pktSize = buf[pos + 2] | (buf[pos + 3] << 8);
    } else {
      // BB: [size_lo, size_hi, cmd, ?]
      pktSize = buf[pos] | (buf[pos + 1] << 8);
      cmd     = buf[pos + 2];
    }

    if (pktSize < 4) break;

    // For BB, there are 4 extra header bytes before the payload
    const extraHeader = isBB ? 4 : 0;
    const payloadOffset = pos + 4 + extraHeader;
    const payloadSize   = pktSize - 4 - extraHeader;

    if (payloadOffset + payloadSize > buf.length) break;

    const payload = buf.slice(payloadOffset, payloadOffset + payloadSize);

    if (cmd === 0x44 || cmd === 0xA6) {
      // File-create packet
      let nameOff: number;

      if (isGC) {
        // For GC format:  byte at payload[0x23] indicates variant
        // If payload[0x23] >= 3: name starts at payload[0x23]
        // Else:                  name starts at payload[0x24]
        nameOff = payload[0x23] >= 3 ? 0x23 : 0x24;
      } else {
        // BB: name at payload[0x24]
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

  return buildQstPackets(files, isBB, false);
}

// ─── Packet builders ───────────────────────────────────────────────────────

function writeCString(buf: Uint8Array, offset: number, s: string, maxLen: number): void {
  const len = Math.min(s.length, maxLen - 1);
  for (let i = 0; i < len; i++) buf[offset + i] = s.charCodeAt(i) & 0x7f;
}

function buildCreatePacket(name: string, payloadSize: number, isBB: boolean, isDownload = false): Uint8Array {
  // BB packet size: 0x58 (88), GC: 0x3C (60)
  const pktSize = isBB ? 0x58 : 0x3C;
  const buf     = new Uint8Array(pktSize);
  const view    = new DataView(buf.buffer);

  // payloadSize = the total byte count the receiver will accumulate from file-data
  // packets.  For download format this equals encrypted-wrapper length (compressed+8);
  // for server format it equals the compressed length.

  if (isBB) {
    view.setUint16(0, pktSize, true);
    buf[2] = isDownload ? 0xA6 : 0x44; // cmd
    writeCString(buf, 8 + 0x24, name, 16);
    view.setUint32(8 + 0x34, payloadSize, true);
  } else {
    buf[0] = isDownload ? 0xA6 : 0x44; // cmd
    view.setUint16(2, pktSize, true);
    writeCString(buf, 4 + 0x24, name, 16);
    view.setUint32(4 + 0x34, payloadSize, true);
  }
  return buf;
}

function buildDataPacket(name: string, chunk: Uint8Array, isBB: boolean, isDownload = false): Uint8Array {
  // BB: 8-byte header + 0x10 name area + 0x400 data + 4 size = 0x41C padded to 8
  // GC: 4-byte header + same payload
  const payloadBytes = 0x10 + 0x400 + 4; // 1044
  const headerBytes  = isBB ? 8 : 4;
  let pktSize        = headerBytes + payloadBytes;
  if (isBB && pktSize % 8 !== 0) pktSize += 8 - (pktSize % 8);

  const buf  = new Uint8Array(pktSize);
  const view = new DataView(buf.buffer);

  if (isBB) {
    view.setUint16(0, pktSize, true);
    buf[2] = isDownload ? 0xA7 : 0x13; // cmd
    writeCString(buf, 8,        name,  16);
    buf.set(chunk, 8 + 0x10);
    view.setUint32(8 + 0x410, chunk.length, true);
  } else {
    buf[0] = isDownload ? 0xA7 : 0x13; // cmd
    view.setUint16(2, pktSize, true);
    writeCString(buf, 4,        name,  16);
    buf.set(chunk, 4 + 0x10);
    view.setUint32(4 + 0x410, chunk.length, true);
  }
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

/** Build the packet stream (server or download .qst). */
function buildQstPackets(
  files: Array<{ name: string; payload: Uint8Array }>,
  isBB: boolean,
  isDownload: boolean,
): Uint8Array {
  const CHUNK = 1024;
  const packets: Uint8Array[] = [];

  for (const file of files) {
    packets.push(buildCreatePacket(file.name, file.payload.length, isBB, isDownload));
    let off = 0;
    while (off < file.payload.length) {
      const chunk = file.payload.slice(off, off + CHUNK);
      packets.push(buildDataPacket(file.name, chunk, isBB, isDownload));
      off += CHUNK;
    }
  }

  const total = packets.reduce((s, p) => s + p.length, 0);
  const out   = new Uint8Array(total);
  let pos = 0;
  for (const p of packets) { out.set(p, pos); pos += p.length; }
  return out;
}

// ─── Public: serialise with explicit format ────────────────────────────────

/**
 * Serialise a quest to the chosen packaging format and platform.
 * Returns the raw bytes and the appropriate file extension.
 *
 * 'server'       → .qst  (PSO server packets, PRS-compressed)
 * 'download'     → .qst  (PSO download packets, PRS-compressed + encrypted)
 * 'compressed'   → .zip  (PRS-compressed files, no packet wrapper)
 * 'uncompressed' → .zip  (raw files, no packet wrapper)
 * 'project'      → .zip  (all embedded files as-is; no platform re-encoding)
 * 'rawbin'       → .bin  (bare .bin file only)
 */
export function serialiseForSave(
  quest: Quest,
  format: SaveFormat,
): { data: Uint8Array; ext: 'qst' | 'bin' | 'zip' } {
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
    const zipMap   = new Map<string, Uint8Array>();
    zipMap.set(META_FILE, encodeZipMeta(format, quest));
    zipMap.set(binName, compress ? prsCompress(rawBin) : rawBin);
    zipMap.set(datName, compress ? prsCompress(rawDat) : rawDat);
    for (const ef of otherFiles) {
      zipMap.set(ef.name, compress ? prsCompress(ef.data) : ef.data);
    }
    return { data: buildZip(zipMap), ext: 'zip' };
  }

  // 'server' or 'download'
  const isBB       = platform === 'BB';
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

  return { data: buildQstPackets(files, isBB, isDownload), ext: 'qst' };
}
