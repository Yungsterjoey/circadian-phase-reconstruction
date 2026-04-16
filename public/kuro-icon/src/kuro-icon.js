/**
 * KURO::ICON — Web Component
 * 
 * <kuro-icon name="glasscube" size="24" motion="hover" theme="auto" />
 * 
 * Renders a Liquid Glass 3D icon inline in the DOM.
 * Single shared WebGL2 context, IntersectionObserver pause,
 * prefers-reduced-motion compliant, SSR fallback via <img> slot.
 */

import { IconRenderer } from './renderer.js';
import { loadMesh } from './mesh-cache.js';
import { getEnvMap, resolveTheme } from './env-cache.js';
import { registerIcon, unregisterIcon } from './frame-loop.js';
import {
  createInteraction, tickInteraction, destroyInteraction,
  isReducedMotion, isHighContrast,
} from './interaction.js';
import {
  mat4Perspective, mat4LookAt, mat4Multiply, mat4RotateY,
  mat4RotateX, mat4Scale, mat4Translate, mat3NormalFromMat4,
} from './math.js';
import { FRAME, DEG2RAD, DEFAULT_SIZE, MIN_SIZE, MAX_SIZE, GLASS_DEFAULTS } from './constants.js';

/**
 * Parse a CSS color string to linear RGB [0–1].
 * Handles hex (#abc, #aabbcc, #aabbccdd), rgb(), rgba().
 */
function parseColor(str) {
  if (!str) return null;
  str = str.trim().toLowerCase();

  // Hex
  if (str.startsWith('#')) {
    let hex = str.slice(1);
    if (hex.length === 3) hex = hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2];
    if (hex.length === 8) hex = hex.slice(0, 6); // drop alpha
    if (hex.length === 6) {
      const r = parseInt(hex.slice(0, 2), 16) / 255;
      const g = parseInt(hex.slice(2, 4), 16) / 255;
      const b = parseInt(hex.slice(4, 6), 16) / 255;
      // sRGB to linear (approximate)
      return [Math.pow(r, 2.2), Math.pow(g, 2.2), Math.pow(b, 2.2)];
    }
  }

  // rgb()/rgba()
  const match = str.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (match) {
    const r = parseInt(match[1]) / 255;
    const g = parseInt(match[2]) / 255;
    const b = parseInt(match[3]) / 255;
    return [Math.pow(r, 2.2), Math.pow(g, 2.2), Math.pow(b, 2.2)];
  }

  return null;
}

class KuroIconElement extends HTMLElement {
  static get observedAttributes() {
    return ['name', 'size', 'motion', 'theme', 'tint', 'dispersion'];
  }

