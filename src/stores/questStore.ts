import { create } from 'zustand';
import { openFileDialog, readFile, saveFile, saveFileDialog } from '../platform/fs';
import { parseQst, parseZipQuest, parseStandaloneBin, serialiseQst, serialiseForSave } from '../core/formats/qst';
import { parseQpv3, serialiseQpv3 } from '../core/formats/qpv3';
import { isZipMagic } from '../core/formats/zip';
import { analyseQuestBin } from '../core/formats/bytecodeAnalysis';
import { saveSidecar, type Sidecar } from '../core/formats/sidecar';
import { EP_OFFSET } from '../core/map/areaData';
import { useUiStore } from './uiStore';
import { BinVersion, QstFormat, Language } from '../core/model/types';
import { rebuildBytecodeMapSetup } from '../core/formats/bytecodeMap';
import { defaultSaveFormat } from '../core/saveFormat';
import type { Quest, Floor, QuestBin, Monster, QuestObject, SelectedEntity, SaveFormat } from '../core/model/types';

function replaceExt(path: string, ext: string): string {
  return path.replace(/\.[^./\\]+$/, '') + '.' + ext;
}

// ScriptEditor registers these on mount so saveQuest/saveQuestAs can compile
// and flush the sidecar without depending on ScriptEditor's reactive state.
let _preCompiler:     (() => Promise<void>) | null = null;
let _sidecarExtractor: (() => Sidecar)      | null = null;

export function registerPreSaveCompiler(fn: (() => Promise<void>) | null): void {
  _preCompiler = fn;
}
export function registerSidecarExtractor(fn: (() => Sidecar) | null): void {
  _sidecarExtractor = fn;
}

type BinMetaPatch = Partial<Pick<QuestBin, 'title' | 'info' | 'description' | 'questNumber'> & { language: Language }>;

interface QuestStore {
  quest: Quest | null;
  filePath: string | null;
  /** Format of the file currently on disk (updated after every successful save/load). */
  savedFormat: SaveFormat | null;
  /** Absolute area ID (0-45) of the selected area, or null. */
  selectedFloorId: number | null;
  selectedEntity: SelectedEntity;
  isLoading: boolean;
  error: string | null;
  /** Incremented each time the quest is written to disk. */
  saveVersion: number;

  newQuest: (episode: 1 | 2 | 4) => void;
  toggleArea: (absAreaId: number) => void;
  openQuest: () => Promise<void>;
  openQuestFromUrl: () => Promise<void>;
  saveQuest: () => Promise<void>;
  saveQuestAs: () => Promise<void>;
  /** Save with an explicit format choice (used by SaveAsDialog). Returns true if the user completed the save. */
  saveQuestAsFormat: (format: SaveFormat) => Promise<boolean>;
  selectFloor: (id: number) => void;
  selectEntity: (entity: SelectedEntity) => void;
  updateBinMeta: (patch: BinMetaPatch) => void;
  updateBin: (bin: QuestBin) => void;
  updateMonster: (floorId: number, index: number, patch: Partial<Monster>) => void;
  updateObject: (floorId: number, index: number, patch: Partial<QuestObject>) => void;
  /** Append a new monster to a floor and select it. */
  addMonster: (floorId: number, monster: Monster) => void;
  /** Append a new object to a floor and select it. */
  addObject: (floorId: number, obj: QuestObject) => void;
  deleteMonster: (floorId: number, index: number) => void;
  deleteObject: (floorId: number, index: number) => void;
  duplicateMonster: (floorId: number, index: number) => void;
  duplicateObject: (floorId: number, index: number) => void;
  /**
   * Commit a variant change: updates quest.variantByArea (written back to
   * bytecode on save) AND the UI preview so the canvas updates immediately.
   */
  commitVariant: (areaId: number, variantIdx: number) => void;
  clearError: () => void;
}

