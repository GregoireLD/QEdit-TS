import { useEffect, useRef, useState } from 'react';
import Editor from '@monaco-editor/react';
import type * as MonacoNS from 'monaco-editor';
import { useQuestStore } from '../../stores/questStore';
import { useUiStore } from '../../stores/uiStore';
import { registerPsoAsm, definePsoTheme, LANGUAGE_ID } from './psoAsmLanguage';
import { disassemble, loadAsmTable } from '../../core/formats/disasm';
import { assemble } from '../../core/formats/assemble';
import styles from './ScriptEditor.module.css';

export function ScriptEditor() {
  const quest             = useQuestStore(s => s.quest);
  const updateBin         = useQuestStore(s => s.updateBin);
  const mainTab           = useUiStore(s => s.mainTab);
  const setScriptHasError = useUiStore(s => s.setScriptHasError);

  const [source, setSource]           = useState<string>('');
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

  // Disassemble whenever quest changes; also reset error state (fresh content)
  useEffect(() => {
    if (!quest) { setSource('// No quest loaded'); return; }
    setIsDisasming(true);
    setError(null);
    errorRef.current = null;
    setScriptHasError(false);
    disassemble(quest.bin)
      .then(text => { setSource(text); setIsDisasming(false); })
      .catch(e  => { setError(String(e)); setIsDisasming(false); });
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

  function handleCompile() {
    if (!quest || isCompiling) return;
    setIsCompiling(true);
    setError(null);
    errorRef.current = null;
    setCompileOk(false);
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
            folding: false,
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
