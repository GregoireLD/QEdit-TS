import { useState, useRef, useEffect, useCallback } from 'react';
import { useQuestStore, useSelectedFloor } from '../../stores/questStore';
import type { Monster, QuestObject } from '../../core/model/types';
import { MapCanvas } from '../map-canvas/MapCanvas';
import { Viewer3D } from '../viewer-3d/Viewer3D';
import {
  MONSTER_SCHEMAS, OBJECT_SCHEMAS,
  MONSTER_NPC_NAMES, OBJECT_NAMES, objectName,
  MONSTER_SUBTYPES, resolveSubtype,
  type MonsterFieldDesc, type ObjectFieldDesc, type SubtypeOption,
} from '../../core/map/entitySchemas';
import styles from './FloorView.module.css';

// ─── Monster names ──────────────────────────────────────────────────────────
// Skin values and names are derived from Unit1.pas CheckMonsterType +
// MonsterName array (1..111) in the Delphi source.  Variants differentiated
// by movementFlag / unknow10 / episode are listed in comments but the table
// maps each base skin to its primary name only.
const MONSTER_NAMES: Record<number, string> = {
  // NPC skins from npcname.ini (skins 1–51, 69–70, 208–256, 280)
  ...MONSTER_NPC_NAMES,

  // ── Episode 1 ──
  64:  'Hildebear',        // Hildeblue: same skin, different movementFlag
  65:  'Rag Rappy',        // Al Rappy: movementFlag=1; Sand/Del Rappy in ep4
  66:  'Monest',
  67:  'Savage Wolf',      // Barbarous Wolf: unknow10≥1
  68:  'Booma',            // Gobooma: movementFlag=1; Gigobooma: movementFlag=2
  96:  'Grass Assassin',
  97:  'Poison Lily',      // Del Lily: ep1 + unknow3=17
  98:  'Nano Dragon',
  99:  'Evil Shark',       // Pal Shark: movementFlag=1; Guil Shark: movementFlag=2
  100: 'Pofuilly Slime',
  101: 'Pan Arms',
  128: 'Dubchic',          // Gilchic: movementFlag=1
  129: 'Garanz',
  130: 'Sinow Beat',       // Sinow Gold: unknow10=1
  131: 'Canadine',
  132: 'Canane',
  133: 'Dubswitch',
  160: 'Delsaber',
  161: 'Chaos Sorcerer',
  162: 'Dark Gunner',
  163: 'Death Gunner',
  164: 'Chaos Bringer',
  165: 'Dark Belra',
  166: 'Dimenian',         // La Dimenian: movementFlag=1; So Dimenian: movementFlag=2
  167: 'Bulclaw',
  168: 'Claw',
  192: 'Dragon',           // Gal Gryphon in ep2 (same skin, different episode)
  193: 'De Rol Le',
  194: 'Vol Opt (Parts)',
  197: 'Vol Opt',
  200: 'Dark Falz',

  // ── Episode 2 ──
  201: 'Gal Gryphon',
  202: 'Olga Flow',
  203: 'Barba Ray',
  204: 'Gol Dragon',
  212: 'Sinow Berill',     // Sinow Spigell: movementFlag=1
  213: 'Merillia',         // Meriltas: movementFlag=1
  214: 'Mericarol',        // Merikle: movementFlag=1; Mericus: movementFlag=2
  215: 'Ul Gibbon',        // Zol Gibbon: movementFlag=1
  216: 'Gibbles',
  217: 'Gee',
  218: 'Gi Gue',
  219: 'Deldepth',
  220: 'Delbiter',
  221: 'Dolmolm',          // Dolmdarl: movementFlag=1
  222: 'Morfos',
  223: 'Recobox',
  224: 'Sinow Zoa',        // Sinow Zele: movementFlag=1; Epsilon: unknow3=17
  225: 'Ill Gill',
  65312: 'Epsilon',        // 0xFF20 = -224 as i16

  // ── Episode 4 ──
  272: 'Astark',
  273: 'Satellite Lizard', // Yowie: unknow10=1
  274: 'Merissa A',        // Merissa AA: movementFlag=1
  275: 'Girtablulu',
  276: 'Zu',               // Pazuzu: movementFlag=1
  277: 'Boota',            // Ze Boota: movementFlag=1; Ba Boota: movementFlag=2
  278: 'Dorphon',          // Dorphon Eclair: movementFlag=1
  279: 'Goran',            // Pyro Goran: movementFlag=2; Goran Detonator: movementFlag=1
  281: 'Saint Million',    // Shambertin / Kondrieu: movementFlag variants
};

