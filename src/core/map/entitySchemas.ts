/**
 * Per-skin field label schemas for the inspector, derived from npcname.ini
 * and itemsname.ini in the original QEdit Delphi source.
 *
 * These are display-only overrides.  They rename generic "unknownN" fields
 * (and occasionally rename already-named fields) so the inspector can show
 * Delphi-authoritative labels for each skin type.
 *
 * The binary layout is never touched here; save/load round-trips are unaffected.
 */

import type { Monster, QuestObject } from '../model/types';

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

// ─── npcname.ini label-index → Monster field ──────────────────────────────────
//
// Delphi FEdit.pas maps the 22 label tokens (x=0..21) to Monster struct fields:
//   x=0:skin  x=1:unknown1  x=2:unknown2(lo)  x=3:unknown2(hi)
//   x=4:unknown3  x=5:unknown4  x=6:mapSection  x=7:unknown5
//   x=8:unknown6  x=9:posX  x=10:posZ  x=11:posY
//   x=12:unknown7  x=13:direction  x=14:unknown8
//   x=15:movementData  x=16:unknown10  x=17:unknown11
//   x=18:charId  x=19:action  x=20:movementFlag  x=21:unknownFlag
//
// Note: x=2 (lo) and x=3 (hi) both refer to the same TypeScript `unknown2` u32.
// When both are present we include both; when only x=3 is labelled (common for
// "Child Count") we map it to `unknown2`.
const M_KEY: Array<keyof Monster | null> = [
  'skin',         // 0
  'unknown1',     // 1
  'unknown2',     // 2  lo-word
  'unknown2',     // 3  hi-word (same TS field)
  'unknown3',     // 4
  'unknown4',     // 5
  'mapSection',   // 6
  'unknown5',     // 7
  'unknown6',     // 8
  'posX',         // 9
  'posZ',         // 10  (Delphi calls it Y but stored in posZ)
  'posY',         // 11  (Delphi calls it Z but stored in posY)
  'unknown7',     // 12
  'direction',    // 13
  'unknown8',     // 14
  'movementData', // 15
  'unknown10',    // 16
  'unknown11',    // 17
  'charId',       // 18
  'action',       // 19
  'movementFlag', // 20
  'unknownFlag',  // 21
];

// ─── itemsname.ini label-index → QuestObject field ───────────────────────────
//
// Delphi FEdit.pas maps the first 10 label tokens (x=0..9) to object fields:
//   x=0:rotX  x=1:rotY  x=2:rotZ
//   x=3:scaleX  x=4:scaleY  x=5:scaleZ
//   x=6:objId  x=7:action  x=8:unknown13  x=9:unknown14
// x=10..12 are additional split-field labels that go beyond our flat struct;
// they are preserved as 'unknown13'/'unknown14' best-effort.
const O_KEY: Array<keyof QuestObject | null> = [
  'rotX',      // 0
  'rotY',      // 1
  'rotZ',      // 2
  'scaleX',    // 3
  'scaleY',    // 4
  'scaleZ',    // 5
  'objId',     // 6
  'action',    // 7
  'unknown13', // 8
  'unknown14', // 9
  null,        // 10  hi-word splits that don't map 1:1 to our struct
  null,        // 11
  null,        // 12
];

// ─── Default display kinds per field ─────────────────────────────────────────
//
// These drive the `kind` property on schema entries so the inspector renders
// counts/IDs as decimal integers rather than hex, and floats as floats.
// Fields absent from these maps keep the inspector's own hardcoded default.

const M_DEFAULT_KIND: Partial<Record<keyof Monster, FieldKind>> = {
  // u32 fields the inspector shows as hex by default but schemas label as counts/IDs
  unknown2: 'int',   // "Child Count"
  unknown3: 'int',   // "Floor number"
  unknown5: 'int',   // "Wave Number 1"
  unknown6: 'int',   // "Wave Number 2"
  unknown7: 'int',   // "Subtype", etc.
  unknown8: 'int',   // various named fields
};

