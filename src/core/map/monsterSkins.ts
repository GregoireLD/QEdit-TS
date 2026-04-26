/**
 * PSO monster skin → NJ model filename mapping.
 *
 * Ported from Unit1.pas: CheckMonsterType() and MonsterFile[].
 *
 * checkMonsterType() maps (skin, movementFlag, unknown10, unknown3, episode)
 * to a 1-based MonsterFile index.  Index 0 means "unknown / no model".
 *
 * monsterFilename() maps the index to a filename stem (no extension).
 * The actual file to load is `data/monster/{stem}.nj` (or .xj).
 * Stems starting with `../` are cross-folder references relative to `data/`
 * (e.g. `../obj/145` → `data/obj/145`).
 */

/**
 * MonsterFile[1..128] from Unit1.pas.
 * Index 0 is unused (0 = unknown/no match).
 * Index 112 ('crash') = unsupported NPC slot → no model.
 */
const MONSTER_FILE: readonly string[] = [
  '',          // 0 — unused
  'Hildebear', // 1
  'Hildeblue', // 2
  'Mothmant',  // 3
  'Mothest',   // 4
  'Rappy',     // 5
  'alRappy',   // 6
  'SavageWolf',// 7
  'BarbarousWolf', // 8
  'Boomas',    // 9
  'Gobooma',   // 10
  'Gigobooma', // 11
  'Grass',     // 12
  'lily',      // 13
  'Narlily',   // 14
  'NanoDragon',// 15
  'Shark',     // 16
  'shark2',    // 17
  'Shark3',    // 18
  'Slime',     // 19
  'Slimerare', // 20
  'PanArms',   // 21
  'Migium',    // 22
  'Hidoom',    // 23
  'Dubchic',   // 24
  'Garanz',    // 25
  'SinowBlue', // 26
  'SinowGold', // 27
  'Canadine',  // 28
  'Canane',    // 29
  'Delsaber',  // 30
  'Sorc',      // 31
  'BeeR',      // 32
  'BeeL',      // 33
  'Gunner',    // 34
  'Gunner',    // 35
  'Bringer',   // 36
  'Belra',     // 37
  'Claw',      // 38
  'Bulk',      // 39
  'Bulclaw',   // 40
  'Demenian',  // 41
  'LaDemenian',// 42
  'SoDemenian',// 43
  'ep1_Dragon',// 44
  'Ep1_DeRolLe',// 45
  'VolOpt',    // 46
  'Falz',      // 47
  'Container', // 48
  'Dubwitch',  // 49
  'Gilchic',   // 50
  'Loverappy', // 51
  'Merilia',   // 52
  'Meritas',   // 53
  'Gee',       // 54
  'gigue',     // 55
  'Mericarol', // 56
  'Merikle',   // 57
  'Mericus',   // 58
  'gibon',     // 59
  'Zolgibon',  // 60
  'Gibbles',   // 61
  'Berill',    // 62
  'Spigell',   // 63
  'Dolmolm',   // 64
  'Dolmdarl',  // 65
  'Morfos',    // 66
  'Recobox',   // 67
  'Recon',     // 68
  'Zoa',       // 69
  'Zele',      // 70
  'Deldeph',   // 71
  'Delbiter',  // 72
  'BarbaRay',  // 73
  'PigRay',    // 74
  'UlRay',     // 75
  'ep2_dragon',// 76
  'Gal',       // 77
  'Olga',      // 78
  'santaRappy',// 79
  'HallowRappy',// 80
  'EggRappy',  // 81
  'IllGill',   // 82
  'DelLily',   // 83
  'Epsilon',   // 84
  'Gael',      // 85
  'Giel',      // 86
  'Epsigard',  // 87
  'Astark',    // 88
  'Yowie',     // 89
  's_lizard',  // 90
  'MerissaA',  // 91
  'MerissaAA', // 92
  'Girt',      // 93
  'Zu',        // 94
  'Pazuzu',    // 95
  'Boota',     // 96
  'Ze_boota',  // 97
  'Ba_boota',  // 98
  'Dolphon',   // 99
  'dolphon_e', // 100
  'golan',     // 101
  'golan_p',   // 102
  'golan_d',   // 103
  'Sandlappy', // 104
  'Delrappy',  // 105
  'Saint',     // 106 (Saint Million)
  'saint2',    // 107
  'saint3',    // 108
  'VolOpt',    // 109
  'Rappy',     // 110
  'Unknown',   // 111
  'crash',     // 112 — unsupported NPC slot marker (no model)
  '../obj/145',        // 113 — forest box (cross-folder obj ref)
  'chao',              // 114
  'MiniHidle',         // 115
  '../obj/135-1',      // 116
  '../obj/135-0',      // 117
  'minigrass',         // 118
  '../obj/262',        // 119
  '../obj/339',        // 120
  '../obj/338',        // 121
  '../obj/688',        // 122
  '../obj/518',        // 123
  '../obj/521',        // 124
  '../obj/floor28/136',// 125
  'Deldeph2',          // 126
  '../obj/551',        // 127
  'nights',            // 128
];

