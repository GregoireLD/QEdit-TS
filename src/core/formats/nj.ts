/**
 * PSO NJ/XJ chunk model parser.
 *
 * Parses NJCM chunks from .nj or .xj files and returns triangulated geometry
 * pre-transformed into model-local space (all bone hierarchy flattened).
 *
 * Reference: D3DEngin.pas — ProcedeChild / ProcedeChunk / MatrixVertex.
 *
 * Arg type tables (copied verbatim from D3DEngin.pas):
 *   verflag[type-0x20] — per-vertex layout flags for vertex chunks
 *   sfmt   [type-0x40] — per-vertex layout flags for poly/strip chunks
 *   uvc    [(type-0x40) % 3] — UV divisors
 */

// ─── Layout tables ───────────────────────────────────────────────────────────

/** Vertex chunk layout flags, indexed by (chunkType - 0x20). */
const VERFLAG = new Uint8Array([3, 15, 1, 3, 0x11, 0x21, 3, 3, 3, 5, 13, 0x15, 0x25, 13, 13, 13, 3, 11, 0x13]);

/** Strip chunk layout flags, indexed by (chunkType - 0x40). */
const SFMT    = new Uint8Array([1, 3, 3, 9, 11, 11, 5, 7, 7, 1, 19, 19]);

/** UV divisors, indexed by (chunkType - 0x40) % 3. */
const UVC = [1, 255, 1023];

/** BAM (binary angle measure) → radians: 0x10000 = 2π → 1/10430.378350 */
const BAM_TO_RAD = (2 * Math.PI) / 65536;

/** Chunk FourCC magic values (read as little-endian uint32). */
const FOURCC_NJCM = 0x4D434A4E; // "NJCM"
const FOURCC_NMDL = 0x4C444D4E; // "NMDL" — model redirect to charmodel file

// ─── Public types ─────────────────────────────────────────────────────────────

/**
 * One submesh per unique (textureId × blend × mirror) combination.
 * Vertices are ordered as a flat triangle list (3 verts per triangle).
 * All positions are pre-transformed into model-local space with D3D→Three.js
 * handedness (Z negated) already applied.
 */
export interface NjSubMesh {
  /** Flat [x,y,z, x,y,z, …] triangle list. */
  positions: Float32Array;
  /** Flat [nx,ny,nz, …] normals, or null if not present in model. */
  normals:   Float32Array | null;
  /** Flat [u,v, u,v, …] UVs, or null if not present in model. */
  uvs:       Float32Array | null;
  /** Index into companion XVM texture array, or -1 for untextured. */
  textureId: number;
  /**
   * 0-indexed D3DBLEND stored value for alpha source (AlphaSrc = mat >> 3).
   * 0 = ZERO = opaque (no blending).
   */
  blendSrc: number;
  /**
   * 0-indexed D3DBLEND stored value for alpha destination (AlphaDst = mat & 7).
   * 0 = ZERO = opaque (no blending).
   */
  blendDst: number;
  /** UV mirror along U axis (type-8 chunk, bit 7 of byte 3). */
  mirrorU: boolean;
  /** UV mirror along V axis (type-8 chunk, bit 6 of byte 3). */
  mirrorV: boolean;
}

export interface NjResult {
  subMeshes: NjSubMesh[];
  /**
   * If non-null, the NJ file contained an NMDL chunk referencing an external
   * charmodel file.  The caller should load that file instead.
   * Value is the raw null-terminated ASCII filename from the NMDL chunk data.
   */
  nmdlRef: string | null;
}

// ─── Internal types ───────────────────────────────────────────────────────────

interface NjsObj {
  flag:   number;
  pModel: number;   // pointer relative to NJCM base
  pos:    [number, number, number];
  ang:    [number, number, number]; // raw BAM DWORD values
  scale:  [number, number, number];
  pChild: number;   // signed int32, relative to NJCM base; 0 = none
  pSibl:  number;   // signed int32, relative to NJCM base; 0 = none
}

interface NjVertex {
  px: number; py: number; pz: number;
  nx: number; ny: number; nz: number;
  hasNormal: boolean;
}

interface TexBucket {
  textureId: number;
  blendSrc:  number;
  blendDst:  number;
  mirrorU:   boolean;
  mirrorV:   boolean;
  pos:  number[];
  nrm:  number[] | null;
  uvs:  number[] | null;
}

