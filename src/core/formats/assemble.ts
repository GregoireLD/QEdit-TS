/**
 * PSO quest bytecode assembler.
 *
 * Converts the human-readable PSO assembly text produced by disasm.ts back
 * into binary bytecode, functionRefs, and dataBlocks.
 *
 * Supported source constructs (all produced by the disassembler):
 *   N:              label declaration (sets functionRefs[N] = current offset)
 *   \tmnemonic arg1, arg2, ...
 *       — T_ARGS opcodes: collapsed push-stack form, expanded to arg_push* + opcode
 *       — all other opcodes: inline args emitted directly
 *   \tSTR: 'text'  data block, type 1 (string)
 *   \tHEX: xx xx   data block, type 0 (raw bytes)
 *   // comment     stripped
 */

import type { QuestBin, DataBlock } from '../model/types';
import { BinVersion } from '../model/types';
import { loadAsmTable } from './disasm';
import type { AsmEntry } from './disasm';

// ─── Arg type constants (must match disasm.ts) ─────────────────────────────

const T_ARGS     = 2;
const T_PUSH     = 3;
const T_REG      = 7;
const T_BYTE     = 8;
const T_WORD     = 9;
const T_DWORD    = 10;
const T_FLOAT    = 11;
const T_STR      = 12;
const T_FUNC     = 14;
const T_FUNC2    = 15;
const T_SWITCH   = 16;
const T_SWITCH2B = 17;
const T_PFLAG    = 18;
const T_STRDATA  = 19;
const T_DATA     = 20;
const T_BREG     = 21;
const T_DREG     = 22;

// ─── Emit helpers ──────────────────────────────────────────────────────────

function emitU16(out: number[], v: number): void {
  out.push(v & 0xFF, (v >> 8) & 0xFF);
}
function emitU32(out: number[], v: number): void {
  const u = v >>> 0;
  out.push(u & 0xFF, (u >> 8) & 0xFF, (u >> 16) & 0xFF, (u >> 24) & 0xFF);
}
function emitOpcode(out: number[], fnc: number): void {
  if (fnc > 0xFF) {
    out.push((fnc >> 8) & 0xFF, fnc & 0xFF);
  } else {
    out.push(fnc & 0xFF);
  }
}

// Emit one character into the output (1 byte for DC/ASCII, 2 bytes LE for others)
function emitChar(out: number[], cp: number, isDC: boolean): void {
  out.push(cp & 0xFF);
  if (!isDC) out.push((cp >> 8) & 0xFF);
}

// Emit a null-terminated string, decoding <cr> and \xNN escapes
function emitString(out: number[], text: string, isDC: boolean): void {
  let i = 0;
  while (i < text.length) {
    if (text.slice(i, i + 4) === '<cr>') {
      emitChar(out, 0x0A, isDC);
      i += 4;
    } else if (text[i] === '\\' && text[i + 1] === 'x' && i + 4 <= text.length) {
      emitChar(out, parseInt(text.slice(i + 2, i + 4), 16), isDC);
      i += 4;
    } else {
      emitChar(out, text.charCodeAt(i), isDC);
      i++;
    }
  }
  out.push(0);
  if (!isDC) out.push(0); // UTF-16LE null terminator
}

// ─── Arg parsing ───────────────────────────────────────────────────────────

// Split comma-separated arg tokens, respecting single-quoted strings
function splitArgs(s: string): string[] {
  const result: string[] = [];
  let cur = '';
  let inStr = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "'" && !inStr) { inStr = true;  cur += ch; }
    else if (ch === "'" && inStr) { inStr = false; cur += ch; }
    else if (ch === ',' && !inStr) { result.push(cur.trim()); cur = ''; }
    else { cur += ch; }
  }
  if (cur.trim()) result.push(cur.trim());
  return result;
}

