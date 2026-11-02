/**
 * Scene — Parts A, B and D.
 *
 *   Part A  Three cubes in front of the painting; one UI-controlled with
 *           T·R·S / S·R·T switch and both matrices on screen.
 *   Part B  Scene-graph lamp (≥3 levels, ≥5 nodes), animated joint, debug axes.
 *   Part D  Piecewise C¹ Bézier over the painting (+ Catmull–Rom), de Casteljau,
 *           drag handles, rider oriented by tangent, JSON export.
 */
import * as mat4 from '../math/mat4.js';
import * as vec3 from '../math/vec3.js';
import * as curves from '../math/curves.js';
import { SceneNode } from './node.js';
import { createMeshDrawer, createLineDrawer } from '../render/mesh.js';
import { curveToJSON, downloadJSON } from './curveExport.js';

function mulAll(...ms) {
  return ms.reduce((a, b) => mat4.multiply(a, b));
}

function composeTRS(t, rY, s, order) {
  const T = mat4.translate(t[0], t[1], t[2]);
  const R = mat4.rotateY(rY);
  const S = mat4.scale(s, s, s);
  return order === 'TRS' ? mulAll(T, R, S) : mulAll(S, R, T);
}

/** Painting UV (origin top-left, v down) → world on the painting plane. */
function uvToWorld(u, v, aspect) {
  return [(2 * u - 1) * aspect, 1 - 2 * v, 0];
}

/**
 * Default piecewise Bézier (3 segments) along the melon silhouette on
 * Kavunlu Natürmort. Tuned in UV against public/paintings/kavunlu.jpg.
 */
function defaultBezierPoints(aspect) {
  const a = aspect;
  // 4 knots around the fruit: left cut → top → right → bottom slice
  //          knot / handle positions in (u, v)
  const uv = [
    [0.10, 0.40], // P0  left (cut end)
    [0.18, 0.22], // P1
    [0.32, 0.14], // P2
    [0.50, 0.15], // P3  top
    [0.68, 0.16], // P4  (C¹ will overwrite from P2,P3)
    [0.86, 0.28], // P5
    [0.90, 0.45], // P6  right
    [0.80, 0.68], // P7
    [0.58, 0.78], // P8
    [0.32, 0.72], // P9  bottom of foreground slice
  ];
  const pts = uv.map(([u, v]) => uvToWorld(u, v, a));
  // Enforce C¹ at interior joints (indices 3 and 6)
  for (const k of [3, 6]) {
    if (pts[k - 1] && pts[k + 1]) pts[k + 1] = curves.c1NextControl(pts[k - 1], pts[k]);
  }
  return pts;
}

function segmentsFromFlat(pts) {
  const segs = [];
  for (let i = 0; i + 3 < pts.length; i += 3) {
    segs.push([pts[i], pts[i + 1], pts[i + 2], pts[i + 3]]);
  }
  return segs;
}

function enforceC1(pts, moved) {
  for (let k = 3; k < pts.length - 1; k += 3) {
    const before = k - 1, after = k + 1;
    if (moved === before && pts[after]) {
      pts[after] = curves.c1NextControl(pts[before], pts[k]);
    } else if (moved === after && pts[before]) {
      pts[before] = curves.c1NextControl(pts[after], pts[k]);
    } else if (moved === k) {
      // knot moved: keep relative handles (caller moves them with the knot)
    }
  }
}

function knotsOnly(pts) {
  const k = [];
  for (let i = 0; i < pts.length; i += 3) k.push(pts[i]);
  return k;
}

function evalCurve(state, u) {
  if (state.curveKind === 'catmull-rom') {
    const K = knotsOnly(state.ctrl);
    const n = Math.max(1, K.length - 1);
    const s = Math.min(n - 1e-9, Math.max(0, u) * n);
    const i = Math.min(Math.floor(s), n - 1);
    const t = s - i;
    const p0 = K[Math.max(0, i - 1)];
    const p1 = K[i];
    const p2 = K[Math.min(K.length - 1, i + 1)];
    const p3 = K[Math.min(K.length - 1, i + 2)];
    return { p: curves.catmullRom(p0, p1, p2, p3, t), tan: null, seg: null, localT: t };
  }
  const segs = segmentsFromFlat(state.ctrl);
  const n = segs.length;
  const uu = Math.min(1, Math.max(0, u));
  const s = Math.min(n - 1e-9, uu * n);
  const i = Math.min(Math.floor(s), n - 1);
  const t = s - i;
  const seg = segs[i];
  const p = curves.cubicBezier(seg[0], seg[1], seg[2], seg[3], t);
  const tan = curves.cubicBezierTangent(seg[0], seg[1], seg[2], seg[3], t);
  return { p, tan, seg, localT: t, segIndex: i };
}

