/**
 * KURO::ICON — Constants & Material Defaults
 */

export const DEG2RAD = Math.PI / 180;
export const PI = Math.PI;

// Size constraints
export const MIN_SIZE = 16;
export const MAX_SIZE = 128;
export const DEFAULT_SIZE = 24;

// LOD thresholds (px)
export const LOD_THRESHOLDS = [64, 32, 0]; // LOD 0 ≥64, LOD 1 ≥32, LOD 2 ≥0

// Default glass material
export const GLASS_DEFAULTS = {
  ior: 1.50,
  thickness: 0.6,
  absorptionColor: [0.92, 0.88, 1.0], // subtle violet tint (KURO brand)
  absorptionDensity: 1.2,
  roughness: 0.12,
  specularClamp: 0.6,
  fresnelF0: 0.04,
  refractionStrength: 0.15,
  refractionClamp: 8.0, // max texel offset
  dispersionStrength: 0.008,
};

// Camera framing
export const FRAME = {
  fill: 0.75,       // 75% of canvas
  fov: 12,          // degrees — near-orthographic
  defaultYaw: 15,   // degrees
  defaultPitch: -10, // degrees
};

// Motion limits
export const MOTION = {
  maxTiltDeg: 12,
  maxAngularVelocity: 15, // deg/sec
  idleYawSpeed: 4,         // deg/sec
  idlePitchAmplitude: 2,   // degrees
  idlePitchFrequency: 0.3, // Hz
  hoverEaseBack: 600,      // ms
  easing: 'cubic-bezier(0.33, 0, 0.2, 1)',
};

// PMREM mip levels
export const PMREM_LEVELS = 5;
export const PMREM_FACE_SIZE = 64;

// Performance
export const MAX_VISIBLE_ICONS = 30;
export const THICKNESS_FBO_SCALE = 1.0; // 1:1 with icon size
