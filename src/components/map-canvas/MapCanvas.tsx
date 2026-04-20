import { useRef, useEffect, useCallback, useState, useLayoutEffect } from 'react';
import { readFile, openDirectoryDialog } from '../../platform/fs';
import { isTauri } from '../../platform/index';
import type { Floor, SelectedEntity } from '../../core/model/types';
import { parseNRel, parseCRel, toWorldPos } from '../../core/formats/rel';
import type { RelSection, RelTriangle } from '../../core/formats/rel';
import { toNRelName } from '../../core/map/mapFileNames';
import { AREA_BY_ID } from '../../core/map/areaData';
import { useUiStore } from '../../stores/uiStore';
import { useQuestStore } from '../../stores/questStore';
import css from './MapCanvas.module.css';

// ─── Types ──────────────────────────────────────────────────────────────────

interface MapData {
  sections: RelSection[];
  triangles: RelTriangle[];
}

type LoadState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ok'; data: MapData }
  | { status: 'error'; msg: string };

// ─── Rendering ──────────────────────────────────────────────────────────────

function renderMap(
  canvas: HTMLCanvasElement,
  data: MapData,
  floor: Floor | null,
  zoom: number,
  panX: number,
  panY: number,
  selectedEntity: SelectedEntity = null,
) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const dpr = window.devicePixelRatio || 1;
  const PW  = canvas.width;
  const PH  = canvas.height;
  const LW  = PW / dpr;
  const LH  = PH / dpr;

  ctx.clearRect(0, 0, PW, PH);
  ctx.fillStyle = '#0a0a0a';
  ctx.fillRect(0, 0, PW, PH);

  const pZoom = zoom * dpr;
  const toScreen = (wx: number, wy: number): [number, number] => [
    LW / 2 * dpr + (wx + panX) * pZoom,
    LH / 2 * dpr + (wy + panY) * pZoom,
  ];

  // Geometry
  for (const tri of data.triangles) {
    const [x0, y0] = toScreen(tri.x0, tri.z0);
    const [x1, y1] = toScreen(tri.x1, tri.z1);
    const [x2, y2] = toScreen(tri.x2, tri.z2);
    const minX = Math.min(x0, x1, x2), maxX = Math.max(x0, x1, x2);
    const minY = Math.min(y0, y1, y2), maxY = Math.max(y0, y1, y2);
    if (maxX < 0 || minX > PW || maxY < 0 || minY > PH) continue;

    if      (tri.flags & 64) ctx.strokeStyle = '#3060ff';
    else if (tri.flags & 16) ctx.strokeStyle = '#408040';
    else if (tri.flags & 1)  ctx.strokeStyle = '#404040';
    else                     ctx.strokeStyle = '#555555';

    ctx.beginPath();
    ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.lineTo(x2, y2);
    ctx.closePath();
    ctx.lineWidth = 0.5 * dpr;
    ctx.stroke();
  }

  if (!floor) return;

  const DOT_R = Math.max(3 * dpr, 5 * dpr * zoom / 100);

  // Monsters
  for (let i = 0; i < floor.monsters.length; i++) {
    const m = floor.monsters[i];
    const [wx, wy] = toWorldPos(m.posX, m.posY, m.mapSection, data.sections);
    const [sx, sy] = toScreen(wx, wy);
    if (sx < -DOT_R || sx > PW + DOT_R || sy < -DOT_R || sy > PH + DOT_R) continue;
    const isSel = selectedEntity?.type === 'monster' && selectedEntity.index === i;
    if (isSel) {
      ctx.beginPath(); ctx.arc(sx, sy, DOT_R * 2, 0, Math.PI * 2);
      ctx.strokeStyle = '#ffcc00'; ctx.lineWidth = 1.5 * dpr; ctx.stroke();
    }
    ctx.beginPath(); ctx.arc(sx, sy, DOT_R, 0, Math.PI * 2);
    ctx.fillStyle = isSel ? '#ffcc00' : '#ff4040'; ctx.fill();
    ctx.strokeStyle = isSel ? '#fff8d0' : '#ff8080'; ctx.lineWidth = 0.5 * dpr; ctx.stroke();
    if (DOT_R > 5 * dpr) {
      ctx.fillStyle = isSel ? '#000' : '#fff';
      ctx.font = `${Math.max(8, DOT_R * 1.4)}px monospace`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(String(i), sx, sy);
    }
  }

  // Objects
  for (let i = 0; i < floor.objects.length; i++) {
    const o = floor.objects[i];
    const [wx, wy] = toWorldPos(o.posX, o.posY, o.mapSection, data.sections);
    const [sx, sy] = toScreen(wx, wy);
    if (sx < -DOT_R || sx > PW + DOT_R || sy < -DOT_R || sy > PH + DOT_R) continue;
    const isSel = selectedEntity?.type === 'object' && selectedEntity.index === i;
    if (isSel) {
      ctx.beginPath(); ctx.arc(sx, sy, DOT_R * 1.8, 0, Math.PI * 2);
      ctx.strokeStyle = '#00ffcc'; ctx.lineWidth = 1.5 * dpr; ctx.stroke();
    }
    ctx.beginPath(); ctx.arc(sx, sy, DOT_R * 0.75, 0, Math.PI * 2);
    ctx.fillStyle = isSel ? '#00ffcc' : '#4080ff'; ctx.fill();
    ctx.strokeStyle = isSel ? '#ccffee' : '#80b0ff'; ctx.lineWidth = 0.5 * dpr; ctx.stroke();
  }
}

