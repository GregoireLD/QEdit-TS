/**
 * PSO quest bytecode disassembler.
 *
 * Ported from QuestDisam() in Unit1.pas.
 * Converts the raw bytecode section of a .bin file into human-readable
 * PSO assembly text, ready for display in Monaco Editor.
 *
 * Arg type encoding (from TCom.pas / main.pas m.Add order):
 *  0  T_NONE     1  T_IMED     2  T_ARGS     3  T_PUSH
 *  4  T_VASTART  5  T_VAEND   6  T_DC       7  T_REG
 *  8  T_BYTE     9  T_WORD    10 T_DWORD    11 T_FLOAT
 * 12  T_STR     13 T_RREG    14 T_FUNC     15 T_FUNC2
 * 16 T_SWITCH   17 T_SWITCH2B 18 T_PFLAG   19 T_STRDATA
 * 20  T_DATA    21 T_BREG    22 T_DREG
 */

import type { QuestBin, DataBlock } from '../model/types';
import { BinVersion } from '../model/types';

// ─── Argument type constants (must match m.Add() order in main.pas) ────────

const T_NONE     = 0;
const T_ARGS     = 2;   // opcode reads its args from the push-stack
const T_PUSH     = 3;   // opcode pushes one arg onto the push-stack
const T_DC       = 6;
const T_REG      = 7;
const T_BYTE     = 8;
const T_WORD     = 9;
const T_DWORD    = 10;
const T_FLOAT    = 11;
const T_STR      = 12;
// const T_RREG     = 13;
const T_FUNC     = 14;
const T_FUNC2    = 15;
const T_SWITCH   = 16;
const T_SWITCH2B = 17;
const T_PFLAG    = 18;
const T_STRDATA  = 19;
const T_DATA     = 20;
const T_BREG     = 21;
const T_DREG     = 22;

// ─── Opcode descriptor ─────────────────────────────────────────────────────

export interface AsmEntry {
  fnc:   number;      // opcode ID (u16)
  name:  string;      // mnemonic
  order: number;      // argument order type (T_IMED / T_ARGS / T_NONE / …)
  ver:   number;      // 0=DC, 1=V2, 2=V3, 3=V4
  args:  number[];    // arg types, terminated by T_NONE
}

// ─── Parse Asm.txt lines into AsmEntry array ───────────────────────────────

const ARG_NAMES: Record<string, number> = {
  T_NONE: 0, T_IMED: 1, T_ARGS: 2, T_PUSH: 3,
  T_VASTART: 4, T_VAEND: 5, T_DC: 6,
  T_REG: 7, T_BYTE: 8, T_WORD: 9, T_DWORD: 10,
  T_FLOAT: 11, T_STR: 12, T_RREG: 13,
  T_FUNC: 14, T_FUNC2: 15,
  T_SWITCH: 16, T_SWITCH2B: 17, T_PFLAG: 18,
  T_STRDATA: 19, T_DATA: 20, T_BREG: 21, T_DREG: 22,
};

let _table: AsmEntry[] | null = null;

export async function loadAsmTable(): Promise<AsmEntry[]> {
  if (_table) return _table;

  // Fetch the bundled Asm.txt from public assets (relative path works from any subfolder)
  const res = await fetch('./Asm.txt');
  const text = await res.text();
  const entries: AsmEntry[] = [];
  const seen = new Set<string>();

  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line.startsWith('{') || !line.includes('}')) continue;

    // Strip braces and split by comma+space or comma
    const inner = line.slice(1, line.indexOf('}')).replace(/,\s*/g, ',');
    const parts = inner.split(',');
    if (parts.length < 3) continue;

    const fnc   = parseInt(parts[0], 16);
    const name  = parts[1].replace(/"/g, '').trim();
    const order = ARG_NAMES[parts[2]] ?? T_NONE;

    // Collect arg types until T_NONE or a version tag
    const args: number[] = [];
    let ver = 0;
    for (let i = 3; i < parts.length; i++) {
      const p = parts[i].trim();
      if (p === 'T_V2') { ver = 1; break; }
      if (p === 'T_V3') { ver = 2; break; }
      if (p === 'T_V4') { ver = 3; break; }
      const t = ARG_NAMES[p];
      if (t === undefined || t === T_NONE) break;
      args.push(t);
    }

    // Deduplicate names (same as Delphi: append hex index for dupes)
    let finalName = name;
    if (seen.has(name)) {
      finalName = name + entries.length.toString(16).padStart(2, '0').toUpperCase();
    }
    seen.add(name);

    entries.push({ fnc, name: finalName, order, ver, args });
  }

  _table = entries;
  return entries;
}

// ─── Lookup: find best matching entry for a given opcode ID ───────────────

function findEntry(table: AsmEntry[], opcode: number, isDC: boolean): AsmEntry | null {
  // Prefer non-DC entries unless we are in DC mode
  let best: AsmEntry | null = null;
  for (const e of table) {
    if (e.fnc !== opcode) continue;
    if (e.order === T_DC && !isDC) continue;
    if (e.order === T_DC && isDC) return e; // exact match
    best = e;
  }
  return best;
}

