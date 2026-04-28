#!/usr/bin/env python3
"""
Convert Delphi monsters.txt and Objs.txt to JSON preset files.

Usage:
    python3 tools/convert_presets.py          # regenerate field values from source txt
    npx tsx   tools/stamp_placements.ts       # (re)stamp placement field in objects.json

The 'placement' field in objects.json ('rotation'|'radius'|'none') is derived from
entitySchemas.ts and written by stamp_placements.ts, not by this script.
Run stamp_placements.ts after this script whenever entitySchemas.ts changes.

Input:  ../../qedit-alisaryn-2026-04-05/monsters.txt
        ../../qedit-alisaryn-2026-04-05/Objs.txt
Output: src/core/data/monsters.json
        src/core/data/objects.json
"""

import json
import re
import os

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT       = os.path.join(SCRIPT_DIR, '..')
SRC_ROOT   = os.path.join(ROOT, '..', 'qedit-alisaryn-2026-04-05')

# ─── Monster converter ───────────────────────────────────────────────────────
# 22 lines per entry; ma=15 is commented out in the loader → skip that position.
MONSTER_KEYS = [
    'skin', 'unknown1', 'unknown2', 'unknown3', 'unknown4',
    'mapSection', 'unknown5', 'unknown6',
    'posX', 'posZ', 'posY',
    'unknown7', 'direction', 'unknown8',
    '_skip',          # ghost field: ma=15 is commented out in Delphi
    'movementData', 'unknown10', 'unknown11',
    'charId', 'action', 'movementFlag', 'unknownFlag',
]

MONSTER_INT_KEYS = {
    'skin', 'unknown1', 'unknown2', 'unknown3', 'unknown4',
    'mapSection', 'unknown5', 'unknown6',
    'unknown7', 'direction', 'unknown8',
    'charId', 'action', 'movementFlag', 'unknownFlag',
}

def parse_monster_value(key, raw):
    raw = raw.strip()
    if key == '_skip':
        return None
    if key in MONSTER_INT_KEYS:
        return int(raw) if raw else 0
    try:
        return float(raw)
    except ValueError:
        return 0.0


def convert_monsters(path):
    with open(path, 'r', encoding='utf-8', errors='replace') as f:
        lines = [l.rstrip('\n') for l in f]

    monsters = []
    i = 0
    while i < len(lines):
        # Find start of an entry: "Name=<name>"
        if not lines[i].startswith('Name='):
            i += 1
            continue
        name = lines[i][5:].strip()
        entry = {'name': name}
        for ki, key in enumerate(MONSTER_KEYS):
            li = i + 1 + ki
            if li >= len(lines):
                break
            raw_line = lines[li]
            # Extract value after '='
            if '=' in raw_line:
                val_raw = raw_line.split('=', 1)[1]
            else:
                val_raw = raw_line
            val = parse_monster_value(key, val_raw)
            if val is not None:
                entry[key] = val
        monsters.append(entry)
        i += 1 + len(MONSTER_KEYS)

    return monsters


# ─── Object converter ────────────────────────────────────────────────────────
# 19 fields per entry via `for ma=1 to 19`; group field is skipped entirely (always 0).
OBJECT_KEYS = [
    'skin', 'unknown1', 'unknown2',
    'id',            # ma=4 (grp is skipped)
    'mapSection',    # ma=5
    'unknown4',      # ma=6
    'posX', 'posZ', 'posY',
    'rotX', 'rotY', 'rotZ',
    'scaleX', 'scaleY', 'scaleZ',
    'objId', 'action', 'unknown13', 'unknown14',
]

OBJECT_INT_KEYS = {
    'skin', 'unknown1', 'unknown2', 'id', 'mapSection', 'unknown4',
    'rotX', 'rotY', 'rotZ',
    'objId', 'action', 'unknown13', 'unknown14',
}

def parse_object_value(key, raw):
    raw = raw.strip()
    if key in OBJECT_INT_KEYS:
        return int(raw) if raw else 0
    try:
        return float(raw)
    except ValueError:
        return 0.0


def convert_objects(path):
    with open(path, 'r', encoding='utf-8', errors='replace') as f:
        lines = [l.rstrip('\n') for l in f]

    objects = []
    i = 0
    while i < len(lines):
        if not lines[i].startswith('Name='):
            i += 1
            continue
        name = lines[i][5:].strip()
        entry = {'name': name, 'group': 0}
        for ki, key in enumerate(OBJECT_KEYS):
            li = i + 1 + ki
            if li >= len(lines):
                break
            raw_line = lines[li]
            if '=' in raw_line:
                val_raw = raw_line.split('=', 1)[1]
            else:
                val_raw = raw_line
            entry[key] = parse_object_value(key, val_raw)
        objects.append(entry)
        i += 1 + len(OBJECT_KEYS)

    return objects


# ─── Main ────────────────────────────────────────────────────────────────────

def main():
    monsters_txt = os.path.join(SRC_ROOT, 'monsters.txt')
    objs_txt     = os.path.join(SRC_ROOT, 'Objs.txt')
    out_monsters = os.path.join(ROOT, 'src', 'core', 'data', 'monsters.json')
    out_objects  = os.path.join(ROOT, 'src', 'core', 'data', 'objects.json')

    monsters = convert_monsters(monsters_txt)
    print(f'Converted {len(monsters)} monsters')
    with open(out_monsters, 'w', encoding='utf-8') as f:
        json.dump(monsters, f, indent=2)

    objects = convert_objects(objs_txt)
    print(f'Converted {len(objects)} objects')
    with open(out_objects, 'w', encoding='utf-8') as f:
        json.dump(objects, f, indent=2)

    print('Done.')


if __name__ == '__main__':
    main()
