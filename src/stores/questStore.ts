import { create } from 'zustand';
import { openFileDialog, saveFile, saveFileDialog } from '../platform/fs';
import { parseQst, serialiseQst } from '../core/formats/qst';
import { analyseQuestBin } from '../core/formats/bytecodeAnalysis';
import { EP_OFFSET } from '../core/map/areaData';
import { useUiStore } from './uiStore';
import { BinVersion, QstFormat, Language } from '../core/model/types';
import { rebuildBytecodeMapSetup } from '../core/formats/bytecodeMap';
import type { Quest, Floor, QuestBin, Monster, QuestObject } from '../core/model/types';

type BinMetaPatch = Partial<Pick<QuestBin, 'title' | 'info' | 'description' | 'questNumber'> & { language: Language }>;

interface QuestStore {
  quest: Quest | null;
  filePath: string | null;
  /** Absolute area ID (0-45) of the selected area, or null. */
  selectedFloorId: number | null;
  activeTab: 'monsters' | 'objects' | 'canvas';
  isLoading: boolean;
  error: string | null;

  newQuest: (episode: 1 | 2 | 4) => void;
  toggleArea: (absAreaId: number) => void;
  openQuest: () => Promise<void>;
  openQuestFromUrl: () => Promise<void>;
  saveQuest: () => Promise<void>;
  saveQuestAs: () => Promise<void>;
  selectFloor: (id: number) => void;
  setActiveTab: (tab: 'monsters' | 'objects' | 'canvas') => void;
  updateBinMeta: (patch: BinMetaPatch) => void;
  updateBin: (bin: QuestBin) => void;
  updateMonster: (floorId: number, index: number, patch: Partial<Monster>) => void;
  updateObject: (floorId: number, index: number, patch: Partial<QuestObject>) => void;
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
  selectedFloorId: null,
  activeTab: 'monsters',
  isLoading: false,
  error: null,

  newQuest: (episode) => {
    const epIdx   = episode === 1 ? 0 : episode === 2 ? 1 : 2;
    const bytecode = episode === 1
      ? new Uint8Array([0x01])
      : new Uint8Array([0xF8, 0xBC, epIdx, 0x00, 0x00, 0x00, 0x01]);

    const floors: Floor[] = [];

    const bin: QuestBin = {
      version:     BinVersion.PC,
      bbContainer: false,
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
    set({ quest, filePath: null, selectedFloorId: null, isLoading: false, error: null });
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
      filters: [{ name: 'PSO Quest', extensions: ['qst', 'bin'] }],
    });
    if (!opened) return;

    set({ isLoading: true, error: null });
    try {
      const bytes  = opened.data;
      const parsed = parseQst(new Uint8Array(bytes));

      // Detect episode + per-area variant from bytecode
      const analysis = await analyseQuestBin(parsed.bin);

      const quest: Quest = {
        ...parsed,
        episode:       analysis.episode,
        variantByArea: analysis.variantByArea,
      };

      // Reset UI previews to match the loaded bytecode variants
      useUiStore.getState().resetPreviews(analysis.variantByArea);

      // Select the first enabled area (convert relative .dat id → absolute area id)
      const offset     = EP_OFFSET[quest.episode];
      const firstAbsId = quest.floors[0] != null ? quest.floors[0].id + offset : null;

      set({ quest, filePath: opened.path, selectedFloorId: firstAbsId, isLoading: false });
    } catch (e) {
      set({ isLoading: false, error: String(e) });
    }
  },

  openQuestFromUrl: async () => {
    const url = window.prompt('Quest URL:');
    if (!url) return;
    set({ isLoading: true, error: null });
    try {
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const bytes  = new Uint8Array(await resp.arrayBuffer());
      const parsed = parseQst(bytes);
      const analysis = await analyseQuestBin(parsed.bin);
      const quest: Quest = { ...parsed, episode: analysis.episode, variantByArea: analysis.variantByArea };
      useUiStore.getState().resetPreviews(analysis.variantByArea);
      const offset     = EP_OFFSET[quest.episode];
      const firstAbsId = quest.floors[0] != null ? quest.floors[0].id + offset : null;
      set({ quest, filePath: url, selectedFloorId: firstAbsId, isLoading: false });
    } catch (e) {
      set({ isLoading: false, error: String(e) });
    }
  },

  saveQuest: async () => {
    const { quest, filePath } = get();
    if (!quest || !filePath) return;
    set({ isLoading: true, error: null });
    try {
      const bytes = serialiseQst(quest);
      await saveFile(filePath, bytes);
      set({ isLoading: false });
    } catch (e) {
      set({ isLoading: false, error: String(e) });
    }
  },

  saveQuestAs: async () => {
    const { quest } = get();
    if (!quest) return;
    const bytes = serialiseQst(quest);
    const dest  = await saveFileDialog({
      title:       'Save Quest As',
      filters:     [{ name: 'PSO Quest', extensions: ['qst'] }],
      defaultName: 'quest.qst',
      data:        bytes,
    });
    if (!dest) return;
    set({ filePath: dest });
  },

  selectFloor:  id  => set({ selectedFloorId: id }),
  setActiveTab: tab => set({ activeTab: tab }),

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