// Emit one inline arg (T_IMED / non-push context)
function emitArg(out: number[], argType: number, token: string, isDC: boolean): void {
  switch (argType) {
    case T_REG:
    case 13: // T_RREG
    case T_BREG:
      out.push(parseInt(token.replace(/^R/i, ''), 10) & 0xFF);
      break;

    case T_DREG:
      emitU32(out, parseInt(token.replace(/^R/i, ''), 10));
      break;

    case T_BYTE:
      out.push(parseInt(token, 16) & 0xFF);
      break;

    case T_WORD:
      emitU16(out, parseInt(token, 16));
      break;

    case T_DWORD:
    case T_PFLAG:
    case T_DATA:
    case T_STRDATA:
      emitU32(out, parseInt(token, 16) >>> 0);
      break;

    case T_FUNC:
    case T_FUNC2:
      emitU16(out, parseInt(token, 10));
      break;

    case T_FLOAT: {
      const f = parseFloat(token);
      const b = new ArrayBuffer(4);
      new DataView(b).setFloat32(0, f, true);
      emitU32(out, new DataView(b).getUint32(0, true));
      break;
    }

    case T_STR: {
      const inner = token.startsWith("'") && token.endsWith("'") ? token.slice(1, -1) : token;
      emitString(out, inner, isDC);
      break;
    }

    case T_SWITCH: {
      const parts = token.split(':');
      const count = parseInt(parts[0], 10);
      out.push(count);
      for (let i = 1; i <= count; i++) emitU16(out, parseInt(parts[i], 10));
      break;
    }

    case T_SWITCH2B: {
      const parts = token.split(':');
      const count = parseInt(parts[0], 10);
      out.push(count);
      for (let i = 1; i <= count; i++) out.push(parseInt(parts[i], 10) & 0xFF);
      break;
    }

    default:
      break;
  }
}

// Emit one arg in T_PUSH context (T_DREG reads u8, not u32)
function emitPushArg(out: number[], argType: number, token: string, isDC: boolean): void {
  switch (argType) {
    case T_REG:
    case 13:
    case T_BREG:
    case T_DREG: // in push context, T_DREG is register number (u8)
      out.push(parseInt(token.replace(/^R/i, ''), 10) & 0xFF);
      break;

    case T_DWORD:
    case T_PFLAG:
    case T_DATA:
    case T_STRDATA:
      emitU32(out, parseInt(token, 16) >>> 0);
      break;

    case T_WORD:
      emitU16(out, parseInt(token, 16));
      break;

    case T_BYTE:
      out.push(parseInt(token, 16) & 0xFF);
      break;

    case T_FUNC:
    case T_FUNC2:
      emitU16(out, parseInt(token, 10));
      break;

    case T_FLOAT: {
      const f = parseFloat(token);
      const b = new ArrayBuffer(4);
      new DataView(b).setFloat32(0, f, true);
      emitU32(out, new DataView(b).getUint32(0, true));
      break;
    }

    case T_STR: {
      const inner = token.startsWith("'") && token.endsWith("'") ? token.slice(1, -1) : token;
      emitString(out, inner, isDC);
      break;
    }

    default:
      break;
  }
}

// ─── Main assembler ────────────────────────────────────────────────────────

