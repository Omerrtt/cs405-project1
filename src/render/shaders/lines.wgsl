struct Uniforms {
  mvp: mat4x4f,
}

@group(0) @binding(0) var<uniform> u: Uniforms;

struct VSIn {
  @location(0) position: vec3f,
  @location(1) color: vec3f,
}

struct VSOut {
  @builtin(position) clip: vec4f,
  @location(0) color: vec3f,
}

@vertex
fn vs(input: VSIn) -> VSOut {
  var out: VSOut;
  out.clip = u.mvp * vec4f(input.position, 1.0);
  out.color = input.color;
  return out;
}

@fragment
fn fs(input: VSOut) -> @location(0) vec4f {
  return toOutput(vec4f(input.color, 1.0));
}
