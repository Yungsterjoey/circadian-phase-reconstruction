/**
 * KURO::ICON — Interaction Manager
 * 
 * Pointer-driven tilt, idle rotation, and accessibility.
 * All motion is deterministic — no random/noise.
 */

import { MOTION, DEG2RAD } from './constants.js';

// Global accessibility state
let reducedMotion = false;
let highContrast = false;

if (typeof window !== 'undefined') {
  const rmq = matchMedia('(prefers-reduced-motion: reduce)');
  reducedMotion = rmq.matches;
  rmq.addEventListener('change', (e) => { reducedMotion = e.matches; });

  const hcq = matchMedia('(prefers-contrast: more)');
  highContrast = hcq.matches;
  hcq.addEventListener('change', (e) => { highContrast = e.matches; });
}

export function isReducedMotion() { return reducedMotion; }
export function isHighContrast() { return highContrast; }

/**
 * Create interaction state for a single icon.
 */
export function createInteraction(element, mode = 'hover') {
  const state = {
    mode,
    // Current orientation (radians)
    yaw: 0,
    pitch: 0,
    // Target orientation (radians) — smooth toward this
    targetYaw: 0,
    targetPitch: 0,
    // Pointer state
    pointerOver: false,
    pointerX: 0,
    pointerY: 0,
    // Timing
    hoverStart: 0,
    hoverLeaveTime: 0,
  };

  if (reducedMotion) {
    state.mode = 'none';
  }

  // Pointer handlers
  const onEnter = (e) => {
    state.pointerOver = true;
    state.hoverStart = performance.now();
    updatePointer(state, element, e);
  };

  const onMove = (e) => {
    if (state.pointerOver) {
      updatePointer(state, element, e);
    }
  };

  const onLeave = () => {
    state.pointerOver = false;
    state.hoverLeaveTime = performance.now();
    state.targetYaw = 0;
    state.targetPitch = 0;
  };

  if (mode === 'hover' && !reducedMotion) {
    element.addEventListener('pointerenter', onEnter);
    element.addEventListener('pointermove', onMove);
    element.addEventListener('pointerleave', onLeave);
  }

  state._cleanup = () => {
    element.removeEventListener('pointerenter', onEnter);
    element.removeEventListener('pointermove', onMove);
    element.removeEventListener('pointerleave', onLeave);
  };

  return state;
}

function updatePointer(state, element, e) {
  const rect = element.getBoundingClientRect();
  // Normalize to [-1, 1]
  state.pointerX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  state.pointerY = ((e.clientY - rect.top) / rect.height) * 2 - 1;

  // Tilt target clamped to max
  const maxTilt = MOTION.maxTiltDeg * DEG2RAD;
  state.targetYaw = clamp(state.pointerX * maxTilt, -maxTilt, maxTilt);
  state.targetPitch = clamp(-state.pointerY * maxTilt, -maxTilt, maxTilt);
}

/**
 * Update interaction state each frame.
 * Returns { yaw, pitch } in radians.
 */
export function tickInteraction(state, time, dt) {
  if (state.mode === 'none' || reducedMotion) {
    return { yaw: 0, pitch: 0 };
  }

  if (state.mode === 'idle') {
    // Gentle continuous rotation
    const yawSpeed = MOTION.idleYawSpeed * DEG2RAD;
    const pitchAmp = MOTION.idlePitchAmplitude * DEG2RAD;
    const pitchFreq = MOTION.idlePitchFrequency;

    state.yaw = (time / 1000) * yawSpeed;
    state.pitch = Math.sin(time / 1000 * pitchFreq * Math.PI * 2) * pitchAmp;

    return { yaw: state.yaw, pitch: state.pitch };
  }

  // Hover mode: smooth toward target
  const smoothing = 1.0 - Math.exp(-dt * 0.008); // ~8ms time constant
  state.yaw += (state.targetYaw - state.yaw) * smoothing;
  state.pitch += (state.targetPitch - state.pitch) * smoothing;

  // Enforce angular velocity limit
  const maxDelta = MOTION.maxAngularVelocity * DEG2RAD * (dt / 1000);
  state.yaw = clamp(state.yaw, state.yaw - maxDelta, state.yaw + maxDelta);
  state.pitch = clamp(state.pitch, state.pitch - maxDelta, state.pitch + maxDelta);

  return { yaw: state.yaw, pitch: state.pitch };
}

export function destroyInteraction(state) {
  if (state._cleanup) state._cleanup();
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}
