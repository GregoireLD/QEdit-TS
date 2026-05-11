/**
 * QPv3 — universal quest project format.
 *
 * A ZIP archive with a .qpv3 extension containing:
 *   manifest.json     — format identity and provenance
 *   quest.json        — quest metadata (title, episode, bin version, etc.)
 *   bytecode.bin      — raw compiled script bytecode
 *   sidecar.json      — script annotations (omitted if empty)
 *   areas/NN.json     — one file per episode area (all areas, included or not)
 *   assets/*          — extra embedded files (PVR textures, etc.)
 */

import { buildZip, readZip } from './zip';
import { AREA_BY_ID, AREAS_BY_EPISODE, EP_OFFSET } from '../map/areaData';
import { BinVersion, Language, QstFormat } from '../model/types';
import type { Quest, Floor, Monster, QuestObject, QuestBin, EmbeddedFile, SaveFormat } from '../model/types';
import type { Sidecar } from './sidecar';
import type { SaveResult } from './qst';

const FORMAT  = 'qpv3';
const VERSION = '3.0';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toBase64(data: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < data.length; i++) bin += String.fromCharCode(data[i]);
  return btoa(bin);
}

function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const _enc = new TextEncoder();
const _dec = new TextDecoder();
const jenc = (o: unknown): Uint8Array => _enc.encode(JSON.stringify(o, null, 2));
const jdec = (d: Uint8Array): unknown  => JSON.parse(_dec.decode(d));

function hasSidecarContent(s: Sidecar): boolean {
  return s.comments.length > 0 || s.regions.length > 0 ||
    s.trailingComments.length > 0 || s.labelComments.length > 0;
}

function areaFilename(absId: number): string {
  return `areas/${String(absId).padStart(2, '0')}.json`;
}

// ─── Serialise ────────────────────────────────────────────────────────────────

export function serialiseQpv3(quest: Quest, sidecar: Sidecar | null): SaveResult {
  const files = new Map<string, Uint8Array>();

  files.set('manifest.json', jenc({
    format:    FORMAT,
    version:   VERSION,
    createdBy: 'QEdit',
    savedAt:   new Date().toISOString(),
  }));

  files.set('quest.json', jenc({
    questNumber:  quest.bin.questNumber,
    episode:      quest.episode,
    title:        quest.bin.title,
    info:         quest.bin.info,
    description:  quest.bin.description,
    language:     quest.bin.language,
    binVersion:   quest.bin.version,
    bbContainer:  quest.bin.bbContainer,
    gcFlag:       quest.bin.gcFlag,
    functionRefs: quest.bin.functionRefs,
    dataBlocks:   quest.bin.dataBlocks,
    bbData:       quest.bin.bbData ? toBase64(quest.bin.bbData) : null,
  }));

  files.set('bytecode.bin', quest.bin.bytecode);

  if (sidecar && hasSidecarContent(sidecar)) {
    files.set('sidecar.json', jenc(sidecar));
  }

  const epOff   = EP_OFFSET[quest.episode];
  const areaIds = AREAS_BY_EPISODE[quest.episode];
  const byRelId = new Map(quest.floors.map(f => [f.id, f]));

  for (const absId of areaIds) {
    const relId = absId - epOff;
    const floor = byRelId.get(relId);
    const area  = AREA_BY_ID[absId];

    files.set(areaFilename(absId), jenc({
      areaId:   absId,
      name:     area?.name ?? `Area ${absId}`,
      included: floor !== undefined,
      variant:  quest.variantByArea[absId] ?? 0,
      comment:  '',
      monsters: floor?.monsters ?? [],
      objects:  floor?.objects  ?? [],
      events:   floor && floor.events.length > 0 ? toBase64(floor.events) : '',
      d04:      floor && floor.d04.length    > 0 ? toBase64(floor.d04)    : '',
      d05:      floor && floor.d05.length    > 0 ? toBase64(floor.d05)    : '',
    }));
  }

  for (const ef of quest.embeddedFiles) {
    const lname = ef.name.toLowerCase();
    if (!lname.endsWith('.bin') && !lname.endsWith('.dat')) {
      files.set(`assets/${ef.name}`, ef.data);
    }
  }

  return { data: buildZip(files), ext: 'qpv3' };
}

