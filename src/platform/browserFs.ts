/**
 * Browser-side file system access via the File System Access API.
 *
 * In browser mode, the user picks their PSO data directory once per session
 * (browser security prevents persisting directory handles across reloads
 * without an extra permissions flow). The handle is kept in memory and all
 * readFile() calls resolve relative paths against it.
 *
 * dataDir is set to BROWSER_FS_PREFIX so existing path-building code
 * (`${dataDir}/${sep}/${file}`) produces paths we can parse here.
 */

export const BROWSER_FS_PREFIX = '__browser__';

let _dataHandle: FileSystemDirectoryHandle | null = null;

export function setBrowserDataHandle(handle: FileSystemDirectoryHandle): void {
  _dataHandle = handle;
}

export function hasBrowserDataHandle(): boolean {
  return _dataHandle !== null;
}

export function clearBrowserDataHandle(): void {
  _dataHandle = null;
}

/**
 * Resolve a virtual path like `__browser__/map/xvm/foo.xvr` against the stored
 * directory handle and return the file contents.
 */
export async function browserReadFile(path: string): Promise<Uint8Array> {
  if (!_dataHandle) throw new Error('No data directory selected');

  // Strip the sentinel prefix (and any leading separator)
  const relative = path.startsWith(BROWSER_FS_PREFIX)
    ? path.slice(BROWSER_FS_PREFIX.length).replace(/^[/\\]/, '')
    : path;

  const parts = relative.split(/[/\\]/).filter(Boolean);
  if (parts.length === 0) throw new Error(`Invalid path: ${path}`);

  // Navigate into subdirectories, then get the file
  let dir: FileSystemDirectoryHandle = _dataHandle;
  for (let i = 0; i < parts.length - 1; i++) {
    dir = await dir.getDirectoryHandle(parts[i]);
  }
  const fileHandle = await dir.getFileHandle(parts[parts.length - 1]);
  const file = await fileHandle.getFile();
  return new Uint8Array(await file.arrayBuffer());
}