// ─── Public entry point ───────────────────────────────────────────────────────

/**
 * Parse a PSO NJ or XJ file buffer and extract all geometry.
 * Scans the file for an NJCM chunk and returns its contents as a flat
 * triangle list grouped by texture ID.
 */
export function parseNj(buf: Uint8Array): NjResult {
  try {
    const dv  = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const len = buf.byteLength;
    let   p   = 0;

    while (p + 8 <= len) {
      const name = dv.getUint32(p,     true);
      const size = dv.getUint32(p + 4, true);
      const dataStart = p + 8;

      if (name === FOURCC_NJCM) {
        return parseNjcm(dv, len, dataStart);
      }

      if (name === FOURCC_NMDL && size >= 1) {
        // NMDL chunk: 16-byte null-terminated ASCII filename in chunk data
        const maxLen = Math.min(size, 16);
        let nameStr = '';
        for (let i = 0; i < maxLen; i++) {
          const ch = dv.getUint8(dataStart + i);
          if (ch === 0) break;
          nameStr += String.fromCharCode(ch);
        }
        return { subMeshes: [], nmdlRef: nameStr || null };
      }

      // Advance past this chunk; guard against size=0 infinite loop
      const next = dataStart + size;
      if (next <= p) break;
      p = next;
    }
  } catch {
    // Malformed file — return empty rather than propagating
  }
  return { subMeshes: [], nmdlRef: null };
}

// ─── NJCM parser ──────────────────────────────────────────────────────────────

function readObj(dv: DataView, absOff: number): NjsObj {
  return {
    flag:   dv.getUint32 (absOff,      true),
    pModel: dv.getUint32 (absOff +  4, true),
    pos:   [dv.getFloat32(absOff +  8, true), dv.getFloat32(absOff + 12, true), dv.getFloat32(absOff + 16, true)],
    ang:   [dv.getUint32 (absOff + 20, true), dv.getUint32 (absOff + 24, true), dv.getUint32 (absOff + 28, true)],
    scale: [dv.getFloat32(absOff + 32, true), dv.getFloat32(absOff + 36, true), dv.getFloat32(absOff + 40, true)],
    pChild: dv.getInt32  (absOff + 44, true),
    pSibl:  dv.getInt32  (absOff + 48, true),
  };
}

/**
 * Apply the cumulative bone-hierarchy transform (scale → rotate → translate)
 * from the current node (depth) up to the root (depth 0), then negate Z
 * to convert from D3D left-hand to Three.js right-hand coordinates.
 *
 * Mirrors MatrixVertex() in D3DEngin.pas.
 */
function transformVertex(
  px: number, py: number, pz: number,
  stack: NjsObj[], depth: number,
): [number, number, number] {
  let x = px, y = py, z = pz;

  for (let i = depth; i >= 0; i--) {
    const n = stack[i];

    if (!(n.flag & 4)) {                        // scale
      x *= n.scale[0]; y *= n.scale[1]; z *= n.scale[2];
    }

    if (!(n.flag & 2)) {                        // rotate: Rx then Ry then Rz
      const ax = (n.ang[0] & 0xFFFF) * BAM_TO_RAD;
      const ay = (n.ang[1] & 0xFFFF) * BAM_TO_RAD;
      const az = (n.ang[2] & 0xFFFF) * BAM_TO_RAD;
      const sx = Math.sin(ax), cx = Math.cos(ax);
      const sy = Math.sin(ay), cy = Math.cos(ay);
      const sz = Math.sin(az), cz = Math.cos(az);
      const xy = cx*y - sx*z,  xz = sx*y + cx*z; // after Rx
      const yz = cy*xz - sy*x, yx = sy*xz + cy*x; // after Ry
      x = cz*yx - sz*xy; y = sz*yx + cz*xy; z = yz; // after Rz
    }

    if (!(n.flag & 1)) {                        // translate
      x += n.pos[0]; y += n.pos[1]; z += n.pos[2];
    }
  }

  return [x, y, -z]; // negate Z: D3D left-hand → Three.js right-hand
}

