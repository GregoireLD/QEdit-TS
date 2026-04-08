import { useEffect, useRef, useState } from 'react';
import Editor, { useMonaco } from '@monaco-editor/react';
import { useQuestStore } from '../../stores/questStore';
import { registerPsoAsm, definePsoTheme, LANGUAGE_ID } from './psoAsmLanguage';
import { disassemble } from '../../core/formats/disasm';
import styles from './ScriptEditor.module.css';

export function ScriptEditor() {
  const quest = useQuestStore(s => s.quest);
  const monaco = useMonaco();
  const [source, setSource] = useState<string>('');
  const [isDisasming, setIsDisasming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = useRef(false);

  // Register language + theme once Monaco is loaded
  useEffect(() => {
    if (!monaco || ready.current) return;
    ready.current = true;
    registerPsoAsm(monaco);
    definePsoTheme(monaco);
  }, [monaco]);

  // Disassemble whenever quest changes
  useEffect(() => {
    if (!quest) { setSource('// No quest loaded'); return; }
    setIsDisasming(true);
    setError(null);
    disassemble(quest.bin)
      .then(text => { setSource(text); setIsDisasming(false); })
      .catch(e  => { setError(String(e)); setIsDisasming(false); });
  }, [quest]);

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
      </div>

      <div className={styles.editor}>
        <Editor
          language={LANGUAGE_ID}
          theme="pso-dark"
          value={source}
          onChange={v => setSource(v ?? '')}
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
          }}
        />
      </div>
    </div>
  );
}