function monsterName(skin: number): string {
  return MONSTER_NAMES[skin] ?? `0x${skin.toString(16).toUpperCase().padStart(4, '0')}`;
}

// Per-area valid monster skins derived from FloorSet.ini monsv1–4 (union per area).
const AREA_MONSTER_SKINS = new Map<number, number[]>([
  [0,  [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,25,26,27,28,29,30,31,32,33,34,36,37,38,39,40,41,43,44,45,48,49,50,51,208,209,256]],
  [1,  [51,65,66,67,68,69]],
  [2,  [51,64,65,66,67,68,69,70]],
  [3,  [51,96,97,98,99,101]],
  [4,  [51,96,97,98,99,100]],
  [5,  [29,51,97,98,99,100,101]],
  [6,  [51,128,129,130,131,132,133]],
  [7,  [51,128,129,130,131,132,133]],
  [8,  [51,160,161,165,166,167,168]],
  [9,  [51,160,162,163,164,166,167,168,169]],
  [10, [51,161,162,163,164,165,166,167,168,169]],
  [11, [192]],
  [12, [193]],
  [13, [51,194,195,196,197,198,199]],
  [14, [200]],
  [15, [8]],
  [16, [51,64,96,99,130,160,164]],
  [17, [51,64,96,99,130,160,164]],
  [18, [3,6,9,11,13,14,25,27,28,29,31,32,37,38,39,40,49,51,208,209,210,211,240,241,242,243,244,245,246,247,248,249,250,251,252,253,254,255,256]],
  [19, [51,64,65,66,96,97,165,166]],
  [20, [64,65,66,96,97,165,166]],
  [21, [51,67,101,128,129,133,160]],
  [22, [51,67,101,128,133,160,161]],
  [23, [51,69,212,213,214,215,216,217,218,246,253]],
  [24, [51,69,212,213,214,215,216,217,218,246,253]],
  [25, [51,69,212,213,214,215,216,217,218,246,253]],
  [26, [51,69,212,213,214,215,216,217,218,246,253]],
  [27, [51,69,212,213,214,215,216,217,218,246,253]],
  [28, [51,219,220,221,222,223,224,244]],
  [29, [51,219,220,221,222,223,224,244]],
  [30, [192]],
  [31, [202,246]],
  [32, [203]],
  [33, [204]],
  [34, [51,69,213,215,217,221,223,253]],
  [35, [51,97,214,216,218,220,223,224,225,246]],
  [36, [25,65,69,211,243,244,272,273,276,277,278,280]],
  [37, [25,65,69,211,243,244,272,273,276,277,278,280]],
  [38, [25,65,69,211,243,244,272,273,276,277,278,280]],
  [39, [25,65,69,211,243,244,272,273,276,277,278,280]],
  [40, [25,65,69,243,244,272,273,276,277,278,280]],
  [41, [25,65,69,243,244,273,274,275,276,279,280]],
  [42, [25,41,50,65,69,243,244,273,274,275,276,279,280]],
  [43, [25,41,50,65,69,243,244,273,274,275,276,279,280]],
  [44, [25,41,243,244,280,281]],
  [45, [1,2,3,4,5,6,7,8,9,10,11,12,13,14,25,26,27,28,29,30,31,32,33,34,36,37,38,39,40,41,43,44,45,48,49,50,51,208,209,243,244,256,280]],
  [46, [65,272,273,274,275,276,277,278,279,280]],
]);

function getMonsterSkinOptions(areaId: number): SubtypeOption[] {
  const skins = AREA_MONSTER_SKINS.get(areaId) ?? [];
  return skins
    .map(v => ({ value: v, label: MONSTER_NAMES[v] ?? `0x${v.toString(16).toUpperCase().padStart(4,'0')}` }))
    .sort((a, b) => a.value - b.value);
}

