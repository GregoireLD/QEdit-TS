import { useQuestStore } from '../../stores/questStore';
import styles from './TopBar.module.css';

export function TopBar() {
  const { quest, filePath, isLoading, openQuest, saveQuest } = useQuestStore();

  const title = quest?.bin.title ?? '';
  const fileName = filePath ? filePath.split('/').pop() ?? filePath : null;

  return (
    <header className={styles.bar}>
      <span className={styles.appName}>QEdit</span>

      <div className={styles.actions}>
        <button onClick={openQuest} disabled={isLoading}>Open…</button>
        <button onClick={saveQuest} disabled={!quest || isLoading}>Save</button>
      </div>

      <div className={styles.questInfo}>
        {quest && (
          <>
            <span className={styles.questTitle}>{title || '(no title)'}</span>
            <span className={styles.questMeta}>
              #{quest.bin.questNumber} · {quest.bin.version} · {quest.format}
            </span>
            {fileName && <span className={styles.fileName}>{fileName}</span>}
          </>
        )}
        {isLoading && <span className={styles.loading}>Loading…</span>}
      </div>
    </header>
  );
}