function parseNjcm(dv: DataView, fileLen: number, base: number): NjResult {
  const MAX_VER = 0x7FFF;
  // Global vertex buffer: filled by vertex chunks, referenced by poly chunks.
  const ver: NjVertex[] = Array.from({ length: MAX_VER }, () =>
    ({ px: 0, py: 0, pz: 0, nx: 0, ny: 0, nz: 0, hasNormal: false })
  );

  const stack: NjsObj[] = Array.from({ length: 64 }, () => ({
    flag: 0, pModel: 0, pos: [0, 0, 0] as [number,number,number],
    ang: [0, 0, 0] as [number,number,number], scale: [1, 1, 1] as [number,number,number],
    pChild: 0, pSibl: 0,
  }));

  let tid = 0;      // current texture ID (type-8 chunk)
  let mat = 0;      // 6-bit blend material (type-1 chunk): AlphaSrc=mat>>3, AlphaDst=mat&7
  let mirrorU = false;
  let mirrorV = false;
  // Type-4/5 chunk label table: type-4(N) saves stream position → chunkPtr[N].
  // type-5(N) jumps to that position and processes it (mirrors Delphi chunkptr[]).
  const chunkPtr = new Array<number>(256).fill(0);
  const buckets = new Map<string, TexBucket>();
  const getBucket = (): TexBucket => {
    const src = mat >> 3;
    const dst = mat & 7;
    const key = `${tid}:${src}:${dst}:${mirrorU ? 1 : 0}:${mirrorV ? 1 : 0}`;
    let b = buckets.get(key);
    if (!b) {
      b = { textureId: tid, blendSrc: src, blendDst: dst, mirrorU, mirrorV, pos: [], nrm: null, uvs: null };
      buckets.set(key, b);
    }
    return b;
  };

  // ── Chunk stream parser ─────────────────────────────────────────────────────
  // Processes one contiguous chunk stream starting at absOff.
  // Fills ver[] (vertex chunks) or emits triangles to buckets (poly chunks).
  const procedeChunk = (absOff: number, depth: number): void => {
    let off = absOff;

    while (off + 2 <= fileLen) {
      const type  = dv.getUint8(off);
      const flags = dv.getUint8(off + 1);
      off += 2;

      if (type === 0) {
        // Null chunk — continue
      } else if (type >= 1 && type <= 7) {
        // Tiny 2-byte chunk (type + flags already consumed)
        if (type === 1) mat = flags & 0x3F; // BlendMaterial: AlphaSrc=mat>>3, AlphaDst=mat&7
        if (type === 4) {
          // Section label: save stream position after this chunk, then stop this stream.
          // Mirrors Delphi: chunkptr[flags] = current_pos; o=0
          chunkPtr[flags] = off;
          break;
        }
        if (type === 5) {
          // Jump to labeled section and process it as a sub-stream.
          // Mirrors Delphi: seek to chunkptr[flags], ProcedeChunk, seek back.
          const target = chunkPtr[flags];
          if (target !== 0) procedeChunk(target, depth);
          // Continue current stream after the type-5 chunk.
        }

      } else if (type === 8) {
        // Texture ID (2 extra bytes); bits 6-7 of byte 3 are mirror flags
        if (off + 2 > fileLen) break;
        const b2 = dv.getUint8(off), b3 = dv.getUint8(off + 1);
        tid     = b2 + (b3 & 0x3F) * 256;
        mirrorV = (b3 & 0x40) !== 0; // bit 6
        mirrorU = (b3 & 0x80) !== 0; // bit 7
        off += 2;

      } else if (type === 9) {
        // Texture ID 2 (2 extra bytes, ignore value)
        off += 2;

      } else if (type & 0x80) {
        // End chunk (bit 7 set): 2 extra bytes, then stop
        off += 2;
        break;

      } else if (type >= 0x10 && type <= 0x17) {
        // Material color chunk; flags byte carries 6-bit blend material index
        if (off + 2 > fileLen) break;
        off += 2; // skip flags word
        if ((type - 0x10) & 1) off += 4; // diffuse
        if ((type - 0x10) & 2) off += 4; // ambient
        if ((type - 0x10) & 4) off += 4; // specular
        mat = flags & 0x3F;

      } else if (type >= 0x18 && type <= 0x1F) {
        // Unknown material chunk (size in words)
        if (off + 2 > fileLen) break;
        const sz = dv.getUint16(off, true); off += 2 + sz * 2;

      } else if (type >= 0x20 && type <= 0x37) {
        // ── Vertex chunk ──────────────────────────────────────────────────────
        // sizeWords is in DWORD (4-byte) units, counting data after the sizeWords field.
        if (off + 2 > fileLen) break;
        const sizeWords = dv.getUint16(off, true); off += 2;
        const chunkEnd  = off + sizeWords * 4; // absolute end of this chunk's data

        if ((flags & 3) === 0) {
          if (off + 4 > fileLen) { off = chunkEnd; continue; }
          const firstIdx = dv.getUint16(off, true); off += 2;
          const count    = dv.getUint16(off, true); off += 2;
          const vf       = VERFLAG[type - 0x20];

          let vi = 0; // sequential counter for non-ninjaflag vertices
          for (let k = 0; k < count && off <= fileLen; k++) {
            let px = 0, py = 0, pz = 0, nx = 0, ny = 0, nz = 0;
            let hasNorm = false;

            if (vf & 1)  { px = dv.getFloat32(off, true); py = dv.getFloat32(off+4, true); pz = dv.getFloat32(off+8, true); off += 12; }
            if (vf & 2)  off += 4;  // extra 1.0f
            if (vf & 4)  { nx = dv.getFloat32(off, true); ny = dv.getFloat32(off+4, true); nz = dv.getFloat32(off+8, true); off += 12; hasNorm = true; }
            if (vf & 8)  off += 4;  // extra 0.0f
            if (vf & 16) off += 4;  // userflag32
            if (vf & 32) {
              // ninjaflag: low 16 = index offset from firstIdx
              if (off + 4 > fileLen) break;
              const e   = dv.getUint32(off, true); off += 4;
              const idx = firstIdx + (e & 0xFFFF);
              if (idx < MAX_VER) {
                const [tx, ty, tz] = transformVertex(px, py, pz, stack, depth);
                ver[idx] = { px: tx, py: ty, pz: tz, nx, ny, nz, hasNormal: hasNorm };
              }
            } else {
              const idx = firstIdx + vi++;
              if (idx < MAX_VER) {
                const [tx, ty, tz] = transformVertex(px, py, pz, stack, depth);
                ver[idx] = { px: tx, py: ty, pz: tz, nx, ny, nz, hasNormal: hasNorm };
              }
            }
          }
        }
        // Seek to known end to stay aligned (catches trailing padding and non-standard sub-types)
        off = chunkEnd;

      } else if (type >= 0x38 && type <= 0x3A) {
        if (off + 2 > fileLen) break;
        const sz = dv.getUint16(off, true); off += 2 + sz * 2;

      } else if (type >= 0x40 && type <= 0x4B) {
        // ── Strip/poly chunk ─────────────────────────────────────────────────
        // iBase = absolute position right after the 4-byte chunk header.
        // The chunk spans iBase .. iBase + sizeWords*2.
        const iBase = off + 2; // position after reading the upcoming 2-byte size word
        if (off + 2 > fileLen) break;
        const sizeWords    = dv.getUint16(off, true); off += 2; // off == iBase now
        const polyEnd      = iBase + sizeWords * 2;             // absolute end of this chunk
        if (off + 2 > polyEnd) { off = polyEnd; continue; }
        const stripCountRaw = dv.getUint16(off, true); off += 2;
        const extraSkip     = Math.floor(stripCountRaw / 16384); // extra per-vertex skip count
        const stripCount    = stripCountRaw & 0x3FFF;

        const sf       = SFMT[type - 0x40];
        const divisor  = UVC[(type - 0x40) % 3];
        const hasVtx   = (sf & 1)  !== 0;
        const hasUV    = (sf & 2)  !== 0;
        const skip4a   = (sf & 4)  !== 0;
        const skip6    = (sf & 8)  !== 0;
        const skip4b   = (sf & 16) !== 0;
        // Bytes consumed per vertex entry (used for the inner loop bound)
        const vtxBytes = (hasVtx ? 2 : 0) + (hasUV ? 4 : 0)
                       + (skip4a ? 4 : 0) + (skip6 ? 6 : 0) + (skip4b ? 4 : 0)
                       + extraSkip * 2;

        for (let s = 0; s < stripCount && off + 2 <= polyEnd; s++) {
          const lenRaw   = dv.getUint16(off, true); off += 2;
          const reversed = (lenRaw & 0x8000) !== 0;
          const stripLen = reversed ? (0x10000 - lenRaw) : lenRaw; // Delphi: y := $10000-y

          // Read all vertices in this strip
          const svPos: [number, number, number][] = [];
          const svNrm: [number, number, number][] = [];
          const svUV:  [number, number][]          = [];
          let hasNorm = false, hasUVs = false;

          for (let v = 0; v < stripLen && off + vtxBytes <= polyEnd; v++) {
            let px = 0, py = 0, pz = 0, nx = 0, ny = 0, nz = 0, u = 0, tv = 0;

            if (hasVtx) {
              const idx = dv.getUint16(off, true); off += 2;
              if (idx < MAX_VER) {
                const vt = ver[idx];
                px = vt.px; py = vt.py; pz = vt.pz;
                nx = vt.nx; ny = vt.ny; nz = vt.nz;
                if (vt.hasNormal) hasNorm = true;
              }
            }
            if (hasUV) {
              u  = dv.getUint16(off,     true) / divisor;
              tv = dv.getUint16(off + 2, true) / divisor;
              off += 4; hasUVs = true;
            }
            if (skip4a) off += 4;
            if (skip6)  off += 6;
            if (skip4b) off += 4;
            if (extraSkip > 0) off += extraSkip * 2;

            svPos.push([px, py, pz]);
            svNrm.push([nx, ny, nz]);
            svUV.push([u, tv]);
          }

          // Convert triangle strip → triangle list
          if (svPos.length >= 3) {
            const bucket = getBucket();
            if (hasNorm && !bucket.nrm) bucket.nrm = [];
            if (hasUVs && !bucket.uvs) bucket.uvs  = [];

            for (let tri = 0; tri < svPos.length - 2; tri++) {
              // Strip winding alternates every triangle; reversed flag flips overall order.
              let a = tri, b = tri + 1, c = tri + 2;
              if ((tri % 2 === 1) !== reversed) { const t = a; a = b; b = t; }

              for (const vi of [a, b, c]) {
                const p = svPos[vi];
                bucket.pos.push(p[0], p[1], p[2]);
                if (bucket.nrm) { const n = svNrm[vi]; bucket.nrm.push(n[0], n[1], n[2]); }
                if (bucket.uvs) { const uv = svUV[vi]; bucket.uvs.push(uv[0], uv[1]); }
              }
            }
          }
        }

        // Seek to the known end of this chunk's data block
        off = polyEnd;

      } else {
        // Unknown chunk type — stop stream
        break;
      }
    }
  };

  // ── Object-tree traversal ─────────────────────────────────────────────────
  // Mirrors ProcedeChild() in D3DEngin.pas.
  // nodeAbsOff — absolute buffer offset of the TNJS_OBJECT to read.
  // depth      — current ancestor-stack depth (0 = root).
  const procedeChild = (nodeAbsOff: number, depth: number): void => {
    if (nodeAbsOff + 52 > fileLen) return;
    if (depth >= 64) return;

    const obj = readObj(dv, nodeAbsOff);
    stack[depth] = obj;

    if (obj.pModel !== 0) {
      const mAbs = base + obj.pModel;
      if (mAbs + 8 <= fileLen) {
        const pVertex = dv.getUint32(mAbs,     true);
        const pPoly   = dv.getUint32(mAbs + 4, true);
        if (pVertex !== 0) procedeChunk(base + pVertex, depth);
        if (pPoly   !== 0) procedeChunk(base + pPoly,   depth);
      }
    }

    if (obj.pChild !== 0) procedeChild(base + obj.pChild, depth + 1);
    if (obj.pSibl  !== 0) procedeChild(base + obj.pSibl,  depth);
  };

  // Root node is at base + 0 (file was seeked to base before calling ProcedeChild)
  procedeChild(base, 0);

  // ── Build output ──────────────────────────────────────────────────────────
  const subMeshes: NjSubMesh[] = [];
  for (const [, b] of buckets) {
    if (b.pos.length === 0) continue;
    subMeshes.push({
      positions: new Float32Array(b.pos),
      normals:   b.nrm ? new Float32Array(b.nrm) : null,
      uvs:       b.uvs ? new Float32Array(b.uvs)  : null,
      textureId: b.textureId,
      blendSrc:  b.blendSrc,
      blendDst:  b.blendDst,
      mirrorU:   b.mirrorU,
      mirrorV:   b.mirrorV,
    });
  }

  return { subMeshes, nmdlRef: null };
}

