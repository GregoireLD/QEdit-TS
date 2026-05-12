import { useState, useRef, useEffect } from 'react';
import { useQuestStore } from '../../stores/questStore';
import { useUiStore } from '../../stores/uiStore';
import { isTauri } from '../../platform/index';
import { openDirectoryDialog } from '../../platform/fs';
import { CompatChecker } from '../compat-checker/CompatChecker';
import { SaveAsDialog } from '../save-as-dialog/SaveAsDialog';
import { SaveConfirmDialog } from '../save-confirm-dialog/SaveConfirmDialog';
import type { SaveCheckIssue } from '../save-confirm-dialog/SaveConfirmDialog';
import { checkCompatibility } from '../../core/compatibility';
import type { VersionIndex } from '../../core/compatibility';
import { formatPlacementWarning } from '../../core/placement';
import { loadAllPlacementWarnings } from '../../core/loadPlacement';
import { defaultSaveFormat, describeSavedFormat } from '../../core/saveFormat';
import styles from './TopBar.module.css';
import type { SaveFormat, TargetPlatform } from '../../core/model/types';

function platformToVerIdx(platform: TargetPlatform): VersionIndex {
  if (platform === 'DC')           return 0;
  if (platform === 'PC' || platform === 'Xbox') return 1;
  if (platform === 'GC')           return 2;
  return 3; // BB
}

type SaveCheckState =
  | { phase: 'idle' }
  | { phase: 'checking' }
  | { phase: 'confirm'; issues: SaveCheckIssue[]; fmt: SaveFormat };

export function TopBar() {
  const { quest, filePath, isLoading, newQuest, openQuest, openQuestFromUrl, saveQuest, saveQuestAsFormat, savedFormat } = useQuestStore();
  const { dataDir, setDataDir } = useUiStore();
  const [showNewMenu,       setShowNewMenu]       = useState(false);
  const [showCompatChecker, setShowCompatChecker] = useState(false);
  const [showSaveAs,        setShowSaveAs]        = useState(false);
  const [saveCheck,         setSaveCheck]         = useState<SaveCheckState>({ phase: 'idle' });
  const newMenuRef = useRef<HTMLDivElement>(null);

  async function handleSaveAsConfirm(format: SaveFormat) {
    const saved = await saveQuestAsFormat(format);
    if (saved) setShowSaveAs(false);
  }

  async function handleSelectDataDir() {
    const sel = await openDirectoryDialog('Select PSO data folder (containing map/, monster/, obj/)');
    if (sel) setDataDir(sel);
  }

  async function handleDirectSave() {
    if (!quest || !filePath) return;

    const fmt = savedFormat ?? defaultSaveFormat(quest);

    // QPv3/project are lossless authoring formats — no PSO constraints, skip checks
    if (fmt.packaging === 'qpv3' || fmt.packaging === 'project') {
      await saveQuest();
      return;
    }

    setSaveCheck({ phase: 'checking' });
    try {
      const verIdx = platformToVerIdx(fmt.platform);
      const [compatIssues, placementWarns] = await Promise.all([
        checkCompatibility(quest, verIdx),
        dataDir ? loadAllPlacementWarnings(quest, dataDir) : Promise.resolve([]),
      ]);

      const issues: SaveCheckIssue[] = [
        ...compatIssues,
        ...placementWarns.map(w => ({ severity: 'warning' as const, message: formatPlacementWarning(w) })),
      ];

      if (issues.length === 0) {
        setSaveCheck({ phase: 'idle' });
        await saveQuest();
      } else {
        setSaveCheck({ phase: 'confirm', issues, fmt });
      }
    } catch {
      // Check failed — save anyway rather than blocking the user
      setSaveCheck({ phase: 'idle' });
      await saveQuest();
    }
  }

  async function handleSaveAnyway() {
    setSaveCheck({ phase: 'idle' });
    await saveQuest();
  }

  function handleSaveConfirmSaveAs() {
    setSaveCheck({ phase: 'idle' });
    setShowSaveAs(true);
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
  const isChecking = saveCheck.phase === 'checking';

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
        <button
          onClick={filePath ? handleDirectSave : () => setShowSaveAs(true)}
          disabled={!quest || isLoading || isChecking}
        >
          {isChecking ? 'Checking…' : filePath ? 'Save' : 'Save As…'}
        </button>
        {filePath && (
          <button onClick={() => setShowSaveAs(true)} disabled={!quest || isLoading}>Save As…</button>
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
      {showSaveAs && (
        <SaveAsDialog
          onClose={() => setShowSaveAs(false)}
          onConfirm={handleSaveAsConfirm}
        />
      )}
      {saveCheck.phase === 'confirm' && (
        <SaveConfirmDialog
          formatLabel={describeSavedFormat(saveCheck.fmt)}
          issues={saveCheck.issues}
          onCancel={() => setSaveCheck({ phase: 'idle' })}
          onSaveAs={handleSaveConfirmSaveAs}
          onSaveAnyway={handleSaveAnyway}
        />
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
