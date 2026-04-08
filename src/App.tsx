import { useQuestStore } from './stores/questStore';
import { useUiStore } from './stores/uiStore';
import { TopBar } from './components/layout/TopBar';
import { Sidebar } from './components/layout/Sidebar';
import { FloorView } from './components/map-editor/FloorView';
import { ScriptEditor } from './components/script-editor/ScriptEditor';
import { MetadataEditor } from './components/metadata-editor/MetadataEditor';
import { Viewer3D } from './components/viewer-3d/Viewer3D';
import './App.css';

export default function App() {
  const { error, clearError } = useQuestStore();
  const { mainTab, setMainTab } = useUiStore();

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
              Script
            </button>
            <button
              className={`main-tab ${mainTab === 'metadata' ? 'active' : ''}`}
              onClick={() => setMainTab('metadata')}
            >
              Metadata
            </button>
            <button
              className={`main-tab ${mainTab === '3d' ? 'active' : ''}`}
              onClick={() => setMainTab('3d')}
            >
              3D
            </button>
          </div>
          <div className="main-content">
            {mainTab === 'map'      && <FloorView />}
            {mainTab === 'script'   && <ScriptEditor />}
            {mainTab === 'metadata' && <MetadataEditor />}
            {mainTab === '3d'       && <Viewer3D />}
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
