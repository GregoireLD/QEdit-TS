/**
 * PSO .rel file parser — map geometry and section data.
 *
 * Two files are needed per floor:
 *   *c.rel — collision/geometry: vertex table + indexed triangle faces
 *   *n.rel — section data: section IDs, centers (dx/dy), rotations
 *
 * Ported from DrawBBRELFile() in main.pas.
 */

// ─── Types ─────────────────────────────────────────────────────────────────

export interface RelSection {
  id: number;
  /** Section center X in world units (from TMapSection.dx) */
  cx: number;
  /** Section center Y in world units (from TMapSection.dy — "depth" axis in 2D) */
  cy: number;
  /** Rotation value; angle = -rotation / 10430.37835 radians */
  rotation: number;
}

export interface RelTriangle {
  x0: number; y0: number; z0: number;
  x1: number; y1: number; z1: number;
  x2: number; y2: number; z2: number;
  /** Face flags from c.rel (bit 0=floor, bit 4=platform, bit 6=wall) */
  flags: number;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function dv(buf: Uint8Array): DataView {
  return new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
}

// ─── n.rel parser ───────────────────────────────────────────────────────────
// TMapSection = 52 bytes each:
//   0x00: section (u32)
//   0x04: dx (f32) — center X
//   0x08: dz (f32) — height (unused for 2D)
//   0x0C: dy (f32) — center Y
//   0x10: unknow1 (u32)
//   0x14: reverse_data (u32) — rotation
//   0x18..0x33: unknowns

export function parseNRel(buf: Uint8Array): RelSection[] {
  const v = dv(buf);
  const size = buf.byteLength;

  // Last 16 bytes: first dword at (size-16) is a pointer to the header table
  const tablePtr = v.getUint32(size - 16, true);

  // At tablePtr: 5 dwords → [unused, unused, section_count, unused, section_data_offset]
  const sectionCount      = v.getUint32(tablePtr + 8,  true);
  const sectionDataOffset = v.getUint32(tablePtr + 16, true);

  const sections: RelSection[] = [];
  const SECTION_SIZE = 0x34; // 52 bytes

  for (let i = 0; i < sectionCount; i++) {
    const off = sectionDataOffset + i * SECTION_SIZE;
    if (off + SECTION_SIZE > size) break;

    const id       = v.getUint32(off,       true);
    const dx       = v.getFloat32(off + 4,  true);
    // dz at off+8 = height, skip for 2D
    const dy       = v.getFloat32(off + 12, true);
    const rotation = v.getUint32(off + 20,  true);

    if (id < 25566) {
      sections.push({ id, cx: dx, cy: dy, rotation });
    }
  }

  return sections;
}

// ─── c.rel parser ───────────────────────────────────────────────────────────
// Block group table at file[file[filesize-16]]:
//   entries every 0x18 bytes, each starts with a u32 block_offset (0=end)
//
// Each geometry block at block_offset:
//   [0x00]: u32 unknown
//   [0x04]: u32 vertex_table_abs_offset
//   [0x08]: u32 face_count
//   [0x0C]: u32 face_table_abs_offset
// Vertex table: (face_table_offset - vertex_table_offset) / 12 vertices of [f32 X, f32 Y, f32 Z]
// Face table:   face_count × 36 bytes each → first 8 bytes = [u16 v0, u16 v1, u16 v2, u16 flags]

export function parseCRel(buf: Uint8Array): RelTriangle[] {
  const v = dv(buf);
  const size = buf.byteLength;

  // Two-level indirection to find the block group table
  const ptr1       = v.getUint32(size - 16, true);
  if (ptr1 + 4 > size) return [];
  const groupTable = v.getUint32(ptr1, true);
  if (groupTable + 4 > size) return [];

  const triangles: RelTriangle[] = [];
  const ENTRY_STRIDE = 0x18; // 24 bytes between block group entries
  const FACE_STRIDE  = 36;   // each face record is 8 used + 28 skipped bytes

  let tab = groupTable;

  while (tab + 4 <= size) {
    const blockOffset = v.getUint32(tab, true);
    if (blockOffset === 0) break;

    tab += ENTRY_STRIDE;

    if (blockOffset + 16 > size) continue;

    const vertexOffset = v.getUint32(blockOffset + 4, true);
    const faceCount    = v.getUint32(blockOffset + 8, true);
    const faceOffset   = v.getUint32(blockOffset + 12, true);

    if (faceCount === 0 || faceCount > 100000) continue;
    if (vertexOffset >= size || faceOffset >= size) continue;

    const vertexCount = (faceOffset - vertexOffset) / 12;

    for (let f = 0; f < faceCount; f++) {
      const fBase = faceOffset + f * FACE_STRIDE;
      if (fBase + 8 > size) break;

      const i0    = v.getUint16(fBase,     true);
      const i1    = v.getUint16(fBase + 2, true);
      const i2    = v.getUint16(fBase + 4, true);
      const flags = v.getUint16(fBase + 6, true);

      if (i0 >= vertexCount || i1 >= vertexCount || i2 >= vertexCount) continue;

      const v0 = vertexOffset + i0 * 12;
      const v1 = vertexOffset + i1 * 12;
      const v2 = vertexOffset + i2 * 12;

      triangles.push({
        x0: v.getFloat32(v0,      true),
        y0: v.getFloat32(v0 + 4,  true),
        z0: v.getFloat32(v0 + 8,  true),
        x1: v.getFloat32(v1,      true),
        y1: v.getFloat32(v1 + 4,  true),
        z1: v.getFloat32(v1 + 8,  true),
        x2: v.getFloat32(v2,      true),
        y2: v.getFloat32(v2 + 4,  true),
        z2: v.getFloat32(v2 + 8,  true),
        flags,
      });
    }
  }

  return triangles;
}

// ─── Coordinate transform ────────────────────────────────────────────────────

/**
 * Convert a monster/object's section-local position to absolute world position.
 * Matches Delphi SectionToMouseX/Y() formula.
 *
 * posX = monster.posX, posY = monster.posY (the horizontal "depth" component)
 */
export function toWorldPos(
  posX: number,
  posY: number,
  sectionId: number,
  sections: RelSection[],
): [number, number] {
  const sec = sections.find(s => s.id === sectionId);
  if (!sec) return [posX, posY];

  const angle = -sec.rotation / 10430.37835;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);

