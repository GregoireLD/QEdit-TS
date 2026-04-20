// ─── Quest container ───────────────────────────────────────────────────────

export const enum QstFormat {
  /** BB / Blue Burst server quest  (first byte 0x58) */
  BB = 'BB',
  /** PC / GC / DC server quest     (first byte 0x44) */
  GC = 'GC',
  /** DC download quest             (first byte 0xA6) */
  Download = 'Download',
}

export const enum BinVersion {
  /** DC/GC — ASCII metadata, seg[0] === 0x1D4 */
  DC = 'DC',
  /** PC — UTF-16LE metadata, seg[0] === 0x394 */
  PC = 'PC',
  /** BB — UTF-16LE + BBData block, seg[0] === 4652 */
  BB = 'BB',
}

export const enum Language {
  JP = 0,
  EN = 1,
  DE = 2,
  FR = 3,
  ES = 4,
}

// ─── .bin structures ───────────────────────────────────────────────────────

/**
 * Parsed contents of a quest .bin file.
 * All offsets are absolute within the decompressed .bin buffer.
 */
export interface QuestBin {
  version: BinVersion;
  /** True when the outer .qst container is BB format (affects header offsets). */
  bbContainer: boolean;
  language: Language;
  questNumber: number;
  title: string;
  info: string;
  description: string;
  /** Raw bytecode section (seg[0]..seg[1]) */
  bytecode: Uint8Array;
  /** Function reference offsets relative to bytecode start */
  functionRefs: number[];
  /** Optional label/data-block annotations appended after seg[2] */
  dataBlocks: DataBlock[];
  /** BB-only: 0xE90-byte metadata block at txt offset 0x384 */
  bbData?: Uint8Array;
}

export interface DataBlock {
  offset: number;
  /** 1 = T_STRDATA, 2 = T_DATA */
  type: number;
}

// ─── .dat structures ───────────────────────────────────────────────────────

/**
 * Header prepended to every group inside a .dat file.
 * Total size on disk: 16 bytes.
 */
export interface NpcGroupHeader {
  /** 0=end, 1=objects, 2=monsters, 3=events, 4=random, 5=unknown */
  flag: number;
  /** header (16) + data payload */
  totalSize: number;
  floorId: number;
  /** payload byte count (without header) */
  dataLength: number;
}

/**
 * TMonster — 0x48 (72) bytes per entry.
 * Field names kept close to the Delphi originals.
 */
export interface Monster {
  skin: number;           // 0x00  u16
  unknown1: number;       // 0x02  u16
  unknown2: number;       // 0x04  u32
  unknown3: number;       // 0x08  u16
  unknown4: number;       // 0x0A  u16
  mapSection: number;     // 0x0C  u16
  unknown5: number;       // 0x0E  u16
  unknown6: number;       // 0x10  u32
  posX: number;           // 0x14  f32
  posZ: number;           // 0x18  f32
  posY: number;           // 0x1C  f32
  unknown7: number;       // 0x20  u32
  direction: number;      // 0x24  u32 (rotation)
  unknown8: number;       // 0x28  u32
  movementData: number;   // 0x2C  f32
  unknown10: number;      // 0x30  f32
  unknown11: number;      // 0x34  f32
  charId: number;         // 0x38  f32
  action: number;         // 0x3C  f32
  movementFlag: number;   // 0x40  u32  (1 = mobile)
  unknownFlag: number;    // 0x44  u32
}

/**
 * TObj — 0x44 (68) bytes per entry.
 */
export interface QuestObject {
  skin: number;           // 0x00  u16
  unknown1: number;       // 0x02  u16
  unknown2: number;       // 0x04  u32
  id: number;             // 0x08  u16
  group: number;          // 0x0A  u16
  mapSection: number;     // 0x0C  u16
  unknown4: number;       // 0x0E  u16
  posX: number;           // 0x10  f32
  posZ: number;           // 0x14  f32
  posY: number;           // 0x18  f32
  rotX: number;           // 0x1C  u32  BAM rotation around X
  rotY: number;           // 0x20  u32  BAM rotation around Y (facing direction)
  rotZ: number;           // 0x24  u32  BAM rotation around Z
  scaleX: number;         // 0x28  f32
  scaleY: number;         // 0x2C  f32
  scaleZ: number;         // 0x30  f32
  objId: number;          // 0x34  u32
  action: number;         // 0x38  u32
  unknown13: number;      // 0x3C  u32
  unknown14: number;      // 0x40  u32
}

export interface Floor {
  id: number;
  monsters: Monster[];
  objects: QuestObject[];
  /** Raw bytes for flag=3 (event) groups */
  events: Uint8Array;
  /** Raw bytes for flag=4 groups */
  d04: Uint8Array;
  /** Raw bytes for flag=5 groups */
  d05: Uint8Array;
}

// ─── Top-level quest ───────────────────────────────────────────────────────

export interface Quest {
  /** Source file format detected at load time */
  format: QstFormat;
  bin: QuestBin;
  floors: Floor[];
  /** All embedded filenames from the .qst container */
  embeddedFiles: EmbeddedFile[];
  /**
   * Episode detected from bytecode (set_episode opcode or area-ID inference).
   * Floor IDs in the .dat are RELATIVE (0-17 for all episodes); add
   * EP_OFFSET[episode] to convert to the absolute area ID used in areaData.ts.
   * Populated after bytecode analysis in questStore.openQuest().
   */
  episode: 1 | 2 | 4;
  /**
   * Bytecode-specified map-variant index per absolute area ID (0-45).
   * Variant 0 = first variant listed in AREA_BY_ID[id].variants[].
   * Ground truth written back to bytecode on save.
   * Populated after bytecode analysis in questStore.openQuest().
   */
  variantByArea: Record<number, number>;
}

export interface EmbeddedFile {
  name: string;
  /** Decompressed data */
  data: Uint8Array;
}

// ─── Selection ─────────────────────────────────────────────────────────────

export type SelectedEntity =
  | { type: 'monster'; index: number }
  | { type: 'object';  index: number }
  | null;