function tangentAt(state, u) {
  const h = 1e-3;
  const a = evalCurve(state, Math.max(0, u - h)).p;
  const b = evalCurve(state, Math.min(1, u + h)).p;
  return vec3.normalize([b[0] - a[0], b[1] - a[1], (b[2] ?? 0) - (a[2] ?? 0)]);
}

/** Frustum edge lines of `cam` as [x,y,z,r,g,b] line-list. */
function frustumLines(cam, aspect) {
  const eye = cam.eye, target = cam.target, up = cam.up;
  const f = vec3.normalize(vec3.sub(target, eye));
  let r = vec3.cross(f, up);
  if (vec3.length(r) < 1e-6) r = vec3.cross(f, [1, 0, 0]);
  r = vec3.normalize(r);
  const u = vec3.cross(r, f);
  const corner = (d, sx, sy) => {
    let hh, hw;
    if (cam.projection === 'orthographic') {
      hh = cam.orthoHeight / 2;
      hw = hh * aspect;
    } else {
      hh = Math.tan(cam.fovY / 2) * d;
      hw = hh * aspect;
    }
    return vec3.add(
      vec3.add(eye, vec3.scale(f, d)),
      vec3.add(vec3.scale(r, sx * hw), vec3.scale(u, sy * hh)),
    );
  };
  const n = [corner(cam.near, -1, -1), corner(cam.near, 1, -1), corner(cam.near, 1, 1), corner(cam.near, -1, 1)];
  const F = [corner(cam.far, -1, -1), corner(cam.far, 1, -1), corner(cam.far, 1, 1), corner(cam.far, -1, 1)];
  const col = [0.95, 0.45, 0.2];
  const eyeCol = [1, 0.85, 0.2];
  const lines = [];
  const push = (a, b, c = col) => {
    lines.push(a[0], a[1], a[2], c[0], c[1], c[2], b[0], b[1], b[2], c[0], c[1], c[2]);
  };
  for (let i = 0; i < 4; i++) {
    push(n[i], n[(i + 1) % 4]);
    push(F[i], F[(i + 1) % 4]);
    push(n[i], F[i]);
  }
  push(eye, target, eyeCol);
  return new Float32Array(lines);
}

function curveLineData(state) {
  const pts = [];
  const N = 120;
  for (let i = 0; i <= N; i++) {
    const p = evalCurve(state, i / N).p;
    pts.push([p[0], p[1], p[2] ?? 0.002]);
  }
  const col = [1, 0.85, 0.2];
  const lines = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i], b = pts[i + 1];
    lines.push(a[0], a[1], a[2], col[0], col[1], col[2], b[0], b[1], b[2], col[0], col[1], col[2]);
  }
  // control polygon
  if (state.curveKind === 'bezier-c1' && state.showPolygon) {
    const pc = [0.75, 0.75, 0.75];
    for (let i = 0; i + 1 < state.ctrl.length; i++) {
      const a = state.ctrl[i], b = state.ctrl[i + 1];
      lines.push(a[0], a[1], 0.003, pc[0], pc[1], pc[2], b[0], b[1], 0.003, pc[0], pc[1], pc[2]);
    }
  }
  // de Casteljau construction on active segment
  if (state.curveKind === 'bezier-c1' && state.showCasteljau) {
    const { seg, localT } = evalCurve(state, state.curveT);
    if (seg) {
      const levels = curves.deCasteljau(seg, localT);
      const cols = [[0.4, 0.7, 0.95], [0.45, 0.85, 0.45], [0.95, 0.5, 0.3]];
      for (let L = 1; L < levels.length; L++) {
        const c = cols[(L - 1) % cols.length];
        const lv = levels[L];
        for (let i = 0; i + 1 < lv.length; i++) {
          const a = lv[i], b = lv[i + 1];
          lines.push(a[0], a[1], 0.004, c[0], c[1], c[2], b[0], b[1], 0.004, c[0], c[1], c[2]);
        }
      }
    }
  }
  return new Float32Array(lines);
}