// ─── XJ parser ────────────────────────────────────────────────────────────────
//
// XJ files share the outer NJCM/NMDL chunk envelope with NJ, but use a
// completely different internal geometry format:
//
//   TNJX_CNK_MODEL (40 bytes at base+PMODEL):
//     [0-3]   flag
//     [4-7]   Entry[0].off  → vertex buffer header (from base)
//     [8-11]  Entry[0].size (unused in vertex load)
//     [12-15] Entry[1].off  → strip list 1 (from base)
//     [16-19] Entry[1].size → strip count 1
//     [20-23] Entry[2].off  → strip list 2 (from base)
//     [24-27] Entry[2].size → strip count 2
//     [28-39] Center[3]     (float32 × 3, ignored)
//
//   Vertex buffer header (16 bytes at base+Entry[0].off):
//     [0-3]   flags (ignored)
//     [4-7]   vertex data offset (from base)
//     [8-11]  vertex format: 0x0C=pos, 0x10=+color, 0x18=+color+UV,
//                            0x1C=+normal+color, 0x20=+normal+UV, 0x24=+normal+color+UV
//     [12-15] vertex count
//
//   Strip descriptor (20 bytes per strip):
//     [0-3]   material list offset (from base)
//     [4-7]   material entry count
//     [8-11]  index list offset (from base)
//     [12-15] index count (uint16 values)
//     [16-19] (ignored)
//
//   Material entry (16 bytes): type=3 → texture ID; type=2 → material flags
//   Index list: uint16 indices into the current bone node's vertex buffer,
//               rendered as a triangle strip (alternating winding).
//
// MatrixVertex transform order (per node, innermost first):
//   Rotate (Rx→Ry→Rz) if !(flag&2), Translate if !(flag&1), Scale if !(flag&4)
// Then negate Z for Three.js right-hand coordinates.
//
// Reference: D3DEngin.pas — LoadFromXJ / ProcedeChild / ProcedeVertex / ProcedeIndice

