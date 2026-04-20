import { useState, useRef, useEffect, useCallback } from 'react';
import { useQuestStore, useSelectedFloor } from '../../stores/questStore';
import type { Monster, QuestObject } from '../../core/model/types';
import { MapCanvas } from '../map-canvas/MapCanvas';
import { Viewer3D } from '../viewer-3d/Viewer3D';
import styles from './FloorView.module.css';

// ─── Monster names ──────────────────────────────────────────────────────────
const MONSTER_NAMES: Record<number, string> = {
  0x44: 'Booma', 0x45: 'Gobooma', 0x46: 'Gigobooma',
  0x40: 'Hildebear', 0x41: 'Hildeblue',
  0x60: 'Rappies', 0x61: 'Al Rappy', 0x62: 'Pal Rappy',
  0x80: 'Monest', 0x81: 'Mothmant',
  0xa0: 'Savage Wolf', 0xa1: 'Barbarous Wolf',
  0xc0: 'Poison Lily', 0xc1: 'Nar Lily',
  0x110: 'Nano Dragon',
  0x140: 'Shark', 0x141: 'Tollaw', 0x142: 'Baracuda',
  0x160: 'Slime',
  0x180: 'Pan Arms', 0x181: 'Migium', 0x182: 'Hidoom',
  0x1a0: 'Dubchic', 0x1a1: 'Garanz',
  0x1c0: 'Sinow Beat', 0x1c1: 'Sinow Gold',
  0x1e0: 'Canadine', 0x1e1: 'Canane',
  0x200: 'Delsaber',
  0x220: 'Chaos Sorcerer', 0x221: 'BEE-L', 0x222: 'BEE-R',
  0x280: 'Dark Gunner', 0x281: 'Death Gunner',
  0x2a0: 'Chaos Bringer',
  0x2c0: 'Dark Belra',
  0x300: 'Dimenian', 0x301: 'La Dimenian', 0x302: 'So Dimenian',
  0x320: 'Bulclaw', 0x321: 'Claw',
  0x340: 'Dragon', 0x360: 'De Rol Le', 0x380: 'Vol Opt', 0x3a0: 'Dark Falz',
  0x400: 'Hildebear', 0x401: 'Hildeblue',
  0x440: 'Merillia', 0x441: 'Merillas',
  0x460: 'Gibbon', 0x461: 'Gibbles',
  0x480: 'Gee',
  0x4a0: 'Gi Gue',
  0x4c0: 'Deldepth', 0x4e0: 'Delbiter',
  0x500: 'Dolmolm', 0x501: 'Dolmdari',
  0x520: 'Morfos',
  0x540: 'Recobox', 0x541: 'Recon',
  0x560: 'Sinow Zoa', 0x561: 'Sinow Zele',
  0x580: 'Mericarol', 0x581: 'Merikle', 0x582: 'Mericus',
  0x5a0: 'Ul Gibbon', 0x5a1: 'Zol Gibbon',
  0x5c0: 'Gulgus', 0x5c1: 'Gulgus-Gue',
  0x5e0: 'Gal Gryphon',
  0x600: 'Olga Flow',
  0x640: 'Sand Rappy', 0x641: 'Del Rappy',
  0x660: 'Astark',
  0x680: 'Satellite Lizard', 0x681: 'Yowie',
  0x6a0: 'Merissa A', 0x6a1: 'Merissa AA',
  0x6c0: 'Girtablulu',
  0x6e0: 'Zu', 0x6e1: 'Pazuzu',
  0x700: 'Boota', 0x701: 'Ze Boota', 0x702: 'Ba Boota',
  0x720: 'Dorphon', 0x721: 'Dorphon Eclair',
  0x740: 'Goran', 0x741: 'Pyro Goran', 0x742: 'Goran Detonator',
  0x760: 'Saint Milion', 0x761: 'Shambertin', 0x762: 'Kondrieu',
};

