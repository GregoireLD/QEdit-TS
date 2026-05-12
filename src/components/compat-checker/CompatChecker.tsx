import { useState, useEffect, useCallback } from 'react';
import { useQuestStore } from '../../stores/questStore';
import { useUiStore } from '../../stores/uiStore';
import { checkAllVersions } from '../../core/compatibility';
import type { CompatResult, CompatIssue } from '../../core/compatibility';
import type { PlacementWarning } from '../../core/placement';
import { formatPlacementWarning } from '../../core/placement';
import { loadAllPlacementWarnings } from '../../core/loadPlacement';
import styles from './CompatChecker.module.css';

interface Props {
  onClose: () => void;
}

type TabId = number | 'placement';

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

function placementIcon(warnings: PlacementWarning[], running: boolean, hasDataDir: boolean): StatusIcon {
  if (!hasDataDir || running) return '…';
  return warnings.length > 0 ? '⚠' : '✓';
}


export function CompatChecker({ onClose }: Props) {
  const quest   = useQuestStore(s => s.quest);
  const dataDir = useUiStore(s => s.dataDir);

  const [results, setResults]               = useState<CompatResult[] | null>(null);
  const [placementWarnings, setPlacementWarnings] = useState<PlacementWarning[]>([]);
  const [running, setRunning]               = useState(false);
  const [selected, setSelected]             = useState<TabId>(0);
  const [runError, setRunError]             = useState<string | null>(null);

  const run = useCallback(async () => {
    if (!quest) return;
    setRunning(true);
    setRunError(null);
    setPlacementWarnings([]);
    try {
      // Compat check and placement check run in parallel
      const [compatResults, placementResults] = await Promise.all([
        checkAllVersions(quest),
        dataDir ? loadAllPlacementWarnings(quest, dataDir) : Promise.resolve([]),
      ]);
      setResults(compatResults);
      setPlacementWarnings(placementResults);
    } catch (e) {
      setRunError(String(e));
    } finally {
      setRunning(false);
    }
  }, [quest, dataDir]);

  // Run automatically when the dialog opens
  useEffect(() => { run(); }, [run]);

  const currentVersionResult = typeof selected === 'number' ? results?.[selected] : null;
  const pIcon = placementIcon(placementWarnings, running, !!dataDir);

  return (
    <div className={styles.overlay} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={styles.dialog} role="dialog" aria-modal="true">
        <div className={styles.header}>
          <span className={styles.title}>Compatibility Check</span>
          <button className={styles.closeBtn} onClick={onClose} title="Close">✕</button>
        </div>

        <div className={styles.body}>
          {/* Tab selector */}
          <div className={styles.versionList}>
            {/* Version tabs */}
            {results
              ? results.map((r, i) => {
                  const icon = statusIcon(r.issues);
                  return (
                    <button
                      key={r.version}
                      className={`${styles.versionItem} ${selected === i ? styles.active : ''}`}
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
              : ['DC V1', 'DC V2 & PC', 'GC', 'BB'].map((v, i) => (
                  <button
                    key={v}
                    className={`${styles.versionItem} ${selected === i ? styles.active : ''}`}
                    onClick={() => setSelected(i)}
                  >
                    <span className={`${styles.icon} ${styles.loading}`}>…</span>
                    <span className={styles.versionName}>{v}</span>
                  </button>
                ))}

            {/* Placement tab — always shown when a quest is loaded */}
            {quest && (
              <button
                className={`${styles.versionItem} ${selected === 'placement' ? styles.active : ''}`}
                onClick={() => setSelected('placement')}
              >
                <span className={`${styles.icon} ${statusClass(pIcon)}`}>{pIcon}</span>
                <span className={styles.versionName}>Placement</span>
                {placementWarnings.length > 0 && (
                  <span className={styles.count}>{placementWarnings.length}</span>
                )}
              </button>
            )}
          </div>

          {/* Detail panel */}
          <div className={styles.detail}>
            {selected === 'placement' ? (
              /* Placement tab content */
              !dataDir
                ? <p className={styles.message}>
                    Load a game data folder to enable placement checks.
                  </p>
                : running
                  ? <p className={styles.message}>Running placement checks…</p>
                  : placementWarnings.length === 0
                    ? <p className={styles.message}>No placement issues on any included floor.</p>
                    : <>
                        <p className={styles.message} style={{ marginBottom: 10 }}>
                          All included floors. Symbols on the 2D map: <strong style={{ color: '#cc2020' }}>?</strong> = out of world,{' '}
                          <strong style={{ color: '#cc6600' }}>W</strong> = on wall,{' '}
                          <strong style={{ color: '#998800' }}>!</strong> = non-grounded.
                        </p>
                        <section>
                          <h3 className={styles.sectionHead}>Warnings</h3>
                          <ul className={styles.issueList}>
                            {placementWarnings.map((w, k) => (
                              <li key={k} className={styles.issueWarn}>⚠ {formatPlacementWarning(w)}</li>
                            ))}
                          </ul>
                        </section>
                      </>
            ) : (
              /* Version tab content */
              <>
                {running && <p className={styles.message}>Running checks…</p>}
                {runError && <p className={styles.errorMsg}>{runError}</p>}
                {!running && currentVersionResult && (
                  currentVersionResult.issues.length === 0
                    ? <p className={styles.message}>
                        This quest is fully compatible with {currentVersionResult.version}.
                      </p>
                    : <>
                        {currentVersionResult.issues.filter(i => i.severity === 'error').length > 0 && (
                          <section>
                            <h3 className={styles.sectionHead}>Errors</h3>
                            <ul className={styles.issueList}>
                              {currentVersionResult.issues
                                .filter(i => i.severity === 'error')
                                .map((i, k) => (
                                  <li key={k} className={styles.issueError}>✗ {i.message}</li>
                                ))}
                            </ul>
                          </section>
                        )}
                        {currentVersionResult.issues.filter(i => i.severity === 'warning').length > 0 && (
                          <section>
                            <h3 className={styles.sectionHead}>Warnings</h3>
                            <ul className={styles.issueList}>
                              {currentVersionResult.issues
                                .filter(i => i.severity === 'warning')
                                .map((i, k) => (
                                  <li key={k} className={styles.issueWarn}>⚠ {i.message}</li>
                                ))}
                            </ul>
                          </section>
                        )}
                      </>
                )}
                {!running && !currentVersionResult && !runError && (
                  <p className={styles.message}>No quest loaded.</p>
                )}
              </>
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