function parseXjcm(dv: DataView, fileLen: number, base: number): NjResult {
  const MAX_VER = 65536;
  // Per-bone vertex arrays (refilled for each bone node; index lists reference them 0-based)
  const verPx = new Float32Array(MAX_VER);
  const verPy = new Float32Array(MAX_VER);
  const verPz = new Float32Array(MAX_VER);
  const verNx = new Float32Array(MAX_VER);
  const verNy = new Float32Array(MAX_VER);
  const verNz = new Float32Array(MAX_VER);
  const verU  = new Float32Array(MAX_VER);
  const verV  = new Float32Array(MAX_VER);
  let verHasNormal = false;
  let verHasUV    = false;

  const stack: NjsObj[] = Array.from({ length: 64 }, () => ({
    flag: 0, pModel: 0, pos: [0, 0, 0] as [number, number, number],
    ang: [0, 0, 0] as [number, number, number], scale: [1, 1, 1] as [number, number, number],
    pChild: 0, pSibl: 0,
  }));

  let tid = 0;
  let blendSrc = 0; // 0-indexed D3DBLEND AlphaSrc from matType=2
  let blendDst = 0; // 0-indexed D3DBLEND AlphaDst from matType=2
  const buckets = new Map<string, TexBucket>();
  const getBucket = (): TexBucket => {
    const key = `${tid}:${blendSrc}:${blendDst}`;
    let b = buckets.get(key);
    if (!b) {
      b = { textureId: tid, blendSrc, blendDst, mirrorU: false, mirrorV: false, pos: [], nrm: null, uvs: null };
      buckets.set(key, b);
    }
    return b;
  };

  // XJ transform order: Rotate → Translate → Scale (then negate Z)
  const xjTransform = (px: number, py: number, pz: number, depth: number): [number, number, number] => {
    let x = px, y = py, z = pz;
    for (let i = depth; i >= 0; i--) {
      const n = stack[i];
      if (!(n.flag & 2)) {
        const ax = (n.ang[0] & 0xFFFF) * BAM_TO_RAD;
        const ay = (n.ang[1] & 0xFFFF) * BAM_TO_RAD;
        const az = (n.ang[2] & 0xFFFF) * BAM_TO_RAD;
        const sx = Math.sin(ax), cx = Math.cos(ax);
        const sy = Math.sin(ay), cy = Math.cos(ay);
        const sz = Math.sin(az), cz = Math.cos(az);
        const xy = cx*y - sx*z, xz = sx*y + cx*z;
        const yz = cy*xz - sy*x, yx = sy*xz + cy*x;
        x = cz*yx - sz*xy; y = sz*yx + cz*xy; z = yz;
      }
      if (!(n.flag & 1)) { x += n.pos[0]; y += n.pos[1]; z += n.pos[2]; }
      if (!(n.flag & 4)) { x *= n.scale[0]; y *= n.scale[1]; z *= n.scale[2]; }
    }
    return [x, y, -z];
  };

  // Emit triangles from a triangle strip index list into the current texture bucket
  const emitStrip = (indices: Uint16Array, count: number): void => {
    if (count < 3) return;
    const b = getBucket();
    if (!b.nrm && verHasNormal) b.nrm = [];
    if (!b.uvs && verHasUV)    b.uvs = [];
    for (let i = 0; i < count - 2; i++) {
      const i0 = (i & 1) === 0 ? indices[i] : indices[i + 1];
      const i1 = (i & 1) === 0 ? indices[i + 1] : indices[i];
      const i2 = indices[i + 2];
      b.pos.push(verPx[i0], verPy[i0], verPz[i0]);
      b.pos.push(verPx[i1], verPy[i1], verPz[i1]);
      b.pos.push(verPx[i2], verPy[i2], verPz[i2]);
      if (verHasNormal && b.nrm) {
        b.nrm.push(verNx[i0], verNy[i0], verNz[i0]);
        b.nrm.push(verNx[i1], verNy[i1], verNz[i1]);
        b.nrm.push(verNx[i2], verNy[i2], verNz[i2]);
      }
      if (verHasUV && b.uvs) {
        b.uvs.push(verU[i0], verV[i0]);
        b.uvs.push(verU[i1], verV[i1]);
        b.uvs.push(verU[i2], verV[i2]);
      }
    }
  };

  // Process one strip list (Entry[1] or Entry[2] of TNJX_CNK_MODEL)
  const processPolyBuffer = (entryOff: number, stripCount: number): void => {
    let off = base + entryOff;
    for (let s = 0; s < stripCount; s++) {
      if (off + 20 > fileLen) break;
      const matListOff  = dv.getUint32(off,      true);
      const matCount    = dv.getUint32(off +  4, true);
      const indexListOff = dv.getUint32(off + 8,  true);
      const indexCount  = dv.getUint32(off + 12, true);
      off += 20;

      // Read material entries (16 bytes each):
      //   matType=2 → blend: d[1]=AlphaSrc, d[2]=AlphaDst (0-indexed)
      //   matType=3 → texture ID: d[1]=tid
      if (matListOff !== 0) {
        let mOff = base + matListOff;
        for (let m = 0; m < matCount && mOff + 16 <= fileLen; m++, mOff += 16) {
          const matType = dv.getUint32(mOff, true);
          if (matType === 2) {
            blendSrc = dv.getUint32(mOff + 4, true); // d[1] = AlphaSrc
            blendDst = dv.getUint32(mOff + 8, true); // d[2] = AlphaDst
          }
          if (matType === 3) tid = dv.getUint32(mOff + 4, true);
        }
      }

      // Read index list and emit triangles
      if (indexListOff !== 0 && indexCount >= 3) {
        const iOff = base + indexListOff;
        if (iOff + indexCount * 2 <= fileLen) {
          const indices = new Uint16Array(dv.buffer, dv.byteOffset + iOff, indexCount);
          emitStrip(indices, indexCount);
        }
      }
    }
  };

  const seen = new Set<number>(); // guard against cycles in the object graph
  const procedeChild = (objOff: number, depth: number): void => {
    if (depth >= 63 || seen.has(base + objOff)) return;
    if (base + objOff + 52 > fileLen) return;
    seen.add(base + objOff);

    const obj = readObj(dv, base + objOff);
    stack[depth] = obj;

    if (obj.pModel !== 0 && base + obj.pModel + 28 <= fileLen) {
      const mOff = base + obj.pModel;
      const entry0Off  = dv.getUint32(mOff +  4, true);
      const entry1Off  = dv.getUint32(mOff + 12, true);
      const entry1Size = dv.getUint32(mOff + 16, true);
      const entry2Off  = dv.getUint32(mOff + 20, true);
      const entry2Size = dv.getUint32(mOff + 24, true);

      // Vertex buffer
      verHasNormal = false;
      verHasUV    = false;
      if (entry0Off !== 0 && base + entry0Off + 16 <= fileLen) {
        const vh      = base + entry0Off;
        const vDataOff = dv.getUint32(vh + 4, true); // vertex data start (from base)
        const vFmt    = dv.getUint32(vh + 8, true);  // format flag
        const vCount  = dv.getUint32(vh + 12, true); // vertex count
        verHasNormal  = (vFmt === 0x1C || vFmt === 0x20 || vFmt === 0x24);
        const hasColor = (vFmt === 0x10 || vFmt === 0x18 || vFmt === 0x1C || vFmt === 0x24);
        verHasUV      = (vFmt === 0x18 || vFmt === 0x20 || vFmt === 0x24);

        let vOff = base + vDataOff;
        for (let i = 0; i < vCount && i < MAX_VER && vOff + 12 <= fileLen; i++) {
          const [tx, ty, tz] = xjTransform(
            dv.getFloat32(vOff,     true),
            dv.getFloat32(vOff + 4, true),
            dv.getFloat32(vOff + 8, true),
            depth,
          );
          verPx[i] = tx; verPy[i] = ty; verPz[i] = tz;
          vOff += 12;
          if (verHasNormal && vOff + 12 <= fileLen) {
            verNx[i] = dv.getFloat32(vOff,      true);
            verNy[i] = dv.getFloat32(vOff +  4, true);
            verNz[i] = -dv.getFloat32(vOff + 8, true); // negate Z for Three.js
            vOff += 12;
          }
          if (hasColor)  vOff += 4;
          if (verHasUV && vOff + 8 <= fileLen) {
            verU[i] = dv.getFloat32(vOff,     true);
            verV[i] = dv.getFloat32(vOff + 4, true);
            vOff += 8;
          }
        }
      }

      if (entry1Off !== 0 && entry1Size > 0) processPolyBuffer(entry1Off, entry1Size);
      if (entry2Off !== 0 && entry2Size > 0) processPolyBuffer(entry2Off, entry2Size);
    }

    if (obj.pChild !== 0) procedeChild(obj.pChild, depth + 1);
    if (obj.pSibl  !== 0) procedeChild(obj.pSibl,  depth);
  };

  procedeChild(0, 0);

  const subMeshes: NjSubMesh[] = [];
  for (const [, b] of buckets) {
    if (b.pos.length === 0) continue;
    subMeshes.push({
      positions: new Float32Array(b.pos),
      normals:   b.nrm ? new Float32Array(b.nrm) : null,
      uvs:       b.uvs ? new Float32Array(b.uvs) : null,
      textureId: b.textureId,
      blendSrc:  b.blendSrc,
      blendDst:  b.blendDst,
      mirrorU:   b.mirrorU,
      mirrorV:   b.mirrorV,
    });
  }
  return { subMeshes, nmdlRef: null };
}

/**
 * Parse a PSO XJ file buffer.
 * XJ files share the outer NJCM/NMDL chunk envelope with NJ but use a
 * different internal geometry model.  Use this for .xj files; use parseNj
 * for .nj files.
 */
export function parseXj(buf: Uint8Array): NjResult {
  try {
    const dv  = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const len = buf.byteLength;
    let   p   = 0;

    while (p + 8 <= len) {
      const name = dv.getUint32(p,     true);
      const size = dv.getUint32(p + 4, true);
      const dataStart = p + 8;

      if (name === FOURCC_NJCM) {
        return parseXjcm(dv, len, dataStart);
      }

      if (name === FOURCC_NMDL && size >= 1) {
        const maxLen = Math.min(size, 16);
        let nameStr = '';
        for (let i = 0; i < maxLen; i++) {
          const ch = dv.getUint8(dataStart + i);
          if (ch === 0) break;
          nameStr += String.fromCharCode(ch);
        }
        return { subMeshes: [], nmdlRef: nameStr || null };
      }

      const next = dataStart + size;
      if (next <= p) break;
      p = next;
    }
  } catch {
    // Malformed file
  }
  return { subMeshes: [], nmdlRef: null };
}
