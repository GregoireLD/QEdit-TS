/**
 * Placement validity checks for monsters/NPCs.
 *
 * Three non-blocking warning kinds, aligned with Delphi + Phantasmal World
 * behaviour (neither tool blocks or rejects bad positions):
 *
 *   out-of-world  — no collision geometry at all under the entity's XZ position.
 *   on-wall       — geometry exists but no walkable surface (floor/transition);
 *                   the entity is against a wall or other non-walkable face.
 *   non-grounded  — walkable floor exists, but the entity's actual height
 *                   (posZ + section.cz) differs from the sampled floor by more
 *                   than NONGROUNDED_TOLERANCE units (floating or underground).
 *
 * These checks apply to monsters/NPCs only (objects may intentionally float,
 * be underground, etc.).  Results are purely informational.
 */

import type { Floor, Monster } from './model/types';
import { toWorldPos, sampleFloorHeight, sampleAnyHeight } from './formats/rel';
import type { RelTriangle, RelSection } from './formats/rel';

// ─── Public types ──────────────────────────────────────────────────────────

export type PlacementKind = 'out-of-world' | 'on-wall' | 'non-grounded';

export interface PlacementWarning {
  /** Relative floor ID (from floor.id in the .dat) */
  floorId: number;
  /** Index into floor.monsters */
  index: number;
  kind:  PlacementKind;
  /** Entity posZ in section-local coordinates */
  posZ:   number;
  /** Sampled floor world-Y (null for out-of-world / on-wall) */
  floorZ: number | null;
}

// ─── Constants ─────────────────────────────────────────────────────────────

/**
 * Maximum allowed difference (in world units) between an entity's world-Y
 * height and the sampled floor height before flagging as non-grounded.
 * Intentionally generous to avoid false positives on flying/boss monsters.
 */
export const NONGROUNDED_TOLERANCE = 10.0;

// ─── Message formatting ────────────────────────────────────────────────────

export function formatPlacementWarning(w: PlacementWarning): string {
  const prefix = `Floor ${w.floorId} monster[${w.index}]`;
  if (w.kind === 'out-of-world') return `${prefix}: no collision geometry at this position (out of world)`;
  if (w.kind === 'on-wall')      return `${prefix}: positioned over a non-walkable surface (wall / no floor)`;
  const delta = w.floorZ !== null ? ` — posZ ${w.posZ.toFixed(1)}, floor at ${w.floorZ.toFixed(1)}` : '';
  return `${prefix}: not grounded${delta}`;
}

// ─── Core check ────────────────────────────────────────────────────────────

/**
 * Check placement validity for all monsters on a floor against the floor's
 * collision geometry.  Returns one warning per problematic monster at most.
 *
 * Call this only when collision data for the floor is loaded — the check is
 * meaningless without triangles.
 */
export function checkEntityPlacement(
  floor:     Floor,
  triangles: RelTriangle[],
  sections:  RelSection[],
): PlacementWarning[] {
  const warnings: PlacementWarning[] = [];

  floor.monsters.forEach((m: Monster, i: number) => {
    const [wx, wy] = toWorldPos(m.posX, m.posY, m.mapSection, sections);

    const anyH   = sampleAnyHeight(wx, wy, triangles);
    const floorH = sampleFloorHeight(wx, wy, triangles);

    if (anyH === null) {
      warnings.push({ floorId: floor.id, index: i, kind: 'out-of-world', posZ: m.posZ, floorZ: null });
    } else if (floorH === null) {
      warnings.push({ floorId: floor.id, index: i, kind: 'on-wall', posZ: m.posZ, floorZ: null });
    } else {
      const sec    = sections.find(s => s.id === m.mapSection);
      const worldY = m.posZ + (sec?.cz ?? 0);
      if (Math.abs(worldY - floorH) > NONGROUNDED_TOLERANCE) {
        warnings.push({ floorId: floor.id, index: i, kind: 'non-grounded', posZ: m.posZ, floorZ: floorH });
      }
    }
  });

  return warnings;
}
