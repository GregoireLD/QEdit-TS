/**
 * Sidecar format for the script editor.
 *
 * Stores user-added comments and region markers alongside a quest's bytecode.
 *
 * Two anchor types:
 *   SidecarComment      – anchored by bytecode offset; covers lines before or
 *                         inline on instruction/data lines.
 *   SidecarLabelComment – anchored by label index (N in `N:`), which is more
 *                         stable across recompiles than bytecode offsets.
 *
 * File naming (Tauri):  <questPath>-sidecar.json
 * Fallback  (browser):  localStorage key `qedit:sidecar:<questPath>`
 */

import { isTauri } from '../../platform/index';
import { readFile  } from '../../platform/fs';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SidecarComment {
  /** Bytecode offset of the instruction this comment precedes or is appended to. */
  offset: number;
  /** Raw comment text including the `//` prefix, e.g. "// initialise player". */
  text: string;
  /**
   * When true, appended inline to the instruction line (`\tinstruction  // text`).
   * When false/absent, emitted as a separate line immediately before the instruction.
   */
  inline?: boolean;
}

export interface SidecarRegion {
  /** Bytecode offset of the first instruction inside the folding region. */
  startOffset: number;
  /** Bytecode offset of the last  instruction inside the folding region. */
  endOffset: number;
  label: string;
}

export interface SidecarLabelComment {
  /** Index of the label as printed by the disassembler (the N in `N:`). */
  labelIndex: number;
  /** Raw comment text including the `//` prefix. */
  text: string;
  /**
   * When true, appended inline to the label line (`N:  // text`).
   * When false/absent, emitted as a separate line immediately before the label.
   */
  inline?: boolean;
}

export interface Sidecar {
  version: 1;
  /** Comments before or inline on instruction/data lines, anchored by bytecode offset. */
  comments:         SidecarComment[];
  regions:          SidecarRegion[];
  /** Free-floating comment lines with no following anchor; appended at end of script. */
  trailingComments: string[];
  /** Comments before or inline on label lines, anchored by label index. */
  labelComments:    SidecarLabelComment[];
}

function emptySidecar(): Sidecar {
  return { version: 1, comments: [], regions: [], trailingComments: [], labelComments: [] };
}

// ─── I/O ──────────────────────────────────────────────────────────────────────

function sidecarFilePath(questPath: string): string {
  return `${questPath}-sidecar.json`;
}

function localStorageKey(questPath: string): string {
  return `qedit:sidecar:${questPath}`;
}

function parseSidecarJson(json: string): Sidecar | null {
  try {
    const obj = JSON.parse(json);
    if (obj?.version !== 1) return null;
    obj.comments         ??= [];
    obj.trailingComments ??= [];
    obj.labelComments    ??= [];

    // Migrate old inlineComments array → SidecarComment { inline: true }
    if (Array.isArray(obj.inlineComments)) {
      for (const ic of obj.inlineComments) {
        if (typeof ic.offset === 'number' && ic.text) {
          obj.comments.push({ offset: ic.offset, text: ic.text, inline: true });
        }
      }
      delete obj.inlineComments;
    }

    // Drop obsolete afterLabel flag from old comments
    for (const c of obj.comments) delete c.afterLabel;

    return obj as Sidecar;
  } catch {
    return null;
  }
}

/** Load the sidecar for the given quest path. Returns an empty sidecar on any error or null path. */
export async function loadSidecar(questPath: string | null): Promise<Sidecar> {
  if (!questPath) return emptySidecar();
  try {
    if (isTauri()) {
      const bytes = await readFile(sidecarFilePath(questPath));
      return parseSidecarJson(new TextDecoder().decode(bytes)) ?? emptySidecar();
    }
    const raw = localStorage.getItem(localStorageKey(questPath));
    return raw ? (parseSidecarJson(raw) ?? emptySidecar()) : emptySidecar();
  } catch {
    return emptySidecar();
  }
}

