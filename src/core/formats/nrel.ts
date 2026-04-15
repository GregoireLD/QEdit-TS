/**
 * PSO *n.rel visual mesh parser.
 *
 * Ported from TPikaMap.LoadPSOMap() in D3DEngin.pas.
 *
 * A *n.rel file contains a table of map sections (TMapSection, 0x34 bytes
 * each).  Each section has two lists of block-vertex headers (TBlockVertex =
 * 16 bytes, TExtendedBlockVertex = 32 bytes) which point into a scene-graph
 * tree of nodes (TpsoMapChange, 52 bytes each).  Every node with a non-zero
 * flag[1] pointer owns a vertex buffer + one or two index-strip lists.
 *
 * Output: a flat array of NRelMesh objects ready to hand to Three.js.
 * Each mesh carries: interleaved vertex data (XYZ + optional normal + UV),
 * triangle-strip index lists, and a texture ID.
 */

// ─── Public types ─────────────────────────────────────────────────────────────

/** D3D texture address mode (matches D3DTADDRESS_* constants) */
export const enum TexAddrMode {
  Wrap   = 1,
  Mirror = 2,
  Clamp  = 3,
}

export interface NRelStrip {
  /** u16 indices forming a triangle strip */
  indices:   Uint16Array;
  /** Texture slot index (-1 = no texture) */
  textureId: number;
  /** True = GroupeB (alpha-blended). False = GroupeA (opaque / alphaTest). */
  alpha:     boolean;
  /** D3D texture address mode for U axis (material type=4, default=Clamp) */
  wrapU:     TexAddrMode;
  /** D3D texture address mode for V axis (material type=4, default=Clamp) */
  wrapV:     TexAddrMode;
  /** D3DBLEND source factor (stored value + 1 = D3D constant; 0 = unset/default).
   *  Delphi: SetRenderState(D3DRS_SRCBLEND, alphasrc+1). Default 4 → D3DBLEND_SRCALPHA. */
  blendSrc:  number;
  /** D3DBLEND destination factor (same +1 convention). Default 5 → D3DBLEND_INVSRCALPHA. */
  blendDst:  number;
}

/** A single keyframe in a geometry motion track. */
export interface NRelKeyframe {
  /** Animation frame index (already doubled per Delphi loading convention). */
  frame: number;
  /** X/Y/Z value. For rotation tracks, values are raw BAM u32 (cast to number). */
  value: [number, number, number];
}

/**
 * Geometry motion data for an animated ExtendedBlockVertex.
 * The root scene-graph node's transform is stored here rather than baked into
 * vertex positions — the viewer applies it as a Three.js group transform each frame.
 */
export interface NRelMotion {
  /** ani.Frame * 2 — frame space used for interpolation. */
  totalFrames: number;
  /** ani.Frame * 66 ms — total loop duration. */
  durationMs:  number;
  /** Root node's static position (section-local, floats). Used when posKeys is empty. */
  defaultPos:   [number, number, number];
  /** Root node's static rotation (BAM u32 per axis). Used when angKeys is empty. */
  defaultRot:   [number, number, number];
  /** Root node's static scale (floats). Used when scaKeys is empty. */
  defaultScale: [number, number, number];
  /** Position keyframes (empty = use defaultPos). */
  posKeys: NRelKeyframe[];
  /** Rotation keyframes — values are BAM u32 stored as number (divide by 10430.378350 for radians). */
  angKeys: NRelKeyframe[];
  /** Scale keyframes (empty = use defaultScale). */
  scaKeys: NRelKeyframe[];
}

