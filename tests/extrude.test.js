import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { extrudeCurveAlongZ, sampleCurveForExtrusion } from '../src/math/extrude.js';
import * as vec3 from '../src/math/vec3.js';

describe('extrudeCurveAlongZ', () => {
  it('builds a solid ribbon with expected triangle count', () => {
    // Straight segment along +x
    const points = [[0, 0, 0], [1, 0, 0], [2, 0, 0]];
    const tangents = [[1, 0, 0], [1, 0, 0], [1, 0, 0]];
    const { vertices, triangleCount, sampleCount } = extrudeCurveAlongZ(points, tangents, {
      width: 0.1, depth: 0.4, z0: 0.01,
    });
    assert.equal(sampleCount, 3);
    // 2 segments × 4 walls × 2 tris + 2 end caps × 2 tris = 16 + 4 = 20
    assert.equal(triangleCount, 20);
    assert.equal(vertices.length, triangleCount * 18);
  });

  it('produces finite unit-ish normals', () => {
    const points = [[0, 0, 0], [0.5, 0.2, 0], [1, 0, 0]];
    const tangents = [[1, 0.4, 0], [1, -0.2, 0], [1, 0, 0]].map((t) => vec3.normalize(t));
    const { vertices, triangleCount } = extrudeCurveAlongZ(points, tangents);
    assert.ok(triangleCount > 0);
    for (let i = 0; i < vertices.length; i += 6) {
      const n = [vertices[i + 3], vertices[i + 4], vertices[i + 5]];
      assert.ok(Number.isFinite(n[0]) && Number.isFinite(n[1]) && Number.isFinite(n[2]));
      const len = vec3.length(n);
      assert.ok(len > 0.5 && len < 1.5, `normal length ${len}`);
    }
  });

  it('a sharp corner stays within the miter limit of the centerline', () => {
    const points = [[0, 0, 0], [1, 0, 0], [1, 1, 0]];
    const tangents = [[1, 0, 0], [1, 0, 0], [0, 1, 0]];
    const half = 0.05;
    const { vertices } = extrudeCurveAlongZ(points, tangents, { width: half * 2, depth: 0.2 });
    const limit = half * 2.2 + 1e-4;
    const dist = (x, y) => {
      let best = Infinity;
      for (const p of points) best = Math.min(best, Math.hypot(x - p[0], y - p[1]));
      return best;
    };
    for (let i = 0; i < vertices.length; i += 6) {
      const d = dist(vertices[i], vertices[i + 1]);
      assert.ok(d <= limit, `offset ${d} exceeds miter limit ${limit}`);
    }
  });

  it('sampleCurveForExtrusion returns N+1 samples', () => {
    const { points, tangents } = sampleCurveForExtrusion(
      (u) => ({ p: [u, 0, 0], tan: [1, 0, 0] }),
      () => [1, 0, 0],
      8,
    );
    assert.equal(points.length, 9);
    assert.equal(tangents.length, 9);
  });
});
