/**
 * KURO::ICON — Liquid Glass Material
 * 
 * Two-pass pipeline:
 *   Pass 1: Thickness buffer (back-face depth - front-face depth)
 *   Pass 2: Glass composite (refraction + absorption + specular)
 * 
 * All shaders enforce stability: clamped specular, no noise,
 * deterministic sampling, prefiltered env only.
 */

import { GLASS_DEFAULTS, PI } from './constants.js';

// ═══════════════════════════════════════════════════════
// PASS 1: THICKNESS
// ═══════════════════════════════════════════════════════

export const THICKNESS_VERT = `#version 300 es
precision highp float;

uniform mat4 uModelViewProjection;
uniform mat4 uModelView;

in vec3 aPosition;

out float vViewDepth;

void main() {
  vec4 viewPos = uModelView * vec4(aPosition, 1.0);
  vViewDepth = -viewPos.z; // positive depth
  gl_Position = uModelViewProjection * vec4(aPosition, 1.0);
}
`;

export const THICKNESS_FRAG = `#version 300 es
precision highp float;

in float vViewDepth;
out vec4 fragColor;

void main() {
  // Store linear depth — will subtract front from back externally
  fragColor = vec4(vViewDepth, 0.0, 0.0, 1.0);
}
`;

// ═══════════════════════════════════════════════════════
// PASS 2: GLASS COMPOSITE
// ═══════════════════════════════════════════════════════

export const GLASS_VERT = `#version 300 es
precision highp float;

uniform mat4 uModelViewProjection;
uniform mat4 uModelView;
uniform mat3 uNormalMatrix;

in vec3 aPosition;
in vec3 aNormal;
in float aCurvature; // baked curvature for edge highlight

out vec3 vNormal;
out vec3 vViewPos;
out vec2 vScreenUV;
out float vCurvature;

void main() {
  vec4 viewPos = uModelView * vec4(aPosition, 1.0);
  vViewPos = viewPos.xyz;
  vNormal = normalize(uNormalMatrix * aNormal);
  vCurvature = aCurvature;
  
  vec4 clipPos = uModelViewProjection * vec4(aPosition, 1.0);
  gl_Position = clipPos;
  
  // Screen UV for background sampling
  vScreenUV = (clipPos.xy / clipPos.w) * 0.5 + 0.5;
}
`;

export const GLASS_FRAG = `#version 300 es
precision highp float;

// Material uniforms
uniform float uIOR;
uniform float uThicknessScale;
uniform vec3 uAbsorptionColor;
uniform float uAbsorptionDensity;
uniform float uRoughness;
uniform float uSpecularClamp;
uniform float uFresnelF0;
uniform float uRefractionStrength;
uniform float uRefractionClamp;
uniform float uDispersionStrength; // 0 = disabled
uniform vec3 uTintOverride;       // vec3(0) = no override
uniform float uTintOverrideAlpha; // 0 = use absorption, 1 = use tint

// Environment + scene
uniform sampler2D uThicknessMap;
uniform sampler2D uBackground;    // captured behind-content
uniform samplerCube uEnvMap;      // prefiltered PMREM
uniform float uEnvMaxLod;         // max mip level
uniform vec3 uLightDir;           // primary directional light
uniform float uLightIntensity;

// Render state
uniform vec2 uResolution;
uniform float uOpacityBoost;      // for prefers-contrast: more

in vec3 vNormal;
in vec3 vViewPos;
in vec2 vScreenUV;
in float vCurvature;

out vec4 fragColor;

const float PI = 3.14159265359;

// ─── Fresnel (Schlick) ───
float fresnel(float cosTheta, float f0) {
  return f0 + (1.0 - f0) * pow(clamp(1.0 - cosTheta, 0.0, 1.0), 5.0);
}

// ─── GGX Distribution ───
float D_GGX(float NoH, float roughness) {
  float a = roughness * roughness;
  float a2 = a * a;
  float denom = NoH * NoH * (a2 - 1.0) + 1.0;
  return a2 / (PI * denom * denom);
}

// ─── Smith Geometry ───
float G_Smith(float NoV, float NoL, float roughness) {
  float k = (roughness + 1.0) * (roughness + 1.0) / 8.0;
  float gv = NoV / (NoV * (1.0 - k) + k);
  float gl = NoL / (NoL * (1.0 - k) + k);
  return gv * gl;
}

// ─── Beer–Lambert Absorption ───
vec3 beerLambert(vec3 baseColor, float thickness, float density) {
  return exp(-density * thickness * (1.0 - baseColor));
}

void main() {
  vec3 N = normalize(vNormal);
  vec3 V = normalize(-vViewPos);
  vec3 L = normalize(uLightDir);
  vec3 H = normalize(V + L);
  
  float NoV = max(dot(N, V), 0.001);
  float NoL = max(dot(N, L), 0.0);
  float NoH = max(dot(N, H), 0.0);
  float VoH = max(dot(V, H), 0.0);
  
  // ─── Sample thickness ───
  vec2 thickUV = gl_FragCoord.xy / uResolution;
  float thickness = texture(uThicknessMap, thickUV).r * uThicknessScale;
  thickness = clamp(thickness, 0.05, 2.0);
  
  // ─── Fresnel ───
  float F = fresnel(NoV, uFresnelF0);
  
  // ─── Refraction ───
  // Compute refraction direction offset in screen space
  vec3 refrDir = refract(-V, N, 1.0 / uIOR);
  vec2 refrOffset = refrDir.xy * thickness * uRefractionStrength;
  
  // Clamp offset to prevent wild distortion
  float offsetLen = length(refrOffset * uResolution);
  if (offsetLen > uRefractionClamp) {
    refrOffset *= uRefractionClamp / offsetLen;
  }
  
  vec3 refractedColor;
  if (uDispersionStrength > 0.001) {
    // Chromatic dispersion (subtle RGB split)
    vec2 offR = refrOffset * (1.0 + uDispersionStrength);
    vec2 offG = refrOffset;
    vec2 offB = refrOffset * (1.0 - uDispersionStrength);
    refractedColor = vec3(
      texture(uBackground, vScreenUV + offR).r,
      texture(uBackground, vScreenUV + offG).g,
      texture(uBackground, vScreenUV + offB).b
    );
  } else {
    refractedColor = texture(uBackground, vScreenUV + refrOffset).rgb;
  }
  
  // ─── Absorption ───
  vec3 absColor = mix(uAbsorptionColor, uTintOverride, uTintOverrideAlpha);
  vec3 absorption = beerLambert(absColor, thickness, uAbsorptionDensity);
  refractedColor *= absorption;
  
  // ─── Specular (GGX) ───
  float D = D_GGX(NoH, uRoughness);
  float G = G_Smith(NoV, NoL, uRoughness);
  float spec = (D * G * F) / (4.0 * NoV * NoL + 0.001);
  spec = min(spec, uSpecularClamp); // ANTI-FLICKER CLAMP
  
  // ─── Environment reflection ───
  vec3 R = reflect(-V, N);
  float lod = uRoughness * uEnvMaxLod;
  vec3 envColor = textureLod(uEnvMap, R, lod).rgb;
  
  // ─── Curvature edge highlight ───
  // Soft bright edge where curvature is high (bevel highlights)
  float edgeHighlight = smoothstep(0.3, 0.8, vCurvature) * 0.15;
  
  // ─── Composite ───
  vec3 reflection = envColor * F;
  vec3 refraction = refractedColor * (1.0 - F);
  vec3 color = refraction + reflection;
  color += vec3(spec * NoL * uLightIntensity);
  color += vec3(edgeHighlight) * absorption; // tinted edge glow
  
  // Alpha: glass is mostly transparent, edges more opaque via Fresnel
  float alpha = mix(0.15, 0.85, F);
  alpha += edgeHighlight;
  alpha = clamp(alpha + uOpacityBoost, 0.0, 1.0);
  
  fragColor = vec4(color, alpha);
}
`;

