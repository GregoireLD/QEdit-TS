/**
 * One-shot script: adds a "placement" field to every entry in objects.json.
 * Placement is derived from OBJECT_SCHEMAS (same rules as the old isRadiusPlacement):
 *   "radius"   — scaleX label contains "radius" AND rotY is not "Rotation Y"
 *   "rotation" — has rotY labeled as "Rotation Y" (or any label containing "rotation")
 *   "none"     — neither (scenery, items, etc.)
 *
 * Warp skins (0x002 / 0x1F5 / 0x2B9) have no schema entry; hard-coded "radius".
 *
 * Run once, then commit the updated objects.json:
 *   npx tsx tools/stamp_placements.ts
 */
import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));

// Import the TypeScript schema at runtime via tsx
const { OBJECT_SCHEMAS } = await import('../src/core/map/entitySchemas.ts');

type Placement = 'rotation' | 'radius' | 'none';

const WARP_SKINS = new Set([0x002, 0x1F5, 0x2B9]);

function determinePlacement(skin: number): Placement {
  if (WARP_SKINS.has(skin)) return 'radius';
  const schema = OBJECT_SCHEMAS.get(skin);
  if (!schema) return 'none';
  const scaleXDesc = schema.find(d => d.key === 'scaleX');
  const hasRadius = !!scaleXDesc && scaleXDesc.label.toLowerCase().includes('radius');
  const rotYDesc = schema.find(d => d.key === 'rotY');
  const hasRotation = !!rotYDesc && rotYDesc.label.toLowerCase().includes('rotation');
  if (hasRadius && !hasRotation) return 'radius';
  if (hasRotation) return 'rotation';
  return 'none';
}

const objectsPath = resolve(__dir, '../src/core/data/objects.json');
const raw = JSON.parse(readFileSync(objectsPath, 'utf-8')) as Array<Record<string, unknown>>;

let changed = 0;
const updated = raw.map(entry => {
  const skin = entry['skin'] as number;
  const placement = determinePlacement(skin);
  if (entry['placement'] !== placement) changed++;
  return { ...entry, placement };
});

writeFileSync(objectsPath, JSON.stringify(updated, null, 2) + '\n');
console.log(`Stamped ${updated.length} entries (${changed} changed). Written to objects.json`);

// Print a summary of placement distribution
const counts: Record<Placement, number> = { rotation: 0, radius: 0, none: 0 };
for (const e of updated) counts[e['placement'] as Placement]++;
console.log(`  rotation: ${counts.rotation}  radius: ${counts.radius}  none: ${counts.none}`);
