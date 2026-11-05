/**
 * Curve export — Part D.
 *
 * Required JSON format (control points in NORMALISED painting coordinates:
 * u, v ∈ [0, 1], origin at the TOP-LEFT corner of the painting, v downwards,
 * the same as texture coordinates):
 *
 * {
 *   "painting": "kavunlu",
 *   "kind": "bezier-c1",                 // or "catmull-rom" / "bspline"
 *   "segments": [                          // for "bezier-c1": 4 points each
 *     [[0.12, 0.40], [0.18, 0.31], [0.27, 0.30], [0.33, 0.38]],
 *     ...
 *   ],
 *   "points": [[u, v], ...]                // for "catmull-rom" / "bspline"
 * }
 *
 * The painting quad spans x ∈ [−a, a], y ∈ [−1, 1] at z = 0 (a = image
 * width / height), so  u = (x + a) / (2a)  and  v = (1 − y) / 2.
 */

/**
 * @param {{
 *   painting: string,
 *   kind: 'bezier-c1' | 'catmull-rom' | 'bspline',
 *   aspect: number,
 *   segments?: number[][][],   // world or painting-plane [x,y] / [x,y,z]
 *   points?: number[][],
 * }} curve
 */
export function curveToJSON(curve) {
  const a = curve.aspect;
  const toUV = (p) => {
    const x = p[0], y = p[1];
    const u = (x + a) / (2 * a);
    const v = (1 - y) / 2;
    return [+u.toFixed(6), +v.toFixed(6)];
  };

  const out = { painting: curve.painting, kind: curve.kind };
  if (curve.kind === 'bezier-c1' && curve.segments) {
    out.segments = curve.segments.map((seg) => seg.map(toUV));
  } else if (curve.points) {
    out.points = curve.points.map(toUV);
  }
  return out;
}

/**
 * Rebuild flat world-space control points from an exported curve JSON
 * (segments in normalised painting UV).
 */
export function ctrlFromJSON(json, aspect) {
  const toWorld = (u, v) => [(2 * u - 1) * aspect, 1 - 2 * v, 0];
  if (json.kind === 'bezier-c1' && json.segments?.length) {
    const pts = [];
    json.segments.forEach((seg, i) => {
      const world = seg.map(([u, v]) => toWorld(u, v));
      if (i === 0) pts.push(...world);
      else pts.push(world[1], world[2], world[3]); // skip shared joint
    });
    return pts;
  }
  if (json.points?.length) {
    return json.points.map(([u, v]) => toWorld(u, v));
  }
  return null;
}

/** Provided: save any object as a .json download in the browser. */
export function downloadJSON(obj, filename = 'curve.json') {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
