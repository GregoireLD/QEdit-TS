import type { Monster, QuestObject } from '../model/types';
import monsterMetaRaw from '../data/monsters-meta.json';
import objectMetaRaw  from '../data/objects-meta.json';

// ─── Types ────────────────────────────────────────────────────────────────────

export type FieldKind = 'int' | 'float' | 'hex' | 'bool';

export interface MonsterFieldDesc {
  label: string;
  key: keyof Monster;
  kind?: FieldKind;
}

export interface ObjectFieldDesc {
  label: string;
  key: keyof QuestObject;
  kind?: FieldKind;
}

export interface SubtypeOption { value: number; label: string; }
export type SubtypeOptions = SubtypeOption[] | ((ep: 1|2|4) => SubtypeOption[]);
export interface MonsterSubtypeDef { field: keyof Monster; options: SubtypeOptions; }
export interface ObjectColorDef { field: keyof QuestObject; options: SubtypeOption[]; }

export interface ObjectMeta {
  name?:         string;
  placement?:    'rotation' | 'radius' | 'none';
  colorSubtype?: ObjectColorDef;
  // field may be 'objIdHi' (virtual: Math.floor(objId/256)) — kept as string intentionally
  textureSwap?:  { field: string; max: number; srcSlot: number; dstOffset: number };
  modelVariant?: { field: string; rounded?: boolean; max: number };
}

// ─── Default display kinds per field ─────────────────────────────────────────

const M_DEFAULT_KIND: Partial<Record<keyof Monster, FieldKind>> = {
  unknown2: 'int',   // "Child Count"
  unknown3: 'int',   // "Floor number"
  unknown5: 'int',   // "Wave Number 1"
  unknown6: 'int',   // "Wave Number 2"
  unknown7: 'int',   // "Subtype", etc.
  unknown8: 'int',   // various named fields
};

const O_DEFAULT_KIND: Partial<Record<keyof QuestObject, FieldKind>> = {
  rotX:      'int',
  rotY:      'int',
  rotZ:      'int',
  scaleX:    'float',
  scaleY:    'float',
  scaleZ:    'float',
  objId:     'int',
  action:    'int',
  unknown13: 'int',
  unknown14: 'int',
};

// ─── Monster schema building blocks ──────────────────────────────────────────

function mf(label: string, key: keyof Monster): MonsterFieldDesc {
  const kind = M_DEFAULT_KIND[key];
  return kind ? { label, key, kind } : { label, key };
}

// Positions 0-14 are identical for every monster entry — Delphi npcname.ini convention.
// x=9/10/11 are position fields (posX, posZ, posY — Delphi had reversed Y/Z labels).
const BASE14_FIELDS: MonsterFieldDesc[] = [
  mf('Skin',          'skin'),
  mf('Child Count',   'unknown2'),
  mf('Floor number',  'unknown3'),
  mf('Map Section',   'mapSection'),
  mf('Wave Number 1', 'unknown5'),
  mf('Wave Number 2', 'unknown6'),
  mf('Position X',    'posX'),
  mf('Position Y',    'posZ'),
  mf('Position Z',    'posY'),
  mf('Rotation Y',    'direction'),
];

// suffix positions 15-21 for the "npc" template
const NPC_SUFFIX: MonsterFieldDesc[] = [
  mf('Movement Distance', 'movementData'),
  mf('Hide Register',     'unknown11'),
  mf('Character ID',      'charId'),
  mf('Function',          'action'),
  mf('Movement Flag',     'movementFlag'),
];

// suffix positions 15-21 for the "enum" template (generic numbered labels)
const ENUM_SUFFIX: MonsterFieldDesc[] = [
  mf('1', 'movementData'),
  mf('2', 'unknown10'),
  mf('3', 'unknown11'),
  mf('4', 'charId'),
  mf('5', 'action'),
  mf('6', 'movementFlag'),
];

// ─── Schema builders ──────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildMonsterSchema(entry: any): MonsterFieldDesc[] {
  const map = new Map<keyof Monster, MonsterFieldDesc>();

  for (const fd of BASE14_FIELDS) map.set(fd.key, { ...fd });

  const suffix = entry.template === 'npc'  ? NPC_SUFFIX
               : entry.template === 'enum' ? ENUM_SUFFIX
               : [];
  for (const fd of suffix) map.set(fd.key, { ...fd });

  if (entry.fields) {
    for (const [rawKey, label] of Object.entries(entry.fields as Record<string, string>)) {
      const key  = rawKey as keyof Monster;
      const kind = M_DEFAULT_KIND[key];
      if (map.has(key)) {
        map.get(key)!.label = label;
      } else {
        map.set(key, kind ? { label, key, kind } : { label, key });
      }
    }
  }

  return Array.from(map.values());
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildObjectSchema(entry: any): ObjectFieldDesc[] {
  if (!entry.fields) return [];
  return Object.entries(entry.fields as Record<string, string>).map(([rawKey, label]) => {
    const key  = rawKey as keyof QuestObject;
    const kind = O_DEFAULT_KIND[key];
    return kind ? { label, key, kind } : { label, key };
  });
}

