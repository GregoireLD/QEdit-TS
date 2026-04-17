/**
 * PSO quest .dat file parser / serialiser.
 *
 * A .dat file is a sequence of 16-byte TNPCGroupeHeader blocks each followed
 * by a payload of `dataLength` bytes.  The sequence ends with an all-zero header.
 *
 * flag=1  → TObj records    (0x44 bytes each)
 * flag=2  → TMonster records (0x48 bytes each)
 * flag=3  → event data      (raw)
 * flag=4  → d04 data        (raw)
 * flag=5  → d05 data        (raw)
 */

import type { Floor, Monster, QuestObject, NpcGroupHeader } from '../model/types';

const MONSTER_SIZE = 0x48; // 72
const OBJECT_SIZE  = 0x44; // 68
const HEADER_SIZE  = 16;

// ─── Read helpers ──────────────────────────────────────────────────────────

function readHeader(view: DataView, offset: number): NpcGroupHeader {
  return {
    flag:       view.getUint32(offset,      true),
    totalSize:  view.getUint32(offset + 4,  true),
    floorId:    view.getUint32(offset + 8,  true),
    dataLength: view.getUint32(offset + 12, true),
  };
}

function readMonster(view: DataView, off: number): Monster {
  return {
    skin:          view.getUint16(off + 0x00, true),
    unknown1:      view.getUint16(off + 0x02, true),
    unknown2:      view.getUint32(off + 0x04, true),
    unknown3:      view.getUint16(off + 0x08, true),
    unknown4:      view.getUint16(off + 0x0A, true),
    mapSection:    view.getUint16(off + 0x0C, true),
    unknown5:      view.getUint16(off + 0x0E, true),
    unknown6:      view.getUint32(off + 0x10, true),
    posX:          view.getFloat32(off + 0x14, true),
    posZ:          view.getFloat32(off + 0x18, true),
    posY:          view.getFloat32(off + 0x1C, true),
    unknown7:      view.getUint32(off + 0x20, true),
    direction:     view.getUint32(off + 0x24, true),
    unknown8:      view.getUint32(off + 0x28, true),
    movementData:  view.getFloat32(off + 0x2C, true),
    unknown10:     view.getFloat32(off + 0x30, true),
    unknown11:     view.getFloat32(off + 0x34, true),
    charId:        view.getFloat32(off + 0x38, true),
    action:        view.getFloat32(off + 0x3C, true),
    movementFlag:  view.getUint32(off + 0x40, true),
    unknownFlag:   view.getUint32(off + 0x44, true),
  };
}

function readObject(view: DataView, off: number): QuestObject {
  return {
    skin:       view.getUint16(off + 0x00, true),
    unknown1:   view.getUint16(off + 0x02, true),
    unknown2:   view.getUint32(off + 0x04, true),
    id:         view.getUint16(off + 0x08, true),
    group:      view.getUint16(off + 0x0A, true),
    mapSection: view.getUint16(off + 0x0C, true),
    unknown4:   view.getUint16(off + 0x0E, true),
    posX:   view.getFloat32(off + 0x10, true),
    posZ:   view.getFloat32(off + 0x14, true),
    posY:   view.getFloat32(off + 0x18, true),
    rotX:   view.getUint32(off + 0x1C, true),
    rotY:   view.getUint32(off + 0x20, true),
    rotZ:   view.getUint32(off + 0x24, true),
    scaleX: view.getFloat32(off + 0x28, true),
    scaleY: view.getFloat32(off + 0x2C, true),
    scaleZ: view.getFloat32(off + 0x30, true),
    objId:      view.getUint32(off + 0x34, true),
    action:     view.getUint32(off + 0x38, true),
    unknown13:  view.getUint32(off + 0x3C, true),
    unknown14:  view.getUint32(off + 0x40, true),
  };
}

// ─── Parse ─────────────────────────────────────────────────────────────────

export function parseDat(buf: Uint8Array): Floor[] {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const floorMap = new Map<number, Floor>();

  function getFloor(id: number): Floor {
    if (!floorMap.has(id)) {
      floorMap.set(id, {
        id,
        monsters: [],
        objects:  [],
        events:   new Uint8Array(0),
        d04:      new Uint8Array(0),
        d05:      new Uint8Array(0),
      });
    }
    return floorMap.get(id)!;
  }

  let y = 0;
  while (y + HEADER_SIZE <= buf.length) {
    const h = readHeader(view, y);
    y += HEADER_SIZE;

    if (h.totalSize === 0 && h.flag === 0) break; // end marker

    if (h.flag === 0) {
      // null group with non-zero totalSize — skip payload
      y += h.dataLength;
      continue;
    }

    const floor = getFloor(h.floorId);

    switch (h.flag) {
      case 1: { // objects
        const count = (h.dataLength / OBJECT_SIZE) | 0;
        for (let i = 0; i < count; i++) {
          floor.objects.push(readObject(view, y + i * OBJECT_SIZE));
        }
        break;
      }
      case 2: { // monsters
        const count = (h.dataLength / MONSTER_SIZE) | 0;
        for (let i = 0; i < count; i++) {
          floor.monsters.push(readMonster(view, y + i * MONSTER_SIZE));
        }
        break;
      }
      case 3:
        floor.events = buf.slice(y, y + h.dataLength);
        break;
      case 4:
        floor.d04 = buf.slice(y, y + h.dataLength);
        break;
      case 5:
        floor.d05 = buf.slice(y, y + h.dataLength);
        break;
      default:
        console.warn(`parseDat: unknown group flag ${h.flag} at offset ${y - HEADER_SIZE}`);
    }

    y += h.dataLength;
  }

  return Array.from(floorMap.values()).sort((a, b) => a.id - b.id);
}

