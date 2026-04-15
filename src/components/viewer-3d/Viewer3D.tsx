/**
 * Viewer3D — first-person noclip 3D scene viewer (Three.js).
 *
 * Primary mesh:  *n.rel visual geometry (untextured for now)
 * Overlay mesh:  *c.rel collision wireframe (toggleable)
 *
 * Controls:
 *   Click      — capture mouse (pointer lock)
 *   Mouse      — look around
 *   W/S        — forward / backward
 *   A/D        — strafe left / right
 *   Space      — fly up
 *   Shift      — fly down
 *   Esc        — release mouse
 */

import { useRef, useEffect, useState } from 'react';
import * as THREE from 'three';
import { readFile } from '../../platform/fs';
import { useUiStore } from '../../stores/uiStore';
import { useQuestStore, useSelectedFloor } from '../../stores/questStore';
import { AREA_BY_ID } from '../../core/map/areaData';
import { parseCRel, parseNRel, toWorldPos } from '../../core/formats/rel';
import { parseNRelMeshes, TexAddrMode } from '../../core/formats/nrel';
import type { NRelMesh, NRelMotion, NRelKeyframe } from '../../core/formats/nrel';
import { parseXvm } from '../../core/formats/xvm';
import type { XvmTexture } from '../../core/formats/xvm';
import { parseTam } from '../../core/formats/tam';
import type { TamData } from '../../core/formats/tam';
import { toNRelName } from '../../core/map/mapFileNames';
import css from './Viewer3D.module.css';

// ─── Constants ───────────────────────────────────────────────────────────────

const SPEED            = 80;
const MOUSE_SENS       = 0.002;
const HALF_PI          = Math.PI / 2 - 0.01;

// ─── Visual mesh builder (n.rel) ─────────────────────────────────────────────

// ─── DXT texture builder ──────────────────────────────────────────────────────

function buildThreeTexture(xvr: XvmTexture): THREE.CompressedTexture {
  // PSO uses DXT1 (dxtFmt=6) or DXT3 (all other non-VQ values).
  // Delphi's "DXT5_Header" is misnamed — its FourCC is "DXT3" (#$44#$58#$54#$33).
  // DXT1 with alpha (pixFmt>1): use RGBA variant so the 1-bit alpha block is decoded.
  // DXT1 without alpha: RGB variant (no alpha block in the data stream).
  const fmt = xvr.isDXT1
    ? (xvr.hasAlpha ? THREE.RGBA_S3TC_DXT1_Format : THREE.RGB_S3TC_DXT1_Format)
    : THREE.RGBA_S3TC_DXT3_Format;  // DXT3 with explicit 4-bit alpha per texel
  const tex = new THREE.CompressedTexture(
    [{ data: xvr.data as unknown as Uint8Array, width: xvr.width, height: xvr.height }],
    xvr.width, xvr.height,
    fmt,
  );
  // Compressed textures are not flipped by default; match PSO's DirectX UV convention
  tex.flipY      = false;
  tex.wrapS      = THREE.RepeatWrapping;
  tex.wrapT      = THREE.RepeatWrapping;
  tex.needsUpdate = true;
  return tex;
}

// ─── Animation target ─────────────────────────────────────────────────────────

interface AnimTarget {
  slideId:   number;   // -1 if no slide animation
  swapId:    number;   // -1 if no swap animation
  material:  THREE.MeshLambertMaterial;
  wrapU:     TexAddrMode;
  wrapV:     TexAddrMode;
  // Accumulated UV offset kept in [0,1) — avoids precision loss from a
  // large monotonically-growing float being fed into the GPU UV transform.
  slideOffX: number;
  slideOffY: number;
}

// ─── Geometry animation track sampler ────────────────────────────────────────

/** Linear interpolation along a position/scale track at the given frame. */
function sampleGeomTrack(
  keys:  NRelKeyframe[],
  def:   [number, number, number],
  frame: number,
): [number, number, number] {
  if (keys.length === 0) return def;
  if (frame <= keys[0].frame) return keys[0].value;
  const last = keys[keys.length - 1];
  if (frame >= last.frame) return last.value;
  for (let i = 1; i < keys.length; i++) {
    if (keys[i].frame > frame) {
      const a = keys[i - 1], b = keys[i];
      const t = (frame - a.frame) / (b.frame - a.frame);
      return [
        a.value[0] + (b.value[0] - a.value[0]) * t,
        a.value[1] + (b.value[1] - a.value[1]) * t,
        a.value[2] + (b.value[2] - a.value[2]) * t,
      ];
    }
  }
  return last.value;
}

/**
 * Short-path BAM interpolation along a rotation track.
 * Matches Delphi's getmaprotation: angles are 16-bit BAM (0..65535).
 * When the unsigned delta > 0x8000 the rotation takes the shorter path in the
 * opposite direction, preventing a near-full-circle detour on wrap-around.
 * Returns raw BAM values (multiply by BAM_TO_RAD to get radians).
 */
function sampleGeomAnglTrack(
  keys:  NRelKeyframe[],
  def:   [number, number, number],
  frame: number,
): [number, number, number] {
  const bamInterp = (a: number, b: number, t: number): number => {
    const aw = a & 0xFFFF;
    const bw = b & 0xFFFF;
    let delta = (bw - aw) & 0xFFFF;          // 16-bit unsigned difference
    if (delta > 0x8000) delta -= 0x10000;    // short path (delta may be negative)
    return ((aw + delta * t) & 0xFFFF);      // result wrapped back to 16-bit BAM
  };

  if (keys.length === 0) return def;
  if (frame <= keys[0].frame) return keys[0].value;
  const last = keys[keys.length - 1];
  if (frame >= last.frame) return last.value;
  for (let i = 1; i < keys.length; i++) {
    if (keys[i].frame > frame) {
      const a = keys[i - 1], b = keys[i];
      const t = (frame - a.frame) / (b.frame - a.frame);
      return [
        bamInterp(a.value[0], b.value[0], t),
        bamInterp(a.value[1], b.value[1], t),
        bamInterp(a.value[2], b.value[2], t),
      ];
    }
  }
  return last.value;
}

// ─── Visual mesh builder (n.rel + textures) ───────────────────────────────────

