import { useState, useEffect, useRef } from 'react';
import { useQuestStore } from './stores/questStore';
import { useUiStore } from './stores/uiStore';
import { isTauri } from './platform/index';
import { WelcomeScreen } from './components/welcome/WelcomeScreen';
import { TopBar } from './components/layout/TopBar';
import { Sidebar } from './components/layout/Sidebar';
import { FloorView } from './components/map-editor/FloorView';
import { ScriptEditor } from './components/script-editor/ScriptEditor';
import { MetadataEditor } from './components/metadata-editor/MetadataEditor';
import { SaveConfirmDialog } from './components/save-confirm-dialog/SaveConfirmDialog';
import type { SaveCheckIssue } from './components/save-confirm-dialog/SaveConfirmDialog';
import { SaveAsDialog } from './components/save-as-dialog/SaveAsDialog';
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

// Converts a file:// URL from tauri-plugin-deep-link into a plain filesystem path.
function deepLinkUrlToPath(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.protocol !== 'file:') return null;
    return decodeURIComponent(u.pathname);
  } catch {
    return null;
  }
}

function platformToVerIdx(platform: TargetPlatform): VersionIndex {
  if (platform === 'DC')                    return 0;
  if (platform === 'PC' || platform === 'Xbox') return 1;
  if (platform === 'GC')                    return 2;
  return 3; // BB
}

