/**
 * PSO *.tam animation data parser.
 *
 * Ported from TPikaMap.LoadPSOTam() in D3DEngin.pas.
 *
 * The TAM file is a sequence of tagged chunks, each byte-swapped (big-endian u32
 * pairs reversed to little-endian by Delphi's BatchConvert):
 *
 *   TTamHeader { size: u16, flag: u16 }  — repeated until flag === 0xFFFF
 *
 * flag = 1 → TextureSlide chunk
 *   Another TTamHeader where .flag = count of TTextureSlide records.
 *   Each TTextureSlide is 20 bytes (after BatchConvert):
 *     +0x00  frame  u16
 *     +0x02  id     u16   — matches NRelMesh.slideId
 *     +0x04  un1    f32
 *     +0x08  un2    f32
 *     +0x0C  tu     f32   — U scroll speed (offset = tu * elapsed_ms / 6000)
 *     +0x10  tv     f32   — V scroll speed
 *
 * flag = 2 → TextureSwap chunk
 *   TTamTexSwapHeader { count: u16, numOfSec: u16 }
 *   numOfSec is the id that matches NRelMesh.swapId.
 *   Followed by count × TTamTexEntry { nomOfFrame: u16, id: u16 }
 *   Delphi adds 1 to each frame count and sums for maxFrame.
 */

export interface TamSlide {
  id:  number;
  tu:  number;   // U scroll speed; offset = tu * elapsed_ms / 6000
  tv:  number;   // V scroll speed
}

export interface TamSwapEntry {
  frame: number;  // how many ticks this entry lasts (already +1 applied)
  newId: number;  // texture slot index to use during this entry
}

export interface TamSwap {
  id:       number;          // matches NRelMesh.swapId
  maxFrame: number;          // total tick duration (sum of entry.frame)
  entries:  TamSwapEntry[];
}

export interface TamData {
  slides: TamSlide[];
  swaps:  TamSwap[];
}

// BatchConvert: swap bytes within each u32 (big→little endian).
// Delphi swaps bytes 0↔3 and 1↔2 within every 4-byte group.
function batchConvert(buf: Uint8Array, byteOffset: number, byteLen: number): void {
  for (let i = 0; i < (byteLen >> 2); i++) {
    const o = byteOffset + i * 4;
    let tmp = buf[o]; buf[o] = buf[o + 3]; buf[o + 3] = tmp;
    tmp = buf[o + 1]; buf[o + 1] = buf[o + 2]; buf[o + 2] = tmp;
  }
}

export function parseTam(buf: Uint8Array): TamData {
  // Work on a copy so we can mutate bytes safely for batchConvert
  const data = buf.slice();
  const slides: TamSlide[] = [];
  const swaps:  TamSwap[]  = [];

  let pos = 0;
  const size = data.byteLength;

  function readHeader(): { size: number; flag: number } | null {
    if (pos + 4 > size) return null;
    batchConvert(data, pos, 4);
    const dv   = new DataView(data.buffer, data.byteOffset + pos, 4);
    const sz   = dv.getUint16(0, true);
    const flag = dv.getUint16(2, true);
    pos += 4;
    return { size: sz, flag };
  }

  let hdr = readHeader();
  while (hdr !== null && hdr.flag !== 0xffff) {
    if (hdr.flag === 1) {
      // TextureSlide — inner header gives count in its flag field
      const inner = readHeader();
      if (!inner) break;
      const count = inner.flag;
      const byteLen = count * 20;
      if (pos + byteLen > size) break;
      batchConvert(data, pos, byteLen);
      const dv = new DataView(data.buffer, data.byteOffset + pos, byteLen);
      for (let i = 0; i < count; i++) {
        const base = i * 20;
        const id   = dv.getUint16(base + 2, true);
        const tu   = dv.getFloat32(base + 12, true);
        const tv   = dv.getFloat32(base + 16, true);
        slides.push({ id, tu, tv });
      }
      pos += byteLen;

    } else if (hdr.flag === 2) {
      // TextureSwap — TTamTexSwapHeader then entries
      if (pos + 4 > size) break;
      batchConvert(data, pos, 4);
      const hdv   = new DataView(data.buffer, data.byteOffset + pos, 4);
      const count     = hdv.getUint16(0, true);
      const numOfSec  = hdv.getUint16(2, true);
      pos += 4;

      const byteLen = count * 4;
      if (pos + byteLen > size) break;
      batchConvert(data, pos, byteLen);
      const edv = new DataView(data.buffer, data.byteOffset + pos, byteLen);
      const entries: TamSwapEntry[] = [];
      let maxFrame = 0;
      for (let i = 0; i < count; i++) {
        const frame = edv.getUint16(i * 4, true) + 1;  // Delphi: inc(frame)
        const newId = edv.getUint16(i * 4 + 2, true);
        entries.push({ frame, newId });
        maxFrame += frame;
      }
      swaps.push({ id: numOfSec, maxFrame, entries });
      pos += byteLen;

    } else {
      // Unknown chunk — skip by size
      pos += hdr.size;
    }

    hdr = readHeader();
  }

  return { slides, swaps };
}
