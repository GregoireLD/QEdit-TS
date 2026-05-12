import { useState, useEffect } from 'react';
import { useQuestStore } from '../../stores/questStore';
import { useUiStore } from '../../stores/uiStore';
import { checkAllVersions } from '../../core/compatibility';
import type { CompatResult } from '../../core/compatibility';
import type { PlacementWarning } from '../../core/placement';
import { loadAllPlacementWarnings } from '../../core/loadPlacement';
import type { SaveFormat, PackagingType, TargetPlatform } from '../../core/model/types';
import {
  platformsForPackaging,
  getPlatformOptions,
  getSaveWarnings,
  defaultSaveFormat,
  describeCurrentFormat,
  type PlatformOption,
} from '../../core/saveFormat';
import styles from './SaveAsDialog.module.css';

interface Props {
  onClose:   () => void;
  onConfirm: (format: SaveFormat) => Promise<void>;
}

const PACKAGING_LABELS: Record<PackagingType, string> = {
  qpv3:         'QEdit Project v3 (.qpv3)',
  server:       'Server (.qst)',
  download:     'Download (.qst)',
  compressed:   'Compressed (.bin + .dat)',
  uncompressed: 'Uncompressed (.bin + .dat)',
  project:      'v2 Legacy Quest Project (.qprj)  — not yet implemented',
  rawbin:       'Quest File (.bin only)',
};

const PACKAGING_ORDER: PackagingType[] = [
  'qpv3', 'server', 'download', 'compressed', 'uncompressed', 'rawbin', 'project',
];

function platformLabel(platform: TargetPlatform, _packaging: PackagingType): string {
  return platform;
}