// ─── Read helpers ──────────────────────────────────────────────────────────

function readU8(code: Uint8Array, x: number): number {
  return code[x];
}
function readU16(code: Uint8Array, x: number): number {
  return code[x] | (code[x + 1] << 8);
}
function readU32(code: Uint8Array, x: number): number {
  return (code[x] | (code[x + 1] << 8) | (code[x + 2] << 16) | (code[x + 3] << 24)) >>> 0;
}
function readF32(code: Uint8Array, x: number): number {
  const buf = new ArrayBuffer(4);
  new Uint8Array(buf).set(code.slice(x, x + 4));
  return new DataView(buf).getFloat32(0, true);
}

function hex8(n: number):  string { return n.toString(16).toUpperCase().padStart(8, '0'); }
function hex2(n: number):  string { return n.toString(16).toUpperCase().padStart(2, '0'); }

// ─── Read a null-terminated string (UTF-16LE or ASCII) from bytecode ──────

function readString(code: Uint8Array, x: number, isDC: boolean): { text: string; advance: number } {
  const start = x;
  let text = '';
  if (!isDC) {
    // UTF-16LE: 2 bytes per char, terminated by 00 00
    while (x + 1 < code.length && (code[x] !== 0 || code[x + 1] !== 0)) {
      const cp = code[x] | (code[x + 1] << 8);
      text += cp === 0x000A ? '<cr>'
            : cp <  0x0020  ? `\\x${cp.toString(16).padStart(2, '0')}`
            : String.fromCharCode(cp);
      x += 2;
    }
    x += 2; // null terminator
  } else {
    // ASCII: 1 byte per char, terminated by 00
    while (x < code.length && code[x] !== 0) {
      const b = code[x];
      text += b === 0x0A ? '<cr>'
            : b <  0x20  ? `\\x${b.toString(16).padStart(2, '0')}`
            : String.fromCharCode(b);
      x++;
    }
    x++; // null terminator
  }
  return { text, advance: x - start };
}

// ─── Push-stack support ────────────────────────────────────────────────────

interface StackEntry {
  argType: number;   // T_REG / T_DWORD / T_WORD / T_BREG / T_FUNC / T_STR …
  value:   number;   // numeric payload (uint32 / register index / label)
  str:     string;   // string payload (only for T_STR)
}

function formatStackArg(se: StackEntry, expectedType: number): string {
  if (se.argType === T_STR) return `'${se.str}'`;
  if (expectedType === T_FLOAT) {
    const buf = new ArrayBuffer(4);
    new DataView(buf).setUint32(0, se.value >>> 0, true);
    return new DataView(buf).getFloat32(0, true).toFixed(6);
  }
  if (expectedType === T_FUNC || expectedType === T_FUNC2) return `${se.value}`;
  if (se.argType === T_REG || se.argType === T_BREG || se.argType === T_DREG || se.argType === 13) {
    return `R${se.value}`;
  }
  return hex8(se.value >>> 0);
}

// ─── Main disassembly ──────────────────────────────────────────────────────

export interface DisasmLine {
  label?: number;
  text: string;
}

export interface DisasmResult {
  text: string;
  /** Parallel to `text.split('\n')`: bytecode offset for instruction/data lines, -1 for labels/blanks. */
  lineOffsets: number[];
}

