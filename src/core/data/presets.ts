/**
 * Entity presets loaded from the external JSON files generated from the
 * original Delphi monsters.txt / Objs.txt.
 *
 * To update presets, re-run the converter script:
 *   python3 tools/convert_presets.py
 */
import type { Monster, QuestObject } from '../model/types';
import monstersRaw   from './monsters.json';
import objectsRaw    from './objects.json';
import objectMetaRaw from './objects-meta.json';

export type PlacementType = 'rotation' | 'radius' | 'none';

// JSON entries are flat: all Monster/QuestObject fields at the top level + name.
export type MonsterPreset = { name: string } & Monster;
export type ObjectPreset  = { name: string } & QuestObject;

export const MONSTER_PRESETS: MonsterPreset[] = monstersRaw as unknown as MonsterPreset[];
export const OBJECT_PRESETS:  ObjectPreset[]  = objectsRaw  as unknown as ObjectPreset[];

// Skin → placement lookup, derived from per-skin object metadata.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const SKIN_PLACEMENT = new Map<number, PlacementType>(
  Object.entries(objectMetaRaw)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .filter(([, e]) => (e as any).placement)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map(([k, e]) => [Number(k), (e as any).placement as PlacementType])
);

/** True when this object's drag gesture should set scaleX (radius) rather than rotY. */
export function isRadiusPlacement(skin: number): boolean {
  return SKIN_PLACEMENT.get(skin) === 'radius';
}

/** Full placement type for a skin — used to decide drag-gesture behaviour. */
export function getPlacementType(skin: number): PlacementType {
  return SKIN_PLACEMENT.get(skin) ?? 'rotation';
}

/** Zero-value Monster, used as the base for new entities before applying a preset. */
export const EMPTY_MONSTER: Monster = {
  skin: 68, unknown1: 0, unknown2: 0, unknown3: 0, unknown4: 0,
  mapSection: 0, unknown5: 0, unknown6: 0,
  posX: 0, posZ: 0, posY: 0,
  unknown7: 0, direction: 0, unknown8: 0,
  movementData: 0, unknown10: 0, unknown11: 0,
  charId: 0, action: 0, movementFlag: 0, unknownFlag: 0,
};

export const EMPTY_OBJECT: QuestObject = {
  skin: 0, unknown1: 0, unknown2: 0,
  id: 0, group: 0, mapSection: 0, unknown4: 0,
  posX: 0, posZ: 0, posY: 0,
  rotX: 0, rotY: 0, rotZ: 0,
  scaleX: 0, scaleY: 1, scaleZ: 1,
  objId: 0, action: 0, unknown13: 0, unknown14: 0,
};