/**
 * Returns the 1-based MonsterFile index for the given monster parameters.
 * Returns 0 when no model match is found (skin=0, NPC, or unknown type).
 *
 * Ported from CheckMonsterType() in Unit1.pas.
 */
export function checkMonsterType(
  skin:          number,
  movementFlag:  number,
  unknown10:     number,
  unknown3:      number,
  episode:       1 | 2 | 4,
): number {
  let re = 0;

  // Episode 1 monsters
  if (skin === 64) re = 1;   // Hildebear
  if (skin === 65) re = 5;   // Rag Rappy
  if (skin === 65 && movementFlag === 1) re = 6;  // Al Rappy
  if (skin === 65 && episode === 2 && movementFlag === 0) re = 5;   // Ep2 Rappy
  if (skin === 65 && episode === 2 && movementFlag === 1) re = 51;  // Love Rappy
  if (skin === 65 && episode === 4 && movementFlag === 0) re = 104; // Sandlappy
  if (skin === 65 && episode === 4 && movementFlag === 1) re = 105; // Delrappy
  if (skin === 66) re = 4;   // Monest
  if (skin === 67) re = 7;   // Savage Wolf
  if (skin === 67 && Math.round(unknown10) >= 1) re = 8;  // Barbarous Wolf
  if (skin === 68) re = 9;   // Booma
  if (skin === 68 && movementFlag === 1) re = 10; // Gobooma
  if (skin === 68 && movementFlag === 2) re = 11; // Gigobooma
  if (skin === 68 && movementFlag === 3) re = 11;
  if (skin === 69) re = 110; // (special NPC rappy)
  if (skin === 96) re = 12;  // Grass Assassin
  if (skin === 97) {
    re = 13; // Poison Lily
    if (episode === 2 && unknown3 === 17) re = 83; // Del Lily
  }
  if (skin === 98) re = 15;  // Nano Dragon
  if (skin === 99) re = 16;  // Evil Shark
  if (skin === 99 && movementFlag === 1) re = 17; // Pal Shark
  if (skin === 99 && movementFlag === 2) re = 18; // Guil Shark
  if (skin === 100) re = 19; // Pofuilly Slime
  if (skin === 101) re = 21; // Pan Arms
  if (skin === 128) re = 24; // Dubchic
  if (skin === 128 && movementFlag === 1) re = 50; // Gilchic
  if (skin === 129) re = 25; // Garanz
  if (skin === 130) re = Math.round(unknown10) === 1 ? 27 : 26; // Sinow Gold : Sinow Blue
  if (skin === 131) re = 28; // Canadine
  if (skin === 132) re = 29; // Canane
  if (skin === 133) re = 49; // Dubwitch
  if (skin === 160) re = 30; // Delsaber
  if (skin === 161) re = 31; // Chaos Sorcerer
  if (skin === 162) re = 34; // Dark Gunner
  if (skin === 163) re = 35; // Death Gunner (also mapped to 34 in Delphi for dubwitch; 35 here)
  if (skin === 164) re = 36; // Chaos Bringer
  if (skin === 165) re = 37; // Dark Belra
  if (skin === 166) re = 41; // Dimenian
  if (skin === 166 && movementFlag === 1) re = 42; // La Dimenian
  if (skin === 166 && movementFlag === 2) re = 43; // So Dimenian
  if (skin === 167) re = 40; // Bulclaw
  if (skin === 168) re = 38; // Claw

  // Episode 1 bosses
  if (skin === 192 && episode === 1) re = 44; // Dragon (Ep1)
  if (skin === 192 && episode !== 1) re = 77; // Gal Gryphon (Ep2+)
  if (skin === 193) re = 45; // De Rol Le
  if (skin === 194) re = 109; // Vol Opt phase A
  if (skin === 197) re = 46; // Vol Opt phase B
  if (skin === 200) re = 47; // Dark Falz

  // Episode 2 monsters
  if (skin === 201) re = 77;  // Gal Gryphon (again)
  if (skin === 202) re = 78;  // Olga Flow
  if (skin === 203) re = 73;  // Barba Ray
  if (skin === 204) re = 76;  // Gol Dragon
  if (skin === 212) re = 62;  // Sinow Berill
  if (skin === 212 && movementFlag === 1) re = 63; // Sinow Spigell
  if (skin === 213) re = 52;  // Merillia
  if (skin === 213 && movementFlag === 1) re = 53; // Meriltas
  if (skin === 214) re = 56;  // Mericarol
  if (skin === 214 && movementFlag === 1) re = 57; // Merikle
  if (skin === 214 && movementFlag === 2) re = 58; // Mericus
  if (skin === 215) re = 59;  // Ul Gibbon
  if (skin === 215 && movementFlag >= 1) re = 60; // Zol Gibbon
  if (skin === 216) re = 61;  // Morfos
  if (skin === 217) re = 54;  // Gee
  if (skin === 218) re = 55;  // Gi Gue
  if (skin === 219) re = 71;  // Deldepth
  if (skin === 220) re = 72;  // Delbiter
  if (skin === 221) re = 64;  // Dolmolm
  if (skin === 221 && movementFlag >= 1) re = 65; // Dolmdarl
  if (skin === 222) re = 66;  // Ill Gill
  if (skin === 223) re = 67;  // Recobox
  if (skin === 224) {
    re = 69;  // Sinow Zoa
    if (movementFlag === 1) re = 70; // Sinow Zele
    if (unknown3 === 17) re = 84;    // Epsilon
  }
  if (skin === 225) re = 82;  // Mericarol (big form)

  // Episode 4 monsters
  if (skin === 272) re = 88;  // Astark
  if (skin === 273 && Math.round(unknown10) === 1) re = 89; // Yowie
  if (skin === 273 && Math.round(unknown10) === 0) re = 90; // Satellite Lizard
  if (skin === 274) re = 91;  // Merissa A
  if (skin === 274 && movementFlag === 1) re = 92; // Merissa AA
  if (skin === 275) re = 93;  // Girtablulu
  if (skin === 276) re = 94;  // Zu
  if (skin === 276 && movementFlag === 1) re = 95; // Pazuzu
  if (skin === 277) re = 96;  // Boota
  if (skin === 277 && movementFlag === 1) re = 97; // Ze Boota
  if (skin === 277 && movementFlag >= 2) re = 98;  // Ba Boota
  if (skin === 278) re = 99;  // Dorphon
  if (skin === 278 && movementFlag === 1) re = 100; // Dorphon Eclair
  if (skin === 279) re = 101; // Goran
  if (skin === 279 && movementFlag === 1) re = 103; // Goran Detonator
  if (skin === 279 && movementFlag === 2) re = 102; // Pyro Goran
  if (skin === 281) re = 106; // Saint Million

  return re;
}

