/**
 * PSO quest .bin file parser / serialiser.
 *
 * A .bin contains quest metadata (title, info, description), bytecode, and
 * function-reference tables.  Three layout variants exist, distinguished by seg[0]:
 *
 *   seg[0] === 0x1D4  (468)   → DC/GC  — ASCII strings, 1 byte/char
 *   seg[0] === 0x394  (916)   → PC     — UTF-16LE strings
 *   seg[0] === 4652 (0x132C)  → BB     — UTF-16LE + extra BBData block
 *
 * File layout (all integers LE):
 *   0x00  u32  seg[0]  bytecode start
 *   0x04  u32  seg[1]  function-refs start
 *   0x08  u32  seg[2]  end of refs / file end marker
 *   0x0C  u32  seg[3]  reserved (0xFFFFFFFF)
 *   0x10  u16  language
 *   0x12  u16  questNumber
 *   0x14  …   metadata (layout depends on version)
 *   seg[0] … bytecode
 *   seg[1] … function refs (array of u32 offsets)
 *   seg[2] … optional DataBlock annotations (5 bytes each: u32 offset + u8 type)
 */

import { BinVersion, Language } from '../model/types';
import type { QuestBin, DataBlock } from '../model/types';

// ─── String decoders ───────────────────────────────────────────────────────

const utf16leDecoder = new TextDecoder('utf-16le');
const asciiDecoder   = new TextDecoder('ascii');

function readNullTerminatedUtf16(buf: Uint8Array, byteOffset: number, maxBytes: number): string {
  let end = byteOffset;
  const limit = byteOffset + maxBytes;
  while (end + 1 < limit && (buf[end] !== 0 || buf[end + 1] !== 0)) end += 2;
  return utf16leDecoder.decode(buf.slice(byteOffset, end));
}

function readNullTerminatedAscii(buf: Uint8Array, byteOffset: number, maxBytes: number): string {
  let end = byteOffset;
  const limit = byteOffset + maxBytes;
  while (end < limit && buf[end] !== 0) end++;
  return asciiDecoder.decode(buf.slice(byteOffset, end));
}

/** Replace bare LF with CRLF (matches Delphi's Info/Desc post-processing). */
function normaliseCRLF(s: string): string {
  return s.replace(/(?<!\r)\n/g, '\r\n');
}

// ─── Parse ─────────────────────────────────────────────────────────────────

export function parseBin(buf: Uint8Array, isBBFormat = false): QuestBin {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

  const seg0 = view.getUint32(0x00, true);
  const seg1 = view.getUint32(0x04, true);
  const seg2 = view.getUint32(0x08, true);
  // seg3 at 0x0C is reserved

  // BB .bin layout differs from PC/DC:
  //   0x10 u16  quest number  (Delphi: move(data[16], qnum, 2) for BB)
  //   0x12 u16  padding/unused
  //   0x14 u32  padding/unused
  //   0x18+     metadata (title, info, desc, BBData)
  // PC/DC:
  //   0x10 u16  language
  //   0x12 u16  quest number
  //   0x14+     metadata
  let language: number;
  let questNumber: number;
  if (isBBFormat) {
    questNumber = view.getUint16(0x10, true);
    language = 0; // forced to 0 in Delphi for BB
  } else {
    language = view.getUint16(0x10, true) & 0xff;
    questNumber = view.getUint16(0x12, true);
  }

  // Detect version from seg[0]
  let version: BinVersion;
  let metaStart: number;

  if (seg0 === 0x1D4) {
    version   = BinVersion.DC;
    metaStart = 0x14;
  } else if (seg0 === 4652) {
    version   = BinVersion.BB;
    metaStart = 0x18;
  } else {
    version   = BinVersion.PC;
    // BB outer containers always start metadata at 0x18 (Delphi: y=24),
    // even when the embedded .bin is PC format.
    metaStart = isBBFormat ? 0x18 : 0x14;
  }

  // Compute txt[] = metadata bytes from metaStart to seg[0] (like the Delphi code)
  const txtStart = metaStart;
  const txt = buf.slice(txtStart, seg0);

  let title = '';
  let info  = '';
  let desc  = '';
  let bbData: Uint8Array | undefined;

  if (version === BinVersion.DC) {
    // ASCII, offsets within txt (size = seg0-0x14 = 0x1C0):
    //   0x00..0x1F  title  (32 bytes)
    //   0x20..0x9F  info   (128 bytes)
    //   0xA0..0x1BF desc   (288 bytes = 0x120)
    title = readNullTerminatedAscii(txt, 0x00, 0x20);
    info  = normaliseCRLF(readNullTerminatedAscii(txt, 0x20, 0x80));
    desc  = normaliseCRLF(readNullTerminatedAscii(txt, 0xA0, 0x120));
  } else if (version === BinVersion.BB) {
    // UTF-16LE, offsets from txt (which starts at metaStart=0x18):
    //   0x00..0x3F  title  (64 bytes  = 32 wchars)
    //   0x40..0x13F info   (256 bytes = 128 wchars)
    //   0x140..0x37F desc  (576 bytes = 288 wchars)
    //   0x384..0x1213 BBData (0xE90 bytes)
    title  = readNullTerminatedUtf16(txt, 0x00, 0x40);
    info   = normaliseCRLF(readNullTerminatedUtf16(txt, 0x40, 0x100));
    desc   = normaliseCRLF(readNullTerminatedUtf16(txt, 0x140, 0x240));
    if (txt.length >= 0x384 + 0xE90) {
      bbData = txt.slice(0x384, 0x384 + 0xE90);
    }
  } else {
    // PC: UTF-16LE, offsets from txt (size = seg0-0x14 = 0x380):
    //   0x00..0x3F  title  (64 bytes  = 32 wchars)
    //   0x40..0x13F info   (256 bytes = 128 wchars)
    //   0x140..0x37F desc  (576 bytes = 288 wchars)
    title = readNullTerminatedUtf16(txt, 0x00, 0x40);
    info  = normaliseCRLF(readNullTerminatedUtf16(txt, 0x40, 0x100));
    desc  = normaliseCRLF(readNullTerminatedUtf16(txt, 0x140, 0x240));
  }

  // Bytecode
  const bytecode = buf.slice(seg0, seg1);

  // Function references: array of LE u32 offsets
  const refCount = (seg2 - seg1) / 4;
  const functionRefs: number[] = [];
  for (let i = 0; i < refCount; i++) {
    functionRefs.push(view.getUint32(seg1 + i * 4, true));
  }

  // DataBlock annotations after seg[2] (5 bytes each)
  const dataBlocks: DataBlock[] = [];
  let lblOff = seg2;
  while (lblOff + 4 < buf.length) {
    const offset = view.getUint32(lblOff, true);
    const type   = buf[lblOff + 4];
    dataBlocks.push({ offset, type });
    lblOff += 5;
  }

  return {
    version,
    bbContainer: isBBFormat,
    language: language as Language,
    questNumber,
    title,
    info,
    description: desc,
    bytecode,
    functionRefs,
    dataBlocks,
    bbData,
  };
}

