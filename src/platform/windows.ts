let _uid = 0;
function nextLabel() { return `quest-${Date.now()}-${++_uid}`; }

const WINDOW_DEFAULTS = { width: 1400, height: 900, minWidth: 1024, minHeight: 700 } as const;

async function createQuestWindow(url: string, title: string): Promise<void> {
  const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
  const win = new WebviewWindow(nextLabel(), { ...WINDOW_DEFAULTS, url, title });
  await new Promise<void>((resolve, reject) => {
    win.once('tauri://created', () => resolve());
    win.once('tauri://error', (e) => reject(new Error(String(e.payload))));
  });
}

export async function openNewQuestWindow(episode: 1 | 2 | 4): Promise<void> {
  await createQuestWindow(`/?new=${episode}`, 'New Quest');
}

export async function openExistingQuestWindow(path: string): Promise<void> {
  const fileName = path.split(/[\\/]/).pop() ?? 'Quest';
  await createQuestWindow(`/?path=${encodeURIComponent(path)}`, fileName);
}

export async function focusQuestWindow(label: string): Promise<void> {
  const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
  const win = await WebviewWindow.getByLabel(label);
  if (win) await win.setFocus();
}

export interface QuestWindowInfo { label: string; title: string; isCurrent: boolean }

export async function getAllQuestWindows(): Promise<QuestWindowInfo[]> {
  const { getAllWebviewWindows, getCurrentWebviewWindow } = await import('@tauri-apps/api/webviewWindow');
  const currentLabel = getCurrentWebviewWindow().label;
  const all = await getAllWebviewWindows();
  return Promise.all(
    all.map(async (win) => ({
      label: win.label,
      title: await win.title(),
      isCurrent: win.label === currentLabel,
    }))
  );
}