// ─── Parse ────────────────────────────────────────────────────────────────────

export function parseQpv3(buf: Uint8Array): { quest: Quest; savedFormat: SaveFormat } {
  const entries = readZip(buf);

  const mRaw = entries.get('manifest.json');
  if (!mRaw) throw new Error('Not a QPv3 file: missing manifest.json');
  const manifest = jdec(mRaw) as { format?: string };
  if (manifest.format !== FORMAT) {
    throw new Error(`Not a QPv3 file: unexpected format "${manifest.format}"`);
  }

  const qRaw = entries.get('quest.json');
  if (!qRaw) throw new Error('QPv3: missing quest.json');
  const qj = jdec(qRaw) as {
    questNumber:  number;
    episode:      1 | 2 | 4;
    title:        string;
    info:         string;
    description:  string;
    language:     number;
    binVersion:   string;
    bbContainer:  boolean;
    gcFlag?:      boolean;
    functionRefs: number[];
    dataBlocks:   Array<{ offset: number; type: number }>;
    bbData?:      string | null;
  };

  const bcRaw = entries.get('bytecode.bin');
  if (!bcRaw) throw new Error('QPv3: missing bytecode.bin');

  const bin: QuestBin = {
    version:      qj.binVersion as BinVersion,
    bbContainer:  qj.bbContainer,
    gcFlag:       qj.gcFlag ?? false,
    language:     qj.language as Language,
    questNumber:  qj.questNumber,
    title:        qj.title,
    info:         qj.info,
    description:  qj.description,
    bytecode:     bcRaw,
    functionRefs: qj.functionRefs ?? [],
    dataBlocks:   qj.dataBlocks   ?? [],
    bbData:       qj.bbData ? fromBase64(qj.bbData) : undefined,
  };

  const episode  = qj.episode;
  const epOff    = EP_OFFSET[episode];
  const areaIds  = AREAS_BY_EPISODE[episode];
  const floors: Floor[]                       = [];
  const variantByArea: Record<number, number> = {};

  for (const absId of areaIds) {
    const raw = entries.get(areaFilename(absId));
    if (!raw) continue;
    const aj = jdec(raw) as {
      included: boolean;
      variant:  number;
      monsters: Monster[];
      objects:  QuestObject[];
      events:   string;
      d04:      string;
      d05:      string;
    };
    if (!aj.included) continue;
    floors.push({
      id:       absId - epOff,
      monsters: aj.monsters ?? [],
      objects:  aj.objects  ?? [],
      events:   aj.events   ? fromBase64(aj.events) : new Uint8Array(0),
      d04:      aj.d04      ? fromBase64(aj.d04)    : new Uint8Array(0),
      d05:      aj.d05      ? fromBase64(aj.d05)    : new Uint8Array(0),
    });
    variantByArea[absId] = aj.variant ?? 0;
  }

  floors.sort((a, b) => a.id - b.id);

  const embeddedFiles: EmbeddedFile[] = [
    { name: 'quest.bin', data: new Uint8Array(0) },
    { name: 'quest.dat', data: new Uint8Array(0) },
  ];
  for (const [path, data] of entries) {
    if (path.startsWith('assets/') && path.length > 'assets/'.length) {
      embeddedFiles.push({ name: path.slice('assets/'.length), data });
    }
  }

  const quest: Quest = {
    format:       qj.bbContainer ? QstFormat.BB : QstFormat.GC,
    bin,
    floors,
    embeddedFiles,
    episode,
    variantByArea,
  };

  return { quest, savedFormat: { packaging: 'qpv3', platform: 'PC' } };
}
