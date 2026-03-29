import { useRef, useEffect, useCallback, useMemo } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

// --------------- types ---------------

export interface TerrainDataPoint {
  timestamp: number;
  energy: number;   // 0-1, drives height
  pitch: number;    // 0-1
  pace: number;     // 0-1, affects contour density in mode A
  sentiment: number; // -1 to 1 (negative → positive)
  topic?: string;    // used in mode B
}

export type TerrainMode = "multi" | "topics";

export interface ConversationTerrainProps {
  data: TerrainDataPoint[];
  mode?: TerrainMode;
  live?: boolean; // when true, new data extends terrain in real-time
  className?: string;
}

// --------------- constants ---------------

const COLORS = {
  bg: 0x0a0a0f,
  green: 0xb4e62e,
  red: 0xff3822,
  surface: 0x151520,
  grid: 0x2a2a3a,
  gridDot: 0x4a4a5a,
  gridDotMaj: 0x7a7a8a,
  axisLabel: "#5a5a6a",
  axisTitle: "#7a7a8a",
};

const TERRAIN_WIDTH = 24;
const HEIGHT_SCALE = 8;
const CONTOUR_LEVELS = 14;
const UPSAMPLE = 4;

// --------------- helpers ---------------

function sentimentToColor(s: number): THREE.Color {
  // -1 red → 0 orange → 1 green
  if (s >= 0) {
    return new THREE.Color().lerpColors(
      new THREE.Color(0xf59e0b), // orange
      new THREE.Color(COLORS.green),
      s,
    );
  }
  return new THREE.Color().lerpColors(
    new THREE.Color(COLORS.red),
    new THREE.Color(0xf59e0b),
    s + 1,
  );
}

function gaussianSmooth(src: Float32Array, w: number, h: number): Float32Array {
  let a = new Float32Array(src);
  let b = new Float32Array(w * h);
  for (let pass = 0; pass < 2; pass++) {
    // horizontal
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let s = 0, wt = 0;
        for (let dx = -2; dx <= 2; dx++) {
          const nx = Math.min(Math.max(x + dx, 0), w - 1);
          const g = Math.exp(-(dx * dx) / 2);
          s += a[y * w + nx] * g;
          wt += g;
        }
        b[y * w + x] = s / wt;
      }
    }
    [a, b] = [b, a];
    // vertical
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let s = 0, wt = 0;
        for (let dy = -2; dy <= 2; dy++) {
          const ny = Math.min(Math.max(y + dy, 0), h - 1);
          const g = Math.exp(-(dy * dy) / 2);
          s += a[ny * w + x] * g;
          wt += g;
        }
        b[y * w + x] = s / wt;
      }
    }
    [a, b] = [b, a];
  }
  return a;
}

function march(
  field: Float32Array,
  fw: number,
  fh: number,
  threshold: number,
  yVal: number,
  tw: number,
  worldD: number,
): THREE.Vector3[] {
  const pts: THREE.Vector3[] = [];
  for (let z = 0; z < fh - 1; z++) {
    for (let x = 0; x < fw - 1; x++) {
      const v00 = field[z * fw + x];
      const v10 = field[z * fw + x + 1];
      const v01 = field[(z + 1) * fw + x];
      const v11 = field[(z + 1) * fw + x + 1];
      const e: THREE.Vector3[] = [];
      if ((v00 >= threshold) !== (v10 >= threshold)) {
        const t = (threshold - v00) / (v10 - v00);
        e.push(new THREE.Vector3((x + t) / (fw - 1) * tw - tw / 2, yVal, z / (fh - 1) * worldD - worldD / 2));
      }
      if ((v01 >= threshold) !== (v11 >= threshold)) {
        const t = (threshold - v01) / (v11 - v01);
        e.push(new THREE.Vector3((x + t) / (fw - 1) * tw - tw / 2, yVal, (z + 1) / (fh - 1) * worldD - worldD / 2));
      }
      if ((v00 >= threshold) !== (v01 >= threshold)) {
        const t = (threshold - v00) / (v01 - v00);
        e.push(new THREE.Vector3(x / (fw - 1) * tw - tw / 2, yVal, (z + t) / (fh - 1) * worldD - worldD / 2));
      }
      if ((v10 >= threshold) !== (v11 >= threshold)) {
        const t = (threshold - v10) / (v11 - v10);
        e.push(new THREE.Vector3((x + 1) / (fw - 1) * tw - tw / 2, yVal, (z + t) / (fh - 1) * worldD - worldD / 2));
      }
      if (e.length >= 2) {
        pts.push(e[0], e[1]);
        if (e.length === 4) pts.push(e[2], e[3]);
      }
    }
  }
  return pts;
}