function d3dWrapToThree(mode: TexAddrMode): THREE.Wrapping {
  if (mode === TexAddrMode.Mirror) return THREE.MirroredRepeatWrapping;
  if (mode === TexAddrMode.Wrap)   return THREE.RepeatWrapping;
  return THREE.ClampToEdgeWrapping;
}

// D3DBLEND stored value (before Delphi's +1) → Three.js BlendingDstFactor / BlendingSrcFactor.
// D3D constants (after +1): 1=ZERO, 2=ONE, 3=SRCCOLOR, 4=INVSRCCOLOR,
//   5=SRCALPHA, 6=INVSRCALPHA, 9=DESTCOLOR, 10=INVDESTCOLOR.
function d3dBlendToThree(stored: number): THREE.BlendingDstFactor {
  switch (stored + 1) {
    case 1:  return THREE.ZeroFactor;
    case 2:  return THREE.OneFactor;
    case 3:  return THREE.SrcColorFactor;
    case 4:  return THREE.OneMinusSrcColorFactor;
    case 5:  return THREE.SrcAlphaFactor;
    case 6:  return THREE.OneMinusSrcAlphaFactor;
    case 9:  return THREE.DstColorFactor;
    case 10: return THREE.OneMinusDstColorFactor;
    default: return THREE.SrcAlphaFactor;
  }
}

function buildVisualMeshes(
  nMeshes:    NRelMesh[],
  textures:   (THREE.CompressedTexture | null)[],
  xvmSrc:     (XvmTexture | null)[],
): { group: THREE.Group; animTargets: AnimTarget[]; motionGroups: Array<{ group: THREE.Group; motion: NRelMotion }> } {
  const group = new THREE.Group();
  const animTargets: AnimTarget[] = [];
  // Cache texture clones keyed by "texId:wrapU:wrapV" to avoid per-strip GPU uploads.
  // Animated meshes (slideId/swapId ≠ -1) bypass this cache so each material gets a
  // unique clone whose offset/map can be mutated independently each frame.
  const texCache = new Map<string, THREE.CompressedTexture>();
  // Geometry-animation groups: one per unique NRelMotion reference (= one animated block).
  const motionGroupMap = new Map<NRelMotion, THREE.Group>();
  const motionGroups: Array<{ group: THREE.Group; motion: NRelMotion }> = [];

  for (const m of nMeshes) {
    const isAnimated = m.slideId !== -1 || m.swapId !== -1;

    // Determine the parent group for meshes from this NRelMesh.
    // Non-animated: a plain section group (position + rotY baked in).
    // Geometry-animated: section group → motion group whose transform is updated each frame.
    let contentParent: THREE.Group;
    if (m.motion) {
      if (!motionGroupMap.has(m.motion)) {
        const sg = new THREE.Group();
        sg.rotation.order = 'YXZ';
        sg.rotation.y = m.section.rotY;
        sg.position.set(m.section.x, m.section.y, m.section.z);
        group.add(sg);
        // Motion group applies the animated root-node transform at runtime.
        // D3D uses row vectors: v' = v * Rx * Ry * Rz → column vector form: Rz*Ry*Rx = Three.js 'ZYX'.
        const mg = new THREE.Group();
        mg.rotation.order = 'ZYX';
        const dr = m.motion.defaultRot;
        mg.rotation.x = (dr[0] & 0xFFFF) * BAM_TO_RAD;
        mg.rotation.y = (dr[1] & 0xFFFF) * BAM_TO_RAD;
        mg.rotation.z = (dr[2] & 0xFFFF) * BAM_TO_RAD;
        const dp = m.motion.defaultPos;
        mg.position.set(dp[0], dp[1], dp[2]);
        const ds = m.motion.defaultScale;
        mg.scale.set(ds[0], ds[1], ds[2]);
        sg.add(mg);
        motionGroupMap.set(m.motion, mg);
        motionGroups.push({ group: mg, motion: m.motion });
      }
      contentParent = motionGroupMap.get(m.motion)!;
    } else {
      const secGroup = new THREE.Group();
      secGroup.rotation.order = 'YXZ';
      secGroup.rotation.y = m.section.rotY;
      secGroup.position.set(m.section.x, m.section.y, m.section.z);
      group.add(secGroup);
      contentParent = secGroup;
    }

    const vCount = m.vertices.length / m.stride;

    for (const strip of m.strips) {
      const idxCount = strip.indices.length;
      if (idxCount < 3) continue;

      const triPositions: number[] = [];
      const triNormals:   number[] = [];
      const triUVs:       number[] = [];

      for (let i = 0; i < idxCount - 2; i++) {
        const i0 = strip.indices[i];
        const i1 = strip.indices[i + 1];
        const i2 = strip.indices[i + 2];
        if (i0 === i1 || i1 === i2 || i0 === i2) continue;
        if (i0 >= vCount || i1 >= vCount || i2 >= vCount) continue;

        const a = i % 2 === 0 ? i0 : i1;
        const b = i % 2 === 0 ? i1 : i0;
        const c = i2;

        for (const vi of [a, b, c]) {
          const base = vi * m.stride;
          triPositions.push(m.vertices[base], m.vertices[base + 1], m.vertices[base + 2]);
          if (m.hasNormal) {
            triNormals.push(m.vertices[base + 3], m.vertices[base + 4], m.vertices[base + 5]);
          }
          if (m.hasUV) {
            const uvOff = 3 + (m.hasNormal ? 3 : 0);
            // CompressedTexture has flipY=false: DirectX UV convention (V=0=top) matches
            // WebGL upload-row-0-at-bottom convention directly — no V flip needed.
            triUVs.push(m.vertices[base + uvOff], m.vertices[base + uvOff + 1]);
          }
        }
      }

      if (triPositions.length === 0) continue;

      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(triPositions), 3));
      if (m.hasNormal && triNormals.length > 0) {
        geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(triNormals), 3));
      } else {
        geo.computeVertexNormals();
      }
      if (m.hasUV && triUVs.length > 0) {
        geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(triUVs), 2));
      }

      // Resolve texture — animated meshes always get a unique clone so their
      // offset/map can be mutated independently per frame without aliasing.
      let tex: THREE.CompressedTexture | null = null;
      const base = strip.textureId >= 0 ? (textures[strip.textureId] ?? null) : null;
      if (base) {
        if (isAnimated) {
          tex = base.clone();
          // Slide-animated textures must use RepeatWrapping. The UV offset grows
          // monotonically beyond [0,1]; ClampToEdge would stretch edge pixels into
          // a visible "trail" as the offset exits the unit range.
          tex.wrapS       = m.slideId !== -1 ? THREE.RepeatWrapping : d3dWrapToThree(strip.wrapU);
          tex.wrapT       = m.slideId !== -1 ? THREE.RepeatWrapping : d3dWrapToThree(strip.wrapV);
          tex.needsUpdate = true;
        } else {
          const cacheKey = `${strip.textureId}:${strip.wrapU}:${strip.wrapV}`;
          let cached = texCache.get(cacheKey);
          if (!cached) {
            cached = base.clone();
            cached.wrapS      = d3dWrapToThree(strip.wrapU);
            cached.wrapT      = d3dWrapToThree(strip.wrapV);
            cached.needsUpdate = true;
            texCache.set(cacheKey, cached);
          }
          tex = cached;
        }
      }

      // Does this texture use DXT1 1-bit punch-through alpha?
      // Only DXT1+hasAlpha uses actual 1-bit alpha blocks — safe for alphaTest.
      // DXT3 GroupeA textures: Delphi never enables alphaTest for GroupeA, so
      // their alpha blocks must be treated as opaque regardless of pixFmt.
      const srcXvr        = strip.textureId >= 0 ? (xvmSrc[strip.textureId] ?? null) : null;
      const punchThrough  = !strip.alpha && (srcXvr?.isDXT1 === true) && (srcXvr?.hasAlpha === true);

      // GroupeB: detect additive blend (stored dst=1 → D3DBLEND_ONE).
      // Delphi: (src=2,dst=1) → D3D (SRCCOLOR, ONE) for glows/halos.
      const isAdditive = strip.alpha && strip.blendDst === 1;

      // Does the texture carry its own per-texel alpha data?
      // DXT3 always has a 4-bit alpha block. DXT1+hasAlpha has a 1-bit alpha block.
      // DXT1 opaque has NO alpha data — the GPU reads alpha=1 for every texel.
      const texHasPerTexelAlpha = srcXvr !== null && (srcXvr.isDXT1 ? srcXvr.hasAlpha : true);

      // GroupeB opacity strategy:
      //   - Additive: opacity irrelevant (no dest factor), keep 1.0
      //   - Has per-texel alpha (DXT3/DXT1+alpha): CustomBlending, opacity=1.0 — texture drives alpha
      //   - No per-texel alpha (DXT1 opaque, no tex): NormalBlending, opacity=0.5 — water/glass fallback
      const useCustomBlend = strip.alpha && !isAdditive && texHasPerTexelAlpha;
      const groupeBOpacity  = isAdditive || texHasPerTexelAlpha ? 1.0 : 0.5;

      const mat = new THREE.MeshLambertMaterial({
        ...(useCustomBlend && { blendSrc: d3dBlendToThree(strip.blendSrc), blendDst: d3dBlendToThree(strip.blendDst) }),
        map:         tex,
        color:       tex ? 0xffffff : (strip.alpha ? 0x88aacc : 0x9aacbb),
        side:        THREE.DoubleSide,
        transparent: strip.alpha,
        alphaTest:   punchThrough ? 0.5 : 0,
        opacity:     strip.alpha ? groupeBOpacity : 1.0,
        depthWrite:  !strip.alpha,
        blending:    isAdditive    ? THREE.AdditiveBlending :
                     useCustomBlend ? THREE.CustomBlending   : THREE.NormalBlending,
      });

      if (isAnimated) {
        animTargets.push({ slideId: m.slideId, swapId: m.swapId, material: mat, wrapU: strip.wrapU, wrapV: strip.wrapV, slideOffX: 0, slideOffY: 0 });
      }

      contentParent.add(new THREE.Mesh(geo, mat));
    }
  }

  return { group, animTargets, motionGroups };
}

