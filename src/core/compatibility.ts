/**
 * Quest compatibility checker.
 *
 * Validates a loaded quest against each PSO game version:
 *   0 = DC V1          (Dreamcast V1, ASCII format)
 *   1 = DC V2 & PC     (Dreamcast V2 / PC, Unicode format — same opcode set)
 *   2 = GC             (GameCube Ep1&2)
 *   3 = BB             (Blue Burst)
 *
 * Ported from TestCompatibility() in main.pas and FCompat.pas.
 * Uses walkOpcodes() from disasm.ts to guarantee byte-exact navigation.
 */

import { loadAsmTable, walkOpcodes } from './formats/disasm';
import type { AsmEntry, WalkedOp } from './formats/disasm';
import { EP_OFFSET } from './map/areaData';
import { FLOOR_VERSION_DATA } from './map/floorVersionData';
import { BinVersion } from './model/types';
import type { Quest } from './model/types';

// ─── Public API ────────────────────────────────────────────────────────────

export const VERSION_NAMES = ['DC V1', 'DC V2 & PC', 'GC', 'BB'] as const;
export type VersionIndex = 0 | 1 | 2 | 3;

export interface CompatIssue {
  severity: 'error' | 'warning';
  message: string;
}

export interface CompatResult {
  version: (typeof VERSION_NAMES)[number];
  issues: CompatIssue[];
}

/** Run all 4 versions in parallel and return results. */
export async function checkAllVersions(quest: Quest): Promise<CompatResult[]> {
  const [ops, table] = await Promise.all([walkOpcodes(quest.bin), loadAsmTable()]);
  return ([0, 1, 2, 3] as VersionIndex[]).map(ver => ({
    version: VERSION_NAMES[ver],
    issues:  _check(quest, ver, ops, table),
  }));
}

/** Check a single version. */
export async function checkCompatibility(quest: Quest, verIdx: VersionIndex): Promise<CompatIssue[]> {
  const [ops, table] = await Promise.all([walkOpcodes(quest.bin), loadAsmTable()]);
  return _check(quest, verIdx, ops, table);
}

// ─── Arg type constants (used only for dcVariantOps lookup) ───────────────

const T_DC = 6;

// ─── Version classification ────────────────────────────────────────────────

// GC/BB-only NPC creation opcodes that emit a WARNING (not error) on DC/PC.
// The game can sometimes convert them — hence Delphi treated them as warnings.
const WARN_ONLY_GC = new Set([
  0x66, 0x6D, 0x79, 0x7C, 0x7D, 0x7F, 0x84, 0x87, 0xA8, 0xC0, 0xCD, 0xCE,
]);

// ─── Enemy vs NPC classification ──────────────────────────────────────────

// EnemyID[] from main.pas — skins that are true enemies (not NPCs)
const ENEMY_SKINS = new Set([
  68, 67, 64, 65, 128, 129, 131, 133, 163, 97, 99, 98, 96, 168, 166, 165,
  160, 162, 164, 192, 197, 193, 194, 200, 66, 132, 130, 100, 101, 161, 167,
  223, 213, 212, 215, 217, 218, 214, 222, 221, 225, 224, 216, 219, 220,
  202, 201, 203, 204, 273, 277, 276, 272, 278, 274, 275, 281, 249,
]);

// ─── Default NPC function labels ──────────────────────────────────────────
// These are built into the game engine and need not appear in the quest script.
// From DefaultLabel/DefaultLabel2 in FCompat.pas.

const DEF_EP1_BASE = new Set([720, 660, 620, 600, 501, 520, 560, 540, 580, 680]);
const DEF_EP1_BB   = new Set([...DEF_EP1_BASE, 950, 900, 930, 920, 910, 960, 970, 940, 980]);

const DEF_EP24_BASE = new Set([100, 90, 120, 130, 80, 70, 60, 140, 110, 30, 50, 1, 20]);
const DEF_EP24_BB   = new Set([...DEF_EP24_BASE, 850, 800, 830, 820, 810, 860, 870, 840, 880]);

// ─── Core checker ─────────────────────────────────────────────────────────

