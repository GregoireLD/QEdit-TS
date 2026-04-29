import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useQuestStore, useSelectedFloor } from '../../stores/questStore';
import { useUiStore } from '../../stores/uiStore';
import type { Monster, QuestObject } from '../../core/model/types';
import { MapCanvas } from '../map-canvas/MapCanvas';
import { Viewer3D } from '../viewer-3d/Viewer3D';
import {
  MONSTER_SCHEMAS, OBJECT_SCHEMAS,
  OBJECT_NAMES, objectName, monsterName,
  MONSTER_SUBTYPES, OBJECT_COLOR_SUBTYPES, resolveSubtype,
  type MonsterFieldDesc, type ObjectFieldDesc, type SubtypeOption,
} from '../../core/map/entitySchemas';
import { AREA_BY_ID } from '../../core/map/areaData';
import { MONSTER_PRESETS, OBJECT_PRESETS, getPlacementType } from '../../core/data/presets';
import { toWorldPos, sampleFloorHeight } from '../../core/formats/rel';
import styles from './FloorView.module.css';

function getMonsterSkinOptions(areaId: number): SubtypeOption[] {
  const skins = AREA_BY_ID[areaId]?.monsterSkins ?? [];
  return skins
    .map(v => ({ value: v, label: monsterName(v) }))
    .sort((a, b) => a.value - b.value);
}

function getObjectSkinOptions(areaId: number): SubtypeOption[] {
  const ranges = AREA_BY_ID[areaId]?.objectRanges ?? [];
  return Array.from(OBJECT_NAMES.entries())
    .filter(([k]) => k < 10000 && ranges.some(([lo, hi]) => k >= lo && k <= hi))
    .map(([k, v]) => ({ value: k, label: v }))
    .sort((a, b) => a.value - b.value);
}

// ─── Column resize ──────────────────────────────────────────────────────────
function startColResize(
  e: React.MouseEvent,
  colIdx: number,
  widthsRef: React.MutableRefObject<number[]>,
  setWidths: React.Dispatch<React.SetStateAction<number[]>>,
) {
  e.preventDefault();
  e.stopPropagation();
  const startX = e.clientX;
  const startW = widthsRef.current[colIdx];
  const onMove = (me: MouseEvent) => {
    const w = Math.max(30, startW + (me.clientX - startX));
    setWidths(prev => { const n = [...prev]; n[colIdx] = w; return n; });
  };
  const onUp = () => {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
  };
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}

// ─── Editable cell ──────────────────────────────────────────────────────────

type CellKind = 'float' | 'int' | 'hex' | 'bool';

interface EditableCellProps {
  value: number;
  kind: CellKind;
  className?: string;
  onCommit: (v: number) => void;
  display?: string;
}

function formatDisplay(value: number, kind: CellKind, display?: string): string {
  if (display !== undefined) return display;
  if (kind === 'float') return value.toFixed(2);
  if (kind === 'hex')   return `0x${value.toString(16).toUpperCase().padStart(4, '0')}`;
  if (kind === 'bool')  return value ? '✓' : '';
  return String(value);
}

function formatEdit(value: number, kind: CellKind): string {
  if (kind === 'float') return value.toFixed(6);
  if (kind === 'hex')   return `0x${value.toString(16).toUpperCase()}`;
  if (kind === 'bool')  return String(value);
  return String(value);
}

function parseEdit(raw: string, kind: CellKind): number | null {
  const s = raw.trim();
  if (kind === 'float') {
    const f = parseFloat(s);
    return isNaN(f) ? null : f;
  }
  if (kind === 'bool') {
    if (s === '1' || s.toLowerCase() === 'true') return 1;
    if (s === '0' || s.toLowerCase() === 'false') return 0;
    return null;
  }
  const n = s.startsWith('0x') || s.startsWith('0X')
    ? parseInt(s, 16)
    : parseInt(s, 10);
  return isNaN(n) ? null : n;
}

function EditableCell({ value, kind, className, onCommit, display }: EditableCellProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const startEdit = useCallback(() => {
    setDraft(formatEdit(value, kind));
    setEditing(true);
  }, [value, kind]);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const commit = useCallback(() => {
    const parsed = parseEdit(draft, kind);
    if (parsed !== null) onCommit(parsed);
    setEditing(false);
  }, [draft, kind, onCommit]);

  const cancel = useCallback(() => setEditing(false), []);

  if (editing) {
    return (
      <td className={`${className ?? ''} ${styles.editing}`}>
        <input
          ref={inputRef}
          className={styles.cellInput}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={e => {
            if (e.key === 'Enter') { e.preventDefault(); commit(); }
            if (e.key === 'Escape') { e.preventDefault(); cancel(); }
          }}
        />
      </td>
    );
  }

  return (
    <td
      className={`${className ?? ''} ${styles.editable}`}
      onClick={startEdit}
      title="Click to edit"
    >
      {formatDisplay(value, kind, display)}
    </td>
  );
}

// ─── Row action menu ("...") ────────────────────────────────────────────────

function RowMenu({ onDuplicate, onDelete }: { onDuplicate: () => void; onDelete: () => void }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <td className={styles.menuCell} onClick={e => e.stopPropagation()}>
      <div ref={wrapRef} className={styles.menuWrap}>
        <button
          className={styles.menuTrigger}
          title="Actions"
          onClick={e => { e.stopPropagation(); setOpen(v => !v); }}
        >⋯</button>
        {open && (
          <div className={styles.menuDropdown}>
            <button onClick={() => { onDuplicate(); setOpen(false); }}>Duplicate</button>
            <button
              className={styles.menuDelete}
              onClick={() => { onDelete(); setOpen(false); }}
            >Delete</button>
          </div>
        )}
      </div>
    </td>
  );
}

