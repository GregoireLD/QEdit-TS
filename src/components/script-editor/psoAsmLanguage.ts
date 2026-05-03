/**
 * Monaco language definition for PSO quest assembly.
 *
 * Token types mapped to the Classic theme colours from qedit:
 *   labels    → yellow   (#f0c040)
 *   opcodes   → white    (#ffffff)
 *   registers → lime     (#80ff40)
 *   numbers   → fuchsia  (#ff40ff)
 *   strings   → cyan     (#40ffff)
 *   comments  → silver   (#a0a0a0)
 *   directives→ silver   (#a0a0a0)
 */

import type * as Monaco from 'monaco-editor';
import asmJsonRaw from '../../core/data/asm.json';
import psoTheme from '../../core/data/pso-dark-theme.json';

// ─── Types ────────────────────────────────────────────────────────────────────

type AsmArg = {
  name: string;
  type: string;
  desc?: string;
  values?: string[];
  enum?: string;
};

type AsmParam = {
  name: string;
  doc?: string;
  values?: string[];
};

type AsmJsonEntry = {
  name: string;
  args: AsmArg[];
  description?: string;
};

// ─── Opcode index built from asm.json ─────────────────────────────────────────

const _entries = asmJsonRaw as AsmJsonEntry[];

export const OPCODES: string[] = [...new Set(_entries.map(e => e.name))];

const OPCODE_DESCRIPTIONS: Record<string, string> = {};
const OPCODE_ARGS: Record<string, string[]> = {};
const OPCODE_PARAMS: Record<string, AsmParam[]> = {};