export async function assemble(source: string, template: QuestBin): Promise<QuestBin> {
  const table = await loadAsmTable();
  const isDC  = template.version === BinVersion.DC;

  // mnemonic → first matching AsmEntry
  const byName = new Map<string, AsmEntry>();
  for (const e of table) {
    if (!byName.has(e.name)) byName.set(e.name, e);
  }

  // argType → push opcode entry (for T_ARGS expansion)
  const pushForType = new Map<number, AsmEntry>();
  for (const e of table) {
    if (e.order === T_PUSH && e.args.length > 0 && !pushForType.has(e.args[0])) {
      pushForType.set(e.args[0], e);
    }
  }
  // Fallbacks for types that share a push opcode
  const pushl = pushForType.get(T_DWORD);
  const pushw = pushForType.get(T_WORD);
  const pushr = pushForType.get(T_REG);
  if (pushl) {
    for (const t of [T_PFLAG, T_FLOAT, T_DATA, T_STRDATA]) {
      if (!pushForType.has(t)) pushForType.set(t, pushl);
    }
  }
  if (pushw) {
    for (const t of [T_FUNC, T_FUNC2]) {
      if (!pushForType.has(t)) pushForType.set(t, pushw);
    }
  }
  if (pushr) {
    for (const t of [T_BREG, T_DREG, 13]) {
      if (!pushForType.has(t)) pushForType.set(t, pushr);
    }
  }

  const out: number[]    = [];
  const labelOffsets     = new Map<number, number>(); // label index → bytecode offset
  const dataBlocks: DataBlock[] = [];

  const sourceLines = source.split('\n');
  for (let lineIdx = 0; lineIdx < sourceLines.length; lineIdx++) {
    const rawLine = sourceLines[lineIdx];
    const lineNum = lineIdx + 1; // 1-based for error messages
    // Strip inline comments, respecting string literals
    let line = rawLine;
    {
      let inStr = false;
      for (let i = 0; i < line.length; i++) {
        if (line[i] === "'") inStr = !inStr;
        if (!inStr && line[i] === '/' && line[i + 1] === '/') { line = line.slice(0, i); break; }
      }
    }
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Label declaration: "N:" (no leading whitespace)
    const labelMatch = /^(\d+):$/.exec(trimmed);
    if (labelMatch) {
      labelOffsets.set(parseInt(labelMatch[1], 10), out.length);
      continue;
    }

    // Must be indented to be an instruction or data block
    if (!rawLine.startsWith('\t') && !rawLine.startsWith(' ')) continue;

    // STR data block: \tSTR: 'content'
    const strMatch = /^\s+STR:\s*'(.*)'$/.exec(line);
    if (strMatch) {
      dataBlocks.push({ offset: out.length, type: 1 });
      emitString(out, strMatch[1], isDC);
      continue;
    }

    // HEX data block: \tHEX: xx xx xx ...
    const hexMatch = /^\s+HEX:\s+(.+)$/.exec(line);
    if (hexMatch) {
      dataBlocks.push({ offset: out.length, type: 0 });
      for (const h of hexMatch[1].trim().split(/\s+/)) {
        out.push(parseInt(h, 16) & 0xFF);
      }
      continue;
    }

    // Instruction line: \t<mnemonic> [args]
    const instrMatch = /^\s+(\S+)(?:\s+(.*))?$/.exec(line);
    if (!instrMatch) continue;

    const mnemonic = instrMatch[1];
    const argsStr  = instrMatch[2]?.trim() ?? '';

    const entry = byName.get(mnemonic);
    if (!entry) throw new Error(`line ${lineNum}: unknown mnemonic "${mnemonic}"`);


    if (entry.order === T_ARGS && argsStr) {
      // Collapsed push-stack form: expand each arg to a push opcode, then emit T_ARGS opcode
      const tokens = splitArgs(argsStr);
      for (let i = 0; i < entry.args.length; i++) {
        const argType   = entry.args[i];
        const token     = tokens[i] ?? '00000000';
        const pushEntry = pushForType.get(argType);
        if (pushEntry) {
          emitOpcode(out, pushEntry.fnc);
          emitPushArg(out, argType, token, isDC);
        }
      }
      emitOpcode(out, entry.fnc);
    } else {
      // Inline instruction (T_IMED, T_NONE, T_DC, T_PUSH, or T_ARGS with no args)
      emitOpcode(out, entry.fnc);
      if (argsStr) {
        const tokens = splitArgs(argsStr);
        for (let i = 0; i < entry.args.length; i++) {
          emitArg(out, entry.args[i], tokens[i] ?? '', isDC);
        }
      }
    }
  }

  // Build functionRefs: sparse labelOffsets map → dense array indexed by label number
  const maxLabel = labelOffsets.size > 0 ? Math.max(...labelOffsets.keys()) : -1;
  const functionRefs: number[] = [];
  for (let i = 0; i <= maxLabel; i++) {
    functionRefs.push(labelOffsets.get(i) ?? 0);
  }

  return {
    ...template,
    bytecode:     new Uint8Array(out),
    functionRefs,
    dataBlocks,
  };
}
