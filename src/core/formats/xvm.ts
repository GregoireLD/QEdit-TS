/**
 * PSO .xvm texture archive parser.
 *
 * Ported from PSOLoadTexture() in D3DEngin.pas.
 *
 * Layout:
 *   XVM header  — 0x40 bytes
 *     +0x00  flag  u32  (usually "NXVM" or similar magic)
 *     +0x04  size  u32
 *     +0x08  count u32  number of XVR entries
 *     +0x0C…  padding to 0x40
 *
 *   For each texture, one XVR header — 0x40 bytes:
 *     +0x00  flag      u32
 *     +0x04  size      u32  total bytes of this XVR entry (header + data)
 *     +0x08  pixFmt    u32  stored in Delphi texFlag[]; >1 means texture has usable alpha
 *     +0x0C  dxtFmt    u32  3=VQ(old), 6=DXT1, else DXT3
 *     +0x10  id        u32
 *     +0x14  sx        u16  width
 *     +0x16  sy        u16  height
 *     +0x18  dataSize  u32  compressed data byte count
 *     …padding to 0x40
 *
 *   Immediately after the XVR header: (size - 0x38) bytes of pixel data.
 *   (Delphi: fileread(f, p[128], b.Size - 0x38)  — 0x38 = 56 = sizeof XVR header minus the 8-byte prefix)
 *
 * DXT1/DXT3 data is returned as-is to be fed into Three.js CompressedTexture.
 * Delphi confirms: dxtFmt=6 → DXT1, everything else (non-VQ) → DXT3.
 * The Delphi "DXT5_Header" variable is misnamed — its FourCC bytes are "DXT3".
 * VQ format (dxtFmt=3) is skipped — too rare and complex to decode without a
 * full twiddled-VQ decoder; those slots are left null.
 *
 * Returns an array of XvmTexture (one per slot, null for unsupported formats).
 */

export interface XvmTexture {
  width:   number;
  height:  number;
  isDXT1:  boolean;   // true=DXT1, false=DXT3
  /** pixFmt from XVR header (+0x08). Delphi stores this as texFlag[i].
   *  >1 means the texture carries meaningful alpha (halos, leaves, fences…).
   *  Used to decide alphaTest vs opaque rendering for GroupeA strips. */
  hasAlpha: boolean;
  data:    Uint8Array; // raw compressed block data
}

export function parseXvm(buf: Uint8Array): (XvmTexture | null)[] {
  const v    = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const size = buf.byteLength;
  const out: (XvmTexture | null)[] = [];

  if (size < 0x40) return out;

  const count = v.getUint32(0x08, true);
  if (count === 0 || count > 4096) return out;

  let pos = 0x40; // first XVR header starts after XVM header

  for (let i = 0; i < count; i++) {
    if (pos + 0x40 > size) break;

    const xvrSize  = v.getUint32(pos + 0x04, true);
    const pixFmt   = v.getUint32(pos + 0x08, true);
    const dxtFmt   = v.getUint32(pos + 0x0C, true);
    const sx       = v.getUint16(pos + 0x14, true);
    const sy       = v.getUint16(pos + 0x16, true);
    const dataSize = v.getUint32(pos + 0x18, true);

    // Data starts right after the 0x40-byte XVR header
    const dataOff  = pos + 0x40;
    // Byte count to read = xvrSize - 0x38 (matching Delphi's b.Size - $38)
    const dataLen  = xvrSize > 0x38 ? xvrSize - 0x38 : dataSize;

    if (dxtFmt === 3) {
      // VQ format — skip (too complex, leave slot null)
      out.push(null);
    } else if (dataOff + dataLen <= size && sx > 0 && sy > 0) {
      const isDXT1 = dxtFmt === 6;
      // S3TC requires exactly ceil(W/4)*ceil(H/4)*blockBytes.
      // xvrSize may be padded; clamp to the exact GPU-expected size.
      const blockBytes  = isDXT1 ? 8 : 16;
      const expectedLen = Math.ceil(sx / 4) * Math.ceil(sy / 4) * blockBytes;
      const useLen      = Math.min(dataLen, expectedLen);
      if (dataOff + useLen > size) { out.push(null); }
      else {
        out.push({
          width:    sx,
          height:   sy,
          isDXT1,
          hasAlpha: pixFmt > 1,
          data:     buf.slice(dataOff, dataOff + useLen),
        });
      }
    } else {
      out.push(null);
    }

    // Advance: XVR header (0x40) + data payload
    pos += 0x40 + dataLen;
  }

  return out;
}