export async function disassemble(bin: QuestBin): Promise<DisasmResult> {
  const table  = await loadAsmTable();
  const code   = bin.bytecode;
  const isDC   = bin.version === BinVersion.DC;
  const refs   = bin.functionRefs;        // label offsets relative to bytecode start
  const blocks = bin.dataBlocks;          // STR/HEX annotations

  // Build a set of label positions for quick lookup
  const labelSet = new Set<number>(refs);

  // Build a map from bytecode offset → DataBlock
  const blockMap = new Map<number, DataBlock>();
  for (const b of blocks) blockMap.set(b.offset, b);

  const lines: string[] = [];
  const offsets: number[] = [];     // parallel to lines: bytecode offset, or -1
  const stack: StackEntry[] = [];   // push-stack for T_ARGS collapsing
  let isV3 = !isDC;                 // mirrors Delphi's AsmMode: flips true on first T_PUSH
  let x = 0;

  while (x < code.length) {
    // Emit label(s) if this offset is a function entry point.
    // Iterate the full refs array so that multiple indices pointing to the
    // same offset are all emitted (refs.indexOf would only find the first).
    if (labelSet.has(x)) {
      if (lines.length > 0) { lines.push(''); offsets.push(-1); }
      for (let li = 0; li < refs.length; li++) {
        if (refs[li] === x) { lines.push(`${li}:`); offsets.push(x); }
      }
    }

    // Check for a data block annotation at this position
    const block = blockMap.get(x);
    if (block) {
      const blockStart = x;
      // Find the length of this block (next block start or code end)
      const nextOffsets = [...blockMap.keys(), code.length].filter(o => o > x).sort((a, b) => a - b);
      const blockLen = nextOffsets[0] - x;

      if (block.type === 1) {
        // T_STRDATA: null-terminated UTF-16LE or ASCII string
        const { text } = readString(code, x, isDC);
        lines.push(`\tSTR: '${text}'`); offsets.push(blockStart);
      } else {
        // T_DATA: raw hex bytes
        const bytes = Array.from(code.slice(x, x + blockLen))
          .map(b => hex2(b)).join(' ');
        lines.push(`\tHEX: ${bytes}`); offsets.push(blockStart);
      }
      x += blockLen;
      continue;
    }

    // Read opcode
    const opcodeStart = x;
    let opcode = readU8(code, x++);
    if (opcode === 0xF8 || opcode === 0xF9) {
      opcode = (opcode << 8) | readU8(code, x++);
    }

    // isDC && !isV3: still in DC mode; isDC && isV3: DC header but V3 bytecode detected
    const entry = findEntry(table, opcode, isDC && !isV3);
    if (!entry) {
      // Unknown opcode — emit as HEX comment so nothing is lost
      lines.push(`\t// unknown opcode 0x${opcode.toString(16).toUpperCase()}`); offsets.push(opcodeStart);
      break; // can't reliably continue without knowing arg sizes
    }

    // ── T_PUSH: read the one inline arg, buffer on stack, emit nothing ──────
    if (entry.order === T_PUSH) {
      isV3 = true;  // mirrors Delphi's AsmMode := 2 on first arg_push seen
      const se: StackEntry = { argType: entry.args[0] ?? T_NONE, value: 0, str: '' };
      switch (se.argType) {
        case T_REG: case 13: case T_BREG: case T_DREG:
          se.value = readU8(code, x); x++; break;
        case T_DWORD: case T_PFLAG: case T_DATA: case T_STRDATA:
          se.value = readU32(code, x); x += 4; break;
        case T_WORD:
          se.value = readU16(code, x); x += 2; break;
        case T_BYTE:
          se.value = readU8(code, x); x++; break;
        case T_FUNC: case T_FUNC2:
          se.value = readU16(code, x); x += 2; break;
        case T_STR: {
          const { text, advance } = readString(code, x, isDC);
          se.str = text; x += advance; break;
        }
      }
      stack.push(se);
      continue; // no line emitted for push opcodes
    }

    // ── T_ARGS: consume stack entries, emit one combined line ───────────────
    if (entry.order === T_ARGS && stack.length > 0) {
      const n       = entry.args.length;
      const start   = Math.max(0, stack.length - n);
      const pulled  = stack.splice(start);           // removes and returns last n items
      const argParts = pulled.map((se, i) => formatStackArg(se, entry.args[i] ?? T_NONE));
      const argStr  = argParts.length > 0 ? ' ' + argParts.join(', ') : '';
      lines.push(`\t${entry.name}${argStr}`); offsets.push(opcodeStart);
      continue;
    }

    // ── All other orders (T_IMED, T_NONE, T_DC, T_VASTART/END):
    //    read args inline as before ──────────────────────────────────────────
    const argParts: string[] = [];
    for (const argType of entry.args) {
      switch (argType) {
        case T_REG:
        case 13: // T_RREG
          argParts.push(`R${readU8(code, x)}`); x++; break;

        case T_BREG:
          argParts.push(`R${readU8(code, x)}`); x++; break;

        case T_DREG:
          argParts.push(`R${readU32(code, x)}`); x += 4; break;

        case T_BYTE:
          argParts.push(hex8(readU8(code, x))); x++; break;

        case T_WORD:
          argParts.push(hex8(readU16(code, x))); x += 2; break;

        case T_DWORD:
        case T_PFLAG:
        case T_DATA:
        case T_STRDATA:
          argParts.push(hex8(readU32(code, x))); x += 4; break;

        case T_FUNC:
        case T_FUNC2:
          argParts.push(`${readU16(code, x)}`); x += 2; break;

        case T_FLOAT: {
          const f = readF32(code, x); x += 4;
          argParts.push(f.toFixed(6));
          break;
        }

        case T_STR: {
          const { text, advance } = readString(code, x, isDC);
          argParts.push(`'${text}'`);
          x += advance;
          break;
        }

        case T_SWITCH: {
          const count = readU8(code, x++);
          const labels: string[] = [];
          for (let i = 0; i < count; i++) {
            labels.push(`${readU16(code, x)}`); x += 2;
          }
          argParts.push(`${count}:${labels.join(':')}`);
          break;
        }

        case T_SWITCH2B: {
          const count = readU8(code, x++);
          const vals: string[] = [];
          for (let i = 0; i < count; i++) {
            vals.push(`${readU8(code, x++)}`);
          }
          argParts.push(`${count}:${vals.join(':')}`);
          break;
        }

        default:
          break;
      }
    }

    const argStr = argParts.length > 0 ? ' ' + argParts.join(', ') : '';
    lines.push(`\t${entry.name}${argStr}`); offsets.push(opcodeStart);
  }

  return { text: lines.join('\n'), lineOffsets: offsets };
}
