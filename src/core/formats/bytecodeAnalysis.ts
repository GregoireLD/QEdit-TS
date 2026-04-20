/**
 * Lightweight bytecode analyser.
 *
 * Scans a quest .bin bytecode section to extract:
 *  1. The episode (from set_episode opcodes, or inferred from area IDs)
 *  2. The map-variant index per area ID (from map_designate / map_designate_ex /
 *     BB_Map_Designate)
 *
 * Based on QuestDisam() in Unit1.pas. Uses the same Asm.txt opcode table as
 * the disassembler for correct instruction-size calculation.
 *
 * EP_OFFSET_BY_IDX and MAP_ID tables come verbatim from Unit1.pas.
 */

import { loadAsmTable } from './disasm';
import { BinVersion } from '../model/types';
import type { QuestBin } from '../model/types';

// ─── Arg type constants (matching disasm.ts) ───────────────────────────────

const T_NONE     = 0;
const T_ARGS     = 2;
const T_REG      = 7;
const T_BYTE     = 8;
const T_WORD     = 9;
const T_DWORD    = 10;
const T_FLOAT    = 11;
const T_STR      = 12;
const T_RREG     = 13;
const T_FUNC     = 14;
const T_FUNC2    = 15;
const T_SWITCH   = 16;
const T_SWITCH2B = 17;
const T_PFLAG    = 18;
const T_STRDATA  = 19;
const T_DATA     = 20;
const T_BREG     = 21;
const T_DREG     = 22;

// ─── Tables from Unit1.pas ─────────────────────────────────────────────────

/**
 * EPMap[episodeIdx] = absolute area ID offset for that episode.
 * episodeIdx: 0=EP1, 1=EP2, 2=EP4  (as stored in bytecode by set_episode).
 */
const EP_OFFSET_BY_IDX = [0, 18, 36] as const;

// ─── Result type ───────────────────────────────────────────────────────────

export interface BinAnalysis {
  /** Detected episode (1, 2, or 4). */
  episode: 1 | 2 | 4;
  /**
   * Variant index per absolute area ID (0-45).
   * Only areas explicitly designated in the bytecode appear here.
   */
  variantByArea: Record<number, number>;
}

// ─── Scanner ───────────────────────────────────────────────────────────────

export async function analyseQuestBin(bin: QuestBin): Promise<BinAnalysis> {
  const table = await loadAsmTable();
  const code  = bin.bytecode;
  const isDC  = bin.version === BinVersion.DC;

  const regs = new Int32Array(256);
  let episodeIdx   = 0;    // 0=EP1, 1=EP2, 2=EP4  (default EP1)
  let episodeFound = false;
  const variantByArea: Record<number, number> = {};

  function u8(pos: number)  { return code[pos] ?? 0; }
  function u16(pos: number) { return (code[pos] ?? 0) | ((code[pos + 1] ?? 0) << 8); }
  function u32(pos: number) {
    return ((code[pos] ?? 0) | ((code[pos+1] ?? 0) << 8) |
            ((code[pos+2] ?? 0) << 16) | ((code[pos+3] ?? 0) << 24)) >>> 0;
  }
  function i32(pos: number) { return u32(pos) | 0; }

  /** Bytes consumed from bytecode for one arg in T_IMED mode. */
  function argSize(t: number, at: number): number {
    switch (t) {
      case T_REG: case T_BREG: case T_RREG: case T_BYTE: return 1;
      case T_DREG: return 4;
      case T_WORD: case T_DATA: case T_STRDATA: case T_PFLAG: return 2;
      case T_DWORD: case T_FLOAT: return 4;
      case T_FUNC: return 2;
      case T_FUNC2: return isDC ? 4 : 2;
      case T_SWITCH:   return 1 + (u8(at)) * 2;
      case T_SWITCH2B: return 1 + (u8(at));
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

  function recordArea(absAreaId: number, variant: number) {
    if (absAreaId < 0 || absAreaId > 45 || variant < 0) return;
    // Infer episode from area ID when set_episode hasn't appeared yet
    if (!episodeFound) {
      if      (absAreaId >= 36) episodeIdx = 2;
      else if (absAreaId >= 18) episodeIdx = 1;
    }
    variantByArea[absAreaId] = variant;
  }

  let x = 0;
  while (x < code.length) {
    // Read opcode
    let op = u8(x++);
    if (op === 0xF8 || op === 0xF9) {
      op = (op << 8) | u8(x++);
    }

    // Look up opcode in table
    let entry = null;
    for (const e of table) {
      if (e.fnc !== op) continue;
      // Prefer first matching non-DC entry (or DC entry if isDC)
      if (e.order === 6 /* T_DC */ && !isDC) continue;
      entry = e;
      break;
    }
    if (!entry) continue; // unknown opcode — treat as 1-byte no-op (like Delphi)

    // T_ARGS functions consume no inline arg bytes; skip them
    if (entry.order === T_ARGS) continue;

    // ── Process inline args ────────────────────────────────────────────

    const argStart = x; // position of first arg byte

    switch (op) {
      // ── Register-value opcodes ───────────────────────────────────────
      case 0x08: { // let R<d>, R<s>
        regs[u8(x)] = regs[u8(x + 1)];
        x += 2;
        break;
      }
      case 0x09: { // leti R<d>, <i32>
        const d = u8(x); x++;
        regs[d] = i32(x); x += 4;
        break;
      }
      case 0x0A: { // letb R<d>, <byte>
        const d = u8(x); x++;
        regs[d] = u8(x); x++;
        break;
      }
      case 0x0B: { // letw R<d>, <word>
        const d = u8(x); x++;
        regs[d] = u16(x); x += 2;
        break;
      }

      // ── Episode detection ─────────────────────────────────────────────
      case 0xF8BC: { // set_episode <dword>  (episode idx = low byte)
        episodeIdx   = u8(x); x += 4;
        episodeFound = true;
        break;
      }
      case 0xF932: { // set_episode2 R<r>
        episodeIdx   = regs[u8(x)]; x++;
        episodeFound = true;
        break;
      }

      // ── Map designation opcodes ───────────────────────────────────────
      case 0xC4: { // map_designate R<lr>
        // regs[lr]   = floor slot = area-within-episode
        // regs[lr+2] = variant index
        const lr       = u8(x); x++;
        const absArea  = regs[lr] + EP_OFFSET_BY_IDX[Math.min(episodeIdx, 2)];
        const variant  = regs[lr + 2];
        recordArea(absArea, variant);
        break;
      }
      case 0xF80D: { // map_designate_ex R<lr>
        // regs[lr+1] = absolute area ID (0-45)
        // regs[lr+3] = variant index
        const lr      = u8(x); x++;
        const absArea = regs[lr + 1];
        const variant = regs[lr + 3];
        recordArea(absArea, variant);
        break;
      }
      case 0xF951: { // BB_Map_Designate BYTE WORD BYTE BYTE
        // layout: floor(byte), areaId(word-low byte used), variant(byte), ?(byte)
        x++;                      // BYTE: floor slot (skip)
        const absArea = u8(x); x += 2;  // WORD: area ID in low byte
        const variant = u8(x); x++;     // BYTE: variant
        x++;                      // BYTE: unknown
        recordArea(absArea, variant);
        break;
      }

      default: {
        // Advance past all args using the table entry
        for (const t of entry.args) {
          if (t === T_NONE) break;
          x += argSize(t, x);
        }
        break;
      }
    }

    void argStart; // suppress unused warning
  }

  const epIdx  = Math.min(Math.max(episodeIdx, 0), 2);
  const episode = ([1, 2, 4] as const)[epIdx];

  return { episode, variantByArea };
}
