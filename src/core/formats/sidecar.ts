/**
 * Sidecar format for the script editor.
 *
 * Stores user-added comments and region markers alongside a quest's bytecode,
 * anchored by byte offset so they survive quest re-open. Offsets are stable
 * across re-disassembly as long as the bytecode itself doesn't change.
 *
 * File naming (Tauri):  <questPath>-sidecar.json
 * Fallback  (browser):  localStorage key `qedit:sidecar:<questPath>`
 */

import { isTauri } from '../../platform/index';
import { readFile  } from '../../platform/fs';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SidecarComment {
  /** Bytecode offset of the instruction immediately AFTER this comment line. */
  offset: number;
  /** Raw comment text as typed in Monaco, e.g. "// initialise player". */
  text: string;
  /**
   * True when the comment was typed between a label line (e.g. `0:`) and its
   * instruction.  Weaved back between those two lines rather than before the label.
   */
  afterLabel?: boolean;
}

export interface SidecarRegion {
  /** Bytecode offset of the first instruction inside the folding region. */
  startOffset: number;
  /** Bytecode offset of the last  instruction inside the folding region. */
  endOffset: number;
  label: string;
}

export interface SidecarInlineComment {
  /** Bytecode offset of the instruction this comment is appended to. */
  offset: number;
  /** Comment text including the `//` prefix, e.g. "// terminate loop". */
  text: string;
}

export interface SidecarLabelComment {
  /** Index of the label as printed by the disassembler (the N in `N:`). */
  labelIndex: number;
  /** Comment text including the `//` prefix. */
  text: string;
}

export interface Sidecar {
  version: 1;
  comments:         SidecarComment[];
  regions:          SidecarRegion[];
  inlineComments:   SidecarInlineComment[];
  /** Free-floating lines with no following instruction; appended after the last line. */
  trailingComments: string[];
  /** Inline comments appended directly to a label line, e.g. `0: // function name`. */
  labelComments:    SidecarLabelComment[];
}