// ─── Fit ─────────────────────────────────────────────────────────────────────

function computeFit(W: number, H: number, data: MapData, floor: Floor | null) {
  const pts: [number, number][] = [];
  for (const tri of data.triangles)
    pts.push([tri.x0, tri.z0], [tri.x1, tri.z1], [tri.x2, tri.z2]);
  if (floor) {
    for (const m of floor.monsters) {
      const [wx, wy] = toWorldPos(m.posX, m.posY, m.mapSection, data.sections);
      pts.push([wx, wy]);
    }
    for (const o of floor.objects) {
      const [wx, wy] = toWorldPos(o.posX, o.posY, o.mapSection, data.sections);
      pts.push([wx, wy]);
    }
  }
  if (pts.length === 0) return { zoom: 1, panX: 0, panY: 0 };

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [x, y] of pts) {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  const spanX = maxX - minX, spanY = maxY - minY;
  if (spanX < 1 && spanY < 1) return { zoom: 1, panX: -cx, panY: -cy };
  return { zoom: Math.min(W / (spanX * 1.1), H / (spanY * 1.1)), panX: -cx, panY: -cy };
}

// ─── Component ───────────────────────────────────────────────────────────────

interface MapCanvasProps {
  /** null when selected area is not enabled in the quest */
  floor: Floor | null;
  areaId: number;
}

