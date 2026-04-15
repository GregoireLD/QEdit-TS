import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

// Use the locally installed monaco-editor package instead of the default CDN
// AMD loader. This avoids a loader.js.map 404 that the CDN path produces.
import { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
// Vite's ?worker suffix is the most reliable way to bundle a worker — it is
// processed at build time rather than resolved at runtime, so the worker file
// is always emitted and its URL is always correct.
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';

(self as unknown as Record<string, unknown>).MonacoEnvironment = {
  getWorker: () => new EditorWorker(),
};

loader.config({ monaco });

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