export const useQuestStore = create<QuestStore>((set, get) => ({
  quest: null,
  filePath: null,
  savedFormat: null,
  selectedFloorId: null,
  selectedEntity: null,
  isLoading: false,
  error: null,
  saveVersion: 0,

  newQuest: (episode) => {
    const epIdx   = episode === 1 ? 0 : episode === 2 ? 1 : 2;
    const bytecode = episode === 1
      ? new Uint8Array([0x01])
      : new Uint8Array([0xF8, 0xBC, epIdx, 0x00, 0x00, 0x00, 0x01]);

    const floors: Floor[] = [];

    const bin: QuestBin = {
      version:     BinVersion.PC,
      bbContainer: false,
      gcFlag:      false,
      language:    Language.EN,
      questNumber: 0,
      title:       'New Quest',
      info:        '',
      description: '',
      bytecode,
      functionRefs: [0],
      dataBlocks:   [],
    };

    const quest: Quest = {
      format:        QstFormat.GC,
      bin,
      floors,
      embeddedFiles: [
        { name: 'quest.bin', data: new Uint8Array(0) },
        { name: 'quest.dat', data: new Uint8Array(0) },
      ],
      episode,
      variantByArea: {},
    };

    useUiStore.getState().resetPreviews({});
    set({ quest, filePath: null, savedFormat: { packaging: 'qpv3', platform: 'PC' }, selectedFloorId: null, isLoading: false, error: null });
  },

  toggleArea: (absAreaId) => {
    const { quest } = get();
    if (!quest) return;

    const offset    = EP_OFFSET[quest.episode];
    const relId     = absAreaId - offset;
    const isEnabled = quest.floors.some(f => f.id === relId);

    let floors: Floor[];
    let variantByArea: Record<number, number>;

    if (isEnabled) {
      floors = quest.floors.filter(f => f.id !== relId);
      variantByArea = { ...quest.variantByArea };
      delete variantByArea[absAreaId];
    } else {
      const newFloor: Floor = {
        id: relId, monsters: [], objects: [],
        events: new Uint8Array(0), d04: new Uint8Array(0), d05: new Uint8Array(0),
      };
      floors = [...quest.floors, newFloor].sort((a, b) => a.id - b.id);
      variantByArea = { ...quest.variantByArea, [absAreaId]: 0 };
      useUiStore.getState().setPreviewVariant(absAreaId, 0);
    }

    const bytecode = rebuildBytecodeMapSetup(quest.bin.bytecode, quest.episode, variantByArea, quest.bin.version);
    set({ quest: { ...quest, floors, variantByArea, bin: { ...quest.bin, bytecode } } });
  },

  openQuest: async () => {
    const opened = await openFileDialog({
      title:   'Open Quest',
      filters: [{ name: 'PSO Quest', extensions: ['qst', 'bin', 'qpv3'] }],
    });
    if (!opened) return;

    set({ isLoading: true, error: null });
    try {
      const bytes = new Uint8Array(opened.data);
      const lpath = opened.path.toLowerCase();

      let parsed: Quest;
      let savedFmt: SaveFormat;

      if (lpath.endsWith('.qpv3')) {
        const result = parseQpv3(bytes);
        parsed   = result.quest;
        savedFmt = result.savedFormat;
      } else if (isZipMagic(bytes)) {
        const result = parseZipQuest(bytes);
        parsed   = result.quest;
        savedFmt = result.savedFormat;
      } else if (lpath.endsWith('.bin')) {
        let datBytes: Uint8Array | null = null;
        try { datBytes = await readFile(replaceExt(opened.path, 'dat')); } catch { /* no companion .dat */ }
        const result = parseStandaloneBin(bytes, datBytes);
        parsed   = result.quest;
        savedFmt = result.savedFormat;
      } else {
        parsed   = parseQst(bytes);
        savedFmt = defaultSaveFormat(parsed);
      }

      const analysis = await analyseQuestBin(parsed.bin);
      const quest: Quest = { ...parsed, episode: analysis.episode, variantByArea: analysis.variantByArea };

      useUiStore.getState().resetPreviews(analysis.variantByArea);
      const offset     = EP_OFFSET[quest.episode];
      const firstAbsId = quest.floors[0] != null ? quest.floors[0].id + offset : null;

      set({ quest, filePath: opened.path, savedFormat: savedFmt, selectedFloorId: firstAbsId, isLoading: false });
    } catch (e) {
      set({ isLoading: false, error: String(e) });
    }
  },

  openQuestFromUrl: async () => {
    const url = window.prompt('Quest URL:');
    if (!url) return;
    set({ isLoading: true, error: null });
    try {
      const resp  = await fetch(url);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const bytes = new Uint8Array(await resp.arrayBuffer());

      const lurl = url.toLowerCase();
      let parsed: Quest;
      let savedFmt: SaveFormat;

      if (lurl.endsWith('.qpv3')) {
        const result = parseQpv3(bytes);
        parsed   = result.quest;
        savedFmt = result.savedFormat;
      } else if (isZipMagic(bytes)) {
        const result = parseZipQuest(bytes);
        parsed   = result.quest;
        savedFmt = result.savedFormat;
      } else if (lurl.endsWith('.bin')) {
        let datBytes: Uint8Array | null = null;
        try { datBytes = await readFile(replaceExt(url, 'dat')); } catch { /* no companion .dat */ }
        const result = parseStandaloneBin(bytes, datBytes);
        parsed   = result.quest;
        savedFmt = result.savedFormat;
      } else {
        parsed   = parseQst(bytes);
        savedFmt = defaultSaveFormat(parsed);
      }

      const analysis = await analyseQuestBin(parsed.bin);
      const quest: Quest = { ...parsed, episode: analysis.episode, variantByArea: analysis.variantByArea };
      useUiStore.getState().resetPreviews(analysis.variantByArea);
      const offset     = EP_OFFSET[quest.episode];
      const firstAbsId = quest.floors[0] != null ? quest.floors[0].id + offset : null;
      set({ quest, filePath: url, savedFormat: savedFmt, selectedFloorId: firstAbsId, isLoading: false });
    } catch (e) {
      set({ isLoading: false, error: String(e) });
    }
  },

  saveQuest: async () => {
    const { filePath, savedFormat } = get();
    if (!get().quest || !filePath) return;
    set({ isLoading: true, error: null });
    try {
      // Compile first — throws on syntax error, updates quest.bin in store on success.
      if (_preCompiler) await _preCompiler();
      const { quest } = get(); // re-read: compile may have updated bin
      if (!quest) { set({ isLoading: false }); return; }

      // Re-serialise in the same format the file was last saved/opened as.
      const fmt = savedFormat ?? defaultSaveFormat(quest);
      let result: { data: Uint8Array; ext: string; extraFiles?: { ext: string; data: Uint8Array }[] };

      if (fmt.packaging === 'qpv3') {
        result = serialiseQpv3(quest, _sidecarExtractor?.() ?? null);
      } else {
        result = serialiseForSave(quest, fmt);
        const sidecar = _sidecarExtractor?.();
        if (sidecar && result.ext === 'qst') await saveSidecar(filePath, sidecar);
      }

      await saveFile(filePath, result.data);
      if (result.extraFiles) {
        for (const ef of result.extraFiles) {
          await saveFile(replaceExt(filePath, ef.ext), ef.data);
        }
      }

      set({ isLoading: false, savedFormat: fmt, saveVersion: get().saveVersion + 1 });
    } catch (e) {
      set({ isLoading: false, error: String(e) });
    }
  },

  saveQuestAs: async () => {
    if (!get().quest) return;
    set({ isLoading: true, error: null });
    try {
      // Compile first — throws on syntax error, updates quest.bin in store on success.
      if (_preCompiler) await _preCompiler();
      const { quest } = get(); // re-read: compile may have updated bin
      if (!quest) { set({ isLoading: false }); return; }
      const bytes = serialiseQst(quest);
      const dest  = await saveFileDialog({
        title:       'Save Quest As',
        filters:     [{ name: 'PSO Quest', extensions: ['qst'] }],
        defaultName: 'quest.qst',
        data:        bytes,
      });
      if (!dest) { set({ isLoading: false }); return; }
      const sidecar = _sidecarExtractor?.();
      if (sidecar) await saveSidecar(dest, sidecar);
      set({ filePath: dest, isLoading: false, savedFormat: defaultSaveFormat(quest), saveVersion: get().saveVersion + 1 });
    } catch (e) {
      set({ isLoading: false, error: String(e) });
    }
  },

  saveQuestAsFormat: async (format) => {
    if (!get().quest) return false;
    set({ isLoading: true, error: null });
    try {
      if (_preCompiler) await _preCompiler();
      const { quest } = get();
      if (!quest) { set({ isLoading: false }); return false; }

      let result: { data: Uint8Array; ext: string; extraFiles?: { ext: string; data: Uint8Array }[] };

      if (format.packaging === 'qpv3') {
        result = serialiseQpv3(quest, _sidecarExtractor?.() ?? null);
      } else {
        result = serialiseForSave(quest, format);
      }

      const { data, ext } = result;

      const filters =
        ext === 'qst'  ? [{ name: 'PSO Quest',    extensions: ['qst']  }] :
        ext === 'bin'  ? [{ name: 'Quest Binary',  extensions: ['bin']  }] :
        ext === 'qpv3' ? [{ name: 'QEdit Project v3', extensions: ['qpv3'] }] :
                         [{ name: 'ZIP Archive',    extensions: ['zip']  }];

      const dest = await saveFileDialog({
        title:       'Save Quest As',
        filters,
        defaultName: `quest.${ext}`,
        data,
      });
      if (!dest) { set({ isLoading: false }); return false; }

      if (result.extraFiles) {
        for (const ef of result.extraFiles) {
          await saveFile(replaceExt(dest, ef.ext), ef.data);
        }
      }

      const sidecar = _sidecarExtractor?.();
      if (sidecar && ext === 'qst') await saveSidecar(dest, sidecar);

      set({ filePath: dest, isLoading: false, savedFormat: format, saveVersion: get().saveVersion + 1 });
      return true;
    } catch (e) {
      set({ isLoading: false, error: String(e) });
      return false;
    }
  },

  selectFloor:  id     => set({ selectedFloorId: id, selectedEntity: null }),
  selectEntity: entity => set({ selectedEntity: entity }),

  updateBinMeta: (patch) => {
    const { quest } = get();
    if (!quest) return;
    set({ quest: { ...quest, bin: { ...quest.bin, ...patch } } });
  },

  updateBin: (bin) => {
    const { quest } = get();
    if (!quest) return;
    set({ quest: { ...quest, bin } });
  },

  updateMonster: (floorId, index, patch) => {
    const { quest } = get();
    if (!quest) return;
    const floors = quest.floors.map(f => {
      if (f.id !== floorId) return f;
      const monsters = f.monsters.map((m, i) => i === index ? { ...m, ...patch } : m);
      return { ...f, monsters };
    });
    set({ quest: { ...quest, floors } });
  },

  updateObject: (floorId, index, patch) => {
    const { quest } = get();
    if (!quest) return;
    const floors = quest.floors.map(f => {
      if (f.id !== floorId) return f;
      const objects = f.objects.map((o, i) => i === index ? { ...o, ...patch } : o);
      return { ...f, objects };
    });
    set({ quest: { ...quest, floors } });
  },

  addMonster: (floorId, monster) => {
    const { quest } = get();
    if (!quest) return;
    // Set unknown3 (floor ID field) to the relative area ID
    const entry: Monster = { ...monster, unknown3: floorId };
    const floors = quest.floors.map(f => {
      if (f.id !== floorId) return f;
      return { ...f, monsters: [...f.monsters, entry] };
    });
    const newIndex = (quest.floors.find(f => f.id === floorId)?.monsters.length ?? 0);
    set({ quest: { ...quest, floors }, selectedEntity: { type: 'monster', index: newIndex } });
  },

  addObject: (floorId, obj) => {
    const { quest } = get();
    if (!quest) return;
    const floors = quest.floors.map(f => {
      if (f.id !== floorId) return f;
      return { ...f, objects: [...f.objects, obj] };
    });
    const newIndex = (quest.floors.find(f => f.id === floorId)?.objects.length ?? 0);
    set({ quest: { ...quest, floors }, selectedEntity: { type: 'object', index: newIndex } });
  },

  deleteMonster: (floorId, index) => {
    const { quest, selectedEntity } = get();
    if (!quest) return;
    const floors = quest.floors.map(f => {
      if (f.id !== floorId) return f;
      // Clear warp parent references for sensor objects (skin 10000)
      const deleted = f.monsters[index];
      let objects = f.objects;
      if (deleted?.skin === 10000) {
        objects = f.objects.map(o =>
          o.id === deleted.unknown4 ? { ...o, id: 0 } : o
        );
      }
      return { ...f, monsters: f.monsters.filter((_, i) => i !== index), objects };
    });
    // Adjust selection
    let newSel = selectedEntity;
    if (selectedEntity?.type === 'monster') {
      if (selectedEntity.index === index) newSel = null;
      else if (selectedEntity.index > index)
        newSel = { type: 'monster', index: selectedEntity.index - 1 };
    }
    set({ quest: { ...quest, floors }, selectedEntity: newSel });
  },

  deleteObject: (floorId, index) => {
    const { quest, selectedEntity } = get();
    if (!quest) return;
    const floors = quest.floors.map(f => {
      if (f.id !== floorId) return f;
      return { ...f, objects: f.objects.filter((_, i) => i !== index) };
    });
    let newSel = selectedEntity;
    if (selectedEntity?.type === 'object') {
      if (selectedEntity.index === index) newSel = null;
      else if (selectedEntity.index > index)
        newSel = { type: 'object', index: selectedEntity.index - 1 };
    }
    set({ quest: { ...quest, floors }, selectedEntity: newSel });
  },

  duplicateMonster: (floorId, index) => {
    const { quest } = get();
    if (!quest) return;
    const floor = quest.floors.find(f => f.id === floorId);
    if (!floor || !floor.monsters[index]) return;
    const copy = { ...floor.monsters[index] };
    get().addMonster(floorId, copy);
  },

  duplicateObject: (floorId, index) => {
    const { quest } = get();
    if (!quest) return;
    const floor = quest.floors.find(f => f.id === floorId);
    if (!floor || !floor.objects[index]) return;
    const copy = { ...floor.objects[index] };
    get().addObject(floorId, copy);
  },

  commitVariant: (areaId, variantIdx) => {
    const { quest } = get();
    if (!quest) return;
    const variantByArea = { ...quest.variantByArea, [areaId]: variantIdx };
    const bytecode = rebuildBytecodeMapSetup(quest.bin.bytecode, quest.episode, variantByArea, quest.bin.version);
    set({ quest: { ...quest, variantByArea, bin: { ...quest.bin, bytecode } } });
    useUiStore.getState().setPreviewVariant(areaId, variantIdx);
  },

  clearError: () => set({ error: null }),
}));

// ─── Selectors ─────────────────────────────────────────────────────────────

/**
 * Returns the Floor whose .dat relative ID corresponds to the selected
 * absolute area ID, accounting for the episode offset.
 */
export function useSelectedFloor(): Floor | null {
  return useQuestStore(s => {
    if (!s.quest || s.selectedFloorId === null) return null;
    const relId = s.selectedFloorId - EP_OFFSET[s.quest.episode];
    return s.quest.floors.find(f => f.id === relId) ?? null;
  });
}
