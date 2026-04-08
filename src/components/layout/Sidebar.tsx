import { useState } from 'react';
import { useQuestStore } from '../../stores/questStore';
import { useUiStore } from '../../stores/uiStore';
import { AREA_BY_ID, AREAS_BY_EPISODE, EP_OFFSET } from '../../core/map/areaData';
import styles from './Sidebar.module.css';

export function Sidebar() {
  const { quest, selectedFloorId, selectFloor, commitVariant } = useQuestStore();
  const { previewVariantByArea, setPreviewVariant } = useUiStore();

  // Which area rows are expanded to show variants
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  if (!quest) {
    return (
      <aside className={styles.sidebar}>
        <div className={styles.empty}>No quest loaded</div>
      </aside>
    );
  }

  const episode = quest.episode;
  const offset  = EP_OFFSET[episode];

  // Floor lookup by RELATIVE id (as stored in .dat)
  const floorByRelId = new Map(quest.floors.map(f => [f.id, f]));

  const areaIds = AREAS_BY_EPISODE[episode];

  function toggleExpand(id: number) {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  return (
    <aside className={styles.sidebar}>
      {/* Episode indicator — locked (determined from bytecode, not user-editable) */}
      <div className={styles.epRow}>
        {([1, 2, 4] as const).map(ep => (
          <div
            key={ep}
            className={`${styles.epBtn} ${episode === ep ? styles.epActive : ''}`}
          >
            EP{ep}
          </div>
        ))}
      </div>

      {/* Area list */}
      <div className={styles.section}>
        <div className={styles.sectionHead}>Areas</div>
        <ul className={styles.list}>
          {areaIds.map(absId => {
            const area      = AREA_BY_ID[absId];
            const relId     = absId - offset;
            const floor     = floorByRelId.get(relId);
            const enabled   = floor !== undefined;
            const active    = absId === selectedFloorId;
            const hasVars   = (area?.variants.length ?? 0) > 1;
            const isOpen    = expanded.has(absId);

            // Committed variant = what's in the quest bytecode (ground truth)
            const committedIdx = quest.variantByArea[absId] ?? 0;
            // Previewed variant = what's currently shown in the canvas
            const previewIdx   = previewVariantByArea[absId] ?? committedIdx;
            const isPreviewing = hasVars && previewIdx !== committedIdx;

            return (
              <li key={absId}>
                {/* Area row */}
                <div
                  className={[
                    styles.item,
                    active   ? styles.selected : '',
                    !enabled ? styles.disabled  : '',
                  ].join(' ')}
                  onClick={() => {
                    selectFloor(absId);
                    if (hasVars) toggleExpand(absId);
                  }}
                >
                  {hasVars ? (
                    <span className={`${styles.triangle} ${isOpen ? styles.triOpen : ''}`}>▶</span>
                  ) : (
                    <span className={styles.triPlaceholder} />
                  )}
                  <span className={styles.check}>{enabled ? '✓' : ''}</span>
                  <span className={styles.floorName}>{area?.name ?? `Area ${absId}`}</span>
                  {floor && (
                    <span className={styles.floorCount}>
                      {floor.monsters.length > 0 && <span title="monsters">⚔{floor.monsters.length}</span>}
                      {floor.objects.length  > 0 && <span title="objects">◉{floor.objects.length}</span>}
                    </span>
                  )}
                  {/* Pending-commit indicator */}
                  {isPreviewing && (
                    <span
                      className={styles.commitBtn}
                      title={`Commit to "${area?.variants[previewIdx]?.label}" (currently previewing)`}
                      onClick={e => { e.stopPropagation(); commitVariant(absId, previewIdx); }}
                    >
                      ✓
                    </span>
                  )}
                </div>

                {/* Variant sub-rows */}
                {hasVars && isOpen && (
                  <ul className={styles.variantList}>
                    {area!.variants.map((vr, idx) => {
                      const isCommitted = idx === committedIdx;
                      const isPreviewed = idx === previewIdx;
                      return (
                        <li
                          key={vr.file}
                          className={[
                            styles.variantItem,
                            isCommitted ? styles.variantCommitted : '',
                            isPreviewed && !isCommitted ? styles.variantPreviewed : '',
                          ].join(' ')}
                          onClick={e => {
                            e.stopPropagation();
                            setPreviewVariant(absId, idx);
                            if (absId !== selectedFloorId) selectFloor(absId);
                          }}
                          onDoubleClick={e => {
                            e.stopPropagation();
                            commitVariant(absId, idx);
                            if (absId !== selectedFloorId) selectFloor(absId);
                          }}
                        >
                          <span className={styles.radio}>
                            {isCommitted ? '●' : isPreviewed ? '◉' : '○'}
                          </span>
                          <span className={styles.variantLabel}>{vr.label}</span>
                          {isCommitted && !isPreviewed && (
                            <span className={styles.variantTag}>saved</span>
                          )}
                          {isPreviewed && !isCommitted && (
                            <span className={styles.variantTag}>preview</span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      </div>

      {/* Quest info */}
      <div className={styles.questInfoBox}>
        <div className={styles.sectionHead}>Quest Info</div>
        <div className={styles.infoRow}><span>Number</span><span>{quest.bin.questNumber}</span></div>
        <div className={styles.infoRow}><span>Language</span><span>{quest.bin.language}</span></div>
        <div className={styles.infoRow}><span>Format</span><span>{quest.bin.version}</span></div>
        <div className={styles.infoRow}>
          <span>Bytecode</span><span>{(quest.bin.bytecode.length / 1024).toFixed(1)} KB</span>
        </div>
      </div>
    </aside>
  );
}
