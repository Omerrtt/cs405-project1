/**
 * curves — Part D.
 *
 * Points are plain arrays of any dimension: [x, y] in the plane of the
 * painting, or [x, y, z] in world space. Every function must work for both
 * (the tests use 2D and 3D). Return new arrays; never modify the inputs.
 *
 * A piecewise cubic Bézier curve is an array of segments, each segment being
 * four control points [P0, P1, P2, P3]. Consecutive segments share a joint:
 * segments[i][3] equals segments[i + 1][0].
 *
 * Tests: tests/curves.test.js
 */
import { todo } from './todo.js';

function mix(a, b, t) {
  const out = new Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i] + (b[i] - a[i]) * t;
  return out;
}

function scaleAdd(coeffs, pts) {
  const dim = pts[0].length;
  const out = new Array(dim).fill(0);
  for (let k = 0; k < pts.length; k++) {
    for (let i = 0; i < dim; i++) out[i] += coeffs[k] * pts[k][i];
  }
  return out;
}

/* ---------------------------------------------------------- Bézier ------ */

/** The four cubic Bernstein basis values [B0(t), B1(t), B2(t), B3(t)]. */
export function bernstein3(t) {
  const u = 1 - t;
  return [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
}

/** Point on the cubic Bézier curve with control points p0..p3 at t ∈ [0, 1]. */
export function cubicBezier(p0, p1, p2, p3, t) {
  return scaleAdd(bernstein3(t), [p0, p1, p2, p3]);
}

/** First derivative dB/dt of the cubic Bézier at t (not normalised). */
export function cubicBezierTangent(p0, p1, p2, p3, t) {
  const u = 1 - t;
  // B'(t) = 3(1−t)²(P1−P0) + 6(1−t)t(P2−P1) + 3t²(P3−P2)
  const dim = p0.length;
  const out = new Array(dim);
  for (let i = 0; i < dim; i++) {
    out[i] =
      3 * u * u * (p1[i] - p0[i]) +
      6 * u * t * (p2[i] - p1[i]) +
      3 * t * t * (p3[i] - p2[i]);
  }
  return out;
}

/**
 * de Casteljau's construction for any number of control points.
 * Returns every level, for drawing the construction:
 *   levels[0] = the input points (n points)
 *   levels[1] = n − 1 interpolated points
 *   …
 *   levels[n − 1] = [the point on the curve]
 */
export function deCasteljau(points, t) {
  const levels = [points.map((p) => p.slice())];
  let cur = levels[0];
  while (cur.length > 1) {
    const next = [];
    for (let i = 0; i + 1 < cur.length; i++) next.push(mix(cur[i], cur[i + 1], t));
    levels.push(next);
    cur = next;
  }
  return levels;
}

/* ----------------------------------------------- piecewise, C¹ joints --- */

/**
 * Given the last two control points P2, P3 of one segment, return the P1 of
 * the NEXT segment that makes the joint at P3 C¹-continuous.
 */
export function c1NextControl(p2, p3) {
  // Mirror P2 through the joint P3: P1_next = 2 P3 − P2
  const out = new Array(p2.length);
  for (let i = 0; i < p2.length; i++) out[i] = 2 * p3[i] - p2[i];
  return out;
}

/**
 * Evaluate a piecewise cubic Bézier at a global parameter u ∈ [0, 1] that
 * runs over the whole curve: with n segments, segment i covers
 * u ∈ [i/n, (i+1)/n]. u = 0 is the first P0, u = 1 the last P3.
 */
export function evalPiecewise(segments, u) {
  const n = segments.length;
  if (n === 0) return [];
  if (u <= 0) return segments[0][0].slice();
  if (u >= 1) return segments[n - 1][3].slice();
  const s = u * n;
  const i = Math.min(Math.floor(s), n - 1);
  const t = s - i;
  return cubicBezier(segments[i][0], segments[i][1], segments[i][2], segments[i][3], t);
}

/* ---------------------------- second curve family: implement ONE -------- */
/* The tests skip whichever of the two you leave as a TODO, and fail only   */
/* if you implement neither.                                                */

/**
 * Uniform Catmull–Rom: the segment between p1 and p2 (passes through both),
 * t ∈ [0, 1], with tangents (p2 − p0)/2 at p1 and (p3 − p1)/2 at p2.
 */
export function catmullRom(p0, p1, p2, p3, t) {
  const t2 = t * t;
  const t3 = t2 * t;
  const dim = p0.length;
  const out = new Array(dim);
  for (let i = 0; i < dim; i++) {
    out[i] = 0.5 * (
      (2 * p1[i]) +
      (-p0[i] + p2[i]) * t +
      (2 * p0[i] - 5 * p1[i] + 4 * p2[i] - p3[i]) * t2 +
      (-p0[i] + 3 * p1[i] - 3 * p2[i] + p3[i]) * t3
    );
  }
  return out;
}

/** Uniform cubic B-spline basis values [N0(t), N1(t), N2(t), N3(t)]. */
export function bsplineBasis(t) {
  return todo('curves.bsplineBasis');
}

/** Point on the uniform cubic B-spline segment controlled by p0..p3. */
export function bspline(p0, p1, p2, p3, t) {
  return todo('curves.bspline');
}