export default function App() {
  const { error, clearError, quest, filePath, saveQuest, saveQuestAsFormat, savedFormat, newQuest, openQuestFromPath } = useQuestStore();
  const { mainTab, setMainTab, scriptHasError, dataDir } = useUiStore();
  const isDirty = useQuestStore(s => s.isDirty);
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  const [showSaveAsForClose, setShowSaveAsForClose] = useState(false);
  const [closeCheck, setCloseCheck]             = useState<CloseCheckState>({ phase: 'idle' });
  const doClose      = useRef<(() => void) | null>(null);
  // Set to true before calling win.close() so the handler doesn't re-intercept.
  const forcingClose = useRef(false);
  const hasExpanded  = useRef(false);

  // Route quest context passed via URL params (used by multi-window spawning on Tauri).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const newEp   = params.get('new');
    const questPath = params.get('path');
    if (newEp) {
      const ep = parseInt(newEp, 10);
      if (ep === 1 || ep === 2 || ep === 4) newQuest(ep as 1 | 2 | 4);
    } else if (questPath) {
      void openQuestFromPath(decodeURIComponent(questPath));
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- intentional mount-only

  // Expand from welcome size (760×500) to full editor size when a quest first loads.
  // Spawned windows (?new / ?path) already start at full size, so skip them.
  useEffect(() => {
    if (!isTauri() || !quest || hasExpanded.current) return;
    const params = new URLSearchParams(window.location.search);
    if (params.has('new') || params.has('path')) { hasExpanded.current = true; return; }
    hasExpanded.current = true;
    (async () => {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      const { LogicalSize }      = await import('@tauri-apps/api/dpi');
      const win = getCurrentWindow();
      await win.setMinSize(new LogicalSize(1024, 700));
      await win.setSize(new LogicalSize(1400, 900));
      await win.center();
    })();
  }, [quest]); // eslint-disable-line react-hooks/exhaustive-deps

  // macOS dirty-window indicator (red close button with dot)
  useEffect(() => {
    if (!isTauri()) return;
    import('@tauri-apps/api/core').then(({ invoke }) =>
      invoke('set_document_edited', { edited: isDirty })
    );
  }, [isDirty]);

  // Sync the OS window title with the current quest state.
  const questTitle = quest?.bin.title ?? null;
  useEffect(() => {
    if (!isTauri()) return;
    const fileName = filePath ? filePath.split(/[\\/]/).pop() ?? null : null;
    let title: string;
    if (questTitle && fileName)  title = `${questTitle} — ${fileName}`;
    else if (questTitle)         title = questTitle;
    else if (fileName)           title = fileName;
    else                         title = 'QEdit';
    // On Windows/Linux there is no red dot; prefix with a bullet for dirty state.
    const isMac = /Mac/.test(navigator.userAgent) && !/iPhone/.test(navigator.userAgent);
    if (isDirty && !isMac) title = `● ${title}`;
    import('@tauri-apps/api/window').then(({ getCurrentWindow }) =>
      getCurrentWindow().setTitle(title)
    );
  }, [questTitle, filePath, isDirty]);

  // Track recently opened/saved files (Tauri only; skip URLs).
  const prevFilePath = useRef<string | null>(null);
  useEffect(() => {
    if (!isTauri() || !filePath || filePath === prevFilePath.current) return;
    if (filePath.startsWith('http://') || filePath.startsWith('https://')) return;
    prevFilePath.current = filePath;
    import('@tauri-apps/api/core').then(({ invoke }) =>
      invoke('add_recent_file', { path: filePath })
    );
  }, [filePath]);

  useEffect(() => {
    if (isTauri()) {
      let unlisten:          (() => void) | undefined;
      let unlistenWantsQuit: (() => void) | undefined;
      let unlistenOpenFile:  (() => void) | undefined;
      (async () => {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        const { invoke }           = await import('@tauri-apps/api/core');
        const win = getCurrentWindow();

        // macOS: tauri-plugin-deep-link intercepts application:openURLs: before tao's
        // run-callback is set up, so getCurrent() safely returns any launch-time file URL.
        const { getCurrent, onOpenUrl } = await import('@tauri-apps/plugin-deep-link');
        const launchUrls = await getCurrent();
        if (launchUrls && launchUrls.length > 0) {
          const path = deepLinkUrlToPath(launchUrls[0]);
          if (path) void useQuestStore.getState().openQuestFromPath(path);
        }

        // Windows / Linux: file associations pass the path via argv[1] (Rust side).
        const startupFile = await invoke<string | null>('get_startup_file');
        if (startupFile) {
          void useQuestStore.getState().openQuestFromPath(startupFile);
        }

        unlisten = await win.onCloseRequested((event) => {
          if (!forcingClose.current && useQuestStore.getState().isDirty) {
            event.preventDefault();
            doClose.current = () => { forcingClose.current = true; void win.close(); };
            setShowCloseConfirm(true);
          }
        });

        // Rust broadcasts this to all windows when Cmd+Q / Quit is triggered.
        // Each window handles its own dirty state; Rust exits when the last window closes.
        unlistenWantsQuit = await win.listen('wants-quit', () => {
          if (useQuestStore.getState().isDirty) {
            doClose.current = () => { forcingClose.current = true; void win.close(); };
            setShowCloseConfirm(true);
          } else {
            forcingClose.current = true;
            void win.close();
          }
        });

        // macOS: files opened while the app is already running.
        unlistenOpenFile = await onOpenUrl((urls) => {
          const path = urls.length > 0 ? deepLinkUrlToPath(urls[0]) : null;
          if (!path) return;
          if (!useQuestStore.getState().quest) {
            void useQuestStore.getState().openQuestFromPath(path);
          } else {
            void import('./platform/windows').then(({ openExistingQuestWindow }) =>
              openExistingQuestWindow(path)
            );
          }
        });
      })();
      return () => { unlisten?.(); unlistenWantsQuit?.(); unlistenOpenFile?.(); };
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

  function handleCloseSaveAs() {
    setShowCloseConfirm(false);
    setShowSaveAsForClose(true);
  }

  async function handleSaveAsForCloseConfirm(format: import('./core/model/types').SaveFormat) {
    const saved = await saveQuestAsFormat(format);
    if (saved) {
      setShowSaveAsForClose(false);
      forcingClose.current = true;
      doClose.current?.();
    }
  }

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

  return (
    <div className="app">
      {!quest ? (
        <WelcomeScreen />
      ) : (
        <>
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
        </>
      )}

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
            </div>
            <div className="close-confirm-footer">
              <button onClick={() => setShowCloseConfirm(false)}>Cancel</button>
              <button className="close-discard-btn" onClick={handleCloseDiscard}>Discard and Close</button>
              {filePath
                ? <button className="close-save-btn" onClick={handleCloseSave}>Save and Close</button>
                : <button className="close-save-btn" onClick={handleCloseSaveAs}>Save As…</button>
              }
            </div>
          </div>
        </div>
      )}

      {showSaveAsForClose && (
        <SaveAsDialog
          onClose={() => setShowSaveAsForClose(false)}
          onConfirm={handleSaveAsForCloseConfirm}
        />
      )}
    </div>
  );
}
