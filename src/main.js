/**
 * Entry point: wires GPU, painting, camera, scene and UI together and runs
 * the render loop.
 *
 *   p_clip = P · V · M · p_object
 */
import './ui/style.css';
import { initWebGPU, showFatal } from './render/gpu.js';
import { Renderer } from './render/renderer.js';
import { Painting } from './render/painting.js';
import { createCamera, viewProjection } from './scene/camera.js';
import { createScene } from './scene/scene.js';
import { createPanel } from './ui/panel.js';
import { Stats } from './ui/stats.js';
import { attachPointer } from './ui/input.js';
import { PAINTINGS, DEFAULT_PAINTING, paintingURL } from './config.js';
import * as mat4 from './math/mat4.js';
import * as vec3 from './math/vec3.js';

/** Unproject an NDC point to a ray and intersect the painting plane z = 0. */
function hitPaintingPlane(ndc, cam, aspect) {
  try {
    const view = mat4.lookAt(cam.eye, cam.target, cam.up);
    let proj;
    if (cam.projection === 'orthographic') {
      const h = cam.orthoHeight / 2, w = h * aspect;
      proj = mat4.orthographic(-w, w, -h, h, cam.near, cam.far);
    } else {
      proj = mat4.perspective(cam.fovY, aspect, cam.near, cam.far);
    }
    const vp = mat4.multiply(proj, view);
    // Invert VP (general inverse via adjugate is heavy; for affine P·V use
    // invertRigid on V and a closed-form for P — here a numeric 4×4 inverse).
    const inv = invert4(vp);
    if (!inv) return null;
    const a = mat4.transformVec4(inv, [ndc[0], ndc[1], 0, 1]);
    const b = mat4.transformVec4(inv, [ndc[0], ndc[1], 1, 1]);
    const p0 = [a[0] / a[3], a[1] / a[3], a[2] / a[3]];
    const p1 = [b[0] / b[3], b[1] / b[3], b[2] / b[3]];
    const d = vec3.sub(p1, p0);
    if (Math.abs(d[2]) < 1e-8) return null;
    const t = -p0[2] / d[2];
    return [p0[0] + d[0] * t, p0[1] + d[1] * t, 0];
  } catch {
    return null;
  }
}

function invert4(m) {
  // Standard 4×4 inverse (column-major).
  const a = Array.from(m);
  const inv = new Float32Array(16);
  inv[0] = a[5]*a[10]*a[15] - a[5]*a[11]*a[14] - a[9]*a[6]*a[15] + a[9]*a[7]*a[14] + a[13]*a[6]*a[11] - a[13]*a[7]*a[10];
  inv[4] = -a[4]*a[10]*a[15] + a[4]*a[11]*a[14] + a[8]*a[6]*a[15] - a[8]*a[7]*a[14] - a[12]*a[6]*a[11] + a[12]*a[7]*a[10];
  inv[8] = a[4]*a[9]*a[15] - a[4]*a[11]*a[13] - a[8]*a[5]*a[15] + a[8]*a[7]*a[13] + a[12]*a[5]*a[11] - a[12]*a[7]*a[9];
  inv[12] = -a[4]*a[9]*a[14] + a[4]*a[10]*a[13] + a[8]*a[5]*a[14] - a[8]*a[6]*a[13] - a[12]*a[5]*a[10] + a[12]*a[6]*a[9];
  inv[1] = -a[1]*a[10]*a[15] + a[1]*a[11]*a[14] + a[9]*a[2]*a[15] - a[9]*a[3]*a[14] - a[13]*a[2]*a[11] + a[13]*a[3]*a[10];
  inv[5] = a[0]*a[10]*a[15] - a[0]*a[11]*a[14] - a[8]*a[2]*a[15] + a[8]*a[3]*a[14] + a[12]*a[2]*a[11] - a[12]*a[3]*a[10];
  inv[9] = -a[0]*a[9]*a[15] + a[0]*a[11]*a[13] + a[8]*a[1]*a[15] - a[8]*a[3]*a[13] - a[12]*a[1]*a[11] + a[12]*a[3]*a[9];
  inv[13] = a[0]*a[9]*a[14] - a[0]*a[10]*a[13] - a[8]*a[1]*a[14] + a[8]*a[2]*a[13] + a[12]*a[1]*a[10] - a[12]*a[2]*a[9];
  inv[2] = a[1]*a[6]*a[15] - a[1]*a[7]*a[14] - a[5]*a[2]*a[15] + a[5]*a[3]*a[14] + a[13]*a[2]*a[7] - a[13]*a[3]*a[6];
  inv[6] = -a[0]*a[6]*a[15] + a[0]*a[7]*a[14] + a[4]*a[2]*a[15] - a[4]*a[3]*a[14] - a[12]*a[2]*a[7] + a[12]*a[3]*a[6];
  inv[10] = a[0]*a[5]*a[15] - a[0]*a[7]*a[13] - a[4]*a[1]*a[15] + a[4]*a[3]*a[13] + a[12]*a[1]*a[7] - a[12]*a[3]*a[5];
  inv[14] = -a[0]*a[5]*a[14] + a[0]*a[6]*a[13] + a[4]*a[1]*a[14] - a[4]*a[2]*a[13] - a[12]*a[1]*a[6] + a[12]*a[2]*a[5];
  inv[3] = -a[1]*a[6]*a[11] + a[1]*a[7]*a[10] + a[5]*a[2]*a[11] - a[5]*a[3]*a[10] - a[9]*a[2]*a[7] + a[9]*a[3]*a[6];
  inv[7] = a[0]*a[6]*a[11] - a[0]*a[7]*a[10] - a[4]*a[2]*a[11] + a[4]*a[3]*a[10] + a[8]*a[2]*a[7] - a[8]*a[3]*a[6];
  inv[11] = -a[0]*a[5]*a[11] + a[0]*a[7]*a[9] + a[4]*a[1]*a[11] - a[4]*a[3]*a[9] - a[8]*a[1]*a[7] + a[8]*a[3]*a[5];
  inv[15] = a[0]*a[5]*a[10] - a[0]*a[6]*a[9] - a[4]*a[1]*a[10] + a[4]*a[2]*a[9] + a[8]*a[1]*a[6] - a[8]*a[2]*a[5];
  let det = a[0]*inv[0] + a[1]*inv[4] + a[2]*inv[8] + a[3]*inv[12];
  if (Math.abs(det) < 1e-12) return null;
  det = 1 / det;
  for (let i = 0; i < 16; i++) inv[i] *= det;
  return inv;
}