function monsterName(skin: number): string {
  return MONSTER_NAMES[skin] ?? `0x${skin.toString(16).toUpperCase().padStart(4, '0')}`;
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

function MonsterTable({ monsters, floorId }: { monsters: Monster[]; floorId: number }) {
  const updateMonster = useQuestStore(s => s.updateMonster);
  const selectEntity  = useQuestStore(s => s.selectEntity);
  const selectedEntity = useQuestStore(s => s.selectedEntity);
  const upd = useCallback(
    (i: number, patch: Partial<Monster>) => updateMonster(floorId, i, patch),
    [updateMonster, floorId]
  );

  if (monsters.length === 0) {
    return <div className={styles.empty}>No monsters on this floor</div>;
  }

  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>#</th>
            <th>Type</th>
            <th>Section</th>
            <th>Pos X</th>
            <th>Pos Y</th>
            <th>Pos Z</th>
            <th>Direction</th>
            <th>Mobile</th>
            <th>Char ID</th>
            <th>Action</th>
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

  if (objects.length === 0) {
    return <div className={styles.empty}>No objects on this floor</div>;
  }

  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>#</th>
            <th>Skin</th>
            <th>ID</th>
            <th>Group</th>
            <th>Section</th>
            <th>Pos X</th>
            <th>Pos Y</th>
            <th>Pos Z</th>
            <th>Obj ID</th>
            <th>Action</th>
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
                <EditableCell value={o.skin} kind="hex" className={styles.num}
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

function MonsterInspector({ monster, index, floorId }: { monster: Monster; index: number; floorId: number }) {
  const updateMonster = useQuestStore(s => s.updateMonster);
  const upd = useCallback(
    (patch: Partial<Monster>) => updateMonster(floorId, index, patch),
    [updateMonster, floorId, index],
  );
  return (
    <div className={styles.inspScroll}>
      <div className={styles.inspTitle}>
        Monster <span className={styles.inspIndex}>#{index}</span>
        <span className={styles.inspName}>{monsterName(monster.skin)}</span>
      </div>

      <InspectorGroup label="Identity">
        <InspectorRow label="Skin"    value={monster.skin}       kind="hex"  display={monsterName(monster.skin)} onCommit={v => upd({ skin: v })} />
        <InspectorRow label="Section" value={monster.mapSection} kind="int"  onCommit={v => upd({ mapSection: v })} />
      </InspectorGroup>

      <InspectorGroup label="Position">
        <InspectorRow label="X" value={monster.posX} kind="float" onCommit={v => upd({ posX: v })} />
        <InspectorRow label="Y" value={monster.posY} kind="float" onCommit={v => upd({ posY: v })} />
        <InspectorRow label="Z" value={monster.posZ} kind="float" onCommit={v => upd({ posZ: v })} />
      </InspectorGroup>

      <InspectorGroup label="Direction">
        <InspectorRow label="Rotation" value={monster.direction} kind="float" onCommit={v => upd({ direction: v })} />
      </InspectorGroup>

      <InspectorGroup label="Behaviour">
        <InspectorRow label="Action"    value={monster.action}       kind="float" onCommit={v => upd({ action: v })} />
        <InspectorRow label="Mobile"    value={monster.movementFlag} kind="bool"  onCommit={v => upd({ movementFlag: v })} />
        <InspectorRow label="Char ID"   value={monster.charId}       kind="float" onCommit={v => upd({ charId: v })} />
        <InspectorRow label="Move Data" value={monster.movementData} kind="float" onCommit={v => upd({ movementData: v })} />
      </InspectorGroup>

      <InspectorGroup label="Raw">
        <InspectorRow label="unknown1"   value={monster.unknown1}    kind="hex"   onCommit={v => upd({ unknown1: v })} />
        <InspectorRow label="unknown2"   value={monster.unknown2}    kind="hex"   onCommit={v => upd({ unknown2: v })} />
        <InspectorRow label="unknown3"   value={monster.unknown3}    kind="hex"   onCommit={v => upd({ unknown3: v })} />
        <InspectorRow label="unknown4"   value={monster.unknown4}    kind="hex"   onCommit={v => upd({ unknown4: v })} />
        <InspectorRow label="unknown5"   value={monster.unknown5}    kind="hex"   onCommit={v => upd({ unknown5: v })} />
        <InspectorRow label="unknown6"   value={monster.unknown6}    kind="hex"   onCommit={v => upd({ unknown6: v })} />
        <InspectorRow label="unknown7"   value={monster.unknown7}    kind="hex"   onCommit={v => upd({ unknown7: v })} />
        <InspectorRow label="unknown8"   value={monster.unknown8}    kind="hex"   onCommit={v => upd({ unknown8: v })} />
        <InspectorRow label="unknown10"  value={monster.unknown10}   kind="float" onCommit={v => upd({ unknown10: v })} />
        <InspectorRow label="unknown11"  value={monster.unknown11}   kind="float" onCommit={v => upd({ unknown11: v })} />
        <InspectorRow label="unknownFlag" value={monster.unknownFlag} kind="hex"  onCommit={v => upd({ unknownFlag: v })} />
      </InspectorGroup>
    </div>
  );
}

function ObjectInspector({ object, index, floorId }: { object: QuestObject; index: number; floorId: number }) {
  const updateObject = useQuestStore(s => s.updateObject);
  const upd = useCallback(
    (patch: Partial<QuestObject>) => updateObject(floorId, index, patch),
    [updateObject, floorId, index],
  );
  return (
    <div className={styles.inspScroll}>
      <div className={styles.inspTitle}>
        Object <span className={styles.inspIndex}>#{index}</span>
        <span className={styles.inspName}>0x{object.skin.toString(16).toUpperCase().padStart(4, '0')}</span>
      </div>

      <InspectorGroup label="Identity">
        <InspectorRow label="Skin"    value={object.skin}       kind="hex" onCommit={v => upd({ skin: v })} />
        <InspectorRow label="ID"      value={object.id}         kind="int" onCommit={v => upd({ id: v })} />
        <InspectorRow label="Group"   value={object.group}      kind="int" onCommit={v => upd({ group: v })} />
        <InspectorRow label="Section" value={object.mapSection} kind="int" onCommit={v => upd({ mapSection: v })} />
        <InspectorRow label="Obj ID"  value={object.objId}      kind="int" onCommit={v => upd({ objId: v })} />
      </InspectorGroup>

      <InspectorGroup label="Position">
        <InspectorRow label="X" value={object.posX} kind="float" onCommit={v => upd({ posX: v })} />
        <InspectorRow label="Y" value={object.posY} kind="float" onCommit={v => upd({ posY: v })} />
        <InspectorRow label="Z" value={object.posZ} kind="float" onCommit={v => upd({ posZ: v })} />
      </InspectorGroup>

      <InspectorGroup label="Rotation (BAM)">
        <InspectorRow label="X" value={object.rotX} kind="int" onCommit={v => upd({ rotX: v })} />
        <InspectorRow label="Y" value={object.rotY} kind="int" onCommit={v => upd({ rotY: v })} />
        <InspectorRow label="Z" value={object.rotZ} kind="int" onCommit={v => upd({ rotZ: v })} />
      </InspectorGroup>

      <InspectorGroup label="Scale">
        <InspectorRow label="X" value={object.scaleX} kind="float" onCommit={v => upd({ scaleX: v })} />
        <InspectorRow label="Y" value={object.scaleY} kind="float" onCommit={v => upd({ scaleY: v })} />
        <InspectorRow label="Z" value={object.scaleZ} kind="float" onCommit={v => upd({ scaleZ: v })} />
      </InspectorGroup>

      <InspectorGroup label="Behaviour">
        <InspectorRow label="Action" value={object.action} kind="int" onCommit={v => upd({ action: v })} />
      </InspectorGroup>

      <InspectorGroup label="Raw">
        <InspectorRow label="unknown1"  value={object.unknown1}  kind="hex" onCommit={v => upd({ unknown1: v })} />
        <InspectorRow label="unknown2"  value={object.unknown2}  kind="hex" onCommit={v => upd({ unknown2: v })} />
        <InspectorRow label="unknown4"  value={object.unknown4}  kind="hex" onCommit={v => upd({ unknown4: v })} />
        <InspectorRow label="unknown13" value={object.unknown13} kind="hex" onCommit={v => upd({ unknown13: v })} />
        <InspectorRow label="unknown14" value={object.unknown14} kind="hex" onCommit={v => upd({ unknown14: v })} />
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
              />
            : <ObjectInspector
                object={floor.objects[selectedEntity.index]}
                index={selectedEntity.index}
                floorId={floor.id}
              />
        }
      </div>

    </div>
  );
}
