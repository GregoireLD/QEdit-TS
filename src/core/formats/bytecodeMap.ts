/**
 * Bytecode map-setup section builder / patcher.
 *
 * The "map setup section" sits at the very start of function 0 and consists of:
 *   1. An optional set_episode opcode  (F8 BC + 4-byte arg)
 *   2. One map_designate block per active area
 *
 * Three map_designate encodings are recognised:
 *   GC/PC  leti R<a>, relFloor  +  leti R<a+2>, variant  +  C4 R<a>  (14 bytes)
 *   GC_EX  leti R<a+1>, absArea +  leti R<a+3>, variant  +  F8 0D R<a>  (15 bytes)
 *   BB     F9 51 <floor:u8> <area:u16-lo> <variant:u8> <pad:u8>        (7 bytes)
 *
 * rebuildBytecodeMapSetup strips any existing setup section and prepends a
 * freshly generated one derived from variantByArea.  The quest logic that
 * follows is preserved verbatim.
 */

import { BinVersion } from '../model/types';
import { EP_OFFSET } from '../map/areaData';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function u32LE(val: number): number[] {
  return [val & 0xFF, (val >> 8) & 0xFF, (val >> 16) & 0xFF, (val >> 24) & 0xFF];
}

// ─── Strip ────────────────────────────────────────────────────────────────────

/**
 * Returns the bytecode with the map-setup section removed, leaving only the
 * quest logic tail (starting at the first non-setup instruction).
 */
function stripMapSetup(code: Uint8Array): Uint8Array {
  let x = 0;

  // Skip set_episode  (F8 BC + 4-byte dword arg)
  if (x + 6 <= code.length && code[x] === 0xF8 && code[x + 1] === 0xBC) x += 6;

  outer: while (x < code.length) {
    // GC/PC: leti R<a>, v1  +  leti R<a+2>, v2  +  C4 R<a>
    if (x + 14 <= code.length && code[x] === 0x09 && code[x + 6] === 0x09) {
      const ra = code[x + 1];
      if (code[x + 7] === ra + 2 && code[x + 12] === 0xC4 && code[x + 13] === ra) {
        x += 14; continue outer;
      }
    }
    // GC_EX: leti R<a+1>, v1  +  leti R<a+3>, v2  +  F8 0D R<a>
    if (x + 15 <= code.length && code[x] === 0x09 && code[x + 6] === 0x09) {
      const ra1 = code[x + 1];
      if (code[x + 7] === ra1 + 2 &&
          code[x + 12] === 0xF8 && code[x + 13] === 0x0D && code[x + 14] === ra1 - 1) {
        x += 15; continue outer;
      }
    }
    // BB: F9 51 + 5-byte payload
    if (x + 7 <= code.length && code[x] === 0xF9 && code[x + 1] === 0x51) {
      x += 7; continue outer;
    }
    break;
  }

  return code.slice(x);
}

// ─── Build ────────────────────────────────────────────────────────────────────

/**
 * Generates a fresh map-setup section (set_episode + one block per area).
 * Uses GC/PC (0xC4) encoding for non-BB, BB (0xF951) for BB.
 */
function buildMapSetup(
  episode:      1 | 2 | 4,
  variantByArea: Record<number, number>,
  version:      BinVersion,
): number[] {
  const bytes: number[] = [];
  const offset = EP_OFFSET[episode];

  // set_episode for EP2/EP4
  if (episode !== 1) {
    const epIdx = episode === 2 ? 1 : 2;
    bytes.push(0xF8, 0xBC, ...u32LE(epIdx));
  }

  // Sort by absId for deterministic output
  const sorted = Object.entries(variantByArea)
    .map(([k, v]) => ({ absId: Number(k), variant: v }))
    .sort((a, b) => a.absId - b.absId);

  for (const { absId, variant } of sorted) {
    const rel = absId - offset;
    if (rel < 0 || rel > 17) continue;

    if (version === BinVersion.BB) {
      // BB_Map_Designate: F9 51 <floor:u8> <area:u8> 00 <variant:u8> 00
      bytes.push(0xF9, 0x51, rel, absId & 0xFF, 0x00, variant & 0xFF, 0x00);
    } else {
      // leti R0, rel  +  leti R2, variant  +  map_designate R0
      bytes.push(0x09, 0x00, ...u32LE(rel));
      bytes.push(0x09, 0x02, ...u32LE(variant));
      bytes.push(0xC4, 0x00);
    }
  }

  return bytes;
}

// ─── Public ───────────────────────────────────────────────────────────────────

/**
 * Strips the existing map-setup section from `existing` and prepends a freshly
 * generated one derived from `variantByArea`.  Quest logic is preserved.
 */
export function rebuildBytecodeMapSetup(
  existing:      Uint8Array,
  episode:       1 | 2 | 4,
  variantByArea: Record<number, number>,
  version:       BinVersion = BinVersion.PC,
): Uint8Array {
  const tail  = stripMapSetup(existing);
  const setup = buildMapSetup(episode, variantByArea, version);
  const out   = new Uint8Array(setup.length + tail.length);
  out.set(setup, 0);
  out.set(tail, setup.length);
  return out;
}