  return [
    cos * posX - sin * posY + sec.cx,
    sin * posX + cos * posY + sec.cy,
  ];
}

/**
 * Inverse of toWorldPos: convert absolute world position back to section-local
 * coordinates for a given section. Returns the section used.
 */
export function fromWorldPos(
  wx: number,
  wy: number,
  sec: RelSection,
): { posX: number; posY: number } {
  const angle = -sec.rotation / 10430.37835;
  const dx = wx - sec.cx;
  const dy = wy - sec.cy;
  return {
    posX:  Math.cos(angle) * dx + Math.sin(angle) * dy,
    posY: -Math.sin(angle) * dx + Math.cos(angle) * dy,
  };
}

/** Return the section whose centre is closest to the given world-space point. */
export function findNearestSection(
  wx: number,
  wy: number,
  sections: RelSection[],
): RelSection | null {
  if (sections.length === 0) return null;
  let best = sections[0];
  let bestDist = (wx - best.cx) ** 2 + (wy - best.cy) ** 2;
  for (let i = 1; i < sections.length; i++) {
    const s = sections[i];
    const d = (wx - s.cx) ** 2 + (wy - s.cy) ** 2;
    if (d < bestDist) { bestDist = d; best = s; }
  }
  return best;
}

/**
 * Convert a world-space direction vector (dx, dy) to a BAM rotation value,
 * expressed in the local frame of the given section.
 * PSO BAM convention: 0 = facing south (+posY / +depth), increases CW viewed from above.
 * BAM: 0x10000 (65536) = full circle; stored as u32 but values stay ≤ 65535.
 */
export function worldDirToBAM(dx: number, dy: number, sec: RelSection): number {
  // atan2(x, z) gives PSO convention: 0 for (0,1)=south, π/2 for (1,0)=east
  const worldAngle = Math.atan2(dx, dy);
  const localAngle = worldAngle - sec.rotation / 10430.37835;
  return ((Math.round(localAngle * 10430.37835) % 65536) + 65536) % 65536;
}

/**
 * Inverse of worldDirToBAM: convert a BAM value to a unit direction vector
 * in world space (suitable for drawing arrows on the 2D canvas).
 * Returns [worldDirX, worldDirY] where +Y is the depth / screen-down direction.
 */
export function bamToWorldDir(bam: number, sec: RelSection): [number, number] {
  const b = bam * 2 * Math.PI / 65536;
  // In local section space, BAM 0 = south = +posY, so facing = [sin(b), cos(b)]
  const localDirX = Math.sin(b);
  const localDirY = Math.cos(b);
  const a = -sec.rotation / 10430.37835;
  return [
    Math.cos(a) * localDirX - Math.sin(a) * localDirY,
    Math.sin(a) * localDirX + Math.cos(a) * localDirY,
  ];
}

/**
 * Sample the floor height (Y coordinate) at world position (wx, wy) by testing
 * floor triangles (flags & 1) using barycentric coordinates in the XZ plane.
 * Returns null when no floor triangle contains the point.
 */
export function sampleFloorHeight(wx: number, wy: number, triangles: RelTriangle[]): number | null {
  for (const tri of triangles) {
    if (!(tri.flags & 1)) continue;
    const ax = tri.x0, az = tri.z0, ay = tri.y0;
    const bx = tri.x1, bz = tri.z1, by = tri.y1;
    const cx = tri.x2, cz = tri.z2, cy = tri.y2;
    const v0x = bx - ax, v0z = bz - az;
    const v1x = cx - ax, v1z = cz - az;
    const v2x = wx - ax, v2z = wy - az;
    const d00 = v0x * v0x + v0z * v0z;
    const d01 = v0x * v1x + v0z * v1z;
    const d11 = v1x * v1x + v1z * v1z;
    const d02 = v0x * v2x + v0z * v2z;
    const d12 = v1x * v2x + v1z * v2z;
    const denom = d00 * d11 - d01 * d01;
    if (Math.abs(denom) < 1e-10) continue;
    const inv = 1 / denom;
    const u = (d11 * d02 - d01 * d12) * inv;
    const v = (d00 * d12 - d01 * d02) * inv;
    if (u >= 0 && v >= 0 && u + v <= 1) {
      return ay + u * (by - ay) + v * (cy - ay);
    }
  }
  return null;
}
