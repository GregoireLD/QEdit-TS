import { useState, useEffect, useRef } from 'react';
import { useQuestStore } from './stores/questStore';
import { useUiStore } from './stores/uiStore';
import { isTauri } from './platform/index';
import { TopBar } from './components/layout/TopBar';
import { Sidebar } from './components/layout/Sidebar';
import { FloorView } from './components/map-editor/FloorView';
import { ScriptEditor } from './components/script-editor/ScriptEditor';
import { MetadataEditor } from './components/metadata-editor/MetadataEditor';
import { SaveConfirmDialog } from './components/save-confirm-dialog/SaveConfirmDialog';
import type { SaveCheckIssue } from './components/save-confirm-dialog/SaveConfirmDialog';
import { checkCompatibility } from './core/compatibility';
import type { VersionIndex } from './core/compatibility';
import { formatPlacementWarning } from './core/placement';
import { loadAllPlacementWarnings } from './core/loadPlacement';
import { defaultSaveFormat, describeSavedFormat } from './core/saveFormat';
import type { SaveFormat, TargetPlatform } from './core/model/types';
import './App.css';

type CloseCheckState =
  | { phase: 'idle' }
  | { phase: 'confirm'; issues: SaveCheckIssue[]; fmt: SaveFormat };

function platformToVerIdx(platform: TargetPlatform): VersionIndex {
  if (platform === 'DC')                    return 0;
  if (platform === 'PC' || platform === 'Xbox') return 1;
  if (platform === 'GC')                    return 2;
  return 3; // BB
}

export default function App() {
  const { error, clearError, quest, filePath, saveQuest, savedFormat } = useQuestStore();
  const { mainTab, setMainTab, scriptHasError, dataDir } = useUiStore();
  const isDirty = useQuestStore(s => s.isDirty);
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  const [closeCheck, setCloseCheck]             = useState<CloseCheckState>({ phase: 'idle' });
  const doClose      = useRef<(() => void) | null>(null);
  // Set to true before calling win.close() so the handler doesn't re-intercept
  const forcingClose = useRef(false);

  // macOS dirty-window indicator (red close button with dot)
  useEffect(() => {
    if (!isTauri()) return;
    import('@tauri-apps/api/core').then(({ invoke }) =>
      invoke('set_document_edited', { edited: isDirty })
    );
  }, [isDirty]);

  useEffect(() => {
    if (isTauri()) {
      let unlisten:     (() => void) | undefined;
      let unlistenQuit: (() => void) | undefined;
      (async () => {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        const { invoke }           = await import('@tauri-apps/api/core');
        const win = getCurrentWindow();
        unlisten = await win.onCloseRequested((event) => {
          if (!forcingClose.current && useQuestStore.getState().isDirty) {
            event.preventDefault();
            doClose.current = () => win.close();
            setShowCloseConfirm(true);
          }
        });
        unlistenQuit = await win.listen('menu-quit', () => {
          if (useQuestStore.getState().isDirty) {
            doClose.current = async () => { await invoke('quit_app'); };
            setShowCloseConfirm(true);
          } else {
            void invoke('quit_app');
          }
        });
      })();
      return () => { unlisten?.(); unlistenQuit?.(); };
    } else {
      const handler = (e: BeforeUnloadEvent) => {
        if (useQuestStore.getState().isDirty) {
          e.preventDefault();
          e.returnValue = '';
        }
      };
      window.addEventListener('beforeunload', handler);
      return () => window.removeEventListener('beforeunload', handler);
    }
  }, []);

  async function handleCloseDiscard() {
    setShowCloseConfirm(false);
    forcingClose.current = true;
    doClose.current?.();
  }

  async function handleCloseSave() {
    setShowCloseConfirm(false);
    if (!filePath || !quest) return;

    const fmt = savedFormat ?? defaultSaveFormat(quest);

    // QPv3/project are lossless — no PSO constraints to check
    if (fmt.packaging === 'qpv3' || fmt.packaging === 'project') {
      await saveQuest();
      if (!useQuestStore.getState().isDirty) doClose.current?.();
      return;
    }

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
        await saveQuest();
        if (!useQuestStore.getState().isDirty) doClose.current?.();
      } else {
        setCloseCheck({ phase: 'confirm', issues, fmt });
      }
    } catch {
      // Check failed — save anyway rather than blocking the close
      await saveQuest();
      if (!useQuestStore.getState().isDirty) doClose.current?.();
    }
  }

  async function handleCloseSaveAnyway() {
    setCloseCheck({ phase: 'idle' });
    await saveQuest();
    if (!useQuestStore.getState().isDirty) doClose.current?.();
  }

  const questTitle = quest?.bin.title || null;

  return (
    <div className="app">
      <TopBar />
      <div className="body">
        <Sidebar />
        <main className="main">
          <div className="main-tabs">
            <button
              className={`main-tab ${mainTab === 'map' ? 'active' : ''}`}
              onClick={() => setMainTab('map')}
            >
              Map / Data
            </button>
            <button
              className={`main-tab ${mainTab === 'script' ? 'active' : ''}`}
              onClick={() => setMainTab('script')}
            >
              Script{scriptHasError && <span className="tab-error-dot" />}
            </button>
            <button
              className={`main-tab ${mainTab === 'metadata' ? 'active' : ''}`}
              onClick={() => setMainTab('metadata')}
            >
              Metadata
            </button>
          </div>
          <div className="main-content">
            {mainTab === 'map'      && <FloorView />}
            {/* ScriptEditor stays mounted so its auto-compile effect can fire on tab change */}
            <div style={{ display: mainTab === 'script' ? 'flex' : 'none', flex: 1, flexDirection: 'column', overflow: 'hidden' }}>
              <ScriptEditor />
            </div>
            {mainTab === 'metadata' && <MetadataEditor />}
          </div>
        </main>
      </div>

      {error && (
        <div className="error-toast" onClick={clearError}>
          <strong>Error:</strong> {error}
          <span className="error-dismiss">✕</span>
        </div>
      )}

      {closeCheck.phase === 'confirm' && (
        <SaveConfirmDialog
          formatLabel={describeSavedFormat(closeCheck.fmt)}
          issues={closeCheck.issues}
          onCancel={() => setCloseCheck({ phase: 'idle' })}
          onSaveAs={() => setCloseCheck({ phase: 'idle' })}
          onSaveAnyway={handleCloseSaveAnyway}
        />
      )}

      {showCloseConfirm && (
        <div className="close-confirm-overlay">
          <div className="close-confirm-dialog">
            <div className="close-confirm-header">Unsaved Changes</div>
            <div className="close-confirm-body">
              {questTitle
                ? <>Save changes to <strong>{questTitle}</strong> before closing?</>
                : 'Save changes before closing?'}
              {!filePath && (
                <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text-dim)', fontStyle: 'italic' }}>
                  This quest has not been saved yet. Use Save As… to save it first.
                </div>
              )}
            </div>
            <div className="close-confirm-footer">
              <button onClick={() => setShowCloseConfirm(false)}>Cancel</button>
              <button className="close-discard-btn" onClick={handleCloseDiscard}>
                Discard and Close
              </button>
              {filePath && (
                <button className="close-save-btn" onClick={handleCloseSave}>
                  Save and Close
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
