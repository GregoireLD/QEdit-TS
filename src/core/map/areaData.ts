/**
 * PSO area definitions.
 *
 * Area IDs come directly from FloorSet.ini ("area N") and match floor.id in
 * the parsed .dat file. Each area belongs to one episode and may have multiple
 * room-variant map files (*c.rel).
 */

export interface AreaVariant {
  label: string;
  file:  string;   // *c.rel filename
  xvm:   string;   // .xvm texture archive
}

export interface AreaDef {
  id:           number;
  name:         string;
  episode:      1 | 2 | 4;
  variants:     AreaVariant[];
  /** Sky dome PNG filename (in map/xvm/ folder), or '' for no sky. Matches Delphi MapSkyDome[]. */
  sky:          string;
  /** Monster skin IDs that can be placed in this area. */
  monsterSkins: number[];
  /** Object skin ID ranges (inclusive) that can be placed in this area. Always includes [0,87] and [384,396]. */
  objectRanges: [number, number][];
}

function v(label: string, file: string, xvm: string): AreaVariant { return { label, file, xvm }; }

// ─── Shared object range sets ─────────────────────────────────────────────────
const OBJ_COMMON:    [number, number][] = [[0, 87], [384, 396]];
const OBJ_FOREST:    [number, number][] = [...OBJ_COMMON, [128, 151]];
const OBJ_CAVES:     [number, number][] = [...OBJ_COMMON, [192, 225]];
const OBJ_MINES:     [number, number][] = [...OBJ_COMMON, [256, 268]];
const OBJ_RUINS:     [number, number][] = [...OBJ_COMMON, [304, 372]];
const OBJ_ALL_EP1:   [number, number][] = [...OBJ_COMMON, [128, 372]];
const OBJ_LAB:       [number, number][] = [...OBJ_COMMON, [400, 403], [640, 701]];
const OBJ_TEMPLE:    [number, number][] = [...OBJ_FOREST, [304, 372], [416, 448]];
const OBJ_SPACESHIP: [number, number][] = [...OBJ_CAVES,  [400, 403], [640, 701]];
const OBJ_CCA:       [number, number][] = [...OBJ_COMMON, [512, 576], [640, 701]];
const OBJ_EP4:       [number, number][] = [...OBJ_COMMON, [768, 913]];
const OBJ_EP4_BOSS:  [number, number][] = [...OBJ_COMMON, [768, 913], [960, 961]];

