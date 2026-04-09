/** Returns true when running inside Tauri, false in a plain browser. */
export const isTauri = (): boolean => '__TAURI_INTERNALS__' in window;
