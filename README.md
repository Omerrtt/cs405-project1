# CS405 Project 1 — Transformations, Projection & Curves from Paintings

Sabancı University. Default painting: **Şeker Ahmed Paşa — Kavunlu Natürmort**
(selectable in the panel; others from the SSM collection are bundled).

## How to run

Needs **Node.js ≥ 20.19** and a WebGPU browser (current Chrome / Edge).

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # maths / scene-graph unit tests
```

## What each control does

| Panel | Control | Effect |
|---|---|---|
| Painting | painting | Swap the textured quad (SSM image). |
| Camera | projection | Perspective ↔ orthographic. |
| Camera | fovY / near / far | Main camera parameters (defaults: near 0.1, far 100; shown numerically below). |
| View | view | **main camera** — orbit the scene; **inspection** — second camera that draws the main frustum (also orbitable). |
| View | reset | Restore camera and scene defaults. |
| Part A | order | Compose the controlled cube as `T·R·S` or `S·R·T`; both matrices are printed. |
| Part A | translate / rotate / scale | Drive the orange cube in front of the painting. |
| Part B | animate joint | Swing the lamp arms in the scene graph. |
| Part B | debug axes | Draw each node’s local axes. |
| Part D | curve | Piecewise C¹ Bézier, or Catmull–Rom through the knots. |
| Part D | parameter t | Sample point / de Casteljau construction / rider position. |
| Part D | de Casteljau / control polygon | Debug drawings on the painting plane. |
| Part D | animate along curve | Advance `t` and ride the curve (orientation follows the tangent). |
| Part D | extrude surface (bonus) | Extrude the curve along +z into a lit solid ribbon mesh. |
| Part D | extrude width / depth | Cross-section width and extrusion depth of the bonus mesh. |
| Part D | export JSON | Download control points in normalised painting UV (handout format). |

### Pointer

- **Drag** — orbit the active camera.
- **Wheel** — zoom (change eye distance; does not change fov / near / far).
- **Click-drag a handle** on the painting — move Bézier / Catmull–Rom control points (C¹ is enforced on Bézier joints).

## Curve export

`curve.json` at the repo root is the exported piecewise C¹ Bézier over the melon
(normalised painting UV). The app loads it as the default curve on startup; **export JSON**
rewrites a download in the same handout format.

## Project layout

```
src/math/     vec3, mat4, curves, extrude   (Parts A, C, D + bonus)
src/scene/    node, camera, scene, export   (Parts B, C, D)
src/render/   WebGPU device, painting, mesh / line drawers
src/ui/       panel, stats, pointer input
```

Convention used everywhere after Part A: **M = T · R · S** (scale first, then rotate, then translate).

## Bonus — curve extrusion

The active Part D curve is sampled and extruded along the painting normal (`+z`) into a
rectangular solid ribbon (`src/math/extrude.js`), rendered as a triangle mesh with normals.
Toggle and width/depth are under **Part D**. Dragging control points rebuilds the mesh live.

## Tests

`npm test` must stay green. B-spline is intentionally left unimplemented; Catmull–Rom is the second curve family.
