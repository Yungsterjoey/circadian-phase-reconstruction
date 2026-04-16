// gestureEngine.js — KURO OS gesture physics constants and helpers

export const PHYSICS = {
  ICON_RADIUS: 22,
  SPRING_TENSION: 0.3,
  DAMPING: 0.7,
  SWIPE_THRESHOLD: 80,
  LONG_PRESS_MS: 500,
};

/**
 * rubberBand — apply elastic resistance beyond a scroll boundary.
 * @param {number} distance  — pixels past the boundary (positive)
 * @param {number} dimension — viewport height/width in the scroll axis
 * @returns {number} dampened pixel offset
 */
export function rubberBand(distance, dimension) {
  if (dimension === 0) return 0;
  const c = 0.55; // elasticity coefficient
  return (c * distance * dimension) / (dimension + c * distance);
}
