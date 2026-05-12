/**
 * Async helper: load c.rel + n.rel for every included floor and run placement checks.
 * Used by the compat checker, save-as dialog, and direct-save confirmation.
 */

import type { Quest } from './model/types';
import type { PlacementWarning } from './placement';
import { checkEntityPlacement } from './placement';
import { EP_OFFSET, AREA_BY_ID } from './map/areaData';
import { toNRelName } from './map/mapFileNames';
import { parseCRel, parseNRel } from './formats/rel';
import { readFile } from '../platform/fs';

export async function loadAllPlacementWarnings(quest: Quest, dataDir: string): Promise<PlacementWarning[]> {
  const sep = dataDir.includes('/') ? '/' : '\\';
  const perFloor = await Promise.all(quest.floors.map(async (floor): Promise<PlacementWarning[]> => {
    const absAreaId  = floor.id + EP_OFFSET[quest.episode ?? 1];
    const areaDef    = AREA_BY_ID[absAreaId];
    if (!areaDef) return [];
    const variantIdx = quest.variantByArea[absAreaId] ?? 0;
    const cRelFile   = areaDef.variants[variantIdx]?.file ?? areaDef.variants[0]?.file;
    if (!cRelFile) return [];
    try {
      const [cBuf, nBuf] = await Promise.all([
        readFile(`${dataDir}${sep}map${sep}${cRelFile}`),
        readFile(`${dataDir}${sep}map${sep}${toNRelName(cRelFile)}`),
      ]);
      return checkEntityPlacement(floor, parseCRel(cBuf), parseNRel(nBuf));
    } catch {
      return [];
    }
  }));
  return perFloor.flat();
}
