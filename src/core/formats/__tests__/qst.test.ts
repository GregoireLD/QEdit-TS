/**
 * Round-trip tests for the .qst parser.
 *
 * For each quest file we:
 *   1. Parse it  → Quest object
 *   2. Check basic invariants (non-empty title, valid floor data)
 *   3. Re-serialise → Uint8Array
 *   4. Re-parse the result and assert it matches the original
 *
 * Run with:  npm test
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { parseQst, serialiseQst } from '../qst';

const QUEST_DIR = join(__dirname, '../../../../..', 'quests');

function questFiles(subdir: string): string[] {
  const dir = join(QUEST_DIR, subdir);
  return readdirSync(dir)
    .filter(f => f.endsWith('.qst'))
    .map(f => join(dir, f));
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function loadBuf(path: string): Uint8Array {
  return new Uint8Array(readFileSync(path));
}

// ─── Regular quests (BB format) ────────────────────────────────────────────

describe('BB quest parsing (Regular_Quests)', () => {
  const files = questFiles('Regular_Quests');

  for (const filepath of files) {
    const name = filepath.split('/').pop()!;

    it(`parses ${name}`, () => {
      const buf   = loadBuf(filepath);
      const quest = parseQst(buf);

      expect(quest.bin.title.length).toBeGreaterThan(0);
      expect(quest.bin.questNumber).toBeGreaterThan(0);
      expect(quest.bin.bytecode.length).toBeGreaterThan(0);
      expect(quest.floors.length).toBeGreaterThan(0);

      // At least one floor should have monsters or objects
      const hasEntities = quest.floors.some(
        f => f.monsters.length > 0 || f.objects.length > 0
      );
      expect(hasEntities).toBe(true);
    });

    it(`round-trips ${name}`, () => {
      const buf    = loadBuf(filepath);
      const quest1 = parseQst(buf);
      const out    = serialiseQst(quest1);
      const quest2 = parseQst(out);

      expect(quest2.bin.title).toBe(quest1.bin.title);
      expect(quest2.bin.questNumber).toBe(quest1.bin.questNumber);
      expect(quest2.bin.bytecode.length).toBe(quest1.bin.bytecode.length);
      expect(quest2.floors.length).toBe(quest1.floors.length);

      for (let i = 0; i < quest1.floors.length; i++) {
        expect(quest2.floors[i].monsters.length).toBe(quest1.floors[i].monsters.length);
        expect(quest2.floors[i].objects.length).toBe(quest1.floors[i].objects.length);
      }
    });
  }
});

// ─── Custom quests (GC format) ─────────────────────────────────────────────

describe('GC quest parsing (Custom_Quests)', () => {
  const files = questFiles('Custom_Quests');

  for (const filepath of files) {
    const name = filepath.split('/').pop()!;

    it(`parses ${name}`, () => {
      const buf   = loadBuf(filepath);
      const quest = parseQst(buf);

      expect(quest.bin.bytecode.length).toBeGreaterThan(0);
      expect(quest.floors.length).toBeGreaterThan(0);
    });
  }
});

// ─── Spot-check: quest 1 ───────────────────────────────────────────────────

describe('quest1_e.qst detail check', () => {
  it('has correct quest number', () => {
    const buf   = loadBuf(join(QUEST_DIR, 'Regular_Quests', 'quest1_e.qst'));
    const quest = parseQst(buf);
    expect(quest.bin.questNumber).toBe(1);
  });

  it('monster positions are finite floats', () => {
    const buf   = loadBuf(join(QUEST_DIR, 'Regular_Quests', 'quest1_e.qst'));
    const quest = parseQst(buf);
    for (const floor of quest.floors) {
      for (const m of floor.monsters) {
        expect(isFinite(m.posX)).toBe(true);
        expect(isFinite(m.posY)).toBe(true);
        expect(isFinite(m.posZ)).toBe(true);
      }
    }
  });
});
