import { create } from 'zustand';
import { open as dialogOpen } from '@tauri-apps/plugin-dialog';
import { readFile, writeFile } from '@tauri-apps/plugin-fs';
import { parseQst, serialiseQst } from '../core/formats/qst';
import { analyseQuestBin } from '../core/formats/bytecodeAnalysis';
import { EP_OFFSET } from '../core/map/areaData';
import { useUiStore } from './uiStore';
import type { Quest, Floor, QuestBin, Language, Monster, QuestObject } from '../core/model/types';

type BinMetaPatch = Partial<Pick<QuestBin, 'title' | 'info' | 'description' | 'questNumber'> & { language: Language }>;

interface QuestStore {
  quest: Quest | null;
  filePath: string | null;
  /** Absolute area ID (0-45) of the selected area, or null. */
  selectedFloorId: number | null;
  activeTab: 'monsters' | 'objects' | 'canvas';
  isLoading: boolean;
  error: string | null;

  openQuest: () => Promise<void>;
  saveQuest: () => Promise<void>;
  saveQuestAs: () => Promise<void>;
  selectFloor: (id: number) => void;
  setActiveTab: (tab: 'monsters' | 'objects' | 'canvas') => void;
  updateBinMeta: (patch: BinMetaPatch) => void;
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

  openQuest: async () => {
    const selected = await dialogOpen({
      title: 'Open Quest',
      filters: [{ name: 'PSO Quest', extensions: ['qst', 'bin'] }],
      multiple: false,
    });
    if (!selected || typeof selected !== 'string') return;

    set({ isLoading: true, error: null });
    try {
      const bytes  = await readFile(selected);
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

      set({ quest, filePath: selected, selectedFloorId: firstAbsId, isLoading: false });
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
      await writeFile(filePath, bytes);
      set({ isLoading: false });
    } catch (e) {
      set({ isLoading: false, error: String(e) });
    }
  },

  saveQuestAs: async () => {
    const { quest } = get();
    if (!quest) return;
    const dest = await dialogOpen({
      title: 'Save Quest As',
      filters: [{ name: 'PSO Quest', extensions: ['qst'] }],
      multiple: false,
    });
    if (!dest || typeof dest !== 'string') return;
    set({ filePath: dest });
    await get().saveQuest();
  },

  selectFloor:  id  => set({ selectedFloorId: id }),
  setActiveTab: tab => set({ activeTab: tab }),

  updateBinMeta: (patch) => {
    const { quest } = get();
    if (!quest) return;
    set({ quest: { ...quest, bin: { ...quest.bin, ...patch } } });
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
    set({ quest: { ...quest, variantByArea } });
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
