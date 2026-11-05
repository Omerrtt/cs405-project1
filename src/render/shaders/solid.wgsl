struct Uniforms {
  mvp: mat4x4f,
  model: mat4x4f,
  color: vec4f,
}

@group(0) @binding(0) var<uniform> u: Uniforms;

struct VSIn {
  @location(0) position: vec3f,
  @location(1) normal: vec3f,
}

struct VSOut {
  @builtin(position) clip: vec4f,
  @location(0) worldN: vec3f,
}

@vertex
fn vs(input: VSIn) -> VSOut {
  var out: VSOut;
  out.clip = u.mvp * vec4f(input.position, 1.0);
  out.worldN = (u.model * vec4f(input.normal, 0.0)).xyz;
  return out;
}

@fragment
fn fs(input: VSOut) -> @location(0) vec4f {
  let n = normalize(input.worldN);
  let light = normalize(vec3f(0.35, 0.85, 0.45));
  let ambient = 0.28;
  // abs: both sides of a ribbon stay lit when the camera orbits (no black backs).
  let diffuse = abs(dot(n, light));
  let lit = ambient + (1.0 - ambient) * diffuse;
  return toOutput(vec4f(u.color.rgb * lit, u.color.a));
}
