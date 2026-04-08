import { create } from 'zustand';

type MainTab = 'map' | 'script' | 'metadata' | '3d';

const MAP_DIR_KEY = 'qedit_mapDir';

interface UiStore {
  mainTab:  MainTab;
  setMainTab: (tab: MainTab) => void;

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

  mapDir: localStorage.getItem(MAP_DIR_KEY),
  setMapDir: dir => {
    localStorage.setItem(MAP_DIR_KEY, dir);
    set({ mapDir: dir });
  },

  previewVariantByArea: {},
  setPreviewVariant: (areaId, idx) =>
    set(s => ({ previewVariantByArea: { ...s.previewVariantByArea, [areaId]: idx } })),
  resetPreviews: variants => set({ previewVariantByArea: { ...variants } }),
}));
