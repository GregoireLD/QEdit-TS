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

// ─── Opcode list derived from asm.json ────────────────────────────────────

export const OPCODES: string[] = [
  ...new Set((asmJsonRaw as { name: string }[]).map(e => e.name)),
];

// ─── Language registration ─────────────────────────────────────────────────

export const LANGUAGE_ID = 'pso-asm';

export function registerPsoAsm(monaco: typeof Monaco): void {
  // Guard: only register once
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

    // ── Opcode keywords (matched as 'keyword') ─────────────────────────
    keywords: OPCODES,

    // ── Directives ────────────────────────────────────────────────────
    directives: ['HEX', 'STR', 'RAW'],

    tokenizer: {
      root: [
        // Comments
        [/\/\/.*$/, 'comment'],

        // Label: digits followed by colon, only at the very start of a line
        [/^\d+:/, 'label'],

        // Directives: HEX: or STR: (must come before general identifier rule)
        [/\b(HEX|STR):/, 'directive'],

        // RAW: unknown opcode tail — styled as a warning
        [/\bRAW:/, 'directive.raw'],

        // Registers: R followed by 1-3 digits
        [/\bR\d{1,3}\b/, 'register'],

        // Hex numbers: 0x prefix or bare 8-digit hex in argument position
        [/\b0[xX][0-9a-fA-F]+\b/, 'number.hex'],
        [/\b[0-9a-fA-F]{8}\b/, 'number.hex'],

        // Decimal integers
        [/\b\d+\b/, 'number'],

        // Floats
        [/\b\d+\.\d+\b/, 'number.float'],

        // String literals in single quotes.
        //
        // Two-rule approach to prevent line bleed:
        //
        // Rule 1 — unterminated fallback (stateless): fires when there is no closing
        // quote remaining on the line.  The alternation stops at any ' and then $
        // only matches if we truly reached end-of-line without one, so this rule
        // never fires for properly-terminated strings.  No state is entered → no bleed.
        [/'(?:[^'\\<]|\\x[0-9a-fA-F]{2}|<[^>]*>)*$/, 'string'],

        // Rule 2 — terminated string: enters the @string sub-state for per-token
        // colouring of escape sequences and <tag> markers.  The sub-state always
        // pops on the closing quote, so bleed is impossible for a proper string.
        [/'/, { token: 'string.delim', next: '@string' }],

        // Identifiers / opcodes
        [/[a-zA-Z_][a-zA-Z0-9_=!<>]*/, {
          cases: {
            '@keywords': 'keyword',
            '@default': 'identifier',
          },
        }],

        // Comma separator (uncoloured)
        [/,/, 'delimiter'],
      ],

      string: [
        // \xNN hex escapes
        [/\\x[0-9a-fA-F]{2}/, 'string.escape'],
        // Any <tag> — covers <cr>, <hero name>, <hero job>, etc.
        [/<[^>]*>/, 'string.escape'],
        // Closing quote
        [/'/, { token: 'string.delim', next: '@pop' }],
        // Normal string content
        [/[^'\\<]+/, 'string'],
        // Stray '<' not part of a tag
        [/</, 'string'],
      ],

    },
  } as Monaco.languages.IMonarchLanguage);

  // ─── Auto-completion ──────────────────────────────────────────────────

  monaco.languages.registerCompletionItemProvider(LANGUAGE_ID, {
    provideCompletionItems(model, position) {
      const word = model.getWordUntilPosition(position);
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber:   position.lineNumber,
        startColumn:     word.startColumn,
        endColumn:       word.endColumn,
      };

      const opcodeItems: Monaco.languages.CompletionItem[] = OPCODES.map(op => ({
        label: op,
        kind: monaco.languages.CompletionItemKind.Function,
        insertText: op,
        range,
      }));

      // Suggest R0..R255
      const regItems: Monaco.languages.CompletionItem[] = Array.from(
        { length: 256 }, (_, i) => ({
          label: `R${i}`,
          kind: monaco.languages.CompletionItemKind.Variable,
          insertText: `R${i}`,
          range,
        })
      );

      return { suggestions: [...opcodeItems, ...regItems] };
    },
  });

  // ─── Hover documentation ──────────────────────────────────────────────

  const OPCODE_DOCS: Record<string, string> = {
    nop:    'No operation.',
    ret:    'Return from the current function.',
    sync:   'Synchronize execution (yield to game engine).',
    exit:   'Exit the quest script.',
    thread: 'Create a new execution thread at the given function label.',
    let:    'Copy register value: `let Rdest, Rsrc`',
    leti:   'Load immediate dword into register: `leti Rdest, VALUE`',
    letb:   'Load immediate byte into register: `letb Rdest, VALUE`',
    letw:   'Load immediate word into register: `letw Rdest, VALUE`',
    jmp:    'Unconditional jump to label: `jmp LABEL`',
    call:   'Call function at label: `call LABEL`',
    'jmp_=':  'Jump if Rn == Rm: `jmp_= Rn, Rm, LABEL`',
    'jmpi_=': 'Jump if Rn == immediate: `jmpi_= Rn, VALUE, LABEL`',
    'jmp_!=': 'Jump if Rn != Rm.',
    'jmp_>':  'Jump if Rn > Rm (signed).',
    'jmp_<':  'Jump if Rn < Rm (signed).',
    add:    'Add registers: `add Rdest, Rsrc`',
    addi:   'Add immediate: `addi Rdest, VALUE`',
    sub:    'Subtract registers.',
    mul:    'Multiply registers.',
    div:    'Divide registers.',
    and:    'Bitwise AND.',
    or:     'Bitwise OR.',
    xor:    'Bitwise XOR.',
    message:'Display NPC message: `message NPC_ID, \'text\'`',
    window_msg: 'Display window message: `window_msg \'text\'`',
    add_msg:'Append to current message: `add_msg \'text\'`',
    mesend: 'End current message display.',
    set_floor_handler: 'Register a function to call when entering a floor: `set_floor_handler FLOOR_ID, LABEL`',
    clr_floor_handler: 'Remove the floor handler for a floor.',
    switch_on:  'Activate a switch object.',
    switch_off: 'Deactivate a switch object.',
    bgm:    'Play background music track: `bgm TRACK_ID`',
    fadein: 'Fade screen in.',
    fadeout:'Fade screen out.',
    hud_hide:'Hide the HUD.',
    hud_show:'Show the HUD.',
    set_qt_success:'Mark quest as succeeded.',
    set_qt_failure:'Mark quest as failed.',
    set_qt_cancel: 'Mark quest as cancelled.',
    set_qt_exit:   'Set the function to call on quest exit.',
    get_difflvl:  'Get current difficulty level into register: `get_difflvl Rdest`',
    get_player_hp:'Get player HP into register.',
    get_player_level:'Get player level into register.',
    go_floor:     'Warp all players to a floor.',
    set_mainwarp: 'Set the main warp destination.',
    sync_register:'Sync register value across all players: `sync_register Rdest, Rsrc`',
    item_create:  'Create an item: `item_create Rtype, Rparams`',
    item_delete:  'Delete an item.',
    item_check:   'Check if player has an item.',
    freeze_enemies: 'Freeze all enemies on the floor.',
    unfreeze_enemies: 'Unfreeze all enemies.',
    kill_player:  'Kill a player.',
    exp_multiplication: 'Set experience multiplier.',
    dec2float:    'Convert integer register to float.',
    float2dec:    'Convert float register to integer.',
    sin:  'Compute sine of register value.',
    cos:  'Compute cosine of register value.',
    fadd: 'Add float registers.',
    fmul: 'Multiply float registers.',
  };

  monaco.languages.registerHoverProvider(LANGUAGE_ID, {
    provideHover(model, position) {
      const word = model.getWordAtPosition(position);
      if (!word) return null;
      const doc = OPCODE_DOCS[word.word];
      if (!doc) return null;
      return {
        range: new monaco.Range(
          position.lineNumber, word.startColumn,
          position.lineNumber, word.endColumn,
        ),
        contents: [
          { value: `**${word.word}**` },
          { value: doc },
        ],
      };
    },
  });
}

