/**
 * Small reusable mesh / line drawers (same pattern as render/painting.js).
 */
import solidWGSL from './shaders/solid.wgsl?raw';
import linesWGSL from './shaders/lines.wgsl?raw';
import { createShader, fragmentConstants } from './shader.js';
import { DEPTH_FORMAT } from './renderer.js';
import { cube, axes } from '../scene/geometry.js';

const SOLID_UBO = 144; // mvp(64) + model(64) + color(16)

export function createMeshDrawer(gpu) {
  const { device } = gpu;
  const module = createShader(device, solidWGSL, 'solid');
  const pipeline = device.createRenderPipeline({
    label: 'solid-mesh',
    layout: 'auto',
    vertex: {
      module,
      entryPoint: 'vs',
      buffers: [{
        arrayStride: 6 * 4,
        attributes: [
          { shaderLocation: 0, offset: 0, format: 'float32x3' },
          { shaderLocation: 1, offset: 12, format: 'float32x3' },
        ],
      }],
    },
    fragment: {
      module,
      entryPoint: 'fs',
      targets: [{ format: gpu.viewFormat }],
      constants: fragmentConstants(gpu),
    },
    // none: the extruded ribbon is a shell; back-face culling punched holes when orbiting.
    // Closed cubes still look the same (two-sided lighting in the shader).
    primitive: { topology: 'triangle-list', cullMode: 'none' },
    depthStencil: { format: DEPTH_FORMAT, depthWriteEnabled: true, depthCompare: 'less' },
  });

  const cubeVerts = cube();
  const cubeBuffer = device.createBuffer({
    label: 'cube',
    size: cubeVerts.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(cubeBuffer, 0, cubeVerts);
  const cubeCount = cubeVerts.length / 6;

  /** Allocate a per-object uniform buffer + bind group. */
  function alloc() {
    const uniforms = device.createBuffer({
      size: SOLID_UBO,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const bindGroup = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: uniforms } }],
    });
    return { uniforms, bindGroup };
  }

  /**
   * @param {GPURenderPassEncoder} pass
   * @param {{ uniforms: GPUBuffer, bindGroup: GPUBindGroup }} slot
   * @param {Float32Array} mvp
   * @param {Float32Array} model
   * @param {number[]} color  rgb or rgba in linear-ish display space
   * @param {import('./renderer.js').Renderer} renderer
   */
  function drawCube(pass, slot, mvp, model, color, renderer) {
    const data = new Float32Array(36);
    data.set(mvp, 0);
    data.set(model, 16);
    data[32] = color[0]; data[33] = color[1]; data[34] = color[2];
    data[35] = color[3] ?? 1;
    device.queue.writeBuffer(slot.uniforms, 0, data);
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, slot.bindGroup);
    pass.setVertexBuffer(0, cubeBuffer);
    pass.draw(cubeCount);
    renderer.countDraw(cubeCount);
  }

  /** Dynamic triangle-list mesh: interleaved [x,y,z,nx,ny,nz]. */
  let dynBuffer = null;
  let dynCapacity = 0;
  function ensureDyn(bytes) {
    if (dynBuffer && dynCapacity >= bytes) return;
    dynBuffer?.destroy();
    dynCapacity = Math.max(bytes, 65536);
    dynBuffer = device.createBuffer({
      label: 'dynamic-mesh',
      size: dynCapacity,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
  }

  function drawMesh(pass, slot, interleaved, mvp, model, color, renderer) {
    if (!interleaved || interleaved.length < 18) return;
    ensureDyn(interleaved.byteLength);
    const data = new Float32Array(36);
    data.set(mvp, 0);
    data.set(model, 16);
    data[32] = color[0]; data[33] = color[1]; data[34] = color[2];
    data[35] = color[3] ?? 1;
    device.queue.writeBuffer(slot.uniforms, 0, data);
    device.queue.writeBuffer(dynBuffer, 0, interleaved);
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, slot.bindGroup);
    pass.setVertexBuffer(0, dynBuffer);
    const n = interleaved.length / 6;
    pass.draw(n);
    renderer.countDraw(n);
  }

  return { alloc, drawCube, drawMesh, cubeCount };
}

export function createLineDrawer(gpu) {
  const { device } = gpu;
  const module = createShader(device, linesWGSL, 'lines');
  const pipeline = device.createRenderPipeline({
    label: 'lines',
    layout: 'auto',
    vertex: {
      module,
      entryPoint: 'vs',
      buffers: [{
        arrayStride: 6 * 4,
        attributes: [
          { shaderLocation: 0, offset: 0, format: 'float32x3' },
          { shaderLocation: 1, offset: 12, format: 'float32x3' },
        ],
      }],
    },
    fragment: {
      module,
      entryPoint: 'fs',
      targets: [{ format: gpu.viewFormat }],
      constants: fragmentConstants(gpu),
    },
    primitive: { topology: 'line-list' },
    depthStencil: { format: DEPTH_FORMAT, depthWriteEnabled: true, depthCompare: 'less' },
  });

  const uniforms = device.createBuffer({
    size: 64,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: uniforms } }],
  });

  const axesData = axes(0.35);
  const axesBuffer = device.createBuffer({
    size: axesData.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(axesBuffer, 0, axesData);

  let dynBuffer = null;
  let dynCapacity = 0;

  function ensureDyn(bytes) {
    if (dynBuffer && dynCapacity >= bytes) return;
    dynBuffer?.destroy();
    dynCapacity = Math.max(bytes, 4096);
    dynBuffer = device.createBuffer({
      size: dynCapacity,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
  }

  function drawAxes(pass, mvp, renderer) {
    device.queue.writeBuffer(uniforms, 0, mvp);
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.setVertexBuffer(0, axesBuffer);
    pass.draw(6);
    renderer.countDraw(6);
  }

  /** @param {Float32Array} interleaved [x,y,z,r,g,b] * N for line-list */
  function drawLines(pass, mvp, interleaved, renderer) {
    if (!interleaved || interleaved.length < 12) return;
    ensureDyn(interleaved.byteLength);
    device.queue.writeBuffer(dynBuffer, 0, interleaved);
    device.queue.writeBuffer(uniforms, 0, mvp);
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.setVertexBuffer(0, dynBuffer);
    const n = interleaved.length / 6;
    pass.draw(n);
    renderer.countDraw(n);
  }

  return { drawAxes, drawLines };
}
