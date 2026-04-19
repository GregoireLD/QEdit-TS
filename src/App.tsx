import { useQuestStore } from './stores/questStore';
import { useUiStore } from './stores/uiStore';
import { TopBar } from './components/layout/TopBar';
import { Sidebar } from './components/layout/Sidebar';
import { FloorView } from './components/map-editor/FloorView';
import { ScriptEditor } from './components/script-editor/ScriptEditor';
import { MetadataEditor } from './components/metadata-editor/MetadataEditor';
import './App.css';

export default function App() {
  const { error, clearError } = useQuestStore();
  const { mainTab, setMainTab, scriptHasError } = useUiStore();

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
    </div>
  );
}