// ═══════════════════════════════════════════════════════
// SHADER COMPILATION UTILITY
// ═══════════════════════════════════════════════════════

export function compileShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`KURO::ICON shader compile failed:\n${log}`);
  }
  return shader;
}

export function createProgram(gl, vertSrc, fragSrc) {
  const vs = compileShader(gl, gl.VERTEX_SHADER, vertSrc);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fragSrc);
  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(prog);
    gl.deleteProgram(prog);
    throw new Error(`KURO::ICON program link failed:\n${log}`);
  }
  // Clean up individual shaders
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  return prog;
}

// ═══════════════════════════════════════════════════════
// MATERIAL UNIFORM UPLOADER
// ═══════════════════════════════════════════════════════

export function uploadGlassUniforms(gl, program, material, state) {
  const m = { ...GLASS_DEFAULTS, ...material };
  const loc = (name) => gl.getUniformLocation(program, name);

  gl.uniform1f(loc('uIOR'), m.ior);
  gl.uniform1f(loc('uThicknessScale'), m.thickness);
  gl.uniform3fv(loc('uAbsorptionColor'), m.absorptionColor);
  gl.uniform1f(loc('uAbsorptionDensity'), m.absorptionDensity);
  gl.uniform1f(loc('uRoughness'), m.roughness);
  gl.uniform1f(loc('uSpecularClamp'), m.specularClamp);
  gl.uniform1f(loc('uFresnelF0'), m.fresnelF0);
  gl.uniform1f(loc('uRefractionStrength'), m.refractionStrength);
  gl.uniform1f(loc('uRefractionClamp'), m.refractionClamp);
  gl.uniform1f(loc('uDispersionStrength'), m.dispersion ? m.dispersionStrength : 0.0);

  // Tint override
  if (m.tintOverride) {
    gl.uniform3fv(loc('uTintOverride'), m.tintOverride);
    gl.uniform1f(loc('uTintOverrideAlpha'), 1.0);
  } else {
    gl.uniform3fv(loc('uTintOverride'), [0, 0, 0]);
    gl.uniform1f(loc('uTintOverrideAlpha'), 0.0);
  }

  // Environment
  gl.uniform1f(loc('uEnvMaxLod'), state.envMaxLod || 4.0);
  gl.uniform3fv(loc('uLightDir'), state.lightDir || [0.5, 0.8, 0.6]);
  gl.uniform1f(loc('uLightIntensity'), state.lightIntensity || 1.2);
  gl.uniform2fv(loc('uResolution'), [state.width, state.height]);
  gl.uniform1f(loc('uOpacityBoost'), state.highContrast ? 0.3 : 0.0);
}