export function MapCanvas({ floor, areaId }: MapCanvasProps) {
  const { mapDir, setMapDir, previewVariantByArea } = useUiStore();
  const { quest } = useQuestStore();
  const selectedEntity = useQuestStore(s => s.selectedEntity);
  const area = AREA_BY_ID[areaId];

  // Preview variant (set by sidebar click) → committed variant (from bytecode) → default 0
  const previewIdx   = previewVariantByArea[areaId];
  const committedIdx = quest?.variantByArea[areaId];
  const variantIdx   = previewIdx ?? committedIdx ?? 0;
  const selectedFile = area?.variants[variantIdx]?.file ?? area?.variants[0]?.file ?? '';

  const [loadState, setLoadState] = useState<LoadState>({ status: 'idle' });
  const [zoom, setZoom]   = useState(1);
  const [panX, setPanX]   = useState(0);
  const [panY, setPanY]   = useState(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef   = useRef<HTMLDivElement>(null);
  const dragRef   = useRef<{ startX: number; startY: number; panX: number; panY: number } | null>(null);
  const fitted    = useRef(false);

  // Reset load state when area changes
  useEffect(() => {
    setLoadState({ status: 'idle' });
    fitted.current = false;
  }, [areaId]);

  // In web mode, probe for a server-served data folder once on mount.
  useEffect(() => {
    if (mapDir || isTauri()) return;
    fetch('./data/map/xvm/forest1.png', { method: 'HEAD' })
      .then(r => { if (r.ok) setMapDir('./data/map'); })
      .catch(() => { /* not available — user must pick folder manually */ });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load geometry when selectedFile or mapDir changes
  useEffect(() => {
    if (!mapDir || !selectedFile) return;
    const sep   = mapDir.includes('/') ? '/' : '\\';
    const cPath = `${mapDir}${sep}${selectedFile}`;
    const nPath = `${mapDir}${sep}${toNRelName(selectedFile)}`;
    setLoadState({ status: 'loading' });
    fitted.current = false;
    Promise.all([readFile(cPath), readFile(nPath)])
      .then(([cBuf, nBuf]) => {
        const triangles = parseCRel(new Uint8Array(cBuf));
        const sections  = parseNRel(new Uint8Array(nBuf));
        setLoadState({ status: 'ok', data: { triangles, sections } });
      })
      .catch(e => setLoadState({ status: 'error', msg: String(e) }));
  }, [mapDir, selectedFile]);

  // HiDPI-aware resize
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const sync = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const dpr = window.devicePixelRatio || 1;
      const w = el.clientWidth, h = el.clientHeight;
      canvas.width  = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width  = `${w}px`;
      canvas.style.height = `${h}px`;
    };
    const obs = new ResizeObserver(sync);
    obs.observe(el);
    sync();
    return () => obs.disconnect();
  }, []);

  // Render loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || loadState.status !== 'ok') return;
    const { data } = loadState;
    const dpr  = window.devicePixelRatio || 1;
    const logW = canvas.width  / dpr;
    const logH = canvas.height / dpr;
    if (!fitted.current && logW > 0 && logH > 0) {
      const f = computeFit(logW, logH, data, floor);
      setZoom(f.zoom); setPanX(f.panX); setPanY(f.panY);
      fitted.current = true;
      return;
    }
    renderMap(canvas, data, floor, zoom, panX, panY, selectedEntity);
  });

  // Zoom toward cursor
  const onWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    const dpr  = window.devicePixelRatio || 1;
    const logW = canvas.width  / dpr, logH = canvas.height / dpr;
    const rect = canvas.getBoundingClientRect();
    const cx   = e.clientX - rect.left, cy = e.clientY - rect.top;
    setZoom(z => {
      const nz = Math.max(0.01, Math.min(z * factor, 50));
      setPanX(px => (cx - logW / 2) / nz - (cx - logW / 2) / z + px);
      setPanY(py => (cy - logH / 2) / nz - (cy - logH / 2) / z + py);
      return nz;
    });
  }, []);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    dragRef.current = { startX: e.clientX, startY: e.clientY, panX, panY };
  }, [panX, panY]);

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragRef.current) return;
    setPanX(dragRef.current.panX + (e.clientX - dragRef.current.startX) / zoom);
    setPanY(dragRef.current.panY + (e.clientY - dragRef.current.startY) / zoom);
  }, [zoom]);

  const onDragCancel = useCallback(() => { dragRef.current = null; }, []);

  const onMouseUp = useCallback((e: React.MouseEvent) => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag) return;
    // Only treat as a click if the mouse barely moved
    if (Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) >= 5) return;
    if (loadState.status !== 'ok' || !floor) return;
    const { data } = loadState;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr  = window.devicePixelRatio || 1;
    const logW = canvas.width / dpr;
    const logH = canvas.height / dpr;
    const rect = canvas.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    // CSS-pixel click → world coordinates
    const wx = (cx - logW / 2) / zoom - panX;
    const wy = (cy - logH / 2) / zoom - panY;
    // Pick radius scales with dot size so it's always easy to hit
    const dotR = Math.max(3, 5 * zoom / 100);
    const pickR = dotR * 2.5 / zoom;
    let bestDist = pickR;
    let best: SelectedEntity = null;
    for (let i = 0; i < floor.monsters.length; i++) {
      const m = floor.monsters[i];
      const [mwx, mwy] = toWorldPos(m.posX, m.posY, m.mapSection, data.sections);
      const d = Math.hypot(wx - mwx, wy - mwy);
      if (d < bestDist) { bestDist = d; best = { type: 'monster', index: i }; }
    }
    for (let i = 0; i < floor.objects.length; i++) {
      const o = floor.objects[i];
      const [owx, owy] = toWorldPos(o.posX, o.posY, o.mapSection, data.sections);
      const d = Math.hypot(wx - owx, wy - owy);
      if (d < bestDist) { bestDist = d; best = { type: 'object', index: i }; }
    }
    useQuestStore.getState().selectEntity(best);
  }, [loadState, floor, zoom, panX, panY]);

  const handleSetDir = useCallback(async () => {
    const sel = await openDirectoryDialog('Select map folder (*c.rel / *n.rel)');
    if (sel) setMapDir(sel);
  }, [setMapDir]);

  const resetView = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || loadState.status !== 'ok') return;
    const dpr  = window.devicePixelRatio || 1;
    const f = computeFit(canvas.width / dpr, canvas.height / dpr, loadState.data, floor);
    setZoom(f.zoom); setPanX(f.panX); setPanY(f.panY); fitted.current = true;
  }, [loadState, floor]);

  return (
    <div
      ref={wrapRef}
      className={css.canvasWrap}
      onWheel={onWheel}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onDragCancel}
    >
      <canvas ref={canvasRef} className={css.canvas} />

      {!mapDir && (
        <div className={css.overlay} style={{ flexDirection: 'column', gap: 10 }}>
          <span>Map folder not configured.</span>
          <button className={css.setDirBtn} style={{ pointerEvents: 'all' }} onClick={handleSetDir}>Set map folder</button>
        </div>
      )}

      {loadState.status === 'loading' && (
        <div className={css.overlay}>Loading…</div>
      )}
      {loadState.status === 'error' && (
        <div className={css.overlay} style={{ flexDirection: 'column', gap: 6, color: '#f08080' }}>
          <span>Could not load map file</span>
          <span style={{ fontSize: 10 }}>{loadState.msg}</span>
          <button className={css.setDirBtn} style={{ pointerEvents: 'all' }} onClick={handleSetDir}>
            Change folder
          </button>
        </div>
      )}

      {loadState.status === 'ok' && !floor && (
        <div className={css.overlay} style={{ pointerEvents: 'none' }}>
          Area not enabled in this quest
        </div>
      )}

      {/* Legend */}
      {loadState.status === 'ok' && floor && (
        <div className={css.legend}>
          <div className={css.legendRow}>
            <div className={css.dot} style={{ background: '#ff4040' }} />
            <span>Monsters ({floor.monsters.length})</span>
          </div>
          <div className={css.legendRow}>
            <div className={css.dot} style={{ background: '#4080ff' }} />
            <span>Objects ({floor.objects.length})</span>
          </div>
        </div>
      )}

      {/* Toolbar */}
      <div className={css.toolbar}>
        <button className={css.toolBtn} title="Reset view" onClick={resetView}>⊡</button>
        <button className={css.toolBtn} title="Change map folder" onClick={handleSetDir}>⚙</button>
      </div>
    </div>
  );
}