/** Persist the sidecar alongside the quest file (Tauri) or in localStorage (browser). No-op on null path. */
export async function saveSidecar(questPath: string | null, sidecar: Sidecar): Promise<void> {
  if (!questPath) return;
  const json = JSON.stringify(sidecar, null, 2);
  if (isTauri()) {
    // Dynamic import keeps @tauri-apps/plugin-fs out of the browser bundle.
    const { writeFile } = await import('@tauri-apps/plugin-fs');
    await writeFile(sidecarFilePath(questPath), new TextEncoder().encode(json));
  } else {
    localStorage.setItem(localStorageKey(questPath), json);
  }
}

// ─── Weave ────────────────────────────────────────────────────────────────────

/**
 * Inject sidecar content into raw disassembly text.
 *
 * Injection points (in rendering order for a label+instruction pair at offset X):
 *   1. Region `// #region` marker     — before first occurrence of startOffset
 *   2. LabelComment (inline: false)   — separate line(s) before the label
 *   3. Label line                     — with LabelComment (inline: true) appended
 *   4. SidecarComment (inline: false) — separate line(s) before the instruction
 *   5. Instruction line               — with SidecarComment (inline: true) appended
 *   6. Region `// #endregion` marker  — after the instruction at endOffset
 *
 * Re-anchoring: a stored offset not present in the current disassembly is snapped
 * to the last valid instruction start ≤ the stored offset (the instruction whose
 * byte span contains that offset). This correctly handles both mid-instruction
 * offsets from external editors and instructions shifted by recompilation.
 */
export function weaveSidecar(
  rawText: string,
  rawLineOffsets: number[],
  sidecar: Sidecar,
): { text: string; lineOffsets: number[] } {
  const hasContent =
    sidecar.comments.length         > 0 ||
    sidecar.regions.length          > 0 ||
    sidecar.trailingComments.length > 0 ||
    sidecar.labelComments.length    > 0;
  if (!hasContent) return { text: rawText, lineOffsets: rawLineOffsets };

  // ── Re-anchor helper ────────────────────────────────────────────────────
  const sortedOffsets  = [...new Set(rawLineOffsets.filter(o => o >= 0))].sort((a, b) => a - b);
  const validOffsetSet = new Set(sortedOffsets);

  function reanchor(offset: number): number {
    if (sortedOffsets.length === 0) return offset;
    if (validOffsetSet.has(offset)) return offset;
    // Snap to last instruction start ≤ offset (the instruction containing this byte).
    const nextIdx = sortedOffsets.findIndex(o => o > offset);
    if (nextIdx === 0)  return sortedOffsets[0];
    if (nextIdx === -1) return sortedOffsets[sortedOffsets.length - 1];
    return sortedOffsets[nextIdx - 1];
  }

  // ── Build per-label queues (LabelComment) ────────────────────────────────
  const beforeLabelLines = new Map<number, string[]>(); // labelIndex → lines before label
  const inlineLabelMap   = new Map<number, string>();   // labelIndex → inline text on label

  for (const lc of sidecar.labelComments) {
    if (lc.inline) {
      inlineLabelMap.set(lc.labelIndex, lc.text);
    } else {
      if (!beforeLabelLines.has(lc.labelIndex)) beforeLabelLines.set(lc.labelIndex, []);
      beforeLabelLines.get(lc.labelIndex)!.push(lc.text);
    }
  }

  // ── Build per-offset queues (SidecarComment + regions) ───────────────────
  const beforeFirstLines = new Map<number, string[]>(); // offset → before first occurrence (region starts)
  const beforeInstrLines = new Map<number, string[]>(); // offset → before instruction line
  const inlineInstrMap   = new Map<number, string>();   // offset → inline text on instruction
  const afterInstrLines  = new Map<number, string[]>(); // offset → after instruction (region ends)
  const trailingExtra:    string[] = [];

  for (const c of sidecar.comments) {
    const off = reanchor(c.offset);
    if (c.inline) {
      if (validOffsetSet.has(off)) {
        inlineInstrMap.set(off, c.text);
      } else {
        trailingExtra.push(c.text);
      }
    } else {
      if (!beforeInstrLines.has(off)) beforeInstrLines.set(off, []);
      beforeInstrLines.get(off)!.push(c.text);
    }
  }

  for (const r of sidecar.regions) {
    const start = reanchor(r.startOffset);
    const end   = reanchor(r.endOffset);
    if (!beforeFirstLines.has(start)) beforeFirstLines.set(start, []);
    beforeFirstLines.get(start)!.push(`// #region ${r.label}`);
    if (!afterInstrLines.has(end)) afterInstrLines.set(end, []);
    afterInstrLines.get(end)!.push('// #endregion');
  }

  for (const tc of sidecar.trailingComments) trailingExtra.push(tc);

  // ── Walk raw lines and emit ─────────────────────────────────────────────
  const rawLines    = rawText.split('\n');
  const outLines:   string[] = [];
  const outOffsets: number[] = [];
  const seenOffset  = new Set<number>();

  for (let i = 0; i < rawLines.length; i++) {
    const off  = rawLineOffsets[i] ?? -1;
    const line = rawLines[i];
    const isInstruction = line.startsWith('\t') && !line.startsWith('\t//');
    const labelMatch    = (off >= 0 && !isInstruction) ? line.match(/^(\d+):/) : null;
    const labelIdx      = labelMatch ? parseInt(labelMatch[1]) : -1;

    // First occurrence of this offset: inject region-start markers
    if (off >= 0 && !seenOffset.has(off)) {
      seenOffset.add(off);
      for (const bl of beforeFirstLines.get(off) ?? []) {
        outLines.push('\t' + bl); outOffsets.push(-1);
      }
    }

    if (labelIdx >= 0) {
      // Label line: inject before-label comments, emit label with inline if any
      for (const bl of beforeLabelLines.get(labelIdx) ?? []) {
        outLines.push('\t' + bl); outOffsets.push(-1);
      }
      const inlineText = inlineLabelMap.get(labelIdx);
      outLines.push(inlineText ? `${line}  ${inlineText}` : line);
      outOffsets.push(off);
    } else if (isInstruction) {
      // Instruction/data line: inject before-instruction comments, emit with inline if any
      for (const bi of beforeInstrLines.get(off) ?? []) {
        outLines.push('\t' + bi); outOffsets.push(-1);
      }
      const inlineText = off >= 0 ? inlineInstrMap.get(off) : undefined;
      outLines.push(inlineText ? `${line}  ${inlineText}` : line);
      outOffsets.push(off);
      // After instruction: inject region-end markers
      if (off >= 0) {
        for (const ai of afterInstrLines.get(off) ?? []) {
          outLines.push('\t' + ai); outOffsets.push(-1);
        }
      }
    } else {
      // Blank separator or other structural line
      outLines.push(line);
      outOffsets.push(off);
    }
  }

  for (const tc of trailingExtra) {
    outLines.push('\t' + tc); outOffsets.push(-1);
  }

  return { text: outLines.join('\n'), lineOffsets: outOffsets };
}

