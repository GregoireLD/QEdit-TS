import { useEffect, useRef, useState } from 'react';
import Editor from '@monaco-editor/react';
import type * as MonacoNS from 'monaco-editor';
import { useQuestStore } from '../../stores/questStore';
import { useUiStore } from '../../stores/uiStore';
import { registerPsoAsm, definePsoTheme, LANGUAGE_ID } from './psoAsmLanguage';
import { disassemble, loadAsmTable, type DisasmResult } from '../../core/formats/disasm';
import { assemble } from '../../core/formats/assemble';
import { loadSidecar, saveSidecar, weaveSidecar, extractSidecar, type Sidecar } from '../../core/formats/sidecar';
import styles from './ScriptEditor.module.css';

function emptySidecarRef(): Sidecar {
  return { version: 1, comments: [], regions: [], inlineComments: [] };
}

export function ScriptEditor() {
  const quest             = useQuestStore(s => s.quest);
  const updateBin         = useQuestStore(s => s.updateBin);
  const saveVersion       = useQuestStore(s => s.saveVersion);
  const mainTab           = useUiStore(s => s.mainTab);
  const setScriptHasError = useUiStore(s => s.setScriptHasError);

  const [source, setSource]           = useState<string>('');
  const lineOffsetsRef                = useRef<number[]>([]);  // raw disasm offsets; sidecar extraction reads this
  const rawTextRef                    = useRef<string>('');    // raw disasm text; sidecar extraction reads this
  const [isDisasming, setIsDisasming] = useState(false);
  const [isCompiling, setIsCompiling] = useState(false);
  const [error, setError]             = useState<string | null>(null);
  const [compileOk, setCompileOk]     = useState(false);
  const [validMnemonics, setValidMnemonics] = useState<Set<string>>(new Set());

  const compileOkTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editorRef      = useRef<MonacoNS.editor.IStandaloneCodeEditor | null>(null);
  const monacoRef      = useRef<typeof MonacoNS | null>(null);
  // Stable refs so effects that depend only on mainTab can read the latest values
  const errorRef          = useRef<string | null>(null);
  const prevMainTabRef    = useRef(mainTab);
  const handleCompileRef  = useRef<() => void>(() => {});
  // In-memory sidecar: updated on compile, flushed to disk only on quest save
  const currentSidecarRef = useRef<Sidecar>(emptySidecarRef());
  // Set to true by handleCompile so the post-compile re-disassembly reuses the
  // in-memory sidecar rather than reloading from disk.
  const postCompileRef    = useRef(false);

  // Disassemble whenever quest changes, then weave sidecar comments in.
  // After a compile (postCompileRef) the in-memory sidecar is reused so edits
  // are not lost; on any other quest change it is reloaded from disk.
  useEffect(() => {
    if (!quest) { setSource('// No quest loaded'); return; }
    setIsDisasming(true);
    setError(null);
    errorRef.current = null;
    setScriptHasError(false);
    const filePath = useQuestStore.getState().filePath;
    const isPostCompile = postCompileRef.current;
    postCompileRef.current = false;
    disassemble(quest.bin)
      .then(async ({ text, lineOffsets }: DisasmResult) => {
        rawTextRef.current     = text;
        lineOffsetsRef.current = lineOffsets;
        let sidecar: Sidecar;
        if (isPostCompile) {
          sidecar = currentSidecarRef.current;
        } else {
          sidecar = await loadSidecar(filePath);
          currentSidecarRef.current = sidecar;
        }
        const { text: wovenText } = weaveSidecar(text, lineOffsets, sidecar);
        setSource(wovenText);
        setIsDisasming(false);
      })
      .catch(e => { setError(String(e)); setIsDisasming(false); });
  }, [quest]);

  // Load valid mnemonic set once (cached after first call)
  useEffect(() => {
    loadAsmTable().then(table => {
      setValidMnemonics(new Set(table.map(e => e.name)));
    });
  }, []);

  // Mark unknown mnemonics with red error markers in Monaco
  useEffect(() => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco || validMnemonics.size === 0) return;
    const model = editor.getModel();
    if (!model) return;

    const markers: MonacoNS.editor.IMarkerData[] = [];
    const lines = source.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      if (!raw.startsWith('\t') && !raw.startsWith(' ')) continue;
      // Strip comment
      let line = raw;
      let inStr = false;
      for (let j = 0; j < line.length; j++) {
        if (line[j] === "'") inStr = !inStr;
        if (!inStr && line[j] === '/' && line[j + 1] === '/') { line = line.slice(0, j); break; }
      }
      const trimmed = line.trim();
      if (!trimmed || /^STR:|^HEX:/.test(trimmed)) continue;
      const m = /^\s+(\S+)/.exec(line);
      if (!m || m[1].startsWith('//')) continue;
      const mnemonic = m[1];
      if (!validMnemonics.has(mnemonic)) {
        const col = raw.search(/\S/) + 1;
        markers.push({
          severity: monaco.MarkerSeverity.Error,
          message:  `Unknown mnemonic: "${mnemonic}"`,
          startLineNumber: i + 1, startColumn: col,
          endLineNumber:   i + 1, endColumn:   col + mnemonic.length,
        });
      }
    }
    monaco.editor.setModelMarkers(model, 'pso-asm', markers);
  }, [source, validMnemonics]);

  // Flush sidecar to disk whenever the quest is saved (saveVersion increments).
  useEffect(() => {
    if (saveVersion === 0) return;
    const filePath = useQuestStore.getState().filePath;
    saveSidecar(filePath, currentSidecarRef.current).catch(() => {});
  }, [saveVersion]);

  // Auto-compile when switching away from the Script tab.
  // Always attempt the compile so the assembler's line-numbered error message
  // ends up in the toolbar when the user switches back.
  // Only skip if a previous error is still unresolved (user hasn't edited yet).
  useEffect(() => {
    if (prevMainTabRef.current === 'script' && mainTab !== 'script') {
      if (!errorRef.current) {
        handleCompileRef.current();
      }
    }
    prevMainTabRef.current = mainTab;
  }, [mainTab]);

  async function handleCompile() {
    if (!quest || isCompiling) return;
    setIsCompiling(true);
    setError(null);
    errorRef.current = null;
    setCompileOk(false);

    // Extract and cache the sidecar in memory; it will be flushed to disk on
    // quest save.  Set postCompileRef so the re-disassembly triggered by
    // updateBin picks up this in-memory version instead of reading the disk.
    currentSidecarRef.current = extractSidecar(source, rawTextRef.current, lineOffsetsRef.current);
    postCompileRef.current = true;

    assemble(source, quest.bin)
      .then(newBin => {
        updateBin(newBin);
        setIsCompiling(false);
        setCompileOk(true);
        setScriptHasError(false);
        if (compileOkTimer.current) clearTimeout(compileOkTimer.current);
        compileOkTimer.current = setTimeout(() => setCompileOk(false), 3000);
      })
      .catch(e => {
        postCompileRef.current = false;
        const msg = String(e);
        setIsCompiling(false);
        setError(msg);
        errorRef.current = msg;
        setScriptHasError(true);
      });
  }
  // Keep ref up-to-date so auto-compile effect always calls the latest closure
  handleCompileRef.current = handleCompile;

  if (!quest) {
    return (
      <div className={styles.placeholder}>
        Open a quest to view the script
      </div>
    );
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.toolbar}>
        <span className={styles.label}>Script</span>
        <span className={styles.meta}>
          {quest.bin.bytecode.length.toLocaleString()} bytes bytecode
          · {quest.bin.functionRefs.length} labels
          · {quest.bin.dataBlocks.length} data blocks
        </span>
        {isDisasming && <span className={styles.loading}>Disassembling…</span>}
        {error && <span className={styles.err}>{error}</span>}
        <span style={{ flex: 1 }} />
        {compileOk && <span className={styles.ok}>Compiled</span>}
        {isCompiling && <span className={styles.loading}>Compiling…</span>}
        <button
          className={styles.compileBtn}
          onClick={handleCompile}
          disabled={isCompiling || isDisasming}
        >
          Compile
        </button>
      </div>

      <div className={styles.editor}>
        <Editor
          beforeMount={m => { registerPsoAsm(m); definePsoTheme(m); }}
          onMount={(editor, monaco) => {
            editorRef.current = editor;
            monacoRef.current = monaco as unknown as typeof MonacoNS;
          }}
          language={LANGUAGE_ID}
          theme="pso-dark"
          value={source}
          onChange={v => {
            setSource(v ?? '');
            // Re-enable auto-compile on next tab switch, but keep the error message
            // visible so the user sees what failed (it clears when compile starts)
            errorRef.current = null;
          }}
          options={{
            fontSize: 13,
            fontFamily: "'JetBrains Mono', 'Cascadia Code', 'Consolas', monospace",
            fontLigatures: true,
            lineNumbers: 'on',
            minimap: { enabled: true, scale: 1 },
            scrollBeyondLastLine: false,
            wordWrap: 'off',
            renderWhitespace: 'none',
            bracketPairColorization: { enabled: false },
            folding: true,
            glyphMargin: false,
            overviewRulerLanes: 0,
            hideCursorInOverviewRuler: true,
            scrollbar: {
              verticalScrollbarSize: 8,
              horizontalScrollbarSize: 8,
            },
            padding: { top: 8, bottom: 8 },
            automaticLayout: true,
            fixedOverflowWidgets: true,
            suggestFontSize: 13,
            suggestLineHeight: 22,
          }}
        />
      </div>
    </div>
  );
}