for (const e of _entries) {
  if (e.description && !(e.name in OPCODE_DESCRIPTIONS)) {
    OPCODE_DESCRIPTIONS[e.name] = e.description;
  }
  if (!(e.name in OPCODE_ARGS)) {
    const args = e.args ?? [];
    OPCODE_ARGS[e.name] = args.map(a => a.type);
    OPCODE_PARAMS[e.name] = args.map(a => ({
      name: a.name,
      doc: a.desc,
      values: a.values,
    }));
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Build a snippet string for an opcode, e.g. `opcode ${1:param1}, ${2:param2}` */
function opcodeSnippet(name: string): string {
  const params = OPCODE_PARAMS[name] ?? [];
  if (params.length === 0) return name;
  const argList = params.map((p, i) => `\${${i + 1}:${p.name}}`).join(', ');
  return `${name} ${argList}`;
}

/**
 * Given the line content up to the cursor column, determine whether the cursor
 * is inside an argument list and which argument index it is at.
 *
 * Returns null when the cursor is at opcode position (not inside arguments).
 */
function getArgContext(
  line: string,
  col: number,
): { opcode: string; argIndex: number } | null {
  const text = line.slice(0, col - 1); // col is 1-indexed
  if (/^\s*\/\//.test(text)) return null;

  // Match: optional label, then opcode, then at least one space, then whatever
  const m = text.match(/^\s*(?:\d+:\s*)?([a-zA-Z_][a-zA-Z0-9_=!<>]*)\s+(.*)/s);
  if (!m) return null;

  const opcode = m[1];
  if (!(opcode in OPCODE_ARGS)) return null;

  // Count commas outside of string literals to find the argument index.
  const argsText = m[2];
  let inStr = false;
  let commas = 0;
  for (const ch of argsText) {
    if (ch === "'" && !inStr) inStr = true;
    else if (ch === "'" && inStr) inStr = false;
    else if (ch === ',' && !inStr) commas++;
  }

  return { opcode, argIndex: commas };
}

/** Collect all label numbers defined in the document (lines matching `^\d+:`). */
function getDocumentLabels(model: Monaco.editor.ITextModel): string[] {
  const labels: string[] = [];
  for (let i = 1; i <= model.getLineCount(); i++) {
    const m = model.getLineContent(i).match(/^(\d+):/);
    if (m) labels.push(m[1]);
  }
  return labels;
}

/**
 * Collect register nametags from lines (or inline comments) matching:
 *   // Rnn = someName
 *
 * Both standalone comment lines and trailing inline comments are supported:
 *   // R0 = questFlags
 *   leti R0, 0  // R0 = questFlags
 */
function getRegisterNametags(model: Monaco.editor.ITextModel): Map<string, string> {
  const tags = new Map<string, string>();
  const re = /\/\/\s*(R\d{1,3})\s*=\s*(.+?)\s*$/;
  for (let i = 1; i <= model.getLineCount(); i++) {
    const m = model.getLineContent(i).match(re);
    if (m) tags.set(m[1], m[2]);
  }
  return tags;
}

/**
 * Collect label nametags from lines where a label and a comment coexist:
 *   0: // Quest Start
 *   5: // Player death handler
 */
function getLabelNametags(model: Monaco.editor.ITextModel): Map<string, string> {
  const tags = new Map<string, string>();
  const re = /^(\d+):\s*\/\/\s*(.+?)\s*$/;
  for (let i = 1; i <= model.getLineCount(); i++) {
    const m = model.getLineContent(i).match(re);
    if (m) tags.set(m[1], m[2]);
  }
  return tags;
}

// ─── Language registration ─────────────────────────────────────────────────

export const LANGUAGE_ID = 'pso-asm';

export function registerPsoAsm(monaco: typeof Monaco): void {
  if (monaco.languages.getLanguages().some(l => l.id === LANGUAGE_ID)) return;

  monaco.languages.register({ id: LANGUAGE_ID, extensions: ['.bin.asm', '.pso'] });

  monaco.languages.setLanguageConfiguration(LANGUAGE_ID, {
    comments: { lineComment: '//' },
    folding: {
      markers: {
        start: /^\s*\/\/ #region\b/,
        end:   /^\s*\/\/ #endregion\b/,
      },
    },
  });

  // ─── Tokeniser ────────────────────────────────────────────────────────

  monaco.languages.setMonarchTokensProvider(LANGUAGE_ID, {
    defaultToken: '',
    tokenPostfix: '.pso',

    keywords: OPCODES,
    directives: ['HEX', 'STR', 'RAW'],

    tokenizer: {
      root: [
        [/\/\/.*$/, 'comment'],
        [/^\d+:/, 'label'],
        [/\b(HEX|STR):/, 'directive'],
        [/\bRAW:/, 'directive.raw'],
        [/\bR\d{1,3}\b/, 'register'],
        [/\b0[xX][0-9a-fA-F]+\b/, 'number.hex'],
        [/\b[0-9a-fA-F]{8}\b/, 'number.hex'],
        [/\b\d+\b/, 'number'],
        [/\b\d+\.\d+\b/, 'number.float'],
        [/'(?:[^'\\<]|\\x[0-9a-fA-F]{2}|<[^>]*>)*$/, 'string'],
        [/'/, { token: 'string.delim', next: '@string' }],
        [/[a-zA-Z_][a-zA-Z0-9_=!<>]*/, {
          cases: {
            '@keywords': 'keyword',
            '@default': 'identifier',
          },
        }],
        [/,/, 'delimiter'],
      ],

      string: [
        [/\\x[0-9a-fA-F]{2}/, 'string.escape'],
        [/<[^>]*>/, 'string.escape'],
        [/'/, { token: 'string.delim', next: '@pop' }],
        [/[^'\\<]+/, 'string'],
        [/</, 'string'],
      ],
    },
  } as Monaco.languages.IMonarchLanguage);

  // ─── Completion ───────────────────────────────────────────────────────
  //
  // Three tiers:
  //  1. Argument position with known type constraints → enum values / labels / registers
  //  2. Argument position without constraints → empty (prevents opcode list pollution)
  //  3. Opcode position → snippet completions for all opcodes + R0–R255

  monaco.languages.registerCompletionItemProvider(LANGUAGE_ID, {
    triggerCharacters: [' ', ','],

    provideCompletionItems(model, position) {
      const word = model.getWordUntilPosition(position);
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber:   position.lineNumber,
        startColumn:     word.startColumn,
        endColumn:       word.endColumn,
      };

      const line = model.getLineContent(position.lineNumber);
      const ctx  = getArgContext(line, position.column);

      if (ctx) {
        const argType = OPCODE_ARGS[ctx.opcode]?.[ctx.argIndex];
        const param   = OPCODE_PARAMS[ctx.opcode]?.[ctx.argIndex];
        const suggestions: Monaco.languages.CompletionItem[] = [];

        // Enum values defined in params.values
        if (param?.values) {
          for (const v of param.values) {
            suggestions.push({
              label: v,
              kind: monaco.languages.CompletionItemKind.EnumMember,
              insertText: v,
              range,
              documentation: param.doc ?? `Valid value for ${param.name}`,
              sortText: '0' + v,
            });
          }
        }

        // FUNC / FUNC2 → suggest all labels in the document (with nametags)
        if (argType === 'FUNC' || argType === 'FUNC2') {
          const labelTags = getLabelNametags(model);
          for (const lbl of getDocumentLabels(model)) {
            const name = labelTags.get(lbl);
            suggestions.push({
              label: name ? { label: lbl, detail: ` — ${name}` } : lbl,
              kind: monaco.languages.CompletionItemKind.Reference,
              insertText: lbl,
              sortText: lbl.padStart(6, '0'),
              range,
            });
          }
        }

        // REG / BREG / DREG → R0–R255 (with nametags when defined)
        if (argType === 'REG' || argType === 'BREG' || argType === 'DREG') {
          const regTags = getRegisterNametags(model);
          for (let i = 0; i <= 255; i++) {
            const lbl  = `R${i}`;
            const name = regTags.get(lbl);
            suggestions.push({
              label: name ? { label: lbl, detail: ` (${name})` } : lbl,
              kind: monaco.languages.CompletionItemKind.Variable,
              insertText: lbl,
              sortText: String(i).padStart(3, '0'),
              range,
            });
          }
        }

        // Always return when in argument position (even if empty) to avoid
        // leaking the opcode list into argument slots.
        return { suggestions };
      }

      // Opcode position: snippet completions + registers
      const opcodeItems: Monaco.languages.CompletionItem[] = OPCODES.map(op => {
        const snippet = opcodeSnippet(op);
        const hasArgs = snippet !== op;
        const args    = OPCODE_ARGS[op] ?? [];
        const params  = OPCODE_PARAMS[op] ?? [];
        const detail  = args.length > 0
          ? params.map((p, i) => `${p.name}: ${args[i] ?? '?'}`).join(', ')
          : undefined;
        return {
          label: op,
          kind: monaco.languages.CompletionItemKind.Function,
          insertText: snippet,
          insertTextRules: hasArgs
            ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
            : undefined,
          detail,
          range,
          ...(OPCODE_DESCRIPTIONS[op] ? { documentation: OPCODE_DESCRIPTIONS[op] } : {}),
        };
      });

      const regTags  = getRegisterNametags(model);
      const regItems: Monaco.languages.CompletionItem[] = Array.from(
        { length: 256 }, (_, i) => {
          const lbl  = `R${i}`;
          const name = regTags.get(lbl);
          return {
            label: name ? { label: lbl, detail: ` (${name})` } : lbl,
            kind: monaco.languages.CompletionItemKind.Variable,
            insertText: lbl,
            sortText: String(i).padStart(3, '0'),
            range,
          };
        },
      );

      return { suggestions: [...opcodeItems, ...regItems] };
    },
  });

  // ─── Signature help ───────────────────────────────────────────────────
  //
  // Shows `opcode(param1: TYPE, param2: TYPE, ...)` while typing arguments,
  // with the active parameter highlighted.

  monaco.languages.registerSignatureHelpProvider(LANGUAGE_ID, {
    signatureHelpTriggerCharacters:   [' ', ','],
    signatureHelpRetriggerCharacters: [','],

    provideSignatureHelp(model, position) {
      const line = model.getLineContent(position.lineNumber);
      const ctx  = getArgContext(line, position.column);
      if (!ctx) return null;

      const args   = OPCODE_ARGS[ctx.opcode] ?? [];
      const params = OPCODE_PARAMS[ctx.opcode] ?? [];
      if (args.length === 0) return null;

      const paramLabels = params.map((p, i) => `${p.name}: ${args[i] ?? '?'}`);
      const activeParam = Math.min(ctx.argIndex, params.length - 1);

      // Build [start, end] offset pairs so Monaco highlights the active param
      // inside the signature label string.
      const prefix = `${ctx.opcode}(`;
      const parameterOffsets: [number, number][] = [];
      let cursor = prefix.length;
      for (let i = 0; i < paramLabels.length; i++) {
        const len = paramLabels[i].length;
        parameterOffsets.push([cursor, cursor + len]);
        cursor += len + (i < paramLabels.length - 1 ? 2 : 0); // ", " separator
      }

      const sigLabel = `${prefix}${paramLabels.join(', ')})`;

      const parameters: Monaco.languages.ParameterInformation[] = params.map((p, i) => ({
        label: parameterOffsets[i] as [number, number],
        documentation: p.doc,
      }));

      return {
        value: {
          signatures: [{
            label: sigLabel,
            documentation: OPCODE_DESCRIPTIONS[ctx.opcode],
            parameters,
          }],
          activeSignature: 0,
          activeParameter: activeParam,
        },
        dispose() {},
      };
    },
  });

  // ─── Hover ────────────────────────────────────────────────────────────

  monaco.languages.registerHoverProvider(LANGUAGE_ID, {
    provideHover(model, position) {
      const word = model.getWordAtPosition(position);
      if (!word) return null;

      const token = word.word;
      const hoverRange = new monaco.Range(
        position.lineNumber, word.startColumn,
        position.lineNumber, word.endColumn,
      );

      // Register hover: show nametag if defined
      if (/^R\d{1,3}$/.test(token)) {
        const nametag = getRegisterNametags(model).get(token);
        if (!nametag) return null;
        return {
          range: hoverRange,
          contents: [{ value: `**${token}** — ${nametag}` }],
        };
      }

      // Label reference hover: show nametag if the number is a named label
      if (/^\d+$/.test(token)) {
        const nametag = getLabelNametags(model).get(token);
        if (!nametag) return null;
        return {
          range: hoverRange,
          contents: [{ value: `**${token}:** — ${nametag}` }],
        };
      }

      // Opcode hover: show signature + description
      const args = OPCODE_ARGS[token];
      if (!args) return null;

      const params    = OPCODE_PARAMS[token] ?? [];
      const doc       = OPCODE_DESCRIPTIONS[token];
      const sigParts  = params.map((p, i) => `${p.name}: ${args[i] ?? '?'}`);
      const signature = `${token}(${sigParts.join(', ')})`;

      const contents: Monaco.IMarkdownString[] = [
        { value: `\`\`\`\n${signature}\n\`\`\`` },
      ];
      if (doc) contents.push({ value: doc });

      return { range: hoverRange, contents };
    },
  });
}

// ─── Theme definition ──────────────────────────────────────────────────────

export function definePsoTheme(monaco: typeof Monaco): void {
  const { base, rules, colors } = psoTheme.monaco;
  monaco.editor.defineTheme('pso-dark', { base, inherit: true, rules, colors } as Parameters<typeof monaco.editor.defineTheme>[1]);
}