function makeSprite(text: string, color = COLORS.axisLabel, fontSize = 48): THREE.Sprite {
  const c = document.createElement("canvas");
  const ctx = c.getContext("2d")!;
  ctx.font = `300 ${fontSize}px monospace`;
  const w = ctx.measureText(text).width + 16;
  c.width = w;
  c.height = fontSize * 1.4;
  ctx.font = `300 ${fontSize}px monospace`;
  ctx.fillStyle = color;
  ctx.textBaseline = "middle";
  ctx.fillText(text, 8, c.height / 2);
  const tex = new THREE.CanvasTexture(c);
  tex.minFilter = THREE.LinearFilter;
  const sp = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false }),
  );
  sp.scale.set((w / fontSize) * 0.6, 0.6, 1);
  sp.renderOrder = 2;
  return sp;
}

// --------------- terrain builder ---------------

interface TerrainBuild {
  heightfield: Float32Array;
  sentimentField: Float32Array; // per-cell avg sentiment
  segX: number;
  segZ: number;
}

function buildHeightfield(
  data: TerrainDataPoint[],
  mode: TerrainMode,
): TerrainBuild & { worldD: number; topics?: string[] } {
  if (data.length === 0) {
    return { heightfield: new Float32Array(1), sentimentField: new Float32Array(1), segX: 1, segZ: 1, worldD: 1 };
  }

  const sorted = [...data].sort((a, b) => a.timestamp - b.timestamp);
  const tMin = sorted[0].timestamp;
  const tMax = sorted[sorted.length - 1].timestamp;
  const duration = Math.max(tMax - tMin, 1);

  if (mode === "topics") {
    // Z axis = topic clusters
    const topicSet = [...new Set(sorted.map((d) => d.topic || "general"))];
    const segX = Math.max(Math.min(sorted.length, 64), 8);
    const segZ = Math.max(topicSet.length, 1);
    const grid = new Float32Array(segZ * segX);
    const sentGrid = new Float32Array(segZ * segX);
    const counts = new Float32Array(segZ * segX);

    for (const d of sorted) {
      const xi = Math.min(Math.floor(((d.timestamp - tMin) / duration) * segX), segX - 1);
      const zi = topicSet.indexOf(d.topic || "general");
      grid[zi * segX + xi] += d.energy;
      sentGrid[zi * segX + xi] += d.sentiment;
      counts[zi * segX + xi]++;
    }
    for (let i = 0; i < grid.length; i++) {
      if (counts[i] > 0) {
        grid[i] /= counts[i];
        sentGrid[i] /= counts[i];
      }
    }

    const smoothed = gaussianSmooth(grid, segX, segZ);
    const maxVal = Math.max(smoothed.reduce((m, v) => v > m ? v : m, 0), 0.001);
    for (let i = 0; i < smoothed.length; i++) smoothed[i] /= maxVal;

    return { heightfield: smoothed, sentimentField: sentGrid, segX, segZ, worldD: segZ * (24 / Math.max(segZ, 1)), topics: topicSet };
  }

  // Mode A: multi-dimensional
  // X = time slices, Z = "depth" dimension driven by pace
  const segX = Math.max(Math.min(sorted.length, 64), 8);
  const segZ = 16; // depth resolution
  const grid = new Float32Array(segZ * segX);
  const sentGrid = new Float32Array(segZ * segX);
  const counts = new Float32Array(segZ * segX);

  for (const d of sorted) {
    const xi = Math.min(Math.floor(((d.timestamp - tMin) / duration) * segX), segX - 1);
    // pace maps to Z spread — higher pace = wider distribution across Z
    const centerZ = segZ / 2;
    const spread = Math.max(d.pace * segZ * 0.4, 1);
    for (let zi = 0; zi < segZ; zi++) {
      const dist = Math.abs(zi - centerZ);
      const w = Math.exp(-(dist * dist) / (2 * spread * spread));
      grid[zi * segX + xi] += d.energy * w;
      sentGrid[zi * segX + xi] += d.sentiment * w;
      counts[zi * segX + xi] += w;
    }
  }
  for (let i = 0; i < grid.length; i++) {
    if (counts[i] > 0) {
      grid[i] /= counts[i];
      sentGrid[i] /= counts[i];
    }
  }

  const smoothed = gaussianSmooth(grid, segX, segZ);
  const maxVal = Math.max(smoothed.reduce((m, v) => v > m ? v : m, 0), 0.001);
  for (let i = 0; i < smoothed.length; i++) smoothed[i] /= maxVal;

  const worldD = segZ * (24 / Math.max(segZ, 1));
  return { heightfield: smoothed, sentimentField: sentGrid, segX, segZ, worldD };
}