// ─── Monster / object marker builder ─────────────────────────────────────────

// PSO stores directions as BAM (Binary Angle Measure): 0x10000 = 2π
const BAM_TO_RAD = (Math.PI * 2) / 0x10000;

// Shared geometry templates (created once, never mutated)
const _bodyCylGeo   = new THREE.CylinderGeometry(2.5, 2.5, 4, 10);
const _noseConeGeo  = new THREE.ConeGeometry(1.2, 4, 8);
const _baseBoxGeo   = new THREE.BoxGeometry(4, 1.5, 4);
const _poleGeo      = new THREE.CylinderGeometry(0.3, 0.3, 4.5, 6);
const _diamondGeo   = new THREE.OctahedronGeometry(1.4);

const MONSTER_COLOR  = 0xff3333;
const MONSTER_SEL    = 0xffcc00;
const OBJECT_COLOR   = 0x3388ff;
const OBJECT_SEL     = 0x00ffcc;

export interface MarkerPickable {
  meshes:       THREE.Mesh[];
  type:         'monster' | 'object';
  index:        number;
  mats:         THREE.MeshBasicMaterial[];
  defaultColor: number;
  selectedColor: number;
  label:        THREE.Sprite;        // for disposal
}

/** Billboard sprite with an index label drawn on a canvas. */
function makeLabel(text: string): THREE.Sprite {
  const canvas  = document.createElement('canvas');
  canvas.width  = 96;
  canvas.height = 48;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = 'rgba(0,0,0,0.65)';
  ctx.fillRect(4, 4, 88, 40);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 22px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 48, 24);
  const tex = new THREE.CanvasTexture(canvas);
  const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(6, 3, 1);
  return sprite;
}

