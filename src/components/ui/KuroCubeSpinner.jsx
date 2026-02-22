/**
 * KuroCubeSpinner — KURO Phase 3.6
 *
 * Fast-rotating cube spinner with pastel-purple glow.
 * Sizes:
 *   xs — 16px, inline (thinking header, tool row)
 *   sm — 24px, header (reasoning panel header)
 *   md — 40px, center  (full-page loading)
 *
 * CSS lives in liquid-glass.css under the "KuroCubeSpinner" section.
 */

import React from 'react';

const KuroCubeSpinner = ({ size = 'sm', className = '' }) => (
  <span
    className={`kcs kcs-${size}${className ? ` ${className}` : ''}`}
    aria-label="Working…"
    role="status"
  />
);

export default KuroCubeSpinner;