function orbitStateFromCamera(cam) {
  const toEye = vec3.sub(cam.eye, cam.target);
  const dist = vec3.length(toEye) || 2.8;
  const yaw = Math.atan2(toEye[0], toEye[2]);
  const pitch = Math.asin(Math.max(-0.99, Math.min(0.99, toEye[1] / dist)));
  return { yaw, pitch, dist };
}

function applyOrbit(cam, orb) {
  const cp = Math.cos(orb.pitch), sp = Math.sin(orb.pitch);
  const cy = Math.cos(orb.yaw), sy = Math.sin(orb.yaw);
  cam.eye = [
    cam.target[0] + orb.dist * cp * sy,
    cam.target[1] + orb.dist * sp,
    cam.target[2] + orb.dist * cp * cy,
  ];
}

async function main() {
  const canvas = document.getElementById('gfx');
  const gpu = await initWebGPU(canvas);
  const renderer = new Renderer(gpu);
  const painting = new Painting(gpu);

  const params = new URLSearchParams(location.search);
  let current = PAINTINGS.find((p) => p.id === params.get('painting'))
    ?? PAINTINGS.find((p) => p.id === DEFAULT_PAINTING);
  await painting.load(paintingURL(current));

  /* ---------------- UI ---------------- */
  const panelRoot = document.getElementById('panel');
  const panel = createPanel(panelRoot);
  const title = document.createElement('h1');
  title.textContent = 'CS405 · Project 1';
  panelRoot.appendChild(title);
  const stats = new Stats(panelRoot);

  const camera = createCamera();
  let orb = orbitStateFromCamera(camera);
  const viewMode = { mode: 'main' }; // main | inspect
  const inspectCam = {
    eye: [3.2, 2.2, 4.0],
    target: [0, 0, 0.4],
    up: [0, 1, 0],
    fovY: Math.PI / 4,
    near: 0.1,
    far: 100,
    projection: 'perspective',
    orthoHeight: 6,
  };

  const pf = panel.folder('Painting');
  let scene;
  pf.select('painting', PAINTINGS.map((p) => ({ value: p.id, label: `${p.artist} — ${p.title}` })), current.id,
    async (id) => {
      current = PAINTINGS.find((p) => p.id === id);
      await painting.load(paintingURL(current));
      scene?.onPaintingLoaded();
      history.replaceState(null, '', `?painting=${id}`);
    });

  const cf = panel.folder('Camera');
  const camStatus = cf.text('');
  cf.select('projection', ['perspective', 'orthographic'], camera.projection, (v) => { camera.projection = v; });
  cf.slider('fovY (°)', { v: camera.fovY * 180 / Math.PI }, 'v', 20, 90, 1, (v) => { camera.fovY = v * Math.PI / 180; });
  cf.slider('near', camera, 'near', 0.05, 5, 0.05);
  cf.slider('far', camera, 'far', 5, 200, 1);
  const camReadout = cf.text('');

  scene = createScene({
    gpu, renderer, painting, panel, camera,
    getPaintingId: () => current.id,
  });


  const vf = panel.folder('View');
  vf.select('view', [
    { value: 'main', label: 'main camera' },
    { value: 'inspect', label: 'inspection (frustum)' },
  ], viewMode.mode, (v) => { viewMode.mode = v; });
  vf.button('reset', () => {
    Object.assign(camera, createCamera());
    orb = orbitStateFromCamera(camera);
    scene.reset();
  });
  vf.note(gpu.encodeSRGB ? 'sRGB: encoded in shader (fallback)' : 'sRGB: canvas -srgb view');
  vf.note('Drag: orbit · Shift-drag / handle: curve points · Wheel: zoom');

  /* -------------- input --------------- */
  let draggingCurve = false;
  attachPointer(canvas, {
    down(e) {
      if (viewMode.mode !== 'main') return;
      const aspect = canvas.width / canvas.height;
      const hit = hitPaintingPlane(e.ndc, camera, aspect);
      draggingCurve = scene.pointerDown(hit);
    },
    drag(e) {
      if (draggingCurve) {
        const aspect = canvas.width / canvas.height;
        const hit = hitPaintingPlane(e.ndc, camera, aspect);
        scene.pointerDrag(hit);
        return;
      }
      if (viewMode.mode === 'inspect') {
        // orbit the inspection camera lightly
        inspectCam._yaw = (inspectCam._yaw ?? 0.9) - e.dx * 0.005;
        inspectCam._pitch = Math.max(-1.2, Math.min(1.2, (inspectCam._pitch ?? 0.5) + e.dy * 0.005));
        inspectCam._dist = inspectCam._dist ?? 5.5;
        const cp = Math.cos(inspectCam._pitch), sp = Math.sin(inspectCam._pitch);
        inspectCam.eye = [
          inspectCam.target[0] + inspectCam._dist * cp * Math.sin(inspectCam._yaw),
          inspectCam.target[1] + inspectCam._dist * sp,
          inspectCam.target[2] + inspectCam._dist * cp * Math.cos(inspectCam._yaw),
        ];
        return;
      }
      orb.yaw -= e.dx * 0.005;
      orb.pitch = Math.max(-1.35, Math.min(1.35, orb.pitch + e.dy * 0.005));
      applyOrbit(camera, orb);
    },
    up() {
      draggingCurve = false;
      scene.pointerUp();
    },
    wheel(e) {
      if (viewMode.mode === 'inspect') {
        inspectCam._dist = Math.max(2, Math.min(20, (inspectCam._dist ?? 5.5) * (1 + e.delta * 0.001)));
        const cp = Math.cos(inspectCam._pitch ?? 0.5), sp = Math.sin(inspectCam._pitch ?? 0.5);
        const yaw = inspectCam._yaw ?? 0.9;
        inspectCam.eye = [
          inspectCam.target[0] + inspectCam._dist * cp * Math.sin(yaw),
          inspectCam.target[1] + inspectCam._dist * sp,
          inspectCam.target[2] + inspectCam._dist * cp * Math.cos(yaw),
        ];
        return;
      }
      orb.dist = Math.max(0.6, Math.min(20, orb.dist * (1 + e.delta * 0.001)));
      applyOrbit(camera, orb);
    },
  });

  /* ------------ render loop ----------- */
  let last = performance.now();
  function frame(now) {
    stats.begin(now);
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;

    scene.update(dt, now / 1000);

    const aspect = canvas.width / canvas.height;
    const activeCam = viewMode.mode === 'inspect' ? inspectCam : camera;
    const vp = viewProjection(activeCam, aspect, painting.aspect);
    camStatus.set(vp.fallback
      ? `PLACEHOLDER view (no camera yet)\n${vp.missing}`
      : `camera: P · V (${activeCam.projection}) · view=${viewMode.mode}`);
    camStatus.el.classList.toggle('warn', vp.fallback);
    camReadout.set(
      `eye    ${camera.eye.map((x) => x.toFixed(2)).join(', ')}\n` +
      `target ${camera.target.map((x) => x.toFixed(2)).join(', ')}\n` +
      `fovY ${(camera.fovY * 180 / Math.PI).toFixed(1)}°  near ${camera.near}  far ${camera.far}`,
    );

    const paintingMVP = vp.fallback ? vp.matrix : mat4.multiply(vp.matrix, painting.model);
    renderer.render((pass) => {
      painting.draw(pass, paintingMVP, renderer);
      scene.draw(pass, vp.matrix);
      if (viewMode.mode === 'inspect' && !vp.fallback) {
        scene.drawFrustum(pass, vp.matrix, camera, aspect);
      }
    });

    stats.end(renderer.stats);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

main().catch((e) => {
  console.error(e);
  showFatal(e.message ?? String(e));
});