function buildEntityMarkers(
  floor: { monsters: Array<{posX:number;posY:number;posZ:number;mapSection:number;direction:number;skin:number}>;
           objects:  Array<{posX:number;posY:number;posZ:number;mapSection:number;objId:number}> } | null,
  sections: ReturnType<typeof parseNRel>,
): { group: THREE.Group; pickables: MarkerPickable[] } {
  const group     = new THREE.Group();
  const pickables: MarkerPickable[] = [];
  if (!floor) return { group, pickables };

  for (let i = 0; i < floor.monsters.length; i++) {
    const m = floor.monsters[i];
    const [wx, wz] = toWorldPos(m.posX, m.posY, m.mapSection, sections);

    const bodyMat = new THREE.MeshBasicMaterial({ color: MONSTER_COLOR });
    const noseMat = new THREE.MeshBasicMaterial({ color: 0xff8800 });

    const body = new THREE.Mesh(_bodyCylGeo, bodyMat);
    body.position.set(0, 2, 0);

    // Nose cone: tip points in local +Y of the cone, so we rotate -90° on X to point along -Z
    const nose = new THREE.Mesh(_noseConeGeo, noseMat);
    nose.rotation.x = -Math.PI / 2;
    nose.position.set(0, 2, -4.5);

    const label = makeLabel(`M${i}`);
    label.position.set(0, 8, 0);

    const markerGroup = new THREE.Group();
    markerGroup.add(body, nose, label);
    // BAM direction → Y rotation. PSO monsters face -Z by default (same as Three.js camera).
    markerGroup.rotation.y = m.direction * BAM_TO_RAD;
    markerGroup.position.set(wx, m.posZ, wz);
    group.add(markerGroup);

    pickables.push({
      meshes: [body, nose],
      type: 'monster',
      index: i,
      mats: [bodyMat, noseMat],
      defaultColor: MONSTER_COLOR,
      selectedColor: MONSTER_SEL,
      label,
    });
  }

  for (let i = 0; i < floor.objects.length; i++) {
    const o = floor.objects[i];
    const [wx, wz] = toWorldPos(o.posX, o.posY, o.mapSection, sections);

    const baseMat    = new THREE.MeshBasicMaterial({ color: OBJECT_COLOR });
    const poleMat    = new THREE.MeshBasicMaterial({ color: OBJECT_COLOR });
    const diamondMat = new THREE.MeshBasicMaterial({ color: 0x66aaff });

    const base    = new THREE.Mesh(_baseBoxGeo,  baseMat);
    base.position.set(0, 0.75, 0);
    const pole    = new THREE.Mesh(_poleGeo, poleMat);
    pole.position.set(0, 4, 0);
    const diamond = new THREE.Mesh(_diamondGeo, diamondMat);
    diamond.position.set(0, 7.5, 0);

    const label = makeLabel(`O${i}`);
    label.position.set(0, 10.5, 0);

    const markerGroup = new THREE.Group();
    markerGroup.add(base, pole, diamond, label);
    markerGroup.position.set(wx, o.posZ, wz);
    group.add(markerGroup);

    pickables.push({
      meshes: [base, pole, diamond],
      type: 'object',
      index: i,
      mats: [baseMat, poleMat, diamondMat],
      defaultColor: OBJECT_COLOR,
      selectedColor: OBJECT_SEL,
      label,
    });
  }

  return { group, pickables };
}

// ─── Collision wireframe builder (c.rel) ─────────────────────────────────────

function buildCollisionMesh(buf: Uint8Array): THREE.LineSegments {
  const triangles = parseCRel(buf);
  const positions: number[] = [];

  for (const t of triangles) {
    // 3 edges per triangle as line segments
    positions.push(t.x0, t.y0, t.z0, t.x1, t.y1, t.z1);
    positions.push(t.x1, t.y1, t.z1, t.x2, t.y2, t.z2);
    positions.push(t.x2, t.y2, t.z2, t.x0, t.y0, t.z0);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  return new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0x00ff88, opacity: 0.35, transparent: true }));
}

// ─── Component ───────────────────────────────────────────────────────────────