const O_DEFAULT_KIND: Partial<Record<keyof QuestObject, FieldKind>> = {
  rotX:     'int',
  rotY:     'int',
  rotZ:     'int',
  scaleX:   'float',
  scaleY:   'float',
  scaleZ:   'float',
  objId:    'int',
  action:   'int',
  unknown13: 'int',  // "Switch ID", "Stay Active", "Event Number", etc.
  unknown14: 'int',  // "Sound Mode", "SRGB", etc.
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function mDesc(labels: string[]): MonsterFieldDesc[] {
  const out: MonsterFieldDesc[] = [];
  for (let i = 0; i < labels.length && i < M_KEY.length; i++) {
    const label = labels[i];
    const key   = M_KEY[i];
    if (label !== '-' && label !== '' && key !== null) {
      const kind = M_DEFAULT_KIND[key];
      out.push(kind ? { label, key, kind } : { label, key });
    }
  }
  return out;
}

function oDesc(labels: string[]): ObjectFieldDesc[] {
  const out: ObjectFieldDesc[] = [];
  for (let i = 0; i < labels.length && i < O_KEY.length; i++) {
    const label = labels[i];
    const key   = O_KEY[i];
    if (label !== '-' && label !== '' && key !== null) {
      const kind = O_DEFAULT_KIND[key];
      out.push(kind ? { label, key, kind } : { label, key });
    }
  }
  return out;
}

// ─── Monster schema building blocks ───────────────────────────────────────────

// Positions 0-14 are identical for every entry in npcname.ini.
const BASE14 = [
  'Skin', '-', '-',
  'Child Count', 'Floor number', '-',
  'Map Section', 'Wave Number 1', 'Wave Number 2',
  'Position X', 'Position Y', 'Position Z',
  '-', 'Rotation Y', '-',
] as const;

// Build a MonsterFieldDesc[] from 7 suffix tokens (positions 15-21).
function m(...last7: string[]): MonsterFieldDesc[] {
  return mDesc([...BASE14, ...last7]);
}

// ── Common templates ──

const NPC  = m('Movement Distance', '-', 'Hide Register', 'Character ID', 'Function', 'Movement Flag', '-');
const E_NUM = m('1', '2', '3', '4', '5', '6', '-');

// ─── Monster schemas ──────────────────────────────────────────────────────────

export const MONSTER_SCHEMAS = new Map<number, MonsterFieldDesc[]>([

  // ── Human NPCs (skins 1-50, 69-70, 208-256, 280) ──
  ...[
    1, 2, 3, 4, 5, 6, 7,             // Female/Male body variants
    8, 9, 10, 11, 12, 13, 14,
    25, 26, 27, 28, 29, 30, 31, 32,  // Named NPCs (soldiers, guild, etc.)
    33, 34, 36, 37, 38, 39, 40, 41,  // Default-class PCs
    42, 43, 44,                       // Unknown
    45, 46, 47, 48, 49, 50,           // Dacci, Hopkins, etc.
    69, 70,                            // Rappy NPC, Small hildebear NPC
    208, 209, 210, 211,               // Unknown/Natasha/Dan
    240, 241, 242, 243, 244,          // Armor/Item shop, Default Fomar, Ramarl, Leo
    245, 246, 247, 248, 249,          // Pagini, Unknown, Nol, Elly, Unknown
    250, 251, 252, 253, 254, 255, 256,// Ep2 shops/guild/nurse/unknown/Momoka
    280,                               // Rupika
  ].map(id => [id, NPC] as [number, MonsterFieldDesc[]]),

  // ── Stage NPC's (skin 51) — extra subtype / movement flag fields ──
  [51, mDesc([
    'Skin', '1', '2',
    'Child Count', 'Floor number', '3',
    'Map Section', 'Wave Number 1', 'Wave Number 2',
    'Position X', 'Position Y', 'Position Z',
    'Subtype', 'Rotation Y', '4',
    'Movement Distance', '5',
    'Hide Register', 'Character ID', 'Function', 'Movement Flag', '6',
  ])],

  // ── Episode 1 monsters ──
  [64,  m('1', '2', '3', '4', '5', 'Subtype', '-')],          // Hildebear / Hildeblue
  [65,  m('1', '2', '3', '4', '5', 'Subtype', '-')],          // Rag Rappy / Sand Rappy
  [66,  m('State', 'Start Number', 'Total Number', '-', '-', '-', '-')], // Monest
  [67,  m('Group ID', 'Leader flag', '-', '-', '-', '-', '-')],// Savage Wolf / Barbarous Wolf
  [68,  m('1', 'Idle Distance', '-', '-', '-', 'Subtype', '-')],// Booma / Gobooma / Gigobooma
  [96,  m('1', '2', '3', '4', '5', '6', '-')],                 // Grass Assassin
  [97,  m('-', '-', '-', '-', '-', '-', '-')],                  // Poison Lily / Del Lily
  [98,  m('1', '2', '3', '4', '5', 'Spawn Flag', '-')],        // Nano Dragon
  [99,  m('1', 'Idle Distance', '-', '-', '-', 'Subtype', '-')],// Evil Shark / Pal Shark / Guil Shark
  [100, m('1', '2', '3', '4', '5', '6', '-')],                 // Pofuilly Slime / Pouilly Slime
  [101, m('1', '2', '3', '4', '5', '6', '-')],                 // Pan Arms / Migium / Hidoom

  [128, E_NUM],  // Gillchic / Dubchic
  [129, E_NUM],  // Garanz
  [130, E_NUM],  // Sinow Beat / Sinow Gold
  [131, E_NUM],  // Canadine / Canane
  [132, E_NUM],  // Canane (ring)
  [133, E_NUM],  // Dubchic Switch

  [160, m('Jump Distance', 'Block HP', '-', '-', '-', '-', '-')],// Delsaber
  [161, E_NUM],  // Chaos Sorcerer / Indi Belra
  [162, E_NUM],  // Dark Gunner
  [163, E_NUM],  // Death Gunner
  [164, E_NUM],  // Chaos Bringer
  [165, E_NUM],  // Darth Belra
  [166, m('1', 'Idle Distance', '2', '3', '4', 'Subtype', '-')], // Dimenian / La Dimenian / So Dimenian
  [167, E_NUM],  // Bulclaw
  [168, E_NUM],  // Claw
  [169, E_NUM],  // NPC Bringer

  [192, E_NUM],  // Dragon / Gal Gryphon
  [193, E_NUM],  // De Rol Le
  [194, E_NUM],  // Vol Opt (control)
  [195, E_NUM],  // Vol Opt (part 1)
  [196, E_NUM],  // Vol Opt (core)
  [197, E_NUM],  // Vol Opt (part 2)
  [198, E_NUM],  // Vol Opt (monitor)
  [199, E_NUM],  // Vol Opt (Hiraisan)
  [200, E_NUM],  // Dark Falz
  [201, E_NUM],  // Olga Flow
  [202, E_NUM],  // Barba Ray
  [204, E_NUM],  // Gol Dragon

  // ── Episode 2 monsters ──
  [212, E_NUM],  // Sinow Berill / Sinow Spigell
  [213, E_NUM],  // Merillias / Meriltas
  [214, E_NUM],  // Mericarol / Merikle / Mericus
  [215, m('Spot Appear', 'Jump Appear', 'Back Jump', 'Run Tech', 'Back Tech', 'Subtype', '-')], // Ul Gibbon / Zol Gibbon
  [216, E_NUM],  // Gibbles
  [217, E_NUM],  // Gee
  [218, E_NUM],  // Gi Gue
  [219, E_NUM],  // Deldepth
  [220, m('Howl Percent', 'Confuse Percent', 'Confuse Distance', 'Laser Percent', 'Charge Percent', 'Type', '-')], // Delbiter
  [221, E_NUM],  // Dolmdarl
  [222, E_NUM],  // Morfos
  [223, E_NUM],  // Reconbox
  [224, m('1', '2', '3', '4', '5', 'Subtype', '-')], // Sinow Zoa / Sinow Zele
  // skin 0xFF20 (= -224 as i16, Epsilon) — treated as unsigned 65312
  [65312, E_NUM],
  [225, E_NUM],  // Ill Gill

  // ── Episode 4 monsters ──
  [272, E_NUM],  // Astark
  [273, E_NUM],  // Satellite Lizard / Yowie
  [274, E_NUM],  // Merissa A / Merissa AA
  [275, E_NUM],  // Girtablulu
  [276, E_NUM],  // Zu / Pazuzu
  [277, E_NUM],  // Boota / Ze Boota / Ba Boota
  [278, E_NUM],  // Dorphon / Dorphon Eclair
  [279, E_NUM],  // Goran / Pyro Goran / Goran Detonator
  [281, E_NUM],  // Saint-Milion / Shambertin / Kondrieu
]);

// ─── Object schemas ───────────────────────────────────────────────────────────

export const OBJECT_SCHEMAS = new Map<number, ObjectFieldDesc[]>([

  // ── Lobby / common ──
  [0,   oDesc(['-', 'Rotation Y', '-', 'Slot ID', '-', '-', 'Return Flag', '-', '-', '-'])],            // Player Set
  [1,   oDesc(['-', 'Rotation Y', '-', '1', '2', '3', '4', '5', '6', '-'])],                            // Particle
  [2,   oDesc(['-', 'Rotation Y', '-', 'Area Number', 'Colour Blue', 'Colour Red', 'Floor Number', 'Disp Number', 'Blue =0', '-'])], // Teleporter
  [3,   oDesc(['-', 'Rotation Y', '-', 'Destination X', 'Destination Y', 'Destination Z', 'Dst Rotation Y', 'Test', '-', '-'])], // Warp
  [4,   oDesc(['1', 'Rotation Y', '2', '3', '4', '5', '6', '7', '8', '9'])],                            // Light Collision
  [5,   oDesc(['1', 'Rotation Y', '2', '3', '4', '5', '6', '7', '8', '9'])],                            // Item
  [6,   oDesc(['1', '2', '3', '4', '5', 'Radius', 'SE', 'Volume', '6', '7'])],                          // Env Sound
  [7,   oDesc(['1', '2', '3', 'Radius', '4', '5', 'Fog Index Number', '7', '8', '-'])],                 // Fog Collision
  [8,   oDesc(['-', '-', '-', 'Radius', '-', '-', 'Event Number', '-', '-', '-'])],                     // Event Collision
  [9,   oDesc(['1', 'Rotation Y', '2', '3', '4', '5', '6', '7', '8', '9'])],                            // Chara Collision
  [10,  oDesc(['-', 'Rotation Y', '-', 'Trigger Radius', 'Blast Radius', 'Trap Link', 'Damage', 'Subtype', 'Delay', '-'])], // Elemental Trap
  [11,  oDesc(['-', 'Rotation Y', '-', 'Trigger Radius', 'Blast Radius', 'Trap Link', '-', 'Subtype', 'Delay', '-'])], // Status Trap
  [12,  oDesc(['-', 'Rotation Y', '-', 'Radius', '1', 'Trap Link', 'HP', 'Subtype', 'Delay', '-'])],   // Heal Trap
  [13,  oDesc(['-', 'Rotation Y', '-', 'Radius', '1', 'Trap Link', 'Damage', 'Subtype', 'Delay', '-'])],// Large Elemental Trap
  [14,  oDesc(['-', 'Rotation Y', '-', 'SCL_TAMA', 'Next Room', 'Previous Room', '4', 'Real Rotation', 'Sticky Target (65536)', '7'])], // Obj Room ID
  [15,  oDesc(['Rotation -', 'Rotation Y', '0', '1', '2', '3', 'Switch ID', '5', '6', '7'])],          // Sensor
  [16,  oDesc(['-', 'Rotation Y', '-', '1', '2', '3', '4', '5', '6', '-'])],                            // Unknown Item (16)
  [17,  oDesc(['-', 'Rotation Y', '-', '1', '2', '3', '4', '5', '6', '-'])],                            // Lensflare
  [18,  oDesc(['-', '-', '-', 'Radius', '1', '2', 'Function', '4', '5', '-'])],                         // Script Collision
  [19,  oDesc(['-', 'Rotation Y', '-', '-', '-', '-', '-', '-', '-', '-'])],                             // Heal Ring
  [20,  oDesc(['1', 'Rotation Y', '2', '3', '4', '5', '6', '7', '8', '9'])],                            // Map Collision
  [21,  oDesc(['1', 'Rotation Y', '2', '3', '4', '5', '6', '7', '8', '9'])],                            // Script Collision A
  [22,  oDesc(['Rotation X?', 'Rotation Y', 'Rotation Z?', 'Subtype', '4', '5', '6', '7', '8', '9'])], // Item Light
  [23,  oDesc(['-', 'Rotation Y', '-', 'Radius', '2', '3', '4', '5', '6', '-'])],                       // Radar Collision
  [24,  oDesc(['-', '-', '-', 'Radius', 'Status', 'Start On (0)', 'Fog Index Number', 'Transition', 'Switch ID', '-'])], // Fog Collision SW
  [25,  oDesc(['Rotation X', 'Rotation Y', 'Rotation Z', '1', '2', '3', '4', 'Unlock ID', '6', '7'])], // Boss Teleporter
  [26,  oDesc(['Rotation X', 'Rotation Y', 'Rotation Z', 'Scale X', 'Scale Y', 'Scale Z', '1', '2', '3', '4'])], // Image Board
  [27,  oDesc(['-', 'Rotation Y', '-', '1', '2', '3', '4', '5', '6', '-'])],                            // Quest Warp
  [28,  oDesc(['-', 'Rotation Y', '-', '1', '2', '3', '4', '5', '6', '-'])],                            // Epilogue
  [29,  oDesc(['-', 'Rotation Y', '-', '1', '2', '3', '4', '5', '6', '-'])],                            // Unknown Item (29)
  [30,  oDesc(['-', 'Rotation Y', '-', '-', '-', '-', '-', '-', '-', '-'])],                             // Sun Flare
  [31,  oDesc(['-', 'Rotation Y', '-', '1', '2', '3', '4', '5', '6', '-'])],                            // White Bird
  [32,  oDesc(['-', '-', '-', 'Radius', '1', '2', 'Plate ID', 'Item Type', 'Amount (0 is 1)', '-'])],  // Box Detect Object
  [33,  oDesc(['-', '-', '-', 'Radius', '2', '3', 'Switch ID 1', 'SC ID 1', 'Switch ID 2', 'SC ID 2'])],// Symbol Chat Object
  [34,  oDesc(['-', '-', '-', 'Radius', '-', '-', 'Switch ID', 'Stay Active', '-', '-'])],              // Touch Plate Object
  [35,  oDesc(['-', 'Rotation Y', '-', 'Active ID', 'Target Type', 'Switch ID', 'HP', '5', '6', '-'])],// Targetable Object
  [36,  oDesc(['Effect ID', 'Rotation Y', '-', 'Damage Radius', 'Damage Multiplier', 'Scale (>0)', 'Switch ID', 'Switch-Off ID', 'Stay Active', '-'])], // Effect Object
  [37,  oDesc(['Multiswitch (0 or 1)', 'Sound Effect (1)', 'Duration (Frames)', '1', '2', '3', 'Switch ID 1', 'Activation Switch', 'Switch ID 2', '4'])], // Count Down Object
  [38,  oDesc(['-', 'Rotation Y', '-', 'Radius', '-', '-', 'Switch Num', '5', '-', '-'])],              // Unknown Debug Object (38)
  [39,  oDesc(['-', 'Rotation Y', '-', 'Width Scale', 'Depth Scale', '3', '>0 = Invisible', 'Num Locks', 'First Lock ID', 'SRGB'])], // Door Colour Bar
  [40,  oDesc(['-', 'Rotation Y', '-', '-', 'Duration?', 'Start State?', 'Sound Effect', 'Unk5', '-', '-'])], // Unknown SFX Obj (40)
  [41,  oDesc(['-', 'Rotation Y', '-', '1', '2', '3', 'Sound', '5', '6', '-'])],                        // Map Wide Sound

  [64,  oDesc(['-', 'Rotation Y', '-', '-', '-', '-', 'Menu ID', '-', '-', '-'])],                      // Menu Activation
  [65,  oDesc(['-', 'Rotation Y', '-', '-', '-', '-', 'Slot ID', '-', '-', '-'])],                      // Telepipe Location
  [66,  oDesc(['-', 'Rotation Y', '-', '1', '2', '3', '4', '5', '6', '-'])],                            // BGM Collision
  [67,  oDesc(['-', 'Rotation Y', '-', '-', '-', '-', '-', '-', '-', '-'])],                             // Main Ragol Teleporter
  [68,  oDesc(['-', 'Rotation Y', '-', '-', '-', '-', '-', '-', '-', '-'])],                             // Lobby Teleporter
  [69,  oDesc(['-', 'Rotation Y', '-', 'Destination X', 'Destination Y', 'Destination Z', 'Dst Rotation Y', '-', 'Model', '-'])], // Principal Warp
  [70,  oDesc(['-', 'Rotation Y', '-', '-', '-', '-', '-', '-', '-', '-'])],                             // Shop Door
  [71,  oDesc(['-', 'Rotation Y', '-', '-', '-', '-', '-', '-', '-', '-'])],                             // Hunter's Guild Door
  [72,  oDesc(['Rotation X', 'Rotation Y', 'Rotation Z', '1', '2', '3', '4', '5', '6', '7'])],         // Teleporter Door
  [73,  oDesc(['-', 'Rotation Y', '-', '-', '-', '-', '-', '-', '-', '-'])],                             // Medical Center Door
  [74,  oDesc(['-', 'Rotation Y', '-', '-', '-', '-', '-', '-', '-', '-'])],                             // Elevator
  [75,  oDesc(['-', 'Rotation Y', '-', '-', '-', '-', '-', '-', '-', '-'])],                             // Easter Egg
  [76,  oDesc(['-', 'Rotation Y', '-', '-', '-', '-', '-', '-', '-', '-'])],                             // Valentines Heart
  [77,  oDesc(['-', 'Rotation Y', '-', '-', '-', '-', '-', '-', '-', '-'])],                             // Christmas Tree
  [78,  oDesc(['-', 'Rotation Y', '-', '-', '-', '-', '-', '-', '-', '-'])],                             // Christmas Wreath
  [79,  oDesc(['-', 'Rotation Y', '-', '-', '-', '-', '-', '-', '-', '-'])],                             // Halloween Pumpkin
  [80,  oDesc(['-', 'Rotation Y', '-', '-', '-', '-', '-', '-', '-', '-'])],                             // 21st Century
  [81,  oDesc(['-', 'Rotation Y', '-', '1', '2', '3', 'Model', '5', '6', '-'])],                        // Sonic
  [82,  oDesc(['-', 'Rotation Y', '-', '-', '-', '-', '-', '-', '-', '-'])],                             // Welcome Board
  [83,  oDesc(['-', 'Rotation Y', '-', 'Mdl IDX', 'Area Width', 'Rise Height', 'Area Depth', 'Freq', '-', '-'])], // Firework
  [84,  oDesc(['-', 'Rotation Y', '-', '-', '-', '-', '-', '-', '-', '-'])],                             // Lobby Screen Door
  [85,  oDesc(['-', 'Rotation Y', '-', '-', '-', '-', '-', '-', '-', '-'])],                             // Main Ragol Teleporter (Battle)
  [86,  oDesc(['X', 'Rotation Y', 'Z', '1', '2', '3', 'Lock', '5', '6', '-'])],                        // Lab Teleporter Door
  [87,  oDesc(['A', 'B', 'C', 'Radius', '1', '2', '3', '4', '5', '6'])],                               // Trade Menu Activation

  // ── Forest ──
  [128, oDesc(['-', 'Rotation Y', '-', '-', '-', '-', 'Icon', 'Switch', '5', '6'])],                    // Forest Door
  [129, oDesc(['-', 'Rotation Y', '-', '-', '-', '-', 'Switch ID', '-', 'Colour', '-'])],               // Forest Switch
  [130, oDesc(['-', 'Rotation Y', '-', 'Colour', '-', '-', 'Switch ID', '-', 'Model', '-'])],           // Laser Fence
  [131, oDesc(['-', 'Rotation Y', '-', 'Colour', '-', '-', 'Switch ID', '-', 'Model', '-'])],           // Laser Square Fence
  [132, oDesc(['-', 'Rotation Y', '-', '-', '-', '-', 'Switch ID', '-', 'Colour', '-'])],               // Forest Laser Fence Switch
  [133, oDesc(['-', 'Rotation Y', '-', 'Scale X', 'Scale Y', 'Scale Z', '-', '-', '-', '-'])],          // Light Rays
  [134, oDesc(['-', 'Rotation Y', '-', '1', '2', '3', '4', '5', '6', '-'])],                            // Blue Butterfly
  [135, oDesc(['Rotation X', 'Rotation Y', 'Rotation Z', 'Model', '-', '-', '-', '-', '-', '-'])],      // Probe
  [136, oDesc(['-', 'Rotation Y', '-', '-', '-', '-', '-', '-', '-', '-'])],                             // Random Type Box 1
  [137, oDesc(['-', 'Rotation Y', '-', '1', '2', '3', '4', '5', '6', '-'])],                            // Forest Weather Station
  [138, oDesc(['-', 'Rotation Y', '-', '1', '2', '3', '4', '5', '6', '-'])],                            // Battery
  [139, oDesc(['-', 'Rotation Y', '-', '-', '-', '-', 'Function', 'Model', '-', '-'])],                 // Forest Console
  [140, oDesc(['Rotation X', 'Rotation Y', 'Rotation Z', 'Distance', 'Speed', 'Switch Number', 'Switch ID', 'Disable Effect', 'Enable Effect', '-'])], // Black Sliding Door
  [141, oDesc(['-', 'Rotation Y', '-', '1', '2', '3', 'Active', 'Message ID', 'Function #', '-'])],    // Rico Message Pod
  [142, oDesc(['-', 'Rotation Y', '-', '-', '-', '-', 'Door ID', '-', '-', '-'])],                      // Energy Barrier
  [143, oDesc(['-', 'Rotation Y', '-', '-', '-', '-', 'Door ID', '-', '-', '-'])],                      // Forest Rising Bridge
  [144, oDesc(['-', 'Rotation Y', '-', '-', '-', '-', 'Switch ID', '-', '-', '-'])],                    // Switch (none door)
  [145, oDesc(['-', 'Rotation Y', '-', 'Event Number', '-', '-', 'test', '-', '-', '-'])],              // Enemy Box (Grey)
  [146, oDesc(['-', 'Rotation Y', '-', 'Full Random', 'Random Item', 'Fixed Item', 'Item Parameter', 'Item Parameter 2', 'Item Parameter 3', '-'])], // Fixed Type Box
  [147, oDesc(['-', 'Rotation Y', '-', 'Event Number', '-', '-', 'test', '-', '-', '-'])],              // Enemy Box (Brown)
  [149, oDesc(['-', 'Rotation Y', '-', 'Event Number', '-', '-', '-', '-', '-', '-'])],                 // Empty Type Box
  [150, oDesc(['-', 'Rotation Y', '-', 'Colour', 'Collision Width', 'Collision Depth', 'Switch ID', '-', 'Model', '-'])], // Laser Fence Ex
  [151, oDesc(['-', 'Rotation Y', '-', 'Colour', 'Collision Width', 'Collision Depth', 'Switch ID', '-', 'Model', '-'])], // Laser Square Fence Ex

  // ── Caves ──
  [192, oDesc(['Rotation X', 'Rotation Y', 'Rotation Z', 'Scale X', 'Scale Y', 'Scale Z', 'Switch ID', 'Stay Active', '-', '-'])], // Floor Panel 1
  [193, oDesc(['-', 'Rotation Y', '-', '-', '-', '-', 'Door ID', 'Switch Total', 'Stay Active', '-'])], // Caves 4 Button Door
  [194, oDesc(['-', 'Rotation Y', '-', '-', '-', '-', 'Door ID', '-', '-', '-'])],                      // Caves Normal Door
  [195, oDesc(['-', 'Rotation Y', '-', 'Duration', '2', 'Damage', 'Switch ID', 'Global Sync', 'Behavior', '-'])], // Caves Smashing Pillar
  [196, oDesc(['-', 'Rotation Y', '-', '1', '2', '3', '4', '5', '6', '-'])],                            // Caves Sign 1
  [197, oDesc(['-', 'Rotation Y', '-', '1', '2', '3', '4', '5', '6', '-'])],                            // Caves Sign 2
  [198, oDesc(['-', 'Rotation Y', '-', '1', '2', '3', '4', '5', '6', '-'])],                            // Caves Sign 3
  [199, oDesc(['-', 'Rotation Y', '-', '1', '2', '3', '4', '5', '6', '-'])],                            // Hexagonal Tank
  [200, oDesc(['-', 'Rotation Y', '-', '1', '2', '3', '4', '5', '6', '-'])],                            // Brown Platform
  [201, oDesc(['-', 'Rotation Y', '-', '1', '2', '3', '4', '5', '6', '-'])],                            // Warning Light Object
  [203, oDesc(['-', 'Rotation Y', '-', 'Scale X', 'Scale Y', 'Scale Z', '4', '5', '6', '-'])],         // Rainbow
  [204, oDesc(['-', 'Rotation Y', '-', '1', '2', '3', '4', '5', '6', '-'])],                            // Floating Jellyfish
  [205, oDesc(['-', 'Rotation Y', '-', '1', '2', '3', '4', '5', '6', '-'])],                            // Floating Dragonfly
  [206, oDesc(['-', 'Rotation Y', '-', '-', '-', '-', 'Door ID', '-', '-', '-'])],                      // Caves Switch Door
  [207, oDesc(['-', 'Rotation Y', '-', '1', '2', '3', '4', '5', '6', '-'])],                            // Robot Recharge Station
  [208, oDesc(['-', 'Rotation Y', '-', '1', '2', '3', '4', '5', '6', '-'])],                            // Caves Cake Shop
  [209, oDesc(['-', 'Rotation Y', '-', '-', '-', '-', '-', '-', '-', '-'])],                             // Caves 1 Small Red Rock
  [210, oDesc(['-', 'Rotation Y', '-', '-', '-', '-', '-', '-', '-', '-'])],                             // Caves 1 Medium Red Rock
  [211, oDesc(['-', 'Rotation Y', '-', '-', '-', '-', '-', '-', '-', '-'])],                             // Caves 1 Large Red Rock
  [212, oDesc(['-', 'Rotation Y', '-', '-', '-', '-', '-', '-', '-', '-'])],                             // Caves 2 Small Rock 1
  [213, oDesc(['-', 'Rotation Y', '-', '-', '-', '-', '-', '-', '-', '-'])],                             // Caves 2 Medium Rock 1
  [214, oDesc(['-', 'Rotation Y', '-', '-', '-', '-', '-', '-', '-', '-'])],                             // Caves 2 Large Rock 1
  [215, oDesc(['-', 'Rotation Y', '-', '-', '-', '-', '-', '-', '-', '-'])],                             // Caves 2 Small Rock 2
  [216, oDesc(['-', 'Rotation Y', '-', '-', '-', '-', '-', '-', '-', '-'])],                             // Caves 2 Medium Rock 2
  [217, oDesc(['-', 'Rotation Y', '-', '-', '-', '-', '-', '-', '-', '-'])],                             // Caves 2 Large Rock 2
  [218, oDesc(['-', 'Rotation Y', '-', '-', '-', '-', '-', '-', '-', '-'])],                             // Caves 3 Small Rock
  [219, oDesc(['-', 'Rotation Y', '-', '-', '-', '-', '-', '-', '-', '-'])],                             // Caves 3 Medium Rock
  [220, oDesc(['-', 'Rotation Y', '-', '-', '-', '-', '-', '-', '-', '-'])],                             // Caves 3 Large Rock
  [222, oDesc(['Rotation X', 'Rotation Y', 'Rotation Z', 'Scale X', 'Scale Y', 'Scale Z', 'Switch ID', 'Sound Delay', 'Model', 'Sound Mode'])], // Floor Panel 2
  [223, oDesc(['-', 'Rotation Y', '-', '1', '2', '3', '4', '5', '6', '-'])],                            // Destructible Rock (Caves 1)
  [224, oDesc(['-', 'Rotation Y', '-', '1', '2', '3', '4', '5', '6', '-'])],                            // Destructible Rock (Caves 2)
  [225, oDesc(['-', 'Rotation Y', '-', '1', '2', '3', '4', '5', '6', '-'])],                            // Destructible Rock (Caves 3)

  // ── Mines ──
  [256, oDesc(['-', 'Rotation Y', '-', '-', '-', '-', 'Door ID', 'Switch Total', 'Stay Active', '-'])], // Mines Door
  [257, oDesc(['Rotation X', 'Rotation Y', 'Rotation Z', 'Scale X', 'Scale Y', 'Scale Z', 'Switch ID', 'Stay Active', '-', '-'])], // Floor Panel 3
  [258, oDesc(['-', 'Rotation Y', '-', '-', '-', '-', 'Door ID', 'Switch Total', 'Stay Active', '-'])], // Mines Switch Door
  [259, oDesc(['-', 'Rotation Y', '-', '-', '-', '-', '-', '-', '-', '-'])],                             // Large Cryo-Tube
  [260, oDesc(['-', 'Rotation Y', '-', '1', '2', '3', '4', '5', '6', '-'])],                            // Computer (like Calus)
  [261, oDesc(['-', 'Rotation Y', '-', '1', '2', '3', '4', '5', '6', '-'])],                            // Green Screen
  [262, oDesc(['-', 'Rotation Y', '-', '1', '2', '3', '4', '5', '6', '-'])],                            // Floating Robot
  [263, oDesc(['-', 'Rotation Y', '-', '1', '2', '3', '4', '5', '6', '-'])],                            // Floating Blue Light
  [264, oDesc(['-', 'Rotation Y', '-', '1', '2', '3', '4', '5', '6', '-'])],                            // Self Destructing Object 1
  [265, oDesc(['-', 'Rotation Y', '-', '1', '2', '3', '4', '5', '6', '-'])],                            // Self Destructing Object 2
  [266, oDesc(['-', 'Rotation Y', '-', '1', '2', '3', '4', '5', '6', '-'])],                            // Self Destructing Object 3
  [267, oDesc(['-', 'Rotation Y', '-', 'Scale X', 'Scale Y', 'Scale Z', '-', '-', '-', '-'])],          // Spark Machine
  [268, oDesc(['-', 'Rotation Y', '-', '1', '2', '3', '4', '5', '6', '-'])],                            // Mines Large Flashing Crate

  // ── Ruins ──
  [304, oDesc(['-', 'Rotation Y', '-', '-', '-', '-', '-', '-', '-', '-'])],                             // Ruins Seal
  [320, oDesc(['-', 'Rotation Y', '-', 'Area Number', 'Colour Blue', 'Colour Red', 'Floor Number', 'Disp Number', 'No Disp Number', '-'])], // Ruins Teleporter
  [321, oDesc(['-', 'Rotation Y', '-', 'Destination X', 'Destination Y', 'Destination Z', 'Dst Rotation Y', '-', '-', '-'])], // Ruins Warp
  [322, oDesc(['-', 'Rotation Y', '-', '-', '-', '-', 'Switch ID', '-', '-', '-'])],                    // Ruins Switch
  [323, oDesc(['Rotation X', 'Rotation Y', 'Rotation Z', 'Scale X', 'Scale Y', 'Scale Z', 'Plate ID', 'Stay Active', '-', '-'])], // Floor Panel 4
  [324, oDesc(['-', 'Rotation Y', '-', '-', '-', '-', 'Door ID', '-', '-', '-'])],                      // Ruins 1 Door
  [325, oDesc(['-', 'Rotation Y', '-', '-', '-', '-', 'Door ID', '-', '-', '-'])],                      // Ruins 3 Door
  [326, oDesc(['-', 'Rotation Y', '-', '-', '-', '-', 'Door ID', '-', '-', '-'])],                      // Ruins 2 Door
  [327, oDesc(['-', 'Rotation Y', '-', '-', '-', '-', 'Door ID', '-', '-', '-'])],                      // Ruins 1-1 Button Door
  [328, oDesc(['-', 'Rotation Y', '-', '-', '-', '-', 'Door ID', '-', '-', '-'])],                      // Ruins 2-1 Button Door
  [329, oDesc(['-', 'Rotation Y', '-', '-', '-', '-', 'Door ID', '-', '-', '-'])],                      // Ruins 3-1 Button Door
  [330, oDesc(['-', 'Rotation Y', '-', '-', '-', '-', 'Door ID', '5', 'Stay Active', '-'])],            // Ruins 4-Button Door
  [331, oDesc(['-', 'Rotation Y', '-', '-', '-', '-', 'Door ID', '5', 'Stay Active', '-'])],            // Ruins 2-Button Door
  [332, oDesc(['-', 'Rotation Y', '0', '1', '2', '3', 'Switch ID', '5', '6', '7'])],                   // Ruins Sensor
  [333, oDesc(['-', 'Rotation Y', '-', '-', '-', '-', 'Switch ID', 'Colour', '-', '-'])],               // Ruins Fence Switch
  [334, oDesc(['-', 'Rotation Y', '-', '-', '-', '-', 'Switch ID', 'Colour', '-', '-'])],               // Ruins Laser Fence 4x2
  [335, oDesc(['-', 'Rotation Y', '-', '-', '-', '-', 'Switch ID', 'Colour', '-', '-'])],               // Ruins Laser Fence 6x2
  [336, oDesc(['-', 'Rotation Y', '-', '-', '-', '-', 'Switch ID', 'Colour', '-', '-'])],               // Ruins Laser Fence 4x4
  [337, oDesc(['-', 'Rotation Y', '-', '-', '-', '-', 'Switch ID', 'Colour', '-', '-'])],               // Ruins Laser Fence 6x4
  [338, oDesc(['-', 'Rotation Y', '-', '1', '2', '3', '4', '5', '6', '7'])],                           // Ruins Poison Blob
  [339, oDesc(['-', 'Rotation Y', '-', '1', '+Pos Y', 'Drop Delay', 'Damage', '5', 'Explode Delay', '-'])], // Guom Trap
  [340, oDesc(['-', '-', '-', 'Radius', '1', '2', '3', '4', '5', '-'])],                                // Popup Trap (No Tech)
  [341, oDesc(['-', 'Rotation Y', '-', '1', '2', '3', '4', '5', '6', '-'])],                            // Ruins Crystal
  [342, oDesc(['-', 'Rotation Y', '-', '1', '2', '3', '4', '5', '6', '-'])],                            // Monument
  [345, oDesc(['-', 'Rotation Y', '-', '-', '-', '-', '-', '-', '-', '-'])],                             // Ruins Rock 1
  [346, oDesc(['-', 'Rotation Y', '-', '-', '-', '-', '-', '-', '-', '-'])],                             // Ruins Rock 2
  [347, oDesc(['-', 'Rotation Y', '-', '-', '-', '-', '-', '-', '-', '-'])],                             // Ruins Rock 3
  [348, oDesc(['-', 'Rotation Y', '-', '-', '-', '-', '-', '-', '-', '-'])],                             // Ruins Rock 4
  [349, oDesc(['-', 'Rotation Y', '-', '-', '-', '-', '-', '-', '-', '-'])],                             // Ruins Rock 5
  [350, oDesc(['-', 'Rotation Y', '-', '-', '-', '-', '-', '-', '-', '-'])],                             // Ruins Rock 6
  [351, oDesc(['-', 'Rotation Y', '-', '-', '-', '-', '-', '-', '-', '-'])],                             // Ruins Rock 7
  [352, oDesc(['-', '-', '-', 'Radius', 'Power', 'Link', 'Switch Mode', 'Fog Index Number', 'Switch ID', '-'])], // Poison
  [353, oDesc(['-', 'Rotation Y', '-', 'Full Random', 'Random Item', 'Fixed Item', 'Item Parameter', 'Item Parameter 2', '-', '-'])], // Fixed Box Type (Ruins)
  [354, oDesc(['-', 'Rotation Y', '-', '1', '2', '3', '4', '5', '6', '-'])],                            // Random Box Type (Ruins)
  [355, oDesc(['-', 'Rotation Y', '-', '1', '2', '3', 'Event', '5', '-', '-'])],                        // Enemy Type Box (Yellow)
  [356, oDesc(['-', 'Rotation Y', '-', '1', '2', '3', '4', '5', '-', '-'])],                            // Enemy Type Box (Blue)
  [357, oDesc(['-', 'Rotation Y', '-', '1', '2', 'test', '4', '5', '-', '-'])],                         // Empty Type Box (Blue)
  [358, oDesc(['-', 'Rotation Y', '-', '1', '2', '3', 'Switch ID', '5', '6', '7'])],                   // Destructible Rock
  [359, oDesc(['-', 'Rotation Y', '', 'Radius', 'HP', 'Tech Level', '-', 'Switch ID', 'Tech (0F)(1Giz)(2Gib)(3M)(4Gif)', '-'])], // Pop-Up Trap

  [368, oDesc(['-', 'Rotation Y', '-', '1', '2', '3', '4', '5', '6', '-'])],                            // Flying White Bird
  [369, oDesc(['-', 'Rotation Y', '-', '1', '2', '3', '4', '5', '6', '-'])],                            // Tower
  [370, oDesc(['-', 'Rotation Y', '-', '1', '2', '3', '4', '5', '6', '-'])],                            // Floating Rocks
  [371, oDesc(['-', 'Rotation Y', '-', '1', '2', '3', '4', '5', '6', '-'])],                            // Floating Soul
  [372, oDesc(['-', 'Rotation Y', '-', '1', '2', '3', '4', '5', '6', '-'])],                            // Butterfly

  // ── Lobby objects ──
  [384, oDesc(['-', 'Rotation Y', '-', '1', '2', '3', '4', '5', '6', '-'])],                            // Lobby Game Menu
  [385, oDesc(['-', 'Rotation Y', '-', '1', '2', '3', '4', '5', '6', '-'])],                            // Lobby Warp Object
  [386, oDesc(['-', 'Rotation Y', '-', '1', '2', '3', '4', '5', '6', '-'])],                            // Lobby 1 Event Object (Default Tree)
  [387, oDesc(['-', 'Rotation Y', '-', '1', '2', '3', '4', '5', '6', '-'])],                            // Unknown Item (387)
  [388, oDesc(['-', 'Rotation Y', '-', '1', '2', '3', '4', '5', '6', '-'])],                            // Unknown Item (388)
  [389, oDesc(['-', 'Rotation Y', '-', '1', '2', '3', '4', '5', '6', '-'])],                            // Unknown Item (389)
  [390, oDesc(['-', 'Rotation Y', '-', '1', '2', '3', '4', '5', '6', '-'])],                            // Lobby Event Object (Static Pumpkin)
  [391, oDesc(['-', 'Rotation Y', '-', '1', '2', '3', '4', '5', '6', '-'])],                            // Lobby Event Object (3 Christmas Windows)
  [392, oDesc(['-', 'Rotation Y', '-', '1', '2', '3', '4', '5', '6', '-'])],                            // Lobby Event Object (Red and White Curtain)
  [393, oDesc(['-', 'Rotation Y', '-', '1', '2', '3', '4', '5', '6', '-'])],                            // Unknown Item (393)
  [394, oDesc(['-', 'Rotation Y', '-', '1', '2', '3', '4', '5', '6', '-'])],                            // Unknown Item (394)
  [395, oDesc(['-', 'Rotation Y', '-', '1', '2', '3', '4', '5', '6', '-'])],                            // Lobby Fish Tank
  [396, oDesc(['-', 'Rotation Y', '-', '1', '2', '3', '4', '5', '6', '-'])],                            // Lobby Event Object (Butterflies)

  // ── Episode 2 interior / Lab ──
  [400, oDesc(['-', 'Rotation Y', '-', '1', '2', '3', '4', '5', '6', '-'])],                            // Ceiling Robots
  [401, oDesc(['-', 'Rotation Y', '-', '1', '2', '3', '4', '5', '6', '-'])],                            // Grey Wall Low
  [402, oDesc(['-', 'Rotation Y', '-', '1', '2', '3', 'Switch ID', '5', '6', '-'])],                   // Spaceship Door
  [403, oDesc(['-', 'Rotation Y', '-', '1', '2', '3', 'Wall Type?', '5', '6', '-'])],                  // Grey Wall High

  // ── Temple ──
  [416, oDesc(['-', 'Rotation Y', '-', '1', '2', '3', 'Switch ID', '5', '6', '-'])],                   // Temple Normal Door
  [417, oDesc(['-', 'Rotation Y', '-', '1', '2', '3', '4', '5', '6', '-'])],                            // Breakable Wall (unbreakable)
  [418, oDesc(['-', 'Rotation Y', '-', '1', '2', '3', '4', '5', '6', '-'])],                            // Broken Cylinder and Rubble
  [419, oDesc(['-', 'Rotation Y', '-', '1', '2', '3', '4', '5', '6', '-'])],                            // 3 Broken Wall Pieces
  [420, oDesc(['-', 'Rotation Y', '-', '1', '2', '3', '4', '5', '6', '-'])],                            // High Brick Cylinder
  [421, oDesc(['-', 'Rotation Y', '-', '1', '2', '3', '4', '5', '6', '-'])],                            // Lying Cylinder
  [422, oDesc(['-', 'Rotation Y', '-', '1', '2', '3', '4', '5', '6', '-'])],                            // Brick Cone
  [423, oDesc(['-', 'Rotation Y', '-', '1', '2', '3', 'HP (HP + -255)', '5', '6', '-'])],              // Breakable Temple Wall
  [424, oDesc(['-', 'Rotation Y', '-', '1', '2', '3', '4', '5', '6', '-'])],                            // Temple Map Detect
  [425, oDesc(['-', 'Rotation Y', '-', '1', '2', '3', '4', '5', '6', '-'])],                            // Small Brown Brick Rising Bridge
  [426, oDesc(['-', 'Rotation Y', '-', '1', 'Raise Speed', '3', 'Switch ID', '5', '6', '-'])],         // Long Rising Bridge
  [427, oDesc(['-', 'Rotation Y', '-', '1', '2', '3', 'Switch ID', 'Switch Total', 'Stay Active', '-'])],// 4 Switch Temple Door

  [448, oDesc(['-', 'Rotation Y', '-', '1', '2', '3', 'Switch ID', 'Switch Total', 'Stay Active?', '-'])], // 4 Button Spaceship Door

  // ── CCA / Seabed ──
  [512, oDesc(['-', 'Rotation Y', '-', '1', '2', '3', '4', '5', '6', '-'])],                            // Item Box CCA
  [513, oDesc(['-', 'Rotation Y', '-', '1', '2', '3', 'Floor ID', '5', 'Blue?', '-'])],                // Teleporter (Ep 2)
  [514, oDesc(['-', 'Rotation Y', '-', 'Scale X', 'Scale Y', 'Scale Z', 'Switch ID', 'Switch Amount', 'Stay Active', '-'])], // CCA Door
  [515, oDesc(['-', 'Rotation Y', '-', 'Full Random', 'Random Item', 'Fixed Item', 'Item Parameter', 'Item Parameter 2', 'Item Parameter 3', '-'])], // Special Box CCA
  [516, oDesc(['-', 'Rotation Y', '-', '1', '2', '3', '4', '5', '6', '-'])],                            // Big CCA Door
  [517, oDesc(['-', 'Rotation Y', '-', '1', '2', '3', '4', '5', '6', '-'])],                            // Big CCA Door Switch
  [518, oDesc(['-', 'Rotation Y', '-', '1', '2', '3', 'Switch ID', '5', '6', '-'])],                   // Little Rock
  [519, oDesc(['-', 'Rotation Y', '-', '-', '-', '-', 'Switch ID', '5', '6', '-'])],                   // Little 3 Stone Wall
  [520, oDesc(['-', 'Rotation Y', '-', '1', '2', '3', 'Wall Type', '5', '6', '-'])],                   // Medium 3 Stone Wall
  [521, oDesc(['-', 'Rotation', '-', '1', '2', '3', '4', '5', '6', '-'])],                              // Spider Plant
  [522, oDesc(['-', 'Rotation Y', '-', '1', '2', '3', '4', '5', 'Blue=0', '-'])],                      // CCA Area Teleporter
  [523, oDesc(['-', 'Rotation Y', '-', '1', '2', '3', '4', '5', '6', '-'])],                            // Unknown Item (523)
  [524, oDesc(['-', 'Rotation Y', '-', '1', '2', '3', '4', '5', '6', '-'])],                            // Orange Creature
  [525, oDesc(['-', 'Rotation Y', '-', '1', '2', '3', '4', '5', '6', '-'])],                            // Orange Bird
  [527, oDesc(['-', 'Rotation Y', '-', '1', 'Damage', 'Model', 'Switch ID', 'Rotation Range', 'Angle Increment', 'Full Circle'])], // Saw
  [528, oDesc(['-', 'Rotation Y', '-', '1', '2', 'Model', 'Switch ID', 'Rotation Range', 'Angle Increment', 'Full Circle'])], // Laser Detect
  [529, oDesc(['-', 'Rotation Y', '-', '1', '2', '3', '4', '5', '6', '-'])],                            // Dragonfly
  [530, oDesc(['-', 'Rotation Y', '-', '1', '2', '3', '4', '5', '6', '-'])],                            // Seagull
  [531, oDesc(['-', 'Rotation', '-', '1', '2', '3', '4', '5', '6', '-'])],                              // Driftwood

  [544, oDesc(['-', 'Rotation Y', '-', '1', '2', '3', '4', '5', '6', '-'])],                            // Fish
  [545, oDesc(['-', 'Rotation Y', '-', 'Scale X', 'Scale Y', 'Scale Z', 'Switch ID', 'Switch Amount', 'Stay Active', '-'])], // Seabed Door (blue edges)
  [546, oDesc(['-', 'Rotation Y', '-', '1', '2', '3', '4', '5', '6', '-'])],                            // Seabed Door (always open)
  [547, oDesc(['-', 'Rotation Y', '-', '1', '2', '3', 'Model', '4', '5', '-'])],                        // Little Cryotube
  [548, oDesc(['-', 'Rotation Y', '-', '1', '2', '3', 'Switch ID', 'Model', '6', '-'])],                // Wide Glass Wall (breakable)
  [549, oDesc(['-', 'Rotation Y', '-', '1', '2', '3', '4', '5', '6', '-'])],                            // Blue Floating Robot
  [550, oDesc(['-', 'Rotation Y', '-', '1', '2', '3', '4', '5', '6', '-'])],                            // Red Floating Robot
  [551, oDesc(['-', 'Rotation Y', '-', '1', '2', '3', '4', '5', '6', '-'])],                            // Dolphin
  [552, oDesc(['-', 'Rotation Y', '-', 'Speed', 'Damage', '3', 'Duration', 'Invisible?', '2:Frz 3:Shk 5:Die', '-'])], // Capture Trap
  [553, oDesc(['-', 'Rotation Y', '-', '1', '2', '3', 'Switch ID', '5', '6', '-'])],                   // VR Link

  [576, oDesc(['-', 'Rotation Y', 'Particle Type', '-', 'Render Distance?', 'Parent Flags', '5', '6', '-', '-'])], // Seabed Lower Particle

  [640, oDesc(['-', 'Rotation Y', '-', '1', '2', '3', '4', '5', '6', '-'])],                            // Warp in Barba Ray Room
  [672, oDesc(['-', 'Rotation Y', '-', '1', '2', '3', '4', '5', '6', '-'])],                            // Unknown Item (672)

  [688, oDesc(['?', 'Rotation Y', 'HP', '1', '2', '3', '4', '5', '6', '7'])],                          // Gee Nest
  [689, oDesc(['-', 'Rotation Y', '-', '1', '2', '3', '4', '5', '6', '-'])],                            // Lab Computer Console
  [690, oDesc(['-', 'Rotation Y', '-', '1', '2', '3', '4', '5', '6', '-'])],                            // Lab Computer Console (Green Screen)
  [691, oDesc(['-', 'Rotation Y', '-', '1', '2', '3', '4', '5', '6', '-'])],                            // Chair, Yellow Pillow
  [692, oDesc(['-', 'Rotation Y', '-', '1', '2', '3', '4', '5', '6', '-'])],                            // Orange Wall with hole
  [693, oDesc(['-', 'Rotation Y', '-', '1', '2', '3', '4', '5', '6', '-'])],                            // Grey Wall with hole
  [694, oDesc(['-', 'Rotation Y', '-', '1', '2', '3', '4', '5', '6', '-'])],                            // Long Table
  [695, oDesc(['-', 'Rotation Y', '-', '1', '2', '3', 'Function', '5', '6', '-'])],                    // GBA Station
  [696, oDesc(['-', 'Rotation Y', '-', 'Radius? (20)', '2', '3', 'Function', '5', '6', '-'])],         // Talk (link to support)
  [697, oDesc(['-', 'Rotation Y', '-', 'Dest X', 'Dest Y', 'Dest Z', 'Dest Rotation', 'Floor #', 'Disable Floor Disp (1)', '-'])], // Insta-Warp
  [698, oDesc(['-', 'Rotation Y', '-', 'Radius', '2', '3', 'Function', 'Activator 1=Disable', '6', '7'])], // Lab Script Collision
  [699, oDesc(['-', 'Rotation Y', '-', '1', '2', '3', '4', '5', '6', '-'])],                            // Lab Glass Window Door
  [700, oDesc(['-', 'Rotation Y', '-', '-', '-', '-', '4', '5', 'something|is_blue 2b2', '-'])],        // Ep2 Credits Tele
  [701, oDesc(['-', 'Rotation Y', '-', '1', '2', '3', '4', '5', '6', '-'])],                            // Lab Ceiling Warp

  // ── Episode 4 ──
  [768, oDesc(['-', 'Rotation Y', '-', '1', '2', '3', '4', '5', '6', '-'])],                            // Ep4 Light Source
  [769, oDesc(['-', 'Rotation Y', '-', 'Scale X', 'Scale Y', 'Scale Z', 'Model', 'Damage Power', '-', '-'])], // Cacti
  [770, oDesc(['-', 'Rotation Y', '-', '-', '-', '-', 'Model', '-', '-', '-'])],                         // Big Brown Rock
  [771, oDesc(['Unk', 'Rotation Y', 'Unk0', '1', '2', '3', 'Switch', 'Unk5', 'Unk6', 'Unk7'])],        // Breakable Brown Rock
  [832, oDesc(['-', 'Rotation Y', '-', '1', '2', '3', '4', '5', '6', '-'])],                            // Unknown Ep4 Debug (832)
  [833, oDesc(['-', 'Rotation Y', '-', '1', '2', '3', '4', '5', '6', '-'])],                            // Unknown Ep4 Debug (833)
  [896, oDesc(['-', 'Rotation Y', '-', '1', '2', '3', '4', '5', '6', '-'])],                            // Poison Plant
  [897, oDesc(['-', 'Rotation Y', '-', '1', '2', '3', '4', '5', '6', '-'])],                            // Unknown Ep4 Debug (897)
  [898, oDesc(['-', 'Rotation Y', '-', '1', '2', '3', '4', '5', '6', '-'])],                            // Unknown Item (898)
  [899, oDesc(['-', 'Rotation Y', '-', '1', '2', '3', '4', '5', '6', '-'])],                            // Oozing Desert Plant
  [901, oDesc(['-', 'Rotation Y', '-', '1', '2', '3', '4', '5', '6', '-'])],                            // Unknown Ep4 Debug (901)
  [902, oDesc(['-', 'Rotation Y', '-', '1', '2', '3', 'Model', '4', '5', '-'])],                        // Big Black Rocks
  [903, oDesc(['-', 'Rotation Y', '-', '1', '2', '3', '4', '5', '6', '-'])],                            // Unknown Ep4 Debug (903)
  [904, oDesc(['-', 'Rotation Y', '-', '1', '2', '3', '4', '5', '6', '-'])],                            // Unknown Ep4 Debug (904)
  [905, oDesc(['-', 'Rotation Y', '-', '1', '2', '3', '4', '5', '6', '-'])],                            // Unknown Ep4 Debug (905)
  [906, oDesc(['-', 'Rotation Y', '-', '1', '2', '3', '4', '5', '6', '-'])],                            // Unknown Ep4 Debug (906)
  [907, oDesc(['-', 'Rotation Y', '-', '1', '2', '3', '4', '5', '6', '-'])],                            // Falling Rock
  [908, oDesc(['-', 'Rotation Y', '-', '1', '2', '3', '4', '5', '6', '-'])],                            // Desert Plant (has collision)
  [909, oDesc(['-', 'Rotation Y', '-', '1', '2', '3', '4', '5', '6', '-'])],                            // Desert Fixed Type Box
  [910, oDesc(['-', 'Rotation Y', '-', '-', '-', '-', 'Switch Num', '-', 'Unk6', '-'])],               // Ep4 Test Door?
  [911, oDesc(['-', 'Rotation Y', '-', '-', '-', '-', 'Model', '-', '-', '-'])],                         // Bee Hive
  [912, oDesc(['-', 'Rotation Y', '-', 'Z Offset?', 'Unk2', '-', 'Num Frames', '-', '-', '-'])],        // Ep4 Test Particle?
  [913, oDesc(['-', '-', '-', 'Radius', '1', '2', 'Fog Index Number', '4', '5', '-'])],                 // Heat

  [960, oDesc(['-', 'Rotation Y', '-', '1', '2', '3', '4', '5', '6', '-'])],                            // Top of Saint Million Egg
  [961, oDesc(['-', 'Rotation Y', '-', '-', '-', '-', 'Cave Rock (set 2)', '5', '6', '-'])],            // Ep4 Boss Rock Spawner
]);

// ─── Name tables ──────────────────────────────────────────────────────────────
// Derived from npcname.ini (NPC skins) and itemsname.ini (object skins).
// Enemy names are handled by the existing MONSTER_NAMES table in FloorView.tsx.

export const MONSTER_NPC_NAMES: Record<number, string> = {
  1: 'Female Base',        2: 'Female Child',     3: 'Female Dwarf',
  4: 'Female Fat',         5: 'Female Macho',      6: 'Female Old',
  7: 'Female Tall',        8: 'Male Base',          9: 'Male Child',
  10: 'Male Dwarf',        11: 'Male Fat',          12: 'Male Macho',
  13: 'Male Old',          14: 'Male Tall',
  25: 'Blue Soldier',      26: 'Red Soldier',       27: 'Principle',
  28: 'Tekker',            29: 'Guild Lady',         30: 'Scientist',
  31: 'Nurse',             32: 'Irene',
  33: 'Ash (Humar)',       34: 'Sue (Hunewearl)',    36: 'Bernie (Ramar)',
  37: 'Gilingham (Racast)',38: 'Elenor (Racaseal)', 39: 'Alisha (Fomarl)',
  40: 'Montaque (Fomewm)', 41: 'Rupika (Fomewearl)',
  42: 'NPC 42',            43: 'NPC 43',             44: 'NPC 44',
  45: 'Dacci',             46: 'Hopkins',             47: 'NPC 47',
  48: 'HMN FRC W 01',      49: 'NMN FRC M 01',       50: 'NMN FRC W 01',
  51: 'Stage NPC',
  69: 'Rappy NPC',         70: 'Small Hildebear NPC',
  208: 'NPC 208',          209: 'Natasha',            210: 'Dan',
  211: 'NPC 211',
  240: 'Armor Shop',       241: 'Item Shop',
  242: 'Fomar (default)',  243: 'Karen (Ramarl)',     244: 'Leo',
  245: 'Pagini',           246: 'NPC 246',            247: 'Nol',
  248: 'Elly',             249: 'NPC 249',
  250: 'Ep2 Item Shop',    251: 'Ep2 Weapon Shop',    252: 'Security Guard',
  253: 'Ep2 Hunters Guild',254: 'Ep2 Nurse',          255: 'NPC 255',
  256: 'Momoka',           280: 'Rupika',
};

export const OBJECT_NAMES: Map<number, string> = new Map([
  [0,   'Player Set'],         [1,   'Particle'],           [2,   'Teleporter'],
  [3,   'Warp'],               [4,   'Light Collision'],     [5,   'Item'],
  [6,   'Env Sound'],          [7,   'Fog Collision'],       [8,   'Event Collision'],
  [9,   'Chara Collision'],    [10,  'Elemental Trap'],      [11,  'Status Trap'],
  [12,  'Heal Trap'],          [13,  'Large Elemental Trap'],[14,  'Obj Room ID'],
  [15,  'Sensor'],             [16,  'Unknown (16)'],        [17,  'Lensflare'],
  [18,  'Script Collision'],   [19,  'Heal Ring'],           [20,  'Map Collision'],
  [21,  'Script Collision A'], [22,  'Item Light'],          [23,  'Radar Collision'],
  [24,  'Fog Collision SW'],   [25,  'Boss Teleporter'],     [26,  'Image Board'],
  [27,  'Quest Warp'],         [28,  'Epilogue'],            [29,  'Unknown (29)'],
  [30,  'Sun Flare'],          [31,  'White Bird'],          [32,  'Box Detect'],
  [33,  'Symbol Chat'],        [34,  'Touch Plate'],         [35,  'Targetable'],
  [36,  'Effect Object'],      [37,  'Count Down'],          [38,  'Unknown Debug (38)'],
  [39,  'Door Colour Bar'],    [40,  'Unknown SFX (40)'],    [41,  'Map Wide Sound'],
  [64,  'Menu Activation'],    [65,  'Telepipe Location'],   [66,  'BGM Collision'],
  [67,  'Main Ragol Tele'],    [68,  'Lobby Teleporter'],    [69,  'Principal Warp'],
  [70,  'Shop Door'],          [71,  "Hunter's Guild Door"], [72,  'Teleporter Door'],
  [73,  'Medical Center Door'],[74,  'Elevator'],            [75,  'Easter Egg'],
  [76,  'Valentines Heart'],   [77,  'Christmas Tree'],      [78,  'Christmas Wreath'],
  [79,  'Halloween Pumpkin'],  [80,  '21st Century'],        [81,  'Sonic'],
  [82,  'Welcome Board'],      [83,  'Firework'],            [84,  'Lobby Screen Door'],
  [85,  'Battle Area Tele'],   [86,  'Lab Tele Door'],       [87,  'Trade Menu'],
  [128, 'Forest Door'],        [129, 'Forest Switch'],       [130, 'Laser Fence'],
  [131, 'Laser Square Fence'], [132, 'Laser Fence Switch'],  [133, 'Light Rays'],
  [134, 'Blue Butterfly'],     [135, 'Probe'],               [136, 'Random Box 1'],
  [137, 'Weather Station'],    [138, 'Battery'],             [139, 'Forest Console'],
  [140, 'Black Sliding Door'], [141, 'Rico Message Pod'],    [142, 'Energy Barrier'],
  [143, 'Forest Bridge'],      [144, 'Switch'],              [145, 'Enemy Box (Grey)'],
  [146, 'Fixed Type Box'],     [147, 'Enemy Box (Brown)'],   [149, 'Empty Type Box'],
  [150, 'Laser Fence Ex'],     [151, 'Laser Sq Fence Ex'],
  [192, 'Floor Panel 1'],      [193, 'Caves 4-Btn Door'],    [194, 'Caves Door'],
  [195, 'Smashing Pillar'],    [196, 'Caves Sign 1'],        [197, 'Caves Sign 2'],
  [198, 'Caves Sign 3'],       [199, 'Hexagonal Tank'],      [200, 'Brown Platform'],
  [201, 'Warning Light'],      [203, 'Rainbow'],             [204, 'Floating Jellyfish'],
  [205, 'Floating Dragonfly'], [206, 'Caves Switch Door'],   [207, 'Robot Recharge'],
  [208, 'Caves Cake Shop'],    [209, 'Small Red Rock'],      [210, 'Med Red Rock'],
  [211, 'Large Red Rock'],     [212, 'Small Rock 1'],        [213, 'Med Rock 1'],
  [214, 'Large Rock 1'],       [215, 'Small Rock 2'],        [216, 'Med Rock 2'],
  [217, 'Large Rock 2'],       [218, 'Small Rock 3'],        [219, 'Med Rock 3'],
  [220, 'Large Rock 3'],       [222, 'Floor Panel 2'],       [223, 'Dest Rock (C1)'],
  [224, 'Dest Rock (C2)'],     [225, 'Dest Rock (C3)'],
  [256, 'Mines Door'],         [257, 'Floor Panel 3'],       [258, 'Mines Switch Door'],
  [259, 'Large Cryo-Tube'],    [260, 'Computer'],            [261, 'Green Screen'],
  [262, 'Floating Robot'],     [263, 'Floating Blue Light'], [264, 'Self Dest Obj 1'],
  [265, 'Self Dest Obj 2'],    [266, 'Self Dest Obj 3'],     [267, 'Spark Machine'],
  [268, 'Flashing Crate'],
  [304, 'Ruins Seal'],         [320, 'Ruins Teleporter'],    [321, 'Ruins Warp'],
  [322, 'Ruins Switch'],       [323, 'Floor Panel 4'],       [324, 'Ruins 1 Door'],
  [325, 'Ruins 3 Door'],       [326, 'Ruins 2 Door'],        [327, 'Ruins 1-1 Btn Door'],
  [328, 'Ruins 2-1 Btn Door'], [329, 'Ruins 3-1 Btn Door'],  [330, 'Ruins 4-Btn Door'],
  [331, 'Ruins 2-Btn Door'],   [332, 'Ruins Sensor'],        [333, 'Ruins Fence Switch'],
  [334, 'Ruins Fence 4x2'],    [335, 'Ruins Fence 6x2'],     [336, 'Ruins Fence 4x4'],
  [337, 'Ruins Fence 6x4'],    [338, 'Ruins Poison Blob'],   [339, 'Guom Trap'],
  [340, 'Popup Trap (No Tech)'],[341, 'Ruins Crystal'],      [342, 'Monument'],
  [345, 'Ruins Rock 1'],       [346, 'Ruins Rock 2'],        [347, 'Ruins Rock 3'],
  [348, 'Ruins Rock 4'],       [349, 'Ruins Rock 5'],        [350, 'Ruins Rock 6'],
  [351, 'Ruins Rock 7'],       [352, 'Poison'],              [353, 'Fixed Box (Ruins)'],
  [354, 'Random Box (Ruins)'], [355, 'Enemy Box (Yellow)'],  [356, 'Enemy Box (Blue)'],
  [357, 'Empty Box (Blue)'],   [358, 'Dest Rock'],           [359, 'Pop-Up Trap'],
  [368, 'Flying Bird'],        [369, 'Tower'],               [370, 'Floating Rocks'],
  [371, 'Floating Soul'],      [372, 'Butterfly'],
  [384, 'Lobby Game Menu'],    [385, 'Lobby Warp'],          [386, 'Lobby Event (Tree)'],
  [387, 'Unknown (387)'],      [388, 'Unknown (388)'],       [389, 'Unknown (389)'],
  [390, 'Lobby Pumpkin'],      [391, 'Lobby Xmas Windows'],  [392, 'Lobby Curtain'],
  [393, 'Unknown (393)'],      [394, 'Unknown (394)'],       [395, 'Lobby Fish Tank'],
  [396, 'Lobby Butterflies'],
  [400, 'Ceiling Robots'],     [401, 'Grey Wall Low'],       [402, 'Spaceship Door'],
  [403, 'Grey Wall High'],
  [416, 'Temple Door'],        [417, 'Temple Wall'],         [418, 'Broken Cylinder'],
  [419, 'Broken Wall Pieces'], [420, 'Brick Cylinder'],      [421, 'Lying Cylinder'],
  [422, 'Brick Cone'],         [423, 'Breakable Wall'],       [424, 'Temple Map Detect'],
  [425, 'Small Rising Bridge'],[426, 'Long Rising Bridge'],  [427, '4-Switch Temple Door'],
  [448, '4-Btn Spaceship Door'],
  [512, 'Item Box (CCA)'],     [513, 'Teleporter (Ep2)'],    [514, 'CCA Door'],
  [515, 'Special Box (CCA)'],  [516, 'Big CCA Door'],        [517, 'Big CCA Door Switch'],
  [518, 'Little Rock'],        [519, 'Little Stone Wall'],   [520, 'Med Stone Wall'],
  [521, 'Spider Plant'],       [522, 'CCA Area Tele'],       [523, 'Unknown (523)'],
  [524, 'Orange Creature'],    [525, 'Orange Bird'],         [527, 'Saw'],
  [528, 'Laser Detect'],       [529, 'Dragonfly'],           [530, 'Seagull'],
  [531, 'Driftwood'],          [544, 'Fish'],                [545, 'Seabed Door (blue)'],
  [546, 'Seabed Door (open)'], [547, 'Little Cryo-Tube'],   [548, 'Glass Wall'],
  [549, 'Blue Float Robot'],   [550, 'Red Float Robot'],     [551, 'Dolphin'],
  [552, 'Capture Trap'],       [553, 'VR Link'],             [576, 'Seabed Particle'],
  [640, 'Barba Ray Warp'],     [672, 'Unknown (672)'],
  [688, 'Gee Nest'],           [689, 'Lab Console'],         [690, 'Lab Console (Green)'],
  [691, 'Chair'],              [692, 'Orange Wall'],         [693, 'Grey Wall w/ Hole'],
  [694, 'Long Table'],         [695, 'GBA Station'],         [696, 'Talk'],
  [697, 'Insta-Warp'],         [698, 'Lab Script Coll'],     [699, 'Lab Glass Door'],
  [700, 'Ep2 Credits Tele'],   [701, 'Lab Ceiling Warp'],
  [768, 'Ep4 Light Source'],   [769, 'Cacti'],               [770, 'Big Brown Rock'],
  [771, 'Breakable Rock'],     [832, 'Unknown Ep4 (832)'],   [833, 'Unknown Ep4 (833)'],
  [896, 'Poison Plant'],       [897, 'Unknown Ep4 (897)'],   [898, 'Unknown (898)'],
  [899, 'Oozing Desert Plant'],[901, 'Unknown Ep4 (901)'],   [902, 'Big Black Rocks'],
  [903, 'Unknown Ep4 (903)'],  [904, 'Unknown Ep4 (904)'],   [905, 'Unknown Ep4 (905)'],
  [906, 'Unknown Ep4 (906)'],  [907, 'Falling Rock'],        [908, 'Desert Plant'],
  [909, 'Desert Fixed Box'],   [910, 'Ep4 Test Door'],       [911, 'Bee Hive'],
  [912, 'Ep4 Test Particle'],  [913, 'Heat'],
  [960, 'Saint Million Egg'],  [961, 'Ep4 Rock Spawner'],
  [10000, '[QEdit] Snap Polygon'], [11000, '[QEdit] World Marker'],
]);

export function objectName(skin: number): string {
  return OBJECT_NAMES.get(skin) ?? `0x${skin.toString(16).toUpperCase().padStart(4, '0')}`;
}