// ─── Extract ──────────────────────────────────────────────────────────────────

/**
 * Pull user-added comments, region markers, and inline comments out of Monaco text,
 * anchoring each to the appropriate label index or bytecode offset.
 *
 * Walking strategy: comment lines are accumulated as "pending" until the next anchor:
 *   - Next non-comment line is a label  → flush as LabelComment (inline: false)
 *   - Next non-comment line is instruction/data → flush as SidecarComment (inline: false)
 *   - End of file → flush as trailingComments
 *
 * Inline comments on label lines and instruction lines are captured directly.
 * Region markers bypass the pending queue and are anchored by look-ahead/look-back.
 */
export function extractSidecar(
  monacoText: string,
  rawText: string,
  rawLineOffsets: number[],
): Sidecar {
  // ── Inline-comment splitter (quote-aware) ───────────────────────────────
  function splitInlineComment(line: string): [string, string | null] {
    let inStr = false;
    for (let i = 0; i < line.length; i++) {
      if (line[i] === "'") inStr = !inStr;
      if (!inStr && line[i] === '/' && line[i + 1] === '/') {
        return [line.slice(0, i).trimEnd(), line.slice(i)];
      }
    }
    return [line, null];
  }

  // ── Build text → offsets[] map from raw disassembly ─────────────────────
  // Stores ALL occurrences in order so duplicate instruction text maps to the
  // correct offset instance rather than always the first.
  const rawLines = rawText.split('\n');
  const textToOffsets = new Map<string, number[]>();
  for (let i = 0; i < rawLines.length; i++) {
    const off = rawLineOffsets[i] ?? -1;
    if (off >= 0) {
      const key = rawLines[i];
      if (!textToOffsets.has(key)) textToOffsets.set(key, []);
      textToOffsets.get(key)!.push(off);
    }
  }

  const monacoLines = monacoText.split('\n');

  // Pre-pass: compute bytecode offset for each Monaco instruction line,
  // tracking per-text occurrence counts so identical instruction lines map
  // to the right offset instance in source order.
  const monacoInstrOffsets = new Array<number>(monacoLines.length).fill(-1);
  {
    const occCounter = new Map<string, number>();
    for (let i = 0; i < monacoLines.length; i++) {
      const line = monacoLines[i];
      if (line.startsWith('\t') && !line.startsWith('\t//')) {
        const [raw] = splitInlineComment(line);
        const offsets = textToOffsets.get(raw);
        if (offsets) {
          const count = occCounter.get(raw) ?? 0;
          monacoInstrOffsets[i] = offsets[Math.min(count, offsets.length - 1)];
          occCounter.set(raw, count + 1);
        }
      }
    }
  }

  function nextInstructionOffset(from: number): number {
    for (let j = from; j < monacoLines.length; j++) {
      if (monacoInstrOffsets[j] >= 0) return monacoInstrOffsets[j];
    }
    return -1;
  }

  function prevInstructionOffset(before: number): number {
    for (let j = before; j >= 0; j--) {
      if (monacoInstrOffsets[j] >= 0) return monacoInstrOffsets[j];
    }
    return -1;
  }

  const comments:         SidecarComment[]     = [];
  const regions:          SidecarRegion[]       = [];
  const trailingComments: string[]              = [];
  const labelComments:    SidecarLabelComment[] = [];
  const openRegions: Array<{ label: string; startOffset: number }> = [];

  // Pending comment lines: accumulated until we hit a label or instruction anchor.
  const pending: string[] = [];

  function flushToLabel(labelIndex: number): void {
    for (const text of pending) labelComments.push({ labelIndex, text });
    pending.length = 0;
  }

  function flushToOffset(offset: number): void {
    for (const text of pending) comments.push({ offset, text });
    pending.length = 0;
  }

  for (let i = 0; i < monacoLines.length; i++) {
    const line    = monacoLines[i];
    const trimmed = line.trimStart();

    // ── Label line (e.g. "0:" or "0:  // annotation") ────────────────────
    const labelLineMatch = line.match(/^(\d+):\s*(\/\/.*)?$/);
    if (labelLineMatch) {
      const labelIndex = parseInt(labelLineMatch[1]);
      flushToLabel(labelIndex);
      const inlineText = labelLineMatch[2]?.trim();
      if (inlineText) labelComments.push({ labelIndex, text: inlineText, inline: true });
      continue;
    }

    // ── Instruction / data lines ───────────────────────────────────────────
    if (line.startsWith('\t') && !line.startsWith('\t//')) {
      const off = monacoInstrOffsets[i];
      if (off >= 0) {
        flushToOffset(off);
        const [, inline] = splitInlineComment(line);
        if (inline !== null) comments.push({ offset: off, text: inline, inline: true });
      }
      continue;
    }

    // ── Blank or non-comment structural lines ──────────────────────────────
    if (!trimmed.startsWith('//')) continue;

    // ── Comment / region lines ────────────────────────────────────────────
    const regionStartMatch = trimmed.match(/^\/\/ #region (.+)/);
    if (regionStartMatch) {
      const off = nextInstructionOffset(i + 1);
      if (off >= 0) openRegions.push({ label: regionStartMatch[1].trim(), startOffset: off });
      continue;
    }

    if (trimmed === '// #endregion') {
      const off  = prevInstructionOffset(i - 1);
      const open = openRegions.pop();
      if (open && off >= 0) regions.push({ startOffset: open.startOffset, endOffset: off, label: open.label });
      continue;
    }

    // Regular comment line: accumulate until we know the anchor
    pending.push(trimmed);
  }

  // Any remaining pending lines have no following anchor → trailing
  for (const text of pending) trailingComments.push(text);

  return { version: 1, comments, regions, trailingComments, labelComments };
}