// --------------- component ---------------

export function ConversationTerrain({
  data,
  mode = "multi",
  live = false,
  className,
}: ConversationTerrainProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef<{
    scene: THREE.Scene;
    camera: THREE.OrthographicCamera;
    renderer: THREE.WebGLRenderer;
    controls: OrbitControls;
    animId: number;
    terrainMesh: THREE.Mesh | null;
    contourGroup: THREE.Group | null;
    markerGroup: THREE.Group | null;
    axisGroup: THREE.Group | null;
    lastDataLen: number;
  } | null>(null);

  const buildTerrain = useCallback(
    (scene: THREE.Scene, renderer: THREE.WebGLRenderer, camera: THREE.OrthographicCamera) => {
      const st = stateRef.current;
      if (!st) return;

      // Clear old terrain objects — dispose GPU resources to prevent memory leaks
      const disposeObject = (obj: THREE.Object3D) => {
        obj.traverse((child) => {
          if ((child as THREE.Mesh).geometry) (child as THREE.Mesh).geometry.dispose();
          const mat = (child as THREE.Mesh).material;
          if (mat) {
            if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
            else (mat as THREE.Material).dispose();
          }
        });
      };
      if (st.terrainMesh) { disposeObject(st.terrainMesh); scene.remove(st.terrainMesh); st.terrainMesh = null; }
      if (st.contourGroup) { disposeObject(st.contourGroup); scene.remove(st.contourGroup); st.contourGroup = null; }
      if (st.markerGroup) { disposeObject(st.markerGroup); scene.remove(st.markerGroup); st.markerGroup = null; }
      if (st.axisGroup) { disposeObject(st.axisGroup); scene.remove(st.axisGroup); st.axisGroup = null; }

      if (data.length < 2) return;

      const { heightfield, sentimentField, segX, segZ, worldD, topics } = buildHeightfield(data, mode);

      // --- Terrain mesh ---
      const geo = new THREE.PlaneGeometry(TERRAIN_WIDTH, worldD, segX, segZ);
      geo.rotateX(-Math.PI / 2);
      const pos = geo.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const ix = Math.round((pos.getX(i) + TERRAIN_WIDTH / 2) / TERRAIN_WIDTH * segX);
        const iz = Math.round((pos.getZ(i) + worldD / 2) / worldD * segZ);
        const cx = Math.min(Math.max(ix, 0), segX - 1);
        const cz = Math.min(Math.max(iz, 0), segZ - 1);
        const h = heightfield[cz * segX + cx];
        pos.setY(i, h * HEIGHT_SCALE);
      }
      geo.computeVertexNormals();

      // Dark monochromatic surface — matches session-dashboard original
      const surfaceMat = new THREE.MeshStandardMaterial({
        color: COLORS.surface,
        roughness: 0.9,
        metalness: 0.1,
        transparent: true,
        opacity: 0,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      st.terrainMesh = new THREE.Mesh(geo, surfaceMat);
      st.terrainMesh.renderOrder = -1;
      scene.add(st.terrainMesh);

      // Fade in
      const surfStart = performance.now();
      (function fadeSurf() {
        const t = Math.min((performance.now() - surfStart) / 1500, 1);
        surfaceMat.opacity = 0.25 * (1 - Math.pow(1 - t, 3));
        if (t < 1) requestAnimationFrame(fadeSurf);
      })();

      // --- Contour lines (marching squares) ---
      const hiW = segX * UPSAMPLE + 1;
      const hiH = segZ * UPSAMPLE + 1;
      const hiField = new Float32Array(hiW * hiH);
      for (let hz = 0; hz < hiH; hz++) {
        for (let hx = 0; hx < hiW; hx++) {
          const fx = hx / UPSAMPLE, fz = hz / UPSAMPLE;
          const x0 = Math.floor(fx), x1 = Math.min(x0 + 1, segX - 1);
          const z0 = Math.floor(fz), z1 = Math.min(z0 + 1, segZ - 1);
          const tx = fx - x0, tz = fz - z0;
          hiField[hz * hiW + hx] =
            (1 - tx) * (1 - tz) * heightfield[z0 * segX + x0] +
            tx * (1 - tz) * heightfield[z0 * segX + x1] +
            (1 - tx) * tz * heightfield[z1 * segX + x0] +
            tx * tz * heightfield[z1 * segX + x1];
        }
      }

      st.contourGroup = new THREE.Group();
      const accentColor = new THREE.Color(COLORS.green);
      const accentHSL = { h: 0, s: 0, l: 0 };
      accentColor.getHSL(accentHSL);

      for (let level = 1; level <= CONTOUR_LEVELS; level++) {
        const th = level / CONTOUR_LEVELS;
        // Elevated contour
        const pts = march(hiField, hiW, hiH, th, th * HEIGHT_SCALE + 0.03, TERRAIN_WIDTH, worldD);
        if (pts.length) {
          const b = 0.4 + 0.6 * (level / CONTOUR_LEVELS);
          const tOp = 0.7 + 0.3 * (level / CONTOUR_LEVELS);
          const mat = new THREE.LineBasicMaterial({
            color: new THREE.Color().setHSL(accentHSL.h, accentHSL.s, b * accentHSL.l),
            transparent: true, opacity: tOp, depthWrite: false, depthTest: false,
          });
          st.contourGroup.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), mat));
        }
        // Ground shadow contour
        const gpts = march(hiField, hiW, hiH, th, 0.02, TERRAIN_WIDTH, worldD);
        if (gpts.length) {
          const tOp = 0.15 + 0.15 * (level / CONTOUR_LEVELS);
          const mat = new THREE.LineBasicMaterial({
            color: new THREE.Color().setHSL(accentHSL.h, accentHSL.s, 0.12 + 0.1 * (level / CONTOUR_LEVELS)),
            transparent: true, opacity: tOp, depthWrite: false,
          });
          st.contourGroup.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(gpts), mat));
        }
      }
      st.contourGroup.renderOrder = 1;
      scene.add(st.contourGroup);

      // --- Sweep animation via clip plane ---
      const clipPlane = new THREE.Plane(new THREE.Vector3(0, 0, -1), -worldD / 2);
      st.contourGroup.children.forEach((ch) => {
        (ch as THREE.LineSegments).material.clippingPlanes = [clipPlane];
      });
      if (st.terrainMesh) (st.terrainMesh.material as THREE.Material).clippingPlanes = [clipPlane];
      renderer.localClippingEnabled = true;

      const sweepStart = performance.now();
      const sweepDur = 1000;
      (function animSweep() {
        const elapsed = performance.now() - sweepStart;
        const t = Math.min(elapsed / sweepDur, 1);
        const eased = 1 - Math.pow(1 - t, 2);
        clipPlane.constant = -worldD / 2 + eased * worldD;
        if (t < 1) {
          requestAnimationFrame(animSweep);
        } else {
          st.contourGroup?.children.forEach((ch) => {
            (ch as THREE.LineSegments).material.clippingPlanes = [];
          });
          if (st.terrainMesh) (st.terrainMesh.material as THREE.Material).clippingPlanes = [];
        }
      })();

      // --- Peak markers ---
      const peakCells: { x: number; z: number; val: number; label: string }[] = [];
      for (let z = 0; z < segZ; z++) {
        for (let x = 0; x < segX; x++) {
          peakCells.push({ x, z, val: heightfield[z * segX + x], label: "" });
        }
      }
      peakCells.sort((a, b) => b.val - a.val);

      const peaks: typeof peakCells = [];
      for (const c of peakCells) {
        if (peaks.length >= 5) break;
        if (!peaks.some((p) => Math.abs(p.x - c.x) < 3 && Math.abs(p.z - c.z) < 3) && c.val > 0.3) {
          // Find nearest data point for label
          const normX = c.x / segX;
          const sorted = [...data].sort((a, b) => a.timestamp - b.timestamp);
          const tMin = sorted[0].timestamp;
          const tMax = sorted[sorted.length - 1].timestamp;
          const dur = Math.max(tMax - tMin, 1);
          let best = sorted[0];
          let bestDist = Infinity;
          for (const d of sorted) {
            const dx = Math.abs((d.timestamp - tMin) / dur - normX);
            if (dx < bestDist) { bestDist = dx; best = d; }
          }
          const mins = Math.floor((best.timestamp - tMin) / 60000);
          c.label = `${mins}m`;
          peaks.push(c);
        }
      }

      st.markerGroup = new THREE.Group();
      const triMat = new THREE.MeshBasicMaterial({ color: COLORS.red, side: THREE.DoubleSide });

      for (const peak of peaks) {
        const wx = (peak.x / segX) * TERRAIN_WIDTH - TERRAIN_WIDTH / 2;
        const wz = (peak.z / segZ) * worldD - worldD / 2;
        const wy = peak.val * HEIGHT_SCALE;
        const s = 0.25;

        // Cross marker at peak
        const t1 = new THREE.BufferGeometry();
        t1.setAttribute("position", new THREE.Float32BufferAttribute(
          [wx - s, wy + 0.05, wz, wx + s, wy + 0.05, wz, wx, wy - s * 1.2 + 0.05, wz], 3,
        ));
        t1.setIndex([0, 1, 2]);
        st.markerGroup.add(new THREE.Mesh(t1, triMat));

        const t2 = new THREE.BufferGeometry();
        t2.setAttribute("position", new THREE.Float32BufferAttribute(
          [wx, wy + 0.05, wz - s, wx, wy + 0.05, wz + s, wx, wy - s * 1.2 + 0.05, wz], 3,
        ));
        t2.setIndex([0, 1, 2]);
        st.markerGroup.add(new THREE.Mesh(t2, triMat));

        // Vertical line from peak to label
        st.markerGroup.add(new THREE.LineSegments(
          new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(wx, wy, wz), new THREE.Vector3(wx, wy + 3, wz),
          ]),
          new THREE.LineBasicMaterial({ color: COLORS.red, transparent: true, opacity: 0.5 }),
        ));

        // Ground dot
        const gDot = new THREE.Mesh(
          new THREE.CircleGeometry(0.12, 8),
          new THREE.MeshBasicMaterial({ color: COLORS.red, transparent: true, opacity: 0.4, side: THREE.DoubleSide }),
        );
        gDot.rotation.x = -Math.PI / 2;
        gDot.position.set(wx, -0.08, wz);
        st.markerGroup.add(gDot);

        // Ring
        const ring = new THREE.Mesh(
          new THREE.RingGeometry(0.4, 0.55, 20),
          new THREE.MeshBasicMaterial({ color: COLORS.red, transparent: true, opacity: 0.2, side: THREE.DoubleSide }),
        );
        ring.rotation.x = -Math.PI / 2;
        ring.position.set(wx, -0.08, wz);
        st.markerGroup.add(ring);

        // Label sprite
        const lbl = makeSprite(peak.label, "#ff3822", 40);
        lbl.position.set(wx, wy + 3.5, wz);
        st.markerGroup.add(lbl);
      }
      scene.add(st.markerGroup);

      // --- Axis labels ---
      st.axisGroup = new THREE.Group();
      const edgeX = -TERRAIN_WIDTH / 2 - 1.2;
      const edgeZ = -worldD / 2 - 0.8;

      if (data.length > 0) {
        const sortedData = [...data].sort((a, b) => a.timestamp - b.timestamp);
        const tMin = sortedData[0].timestamp;
        const tMax = sortedData[sortedData.length - 1].timestamp;
        const dur = Math.max(tMax - tMin, 1);
        const tickCount = Math.min(6, segX);
        for (let i = 0; i <= tickCount; i++) {
          const frac = i / tickCount;
          const t = tMin + frac * dur;
          const mins = Math.floor((t - tMin) / 60000);
          const sp = makeSprite(`${mins}m`);
          sp.position.set(frac * TERRAIN_WIDTH - TERRAIN_WIDTH / 2, -0.3, edgeZ);
          st.axisGroup.add(sp);
        }
      }

      const xTitle = makeSprite("TIME \u2192", COLORS.axisTitle, 40);
      xTitle.position.set(0, -0.3, edgeZ - 0.8);
      st.axisGroup.add(xTitle);

      const zLabel = mode === "topics" ? "\u2190 TOPIC" : "\u2190 PACE";
      const zTitle = makeSprite(zLabel, COLORS.axisTitle, 40);
      zTitle.position.set(edgeX - 1, -0.3, 0);
      st.axisGroup.add(zTitle);

      if (mode === "topics" && topics) {
        for (let i = 0; i < topics.length; i++) {
          const sp = makeSprite(topics[i].slice(0, 12), COLORS.axisLabel, 36);
          sp.position.set(edgeX, -0.3, (i / Math.max(topics.length - 1, 1)) * worldD - worldD / 2);
          st.axisGroup.add(sp);
        }
      }

      scene.add(st.axisGroup);
    },
    [data, mode],
  );

  // Init scene
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(COLORS.bg);

    const rect = container.getBoundingClientRect();
    const frustumSize = 30;
    const aspect = rect.width / Math.max(rect.height, 1);
    const camera = new THREE.OrthographicCamera(
      (-frustumSize * aspect) / 2, (frustumSize * aspect) / 2,
      frustumSize / 2, -frustumSize / 2, 0.1, 1000,
    );
    camera.position.set(20, 18, 30);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(rect.width, rect.height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.target.set(0, 2, 0);
    controls.maxPolarAngle = Math.PI / 2.2;

    // Grid floor
    const gridGroup = new THREE.Group();
    const gridSize = 40, gridDiv = 40, gridStep = gridSize / gridDiv, gridHalf = gridSize / 2;
    const glp: THREE.Vector3[] = [];
    for (let i = 0; i <= gridDiv; i++) {
      const p = -gridHalf + i * gridStep;
      glp.push(new THREE.Vector3(-gridHalf, 0, p), new THREE.Vector3(gridHalf, 0, p));
      glp.push(new THREE.Vector3(p, 0, -gridHalf), new THREE.Vector3(p, 0, gridHalf));
    }
    gridGroup.add(new THREE.LineSegments(
      new THREE.BufferGeometry().setFromPoints(glp),
      new THREE.LineBasicMaterial({ color: COLORS.grid, transparent: true, opacity: 0.6 }),
    ));

    const dp: number[] = [];
    for (let i = 0; i <= gridDiv; i++) for (let j = 0; j <= gridDiv; j++) dp.push(-gridHalf + i * gridStep, 0.01, -gridHalf + j * gridStep);
    const dbg = new THREE.BufferGeometry();
    dbg.setAttribute("position", new THREE.Float32BufferAttribute(dp, 3));
    gridGroup.add(new THREE.Points(dbg, new THREE.PointsMaterial({ color: COLORS.gridDot, size: 2, sizeAttenuation: false })));

    const mdp: number[] = [];
    for (let i = 0; i <= gridDiv; i += 5) for (let j = 0; j <= gridDiv; j += 5) mdp.push(-gridHalf + i * gridStep, 0.02, -gridHalf + j * gridStep);
    const mdbg = new THREE.BufferGeometry();
    mdbg.setAttribute("position", new THREE.Float32BufferAttribute(mdp, 3));
    gridGroup.add(new THREE.Points(mdbg, new THREE.PointsMaterial({ color: COLORS.gridDotMaj, size: 3.5, sizeAttenuation: false })));
    gridGroup.position.y = -0.1;
    scene.add(gridGroup);

    // Lighting
    scene.add(new THREE.AmbientLight(0x404040, 0.5));
    const dl = new THREE.DirectionalLight(0xffffff, 0.4);
    dl.position.set(10, 20, 10);
    scene.add(dl);
    const pl = new THREE.PointLight(COLORS.green, 0.3, 30);
    pl.position.set(0, 10, 0);
    scene.add(pl);

    stateRef.current = {
      scene, camera, renderer, controls,
      animId: 0,
      terrainMesh: null, contourGroup: null, markerGroup: null, axisGroup: null,
      lastDataLen: 0,
    };

    // Render loop
    function animate() {
      stateRef.current!.animId = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    }
    animate();

    // Resize handler
    const onResize = () => {
      const r = container.getBoundingClientRect();
      const a = r.width / Math.max(r.height, 1);
      camera.left = (-frustumSize * a) / 2;
      camera.right = (frustumSize * a) / 2;
      camera.top = frustumSize / 2;
      camera.bottom = -frustumSize / 2;
      camera.updateProjectionMatrix();
      renderer.setSize(r.width, r.height);
    };
    window.addEventListener("resize", onResize);

    return () => {
      window.removeEventListener("resize", onResize);
      cancelAnimationFrame(stateRef.current!.animId);
      controls.dispose();
      renderer.dispose();
      container.removeChild(renderer.domElement);
      stateRef.current = null;
    };
  }, []);

  // Build/rebuild terrain when data or mode changes
  useEffect(() => {
    const st = stateRef.current;
    if (!st) return;
    if (live && data.length === st.lastDataLen) return; // skip if no new data in live mode
    st.lastDataLen = data.length;
    buildTerrain(st.scene, st.renderer, st.camera);
  }, [data, mode, buildTerrain, live]);

  return (
    <div
      ref={containerRef}
      className={className}
      style={{ width: "100%", height: "100%", position: "relative", background: "#0a0a0f" }}
    />
  );
}
