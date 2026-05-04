import { useState, useRef, useEffect } from 'react';
import { useQuestStore } from '../../stores/questStore';
import { useUiStore } from '../../stores/uiStore';
import { isTauri } from '../../platform/index';
import { openDirectoryDialog } from '../../platform/fs';
import { CompatChecker } from '../compat-checker/CompatChecker';
import styles from './TopBar.module.css';

export function TopBar() {
  const { quest, filePath, isLoading, newQuest, openQuest, openQuestFromUrl, saveQuest, saveQuestAs } = useQuestStore();
  const { dataDir, setDataDir } = useUiStore();
  const [showNewMenu, setShowNewMenu]         = useState(false);
  const [showCompatChecker, setShowCompatChecker] = useState(false);
  const newMenuRef = useRef<HTMLDivElement>(null);

  async function handleSelectDataDir() {
    const sel = await openDirectoryDialog('Select PSO data folder (containing map/, monster/, obj/)');
    if (sel) setDataDir(sel);
  }

  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (newMenuRef.current && !newMenuRef.current.contains(e.target as Node))
        setShowNewMenu(false);
    }
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, []);

  const title = quest?.bin.title ?? '';
  const fileName = filePath ? filePath.split('/').pop() ?? filePath : null;

  return (
    <header className={styles.bar}>
      <span className={styles.appName}>QEdit</span>

      <div className={styles.actions}>
        <div className={styles.newMenu} ref={newMenuRef}>
          <button onClick={() => setShowNewMenu(v => !v)} disabled={isLoading}>New ▾</button>
          {showNewMenu && (
            <div className={styles.dropdown}>
              <button onClick={() => { newQuest(1); setShowNewMenu(false); }}>Episode 1</button>
              <button onClick={() => { newQuest(2); setShowNewMenu(false); }}>Episode 2</button>
              <button onClick={() => { newQuest(4); setShowNewMenu(false); }}>Episode 4</button>
            </div>
          )}
        </div>
        <button onClick={openQuest} disabled={isLoading}>Open…</button>
        {!isTauri() && (
          <button onClick={openQuestFromUrl} disabled={isLoading}>Open URL…</button>
        )}
        <button onClick={filePath ? saveQuest : saveQuestAs} disabled={!quest || isLoading}>
          {filePath ? 'Save' : 'Save As…'}
        </button>
        {filePath && (
          <button onClick={saveQuestAs} disabled={!quest || isLoading}>Save As…</button>
        )}
        <button
          onClick={handleSelectDataDir}
          title={dataDir ? `Data folder: ${dataDir}` : 'Select PSO data folder'}
          style={!dataDir ? { color: '#ff9800' } : undefined}
        >
          {dataDir ? 'Data Folder' : 'Data Folder…'}
        </button>
        <button
          onClick={() => setShowCompatChecker(true)}
          disabled={!quest}
          title="Check quest compatibility against DC, PC, GC, and BB"
        >
          Compat Check
        </button>
      </div>

      {showCompatChecker && (
        <CompatChecker onClose={() => setShowCompatChecker(false)} />
      )}

      <div className={styles.questInfo}>
        {quest && (
          <>
            <span className={styles.questTitle}>{title || '(no title)'}</span>
            <span className={styles.questMeta}>
              #{quest.bin.questNumber} · {quest.bin.version} · {quest.format}
            </span>
            {fileName && <span className={styles.fileName}>{fileName}</span>}
          </>
        )}
        {isLoading && <span className={styles.loading}>Loading…</span>}
      </div>
    </header>
  );
}
