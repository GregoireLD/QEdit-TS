/**
 * Browser-side file system access via the File System Access API.
 *
 * In browser mode, the user picks their PSO map directory once per session
 * (browser security prevents persisting directory handles across reloads
 * without an extra permissions flow). The handle is kept in memory and all
 * readFile() calls resolve relative paths against it.
 *
 * mapDir is set to BROWSER_FS_PREFIX so existing path-building code
 * (`${mapDir}/${file}`) produces paths we can parse here.
 */

export const BROWSER_FS_PREFIX = '__browser__';

let _mapHandle: FileSystemDirectoryHandle | null = null;

export function setBrowserMapHandle(handle: FileSystemDirectoryHandle): void {
  _mapHandle = handle;
}

export function hasBrowserMapHandle(): boolean {
  return _mapHandle !== null;
}

export function clearBrowserMapHandle(): void {
  _mapHandle = null;
}

/**
 * Resolve a virtual path like `__browser__/xvm/foo.xvr` against the stored
 * directory handle and return the file contents.
 */
export async function browserReadFile(path: string): Promise<Uint8Array> {
  if (!_mapHandle) throw new Error('No map directory selected');

  // Strip the sentinel prefix (and any leading separator)
  const relative = path.startsWith(BROWSER_FS_PREFIX)
    ? path.slice(BROWSER_FS_PREFIX.length).replace(/^[/\\]/, '')
    : path;

  const parts = relative.split(/[/\\]/).filter(Boolean);
  if (parts.length === 0) throw new Error(`Invalid path: ${path}`);

  // Navigate into subdirectories, then get the file
  let dir: FileSystemDirectoryHandle = _mapHandle;
  for (let i = 0; i < parts.length - 1; i++) {
    dir = await dir.getDirectoryHandle(parts[i]);
  }
  const fileHandle = await dir.getFileHandle(parts[parts.length - 1]);
  const file = await fileHandle.getFile();
  return new Uint8Array(await file.arrayBuffer());
}