function controlPointMarkers(state) {
  // tiny cubes at each control point — drawn as solid cubes by caller
  if (state.curveKind === 'catmull-rom') return knotsOnly(state.ctrl).map((p, i) => ({ p, knot: true, index: i * 3 }));
  return state.ctrl.map((p, i) => ({ p, knot: i % 3 === 0, index: i }));
}

export function createScene({ gpu, renderer, painting, panel, camera, getPaintingId }) {
  const meshes = createMeshDrawer(gpu);
  const lines = createLineDrawer(gpu);

  const state = {
    debugAxes: false,
    // Part A — controllable object (left side of the scene, clear of the lamp)
    order: 'TRS', // or 'SRT'
    tx: -0.95,
    ty: -0.35,
    tz: 0.85,
    ry: 0.35,
    s: 0.26,
    // Part B animation (off by default so the hierarchy is readable)
    animateGraph: false,
    // Part D
    curveKind: 'bezier-c1',
    curveT: 0.35,
    showCasteljau: false,
    showPolygon: true,
    animateCurve: false,
    ctrl: defaultBezierPoints(painting.aspect),
    dragIndex: -1,
  };

  // --- Part A: three separate cubes on the LEFT (no overlap) ---
  const partA = [
    { slot: meshes.alloc(), color: [0.85, 0.4, 0.15], model: () => composeTRS([state.tx, state.ty, state.tz], state.ry, state.s, state.order) },
    { slot: meshes.alloc(), color: [0.2, 0.45, 0.75], model: () => mulAll(mat4.translate(-1.35, -0.45, 0.55), mat4.scale(0.2, 0.2, 0.2)) },
    { slot: meshes.alloc(), color: [0.3, 0.6, 0.3], model: () => mulAll(mat4.translate(-0.6, -0.45, 1.15), mat4.rotateY(0.4), mat4.scale(0.18, 0.28, 0.18)) },
  ];

  // --- Part B scene graph on the RIGHT: table → upright lamp (5 nodes, ≥3 levels) ---
  const root = new SceneNode('root');
  const table = root.addChild(new SceneNode('table', mat4.translate(0.95, -0.7, 0.9)));
  const lampBase = table.addChild(new SceneNode('lampBase', mat4.translate(0, 0.1, 0)));
  const arm1 = lampBase.addChild(new SceneNode('arm1', mat4.translate(0, 0.18, 0)));
  const arm2 = arm1.addChild(new SceneNode('arm2', mat4.translate(0, 0.32, 0)));
  const shade = arm2.addChild(new SceneNode('shade', mat4.translate(0, 0.26, 0)));

  const graphMeshes = new Map();
  root.traverse((n) => {
    if (n === root) return;
    graphMeshes.set(n, { slot: meshes.alloc(), color: [0.55, 0.5, 0.42] });
  });
  graphMeshes.get(table).color = [0.55, 0.5, 0.42];
  graphMeshes.get(lampBase).color = [0.35, 0.35, 0.4];
  graphMeshes.get(arm1).color = [0.25, 0.45, 0.7];
  graphMeshes.get(arm2).color = [0.75, 0.4, 0.2];
  graphMeshes.get(shade).color = [0.9, 0.8, 0.25];

  const localScale = {
    table: mat4.scale(0.7, 0.1, 0.45),
    lampBase: mat4.scale(0.14, 0.08, 0.14),
    arm1: mulAll(mat4.translate(0, 0.14, 0), mat4.scale(0.055, 0.28, 0.055)),
    arm2: mulAll(mat4.translate(0, 0.14, 0), mat4.scale(0.05, 0.26, 0.05)),
    shade: mat4.scale(0.2, 0.1, 0.2),
  };

  // rider on the curve
  const riderSlot = meshes.alloc();
  const handleSlots = Array.from({ length: 16 }, () => meshes.alloc());

  /* ---------------- UI ---------------- */
  const fa = panel.folder('Part A · Transforms');
  fa.select('order', [
    { value: 'TRS', label: 'M = T · R · S' },
    { value: 'SRT', label: 'M = S · R · T' },
  ], state.order, (v) => { state.order = v; });
  fa.slider('translate x', state, 'tx', -1.2, 1.2, 0.01);
  fa.slider('translate y', state, 'ty', -1, 1, 0.01);
  fa.slider('translate z', state, 'tz', 0.2, 1.5, 0.01);
  fa.slider('rotate y', state, 'ry', -Math.PI, Math.PI, 0.01);
  fa.slider('scale', state, 's', 0.1, 0.6, 0.01);
  const matReadout = fa.text('');
  fa.note('Both orders use the same T, R, S; only multiplication order changes.');

  const fb = panel.folder('Part B · Scene graph');
  fb.toggle('animate joint', state, 'animateGraph');
  fb.toggle('debug axes', state, 'debugAxes');
  const graphReadout = fb.text('');

  const fd = panel.folder('Part D · Curves');
  fd.select('curve', [
    { value: 'bezier-c1', label: 'piecewise Bézier (C¹)' },
    { value: 'catmull-rom', label: 'Catmull–Rom' },
  ], state.curveKind, (v) => { state.curveKind = v; });
  fd.slider('parameter t', state, 'curveT', 0, 1, 0.005);
  fd.toggle('de Casteljau', state, 'showCasteljau');
  fd.toggle('control polygon', state, 'showPolygon');
  fd.toggle('animate along curve', state, 'animateCurve');
  fd.button('export JSON', () => {
    const json = curveToJSON({
      painting: getPaintingId?.() ?? 'kavunlu',
      kind: state.curveKind,
      aspect: painting.aspect,
      segments: state.curveKind === 'bezier-c1' ? segmentsFromFlat(state.ctrl) : undefined,
      points: state.curveKind === 'catmull-rom' ? knotsOnly(state.ctrl) : undefined,
    });
    downloadJSON(json, 'curve.json');
  });
  const curveReadout = fd.text('');

  function rebuildGraphLocals(time) {
    // Arms mostly upright; when animate is on they swing a little (still readable).
    const a1 = state.animateGraph ? Math.sin(time * 1.2) * 0.55 : 0.25;
    const a2 = state.animateGraph ? Math.cos(time * 1.5) * 0.65 : -0.35;
    table.local = mat4.translate(0.95, -0.7, 0.9);
    lampBase.local = mat4.translate(0, 0.1, 0);
    arm1.local = mulAll(mat4.translate(0, 0.18, 0), mat4.rotateZ(a1));
    arm2.local = mulAll(mat4.translate(0, 0.32, 0), mat4.rotateZ(a2));
    shade.local = mat4.translate(0, 0.26, 0);
  }

  const initialCtrl = () => defaultBezierPoints(painting.aspect);

  return {
    state,

    /** Called when the painting image (and aspect) changes. */
    onPaintingLoaded() {
      state.ctrl = defaultBezierPoints(painting.aspect);
    },

    update(dt, time) {
      if (state.animateCurve) {
        state.curveT = (state.curveT + dt * 0.15) % 1;
      }
      rebuildGraphLocals(time);
      root.updateWorld();

      const Mtrs = composeTRS([state.tx, state.ty, state.tz], state.ry, state.s, 'TRS');
      const Msrt = composeTRS([state.tx, state.ty, state.tz], state.ry, state.s, 'SRT');
      matReadout.set(
        `Active order: ${state.order === 'TRS' ? 'T·R·S' : 'S·R·T'}\n\n` +
        `M = T · R · S\n${mat4.format(Mtrs)}\n\n` +
        `M = S · R · T\n${mat4.format(Msrt)}`,
      );

      const hand = shade.world;
      const p = mat4.transformVec4(hand, [0, 0, 0, 1]);
      graphReadout.set(
        `root\n` +
        `└─ table\n` +
        `   └─ lampBase\n` +
        `      └─ arm1\n` +
        `         └─ arm2\n` +
        `            └─ shade\n\n` +
        `world(shade) origin:\n(${p[0].toFixed(2)}, ${p[1].toFixed(2)}, ${p[2].toFixed(2)})`,
      );

      const e = evalCurve(state, state.curveT);
      curveReadout.set(
        `kind: ${state.curveKind}\n` +
        `t = ${state.curveT.toFixed(3)}\n` +
        `C(t) ≈ (${e.p[0].toFixed(3)}, ${e.p[1].toFixed(3)})`,
      );
    },

    draw(pass, viewProj) {
      // Part A cubes
      for (const obj of partA) {
        const model = obj.model();
        const mvp = mat4.multiply(viewProj, model);
        meshes.drawCube(pass, obj.slot, mvp, model, obj.color, renderer);
      }

      // Part B graph
      root.traverse((node) => {
        if (node === root) return;
        const gm = graphMeshes.get(node);
        const ls = localScale[node.name] ?? mat4.identity();
        const model = mat4.multiply(node.world, ls);
        const mvp = mat4.multiply(viewProj, model);
        meshes.drawCube(pass, gm.slot, mvp, model, gm.color, renderer);
        if (state.debugAxes) {
          lines.drawAxes(pass, mat4.multiply(viewProj, node.world), renderer);
        }
      });

      // Part D curve + handles + rider
      lines.drawLines(pass, viewProj, curveLineData(state), renderer);
      const markers = controlPointMarkers(state);
      markers.forEach((m, i) => {
        const sc = m.knot ? 0.045 : 0.03;
        const model = mulAll(mat4.translate(m.p[0], m.p[1], 0.01), mat4.scale(sc, sc, sc));
        const mvp = mat4.multiply(viewProj, model);
        const col = m.knot ? [0.85, 0.25, 0.15] : [0.95, 0.95, 0.95];
        meshes.drawCube(pass, handleSlots[i % handleSlots.length], mvp, model, col, renderer);
      });

      const { p } = evalCurve(state, state.curveT);
      const tan = tangentAt(state, state.curveT);
      // Orient rider: local +x along tangent in the painting plane
      const angle = Math.atan2(tan[1], tan[0]);
      const riderModel = mulAll(
        mat4.translate(p[0], p[1], 0.06),
        mat4.rotateZ(angle),
        mat4.scale(0.08, 0.04, 0.04),
      );
      meshes.drawCube(pass, riderSlot, mat4.multiply(viewProj, riderModel), riderModel, [1, 0.85, 0.2], renderer);
    },

    /** Inspection view: draw the main camera frustum. */
    drawFrustum(pass, viewProj, cam, aspect) {
      lines.drawLines(pass, viewProj, frustumLines(cam, aspect), renderer);
    },

    reset() {
      state.order = 'TRS';
      state.tx = -0.95; state.ty = -0.35; state.tz = 0.85;
      state.ry = 0.35; state.s = 0.26;
      state.animateGraph = false;
      state.debugAxes = false;
      state.curveKind = 'bezier-c1';
      state.curveT = 0.35;
      state.showCasteljau = false;
      state.showPolygon = true;
      state.animateCurve = false;
      state.ctrl = initialCtrl();
      state.dragIndex = -1;
    },

    /**
     * Pick / drag control points on the painting plane (z = 0).
     * worldPoint: [x,y,z] on the plane, or null.
     */
    pointerDown(worldPoint) {
      if (!worldPoint) return false;
      let best = -1, bestD = 0.06 * 0.06;
      const markers = controlPointMarkers(state);
      for (const m of markers) {
        const dx = m.p[0] - worldPoint[0], dy = m.p[1] - worldPoint[1];
        const d = dx * dx + dy * dy;
        if (d < bestD) { bestD = d; best = m.index; }
      }
      state.dragIndex = best;
      return best >= 0;
    },

    pointerDrag(worldPoint) {
      if (state.dragIndex < 0 || !worldPoint) return;
      const i = state.dragIndex;
      const prev = state.ctrl[i];
      const dx = worldPoint[0] - prev[0], dy = worldPoint[1] - prev[1];
      if (state.curveKind === 'bezier-c1' && i % 3 === 0) {
        // move knot with neighbouring handles
        for (const j of [i - 1, i, i + 1]) {
          if (state.ctrl[j]) {
            state.ctrl[j] = [state.ctrl[j][0] + dx, state.ctrl[j][1] + dy, 0];
          }
        }
      } else {
        state.ctrl[i] = [worldPoint[0], worldPoint[1], 0];
        if (state.curveKind === 'bezier-c1') enforceC1(state.ctrl, i);
      }
    },

    pointerUp() {
      state.dragIndex = -1;
    },
  };
}
