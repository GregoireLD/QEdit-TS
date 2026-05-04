import { useState, useEffect, useCallback } from 'react';
import { useQuestStore } from '../../stores/questStore';
import { checkAllVersions } from '../../core/compatibility';
import type { CompatResult, CompatIssue } from '../../core/compatibility';
import styles from './CompatChecker.module.css';

interface Props {
  onClose: () => void;
}

type StatusIcon = '✓' | '⚠' | '✗' | '…';

function statusIcon(issues: CompatIssue[]): StatusIcon {
  if (issues.some(i => i.severity === 'error'))   return '✗';
  if (issues.some(i => i.severity === 'warning')) return '⚠';
  return '✓';
}

function statusClass(icon: StatusIcon): string {
  if (icon === '✗') return styles.error;
  if (icon === '⚠') return styles.warning;
  if (icon === '✓') return styles.ok;
  return styles.loading;
}

export function CompatChecker({ onClose }: Props) {
  const quest = useQuestStore(s => s.quest);
  const [results, setResults]   = useState<CompatResult[] | null>(null);
  const [running, setRunning]   = useState(false);
  const [selected, setSelected] = useState<number>(0);
  const [runError, setRunError] = useState<string | null>(null);

  const run = useCallback(async () => {
    if (!quest) return;
    setRunning(true);
    setRunError(null);
    try {
      const r = await checkAllVersions(quest);
      setResults(r);
    } catch (e) {
      setRunError(String(e));
    } finally {
      setRunning(false);
    }
  }, [quest]);

  // Run automatically when the dialog opens
  useEffect(() => { run(); }, [run]);

  const current = results?.[selected];

  return (
    <div className={styles.overlay} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={styles.dialog} role="dialog" aria-modal="true">
        <div className={styles.header}>
          <span className={styles.title}>Compatibility Check</span>
          <button className={styles.closeBtn} onClick={onClose} title="Close">✕</button>
        </div>

        <div className={styles.body}>
          {/* Version selector */}
          <div className={styles.versionList}>
            {results
              ? results.map((r, i) => {
                  const icon = statusIcon(r.issues);
                  return (
                    <button
                      key={r.version}
                      className={`${styles.versionItem} ${i === selected ? styles.active : ''}`}
                      onClick={() => setSelected(i)}
                    >
                      <span className={`${styles.icon} ${statusClass(icon)}`}>{icon}</span>
                      <span className={styles.versionName}>{r.version}</span>
                      {r.issues.length > 0 && (
                        <span className={styles.count}>{r.issues.length}</span>
                      )}
                    </button>
                  );
                })
              : ['DC', 'PC', 'GC', 'BB'].map((v, i) => (
                  <button
                    key={v}
                    className={`${styles.versionItem} ${i === selected ? styles.active : ''}`}
                    onClick={() => setSelected(i)}
                  >
                    <span className={`${styles.icon} ${styles.loading}`}>…</span>
                    <span className={styles.versionName}>{v}</span>
                  </button>
                ))}
          </div>

          {/* Detail panel */}
          <div className={styles.detail}>
            {running && <p className={styles.message}>Running checks…</p>}
            {runError && <p className={styles.errorMsg}>{runError}</p>}
            {!running && current && (
              current.issues.length === 0
                ? <p className={styles.message}>
                    This quest is fully compatible with {current.version}.
                  </p>
                : <>
                    {current.issues.filter(i => i.severity === 'error').length > 0 && (
                      <section>
                        <h3 className={styles.sectionHead}>Errors</h3>
                        <ul className={styles.issueList}>
                          {current.issues
                            .filter(i => i.severity === 'error')
                            .map((i, k) => (
                              <li key={k} className={styles.issueError}>✗ {i.message}</li>
                            ))}
                        </ul>
                      </section>
                    )}
                    {current.issues.filter(i => i.severity === 'warning').length > 0 && (
                      <section>
                        <h3 className={styles.sectionHead}>Warnings</h3>
                        <ul className={styles.issueList}>
                          {current.issues
                            .filter(i => i.severity === 'warning')
                            .map((i, k) => (
                              <li key={k} className={styles.issueWarn}>⚠ {i.message}</li>
                            ))}
                        </ul>
                      </section>
                    )}
                  </>
            )}
            {!running && !current && !runError && (
              <p className={styles.message}>No quest loaded.</p>
            )}
          </div>
        </div>

        <div className={styles.footer}>
          <button onClick={run} disabled={running || !quest}>Re-check</button>
          <button onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
