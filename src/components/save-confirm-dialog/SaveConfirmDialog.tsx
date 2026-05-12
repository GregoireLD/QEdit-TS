import styles from './SaveConfirmDialog.module.css';

export interface SaveCheckIssue {
  severity: 'error' | 'warning';
  message: string;
}

interface Props {
  /** Human-readable label for the save target, e.g. "GC · Server" */
  formatLabel:  string;
  issues:       SaveCheckIssue[];
  onCancel:     () => void;
  onSaveAs:     () => void;
  onSaveAnyway: () => void;
}

export function SaveConfirmDialog({ formatLabel, issues, onCancel, onSaveAs, onSaveAnyway }: Props) {
  const errorCount = issues.filter(i => i.severity === 'error').length;

  return (
    <div className={styles.overlay} onClick={e => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className={styles.dialog} role="dialog" aria-modal="true">

        <div className={styles.header}>
          <span className={styles.title}>Compatibility Issues</span>
        </div>

        <div className={styles.body}>
          <p className={styles.target}>
            Saving as: <strong>{formatLabel}</strong>
          </p>

          <ul className={styles.issueList}>
            {issues.map((issue, i) => (
              <li
                key={i}
                className={issue.severity === 'error' ? styles.issueError : styles.issueWarn}
              >
                {issue.severity === 'error' ? '✗' : '⚠'} {issue.message}
              </li>
            ))}
          </ul>

          <p className={styles.notice}>
            {errorCount > 0
              ? 'This file may fail to load in PSO. Consider saving in a compatible format.'
              : 'These are non-critical warnings. The file should still work in PSO.'}
          </p>
        </div>

        <div className={styles.footer}>
          <button onClick={onCancel}>Cancel</button>
          <button className={styles.saveAsBtn} onClick={onSaveAs}>Save As…</button>
          <button className={styles.saveAnywayBtn} onClick={onSaveAnyway}>
            Save Anyway{errorCount > 0 ? ` (${errorCount} error${errorCount > 1 ? 's' : ''})` : ''}
          </button>
        </div>

      </div>
    </div>
  );
}
