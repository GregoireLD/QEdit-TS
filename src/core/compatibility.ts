/**
 * Quest compatibility checker.
 *
 * Validates a loaded quest against each PSO game version:
 *   0 = DC  (Dreamcast V1, ASCII format)
 *   1 = PC  (V2 / PC, Unicode format)
 *   2 = GC  (GameCube)
 *   3 = BB  (Blue Burst)
 *
 * Ported from TestCompatibility() in main.pas and FCompat.pas.
 */

import { loadAsmTable } from './formats/disasm';
import type { AsmEntry } from './formats/disasm';
import { EP_OFFSET } from './map/areaData';
import { FLOOR_VERSION_DATA } from './map/floorVersionData';
import { BinVersion } from './model/types';
import type { Quest } from './model/types';

// ─── Public API ────────────────────────────────────────────────────────────

export const VERSION_NAMES = ['DC', 'PC', 'GC', 'BB'] as const;
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
  const table = await loadAsmTable();
  return Promise.all(
    ([0, 1, 2, 3] as VersionIndex[]).map(async ver => ({
      version: VERSION_NAMES[ver],
      issues:  await _check(quest, ver, table),
    }))
  );
}

/** Check a single version. */
export async function checkCompatibility(quest: Quest, verIdx: VersionIndex): Promise<CompatIssue[]> {
  const table = await loadAsmTable();
  return _check(quest, verIdx, table);
}

// ─── Arg type constants (must match disasm.ts) ─────────────────────────────

const T_NONE      = 0;
const T_ARGS      = 2;
const T_DC        = 6;
const T_REG       = 7;
const T_BYTE      = 8;
const T_WORD      = 9;
const T_DWORD     = 10;
const T_FLOAT     = 11;
const T_STR       = 12;
const T_RREG      = 13;
const T_FUNC      = 14;
const T_FUNC2     = 15;
const T_SWITCH    = 16;
const T_SWITCH2B  = 17;
const T_PFLAG     = 18;
const T_STRDATA   = 19;
const T_DATA      = 20;
const T_BREG      = 21;
const T_DREG      = 22;

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

// ─── Bytecode arg-size helper ──────────────────────────────────────────────

function argBytes(argType: number, code: Uint8Array, at: number, isDC: boolean): number {
  switch (argType) {
    case T_REG: case T_BREG: case T_RREG: case T_BYTE: return 1;
    case T_DREG: return 4;
    case T_WORD: case T_DATA: case T_STRDATA: case T_PFLAG: return 2;
    case T_DWORD: case T_FLOAT: return 4;
    case T_FUNC: return 2;
    case T_FUNC2: return isDC ? 4 : 2;
    case T_SWITCH: {
      const n = code[at] ?? 0;
      return 1 + n * 2;
    }
    case T_SWITCH2B: {
      const n = code[at] ?? 0;
      return 1 + n;
    }
    case T_STR: {
      let n = 0;
      if (!isDC) {
        while (at + n + 1 < code.length && (code[at + n] || code[at + n + 1])) n += 2;
        return n + 2;
      } else {
        while (at + n < code.length && code[at + n]) n++;
        return n + 1;
      }
    }
    default: return 0;
  }
}

function advancePastArgs(entry: AsmEntry, code: Uint8Array, pos: number, isDC: boolean): number {
  if (entry.order === T_ARGS || entry.order === T_NONE) return pos;
  for (const arg of entry.args) {
    if (arg === T_NONE) break;
    pos += argBytes(arg, code, pos, isDC);
  }
  return pos;
}

// ─── Bytecode walker ────────────────────────────────────────────────────────

interface Hit {
  op:    number;
  entry: AsmEntry | null;
}