export function SaveAsDialog({ onClose, onConfirm }: Props) {
  const quest   = useQuestStore(s => s.quest);
  const dataDir = useUiStore(s => s.dataDir);

  const [compatResults,     setCompatResults]     = useState<CompatResult[] | null>(null);
  const [compatLoading,     setCompatLoading]     = useState(false);
  const [placementWarnings, setPlacementWarnings] = useState<PlacementWarning[]>([]);
  const [saving,    setSaving]    = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const defaultFmt = quest
    ? defaultSaveFormat(quest)
    : { packaging: 'server' as PackagingType, platform: 'PC' as TargetPlatform };

  const [packaging, setPackaging] = useState<PackagingType>(defaultFmt.packaging);
  const [platform,  setPlatform]  = useState<TargetPlatform>(defaultFmt.platform);

  // Run compat and placement checks once on open
  useEffect(() => {
    if (!quest) return;
    setCompatLoading(true);
    checkAllVersions(quest)
      .then(setCompatResults)
      .catch(() => setCompatResults(null))
      .finally(() => setCompatLoading(false));

    if (dataDir) {
      loadAllPlacementWarnings(quest, dataDir)
        .then(setPlacementWarnings)
        .catch(() => setPlacementWarnings([]));
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // When packaging changes, keep platform if still in the new list; otherwise reset to first
  useEffect(() => {
    const platforms = platformsForPackaging(packaging);
    if (platforms.length > 0 && !platforms.includes(platform)) {
      setPlatform(platforms[0]);
    }
  }, [packaging]); // eslint-disable-line react-hooks/exhaustive-deps

  const platforms: TargetPlatform[]    = platformsForPackaging(packaging);
  const platformOptions: PlatformOption[] = quest
    ? getPlatformOptions(packaging, quest, compatResults)
    : platforms.map(p => ({ platform: p }));

  const format: SaveFormat   = { packaging, platform };
  const warnings             = quest ? getSaveWarnings(format, quest) : [];

  const currentPlatformOpt = platformOptions.find(o => o.platform === platform);
  const isPlatformDisabled  = !!currentPlatformOpt?.disabledReason;
  const isNotImplemented    = packaging === 'project';
  const canSave             = !!quest && !saving && !isNotImplemented && (platforms.length === 0 || !isPlatformDisabled);

  // Placement summary for non-QPv3 formats (QPv3 is lossless authoring — no PSO constraints apply)
  const showPlacementWarning =
    packaging !== 'qpv3' && packaging !== 'project' &&
    dataDir !== null && placementWarnings.length > 0;

  const placementSummary = (() => {
    if (!showPlacementWarning) return null;
    const counts = {
      outOfWorld: placementWarnings.filter(w => w.kind === 'out-of-world').length,
      onWall:     placementWarnings.filter(w => w.kind === 'on-wall').length,
      nonGround:  placementWarnings.filter(w => w.kind === 'non-grounded').length,
    };
    const parts: string[] = [];
    if (counts.outOfWorld) parts.push(`${counts.outOfWorld} out of world`);
    if (counts.onWall)     parts.push(`${counts.onWall} on wall`);
    if (counts.nonGround)  parts.push(`${counts.nonGround} non-grounded`);
    return `${placementWarnings.length} placement warning${placementWarnings.length > 1 ? 's' : ''}: ${parts.join(', ')} — see Compat Checker for details`;
  })();

  async function handleSave() {
    if (!canSave) return;
    setSaving(true);
    setSaveError(null);
    try {
      await onConfirm(format);
    } catch (e) {
      setSaveError(String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className={styles.overlay}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className={styles.dialog} role="dialog" aria-modal="true">

        {/* ── Header ── */}
        <div className={styles.header}>
          <span className={styles.title}>Save As</span>
        </div>

        <div className={styles.body}>

          {/* Current format badge */}
          {quest && (
            <div className={styles.currentFormat}>
              Currently: {describeCurrentFormat(quest)}
            </div>
          )}

          {/* ── Packaging ── */}
          <div className={styles.section}>
            <div className={styles.sectionLabel}>Packaging</div>
            <div className={styles.packagingGrid}>
              {PACKAGING_ORDER.map(pkg => (
                <label
                  key={pkg}
                  className={`${styles.radioOption} ${packaging === pkg ? styles.selected : ''}`}
                >
                  <input
                    type="radio"
                    name="packaging"
                    value={pkg}
                    checked={packaging === pkg}
                    onChange={() => setPackaging(pkg)}
                  />
                  {PACKAGING_LABELS[pkg]}
                </label>
              ))}
            </div>
          </div>

          {/* ── Platform — always shown ── */}
          <div className={styles.section}>
            <div className={styles.sectionLabel}>
              Platform
              {compatLoading && <span className={styles.checking}> — checking…</span>}
            </div>

            {(packaging === 'qpv3' || packaging === 'project') ? (
              /* QPv3 / project: platform-agnostic */
              <div className={styles.projectNote}>
                <span className={styles.platformChip}>
                  {packaging === 'qpv3' ? 'Platform-agnostic' : 'Original format'}
                </span>
                <span className={styles.projectNoteText}>
                  {packaging === 'qpv3'
                    ? 'QPv3 stores all quest data losslessly — no platform conversion needed.'
                    : 'Quest project exports all embedded files as-is — no platform re-encoding.'}
                </span>
              </div>
            ) : (
              <div className={styles.platformRow}>
                {platformOptions.map(opt => (
                  <label
                    key={opt.platform}
                    className={[
                      styles.platformOption,
                      platform === opt.platform ? styles.selected : '',
                      opt.disabledReason        ? styles.disabled  : '',
                    ].join(' ')}
                    title={opt.disabledReason}
                  >
                    <input
                      type="radio"
                      name="platform"
                      value={opt.platform}
                      checked={platform === opt.platform}
                      disabled={!!opt.disabledReason}
                      onChange={() => { if (!opt.disabledReason) setPlatform(opt.platform); }}
                    />
                    {platformLabel(opt.platform, packaging)}
                  </label>
                ))}
              </div>
            )}
          </div>

          {/* ── Warnings ── */}
          {(warnings.length > 0 || placementSummary) && (
            <div className={styles.warnings}>
              {warnings.map((w, i) => (
                <div
                  key={i}
                  className={`${styles.warning} ${w.severity === 'destructive' ? styles.destructive : styles.infoWarn}`}
                >
                  {w.severity === 'destructive' ? '⚠' : 'ℹ'} {w.message}
                </div>
              ))}
              {placementSummary && (
                <div className={`${styles.warning} ${styles.infoWarn}`}>
                  ⚠ {placementSummary}
                </div>
              )}
            </div>
          )}

          {saveError && <div className={styles.saveError}>{saveError}</div>}
        </div>

        {/* ── Footer ── */}
        <div className={styles.footer}>
          <button onClick={onClose} disabled={saving}>Cancel</button>
          <button
            className={styles.saveBtn}
            onClick={handleSave}
            disabled={!canSave}
          >
            {saving ? 'Saving…' : 'Save…'}
          </button>
        </div>

      </div>
    </div>
  );
}