// ─── Monster table ──────────────────────────────────────────────────────────

const M_COL_INIT = [32, 120, 100, 55, 70, 70, 70, 70, 50, 70, 70, 28];
const O_COL_INIT = [32, 130, 50, 50, 55, 70, 70, 70, 55, 55, 28];

function MonsterTable({ monsters, floorId }: { monsters: Monster[]; floorId: number }) {
  const updateMonster   = useQuestStore(s => s.updateMonster);
  const deleteMonster   = useQuestStore(s => s.deleteMonster);
  const duplicateMonster = useQuestStore(s => s.duplicateMonster);
  const selectEntity    = useQuestStore(s => s.selectEntity);
  const selectedEntity  = useQuestStore(s => s.selectedEntity);
  const episode = (useQuestStore(s => s.quest?.episode) ?? 1) as 1|2|4;
  const upd = useCallback(
    (i: number, patch: Partial<Monster>) => updateMonster(floorId, i, patch),
    [updateMonster, floorId]
  );
  const [colW, setColW] = useState(M_COL_INIT);
  const colWRef = useRef(colW);
  colWRef.current = colW;
  const rs = (e: React.MouseEvent, i: number) => startColResize(e, i, colWRef, setColW);

  if (monsters.length === 0) {
    return <div className={styles.empty}>No monsters on this floor</div>;
  }

  const H = ['#','Type','Subtype','Section','Pos X','Pos Y','Pos Z','Direction','Mobile','Char ID','Action',''];

  return (
    <div className={styles.tableWrap}>
      <table className={styles.table} style={{ tableLayout: 'fixed', width: 'max-content', minWidth: '100%' }}>
        <colgroup>{colW.map((w, i) => <col key={i} style={{ width: w }} />)}</colgroup>
        <thead>
          <tr>
            {H.map((h, i) => (
              <th key={i}>
                {h}
                {i < H.length - 1 && <div className={styles.resizeHandle} onMouseDown={e => rs(e, i)} />}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {monsters.map((m, i) => {
            const isSelected = selectedEntity?.type === 'monster' && selectedEntity.index === i;
            return (
              <tr
                key={i}
                className={isSelected ? styles.rowSelected : undefined}
                onClick={() => selectEntity({ type: 'monster', index: i })}
              >
                <td className={styles.idx}>{i}</td>
                <EditableCell
                  value={m.skin} kind="hex" className={styles.name}
                  display={monsterName(m.skin)}
                  onCommit={v => upd(i, { skin: v })}
                />
                <SubtypeCell monster={m} episode={episode} onCommit={v => upd(i, { movementFlag: v })} />
                <EditableCell value={m.mapSection} kind="int"
                  onCommit={v => upd(i, { mapSection: v })} />
                <EditableCell value={m.posX} kind="float" className={styles.num}
                  onCommit={v => upd(i, { posX: v })} />
                <EditableCell value={m.posY} kind="float" className={styles.num}
                  onCommit={v => upd(i, { posY: v })} />
                <EditableCell value={m.posZ} kind="float" className={styles.num}
                  onCommit={v => upd(i, { posZ: v })} />
                <EditableCell value={m.direction} kind="float" className={styles.num}
                  onCommit={v => upd(i, { direction: v })} />
                <EditableCell value={m.movementFlag} kind="bool"
                  onCommit={v => upd(i, { movementFlag: v })} />
                <EditableCell value={m.charId} kind="float" className={styles.num}
                  onCommit={v => upd(i, { charId: v })} />
                <EditableCell value={m.action} kind="float" className={styles.num}
                  onCommit={v => upd(i, { action: v })} />
                <RowMenu
                  onDuplicate={() => duplicateMonster(floorId, i)}
                  onDelete={() => deleteMonster(floorId, i)}
                />
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── Object table ───────────────────────────────────────────────────────────

function ObjectTable({ objects, floorId }: { objects: QuestObject[]; floorId: number }) {
  const updateObject   = useQuestStore(s => s.updateObject);
  const deleteObject   = useQuestStore(s => s.deleteObject);
  const duplicateObject = useQuestStore(s => s.duplicateObject);
  const selectEntity   = useQuestStore(s => s.selectEntity);
  const selectedEntity = useQuestStore(s => s.selectedEntity);
  const upd = useCallback(
    (i: number, patch: Partial<QuestObject>) => updateObject(floorId, i, patch),
    [updateObject, floorId]
  );
  const [colW, setColW] = useState(O_COL_INIT);
  const colWRef = useRef(colW);
  colWRef.current = colW;
  const rs = (e: React.MouseEvent, i: number) => startColResize(e, i, colWRef, setColW);

  if (objects.length === 0) {
    return <div className={styles.empty}>No objects on this floor</div>;
  }

  const H = ['#','Skin','ID','Group','Section','Pos X','Pos Y','Pos Z','Obj ID','Action',''];

  return (
    <div className={styles.tableWrap}>
      <table className={styles.table} style={{ tableLayout: 'fixed', width: 'max-content', minWidth: '100%' }}>
        <colgroup>{colW.map((w, i) => <col key={i} style={{ width: w }} />)}</colgroup>
        <thead>
          <tr>
            {H.map((h, i) => (
              <th key={i}>
                {h}
                {i < H.length - 1 && <div className={styles.resizeHandle} onMouseDown={e => rs(e, i)} />}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {objects.map((o, i) => {
            const isSelected = selectedEntity?.type === 'object' && selectedEntity.index === i;
            return (
              <tr
                key={i}
                className={isSelected ? styles.rowSelected : undefined}
                onClick={() => selectEntity({ type: 'object', index: i })}
              >
                <td className={styles.idx}>{i}</td>
                <EditableCell value={o.skin} kind="hex" className={styles.name}
                  display={objectName(o.skin)}
                  onCommit={v => upd(i, { skin: v })} />
                <EditableCell value={o.id} kind="int"
                  onCommit={v => upd(i, { id: v })} />
                <EditableCell value={o.group} kind="int"
                  onCommit={v => upd(i, { group: v })} />
                <EditableCell value={o.mapSection} kind="int"
                  onCommit={v => upd(i, { mapSection: v })} />
                <EditableCell value={o.posX} kind="float" className={styles.num}
                  onCommit={v => upd(i, { posX: v })} />
                <EditableCell value={o.posY} kind="float" className={styles.num}
                  onCommit={v => upd(i, { posY: v })} />
                <EditableCell value={o.posZ} kind="float" className={styles.num}
                  onCommit={v => upd(i, { posZ: v })} />
                <EditableCell value={o.objId} kind="int"
                  onCommit={v => upd(i, { objId: v })} />
                <EditableCell value={o.action} kind="int"
                  onCommit={v => upd(i, { action: v })} />
                <RowMenu
                  onDuplicate={() => duplicateObject(floorId, i)}
                  onDelete={() => deleteObject(floorId, i)}
                />
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── Add panel ──────────────────────────────────────────────────────────────

interface AddPanelProps {
  kind: 'monster' | 'object';
  floorId: number;
  areaId: number;
  episode: 1 | 2 | 4;
  onDone: () => void;
}

function AddPanel({ kind, floorId, areaId, episode: _episode, onDone }: AddPanelProps) {
  const addMonster = useQuestStore(s => s.addMonster);
  const addObject  = useQuestStore(s => s.addObject);
  const [query, setQuery]   = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [wave, setWave]     = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  // Filter presets to the skins relevant for this area
  const presets = useMemo(() => {
    if (kind === 'monster') {
      const allowed = new Set(AREA_BY_ID[areaId]?.monsterSkins ?? []);
      return allowed.size > 0
        ? MONSTER_PRESETS.filter(p => allowed.has(p.skin))
        : MONSTER_PRESETS;
    } else {
      const ranges = AREA_BY_ID[areaId]?.objectRanges ?? [];
      return OBJECT_PRESETS.filter(p =>
        ranges.some(([lo, hi]) => p.skin >= lo && p.skin <= hi)
      );
    }
  }, [kind, areaId]);

  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    return q ? presets.filter(p => p.name.toLowerCase().includes(q)) : presets;
  }, [presets, query]);

  const selectedPreset = useMemo(
    () => presets.find(p => p.name === selected) ?? null,
    [presets, selected]
  );

  const handleAdd = useCallback(() => {
    if (!selectedPreset) return;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { name: _name, ...entityData } = selectedPreset;
    const mapData = useUiStore.getState().loadedMapData;
    const sampledZ = (() => {
      if (!mapData) return null;
      const e = entityData as { posX: number; posY: number; mapSection: number };
      const [wx, wy] = toWorldPos(e.posX, e.posY, e.mapSection, mapData.sections);
      return sampleFloorHeight(wx, wy, mapData.triangles);
    })();
    if (kind === 'monster') {
      const m = { ...(entityData as Monster), unknown5: wave, unknown6: wave };
      if (sampledZ !== null) m.posZ = sampledZ;
      addMonster(floorId, m);
    } else {
      const o = { ...(entityData as QuestObject) };
      if (sampledZ !== null) o.posZ = sampledZ;
      addObject(floorId, o);
    }
    onDone();
  }, [selectedPreset, kind, wave, floorId, addMonster, addObject, onDone]);

  return (
    <div className={styles.addPanel}>
      <div className={styles.addPanelHeader}>
        <span>Add {kind === 'monster' ? 'Monster' : 'Object'}</span>
        <button className={styles.addPanelCancel} onClick={onDone}>✕</button>
      </div>

      <div className={styles.addSearch}>
        <input
          ref={inputRef}
          className={styles.addSearchInput}
          placeholder="Search…"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Escape') onDone();
            if (e.key === 'Enter' && filtered.length > 0) {
              setSelected(filtered[0].name);
            }
          }}
        />
      </div>

      <div className={styles.addList}>
        {filtered.map(p => (
          <div
            key={p.name}
            className={`${styles.addListItem} ${selected === p.name ? styles.addListSelected : ''}`}
            onClick={() => setSelected(p.name)}
            onDoubleClick={() => { setSelected(p.name); handleAdd(); }}
          >
            {p.name}
          </div>
        ))}
        {filtered.length === 0 && <div className={styles.addListEmpty}>No matches</div>}
      </div>

      {kind === 'monster' && (
        <div className={styles.addMeta}>
          <span className={styles.addMetaLabel}>Wave</span>
          <input
            className={styles.addMetaInput}
            type="number"
            min={0}
            value={wave}
            onChange={e => setWave(Math.max(0, parseInt(e.target.value) || 0))}
          />
        </div>
      )}

      <div className={styles.addFooter}>
        <button
          className={styles.addBtn}
          disabled={!selectedPreset}
          onClick={handleAdd}
        >Add</button>
        <button className={styles.addCancelBtn} onClick={onDone}>Cancel</button>
      </div>
    </div>
  );
}

// ─── Schema label / kind helpers ─────────────────────────────────────────────

function msl(schema: MonsterFieldDesc[] | undefined, key: keyof Monster, fallback: string): string {
  return schema?.find(d => d.key === key)?.label ?? fallback;
}

function osl(schema: ObjectFieldDesc[] | undefined, key: keyof QuestObject, fallback: string): string {
  return schema?.find(d => d.key === key)?.label ?? fallback;
}

function mskind(schema: MonsterFieldDesc[] | undefined, key: keyof Monster, fallback: CellKind): CellKind {
  return schema?.find(d => d.key === key)?.kind ?? fallback;
}

function oskind(schema: ObjectFieldDesc[] | undefined, key: keyof QuestObject, fallback: CellKind): CellKind {
  return schema?.find(d => d.key === key)?.kind ?? fallback;
}

// ─── Inspector helpers ───────────────────────────────────────────────────────

interface InspectorRowProps {
  label: string;
  value: number;
  kind: CellKind;
  display?: string;
  onCommit: (v: number) => void;
}

function InspectorRow({ label, value, kind, display, onCommit }: InspectorRowProps) {
  const [editing, setEditing] = useState(false);
  const [draft,   setDraft]   = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const startEdit = useCallback(() => {
    setDraft(formatEdit(value, kind));
    setEditing(true);
  }, [value, kind]);

  useEffect(() => {
    if (editing && inputRef.current) { inputRef.current.focus(); inputRef.current.select(); }
  }, [editing]);

  const commit = useCallback(() => {
    const parsed = parseEdit(draft, kind);
    if (parsed !== null) onCommit(parsed);
    setEditing(false);
  }, [draft, kind, onCommit]);

  return (
    <div className={styles.inspRow}>
      <span className={styles.inspLabel}>{label}</span>
      {editing ? (
        <input
          ref={inputRef}
          className={styles.inspInput}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={e => {
            if (e.key === 'Enter')  { e.preventDefault(); commit(); }
            if (e.key === 'Escape') { e.preventDefault(); setEditing(false); }
          }}
        />
      ) : (
        <span className={styles.inspValue} onClick={startEdit} title="Click to edit">
          {formatDisplay(value, kind, display)}
        </span>
      )}
    </div>
  );
}

function InspectorGroup({ label, children, action }: { label: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className={styles.inspGroup}>
      <div className={styles.inspGroupLabel}>
        {label}
        {action && <span className={styles.inspGroupAction}>{action}</span>}
      </div>
      {children}
    </div>
  );
}

function DualSelectRow({ label, value, options, kind, onCommit }: {
  label: string; value: number; options: SubtypeOption[]; kind: CellKind; onCommit: (v: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setDraft(null); }, [value]);

  const commit = useCallback(() => {
    if (draft !== null) {
      const parsed = parseEdit(draft, kind);
      if (parsed !== null) onCommit(parsed);
      setDraft(null);
    }
  }, [draft, kind, onCommit]);

  const matched = options.find(o => o.value === value);

  return (
    <div className={styles.inspRow}>
      <span className={styles.inspLabel}>{label}</span>
      <select
        className={styles.inspSelectInline}
        value={matched ? String(value) : ''}
        onChange={e => { if (e.target.value !== '') onCommit(Number(e.target.value)); }}
      >
        {!matched && <option value="">—</option>}
        {options.map(o => <option key={o.value} value={String(o.value)}>{o.label}</option>)}
      </select>
      <input
        ref={inputRef}
        className={styles.inspInputInline}
        value={draft ?? formatEdit(value, kind)}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => {
          if (e.key === 'Enter')  { e.preventDefault(); commit(); inputRef.current?.blur(); }
          if (e.key === 'Escape') { setDraft(null); inputRef.current?.blur(); }
        }}
      />
    </div>
  );
}

function SubtypeCell({ monster, episode, onCommit }: {
  monster: Monster; episode: 1|2|4; onCommit: (v: number) => void;
}) {
  const hasUnk3Override = (monster.skin === 97 || monster.skin === 224) && monster.unknown3 === 17;
  const def = MONSTER_SUBTYPES.get(monster.skin);
  if (!hasUnk3Override && def?.field === 'movementFlag') {
    const opts: SubtypeOption[] = typeof def.options === 'function' ? def.options(episode) : def.options;
    return (
      <td>
        <select
          className={styles.subtypeSelect}
          value={monster.movementFlag}
          onChange={e => { e.stopPropagation(); onCommit(Number(e.target.value)); }}
          onClick={e => e.stopPropagation()}
        >
          {opts.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </td>
    );
  }
  const label = resolveSubtype(monster, episode);
  return <td className={label ? styles.name : undefined}>{label ?? ''}</td>;
}

// ─── Relocate button ─────────────────────────────────────────────────────────

function RelocateButton({ floorId, entityType, entityIndex, skin }: {
  floorId: number;
  entityType: 'monster' | 'object';
  entityIndex: number;
  skin?: number;
}) {
  const { setPlacementTarget, setViewMode, placementTarget } = useUiStore();
  const placement = entityType === 'object' && skin !== undefined
    ? getPlacementType(skin)
    : 'rotation';
  const isActive =
    placementTarget?.floorId === floorId &&
    placementTarget?.entityType === entityType &&
    placementTarget?.entityIndex === entityIndex;

  const handleClick = useCallback(() => {
    if (isActive) {
      useUiStore.getState().clearPlacementTarget();
    } else {
      setViewMode('2d');
      setPlacementTarget({ floorId, entityType, entityIndex, placement });
    }
  }, [isActive, setViewMode, setPlacementTarget, floorId, entityType, entityIndex, placement]);

  const title = isActive
    ? 'Cancel placement'
    : placement === 'radius' ? 'Click map to set position & radius'
    : placement === 'none'   ? 'Click map to set position'
    :                          'Click map to set position & rotation';

  return (
    <button
      className={`${styles.relocateBtn} ${isActive ? styles.relocateBtnActive : ''}`}
      title={title}
      onClick={handleClick}
    >
      {isActive ? '✕' : '⊕'}
    </button>
  );
}

// ─── Float position scrub input ──────────────────────────────────────────────
// Shows the float value + a horizontal drag scrubber alongside a text input.
// Normal drag: 0.1 units/px  |  Shift-drag: 1 unit/px.

function FloatScrubRow({ label, value, onCommit, onSnapFloor }: {
  label: string; value: number; onCommit: (v: number) => void; onSnapFloor?: () => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const commit = useCallback(() => {
    if (draft === null) return;
    const n = parseFloat(draft.trim());
    if (!isNaN(n)) onCommit(n);
    setDraft(null);
  }, [draft, onCommit]);

  const startScrub = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX   = e.clientX;
    const startVal = value;
    const onMove = (me: MouseEvent) => {
      const speed = me.shiftKey ? 1.0 : 0.1;
      onCommit(Math.round((startVal + (me.clientX - startX) * speed) * 1000) / 1000);
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [value, onCommit]);

  return (
    <div className={styles.inspRow}>
      <span className={styles.inspLabel}>{label}</span>
      <span
        className={styles.bamScrub}
        title="Drag to scrub (Shift = 10× faster)"
        onMouseDown={startScrub}
      >{value.toFixed(1)} ↔</span>
      <input
        ref={inputRef}
        className={styles.bamInput}
        value={draft ?? value.toFixed(2)}
        onChange={e => setDraft(e.target.value)}
        onFocus={() => { if (draft === null) setDraft(String(value)); }}
        onBlur={commit}
        onKeyDown={e => {
          if (e.key === 'Enter')  { commit(); inputRef.current?.blur(); }
          if (e.key === 'Escape') { setDraft(null); inputRef.current?.blur(); }
        }}
      />
      {onSnapFloor && (
        <button
          className={styles.snapFloorBtn}
          title="Snap to floor height"
          onClick={onSnapFloor}
        >↧</button>
      )}
    </div>
  );
}

// ─── BAM rotation input ──────────────────────────────────────────────────────
// Shows degrees + a horizontal drag scrubber (drag left/right to change value)
// alongside a raw BAM integer input.  Shift-drag for 10× speed.
// Scroll wheel on the scrub handle also adjusts the value (~5.6° per notch;
// Shift = ~22.5° per notch).  Seven step buttons below let you snap to common
// rotation increments.

const BAM_STEPS: Array<{ label: string; deg: number }> = [
  { label: '-90°',   deg: -90   },
  { label: '-45°',   deg: -45   },
  { label: '-22.5°', deg: -22.5 },
  { label: 'flip',   deg: 180   },
  { label: '+22.5°', deg: 22.5  },
  { label: '+45°',   deg: 45    },
  { label: '+90°',   deg: 90    },
];

function BamInputRow({ label, value, onCommit }: {
  label: string; value: number; onCommit: (v: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const inputRef  = useRef<HTMLInputElement>(null);
  const scrubRef  = useRef<HTMLSpanElement>(null);
  const commitRef = useRef(onCommit);
  const valueRef  = useRef(value);
  useEffect(() => { commitRef.current = onCommit; }, [onCommit]);
  useEffect(() => { valueRef.current  = value;    }, [value]);

  const degrees = (value * 360 / 65536).toFixed(1);

  const commit = useCallback(() => {
    if (draft === null) return;
    const s = draft.trim();
    const n = s.startsWith('0x') || s.startsWith('0X') ? parseInt(s, 16) : parseInt(s, 10);
    if (!isNaN(n)) onCommit(((n % 65536) + 65536) % 65536);
    setDraft(null);
  }, [draft, onCommit]);

  const startScrub = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX   = e.clientX;
    const startVal = value;
    const onMove = (me: MouseEvent) => {
      const speed = me.shiftKey ? 640 : 64;
      const delta = Math.round((me.clientX - startX) * speed);
      onCommit(((startVal + delta) % 65536 + 65536) % 65536);
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [value, onCommit]);

  const applyDeg = useCallback((deg: number) => {
    const bam = Math.round(deg * 65536 / 360);
    onCommit(((value + bam) % 65536 + 65536) % 65536);
  }, [value, onCommit]);

  // Non-passive wheel listener so we can call preventDefault().
  useEffect(() => {
    const el = scrubRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      const step  = e.shiftKey ? 4096 : 1024;
      const delta = e.deltaY < 0 ? step : -step;
      commitRef.current(((valueRef.current + delta) % 65536 + 65536) % 65536);
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, []);

  return (
    <>
      <div className={styles.inspRow}>
        <span className={styles.inspLabel}>{label}</span>
        <span
          ref={scrubRef}
          className={styles.bamScrub}
          title="Drag or scroll to adjust (Shift = 10×)"
          onMouseDown={startScrub}
        >{degrees}° ↔</span>
        <input
          ref={inputRef}
          className={styles.bamInput}
          value={draft ?? String(value)}
          onChange={e => setDraft(e.target.value)}
          onFocus={() => { if (draft === null) setDraft(String(value)); }}
          onBlur={commit}
          onKeyDown={e => {
            if (e.key === 'Enter')  { commit(); inputRef.current?.blur(); }
            if (e.key === 'Escape') { setDraft(null); inputRef.current?.blur(); }
          }}
        />
      </div>
      <div className={styles.bamButtons}>
        {BAM_STEPS.map(s => (
          <button
            key={s.label}
            className={styles.bamStepBtn}
            title={`${s.deg > 0 ? '+' : ''}${s.deg}°`}
            onClick={() => applyDeg(s.deg)}
          >{s.label}</button>
        ))}
      </div>
    </>
  );
}

// ─── Inspectors ──────────────────────────────────────────────────────────────

function MonsterInspector({ monster, index, floorId, areaId }: {
  monster: Monster; index: number; floorId: number; areaId: number;
}) {
  const updateMonster = useQuestStore(s => s.updateMonster);
  const episode = (useQuestStore(s => s.quest?.episode) ?? 1) as 1|2|4;
  const upd = useCallback(
    (patch: Partial<Monster>) => updateMonster(floorId, index, patch),
    [updateMonster, floorId, index],
  );
  const sc = MONSTER_SCHEMAS.get(monster.skin);
  const sl = (key: keyof Monster, fallback: string) => msl(sc, key, fallback);
  const has = (key: keyof Monster) => sc == null || sc.some(d => d.key === key);

  const hasAnyBeh = has('action') || has('movementFlag') || has('charId') || has('movementData');

  const subtypeDef = MONSTER_SUBTYPES.get(monster.skin);
  const subtypeOpts: SubtypeOption[] | null = subtypeDef?.field === 'movementFlag'
    ? (typeof subtypeDef.options === 'function' ? subtypeDef.options(episode) : subtypeDef.options)
    : null;

  return (
    <div className={styles.inspScroll}>
      <div className={styles.inspTitle}>
        Monster <span className={styles.inspIndex}>#{index}</span>
        <span className={styles.inspName}>{monsterName(monster.skin)}</span>
      </div>

      <InspectorGroup label="Identity">
        <DualSelectRow label="Skin" value={monster.skin} kind="hex" options={getMonsterSkinOptions(areaId)} onCommit={v => upd({ skin: v })} />
        <InspectorRow label="Section" value={monster.mapSection} kind="int" onCommit={v => upd({ mapSection: v })} />
      </InspectorGroup>

      <InspectorGroup
        label="Position"
        action={<RelocateButton floorId={floorId} entityType="monster" entityIndex={index} skin={undefined} />}
      >
        <FloatScrubRow label="X" value={monster.posX} onCommit={v => upd({ posX: v })} />
        <FloatScrubRow label="Y" value={monster.posY} onCommit={v => upd({ posY: v })} />
        <FloatScrubRow label="Z" value={monster.posZ} onCommit={v => upd({ posZ: v })}
          onSnapFloor={() => {
            const md = useUiStore.getState().loadedMapData;
            if (!md) return;
            const [wx, wy] = toWorldPos(monster.posX, monster.posY, monster.mapSection, md.sections);
            const z = sampleFloorHeight(wx, wy, md.triangles);
            if (z !== null) upd({ posZ: z });
          }}
        />
      </InspectorGroup>

      {has('direction') && (
        <InspectorGroup label="Direction">
          <BamInputRow label={sl('direction', 'Rotation Y')} value={monster.direction} onCommit={v => upd({ direction: v })} />
        </InspectorGroup>
      )}

      {hasAnyBeh && (
        <InspectorGroup label="Behaviour">
          {has('action')       && <InspectorRow label={sl('action',       'Action')}    value={monster.action}       kind="float" onCommit={v => upd({ action: v })} />}
          {has('movementFlag') && (subtypeOpts
            ? <DualSelectRow label={sl('movementFlag', 'Subtype')} value={monster.movementFlag} kind="int" options={subtypeOpts} onCommit={v => upd({ movementFlag: v })} />
            : <InspectorRow  label={sl('movementFlag', 'Mobile')}  value={monster.movementFlag} kind="bool" onCommit={v => upd({ movementFlag: v })} />
          )}
          {has('charId')       && <InspectorRow label={sl('charId',       'Char ID')}   value={monster.charId}       kind="float" onCommit={v => upd({ charId: v })} />}
          {has('movementData') && <InspectorRow label={sl('movementData', 'Move Data')} value={monster.movementData} kind="float" onCommit={v => upd({ movementData: v })} />}
        </InspectorGroup>
      )}

      <InspectorGroup label="Raw">
        <InspectorRow label={sl('unknown1',    'unknown1')}    value={monster.unknown1}    kind={mskind(sc, 'unknown1',    'hex')}   onCommit={v => upd({ unknown1: v })} />
        <InspectorRow label={sl('unknown2',    'unknown2')}    value={monster.unknown2}    kind={mskind(sc, 'unknown2',    'hex')}   onCommit={v => upd({ unknown2: v })} />
        <InspectorRow label={sl('unknown3',    'unknown3')}    value={monster.unknown3}    kind={mskind(sc, 'unknown3',    'hex')}   onCommit={v => upd({ unknown3: v })} />
        <InspectorRow label={sl('unknown4',    'unknown4')}    value={monster.unknown4}    kind={mskind(sc, 'unknown4',    'hex')}   onCommit={v => upd({ unknown4: v })} />
        <InspectorRow label={sl('unknown5',    'unknown5')}    value={monster.unknown5}    kind={mskind(sc, 'unknown5',    'hex')}   onCommit={v => upd({ unknown5: v })} />
        <InspectorRow label={sl('unknown6',    'unknown6')}    value={monster.unknown6}    kind={mskind(sc, 'unknown6',    'hex')}   onCommit={v => upd({ unknown6: v })} />
        <InspectorRow label={sl('unknown7',    'unknown7')}    value={monster.unknown7}    kind={mskind(sc, 'unknown7',    'hex')}   onCommit={v => upd({ unknown7: v })} />
        <InspectorRow label={sl('unknown8',    'unknown8')}    value={monster.unknown8}    kind={mskind(sc, 'unknown8',    'hex')}   onCommit={v => upd({ unknown8: v })} />
        <InspectorRow label={sl('unknown10',   'unknown10')}   value={monster.unknown10}   kind="float"                             onCommit={v => upd({ unknown10: v })} />
        <InspectorRow label={sl('unknown11',   'unknown11')}   value={monster.unknown11}   kind="float"                             onCommit={v => upd({ unknown11: v })} />
        <InspectorRow label={sl('unknownFlag', 'unknownFlag')} value={monster.unknownFlag} kind={mskind(sc, 'unknownFlag', 'hex')}   onCommit={v => upd({ unknownFlag: v })} />
      </InspectorGroup>
    </div>
  );
}

function ObjectInspector({ object, index, floorId, areaId }: {
  object: QuestObject; index: number; floorId: number; areaId: number;
}) {
  const updateObject = useQuestStore(s => s.updateObject);
  const upd = useCallback(
    (patch: Partial<QuestObject>) => updateObject(floorId, index, patch),
    [updateObject, floorId, index],
  );
  const sc = OBJECT_SCHEMAS.get(object.skin);
  const sl = (key: keyof QuestObject, fallback: string) => osl(sc, key, fallback);
  const has = (key: keyof QuestObject) => sc == null || sc.some(d => d.key === key);

  const hasAnyRot   = has('rotX') || has('rotY') || has('rotZ');
  const hasAnyScale = has('scaleX') || has('scaleY') || has('scaleZ');
  const hasAnyBeh   = has('action') || has('unknown13') || has('unknown14');

  const colorDef = OBJECT_COLOR_SUBTYPES.get(object.skin);

  return (
    <div className={styles.inspScroll}>
      <div className={styles.inspTitle}>
        Object <span className={styles.inspIndex}>#{index}</span>
        <span className={styles.inspName}>{objectName(object.skin)}</span>
      </div>

      <InspectorGroup label="Identity">
        <DualSelectRow label="Skin" value={object.skin} kind="hex" options={getObjectSkinOptions(areaId)} onCommit={v => upd({ skin: v })} />
        <InspectorRow label="ID"      value={object.id}         kind="int" onCommit={v => upd({ id: v })} />
        <InspectorRow label="Group"   value={object.group}      kind="int" onCommit={v => upd({ group: v })} />
        <InspectorRow label="Section" value={object.mapSection} kind="int" onCommit={v => upd({ mapSection: v })} />
        {has('objId') && <InspectorRow label={sl('objId', 'Obj ID')} value={object.objId} kind="int" onCommit={v => upd({ objId: v })} />}
      </InspectorGroup>

      <InspectorGroup
        label="Position"
        action={<RelocateButton floorId={floorId} entityType="object" entityIndex={index} skin={object.skin} />}
      >
        <FloatScrubRow label="X" value={object.posX} onCommit={v => upd({ posX: v })} />
        <FloatScrubRow label="Y" value={object.posY} onCommit={v => upd({ posY: v })} />
        <FloatScrubRow label="Z" value={object.posZ} onCommit={v => upd({ posZ: v })}
          onSnapFloor={() => {
            const md = useUiStore.getState().loadedMapData;
            if (!md) return;
            const [wx, wy] = toWorldPos(object.posX, object.posY, object.mapSection, md.sections);
            const z = sampleFloorHeight(wx, wy, md.triangles);
            if (z !== null) upd({ posZ: z });
          }}
        />
      </InspectorGroup>

      {hasAnyRot && (
        <InspectorGroup label="Rotation (BAM)">
          {has('rotX') && <BamInputRow label={sl('rotX', 'Rotation X')} value={object.rotX} onCommit={v => upd({ rotX: v })} />}
          {has('rotY') && <BamInputRow label={sl('rotY', 'Rotation Y')} value={object.rotY} onCommit={v => upd({ rotY: v })} />}
          {has('rotZ') && <BamInputRow label={sl('rotZ', 'Rotation Z')} value={object.rotZ} onCommit={v => upd({ rotZ: v })} />}
        </InspectorGroup>
      )}

      {hasAnyScale && (
        <InspectorGroup label="Scale">
          {has('scaleX') && (colorDef?.field === 'scaleX'
            ? <DualSelectRow label={sl('scaleX', 'Colour')} value={Math.round(object.scaleX)} kind="int" options={colorDef.options} onCommit={v => upd({ scaleX: v })} />
            : <InspectorRow  label={sl('scaleX', 'Scale X')} value={object.scaleX} kind="float" onCommit={v => upd({ scaleX: v })} />
          )}
          {has('scaleY') && <InspectorRow label={sl('scaleY', 'Scale Y')} value={object.scaleY} kind="float" onCommit={v => upd({ scaleY: v })} />}
          {has('scaleZ') && <InspectorRow label={sl('scaleZ', 'Scale Z')} value={object.scaleZ} kind="float" onCommit={v => upd({ scaleZ: v })} />}
        </InspectorGroup>
      )}

      {hasAnyBeh && (
        <InspectorGroup label="Behaviour">
          {has('action') && (colorDef?.field === 'action'
            ? <DualSelectRow label={sl('action', 'Colour')} value={object.action} kind="int" options={colorDef.options} onCommit={v => upd({ action: v })} />
            : <InspectorRow  label={sl('action', 'Action')} value={object.action} kind={oskind(sc, 'action', 'int')} onCommit={v => upd({ action: v })} />
          )}
          {has('unknown13') && (colorDef?.field === 'unknown13'
            ? <DualSelectRow label={sl('unknown13', 'Colour')} value={object.unknown13} kind="int" options={colorDef.options} onCommit={v => upd({ unknown13: v })} />
            : <InspectorRow  label={sl('unknown13', 'unknown13')} value={object.unknown13} kind={oskind(sc, 'unknown13', 'hex')} onCommit={v => upd({ unknown13: v })} />
          )}
          {has('unknown14') && <InspectorRow label={sl('unknown14', 'unknown14')} value={object.unknown14} kind={oskind(sc, 'unknown14', 'hex')} onCommit={v => upd({ unknown14: v })} />}
        </InspectorGroup>
      )}

      <InspectorGroup label="Raw">
        <InspectorRow label="unknown1" value={object.unknown1} kind="hex" onCommit={v => upd({ unknown1: v })} />
        <InspectorRow label="unknown2" value={object.unknown2} kind="hex" onCommit={v => upd({ unknown2: v })} />
        <InspectorRow label="unknown4" value={object.unknown4} kind="hex" onCommit={v => upd({ unknown4: v })} />
      </InspectorGroup>
    </div>
  );
}

// ─── Floor view ──────────────────────────────────────────────────────────────

export function FloorView() {
  const { selectedFloorId, selectedEntity } = useQuestStore();
  const floor = useSelectedFloor();
  const episode = (useQuestStore(s => s.quest?.episode) ?? 1) as 1 | 2 | 4;
  const { viewMode, setViewMode } = useUiStore();
  const [addMode, setAddMode] = useState<'monster' | 'object' | null>(null);

  const noArea   = selectedFloorId === null;
  const disabled = !noArea && !floor;

  // Cancel add mode if area changes
  useEffect(() => { setAddMode(null); }, [selectedFloorId]);

  return (
    <div className={styles.view}>

      {/* ── Top-left: Monsters ── */}
      <div className={styles.pane}>
        <div className={styles.paneHeader}>
          <span className={styles.paneTitle}>Monsters</span>
          {floor && <span className={styles.count}>{floor.monsters.length}</span>}
          {floor && (
            <button
              className={styles.addEntityBtn}
              title="Add Monster"
              onClick={() => setAddMode(addMode === 'monster' ? null : 'monster')}
            >+</button>
          )}
        </div>
        {noArea
          ? <div className={styles.placeholder}>Select an area from the sidebar</div>
          : disabled
            ? <div className={styles.empty}>Area not enabled in this quest.</div>
            : <MonsterTable monsters={floor!.monsters} floorId={floor!.id} />
        }
      </div>

      {/* ── Top-right: Objects ── */}
      <div className={styles.pane}>
        <div className={styles.paneHeader}>
          <span className={styles.paneTitle}>Objects</span>
          {floor && <span className={styles.count}>{floor.objects.length}</span>}
          {floor && (
            <button
              className={styles.addEntityBtn}
              title="Add Object"
              onClick={() => setAddMode(addMode === 'object' ? null : 'object')}
            >+</button>
          )}
        </div>
        {noArea
          ? <div className={styles.placeholder}>Select an area from the sidebar</div>
          : disabled
            ? <div className={styles.empty}>Area not enabled in this quest.</div>
            : <ObjectTable objects={floor!.objects} floorId={floor!.id} />
        }
      </div>

      {/* ── Bottom-left: 2D / 3D view ── */}
      <div className={styles.pane}>
        <div className={styles.paneHeader}>
          <span className={styles.paneTitle}>View</span>
          <div className={styles.viewToggle}>
            <button
              className={`${styles.toggleBtn} ${viewMode === '2d' ? styles.toggleActive : ''}`}
              onClick={() => setViewMode('2d')}
            >2D</button>
            <button
              className={`${styles.toggleBtn} ${viewMode === '3d' ? styles.toggleActive : ''}`}
              onClick={() => setViewMode('3d')}
            >3D</button>
          </div>
        </div>
        {viewMode === '3d'
          ? <Viewer3D />
          : noArea
            ? <div className={styles.placeholder}>Select an area from the sidebar</div>
            : <MapCanvas floor={floor} areaId={selectedFloorId!} />
        }
      </div>

      {/* ── Bottom-right: Inspector / Add panel ── */}
      <div className={styles.pane}>
        <div className={styles.paneHeader}>
          <span className={styles.paneTitle}>Inspector</span>
          {!addMode && selectedEntity && floor && (
            <span className={styles.count}>
              {selectedEntity.type === 'monster' ? 'M' : 'O'}#{selectedEntity.index}
            </span>
          )}
        </div>

        {addMode && floor
          ? <AddPanel
              kind={addMode}
              floorId={floor.id}
              areaId={selectedFloorId!}
              episode={episode}
              onDone={() => setAddMode(null)}
            />
          : (!selectedEntity || !floor
              ? <div className={styles.placeholder}>Select an entity to inspect</div>
              : selectedEntity.type === 'monster'
                ? <MonsterInspector
                    monster={floor.monsters[selectedEntity.index]}
                    index={selectedEntity.index}
                    floorId={floor.id}
                    areaId={selectedFloorId!}
                  />
                : <ObjectInspector
                    object={floor.objects[selectedEntity.index]}
                    index={selectedEntity.index}
                    floorId={floor.id}
                    areaId={selectedFloorId!}
                  />
            )
        }
      </div>

    </div>
  );
}
