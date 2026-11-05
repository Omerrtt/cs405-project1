/**
 * Extrude a planar curve along +z (painting normal) into a solid ribbon mesh.
 *
 * At each sample C with unit tangent T (in the xy-plane) we take the in-plane
 * side vector S = normalize(−T_y, T_x, 0) and build a rectangular cross-section
 * of width `width` and depth `depth`. Consecutive sections are lofted into a
 * triangle list with per-vertex normals (position + normal interleaved).
 *
 * Vertex format matches the solid mesh pipeline: [x,y,z, nx,ny,nz] × 3 per tri.
 */
import * as vec3 from './vec3.js';

/**
 * @param {number[][]} points   curve samples [x,y,z] (z ignored; placed at z0)
 * @param {number[][]} tangents unit (or non-zero) tangents, same length as points
 * @param {{ width?: number, depth?: number, z0?: number }} [opts]
 * @returns {{ vertices: Float32Array, triangleCount: number, sampleCount: number }}
 */
export function extrudeCurveAlongZ(points, tangents, opts = {}) {
  const width = opts.width ?? 0.06;
  const depth = opts.depth ?? 0.35;
  const z0 = opts.z0 ?? 0.01;
  const n = points.length;
  if (n < 2 || tangents.length !== n) {
    return { vertices: new Float32Array(0), triangleCount: 0, sampleCount: n };
  }

  const half = width / 2;
  // Miter longer than this (× half-width) is bevelled so sharp bends
  // do not throw long spikes that change shape as the camera moves.
  const miterLimit = 2.2;
  const side2 = (dx, dy) => {
    const len = Math.hypot(dx, dy);
    if (len < 1e-8) return null;
    return [-dy / len, dx / len, 0];
  };

  const rings = []; // each: { L, R, Lf, Rf, S }
  for (let i = 0; i < n; i++) {
    const c = points[i];
    const prev = points[Math.max(0, i - 1)];
    const next = points[Math.min(n - 1, i + 1)];
    // Tangents from the polyline (stable). Analytic tangents only fill gaps.
    let d0x = c[0] - prev[0], d0y = c[1] - prev[1];
    let d1x = next[0] - c[0], d1y = next[1] - c[1];
    if (i === 0) { d0x = d1x; d0y = d1y; }
    if (i === n - 1) { d1x = d0x; d1y = d0y; }
    let n0 = side2(d0x, d0y);
    let n1 = side2(d1x, d1y);
    if (!n0 && !n1) {
      const T = tangents[i];
      n0 = side2(T[0], T[1]) ?? [1, 0, 0];
      n1 = n0;
    } else {
      n0 = n0 ?? n1;
      n1 = n1 ?? n0;
    }
    // Incoming side stays continuous with the previous ring (no twist).
    if (rings.length && vec3.dot(n0, rings[rings.length - 1].S) < 0) n0 = vec3.scale(n0, -1);
    if (vec3.dot(n1, n0) < 0) n1 = vec3.scale(n1, -1);

    let S = vec3.add(n0, n1);
    const sl = vec3.length(S);
    let miter = half;
    if (sl < 1e-6) {
      S = n0;
    } else {
      S = vec3.scale(S, 1 / sl);
      const align = Math.max(0.35, vec3.dot(S, n0));
      miter = Math.min(half / align, half * miterLimit);
    }

    const cx = c[0], cy = c[1];
    const L = [cx + S[0] * miter, cy + S[1] * miter, z0];
    const R = [cx - S[0] * miter, cy - S[1] * miter, z0];
    const Lf = [L[0], L[1], z0 + depth];
    const Rf = [R[0], R[1], z0 + depth];
    rings.push({ L, R, Lf, Rf, S });
  }

  const tris = [];
  const pushTri = (a, b, c) => {
    const ab = vec3.sub(b, a);
    const ac = vec3.sub(c, a);
    let N = vec3.normalize(vec3.cross(ab, ac));
    if (vec3.length(N) < 1e-8) N = [0, 0, 1];
    for (const p of [a, b, c]) tris.push(p[0], p[1], p[2], N[0], N[1], N[2]);
  };
  // Quad a-b-c-d as two triangles a-b-c and a-c-d (CCW when viewed along +N).
  const pushQuad = (a, b, c, d) => {
    pushTri(a, b, c);
    pushTri(a, c, d);
  };

  for (let i = 0; i + 1 < n; i++) {
    const A = rings[i], B = rings[i + 1];
    // Near face (against painting, outward ≈ −z)
    pushQuad(A.L, A.R, B.R, B.L);
    // Far face (toward camera, outward ≈ +z)
    pushQuad(A.Lf, B.Lf, B.Rf, A.Rf);
    // Left wall (outward ≈ +S)
    pushQuad(A.L, A.Lf, B.Lf, B.L);
    // Right wall (outward ≈ −S)
    pushQuad(A.R, B.R, B.Rf, A.Rf);
  }

  // End caps (start / end of the open curve)
  const first = rings[0], last = rings[n - 1];
  pushQuad(first.L, first.Lf, first.Rf, first.R);
  pushQuad(last.L, last.R, last.Rf, last.Lf);

  return {
    vertices: new Float32Array(tris),
    triangleCount: tris.length / 18,
    sampleCount: n,
  };
}

/**
 * Sample a curve evaluator u ↦ { p, tan? } on [0,1] into parallel point/tangent arrays.
 * @param {(u: number) => { p: number[], tan?: number[]|null }} evalAt
 * @param {(u: number) => number[]} tangentAt
 * @param {number} samples
 */
export function sampleCurveForExtrusion(evalAt, tangentAt, samples = 64) {
  const points = [];
  const tangents = [];
  const N = Math.max(2, samples | 0);
  for (let i = 0; i <= N; i++) {
    const u = i / N;
    const e = evalAt(u);
    points.push([e.p[0], e.p[1], e.p[2] ?? 0]);
    const t = e.tan && vec3.length(e.tan) > 1e-8 ? e.tan : tangentAt(u);
    tangents.push(t);
  }
  return { points, tangents };
}