/**
 * Returns the NJ/XJ filename stem for a given monster-file index (1-based).
 * Returns null for index 0, out-of-range, or the crash sentinel (112).
 * Stems starting with `../` are cross-folder references relative to `data/`
 * (e.g. `../obj/145` → resolve as `data/obj/145`).
 */
export function monsterFilename(index: number): string | null {
  if (index < 1 || index >= MONSTER_FILE.length) return null;
  const f = MONSTER_FILE[index];
  if (!f || f === 'crash') return null;
  return f;
}

/**
 * NPC51File[floorid 0..45][slot 0..15] from MyConst.pas.
 * Maps a stage NPC (skin=51) to a MONSTER_FILE index based on floor area and slot.
 * Value 0 = no model; value 112 = unsupported ("crash") slot.
 */
export const NPC51_FILE: ReadonlyArray<ReadonlyArray<number>> = [
  [112,112,112,112,112,112,112,112,112,112,112,112,112,112,112,112], // 0
  [113,  9, 11, 10,  5,  6,  3,  4,  8,  7,114,116,117,112,112,112], // 1 Forest 1
  [113,  9, 11, 10,  5,  6,  3,  4,  8,  7,114,115,  1,  2,116,117], // 2 Forest 2
  [113, 15, 21, 23, 22, 17, 18, 16, 12,118, 13,112,112,112,112,112], // 3 Cave 1
  [113, 15, 19, 20, 17, 18, 16, 12,118, 13,112,112,112,112,112,112], // 4 Cave 2
  [113, 15, 21, 23, 22, 19, 20, 17, 18, 16, 12,118, 13,112,112,112], // 5 Cave 3
  [113, 28, 29, 50, 24, 25, 25, 26, 27,112,112,112,112,112,112,112], // 6 Mine 1
  [113, 28, 29, 50, 24, 25, 25, 26, 27,119,112,112,112,112,112,112], // 7 Mine 2
  [ 40, 39, 37, 30, 43, 42, 41, 31,120,121,112,112,112,112,112,112], // 8 Ruins 1
  [ 36, 30, 43, 42, 41,120,121,112,112,112,112,112,112,112,112,112], // 9 Ruins 2
  [ 37, 36, 43, 42, 41, 31,120,121,112,112,112,112,112,112,112,112], // 10 Ruins 3
  [112,112,112,112,112,112,112,112,112,112,112,112,112,112,112,112], // 11
  [112,112,112,112,112,112,112,112,112,112,112,112,112,112,112,112], // 12
  [112,112,112,112,112,112,112,112,112,112,112,112,112,112,112,112], // 13
  [112,112,112,112,112,112,112,112,112,112,112,112,112,112,112,112], // 14
  [112,112,112,112,112,112,112,112,112,112,112,112,112,112,112,112], // 15
  [112,112,112,112,112,112,112,112,112,112,112,112,112,112,112,112], // 16
  [112,112,112,112,112,112,112,112,112,112,112,112,112,112,112,112], // 17
  [112,112,112,112,112,112,112,112,112,112,112,112,112,112,112,112], // 18
  [  5,  6,  3,  4, 37, 43, 42, 41,115,  1,  2, 12,118,121,120,112], // 19 Ep2 VR Temple α  (slots 13/14 corrected vs Delphi: Poison Lilly→obj/338, Pillar Trap→obj/339)
  [  5,  6,  3,  4, 37, 43, 42, 41,115,  1,  2, 12,118,121,120,112], // 20 Ep2 VR Temple β  (same correction)
  [  8,  7, 30, 50, 24, 25, 25, 21, 23, 22,120,112,112,112,112,112], // 21 Ep2 VR Spaceship α
  [  8,  7, 30, 50, 24, 21, 23, 22, 31,120,112,112,112,112,112,112], // 22 Ep2 VR Spaceship β
  [  5, 51, 59, 60, 54,112, 52,112, 53,122,123,124, 55, 56, 61,112], // 23 Ep2 Central Control
  [  5, 51, 59, 60, 54,112, 52,112, 53,122,123,124, 55, 56, 61,112], // 24
  [  5, 51, 59, 60, 54,112, 52,112, 53,122,123,124, 55, 56, 61,112], // 25
  [  5, 51, 59, 60, 54,112, 52,112, 53,122,123,124, 55, 56, 61,112], // 26
  [  5, 51, 59, 60, 54,112, 52,112, 53,122,123,124, 55, 56, 61,112], // 27
  [125, 68, 67,127, 64, 72, 71,126, 69, 70, 69, 70, 66, 65,112,112], // 28 Ep2 Seabed Upper
  [125, 68, 67,127, 64, 72, 71,126, 69, 70, 69, 70, 66, 65,112,112], // 29 Ep2 Seabed Lower
  [112,112,112,112,112,112,112,112,112,112,112,112,112,112,112,112], // 30
  [112,112,112,112,112,112,112,112,112,112,112,112,112,112,112,112], // 31
  [112,112,112,112,112,112,112,112,112,112,112,112,112,112,112,112], // 32
  [112,112,112,112,112,112,112,112,112,112,112,112,112,112,112,112], // 33
  [  5, 51, 68, 67,112, 60, 54,128,128, 52, 53,122,123,124, 64, 65], // 34
  [ 68, 67, 83,122, 55, 56, 82, 61, 72, 84,112,112,112,112,112,112], // 35
  [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0], // 36 Ep4
  [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0], // 37
  [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0], // 38
  [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0], // 39
  [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0], // 40
  [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0], // 41
  [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0], // 42
  [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0], // 43
  [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0], // 44
  [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0], // 45
];

/**
 * Returns the MONSTER_FILE index for a stage NPC (skin=51) based on floor area and slot.
 * Returns 0 (no model) for out-of-range inputs or unsupported combinations.
 * Returns 112 ('crash') for valid floor/slot pairs with no mapped model — callers
 * should treat this as "no model" and show a placeholder.
 */
export function npc51FileIndex(floorId: number, slot: number): number {
  if (floorId < 0 || floorId >= NPC51_FILE.length) return 0;
  if (slot < 0 || slot >= 16) return 0;
  return NPC51_FILE[floorId][slot];
}
