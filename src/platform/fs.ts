/**
 * Platform-agnostic file and dialog API.
 *
 * - On Tauri: delegates to @tauri-apps/plugin-fs and @tauri-apps/plugin-dialog.
 * - In browser: uses File System Access API + <input type="file"> + blob downloads.
 *
 * Dynamic imports are used for Tauri packages so the browser bundle never
 * tries to load them (they would throw at import time).
 */

import { isTauri } from './index';
import { BROWSER_FS_PREFIX, browserReadFile, setBrowserMapHandle } from './browserFs';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface OpenedFile {
  /** Absolute path on Tauri; filename only in browser. */
  path: string;
  data: Uint8Array;
}

// ─── Read ────────────────────────────────────────────────────────────────────

export async function readFile(path: string): Promise<Uint8Array> {
  if (isTauri()) {
    const { readFile: tauriRead } = await import('@tauri-apps/plugin-fs');
    return new Uint8Array(await tauriRead(path));
  }
  // Server-served web mode: relative (./), absolute (/), or full URLs are fetched directly.
  if (path.startsWith('./') || path.startsWith('/') || path.startsWith('http://') || path.startsWith('https://')) {
    const resp = await fetch(path);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${path}`);
    return new Uint8Array(await resp.arrayBuffer());
  }
  return browserReadFile(path);
}

// ─── Write / download ────────────────────────────────────────────────────────

/**
 * Write bytes to a file path (Tauri) or trigger a browser download.
 * `suggestedName` is used as the download filename in browser mode.
 */
export async function saveFile(
  path: string,
  data: Uint8Array,
  suggestedName?: string,
): Promise<void> {
  if (isTauri()) {
    const { writeFile } = await import('@tauri-apps/plugin-fs');
    await writeFile(path, data);
  } else {
    const name = suggestedName ?? path.split(/[/\\]/).pop() ?? 'quest.qst';
    const blob = new Blob([data]);
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  }
}

// ─── Open file dialog ────────────────────────────────────────────────────────

/**
 * Show an open-file dialog. Returns the path and file contents together
 * (necessary because browsers can't give a path without reading the file).
 */
export async function openFileDialog(opts: {
  title?: string;
  filters?: { name: string; extensions: string[] }[];
}): Promise<OpenedFile | null> {
  if (isTauri()) {
    const { open }      = await import('@tauri-apps/plugin-dialog');
    const { readFile: tauriRead } = await import('@tauri-apps/plugin-fs');
    const selected = await open({
      title:    opts.title,
      filters:  opts.filters,
      multiple: false,
    });
    if (!selected || typeof selected !== 'string') return null;
    return { path: selected, data: new Uint8Array(await tauriRead(selected)) };
  }

  // Browser: <input type="file">
  return new Promise(resolve => {
    const input   = document.createElement('input');
    input.type    = 'file';
    if (opts.filters) {
      input.accept = opts.filters
        .flatMap(f => f.extensions.map(e => `.${e}`))
        .join(',');
    }
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) { resolve(null); return; }
      const data = new Uint8Array(await file.arrayBuffer());
      resolve({ path: file.name, data });
    };
    // oncancel fires in modern browsers; older ones just never call onchange
    (input as HTMLInputElement & { oncancel?: () => void }).oncancel = () => resolve(null);
    input.click();
  });
}

// ─── Save-as dialog ──────────────────────────────────────────────────────────

/**
 * Show a save-file dialog, then write the data.
 * - Tauri: opens a native save dialog, writes the file, returns the chosen path.
 * - Browser: triggers a download and returns the filename.
 */
export async function saveFileDialog(opts: {
  title?:       string;
  filters?:     { name: string; extensions: string[] }[];
  defaultName?: string;
  data:         Uint8Array;
}): Promise<string | null> {
  if (isTauri()) {
    const { save }      = await import('@tauri-apps/plugin-dialog');
    const { writeFile } = await import('@tauri-apps/plugin-fs');
    const dest = await save({
      title:   opts.title,
      filters: opts.filters,
    });
    if (typeof dest !== 'string') return null;
    await writeFile(dest, opts.data);
    return dest;
  }

  // Browser: trigger download
  const name = opts.defaultName ?? 'quest.qst';
  const blob  = new Blob([opts.data]);
  const url   = URL.createObjectURL(blob);
  const a     = document.createElement('a');
  a.href      = url;
  a.download  = name;
  a.click();
  URL.revokeObjectURL(url);
  return name;
}

// ─── Directory picker ────────────────────────────────────────────────────────

/**
 * Show a directory picker.
 * - Tauri: returns the absolute path.
 * - Browser: stores the FileSystemDirectoryHandle and returns BROWSER_FS_PREFIX.
 */
export async function openDirectoryDialog(title?: string): Promise<string | null> {
  if (isTauri()) {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const sel = await open({ directory: true, title });
    return typeof sel === 'string' ? sel : null;
  }

  try {
    // showDirectoryPicker is available in Chrome/Edge 86+
    const handle = await (window as unknown as {
      showDirectoryPicker: (opts?: { mode?: string }) => Promise<FileSystemDirectoryHandle>;
    }).showDirectoryPicker({ mode: 'read' });
    setBrowserMapHandle(handle);
    return BROWSER_FS_PREFIX;
  } catch {
    // User cancelled or API not supported
    return null;
  }
}