function* walkBytecode(code: Uint8Array, table: AsmEntry[], isDC: boolean): Generator<Hit> {
  let x = 0;
  while (x < code.length) {
    let op = code[x++] ?? 0;
    if (op === 0xF8 || op === 0xF9) op = (op << 8) | (code[x++] ?? 0);

    let entry: AsmEntry | null = null;
    for (const e of table) {
      if (e.fnc !== op) continue;
      if (e.order === T_DC && !isDC) continue;
      if (e.order === T_DC &&  isDC) { entry = e; break; }
      entry = e;
    }

    yield { op, entry };

    if (entry) x = advancePastArgs(entry, code, x, isDC);
  }
}

// ─── Core checker ─────────────────────────────────────────────────────────

async function _check(quest: Quest, verIdx: VersionIndex, table: AsmEntry[]): Promise<CompatIssue[]> {
  const issues: CompatIssue[] = [];
  const err  = (msg: string) => issues.push({ severity: 'error',   message: msg });
  const warn = (msg: string) => issues.push({ severity: 'warning', message: msg });

  const { bin, floors, embeddedFiles, episode } = quest;
  const isDC = bin.version === BinVersion.DC;

  // 1. Entry point (label 0) must exist
  if (bin.functionRefs.length === 0) {
    err('Label 0 is missing — quest has no entry point.');
  }

  // 2. Bytecode version scan
  for (const { op, entry } of walkBytecode(bin.bytecode, table, isDC)) {
    if (!entry) continue;

    // set_episode opcode: episode 4 (bytecode value 2) is GC-incompatible
    if (op === 0xF8BC) {
      if (episode === 4 && verIdx < 3) {
        err(`Episode 4 (set_episode value 2) is not supported on ${VERSION_NAMES[verIdx]}.`);
      }
      continue;
    }

    // Opcode version compatibility
    if (WARN_ONLY_GC.has(op)) {
      if (verIdx < 2 && entry.order !== T_DC) {
        warn(`Opcode ${entry.name} (0x${op.toString(16).toUpperCase()}) requires GC or later; may not work on ${VERSION_NAMES[verIdx]}.`);
      }
    } else {
      if (entry.ver > verIdx) {
        const reqVer = VERSION_NAMES[entry.ver as VersionIndex] ?? `v${entry.ver}`;
        err(`Opcode ${entry.name} (0x${op.toString(16).toUpperCase()}) requires ${reqVer}; not supported on ${VERSION_NAMES[verIdx]}.`);
      }
    }
  }

  // 3. Per-floor checks
  const defaultLabels = episode === 1
    ? (verIdx === 3 ? DEF_EP1_BB : DEF_EP1_BASE)
    : (verIdx === 3 ? DEF_EP24_BB : DEF_EP24_BASE);

  for (const floor of floors) {
    const absAreaId = floor.id + EP_OFFSET[episode];
    const vdata     = FLOOR_VERSION_DATA[absAreaId];

    // Monster checks
    for (let i = 0; i < floor.monsters.length; i++) {
      const mon    = floor.monsters[i];
      const isEnemy = ENEMY_SKINS.has(mon.skin);

      // Skin 51 = generic NPC — DC/PC don't support them
      if (mon.skin === 51 && verIdx < 2) {
        warn(`Floor ${floor.id} monster[${i}]: NPC (skin 51) requires GC or later.`);
      }

      if (!isEnemy) {
        // NPC action label must exist in the script (unless it's a default engine label)
        const label = Math.round(mon.action);
        if (label > 0 && !defaultLabels.has(label) && label >= bin.functionRefs.length) {
          warn(`Floor ${floor.id} NPC[${i}]: action label ${label} is not defined in the script.`);
        }
      }

      // Per-area version skin validation
      if (vdata) {
        const valid = vdata.monsByVer[verIdx];
        if (valid.length > 0 && !valid.includes(mon.skin)) {
          warn(`Floor ${floor.id} monster[${i}]: skin ${mon.skin} is not valid in this area for ${VERSION_NAMES[verIdx]}.`);
        }
      }
    }

    // Object checks
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

    // Count limits (400 per floor)
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