// Extracts the options-type subtype rule for the inspector DualSelectRow widget.
// Condition-type and episodeAlias rules are excluded (they feed resolveSubtype only).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildMonsterSubtypeDef(subtype: any): MonsterSubtypeDef | null {
  const rules: unknown[] = Array.isArray(subtype) ? subtype : [subtype];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rule = rules.find((r: any) => 'options' in r && !('condition' in r)) as any;
  if (!rule) return null;

  const field   = rule.field as keyof Monster;
  const rawOpts = rule.options;

  const options: SubtypeOptions = Array.isArray(rawOpts)
    ? (rawOpts as SubtypeOption[])
    : (ep: 1|2|4) => (rawOpts[ep === 1 ? 'ep1' : ep === 2 ? 'ep2' : 'ep4'] as SubtypeOption[]);

  return { field, options };
}

// ─── Exported maps ────────────────────────────────────────────────────────────

export const MONSTER_SCHEMAS  = new Map<number, MonsterFieldDesc[]>();
export const OBJECT_SCHEMAS   = new Map<number, ObjectFieldDesc[]>();
export const MONSTER_SUBTYPES = new Map<number, MonsterSubtypeDef>();
export const OBJECT_COLOR_SUBTYPES = new Map<number, ObjectColorDef>();
export const MONSTER_NPC_NAMES: Record<number, string> = {};
export const OBJECT_NAMES = new Map<number, string>();

const MONSTER_ALL_NAMES = new Map<number, string>();

// Private cache for full object metadata (textureSwap, modelVariant, placement, …)
const OBJECT_META_CACHE = new Map<number, ObjectMeta>();

// ─── Populate from JSON ───────────────────────────────────────────────────────

for (const [key, entry] of Object.entries(monsterMetaRaw)) {
  if (key === 'comment') continue;
  const skinId = Number(key);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const e = entry as any;

  MONSTER_SCHEMAS.set(skinId, buildMonsterSchema(e));

  if (e.name) {
    MONSTER_ALL_NAMES.set(skinId, e.name as string);
    if (e.template === 'npc' || skinId === 51) {
      MONSTER_NPC_NAMES[skinId] = e.name as string;
    }
  }

  if (e.subtype) {
    const def = buildMonsterSubtypeDef(e.subtype);
    if (def) MONSTER_SUBTYPES.set(skinId, def);
  }
}

for (const [key, entry] of Object.entries(objectMetaRaw)) {
  const skinId = Number(key);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const e = entry as any;

  OBJECT_SCHEMAS.set(skinId, buildObjectSchema(e));

  if (e.name) OBJECT_NAMES.set(skinId, e.name as string);

  if (e.colorSubtype) {
    OBJECT_COLOR_SUBTYPES.set(skinId, {
      field:   e.colorSubtype.field as keyof QuestObject,
      options: e.colorSubtype.options as SubtypeOption[],
    });
  }

  const meta: ObjectMeta = {};
  if (e.name)         meta.name         = e.name;
  if (e.placement)    meta.placement    = e.placement;
  if (e.colorSubtype) meta.colorSubtype = { field: e.colorSubtype.field as keyof QuestObject, options: e.colorSubtype.options };
  if (e.textureSwap)  meta.textureSwap  = e.textureSwap;
  if (e.modelVariant) meta.modelVariant = e.modelVariant;
  OBJECT_META_CACHE.set(skinId, meta);
}

// ─── Public accessors ─────────────────────────────────────────────────────────

export function monsterName(skin: number): string {
  return MONSTER_ALL_NAMES.get(skin) ?? `0x${skin.toString(16).toUpperCase().padStart(4, '0')}`;
}

export function objectName(skin: number): string {
  return OBJECT_NAMES.get(skin) ?? `0x${skin.toString(16).toUpperCase().padStart(4, '0')}`;
}

export function getObjectMeta(skin: number): ObjectMeta {
  return OBJECT_META_CACHE.get(skin) ?? {};
}

// ─── resolveSubtype ───────────────────────────────────────────────────────────
//
// Returns the variant name for a monster, or null if it has no known variant.
// Priority: array subtypes are checked in order (first match wins).

export function resolveSubtype(monster: Monster, episode: 1|2|4): string | null {
  const skinStr = String(monster.skin);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const entry = (monsterMetaRaw as any)[skinStr];
  if (!entry?.subtype) return null;

  const rules: unknown[] = Array.isArray(entry.subtype) ? entry.subtype : [entry.subtype];

  for (const rawRule of rules) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rule = rawRule as any;

    if ('episodeAlias' in rule) {
      return (rule.episodeAlias[String(episode)] as string | undefined) ?? null;
    }

    const fieldVal = monster[rule.field as keyof Monster] as number;

    if ('condition' in rule) {
      const { condition, value, matchLabel } = rule as { condition: string; value: number; matchLabel: string };
      switch (condition) {
        case 'eq':         if (fieldVal === value)                       return matchLabel; break;
        case 'roundedGte': if (Math.round(fieldVal) >= value)           return matchLabel; break;
        case 'roundedEq':  if (Math.round(fieldVal) === value)          return matchLabel; break;
        case 'nonzero':    if (fieldVal !== 0) return (matchLabel as string).replace('$', String(fieldVal)); break;
      }
    } else if ('options' in rule) {
      const rawOpts = rule.options;
      const opts: SubtypeOption[] = Array.isArray(rawOpts)
        ? rawOpts as SubtypeOption[]
        : rawOpts[episode === 1 ? 'ep1' : episode === 2 ? 'ep2' : 'ep4'] as SubtypeOption[];
      const found = opts?.find(o => o.value === fieldVal);
      if (found) return found.label;
    }
  }

  return null;
}