function emptySidecar(): Sidecar {
  return { version: 1, comments: [], regions: [], inlineComments: [], trailingComments: [], labelComments: [] };
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
    obj.inlineComments    ??= [];
    obj.trailingComments  ??= [];
    obj.labelComments     ??= [];
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
 * Inject sidecar content into a raw disassembly text.
 *
 * Region `// #region` markers are inserted BEFORE the first instruction of the
 * region; `// #endregion` markers are inserted AFTER the last instruction.
 * Regular comments are inserted BEFORE the instruction they are anchored to.
 * Inline comments are appended to the end of the instruction line.
 *
 * **Orphan re-anchoring:** if a stored offset no longer exists in the new
 * disassembly (e.g. the instruction was removed by a compile), each entry is
 * re-anchored to the nearest successor offset (first valid offset ≥ stored).
 * If the stored offset is beyond the last instruction it attaches to the last
 * line. This means comments drift forward gracefully and are never silently
 * dropped. The sidecar self-corrects on the next save (extractSidecar will see
 * the comment at its new position and write back the updated offset).
 *
 * Returns the enriched text and a new lineOffsets array parallel to it
 * (`-1` for every injected line, original offset for every original line).
 */
export function weaveSidecar(
  rawText: string,
  rawLineOffsets: number[],
  sidecar: Sidecar,
): { text: string; lineOffsets: number[] } {
  const hasContent =
    sidecar.comments.length       > 0 ||
    sidecar.regions.length        > 0 ||
    sidecar.inlineComments.length > 0 ||
    sidecar.trailingComments.length > 0 ||
    sidecar.labelComments.length  > 0;
  if (!hasContent) return { text: rawText, lineOffsets: rawLineOffsets };

  // ── Re-anchor helper ────────────────────────────────────────────────────
  const sortedOffsets  = [...new Set(rawLineOffsets.filter(o => o >= 0))].sort((a, b) => a - b);
  const validOffsetSet = new Set(sortedOffsets);

  function reanchor(offset: number): number {
    if (sortedOffsets.length === 0) return offset;
    const idx = sortedOffsets.findIndex(o => o >= offset);
    return idx >= 0 ? sortedOffsets[idx] : sortedOffsets[sortedOffsets.length - 1];
  }

  // ── Build per-offset injection queues ───────────────────────────────────
  // beforeLines   – injected before label (or standalone instruction).
  // afterLabelLines – injected between a label line and its instruction.
  // afterLines    – injected after the instruction (endregion markers).
  const beforeLines     = new Map<number, string[]>();
  const afterLabelLines = new Map<number, string[]>();
  const afterLines      = new Map<number, string[]>();
  const inlineMap       = new Map<number, string>();
  const labelCommentMap = new Map<number, string>();   // labelIndex → inline text
  const trailingExtra:    string[] = [];   // orphaned inline + explicit trailing

  for (const r of sidecar.regions) {
    const start = reanchor(r.startOffset);
    const end   = reanchor(r.endOffset);
    if (!beforeLines.has(start)) beforeLines.set(start, []);
    beforeLines.get(start)!.push(`// #region ${r.label}`);
    if (!afterLines.has(end)) afterLines.set(end, []);
    afterLines.get(end)!.push('// #endregion');
  }

  for (const c of sidecar.comments) {
    const off = reanchor(c.offset);
    if (c.afterLabel) {
      if (!afterLabelLines.has(off)) afterLabelLines.set(off, []);
      afterLabelLines.get(off)!.push(c.text);
    } else {
      if (!beforeLines.has(off)) beforeLines.set(off, []);
      beforeLines.get(off)!.push(c.text);
    }
  }

  for (const ic of sidecar.inlineComments) {
    if (validOffsetSet.has(ic.offset)) {
      inlineMap.set(ic.offset, ic.text);
    } else {
      // Offset no longer exists after a compile: demote to a trailing comment
      // so the text is not silently lost.
      trailingExtra.push(ic.text);
    }
  }

  for (const tc of (sidecar.trailingComments ?? [])) trailingExtra.push(tc);
  for (const lc of (sidecar.labelComments   ?? [])) labelCommentMap.set(lc.labelIndex, lc.text);

  // ── Walk raw lines and emit ─────────────────────────────────────────────
  const rawLines    = rawText.split('\n');
  const outLines:   string[]  = [];
  const outOffsets: number[]  = [];
  const injectedBefore = new Set<number>();

  for (let i = 0; i < rawLines.length; i++) {
    const off  = rawLineOffsets[i] ?? -1;
    const line = rawLines[i];
    const isInstruction = line.startsWith('\t') && !line.startsWith('\t//');

    if (off >= 0) {
      if (!injectedBefore.has(off)) {
        // First occurrence of this offset (may be a label or standalone instruction):
        // inject region-open markers and "before label" comments.
        injectedBefore.add(off);
        for (const bl of beforeLines.get(off) ?? []) {
          outLines.push('\t' + bl); outOffsets.push(-1);
        }
      } else if (isInstruction) {
        // Second occurrence = instruction after a label line for the same offset:
        // inject "after label" comments between the label and the instruction.
        for (const al of afterLabelLines.get(off) ?? []) {
          outLines.push('\t' + al); outOffsets.push(-1);
        }
      }
    }

    // For label lines (e.g. "0:"), re-append any stored inline comment.
    const labelIdxMatch = (!isInstruction && off >= 0) ? line.match(/^(\d+):$/) : null;
    const labelInline   = labelIdxMatch ? labelCommentMap.get(parseInt(labelIdxMatch[1])) : undefined;
    const instrInline   = (isInstruction && off >= 0) ? inlineMap.get(off) : undefined;
    const inline        = labelInline ?? instrInline;
    outLines.push(inline ? `${line}  ${inline}` : line);
    outOffsets.push(off);

    if (off >= 0 && isInstruction) {
      for (const al of afterLines.get(off) ?? []) {
        outLines.push('\t' + al); outOffsets.push(-1);
      }
    }
  }

  for (const tc of trailingExtra) {
    outLines.push('\t' + tc); outOffsets.push(-1);
  }

  return { text: outLines.join('\n'), lineOffsets: outOffsets };
}

// ─── Extract ──────────────────────────────────────────────────────────────────

/**
 * Pull user-added comments, region markers, and inline comments out of Monaco
 * text, anchoring each to the bytecode offset of the nearest instruction line.
 *
 * Identification rules:
 *   - Lines starting with `//` (no leading tab) are sidecar lines.
 *   - Lines starting with `\t//` are disassembler-generated inline comments — ignored.
 *   - `// #region <label>` opens a folding region anchored to the next instruction.
 *   - `// #endregion` closes it, anchored to the previous instruction.
 *   - Any other `// …` line is a regular comment anchored to the next instruction.
 *   - Instruction lines (`\t<mnemonic>`) may have a trailing `// …` appended by
 *     the user; those are extracted as inline comments.
 *
 * Offset lookup uses a text-content map built from the raw disassembly
 * (first-occurrence wins for duplicate instruction lines).
 * Instruction lines in Monaco may carry an appended inline comment — the helper
 * strips it (quote-aware) before performing the lookup so the map still matches.
 */
export function extractSidecar(
  monacoText: string,
  rawText: string,
  rawLineOffsets: number[],
): Sidecar {
  // ── Inline-comment splitter (quote-aware) ───────────────────────────────
  // Returns [codeWithoutComment, inlineCommentOrNull].
  // e.g. '\tret  // done' → ['\tret', '// done']
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

  // Pre-pass: compute the correct bytecode offset for each Monaco line,
  // tracking per-text occurrence counts so identical instruction lines are
  // matched to the right offset instance in order of appearance.
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

  const comments:         SidecarComment[]       = [];
  const regions:          SidecarRegion[]         = [];
  const inlineComments:   SidecarInlineComment[]  = [];
  const trailingComments: string[]                = [];
  const labelComments:    SidecarLabelComment[]   = [];
  const openRegions: Array<{ label: string; startOffset: number }> = [];

  // Track the most-recently-seen non-blank, non-comment line while walking forward.
  // Used to detect when a comment falls between a label and its instruction.
  let lastRealLine = '';

  for (let i = 0; i < monacoLines.length; i++) {
    const line    = monacoLines[i];
    const trimmed = line.trimStart();

    // ── Instruction lines ──────────────────────────────────────────────────
    if (line.startsWith('\t') && !line.startsWith('\t//')) {
      lastRealLine = line;
      const [, inline] = splitInlineComment(line);
      if (inline !== null) {
        const off = monacoInstrOffsets[i];
        if (off >= 0) inlineComments.push({ offset: off, text: inline });
      }
      continue;
    }

    // ── Label lines (e.g. "0:" or "0:  // annotation") ────────────────────
    const labelLineMatch = line.match(/^(\d+):\s*(\/\/.*)?$/);
    if (labelLineMatch) {
      lastRealLine = line;
      const inlineText = labelLineMatch[2]?.trim();
      if (inlineText) {
        labelComments.push({ labelIndex: parseInt(labelLineMatch[1]), text: inlineText });
      }
      continue;
    }

    // ── Blank or non-comment structural lines ──────────────────────────────
    if (!trimmed.startsWith('//')) continue;

    // ── Sidecar comment / region lines ────────────────────────────────────
    const regionStartMatch = trimmed.match(/^\/\/ #region (.+)/);

    if (regionStartMatch) {
      const off = nextInstructionOffset(i + 1);
      if (off >= 0) openRegions.push({ label: regionStartMatch[1].trim(), startOffset: off });

    } else if (trimmed === '// #endregion') {
      const off  = prevInstructionOffset(i - 1);
      const open = openRegions.pop();
      if (open && off >= 0) {
        regions.push({ startOffset: open.startOffset, endOffset: off, label: open.label });
      }

    } else {
      const off = nextInstructionOffset(i + 1);
      if (off < 0) {
        trailingComments.push(trimmed);
      } else {
        // A comment is "after label" when the most recent real (non-comment, non-blank)
        // line is a label.  The check uses a loose prefix match so it still works when
        // the label has a trailing inline comment (e.g. "1: // name").
        const afterLabel = /^\s*\d+:/.test(lastRealLine);
        comments.push({ offset: off, text: trimmed, ...(afterLabel ? { afterLabel: true } : {}) });
      }
    }
  }

  return { version: 1, comments, regions, inlineComments, trailingComments, labelComments };
}