export const AREA_DEFS: readonly AreaDef[] = [
  // ── Episode 1 (areas 0–17) ──────────────────────────────────────────────
  // sky from Delphi MapSkyDome[0..17]
  { id:  0, episode: 1, name: 'Pioneer II',    sky: '',                  objectRanges: OBJ_COMMON,  monsterSkins: [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,25,26,27,28,29,30,31,32,33,34,36,37,38,39,40,41,43,44,45,48,49,50,51,208,209,256], variants: [v('Pioneer II',   'map_city00_00c.rel',      'map_city00.xvm')] },
  { id:  1, episode: 1, name: 'Forest 1',      sky: 'Forest1.png',       objectRanges: OBJ_FOREST,  monsterSkins: [51,65,66,67,68,69],                                                                                                     variants: [v('Forest 1',     'map_forest01c.rel',       'map_forest01.xvm')] },
  { id:  2, episode: 1, name: 'Forest 2',      sky: 'Forest2.png',       objectRanges: OBJ_FOREST,  monsterSkins: [51,64,65,66,67,68,69,70],                                                                                               variants: [v('Forest 2',     'map_forest02c.rel',       'map_forest02.xvm')] },
  {
    id:  3, episode: 1, name: 'Cave 1', sky: '', objectRanges: OBJ_CAVES, monsterSkins: [51,96,97,98,99,101],
    variants: [
      v('Room 00', 'map_cave01_00c.rel', 'map_cave01.xvm'),
      v('Room 01', 'map_cave01_01c.rel', 'map_cave01.xvm'),
      v('Room 02', 'map_cave01_02c.rel', 'map_cave01.xvm'),
      v('Room 03', 'map_cave01_03c.rel', 'map_cave01.xvm'),
      v('Room 04', 'map_cave01_04c.rel', 'map_cave01.xvm'),
      v('Room 05', 'map_cave01_05c.rel', 'map_cave01.xvm'),
    ],
  },
  {
    id:  4, episode: 1, name: 'Cave 2', sky: '', objectRanges: OBJ_CAVES, monsterSkins: [51,96,97,98,99,100],
    variants: [
      v('Room 00', 'map_cave02_00c.rel', 'map_cave02.xvm'),
      v('Room 01', 'map_cave02_01c.rel', 'map_cave02.xvm'),
      v('Room 02', 'map_cave02_02c.rel', 'map_cave02.xvm'),
      v('Room 03', 'map_cave02_03c.rel', 'map_cave02.xvm'),
      v('Room 04', 'map_cave02_04c.rel', 'map_cave02.xvm'),
    ],
  },
  {
    id:  5, episode: 1, name: 'Cave 3', sky: '', objectRanges: OBJ_CAVES, monsterSkins: [29,51,97,98,99,100,101],
    variants: [
      v('Room 00', 'map_cave03_00c.rel', 'map_cave03.xvm'),
      v('Room 01', 'map_cave03_01c.rel', 'map_cave03.xvm'),
      v('Room 02', 'map_cave03_02c.rel', 'map_cave03.xvm'),
      v('Room 03', 'map_cave03_03c.rel', 'map_cave03.xvm'),
      v('Room 04', 'map_cave03_04c.rel', 'map_cave03.xvm'),
      v('Room 05', 'map_cave03_05c.rel', 'map_cave03.xvm'),
    ],
  },
  {
    id:  6, episode: 1, name: 'Mine 1', sky: '', objectRanges: OBJ_MINES, monsterSkins: [51,128,129,130,131,132,133],
    variants: [
      v('Room 00', 'map_machine01_00c.rel', 'map_machine01.xvm'),
      v('Room 01', 'map_machine01_01c.rel', 'map_machine01.xvm'),
      v('Room 02', 'map_machine01_02c.rel', 'map_machine01.xvm'),
      v('Room 03', 'map_machine01_03c.rel', 'map_machine01.xvm'),
      v('Room 04', 'map_machine01_04c.rel', 'map_machine01.xvm'),
      v('Room 05', 'map_machine01_05c.rel', 'map_machine01.xvm'),
    ],
  },
  {
    id:  7, episode: 1, name: 'Mine 2', sky: '', objectRanges: OBJ_MINES, monsterSkins: [51,128,129,130,131,132,133],
    variants: [
      v('Room 00', 'map_machine02_00c.rel', 'map_machine02.xvm'),
      v('Room 01', 'map_machine02_01c.rel', 'map_machine02.xvm'),
      v('Room 02', 'map_machine02_02c.rel', 'map_machine02.xvm'),
      v('Room 03', 'map_machine02_03c.rel', 'map_machine02.xvm'),
      v('Room 04', 'map_machine02_04c.rel', 'map_machine02.xvm'),
      v('Room 05', 'map_machine02_05c.rel', 'map_machine02.xvm'),
    ],
  },
  {
    id:  8, episode: 1, name: 'Ruins 1', sky: '', objectRanges: OBJ_RUINS, monsterSkins: [51,160,161,165,166,167,168],
    variants: [
      v('Room 00', 'map_ancient01_00c.rel', 'map_ancient01.xvm'),
      v('Room 01', 'map_ancient01_01c.rel', 'map_ancient01.xvm'),
      v('Room 02', 'map_ancient01_02c.rel', 'map_ancient01.xvm'),
      v('Room 03', 'map_ancient01_03c.rel', 'map_ancient01.xvm'),
      v('Room 04', 'map_ancient01_04c.rel', 'map_ancient01.xvm'),
    ],
  },
  {
    id:  9, episode: 1, name: 'Ruins 2', sky: 'ruins02VS2.png', objectRanges: OBJ_RUINS, monsterSkins: [51,160,162,163,164,166,167,168,169],
    variants: [
      v('Room 00', 'map_ancient02_00c.rel', 'map_ancient02.xvm'),
      v('Room 01', 'map_ancient02_01c.rel', 'map_ancient02.xvm'),
      v('Room 02', 'map_ancient02_02c.rel', 'map_ancient02.xvm'),
      v('Room 03', 'map_ancient02_03c.rel', 'map_ancient02.xvm'),
      v('Room 04', 'map_ancient02_04c.rel', 'map_ancient02.xvm'),
    ],
  },
  {
    id: 10, episode: 1, name: 'Ruins 3', sky: '', objectRanges: OBJ_RUINS, monsterSkins: [51,161,162,163,164,165,166,167,168,169],
    variants: [
      v('Room 00', 'map_ancient03_00c.rel', 'map_ancient03.xvm'),
      v('Room 01', 'map_ancient03_01c.rel', 'map_ancient03.xvm'),
      v('Room 02', 'map_ancient03_02c.rel', 'map_ancient03.xvm'),
      v('Room 03', 'map_ancient03_03c.rel', 'map_ancient03.xvm'),
      v('Room 04', 'map_ancient03_04c.rel', 'map_ancient03.xvm'),
    ],
  },

  { id: 11, episode: 1, name: 'Dragon',        sky: '',                objectRanges: OBJ_ALL_EP1, monsterSkins: [192],                                                                          variants: [v('Dragon',          'map_boss01c.rel',             'map_boss01.xvm')] },
  { id: 12, episode: 1, name: 'De Rol Le',     sky: '',                objectRanges: OBJ_ALL_EP1, monsterSkins: [193],                                                                          variants: [v('De Rol Le',       'map_boss02c.rel',             'map_boss02.xvm')] },
  { id: 13, episode: 1, name: 'Vol Opt',       sky: '',                objectRanges: OBJ_ALL_EP1, monsterSkins: [51,194,195,196,197,198,199],                                                   variants: [v('Vol Opt',         'map_boss03c.rel',             'map_boss03.xvm')] },
  { id: 14, episode: 1, name: 'Dark Falz',     sky: '',                objectRanges: OBJ_ALL_EP1, monsterSkins: [200],                                                                          variants: [v('Dark Falz',       'map_darkfalz00c.rel',         'map_darkfalz00.xvm')] },
  {
    id: 15, episode: 1, name: 'Lobby', sky: '', objectRanges: OBJ_ALL_EP1, monsterSkins: [8],
    variants: [
      v('Default',       'map_lobby_00c.rel',          'map_lobby_01.xvm'),
      v('Green Battle',  'map_lobby_green_be00c.rel',  'map_lobby_green_be00.xvm'),
      v('Red Battle',    'map_lobby_red_be00c.rel',    'map_lobby_red_be00.xvm'),
      v('Yellow Battle', 'map_lobby_yellow_be00c.rel', 'map_lobby_yellow_be00.xvm'),
    ],
  },
  {
    id: 16, episode: 1, name: 'Space Battle', sky: 'space02boss8.png', objectRanges: OBJ_ALL_EP1, monsterSkins: [51,64,96,99,130,160,164],
    variants: [
      v('Room 00', 'map_vs01_00c.rel', 'map_vs01.xvm'),
      v('Room 01', 'map_vs01_01c.rel', 'map_vs01.xvm'),
      v('Room 02', 'map_vs01_02c.rel', 'map_vs01.xvm'),
    ],
  },
  {
    id: 17, episode: 1, name: 'Temple Battle', sky: 'ruins02VS2.png', objectRanges: OBJ_ALL_EP1, monsterSkins: [51,64,96,99,130,160,164],
    variants: [
      v('Room 00', 'map_vs02_00c.rel', 'map_vs02.xvm'),
      v('Room 01', 'map_vs02_01c.rel', 'map_vs02.xvm'),
      v('Room 02', 'map_vs02_02c.rel', 'map_vs02.xvm'),
    ],
  },

  // ── Episode 2 (areas 18–35) ─────────────────────────────────────────────
  // sky from Delphi MapSkyDome[18..35]
  { id: 18, episode: 2, name: 'Lab',           sky: '',               objectRanges: OBJ_LAB,       monsterSkins: [3,6,9,11,13,14,25,27,28,29,31,32,37,38,39,40,49,51,208,209,210,211,240,241,242,243,244,245,246,247,248,249,250,251,252,253,254,255,256], variants: [v('Lab', 'map_labo00_00c.rel', 'map_labo00.xvm')] },
  {
    id: 19, episode: 2, name: 'VR Temple α', sky: 'space01VS1.png', objectRanges: OBJ_TEMPLE, monsterSkins: [51,64,65,66,96,97,165,166],
    variants: [
      v('Room 00', 'map_ruins01_00c.rel', 'map_ruins01.xvm'),
      v('Room 01', 'map_ruins01_01c.rel', 'map_ruins01.xvm'),
      v('Room 02', 'map_ruins01_02c.rel', 'map_ruins01.xvm'),
    ],
  },
  {
    id: 20, episode: 2, name: 'VR Temple β', sky: 'ruins02VS2.png', objectRanges: OBJ_TEMPLE, monsterSkins: [64,65,66,96,97,165,166],
    variants: [
      v('Room 00', 'map_ruins02_00c.rel', 'map_ruins02.xvm'),
      v('Room 01', 'map_ruins02_01c.rel', 'map_ruins02.xvm'),
      v('Room 02', 'map_ruins02_02c.rel', 'map_ruins02.xvm'),
    ],
  },
  {
    id: 21, episode: 2, name: 'VR Spaceship α', sky: 'space01VS1.png', objectRanges: OBJ_SPACESHIP, monsterSkins: [51,67,101,128,129,133,160],
    variants: [
      v('Room 00', 'map_space01_00c.rel', 'map_space01.xvm'),
      v('Room 01', 'map_space01_01c.rel', 'map_space01.xvm'),
      v('Room 02', 'map_space01_02c.rel', 'map_space01.xvm'),
    ],
  },
  {
    id: 22, episode: 2, name: 'VR Spaceship β', sky: 'space02boss8.png', objectRanges: OBJ_SPACESHIP, monsterSkins: [51,67,101,128,133,160,161],
    variants: [
      v('Room 00', 'map_space02_00c.rel', 'map_space02.xvm'),
      v('Room 01', 'map_space02_01c.rel', 'map_space02.xvm'),
      v('Room 02', 'map_space02_02c.rel', 'map_space02.xvm'),
    ],
  },
  { id: 23, episode: 2, name: 'CCA 1',         sky: 'jungle01.png',    objectRanges: OBJ_CCA, monsterSkins: [51,69,212,213,214,215,216,217,218,246,253], variants: [v('CCA 1', 'map_jungle01_00c.rel', 'map_jungle01.xvm')] },
  { id: 24, episode: 2, name: 'CCA 2',         sky: 'jungle02.png',    objectRanges: OBJ_CCA, monsterSkins: [51,69,212,213,214,215,216,217,218,246,253], variants: [v('CCA 2', 'map_jungle02_00c.rel', 'map_jungle02.xvm')] },
  { id: 25, episode: 2, name: 'CCA 3',         sky: 'jungle03.png',    objectRanges: OBJ_CCA, monsterSkins: [51,69,212,213,214,215,216,217,218,246,253], variants: [v('CCA 3', 'map_jungle03_00c.rel', 'map_jungle03.xvm')] },
  {
    id: 26, episode: 2, name: 'CCA 4', sky: 'jungle04.png', objectRanges: OBJ_CCA, monsterSkins: [51,69,212,213,214,215,216,217,218,246,253],
    variants: [
      v('Room 00', 'map_jungle04_00c.rel', 'map_jungle04.xvm'),
      v('Room 01', 'map_jungle04_01c.rel', 'map_jungle04.xvm'),
      v('Room 02', 'map_jungle04_02c.rel', 'map_jungle04.xvm'),
    ],
  },
  { id: 27, episode: 2, name: 'CCA 5',         sky: 'jungle05.png',    objectRanges: OBJ_CCA, monsterSkins: [51,69,212,213,214,215,216,217,218,246,253], variants: [v('CCA 5', 'map_jungle05_00c.rel', 'map_jungle05.xvm')] },
  {
    id: 28, episode: 2, name: 'Seabed Upper', sky: 'seabed01.png', objectRanges: OBJ_CCA, monsterSkins: [51,219,220,221,222,223,224,244],
    variants: [
      v('Room 00', 'map_seabed01_00c.rel', 'map_seabed01.xvm'),
      v('Room 01', 'map_seabed01_01c.rel', 'map_seabed01.xvm'),
      v('Room 02', 'map_seabed01_02c.rel', 'map_seabed01.xvm'),
    ],
  },
  {
    id: 29, episode: 2, name: 'Seabed Lower', sky: 'seabed02.png', objectRanges: OBJ_CCA, monsterSkins: [51,219,220,221,222,223,224,244],
    variants: [
      v('Room 00', 'map_seabed02_00c.rel', 'map_seabed02.xvm'),
      v('Room 01', 'map_seabed02_01c.rel', 'map_seabed02.xvm'),
      v('Room 02', 'map_seabed02_02c.rel', 'map_seabed02.xvm'),
    ],
  },
  { id: 30, episode: 2, name: 'Gal Gryphon',   sky: 'boss5.png',       objectRanges: OBJ_CCA, monsterSkins: [192],                                 variants: [v('Gal Gryphon', 'map_boss05c.rel',     'map_boss05.xvm')] },
  { id: 31, episode: 2, name: 'Olga Flow',     sky: '',                objectRanges: OBJ_CCA, monsterSkins: [202,246],                              variants: [v('Olga Flow',   'map_boss06c.rel',     'map_boss06.xvm')] },
  { id: 32, episode: 2, name: 'Barba Ray',     sky: '',                objectRanges: OBJ_CCA, monsterSkins: [203],                                  variants: [v('Barba Ray',   'map_boss07c.rel',     'map_boss07.xvm')] },
  { id: 33, episode: 2, name: 'Gol Dragon',    sky: 'space02boss8.png',objectRanges: OBJ_CCA, monsterSkins: [204],                                  variants: [v('Gol Dragon',  'map_boss08c.rel',     'map_boss08.xvm')] },
  {
    id: 34, episode: 2, name: 'Jungle South', sky: 'jungle06.png', objectRanges: OBJ_CCA, monsterSkins: [51,69,213,215,217,221,223,253],
    variants: [
      v('Jungle North', 'map_jungle06_00c.rel', 'map_jungle06.xvm'),
      v('Room 00',      'map_jungle07_00c.rel', 'map_jungle07.xvm'),
      v('Room 01',      'map_jungle07_01c.rel', 'map_jungle07.xvm'),
      v('Room 02',      'map_jungle07_02c.rel', 'map_jungle07.xvm'),
      v('Room 03',      'map_jungle07_03c.rel', 'map_jungle07.xvm'),
      v('Room 04',      'map_jungle07_04c.rel', 'map_jungle07.xvm'),
    ],
  },
  { id: 35, episode: 2, name: 'Tower',         sky: '',                objectRanges: OBJ_CCA, monsterSkins: [51,97,214,216,218,220,223,224,225,246], variants: [v('Tower', 'map_boss09_00c.rel', 'map_boss09.xvm')] },

  // ── Episode 4 (areas 36–46) ─────────────────────────────────────────────
  // sky from Delphi MapSkyDome[36..45]; area 46 (Test Map) is outside the array
  { id: 36, episode: 4, name: 'Crater 1',      sky: 'craterwild.png',  objectRanges: OBJ_EP4, monsterSkins: [25,65,69,211,243,244,272,273,276,277,278,280],     variants: [v('Crater 1',      'map_crater01_00c.rel', 'map_crater01.xvm')] },
  { id: 37, episode: 4, name: 'Crater 2',      sky: 'craterwild.png',  objectRanges: OBJ_EP4, monsterSkins: [25,65,69,211,243,244,272,273,276,277,278,280],     variants: [v('Crater 2',      'map_crater01_00c.rel', 'map_crater01.xvm')] },
  { id: 38, episode: 4, name: 'Crater 3',      sky: 'craterwild.png',  objectRanges: OBJ_EP4, monsterSkins: [25,65,69,211,243,244,272,273,276,277,278,280],     variants: [v('Crater 3',      'map_crater01_00c.rel', 'map_crater01.xvm')] },
  { id: 39, episode: 4, name: 'Crater 4',      sky: 'craterwild.png',  objectRanges: OBJ_EP4, monsterSkins: [25,65,69,211,243,244,272,273,276,277,278,280],     variants: [v('Crater 4',      'map_crater01_00c.rel', 'map_crater01.xvm')] },
  { id: 40, episode: 4, name: 'Crater Center', sky: 'craterwild.png',  objectRanges: OBJ_EP4, monsterSkins: [25,65,69,243,244,272,273,276,277,278,280],         variants: [v('Crater Center', 'map_crater01_00c.rel', 'map_crater01.xvm')] },
  {
    id: 41, episode: 4, name: 'Desert 1', sky: '', objectRanges: OBJ_EP4, monsterSkins: [25,65,69,243,244,273,274,275,276,279,280],
    variants: [
      v('Room 00', 'map_desert01_00c.rel', 'map_desert01.xvm'),
      v('Room 01', 'map_desert01_01c.rel', 'map_desert01.xvm'),
      v('Room 02', 'map_desert01_02c.rel', 'map_desert01.xvm'),
    ],
  },
  { id: 42, episode: 4, name: 'Desert 2',      sky: '',                objectRanges: OBJ_EP4, monsterSkins: [25,65,69,243,244,273,274,275,276,279,280],         variants: [v('Desert 2', 'map_desert02_00c.rel', 'map_desert02.xvm')] },
  {
    id: 43, episode: 4, name: 'Desert 3', sky: '', objectRanges: OBJ_EP4, monsterSkins: [25,41,50,65,69,243,244,273,274,275,276,279,280],
    variants: [
      v('Room 00', 'map_desert03_00c.rel', 'map_desert03.xvm'),
      v('Room 01', 'map_desert03_01c.rel', 'map_desert03.xvm'),
      v('Room 02', 'map_desert03_02c.rel', 'map_desert03.xvm'),
    ],
  },
  { id: 44, episode: 4, name: 'Saint-Milion',  sky: '',                objectRanges: OBJ_EP4_BOSS, monsterSkins: [25,41,243,244,280,281],                       variants: [v('Saint-Milion',    'map_boss09_00c.rel', 'map_boss09.xvm')] },
  { id: 45, episode: 4, name: 'Pioneer II',    sky: '',                objectRanges: OBJ_COMMON,   monsterSkins: [1,2,3,4,5,6,7,8,9,10,11,12,13,14,25,26,27,28,29,30,31,32,33,34,36,37,38,39,40,41,43,44,45,48,49,50,51,208,209,243,244,256,280], variants: [v('Pioneer II (EP4)', 'map_city02_00c.rel', 'map_city02.xvm')] },
  { id: 46, episode: 4, name: 'Test Map',      sky: '',                objectRanges: OBJ_EP4,      monsterSkins: [65,272,273,274,275,276,277,278,279,280],       variants: [v('Test Map',         'map_test01_00c.rel', 'map_test01.xvm')] },
];

/** Keyed by area/floor ID for O(1) lookup */
export const AREA_BY_ID: Readonly<Record<number, AreaDef>> = Object.fromEntries(
  AREA_DEFS.map(a => [a.id, a])
);

/** All area IDs for a given episode */
export const AREAS_BY_EPISODE: Record<1 | 2 | 4, number[]> = {
  1: AREA_DEFS.filter(a => a.episode === 1).map(a => a.id),
  2: AREA_DEFS.filter(a => a.episode === 2).map(a => a.id),
  4: AREA_DEFS.filter(a => a.episode === 4).map(a => a.id),
};

/**
 * Absolute area ID offset per episode.
 * .dat floor IDs are RELATIVE (0-17 for any episode).
 * absoluteAreaId = relativeFloorId + EP_OFFSET[episode]
 */
export const EP_OFFSET: Record<1 | 2 | 4, number> = { 1: 0, 2: 18, 4: 36 };

/** Detect episode from the floor IDs present in the quest (fallback only). */
export function detectEpisode(floorIds: number[]): 1 | 2 | 4 {
  if (floorIds.some(id => id >= 36)) return 4;
  if (floorIds.some(id => id >= 18)) return 2;
  return 1;
}