function getObjectSkinOptions(areaId: number): SubtypeOption[] {
  const r: [number, number][] = [[0, 87], [384, 396]];
  if      (areaId >= 1  && areaId <= 2)   r.push([128, 151]);
  else if (areaId >= 3  && areaId <= 5)   r.push([192, 225]);
  else if (areaId >= 6  && areaId <= 7)   r.push([256, 268]);
  else if (areaId >= 8  && areaId <= 10)  r.push([304, 372]);
  else if (areaId >= 11 && areaId <= 17)  r.push([128, 372]);
  else if (areaId === 18)                 r.push([400, 403], [640, 701]);
  else if (areaId >= 19 && areaId <= 20)  r.push([128, 151], [304, 372], [416, 448]);
  else if (areaId >= 21 && areaId <= 22)  r.push([192, 268], [400, 403], [640, 701]);
  else if (areaId >= 23 && areaId <= 35)  r.push([512, 576], [640, 701]);
  else if (areaId >= 36 && areaId <= 43)  r.push([768, 913]);
  else if (areaId === 44)                 r.push([768, 913], [960, 961]);
  return Array.from(OBJECT_NAMES.entries())
    .filter(([k]) => k < 10000 && r.some(([lo, hi]) => k >= lo && k <= hi))
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
  /** Called with the validated new value on commit */
  onCommit: (v: number) => void;
  display?: string; // override displayed text (e.g. monster name)
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
  // int or hex
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

// ─── Monster table ──────────────────────────────────────────────────────────

const M_COL_INIT = [32, 120, 100, 55, 70, 70, 70, 70, 50, 70, 70];
const O_COL_INIT = [32, 130, 50, 50, 55, 70, 70, 70, 55, 55];

function MonsterTable({ monsters, floorId }: { monsters: Monster[]; floorId: number }) {
  const updateMonster = useQuestStore(s => s.updateMonster);
  const selectEntity  = useQuestStore(s => s.selectEntity);
  const selectedEntity = useQuestStore(s => s.selectedEntity);
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

  const H = ['#','Type','Subtype','Section','Pos X','Pos Y','Pos Z','Direction','Mobile','Char ID','Action'];

  return (
    <div className={styles.tableWrap}>
      <table className={styles.table} style={{ tableLayout: 'fixed', width: 'max-content', minWidth: '100%' }}>
        <colgroup>{colW.map((w, i) => <col key={i} style={{ width: w }} />)}</colgroup>
        <thead>
          <tr>
            {H.map((h, i) => (
              <th key={h}>
                {h}
                <div className={styles.resizeHandle} onMouseDown={e => rs(e, i)} />
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
  const updateObject  = useQuestStore(s => s.updateObject);
  const selectEntity  = useQuestStore(s => s.selectEntity);
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

  const H = ['#','Skin','ID','Group','Section','Pos X','Pos Y','Pos Z','Obj ID','Action'];

  return (
    <div className={styles.tableWrap}>
      <table className={styles.table} style={{ tableLayout: 'fixed', width: 'max-content', minWidth: '100%' }}>
        <colgroup>{colW.map((w, i) => <col key={i} style={{ width: w }} />)}</colgroup>
        <thead>
          <tr>
            {H.map((h, i) => (
              <th key={h}>
                {h}
                <div className={styles.resizeHandle} onMouseDown={e => rs(e, i)} />
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
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── Inspector ──────────────────────────────────────────────────────────────

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

function InspectorGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className={styles.inspGroup}>
      <div className={styles.inspGroupLabel}>{label}</div>
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

// ─── Inspectors ───────────────────────────────────────────────────────────────

function MonsterInspector({ monster, index, floorId, areaId }: { monster: Monster; index: number; floorId: number; areaId: number }) {
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
        <InspectorRow label="Section" value={monster.mapSection} kind="int"  onCommit={v => upd({ mapSection: v })} />
      </InspectorGroup>

      <InspectorGroup label="Position">
        <InspectorRow label="X" value={monster.posX} kind="float" onCommit={v => upd({ posX: v })} />
        <InspectorRow label="Y" value={monster.posY} kind="float" onCommit={v => upd({ posY: v })} />
        <InspectorRow label="Z" value={monster.posZ} kind="float" onCommit={v => upd({ posZ: v })} />
      </InspectorGroup>

      {has('direction') && (
        <InspectorGroup label="Direction">
          <InspectorRow label={sl('direction', 'Rotation Y')} value={monster.direction} kind="float" onCommit={v => upd({ direction: v })} />
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

function ObjectInspector({ object, index, floorId, areaId }: { object: QuestObject; index: number; floorId: number; areaId: number }) {
  const updateObject = useQuestStore(s => s.updateObject);
  const upd = useCallback(
    (patch: Partial<QuestObject>) => updateObject(floorId, index, patch),
    [updateObject, floorId, index],
  );
  const sc = OBJECT_SCHEMAS.get(object.skin);
  const sl = (key: keyof QuestObject, fallback: string) => osl(sc, key, fallback);
  // When no schema exists for this skin, show everything; otherwise only show fields present in the schema.
  // This matches Delphi FEdit.pas dynamic row rendering (only non-'-' ini labels produce rows).
  const has = (key: keyof QuestObject) => sc == null || sc.some(d => d.key === key);

  const hasAnyRot   = has('rotX') || has('rotY') || has('rotZ');
  const hasAnyScale = has('scaleX') || has('scaleY') || has('scaleZ');
  const hasAnyBeh   = has('action') || has('unknown13') || has('unknown14');

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

      <InspectorGroup label="Position">
        <InspectorRow label="X" value={object.posX} kind="float" onCommit={v => upd({ posX: v })} />
        <InspectorRow label="Y" value={object.posY} kind="float" onCommit={v => upd({ posY: v })} />
        <InspectorRow label="Z" value={object.posZ} kind="float" onCommit={v => upd({ posZ: v })} />
      </InspectorGroup>

      {hasAnyRot && (
        <InspectorGroup label="Rotation (BAM)">
          {has('rotX') && <InspectorRow label={sl('rotX', 'Rotation X')} value={object.rotX} kind="int" onCommit={v => upd({ rotX: v })} />}
          {has('rotY') && <InspectorRow label={sl('rotY', 'Rotation Y')} value={object.rotY} kind="int" onCommit={v => upd({ rotY: v })} />}
          {has('rotZ') && <InspectorRow label={sl('rotZ', 'Rotation Z')} value={object.rotZ} kind="int" onCommit={v => upd({ rotZ: v })} />}
        </InspectorGroup>
      )}

      {hasAnyScale && (
        <InspectorGroup label="Scale">
          {has('scaleX') && <InspectorRow label={sl('scaleX', 'Scale X')} value={object.scaleX} kind="float" onCommit={v => upd({ scaleX: v })} />}
          {has('scaleY') && <InspectorRow label={sl('scaleY', 'Scale Y')} value={object.scaleY} kind="float" onCommit={v => upd({ scaleY: v })} />}
          {has('scaleZ') && <InspectorRow label={sl('scaleZ', 'Scale Z')} value={object.scaleZ} kind="float" onCommit={v => upd({ scaleZ: v })} />}
        </InspectorGroup>
      )}

      {hasAnyBeh && (
        <InspectorGroup label="Behaviour">
          {has('action')    && <InspectorRow label={sl('action',    'Action')}    value={object.action}    kind={oskind(sc, 'action',    'int')} onCommit={v => upd({ action: v })} />}
          {has('unknown13') && <InspectorRow label={sl('unknown13', 'unknown13')} value={object.unknown13} kind={oskind(sc, 'unknown13', 'hex')} onCommit={v => upd({ unknown13: v })} />}
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

// ─── Floor view ─────────────────────────────────────────────────────────────

export function FloorView() {
  const { selectedFloorId, selectedEntity } = useQuestStore();
  const floor = useSelectedFloor();
  const [viewMode, setViewMode] = useState<'2d' | '3d'>('2d');

  const noArea = selectedFloorId === null;
  const disabled = !noArea && !floor;

  return (
    <div className={styles.view}>

      {/* ── Top-left: Monsters ── */}
      <div className={styles.pane}>
        <div className={styles.paneHeader}>
          <span className={styles.paneTitle}>Monsters</span>
          {floor && <span className={styles.count}>{floor.monsters.length}</span>}
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

      {/* ── Bottom-right: Inspector ── */}
      <div className={styles.pane}>
        <div className={styles.paneHeader}>
          <span className={styles.paneTitle}>Inspector</span>
          {selectedEntity && floor && (
            <span className={styles.count}>
              {selectedEntity.type === 'monster' ? 'M' : 'O'}#{selectedEntity.index}
            </span>
          )}
        </div>
        {!selectedEntity || !floor
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
        }
      </div>

    </div>
  );
}
