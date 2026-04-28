import { create } from 'zustand';
import { isTauri } from '../platform/index';
import type { PlacementType } from '../core/data/presets';
import type { RelSection, RelTriangle } from '../core/formats/rel';

type MainTab = 'map' | 'script' | 'metadata';

export type ViewMode = '2d' | '3d';

export interface PlacementTarget {
  /** Relative floor ID (floor.id) */
  floorId: number;
  entityType: 'monster' | 'object';
  entityIndex: number;
  /**
   * Drag behaviour, read directly from objects.json placement field:
   *   'rotation' — drag sets rotY / direction
   *   'radius'   — drag sets scaleX (activation radius)
   *   'none'     — click only; drag has no effect
   */
  placement: PlacementType;
}

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

  /** 2D/3D map view toggle — lifted here so placement mode can force 2D. */
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;

  /**
   * When set, the 2D map canvas is in placement mode: the next click/drag
   * positions the indicated entity.
   */
  placementTarget: PlacementTarget | null;
  setPlacementTarget: (target: PlacementTarget) => void;
  clearPlacementTarget: () => void;

  /** Map geometry for the currently loaded floor — set by MapCanvas, consumed by AddPanel. */
  loadedMapData: { areaId: number; triangles: RelTriangle[]; sections: RelSection[] } | null;
  setLoadedMapData: (d: { areaId: number; triangles: RelTriangle[]; sections: RelSection[] } | null) => void;
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

  viewMode: '2d',
  setViewMode: mode => set({ viewMode: mode }),

  placementTarget: null,
  setPlacementTarget: target => set({ placementTarget: target }),
  clearPlacementTarget: () => set({ placementTarget: null }),

  loadedMapData: null,
  setLoadedMapData: d => set({ loadedMapData: d }),
}));