function _check(
  quest:  Quest,
  verIdx: VersionIndex,
  ops:    WalkedOp[],
  table:  AsmEntry[],
): CompatIssue[] {
  const issues: CompatIssue[] = [];
  const err  = (msg: string) => issues.push({ severity: 'error',   message: msg });
  const warn = (msg: string) => issues.push({ severity: 'warning', message: msg });

  const { bin, floors, embeddedFiles, episode } = quest;
  const isDC = bin.version === BinVersion.DC;

  // Opcodes that have a DC-specific variant with different parameter order.
  // When a non-DC quest is checked for DC V1 compatibility and such an opcode
  // appears, its parameters are in the wrong order for DC V1.
  const dcVariantOps = new Set(table.filter(e => e.order === T_DC).map(e => e.fnc));

  // 1. Entry point (label 0) must exist
  if (bin.functionRefs.length === 0) {
    err('Label 0 is missing — quest has no entry point.');
  }

  // 2. Bytecode version scan (walkOpcodes handles T_PUSH/T_ARGS grouping, data
  //    blocks, and string encoding — arg_push* opcodes do not appear in `ops`)
  for (const { op, entry, lineNo } of ops) {
    // set_episode: episode 4 is not supported before BB
    if (op === 0xF8BC) {
      if (episode === 4 && verIdx < 3) {
        err(`Episode 4 is not supported on ${VERSION_NAMES[verIdx]}.`);
      }
      continue;
    }

    if (WARN_ONLY_GC.has(op)) {
      if (verIdx < 2 && entry.order !== T_DC) {
        warn(`Opcode may not work on this version "${entry.name}" at line ${lineNo}`);
      }
    } else if (entry.ver > verIdx) {
      err(`Opcode not supported "${entry.name}" at line ${lineNo}`);
    } else if (verIdx < 2 && !isDC && (dcVariantOps.has(op) || entry.dcSwap)) {
      err(`Parameter swap not allowed on this version "${entry.name}" at line ${lineNo}`);
    }
  }

  // 3. Per-floor checks
  const defaultLabels = episode === 1
    ? (verIdx === 3 ? DEF_EP1_BB : DEF_EP1_BASE)
    : (verIdx === 3 ? DEF_EP24_BB : DEF_EP24_BASE);

  for (const floor of floors) {
    const absAreaId = floor.id + EP_OFFSET[episode];
    const vdata     = FLOOR_VERSION_DATA[absAreaId];

    for (let i = 0; i < floor.monsters.length; i++) {
      const mon     = floor.monsters[i];
      const isEnemy = ENEMY_SKINS.has(mon.skin);

      if (mon.skin === 51 && verIdx < 2) {
        warn(`Floor ${floor.id} monster[${i}]: NPC (skin 51) requires GC or later.`);
      }

      if (!isEnemy) {
        const label = Math.round(mon.action);
        if (label > 0 && !defaultLabels.has(label) && label >= bin.functionRefs.length) {
          warn(`Floor ${floor.id} NPC[${i}]: action label ${label} is not defined in the script.`);
        }
      }

      if (vdata) {
        const valid = vdata.monsByVer[verIdx];
        if (valid.length > 0 && !valid.includes(mon.skin)) {
          warn(`Floor ${floor.id} monster[${i}]: skin ${mon.skin} is not valid in this area for ${VERSION_NAMES[verIdx]}.`);
        }
      }
    }

    for (let i = 0; i < floor.objects.length; i++) {
      const obj = floor.objects[i];
      if (obj.skin === 10000 || obj.skin === 11000) continue;
      if (vdata) {
        const valid = vdata.objsByVer[verIdx];
        if (valid.length > 0 && !valid.includes(obj.skin)) {
          warn(`Floor ${floor.id} object[${i}]: skin ${obj.skin} is not valid in this area for ${VERSION_NAMES[verIdx]}.`);
        }
      }
    }

    if (floor.monsters.length > 400)
      warn(`Floor ${floor.id} has ${floor.monsters.length} monsters (maximum is 400).`);
    if (floor.objects.length > 400)
      warn(`Floor ${floor.id} has ${floor.objects.length} objects (maximum is 400).`);
  }

  // 4. Embedded file checks
  const hasBin = embeddedFiles.some(f => f.name.toLowerCase().endsWith('.bin'));
  const hasDat = embeddedFiles.some(f => f.name.toLowerCase().endsWith('.dat'));
  const hasPvr = embeddedFiles.some(f => f.name.toLowerCase().endsWith('.pvr'));

  if (!hasBin) err('Quest is missing a .bin (bytecode) file.');
  if (!hasDat) warn('Quest is missing a .dat (entity placement) file.');
  if (verIdx >= 2 && hasPvr)
    err('GC/BB quests must not contain .pvr texture files.');

  return issues;
}