// ─── Theme definition ──────────────────────────────────────────────────────

export function definePsoTheme(monaco: typeof Monaco): void {
  monaco.editor.defineTheme('pso-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'comment',      foreground: 'a0a0a0', fontStyle: 'italic' },
      { token: 'label',        foreground: 'f0c040', fontStyle: 'bold' },
      { token: 'keyword',      foreground: 'ffffff', fontStyle: 'bold' },
      { token: 'register',     foreground: '80ff40' },
      { token: 'number',       foreground: 'ff80ff' },
      { token: 'number.hex',   foreground: 'ff80ff' },
      { token: 'number.float', foreground: 'ff80ff' },
      { token: 'string',        foreground: '40ffff' },
      { token: 'string.delim', foreground: '40ffff' },
      { token: 'string.escape',foreground: 'ff8040' },
      { token: 'directive',     foreground: 'a0a0a0', fontStyle: 'bold' },
      { token: 'directive.raw', foreground: 'ffa040', fontStyle: 'bold' },
      { token: 'identifier',   foreground: 'cccccc' },
      { token: 'delimiter',    foreground: '666666' },
    ],
    colors: {
      'editor.background':          '#0a0a30',
      'editor.foreground':          '#cccccc',
      'editor.lineHighlightBackground': '#141450',
      'editorLineNumber.foreground':'#505080',
      'editorCursor.foreground':    '#ffffff',
      'editor.selectionBackground': '#2040a0',
      // Suggestion / autocomplete widget
      'editorSuggestWidget.background':              '#1a1a40',
      'editorSuggestWidget.border':                  '#303070',
      'editorSuggestWidget.foreground':              '#cccccc',
      'editorSuggestWidget.selectedBackground':      '#2040a0',
      'editorSuggestWidget.selectedForeground':      '#ffffff',
      'editorSuggestWidget.highlightForeground':     '#60a0ff',
      'editorSuggestWidget.focusHighlightForeground':'#60a0ff',
    },
  });
}