export interface NRelMesh {
  /** Interleaved vertex buffer — stride bytes per vertex */
  vertices:  Float32Array;
  stride:    number;       // floats per vertex
  hasNormal: boolean;
  hasUV:     boolean;
  strips:    NRelStrip[];
  /** Section world transform to apply to this mesh group */
  section: {
    x: number; y: number; z: number;   // translation (dx, dz, dy)
    rotY: number;                        // Y rotation in radians
  };
  /** TAM texture-slide id (-1 = none). Matches TamSlide.id from the .tam file. */
  slideId: number;
  /** TAM texture-swap id (-1 = none). Matches TamSwap.id from the .tam file. */
  swapId:  number;
  /** Geometry animation data. Present only for animated ExtendedBlockVertex entries. */
  motion?: NRelMotion;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function u32(v: DataView, off: number) { return v.getUint32(off, true); }
function f32(v: DataView, off: number) { return v.getFloat32(off, true); }

// ─── TMapSection layout (0x34 = 52 bytes) ────────────────────────────────────
// +0x00 id       u32
// +0x04 dx       f32  section center X
// +0x08 dz       f32  height
// +0x0C dy       f32  section center Z (PSO uses Z-forward convention)
// +0x10 unkn     u32
// +0x14 rotation u32
// +0x18 unkn     u32
// +0x1C unkn     f32
// +0x20 vertexA_off   u32  offset to TBlockVertex array
// +0x24 vertexB_off   u32  offset to TExtendedBlockVertex array
// +0x28 vertexA_count u32
// +0x2C vertexB_count u32
// +0x30 unkn     u32

const SEC_SIZE = 0x34;

// ─── TpsoMapChange / scene-graph node (52 bytes) ─────────────────────────────
// +0x00 flag[0]  u32  bit0=skip_translate, bit1=skip_rotate, bit2=skip_scale
// +0x04 flag[1]  u32  pointer to geometry block (0 = no geometry)
// +0x08 pos[3]   f32×3
// +0x14 rot[3]   u32×3  BAM angles (raw / 10430.378350 → radians)
// +0x20 scale[3] f32×3
// +0x2C child    u32  file offset of first child node (0 = none)
// +0x30 sibling  u32  file offset of next sibling node (0 = none)
// +0x34 stat     u32  (runtime field, ignore)

const NODE_SIZE = 52;

// ─── Rotation helper (BAM → radians, same formula as Delphi MatrixVertex) ────
const BAM_SCALE = 1 / 10430.37835;

function matrixApply(
  px: number, py: number, pz: number,
  flag0: number,
  sx: number, sy: number, sz: number,
  rx: number, ry: number, rz: number,
  tx: number, ty: number, tz: number,
): [number, number, number] {
  let x = px, y = py, z = pz;

  // Scale
  if (!(flag0 & 4)) { x *= sx; y *= sy; z *= sz; }

  // Rotate  (YXZ Euler — matches MatrixVertex in D3DEngin.pas)
  if (!(flag0 & 2)) {
    const sinX = Math.sin((rx & 0xffff) * BAM_SCALE);
    const cosX = Math.cos((rx & 0xffff) * BAM_SCALE);
    const sinY = Math.sin((ry & 0xffff) * BAM_SCALE);
    const cosY = Math.cos((ry & 0xffff) * BAM_SCALE);
    const sinZ = Math.sin((rz & 0xffff) * BAM_SCALE);
    const cosZ = Math.cos((rz & 0xffff) * BAM_SCALE);

    // rotate X
    const xy =  cosX * y - sinX * z;
    const xz =  sinX * y + cosX * z;
    // rotate Y
    const yz =  cosY * xz - sinY * x;
    const yx =  sinY * xz + cosY * x;
    // rotate Z
    x = cosZ * yx - sinZ * xy;
    y = sinZ * yx + cosZ * xy;
    z = yz;
  }

  // Translate
  if (!(flag0 & 1)) { x += tx; y += ty; z += tz; }

  return [x, y, z];
}

// ─── Main parser ─────────────────────────────────────────────────────────────

export function parseNRelMeshes(buf: Uint8Array): NRelMesh[] {
  const v    = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const size = buf.byteLength;
  const meshes: NRelMesh[] = [];

  // ── 1. Locate section table (same indirection as c.rel / n.rel section parse)
  if (size < 16) return meshes;
  const ptr1         = u32(v, size - 16);
  if (ptr1 + 20 > size) return meshes;
  const sectionCount = u32(v, ptr1 + 8);
  const sectionOff   = u32(v, ptr1 + 16);
  if (sectionCount > 1000) return meshes;
  if (sectionOff + sectionCount * SEC_SIZE > size) return meshes;

  for (let s = 0; s < sectionCount; s++) {
    const sec = sectionOff + s * SEC_SIZE;

    // Section world transform — applied as a Three.js group matrix, not baked into vertices
    const section = {
      x:    f32(v, sec + 0x04),                           // dx
      y:    f32(v, sec + 0x08),                           // dz (height)
      z:    f32(v, sec + 0x0C),                           // dy (forward)
      rotY: -((u32(v, sec + 0x14) / 0x8003) * Math.PI),  // BAM → radians, negated to match Delphi
    };

    const vaOff   = u32(v, sec + 0x20);
    const vbOff   = u32(v, sec + 0x24);
    const vaCount = u32(v, sec + 0x28);
    const vbCount = u32(v, sec + 0x2C);

    const totalBlocks = vaCount + vbCount;
    if (totalBlocks > 2000) continue; // sanity guard

    for (let b = 0; b < totalBlocks; b++) {
      // ── 2. Read block-vertex header → get entry point offset
      let entryOff: number;
      let flag: number;

      let slideId = -1;
      let swapId  = -1;
      let anioff  = 0;
      let motion: NRelMotion | undefined;

      if (b < vaCount) {
        // TBlockVertex (16 bytes): +0 offset, +4 unknow1, +8 unknow2, +12 flag
        const bv  = vaOff + b * 16;
        if (bv + 16 > size) continue;
        flag      = u32(v, bv + 12);
        entryOff  = u32(v, bv);
        if (flag & 0x4) {
          // indirect: real offset is at entryOff
          if (entryOff + 4 > size) continue;
          entryOff = u32(v, entryOff);
        }
        // flag & 0x20 → slide id pointer at unknow1 (+4)
        if (flag & 0x20) { const ptr = u32(v, bv + 4);  if (ptr + 4 <= size) slideId = u32(v, ptr); }
        // flag & 0x40 → swap id pointer at unknow2 (+8)
        if (flag & 0x40) { const ptr = u32(v, bv + 8);  if (ptr + 4 <= size) swapId  = u32(v, ptr); }
      } else {
        // TExtendedBlockVertex (32 bytes): +0 offset, +4 anioff, +8-11 unknow2-3,
        // +12 speed, +16 unknow5, +20 unknow6, +24 unknow7(?), +28 flag
        const eb  = vbOff + (b - vaCount) * 32;
        if (eb + 32 > size) continue;
        flag      = u32(v, eb + 28);
        entryOff  = u32(v, eb);
        if (flag & 0x4) {
          if (entryOff + 4 > size) continue;
          entryOff = u32(v, entryOff);
        }
        // flag & 0x20 → slide id pointer at unknow5 (+20)
        if (flag & 0x20) { const ptr = u32(v, eb + 20); if (ptr + 4 <= size) slideId = u32(v, ptr); }
        // flag & 0x40 → swap id pointer at unknow6 (+24)
        if (flag & 0x40) { const ptr = u32(v, eb + 24); if (ptr + 4 <= size) swapId  = u32(v, ptr); }
        anioff = u32(v, eb + 4);
      }

      if (entryOff === 0 || entryOff + NODE_SIZE > size) continue;

      // ── Parse geometry animation (TExtendedBlockVertex with anioff != 0)
      // Tani header (12 bytes LE):
      //   +0  offset  u32  file pointer to TAniInfo data (NOT immediately after Tani)
      //   +4  Frame   u32  total frames (before doubling)
      //   +8  count   u16  number of active tracks (&0xF)
      //   +10 flag    u16  track presence: 1=pos 2=rot 4=sca
      // TAniInfo at aniDataOff: [off0..offN-1, cnt0..cntN-1] (each u32, N=count)
      // Keyframe (Tpikapos / Tpikaang, 16 bytes): id(u32) + x + y + z
      if (anioff !== 0 && anioff + 12 <= size) {
        const aniDataOff = u32(v, anioff);
        const rawFrames  = u32(v, anioff + 4);
        // PSO BB PC path uses the second Tani struct (no BatchConvert):
        //   flag:word at +8, count:word at +10
        // (GCN path BatchConverts the 4-byte word, effectively swapping them)
        const trackFlags = v.getUint16(anioff + 8,  true);        // Tani.flag  (1=pos 2=rot 4=sca)
        const trackCount = v.getUint16(anioff + 10, true) & 0xF; // Tani.count (number of TAniInfo slots)
        if (rawFrames > 0) {
          // Root node defaults (entryOff already bounds-checked above; NODE_SIZE=52 covers +0x28)
          const defaultPos:   [number, number, number] = [
            f32(v, entryOff + 0x08), f32(v, entryOff + 0x0C), f32(v, entryOff + 0x10),
          ];
          const defaultRot:   [number, number, number] = [
            u32(v, entryOff + 0x14), u32(v, entryOff + 0x18), u32(v, entryOff + 0x1C),
          ];
          const defaultScale: [number, number, number] = [
            f32(v, entryOff + 0x20), f32(v, entryOff + 0x24), f32(v, entryOff + 0x28),
          ];

          const posKeys: NRelKeyframe[] = [];
          const angKeys: NRelKeyframe[] = [];
          const scaKeys: NRelKeyframe[] = [];

          if (aniDataOff !== 0 && trackCount > 0 && aniDataOff + trackCount * 8 <= size) {
            const readTrack = (dst: NRelKeyframe[], tIdx: number, isRot: boolean) => {
              const kOff = u32(v, aniDataOff + tIdx * 4);
              const kCnt = u32(v, aniDataOff + trackCount * 4 + tIdx * 4);
              if (kOff === 0 || kCnt === 0 || kCnt > 10000) return;
              if (kOff + kCnt * 16 > size) return;
              for (let k = 0; k < kCnt; k++) {
                const base  = kOff + k * 16;
                const frame = u32(v, base) * 2; // id doubled after load (Delphi convention)
                const x = isRot ? u32(v, base + 4)  : f32(v, base + 4);
                const y = isRot ? u32(v, base + 8)  : f32(v, base + 8);
                const z = isRot ? u32(v, base + 12) : f32(v, base + 12);
                dst.push({ frame, value: [x, y, z] });
              }
            };

            let tIdx = 0;
            if (trackFlags & 1) readTrack(posKeys, tIdx++, false);
            if (trackFlags & 2) readTrack(angKeys, tIdx++, true);
            if (trackFlags & 4) readTrack(scaKeys, tIdx++, false);
          }

          // DEBUG: dump rotation keyframes — which axis (X=0,Y=1,Z=2) is non-zero?
          console.log(`[rot] anioff=0x${anioff.toString(16)} defRot=[${(defaultRot[0]&0xFFFF).toString(16)},${(defaultRot[1]&0xFFFF).toString(16)},${(defaultRot[2]&0xFFFF).toString(16)}] angKeys=${angKeys.length} posKeys=${posKeys.length}`
            + (angKeys.length > 0 ? ' ' + angKeys.map(k =>
                `f${k.frame}:[${(k.value[0]&0xFFFF).toString(16)},${(k.value[1]&0xFFFF).toString(16)},${(k.value[2]&0xFFFF).toString(16)}]`
              ).join(' ') : ' (no rot keys)')
          );

          motion = {
            totalFrames: rawFrames * 2,
            durationMs:  rawFrames * 66,
            defaultPos,
            defaultRot,
            defaultScale,
            posKeys,
            angKeys,
            scaKeys,
          };
        }
      }

      // For animated blocks the root node's transform is NOT baked into vertices —
      // it will be applied at runtime by Three.js each frame via NRelMotion.
      const isAnimated  = motion !== undefined;
      const animRootOff = entryOff;

      // ── 3. Walk scene-graph tree rooted at entryOff
      type StackEntry = {
        off:    number;
        xforms: Array<{ flag0:number; sx:number;sy:number;sz:number;
                         rx:number;ry:number;rz:number;
                         tx:number;ty:number;tz:number }>;
      };

      const visited = new Set<number>();
      const stack: StackEntry[] = [{ off: entryOff, xforms: [] }];
      let nodeCount = 0;

      while (stack.length > 0) {
        const { off, xforms } = stack.pop()!;
        if (off === 0 || off + NODE_SIZE > size) continue;
        if (visited.has(off)) continue;   // cycle guard
        visited.add(off);
        if (++nodeCount > 5000) break;    // runaway guard

        const flag0   = u32(v, off + 0x00);
        const geomPtr = u32(v, off + 0x04);
        const tx      = f32(v, off + 0x08);
        const ty      = f32(v, off + 0x0C);
        const tz      = f32(v, off + 0x10);
        const rx      = u32(v, off + 0x14);
        const ry      = u32(v, off + 0x18);
        const rz      = u32(v, off + 0x1C);
        const sx      = f32(v, off + 0x20);
        const sy      = f32(v, off + 0x24);
        const sz      = f32(v, off + 0x28);
        const child   = u32(v, off + 0x2C);
        const sibling = u32(v, off + 0x30);

        const myXform = { flag0, sx, sy, sz, rx, ry, rz, tx, ty, tz };
        // Skip the animated root's transform: it is applied at runtime, not baked.
        const childXforms = isAnimated && off === animRootOff
          ? [...xforms]
          : [...xforms, myXform];

        // Push sibling first (processed after children)
        if (sibling !== 0) stack.push({ off: sibling, xforms });
        // Push child
        if (child !== 0)   stack.push({ off: child,   xforms: childXforms });

        // ── 4. Process geometry if present
        if (geomPtr === 0 || geomPtr + 24 > size) continue;

        // Geometry block layout (from Delphi sequential reads starting at geomPtr+4):
        //   +0x04  viPtr       (vertex info pointer)
        //   +0x08  unknown     (read and discarded by Delphi)
        //   +0x0C  icAOff      (first index list offset)
        //   +0x10  icACount    (first index list count)
        //   +0x14  icBOff      (second index list offset)
        //   +0x18  icBCount    (second index list count)
        const viPtr    = u32(v, geomPtr + 0x04);
        if (viPtr === 0 || viPtr + 16 > size) continue;
        // +0x08 unknown — skip
        const icAOff   = u32(v, geomPtr + 0x0C);
        const icACount = u32(v, geomPtr + 0x10);
        const icBOff   = u32(v, geomPtr + 0x14);
        const icBCount = u32(v, geomPtr + 0x18);

        // Vertex info block:
        //   +0x00 unknown
        //   +0x04 data offset
        //   +0x08 stride (bytes per vertex)
        //   +0x0C vertex count
        const vDataOff  = u32(v, viPtr + 4);
        const stride    = u32(v, viPtr + 8);   // bytes
        const vCount    = u32(v, viPtr + 12);

        if (stride === 0 || vCount === 0 || vCount > 65536) continue;
        if (stride > 0x40) continue;  // no known format exceeds 0x24
        if (vDataOff + vCount * stride > size)               continue;

        // Decode vertex format from stride
        // 0x10 = XYZ(12) + color(4)
        // 0x18 = XYZ(12) + color(4) + UV(8)
        // 0x1C = XYZ(12) + normal(12) + color(4)
        // 0x20 = XYZ(12) + normal(12) + UV(8)
        // 0x24 = XYZ(12) + normal(12) + color(4) + UV(8)
        const hasNormal = stride >= 0x1C;
        const hasUV     = stride === 0x18 || stride === 0x20 || stride === 0x24;
        const uvOff     = hasNormal ? (stride === 0x20 ? 24 : 28) : 16; // byte offset to UV within vertex

        // floats per output vertex: XYZ(3) + [normal(3)] + [UV(2)]
        const outFloats = 3 + (hasNormal ? 3 : 0) + (hasUV ? 2 : 0);
        const outVerts  = new Float32Array(vCount * outFloats);

        for (let vi = 0; vi < vCount; vi++) {
          const vBase = vDataOff + vi * stride;
          let px = f32(v, vBase);
          let py = f32(v, vBase + 4);
          let pz = f32(v, vBase + 8);

          // Apply node transform stack (innermost = last in array, matching Delphi lv downto 0)
          for (let xi = childXforms.length - 1; xi >= 0; xi--) {
            const xf = childXforms[xi];
            [px, py, pz] = matrixApply(
              px, py, pz,
              xf.flag0,
              xf.sx, xf.sy, xf.sz,
              xf.rx, xf.ry, xf.rz,
              xf.tx, xf.ty, xf.tz,
            );
          }

          // Section transform applied by Three.js group — vertices stay section-local
          let o = vi * outFloats;
          outVerts[o++] = px;
          outVerts[o++] = py;
          outVerts[o++] = pz;

          if (hasNormal) {
            outVerts[o++] = f32(v, vBase + 12);
            outVerts[o++] = f32(v, vBase + 16);
            outVerts[o++] = f32(v, vBase + 20);
          }
          if (hasUV) {
            outVerts[o++] = f32(v, vBase + uvOff);
            outVerts[o++] = f32(v, vBase + uvOff + 4);
          }
        }

        // ── 5. Read index strip lists
        const strips: NRelStrip[] = [];

        function readStripList(listOff: number, count: number, isAlpha: boolean) {
          if (listOff === 0 || count === 0) return;
          let tex  = -1;
          // Default wrap = Wrap (D3DTADDRESS_WRAP=1), NOT Clamp.
          // Strips without a type=4 material descriptor have tus/tvs=0 in Delphi
          // (zero-initialized dynamic array). SetSamplerState with value 0 is
          // invalid in D3D9 and is silently ignored, leaving the global state from
          // SetMirroredTexture(false) = D3DTADDRESS_WRAP in effect.
          let wrapU: TexAddrMode = TexAddrMode.Wrap;
          let wrapV: TexAddrMode = TexAddrMode.Wrap;
          // Blend factors (Delphi stored value; add 1 to get D3DBLEND constant).
          // Default: src=4 (SRCALPHA), dst=5 (INVSRCALPHA) = standard alpha blend.
          let blendSrc = 4;
          let blendDst = 5;

          // Each index list entry is 20 bytes:
          //   +0x00 materialPtr u32
          //   +0x04 materialCount u32
          //   +0x08 indexDataOff u32
          //   +0x0C indexCount u32
          //   +0x10 ??? u32
          for (let f = 0; f < count; f++) {
            const entry   = listOff + f * 20;
            if (entry + 20 > size) break;
            const matPtr  = u32(v, entry);
            const matCnt  = u32(v, entry + 4);
            const idxOff  = u32(v, entry + 8);
            const idxCnt  = u32(v, entry + 12);

            // Walk material descriptors (16 bytes each, type at +0, payload at +4)
            // Types from Delphi LoadPSOMap:
            //   3 = texture ID (4 bytes)
            //   4 = wrap mode: mo1(4), mo2(4); tus=3-mo1, tvs=3-mo2
            //   7 = no-texture flag (4 bytes; non-zero → tex=-1)
            if (matPtr !== 0 && matCnt > 0 && matCnt < 256) {
              for (let mi = 0; mi < matCnt; mi++) {
                const mp = matPtr + mi * 16;
                if (mp + 8 > size) break;
                const type = u32(v, mp);
                if (type === 2 && mp + 12 <= size) {
                  // Blend factors (Delphi material type=2: alphasrc, alphadst).
                  // Stored value + 1 = D3DBLEND constant at render time.
                  // Delphi also remaps (src=3,dst=1) → (src=2,dst=1).
                  let s = u32(v, mp + 4);
                  let d = u32(v, mp + 8);
                  if (s === 3 && d === 1) s = 2;
                  blendSrc = s;
                  blendDst = d;
                } else if (type === 3) {
                  tex = u32(v, mp + 4);
                } else if (type === 4 && mp + 12 <= size) {
                  // raw values: 0=Clamp, 1=Mirror, 2=Wrap → D3D: 3-raw
                  const raw1 = u32(v, mp + 4);
                  const raw2 = u32(v, mp + 8);
                  wrapU = Math.max(1, Math.min(3, 3 - raw1)) as TexAddrMode;
                  wrapV = Math.max(1, Math.min(3, 3 - raw2)) as TexAddrMode;
                } else if (type === 7) {
                  const val = u32(v, mp + 4);
                  if (val !== 0) tex = -1;
                }
              }
            }

            if (idxOff === 0 || idxCnt === 0 || idxCnt > 65536) continue;
            if (idxOff + idxCnt * 2 > size) continue;

            const indices = new Uint16Array(idxCnt);
            for (let i = 0; i < idxCnt; i++) {
              indices[i] = v.getUint16(idxOff + i * 2, true);
            }

            strips.push({ indices, textureId: tex, alpha: isAlpha, wrapU, wrapV, blendSrc, blendDst });
          }
        }

        readStripList(icAOff, icACount, false);
        readStripList(icBOff, icBCount, true);

        if (strips.length > 0) {
          meshes.push({ vertices: outVerts, stride: outFloats, hasNormal, hasUV, strips, section, slideId, swapId, motion });
        }
      }
    }
  }

  return meshes;
}