// ─── Serialise ─────────────────────────────────────────────────────────────

function writeHeader(view: DataView, off: number, h: NpcGroupHeader): void {
  view.setUint32(off,      h.flag,       true);
  view.setUint32(off + 4,  h.totalSize,  true);
  view.setUint32(off + 8,  h.floorId,    true);
  view.setUint32(off + 12, h.dataLength, true);
}

function writeMonster(view: DataView, off: number, m: Monster): void {
  view.setUint16(off + 0x00, m.skin,         true);
  view.setUint16(off + 0x02, m.unknown1,     true);
  view.setUint32(off + 0x04, m.unknown2,     true);
  view.setUint16(off + 0x08, m.unknown3,     true);
  view.setUint16(off + 0x0A, m.unknown4,     true);
  view.setUint16(off + 0x0C, m.mapSection,   true);
  view.setUint16(off + 0x0E, m.unknown5,     true);
  view.setUint32(off + 0x10, m.unknown6,     true);
  view.setFloat32(off + 0x14, m.posX,        true);
  view.setFloat32(off + 0x18, m.posZ,        true);
  view.setFloat32(off + 0x1C, m.posY,        true);
  view.setUint32(off + 0x20, m.unknown7,     true);
  view.setUint32(off + 0x24, m.direction,    true);
  view.setUint32(off + 0x28, m.unknown8,     true);
  view.setFloat32(off + 0x2C, m.movementData, true);
  view.setFloat32(off + 0x30, m.unknown10,   true);
  view.setFloat32(off + 0x34, m.unknown11,   true);
  view.setFloat32(off + 0x38, m.charId,      true);
  view.setFloat32(off + 0x3C, m.action,      true);
  view.setUint32(off + 0x40, m.movementFlag, true);
  view.setUint32(off + 0x44, m.unknownFlag,  true);
}

function writeObject(view: DataView, off: number, o: QuestObject): void {
  view.setUint16(off + 0x00, o.skin,       true);
  view.setUint16(off + 0x02, o.unknown1,   true);
  view.setUint32(off + 0x04, o.unknown2,   true);
  view.setUint16(off + 0x08, o.id,         true);
  view.setUint16(off + 0x0A, o.group,      true);
  view.setUint16(off + 0x0C, o.mapSection, true);
  view.setUint16(off + 0x0E, o.unknown4,   true);
  view.setFloat32(off + 0x10, o.posX,      true);
  view.setFloat32(off + 0x14, o.posZ,      true);
  view.setFloat32(off + 0x18, o.posY,      true);
  view.setUint32(off + 0x1C, o.rotX,   true);
  view.setUint32(off + 0x20, o.rotY,   true);
  view.setUint32(off + 0x24, o.rotZ,   true);
  view.setFloat32(off + 0x28, o.scaleX, true);
  view.setFloat32(off + 0x2C, o.scaleY, true);
  view.setFloat32(off + 0x30, o.scaleZ, true);
  view.setUint32(off + 0x34, o.objId,      true);
  view.setUint32(off + 0x38, o.action,     true);
  view.setUint32(off + 0x3C, o.unknown13,  true);
  view.setUint32(off + 0x40, o.unknown14,  true);
}

export function serialiseDat(floors: Floor[]): Uint8Array {
  // Calculate total size first
  let total = 0;
  for (const f of floors) {
    if (f.objects.length)  total += HEADER_SIZE + f.objects.length  * OBJECT_SIZE;
    if (f.monsters.length) total += HEADER_SIZE + f.monsters.length * MONSTER_SIZE;
    if (f.events.length)   total += HEADER_SIZE + f.events.length;
    if (f.d04.length)      total += HEADER_SIZE + f.d04.length;
    if (f.d05.length)      total += HEADER_SIZE + f.d05.length;
  }
  total += HEADER_SIZE; // end marker

  const buf = new Uint8Array(total);
  const view = new DataView(buf.buffer);
  let off = 0;

  function writeGroup(flag: number, floorId: number, data: Uint8Array): void {
    writeHeader(view, off, {
      flag,
      totalSize:  HEADER_SIZE + data.length,
      floorId,
      dataLength: data.length,
    });
    off += HEADER_SIZE;
    buf.set(data, off);
    off += data.length;
  }

  for (const f of floors) {
    if (f.objects.length) {
      const data = new Uint8Array(f.objects.length * OBJECT_SIZE);
      const dv = new DataView(data.buffer);
      f.objects.forEach((o, i) => writeObject(dv, i * OBJECT_SIZE, o));
      writeGroup(1, f.id, data);
    }
    if (f.monsters.length) {
      const data = new Uint8Array(f.monsters.length * MONSTER_SIZE);
      const dv = new DataView(data.buffer);
      f.monsters.forEach((m, i) => writeMonster(dv, i * MONSTER_SIZE, m));
      writeGroup(2, f.id, data);
    }
    if (f.events.length)  writeGroup(3, f.id, f.events);
    if (f.d04.length)     writeGroup(4, f.id, f.d04);
    if (f.d05.length)     writeGroup(5, f.id, f.d05);
  }

  // End marker: all zeros
  off += HEADER_SIZE;

  return buf;
}
