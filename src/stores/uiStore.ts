import { create } from 'zustand';
import { isTauri } from '../platform/index';

type MainTab = 'map' | 'script' | 'metadata';

const MAP_DIR_KEY = 'qedit_mapDir';

interface UiStore {
  mainTab:  MainTab;
  setMainTab: (tab: MainTab) => void;

  /** True when the last script compile attempt failed — drives the red dot on the Script tab. */
  scriptHasError: boolean;
  setScriptHasError: (v: boolean) => void;

  /** Absolute path to the folder containing *c.rel and *n.rel files */
  mapDir:   string | null;
  setMapDir: (dir: string) => void;

  /**
   * Currently previewed map-variant index per absolute area ID.
   * Starts matching quest.variantByArea on load; user can change to preview
   * different room layouts in the canvas before committing.
   */
  previewVariantByArea: Record<number, number>;
  setPreviewVariant: (areaId: number, idx: number) => void;
  /** Called on quest load to reset previews to match the loaded bytecode variants. */
  resetPreviews: (variants: Record<number, number>) => void;
}

export const useUiStore = create<UiStore>(set => ({
  mainTab:    'map',
  setMainTab: tab => set({ mainTab: tab }),

  scriptHasError:    false,
  setScriptHasError: v => set({ scriptHasError: v }),

  // In browser mode, directory handles don't survive page reloads — always start without one.
  mapDir: isTauri() ? localStorage.getItem(MAP_DIR_KEY) : null,
  setMapDir: dir => {
    if (isTauri()) localStorage.setItem(MAP_DIR_KEY, dir);
    set({ mapDir: dir });
  },

  previewVariantByArea: {},
  setPreviewVariant: (areaId, idx) =>
    set(s => ({ previewVariantByArea: { ...s.previewVariantByArea, [areaId]: idx } })),
  resetPreviews: variants => set({ previewVariantByArea: { ...variants } }),
}));