  constructor() {
    super();

    this.attachShadow({ mode: 'open' });

    // Internal canvas for rendering
    this._canvas = document.createElement('canvas');
    this._ctx = this._canvas.getContext('2d');

    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: inline-block;
          vertical-align: -0.125em;
          line-height: 1;
          contain: layout style paint;
        }
        canvas {
          display: block;
          width: 100%;
          height: 100%;
          image-rendering: auto;
        }
        ::slotted(img) {
          display: block;
          width: 100%;
          height: 100%;
        }
        :host(.kuro-icon-ready) ::slotted(img) {
          display: none;
        }
      </style>
      <slot></slot>
    `;

    this._interaction = null;
    this._mesh = null;
    this._ready = false;
    this._renderBound = this._renderFrame.bind(this);
  }

  connectedCallback() {
    this._updateSize();
    this._init();
    registerIcon(this);
  }

  disconnectedCallback() {
    unregisterIcon(this);
    if (this._interaction) destroyInteraction(this._interaction);
  }

  attributeChangedCallback(attr, oldVal, newVal) {
    if (oldVal === newVal) return;
    if (attr === 'size') this._updateSize();
    if (attr === 'name' && this._ready) this._loadMesh();
    if (attr === 'motion' && this._interaction) {
      destroyInteraction(this._interaction);
      this._interaction = createInteraction(this, this.motionMode);
    }
  }

  // ─── Attribute Accessors ───

  get iconName() { return this.getAttribute('name') || 'glasscube'; }
  get iconSize() {
    const s = parseInt(this.getAttribute('size')) || DEFAULT_SIZE;
    return Math.max(MIN_SIZE, Math.min(MAX_SIZE, s));
  }
  get motionMode() { return this.getAttribute('motion') || 'hover'; }
  get themeMode() { return this.getAttribute('theme') || 'auto'; }
  get tint() { return this.getAttribute('tint') || null; }
  get dispersion() { return this.hasAttribute('dispersion'); }

  // ─── Initialization ───

  async _init() {
    const renderer = IconRenderer.get();
    if (renderer.fallback) return; // poster fallback only

    await this._loadMesh();

    // Set up interaction
    this._interaction = createInteraction(this, this.motionMode);

    // Append canvas to shadow DOM
    this.shadowRoot.appendChild(this._canvas);
    this.classList.add('kuro-icon-ready');
    this._ready = true;

    // Expose render callback for frame loop
    this._kuroRender = this._renderBound;
  }

  _updateSize() {
    const size = this.iconSize;
    const dpr = Math.min(window.devicePixelRatio || 1, 2); // cap at 2×
    const px = size * dpr;
    this._canvas.width = px;
    this._canvas.height = px;
    this.style.width = `${size}px`;
    this.style.height = `${size}px`;
    this._renderSize = px;
  }

  async _loadMesh() {
    try {
      this._mesh = await loadMesh(this.iconName);
    } catch (e) {
      console.warn(`KURO::ICON — Failed to load mesh "${this.iconName}":`, e.message);
    }
  }

  // ─── Per-Frame Render ───

  _renderFrame(time, dt) {
    if (!this._mesh || !this._ready) return;

    const renderer = IconRenderer.get();
    if (renderer.fallback) return;

    const size = this._renderSize;
    const mesh = this._mesh;
    const bounds = mesh.bounds;

    // Interaction update
    const orient = tickInteraction(this._interaction, time, dt);

    // ── Camera Setup ──
    const aspect = 1; // square icon
    const fov = FRAME.fov * DEG2RAD;
    const distance = (bounds.maxExtent * FRAME.fill) / Math.tan(fov / 2);

    // Eye position: default angle + interaction tilt
    const baseYaw = FRAME.defaultYaw * DEG2RAD + orient.yaw;
    const basePitch = FRAME.defaultPitch * DEG2RAD + orient.pitch;

    const eyeX = Math.sin(baseYaw) * Math.cos(basePitch) * distance;
    const eyeY = Math.sin(basePitch) * distance;
    const eyeZ = Math.cos(baseYaw) * Math.cos(basePitch) * distance;

    const eye = [
      eyeX + bounds.center[0],
      eyeY + bounds.center[1],
      eyeZ + bounds.center[2],
    ];

    const proj = mat4Perspective(fov, aspect, distance * 0.1, distance * 10);
    const view = mat4LookAt(eye, bounds.center, [0, 1, 0]);

    // Model: center + scale to fit
    const scale = FRAME.fill / bounds.maxExtent;
    let model = mat4Translate(
      mat4Scale(
        mat4Translate(
          mat4RotateX(mat4RotateY(
            mat4Scale(
              mat4Translate(
                new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]),
                -bounds.center[0], -bounds.center[1], -bounds.center[2]
              ),
              scale, scale, scale
            ),
            0 // additional rotation already in eye position
          ), 0),
          bounds.center[0], bounds.center[1], bounds.center[2]
        ),
        1, 1, 1
      ),
      0, 0, 0
    );

    // Simplify: just use identity model, camera handles everything
    const identity = new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]);
    const mv = view; // model is identity
    const mvp = mat4Multiply(proj, mv);
    const normalMat = mat3NormalFromMat4(mv);

    // Theme + env
    const theme = resolveTheme(this.themeMode);
    const env = getEnvMap(renderer.gl, theme);

    // Material overrides
    const material = { ...GLASS_DEFAULTS };
    const tintColor = parseColor(this.tint);
    if (tintColor) material.tintOverride = tintColor;
    material.dispersion = this.dispersion;

    // Light direction (theme-dependent)
    const lightDir = theme === 'dark'
      ? [0.5, 0.8, 0.6]   // warm from upper-right
      : [0.3, 0.9, 0.4];  // cooler, more overhead

    // Render
    renderer.render({
      targetCtx: this._ctx,
      mesh: mesh.glass,       // glass pass uses full VAO
      material,
      camera: { mvp, mv, normalMat },
      env,
      size,
      state: {
        lightDir,
        lightIntensity: theme === 'dark' ? 1.2 : 1.5,
        highContrast: isHighContrast(),
      },
    });
  }
}

// Register the custom element
if (typeof customElements !== 'undefined' && !customElements.get('kuro-icon')) {
  customElements.define('kuro-icon', KuroIconElement);
}

// ─── Imperative API ───

export function renderIcon({ name, size, motion, theme, tint, backgroundHint }) {
  const el = document.createElement('kuro-icon');
  el.setAttribute('name', name);
  if (size) el.setAttribute('size', String(size));
  if (motion) el.setAttribute('motion', motion);
  if (theme) el.setAttribute('theme', theme);
  if (tint) el.setAttribute('tint', tint);
  return el;
}

export { KuroIconElement };
