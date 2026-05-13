import { useState, useRef, useEffect } from 'react';
import { useQuestStore } from '../../stores/questStore';
import { useUiStore } from '../../stores/uiStore';
import { isTauri } from '../../platform/index';
import { openDirectoryDialog, openFileDialog } from '../../platform/fs';
import { openNewQuestWindow, openExistingQuestWindow, focusQuestWindow, getAllQuestWindows } from '../../platform/windows';
import type { QuestWindowInfo } from '../../platform/windows';
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

type ReplaceGuard = { action: () => Promise<void>; verb: string } | null;

export function TopBar() {
  const { quest, filePath, isLoading, newQuest, openQuest, openQuestFromUrl, saveQuest, saveQuestAsFormat, savedFormat } = useQuestStore();
  const { dataDir, setDataDir } = useUiStore();
  const [showNewMenu,       setShowNewMenu]       = useState(false);
  const [showCompatChecker, setShowCompatChecker] = useState(false);
  const [showSaveAs,        setShowSaveAs]        = useState(false);
  const [saveCheck,         setSaveCheck]         = useState<SaveCheckState>({ phase: 'idle' });
  const [replaceGuard,      setReplaceGuard]      = useState<ReplaceGuard>(null);
  const [recentFiles,       setRecentFiles]       = useState<string[]>([]);
  const [showRecentMenu,    setShowRecentMenu]    = useState(false);
  const [windowList,        setWindowList]        = useState<QuestWindowInfo[]>([]);
  const [showWindowMenu,    setShowWindowMenu]    = useState(false);
  const newMenuRef    = useRef<HTMLDivElement>(null);
  const recentMenuRef = useRef<HTMLDivElement>(null);
  const windowMenuRef = useRef<HTMLDivElement>(null);

  async function handleSaveAsConfirm(format: SaveFormat) {
    const saved = await saveQuestAsFormat(format);
    if (saved) setShowSaveAs(false);
  }

  function guardDirty(action: () => Promise<void>, verb: string) {
    if (!useQuestStore.getState().isDirty) { void action(); return; }
    setReplaceGuard({ action, verb });
  }

  async function handleReplaceDiscard() {
    const { action } = replaceGuard!;
    setReplaceGuard(null);
    await action();
  }

  async function handleReplaceSave() {
    await saveQuest();
    const { action } = replaceGuard!;
    setReplaceGuard(null);
    if (!useQuestStore.getState().isDirty) await action();
    // If save failed the error toast shows; dialog closes so the user isn't stuck.
  }

  async function handleNewQuest(episode: 1 | 2 | 4) {
    setShowNewMenu(false);
    if (isTauri()) {
      try {
        await openNewQuestWindow(episode);
      } catch (e) {
        useQuestStore.setState({ error: String(e) });
      }
    } else {
      guardDirty(async () => newQuest(episode), 'Create');
    }
  }

  async function handleOpenQuest() {
    if (isTauri()) {
      try {
        const opened = await openFileDialog({
          title:   'Open Quest',
          filters: [{ name: 'PSO Quest', extensions: ['qst', 'bin', 'qpv3'] }],
        });
        if (opened) await openExistingQuestWindow(opened.path);
      } catch (e) {
        useQuestStore.setState({ error: String(e) });
      }
    } else {
      guardDirty(() => openQuest(), 'Open');
    }
  }

  async function handleOpenQuestFromUrl() {
    guardDirty(() => openQuestFromUrl(), 'Open');
  }

  async function handleOpenRecentMenu() {
    if (isTauri()) {
      const { invoke } = await import('@tauri-apps/api/core');
      const files = await invoke<string[]>('get_recent_files');
      setRecentFiles(files);
    }
    setShowRecentMenu(v => !v);
    setShowWindowMenu(false);
  }

  async function handleOpenRecent(path: string) {
    setShowRecentMenu(false);
    try {
      await openExistingQuestWindow(path);
    } catch (e) {
      useQuestStore.setState({ error: String(e) });
    }
  }

  async function handleOpenWindowMenu() {
    setWindowList(await getAllQuestWindows());
    setShowWindowMenu(v => !v);
    setShowRecentMenu(false);
  }

  async function handleFocusWindow(label: string) {
    setShowWindowMenu(false);
    await focusQuestWindow(label);
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
      const t = e.target as Node;
      if (newMenuRef.current    && !newMenuRef.current.contains(t))    setShowNewMenu(false);
      if (recentMenuRef.current && !recentMenuRef.current.contains(t)) setShowRecentMenu(false);
      if (windowMenuRef.current && !windowMenuRef.current.contains(t)) setShowWindowMenu(false);
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
              <button onClick={() => handleNewQuest(1)}>Episode 1</button>
              <button onClick={() => handleNewQuest(2)}>Episode 2</button>
              <button onClick={() => handleNewQuest(4)}>Episode 4</button>
            </div>
          )}
        </div>
        <button onClick={handleOpenQuest} disabled={isLoading}>Open…</button>
        {isTauri() && (
          <div className={styles.newMenu} ref={recentMenuRef}>
            <button onClick={handleOpenRecentMenu} disabled={isLoading}>Recent ▾</button>
            {showRecentMenu && (
              <div className={styles.dropdown}>
                {recentFiles.length === 0
                  ? <button disabled style={{ color: 'var(--text-dim)', cursor: 'default' }}>No recent files</button>
                  : recentFiles.map(path => (
                      <button key={path} onClick={() => handleOpenRecent(path)} title={path}>
                        {path.split(/[\\/]/).pop()}
                      </button>
                    ))
                }
              </div>
            )}
          </div>
        )}
        {!isTauri() && (
          <button onClick={handleOpenQuestFromUrl} disabled={isLoading}>Open URL…</button>
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
        {isTauri() && (
          <div className={styles.newMenu} ref={windowMenuRef}>
            <button onClick={handleOpenWindowMenu}>Window ▾</button>
            {showWindowMenu && (
              <div className={styles.dropdown}>
                {windowList.map(({ label, title, isCurrent }) => (
                  <button
                    key={label}
                    onClick={() => handleFocusWindow(label)}
                    style={isCurrent ? { fontWeight: 'bold' } : undefined}
                    title={label}
                  >
                    {isCurrent ? '✓ ' : '  '}{title || label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
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

      {replaceGuard && (
        <div className="close-confirm-overlay">
          <div className="close-confirm-dialog">
            <div className="close-confirm-header">Unsaved Changes</div>
            <div className="close-confirm-body">
              {quest?.bin.title
                ? <>Save changes to <strong>{quest.bin.title}</strong> before {replaceGuard.verb.toLowerCase()}?</>
                : `Save changes before ${replaceGuard.verb.toLowerCase()}?`}
              {!filePath && (
                <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text-dim)', fontStyle: 'italic' }}>
                  This quest has not been saved yet. Use Save As… to save it first.
                </div>
              )}
            </div>
            <div className="close-confirm-footer">
              <button onClick={() => setReplaceGuard(null)}>Cancel</button>
              <button className="close-discard-btn" onClick={handleReplaceDiscard}>
                Discard
              </button>
              {filePath && (
                <button className="close-save-btn" onClick={handleReplaceSave}>
                  Save and {replaceGuard.verb}
                </button>
              )}
            </div>
          </div>
        </div>
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