export function Viewer3D() {
  const mountRef      = useRef<HTMLDivElement>(null);
  const sceneRef      = useRef<THREE.Scene | null>(null);
  const visualRef     = useRef<THREE.Group | null>(null);
  const collisionRef  = useRef<THREE.LineSegments | null>(null);
  const markersRef    = useRef<THREE.Group | null>(null);
  const skyRef        = useRef<THREE.Mesh | null>(null);
  const texturesRef     = useRef<(THREE.CompressedTexture | null)[]>([]);
  const tamRef          = useRef<TamData | null>(null);
  const animTargetsRef  = useRef<AnimTarget[]>([]);
  const swapTexCacheRef = useRef<Map<string, THREE.CompressedTexture>>(new Map());
  const startTimeRef    = useRef<number>(0);
  const lockedRef           = useRef(false);
  const cameraRef           = useRef<THREE.PerspectiveCamera | null>(null);
  const mouseNDCRef         = useRef(new THREE.Vector2(0, 0));
  const markerPickablesRef  = useRef<MarkerPickable[]>([]);
  const selectedEntityRef   = useRef<{ type: 'monster' | 'object'; index: number } | null>(null);
  const animPausedRef       = useRef(false);
  const pauseAccRef         = useRef(0);   // total ms spent paused
  const pauseStartRef       = useRef(0);   // when the current pause started
  const motionGroupsRef     = useRef<Array<{ group: THREE.Group; motion: NRelMotion }>>([]);
  const worldAxesRef        = useRef<THREE.AxesHelper | null>(null);
  const motionAxesRef       = useRef<THREE.AxesHelper[]>([]);
  const rendererRef         = useRef<THREE.WebGLRenderer | null>(null);
  const xrRigRef            = useRef<THREE.Group | null>(null);

  const [locked,        setLocked]        = useState(false);
  const [status,        setStatus]        = useState<string | null>(null);
  const [showCollision, setShowCollision] = useState(false);
  const [showAxes,      setShowAxes]      = useState(false);
  const [animPaused,    setAnimPaused]    = useState(false);
  const [selectedEntity, setSelectedEntity] = useState<{ type: 'monster' | 'object'; index: number } | null>(null);
  const [vrSupported,   setVrSupported]   = useState(false);
  const [inVR,          setInVR]          = useState(false);

  const { mapDir, previewVariantByArea } = useUiStore();
  const { quest, selectedFloorId } = useQuestStore();
  const floor = useSelectedFloor();

  // ── Three.js scene (created once) ──────────────────────────────────────────
  useEffect(() => {
    const el = mountRef.current;
    if (!el) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0d0d10);
    // scene.fog = new THREE.FogExp2(0x0d0d10, 0.0008); // disabled — PSO fog is per-area, not global
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(75, el.clientWidth / el.clientHeight, 0.5, 15000);
    cameraRef.current = camera;
    camera.position.set(0, 15, 80);
    let yaw = 0, pitch = 0;

    // XR rig: camera is a child so moving the rig teleports/walks the player in VR.
    // In non-XR mode the rig stays at origin and keyboard moves the camera directly.
    const xrRig = new THREE.Group();
    xrRig.add(camera);
    scene.add(xrRig);
    xrRigRef.current = xrRig;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(el.clientWidth, el.clientHeight);
    renderer.xr.enabled = true;
    rendererRef.current = renderer;
    el.appendChild(renderer.domElement);

    // Detect WebXR VR support (async, result updates state after mount)
    navigator.xr?.isSessionSupported('immersive-vr').then(ok => setVrSupported(ok)).catch(() => {});

    scene.add(new THREE.GridHelper(2000, 100, 0x222233, 0x1a1a28));

    // World-space reference frame (X=red Y=green Z=blue, 200 units long).
    const worldAxes = new THREE.AxesHelper(200);
    worldAxes.visible = false;
    scene.add(worldAxes);
    worldAxesRef.current = worldAxes;

    scene.add(new THREE.AmbientLight(0xffffff, 0.5));
    const sun = new THREE.DirectionalLight(0xffffff, 0.8);
    sun.position.set(100, 200, 100);
    scene.add(sun);

    const canvas = renderer.domElement;

    // Mouse-look: pointer lock when available (Windows), right-click drag as fallback (macOS/WKWebView).
    let dragging = false;
    let lastX = 0, lastY = 0;
    let clickStartX = 0, clickStartY = 0;

    /** Select/deselect an entity marker, updating color and state. */
    const selectEntity = (type: 'monster' | 'object', index: number) => {
      // Deselect previous
      const prev = selectedEntityRef.current;
      if (prev) {
        const p = markerPickablesRef.current.find(x => x.type === prev.type && x.index === prev.index);
        if (p) for (const mat of p.mats) mat.color.setHex(p.defaultColor);
      }
      if (prev?.type === type && prev?.index === index) {
        // Same entity — toggle off
        selectedEntityRef.current = null;
        setSelectedEntity(null);
        return;
      }
      const next = markerPickablesRef.current.find(x => x.type === type && x.index === index);
      if (next) {
        for (const mat of next.mats) mat.color.setHex(next.selectedColor);
        selectedEntityRef.current = { type, index };
        setSelectedEntity({ type, index });
      }
    };

    const tryPickEntity = () => {
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(mouseNDCRef.current, camera);
      const allMeshes = markerPickablesRef.current.flatMap(p => p.meshes);
      const hits = raycaster.intersectObjects(allMeshes, false);
      if (hits.length > 0) {
        const hit = hits[0].object as THREE.Mesh;
        const pickable = markerPickablesRef.current.find(p => p.meshes.includes(hit));
        if (pickable) { selectEntity(pickable.type, pickable.index); return; }
      }
      // Clicked empty space — deselect
      const prev = selectedEntityRef.current;
      if (prev) {
        const p = markerPickablesRef.current.find(x => x.type === prev.type && x.index === prev.index);
        if (p) for (const mat of p.mats) mat.color.setHex(p.defaultColor);
        selectedEntityRef.current = null;
        setSelectedEntity(null);
      }
    };

    // Pointer lock state
    const onLockChange = () => {
      const isLocked = document.pointerLockElement != null;
      lockedRef.current = isLocked;
      setLocked(isLocked);
    };
    document.addEventListener('pointerlockchange', onLockChange);

    const tryPointerLock = () => {
      const p = (el as HTMLElement & { requestPointerLock(o?: object): Promise<void> | void })
        .requestPointerLock({ unadjustedMovement: true });
      if (p instanceof Promise) p.catch(() => {
        const p2 = el.requestPointerLock();
        if (p2 instanceof Promise) p2.catch(() => { /* not supported, use drag */ });
      });
    };

    const onMouseDown = (e: MouseEvent) => {
      if (e.button === 0) { clickStartX = e.clientX; clickStartY = e.clientY; }
      if (e.button === 2) {
        dragging = true;
        lastX = e.clientX;
        lastY = e.clientY;
        // Also try pointer lock on right-click — works on Windows, silently fails on macOS
        if (!lockedRef.current) tryPointerLock();
      }
    };
    const onMouseUp = (e: MouseEvent) => {
      if (e.button === 2) dragging = false;
      if (e.button === 0 && !lockedRef.current) {
        const dx = e.clientX - clickStartX, dy = e.clientY - clickStartY;
        if (Math.hypot(dx, dy) < 5) tryPickEntity();
      }
    };
    const onMouseMove = (e: MouseEvent) => {
      const rect = el.getBoundingClientRect();
      mouseNDCRef.current.x =  ((e.clientX - rect.left) / rect.width)  * 2 - 1;
      mouseNDCRef.current.y = -((e.clientY - rect.top)  / rect.height) * 2 + 1;
      let dx: number, dy: number;
      if (lockedRef.current) {
        // Pointer lock active — use raw movement (no cursor position drift)
        dx = e.movementX;
        dy = e.movementY;
      } else if (dragging) {
        // Fallback: right-click drag
        dx = e.clientX - lastX;
        dy = e.clientY - lastY;
        lastX = e.clientX;
        lastY = e.clientY;
      } else {
        return;
      }
      yaw   -= dx * MOUSE_SENS;
      pitch -= dy * MOUSE_SENS;
      pitch  = Math.max(-HALF_PI, Math.min(HALF_PI, pitch));
      camera.rotation.order = 'YXZ';
      camera.rotation.y = yaw;
      camera.rotation.x = pitch;
    };
    const onContextMenu = (e: MouseEvent) => e.preventDefault();

    el.addEventListener('mousedown',   onMouseDown);
    el.addEventListener('contextmenu', onContextMenu);
    document.addEventListener('mouseup',   onMouseUp);
    document.addEventListener('mousemove', onMouseMove);

    // Hint visibility: show when mouse is outside viewport
    const onFocus = () => setLocked(true);
    const onBlur  = () => { if (!lockedRef.current) setLocked(false); };
    el.addEventListener('mouseenter', onFocus);
    el.addEventListener('mouseleave', onBlur);

    const keys: Record<string, boolean> = {};
    const onKeyDown = (e: KeyboardEvent) => { keys[e.code] = true;  if (e.code === 'Space') e.preventDefault(); };
    const onKeyUp   = (e: KeyboardEvent) => { keys[e.code] = false; };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup',   onKeyUp);

    const onResize = () => {
      camera.aspect = el.clientWidth / el.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(el.clientWidth, el.clientHeight);
    };
    const obs = new ResizeObserver(onResize);
    obs.observe(el);

    let prev = performance.now();
    const fwd = new THREE.Vector3(), right = new THREE.Vector3();

    const animate = (now: number) => {
      const dt  = Math.min((now - prev) / 1000, 0.1);
      prev = now;

      const dist = SPEED * dt;
      fwd.set(Math.sin(yaw), 0, Math.cos(yaw));
      right.set(Math.cos(yaw), 0, -Math.sin(yaw));

      if (keys['KeyW'] || keys['ArrowUp'])           camera.position.addScaledVector(fwd,  -dist);
      if (keys['KeyE'])                              camera.position.addScaledVector(fwd,  -dist*3);
      if (keys['KeyS'] || keys['ArrowDown'])         camera.position.addScaledVector(fwd,   dist);
      if (keys['KeyA'] || keys['ArrowLeft'])         camera.position.addScaledVector(right, -dist);
      if (keys['KeyD'] || keys['ArrowRight'])        camera.position.addScaledVector(right,  dist);
      if (keys['Space'])                             camera.position.y += dist;
      if (keys['ShiftLeft'] || keys['ShiftRight'])   camera.position.y -= dist;

      // VR locomotion: left thumbstick moves, right thumbstick turns.
      // We move the xrRig (the camera's parent) so headset tracking is preserved.
      if (renderer.xr.isPresenting) {
        const session = renderer.xr.getSession();
        if (session) {
          const xrCam = renderer.xr.getCamera();
          const vrFwd = new THREE.Vector3();
          xrCam.getWorldDirection(vrFwd);
          vrFwd.y = 0;
          vrFwd.normalize();
          const vrRight = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), vrFwd).normalize();
          for (const src of session.inputSources) {
            const gp = src.gamepad;
            if (!gp) continue;
            const ax = gp.axes;
            if (src.handedness === 'left') {
              // axes[2]=thumbstick X (strafe), axes[3]=thumbstick Y (fwd: negative=push forward)
              const sx = ax[2] ?? 0, sy = ax[3] ?? 0;
              if (Math.abs(sx) > 0.12) xrRig.position.addScaledVector(vrRight, -sx * dist);
              if (Math.abs(sy) > 0.12) xrRig.position.addScaledVector(vrFwd,   -sy * dist);
              // Up/down: grip button (button[1]) held = fly up, menu button (button[2]) = fly down
              if (gp.buttons[1]?.pressed) xrRig.position.y += dist;
            }
            if (src.handedness === 'right') {
              // Right thumbstick X: smooth yaw rotation of the rig
              const rx = ax[2] ?? 0;
              if (Math.abs(rx) > 0.12) xrRig.rotateY(-rx * dt * 1.5);
            }
          }
        }
      }

      // Sky dome tracks the camera world position so it always surrounds the viewer
      if (skyRef.current) {
        const camWorld = new THREE.Vector3();
        camera.getWorldPosition(camWorld);
        skyRef.current.position.copy(camWorld);
      }

      // Texture animations: slide (UV scroll) and swap (cycling texture)
      // Subtract accumulated pause time so the animation stays frozen while paused.
      const elapsed = animPausedRef.current
        ? pauseStartRef.current - startTimeRef.current - pauseAccRef.current
        : now - startTimeRef.current - pauseAccRef.current;
      const tamData = tamRef.current;
      if (tamData) {
        // Build O(1) lookup maps once per frame (avoids .find() per target)
        const slideMap = tamData.slides.reduce((m, s) => { m.set(s.id, s); return m; }, new Map<number, typeof tamData.slides[0]>());
        const swapMap  = tamData.swaps.reduce( (m, s) => { m.set(s.id, s); return m; }, new Map<number, typeof tamData.swaps[0]>());

        for (const target of animTargetsRef.current) {
          // SWAP first — determines which texture is current this frame.
          // Slide must run AFTER so it writes the offset to the currently active map.
          // Running slide first caused a 1-frame hiccup every time swap changed texture:
          // slide wrote offset to the old map, then swap replaced it with a fresh one (offset=0).
          if (target.swapId !== -1) {
            const swap = swapMap.get(target.swapId);
            if (swap && swap.maxFrame > 0) {
              const tick = Math.floor(elapsed / 60) % swap.maxFrame;
              let acc = 0, newId = -1;
              for (const entry of swap.entries) {
                acc += entry.frame;
                if (tick < acc) { newId = entry.newId; break; }
              }
              if (newId >= 0 && texturesRef.current[newId]) {
                const cacheKey = `${newId}:${target.wrapU}:${target.wrapV}`;
                let swapTex = swapTexCacheRef.current.get(cacheKey);
                if (!swapTex) {
                  swapTex = texturesRef.current[newId]!.clone();
                  swapTex.wrapS       = d3dWrapToThree(target.wrapU);
                  swapTex.wrapT       = d3dWrapToThree(target.wrapV);
                  swapTex.needsUpdate = true;
                  swapTexCacheRef.current.set(cacheKey, swapTex);
                }
                if (target.material.map !== swapTex) {
                  target.material.map = swapTex;
                  target.material.needsUpdate = true;
                }
              }
            }
          }
          // SLIDE after swap — always writes to whatever map is active now.
          if (target.slideId !== -1 && !animPausedRef.current) {
            const slide = slideMap.get(target.slideId);
            if (slide && target.material.map) {
              const stepX = slide.tu * dt / 6;
              const stepY = slide.tv * dt / 6;
              target.slideOffX = (target.slideOffX + stepX) % 1;
              target.slideOffY = (target.slideOffY + stepY) % 1;
              target.material.map.offset.x = target.slideOffX;
              target.material.map.offset.y = target.slideOffY;
            }
          }
        }
      }

      // Geometry animation: apply animated root-node transform each frame
      for (const { group: mg, motion } of motionGroupsRef.current) {
        if (motion.durationMs <= 0) continue;
        const f   = Math.floor((elapsed % motion.durationMs) / 33);
        const pos = sampleGeomTrack(    motion.posKeys, motion.defaultPos,   f);
        const rot = sampleGeomAnglTrack(motion.angKeys, motion.defaultRot,   f);
        const sca = sampleGeomTrack(    motion.scaKeys, motion.defaultScale, f);
        mg.position.set(pos[0], pos[1], pos[2]);
        mg.rotation.x = (rot[0] & 0xFFFF) * BAM_TO_RAD;
        mg.rotation.y = (rot[1] & 0xFFFF) * BAM_TO_RAD;
        mg.rotation.z = (rot[2] & 0xFFFF) * BAM_TO_RAD;
        mg.scale.set(sca[0], sca[1], sca[2]);
      }

      renderer.render(scene, camera);
    };
    renderer.setAnimationLoop(animate);

    return () => {
      renderer.setAnimationLoop(null);
      rendererRef.current = null;
      xrRigRef.current    = null;
      obs.disconnect();
      document.removeEventListener('pointerlockchange', onLockChange);
      el.removeEventListener('mousedown',   onMouseDown);
      el.removeEventListener('contextmenu', onContextMenu);
      el.removeEventListener('mouseenter',  onFocus);
      el.removeEventListener('mouseleave',  onBlur);
      document.removeEventListener('mouseup',   onMouseUp);
      document.removeEventListener('mousemove', onMouseMove);
      if (document.pointerLockElement != null) document.exitPointerLock();
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup',   onKeyUp);
      renderer.dispose();
      sceneRef.current = null;
      if (el.contains(canvas)) el.removeChild(canvas);
    };
  }, []);

  // ── Sync collision overlay visibility ─────────────────────────────────────
  useEffect(() => {
    if (collisionRef.current) collisionRef.current.visible = showCollision;
  }, [showCollision]);

  // ── Sync axes helpers visibility ───────────────────────────────────────────
  useEffect(() => {
    if (worldAxesRef.current) worldAxesRef.current.visible = showAxes;
    for (const ax of motionAxesRef.current) {
      ax.visible = showAxes;
      const sp = ax.userData.sprite as THREE.Sprite | undefined;
      if (sp) sp.visible = showAxes;
    }
  }, [showAxes]);

  // ── Mesh + texture + marker loading ──────────────────────────────────────
  useEffect(() => {
    const scene = sceneRef.current;

    // Dispose previous objects
    if (visualRef.current)    { scene?.remove(visualRef.current);    visualRef.current.traverse(o => { if ((o as THREE.Mesh).isMesh) { (o as THREE.Mesh).geometry.dispose(); ((o as THREE.Mesh).material as THREE.Material).dispose(); } }); visualRef.current = null; }
    if (collisionRef.current) { scene?.remove(collisionRef.current); collisionRef.current.geometry.dispose(); (collisionRef.current.material as THREE.Material).dispose(); collisionRef.current = null; }
    if (markersRef.current) {
      scene?.remove(markersRef.current);
      markersRef.current.traverse(o => {
        if ((o as THREE.Mesh).isMesh)   { (o as THREE.Mesh).geometry.dispose(); ((o as THREE.Mesh).material as THREE.Material).dispose(); }
        if ((o as THREE.Sprite).isSprite) { ((o as THREE.Sprite).material as THREE.SpriteMaterial).map?.dispose(); (o as THREE.Sprite).material.dispose(); }
      });
      markersRef.current = null;
    }
    markerPickablesRef.current = [];
    selectedEntityRef.current  = null;
    setSelectedEntity(null);
    if (skyRef.current)       { scene?.remove(skyRef.current);       skyRef.current.geometry.dispose(); (skyRef.current.material as THREE.Material).dispose(); skyRef.current = null; }
    for (const t of texturesRef.current) t?.dispose();
    texturesRef.current = [];
    for (const t of swapTexCacheRef.current.values()) t.dispose();
    swapTexCacheRef.current.clear();
    tamRef.current = null;
    animTargetsRef.current = [];
    motionGroupsRef.current = [];
    motionAxesRef.current = [];

    if (selectedFloorId === null || !mapDir || !scene) return;

    const area = AREA_BY_ID[selectedFloorId];
    if (!area) return;

    const previewIdx   = previewVariantByArea[selectedFloorId];
    const committedIdx = quest?.variantByArea[selectedFloorId];
    const variantIdx   = previewIdx ?? committedIdx ?? 0;
    const variant = area.variants[variantIdx] ?? area.variants[0];
    if (!variant) return;
    const cFile   = variant.file;
    const xvmFile = variant.xvm;

    // *n.rel = visual mesh, *c.rel = collision, *.xvm = textures
    const nFile   = toNRelName(cFile);
    const sep     = mapDir.includes('/') ? '/' : '\\';
    const cPath   = `${mapDir}${sep}${cFile}`;
    const nPath   = `${mapDir}${sep}${nFile}`;
    const xPath   = `${mapDir}${sep}xvm${sep}${xvmFile}`;

    let cancelled = false;
    setStatus('Loading…');

    // Sky dome — large hemisphere textured with the area's sky PNG.
    // The mesh follows the camera every frame (handled in the render loop below).
    // PNG lives in map/xvm/ alongside the XVM files.
    if (area.sky) {
      const skyPath = `${mapDir}${sep}xvm${sep}${area.sky}`;
      // Convert file path to a data URL via Tauri readFile, then use TextureLoader.
      readFile(skyPath).then(buf => {
        if (cancelled || !sceneRef.current) return;
        const blob = new Blob([buf], { type: 'image/png' });
        const url  = URL.createObjectURL(blob);
        new THREE.TextureLoader().load(url, tex => {
          URL.revokeObjectURL(url);
          if (cancelled || !sceneRef.current) { tex.dispose(); return; }
          tex.colorSpace = THREE.SRGBColorSpace;
          // Full sphere so all viewing directions are covered.
          const geo = new THREE.SphereGeometry(4000, 32, 16);
          const mat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, depthWrite: false });
          const mesh = new THREE.Mesh(geo, mat);
          mesh.renderOrder = -1; // render before everything else
          sceneRef.current.add(mesh);
          skyRef.current = mesh;
        });
      }).catch(() => { /* sky is optional */ });
    }

    // XVM and TAM may not exist — load both optionally
    const xvmPromise = readFile(xPath).catch(() => null);
    const tamPath    = nPath.replace(/n\.rel$/i, '.tam');
    const tamPromise = readFile(tamPath).catch(() => null);

    Promise.all([readFile(nPath), readFile(cPath), xvmPromise, tamPromise])
      .then(([nBuf, cBuf, xBuf, tamBuf]) => {
        if (cancelled) return;

        // Build textures
        const xvmTextures = xBuf ? parseXvm(new Uint8Array(xBuf)) : [];
        const threeTextures = xvmTextures.map(x => x ? buildThreeTexture(x) : null);

        // Build meshes
        const nMeshes  = parseNRelMeshes(new Uint8Array(nBuf));
        const { group, animTargets, motionGroups } = buildVisualMeshes(nMeshes, threeTextures, xvmTextures);
        const cLines   = buildCollisionMesh(new Uint8Array(cBuf));
        cLines.visible = showCollision;

        // Parse TAM animation data (optional)
        const tamData = tamBuf ? parseTam(new Uint8Array(tamBuf)) : null;

        // Build markers from n.rel sections + floor data
        const sections = parseNRel(new Uint8Array(nBuf));
        const { group: markers, pickables } = buildEntityMarkers(floor, sections);

        if (cancelled) {
          group.traverse(o => { if ((o as THREE.Mesh).isMesh) { (o as THREE.Mesh).geometry.dispose(); ((o as THREE.Mesh).material as THREE.Material).dispose(); } });
          cLines.geometry.dispose();
          for (const t of threeTextures) t?.dispose();
          return;
        }

        const s = sceneRef.current;
        if (!s) return;
        s.add(group);
        s.add(cLines);
        s.add(markers);
        visualRef.current    = group;
        collisionRef.current = cLines;
        markersRef.current       = markers;
        markerPickablesRef.current = pickables;
        texturesRef.current  = threeTextures;
        tamRef.current         = tamData;
        animTargetsRef.current  = animTargets;
        motionGroupsRef.current = motionGroups;

        // Attach per-object axes helpers + numbered labels (shown/hidden with showAxes).
        const mAxes: THREE.AxesHelper[] = [];
        motionGroups.forEach(({ group: mg, motion }, idx) => {
          const ax = new THREE.AxesHelper(50);
          ax.visible = showAxes;
          mg.add(ax);
          mAxes.push(ax);

          // Floating label sprite so the user can cross-reference visual ↔ console log.
          const cvs = document.createElement('canvas');
          cvs.width = 128; cvs.height = 64;
          const ctx = cvs.getContext('2d')!;
          ctx.fillStyle = 'rgba(0,0,0,0.65)';
          ctx.fillRect(0, 0, 128, 64);
          ctx.fillStyle = '#ffff00';
          ctx.font = 'bold 20px monospace';
          ctx.textAlign = 'center';
          ctx.fillText(`#${idx}`, 64, 26);
          ctx.font = '11px monospace';
          ctx.fillStyle = '#aaffaa';
          ctx.fillText(`f=${motion.totalFrames}`, 64, 48);
          const tex = new THREE.CanvasTexture(cvs);
          const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false });
          const sprite = new THREE.Sprite(mat);
          sprite.scale.set(40, 20, 1);
          sprite.position.set(0, 60, 0);   // float above the object
          sprite.visible = showAxes;
          mg.add(sprite);
          ax.userData.sprite = sprite;

          // Also log the index → anioff mapping once.
          console.log(`[motionGroup #${idx}] angKeys=${motion.angKeys.length} posKeys=${motion.posKeys.length} totalFrames=${motion.totalFrames}`);
        });
        motionAxesRef.current = mAxes;

        swapTexCacheRef.current.clear();
        startTimeRef.current   = performance.now();
        setStatus(nMeshes.length === 0 ? 'No visual mesh — showing collision only' : null);
        if (nMeshes.length === 0 && !showCollision) cLines.visible = true;
      })
      .catch(e => { if (!cancelled) setStatus(`Could not load: ${e}`); });

    return () => { cancelled = true; };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedFloorId, mapDir, previewVariantByArea, quest, floor]);

  return (
    <div className={css.wrap}>
      <div ref={mountRef} className={css.viewport} />
      <div className={`${css.hint} ${locked ? css.hintHidden : ''}`}>
        Right-click drag to look · WASD move · Space/Shift up/down
      </div>
      {status && <div className={css.overlay}><span>{status}</span></div>}
      {selectedEntity && (
        <div className={css.selectionInfo}>
          {selectedEntity.type === 'monster' ? '▲' : '■'}
          {' '}
          {selectedEntity.type === 'monster' ? 'Monster' : 'Object'} #{selectedEntity.index}
          {selectedEntity.type === 'monster' && floor && (
            <> · skin {floor.monsters[selectedEntity.index]?.skin}</>
          )}
          {selectedEntity.type === 'object' && floor && (
            <> · id {floor.objects[selectedEntity.index]?.objId}</>
          )}
        </div>
      )}
      <div className={css.toolbar}>
        <button
          className={`${css.toolBtn} ${showAxes ? css.toolBtnActive : ''}`}
          title="Toggle axes helpers (world + per animated object)"
          onClick={() => setShowAxes(v => !v)}
        >
          ✛
        </button>
        <button
          className={`${css.toolBtn} ${showCollision ? css.toolBtnActive : ''}`}
          title="Toggle collision wireframe"
          onClick={() => setShowCollision(v => !v)}
        >
          ⬡
        </button>
        <button
          className={`${css.toolBtn} ${animPaused ? css.toolBtnActive : ''}`}
          title={animPaused ? 'Resume texture animations' : 'Pause texture animations'}
          onClick={() => {
            const now = performance.now();
            if (!animPausedRef.current) {
              animPausedRef.current  = true;
              pauseStartRef.current  = now;
            } else {
              pauseAccRef.current   += now - pauseStartRef.current;
              animPausedRef.current  = false;
            }
            setAnimPaused(v => !v);
          }}
        >
          {animPaused ? '▶' : '⏸'}
        </button>
        {vrSupported && (
          <button
            className={`${css.toolBtn} ${inVR ? css.toolBtnActive : ''}`}
            title={inVR ? 'Exit VR' : 'Enter VR'}
            onClick={async () => {
              const renderer = rendererRef.current;
              if (!renderer || !navigator.xr) return;
              if (inVR) {
                await renderer.xr.getSession()?.end();
              } else {
                const session = await navigator.xr.requestSession('immersive-vr', {
                  optionalFeatures: ['local-floor', 'bounded-floor'],
                });
                session.addEventListener('end', () => setInVR(false));
                await renderer.xr.setSession(session as XRSession);
                setInVR(true);
              }
            }}
          >
            VR
          </button>
        )}
      </div>
    </div>
  );
}