// ─── Serialise ─────────────────────────────────────────────────────────────

function encodeUtf16le(s: string, maxChars: number): Uint8Array {
  // Manual UTF-16LE encoding for BMP characters
  const out = new Uint8Array(maxChars * 2);
  const len = Math.min(s.length, maxChars - 1); // leave room for null terminator
  for (let i = 0; i < len; i++) {
    const cp = s.charCodeAt(i);
    out[i * 2]     = cp & 0xff;
    out[i * 2 + 1] = (cp >> 8) & 0xff;
  }
  return out;
}

function encodeAscii(s: string, maxBytes: number): Uint8Array {
  const out = new Uint8Array(maxBytes);
  const len = Math.min(s.length, maxBytes - 1);
  for (let i = 0; i < len; i++) out[i] = s.charCodeAt(i) & 0x7f;
  return out;
}

export function serialiseBin(q: QuestBin): Uint8Array {
  const { version, language, questNumber, title, info, description, bytecode, functionRefs, dataBlocks, bbData } = q;

  // Determine seg[0]
  let seg0: number;

  if (version === BinVersion.DC) {
    seg0 = 0x1D4;
  } else if (version === BinVersion.BB) {
    seg0 = 4652;
  } else {
    seg0 = 0x394;
  }

  const refBytes   = functionRefs.length * 4;
  const lblBytes   = dataBlocks.length * 5;
  const seg1       = seg0 + bytecode.length;
  const seg2       = seg1 + refBytes;
  const totalSize  = seg2 + lblBytes;

  const buf  = new Uint8Array(totalSize);
  const view = new DataView(buf.buffer);

  // Header
  view.setUint32(0x00, seg0, true);
  view.setUint32(0x04, seg1, true);
  view.setUint32(0x08, seg2, true);
  view.setUint32(0x0C, 0xFFFFFFFF, true);

  if (q.bbContainer) {
    // BB outer container: quest number at 0x10, language forced to 0
    view.setUint16(0x10, questNumber, true);
  } else {
    view.setUint16(0x10, language, true);
    view.setUint16(0x12, questNumber, true);
  }

  // Metadata start: BB outer containers always use 0x18 (Delphi: y=24)
  const txtStart = q.bbContainer ? 0x18 : 0x14;
  const txt = buf.subarray(txtStart, seg0);

  if (version === BinVersion.DC) {
    txt.set(encodeAscii(title,       0x20),  0x00);
    txt.set(encodeAscii(info,        0x80),  0x20);
    txt.set(encodeAscii(description, 0x120), 0xA0); // 288 bytes, fills 0xA0..0x1BF
  } else {
    txt.set(encodeUtf16le(title, 32), 0x00); // 64 bytes,  fills 0x00..0x3F
    txt.set(encodeUtf16le(info, 128), 0x40); // 256 bytes, fills 0x40..0x13F
    // Desc fills remaining space up to 288 wchars (576 bytes).
    // PC-in-BB-container quests have 4 fewer bytes due to the extra BB header word,
    // so clamp to the available space rather than assuming exactly 288 chars fit.
    const descChars = Math.min(288, Math.floor((txt.length - 0x140) / 2));
    txt.set(encodeUtf16le(description, descChars), 0x140);
    if (version === BinVersion.BB && bbData) {
      txt.set(bbData.slice(0, 0xE90), 0x384);
    }
  }

  // Bytecode
  buf.set(bytecode, seg0);

  // Function refs
  for (let i = 0; i < functionRefs.length; i++) {
    view.setUint32(seg1 + i * 4, functionRefs[i], true);
  }

  // DataBlocks
  for (let i = 0; i < dataBlocks.length; i++) {
    view.setUint32(seg2 + i * 5,     dataBlocks[i].offset, true);
    buf[seg2 + i * 5 + 4] = dataBlocks[i].type;
  }

  return buf;
}
