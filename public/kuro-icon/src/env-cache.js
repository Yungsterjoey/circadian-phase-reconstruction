/**
 * KURO::ICON — Environment Map Cache
 * 
 * Generates deterministic prefiltered cubemaps procedurally.
 * No external HDR files needed. Produces soft studio lighting
 * appropriate for glass material at icon scale.
 * 
 * Dark theme: warm/cool studio, subtle
 * Light theme: brighter, cooler tones
 */

import { PMREM_LEVELS, PMREM_FACE_SIZE } from './constants.js';

const envCache = new Map(); // 'dark' | 'light' → WebGLTexture

const FACE_ORDER = [
  'px', 'nx', 'py', 'ny', 'pz', 'nz'
];

/**
 * Generate a smooth studio environment face.
 * Creates soft gradients that produce pleasant glass reflections
 * without high-frequency detail (which causes sparkle).
 */
function generateFace(size, face, theme) {
  const data = new Uint8Array(size * size * 4);
  const isDark = theme === 'dark';

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Normalized coordinates [-1, 1]
      const u = (x / (size - 1)) * 2 - 1;
      const v = (y / (size - 1)) * 2 - 1;

      let r, g, b;

      if (isDark) {
        // Dark theme: warm key light from above-right, cool fill from left
        const keyLight = Math.max(0, 0.3 + 0.4 * (1 - v) * (1 + u * 0.3));
        const fillLight = Math.max(0, 0.08 + 0.06 * (1 + v));

        r = Math.min(255, (keyLight * 0.95 + fillLight * 0.5) * 255);
        g = Math.min(255, (keyLight * 0.88 + fillLight * 0.55) * 255);
        b = Math.min(255, (keyLight * 0.82 + fillLight * 0.7) * 255);

        // Face-dependent variation for 3D feel
        if (face === 'py') { r *= 1.1; g *= 1.05; } // top brighter/warmer
        if (face === 'ny') { r *= 0.5; g *= 0.5; b *= 0.6; } // bottom darker/cooler
        if (face === 'nx') { b *= 1.15; } // left cooler fill
      } else {
        // Light theme: brighter, cooler
        const keyLight = Math.max(0, 0.5 + 0.35 * (1 - v));
        const fillLight = 0.25;

        r = Math.min(255, (keyLight * 0.92 + fillLight) * 255);
        g = Math.min(255, (keyLight * 0.94 + fillLight) * 255);
        b = Math.min(255, (keyLight * 1.0 + fillLight) * 255);

        if (face === 'py') { r *= 1.05; g *= 1.05; b *= 1.05; }
        if (face === 'ny') { r *= 0.7; g *= 0.72; b *= 0.78; }
      }

      const idx = (y * size + x) * 4;
      data[idx] = Math.min(255, Math.max(0, r));
      data[idx + 1] = Math.min(255, Math.max(0, g));
      data[idx + 2] = Math.min(255, Math.max(0, b));
      data[idx + 3] = 255;
    }
  }

  return data;
}

/**
 * Simple box blur for generating mip levels (PMREM approximation).
 */
function blurFace(data, size, passes) {
  const buf = new Uint8Array(data.length);
  let src = data, dst = buf;

  for (let p = 0; p < passes; p++) {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        let rSum = 0, gSum = 0, bSum = 0, count = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = Math.max(0, Math.min(size - 1, x + dx));
            const ny = Math.max(0, Math.min(size - 1, y + dy));
            const idx = (ny * size + nx) * 4;
            rSum += src[idx]; gSum += src[idx + 1]; bSum += src[idx + 2];
            count++;
          }
        }
        const idx = (y * size + x) * 4;
        dst[idx] = rSum / count;
        dst[idx + 1] = gSum / count;
        dst[idx + 2] = bSum / count;
        dst[idx + 3] = 255;
      }
    }
    [src, dst] = [dst, src];
  }

  return src;
}

/**
 * Create prefiltered environment cubemap.
 * @param {WebGL2RenderingContext} gl
 * @param {'dark'|'light'} theme
 * @returns {{ cubeTexture: WebGLTexture, maxLod: number }}
 */
export function getEnvMap(gl, theme = 'dark') {
  if (envCache.has(theme)) return envCache.get(theme);

  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_CUBE_MAP, tex);

  const targets = [
    gl.TEXTURE_CUBE_MAP_POSITIVE_X,
    gl.TEXTURE_CUBE_MAP_NEGATIVE_X,
    gl.TEXTURE_CUBE_MAP_POSITIVE_Y,
    gl.TEXTURE_CUBE_MAP_NEGATIVE_Y,
    gl.TEXTURE_CUBE_MAP_POSITIVE_Z,
    gl.TEXTURE_CUBE_MAP_NEGATIVE_Z,
  ];

  const baseSize = PMREM_FACE_SIZE;

  // Generate base level (mip 0)
  for (let i = 0; i < 6; i++) {
    const faceData = generateFace(baseSize, FACE_ORDER[i], theme);
    gl.texImage2D(targets[i], 0, gl.RGBA, baseSize, baseSize, 0, gl.RGBA, gl.UNSIGNED_BYTE, faceData);
  }

  // Generate blurred mip levels (PMREM approximation)
  for (let level = 1; level < PMREM_LEVELS; level++) {
    const mipSize = Math.max(1, baseSize >> level);
    const blurPasses = level * 3; // more blur at higher mips

    for (let i = 0; i < 6; i++) {
      let faceData = generateFace(mipSize, FACE_ORDER[i], theme);
      faceData = blurFace(faceData, mipSize, blurPasses);
      gl.texImage2D(targets[i], level, gl.RGBA, mipSize, mipSize, 0, gl.RGBA, gl.UNSIGNED_BYTE, faceData);
    }
  }

  gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  const entry = {
    cubeTexture: tex,
    maxLod: PMREM_LEVELS - 1,
  };

  envCache.set(theme, entry);
  return entry;
}

/**
 * Resolve theme from attribute + system preference.
 */
export function resolveTheme(themeAttr) {
  if (themeAttr === 'dark' || themeAttr === 'light') return themeAttr;
  // Auto: detect from system
  if (typeof window !== 'undefined' && matchMedia('(prefers-color-scheme: light)').matches) {
    return 'light';
  }
  return 'dark';
}
