/**
 * KURO::ICON — Shared WebGL2 Renderer
 * 
 * Single WebGL2 context shared across all <kuro-icon> elements.
 * Dual-pass pipeline: thickness → glass composite.
 * Canvas results transferred via drawImage (Safari-safe).
 */

import {
  THICKNESS_VERT, THICKNESS_FRAG,
  GLASS_VERT, GLASS_FRAG,
  createProgram, uploadGlassUniforms
} from './glass-material.js';
import { GLASS_DEFAULTS, DEG2RAD, FRAME, MAX_SIZE } from './constants.js';

let _instance = null;

export class IconRenderer {
  /** @returns {IconRenderer} Singleton */
  static get() {
    if (!_instance) _instance = new IconRenderer();
    return _instance;
  }

  constructor() {
    // Hidden render canvas (shared context)
    this.canvas = document.createElement('canvas');
    this.canvas.width = MAX_SIZE;
    this.canvas.height = MAX_SIZE;

    const opts = {
      alpha: true,
      antialias: true,
      premultipliedAlpha: false,
      preserveDrawingBuffer: true, // needed for drawImage copy
      powerPreference: 'low-power',
    };

    this.gl = this.canvas.getContext('webgl2', opts);
    if (!this.gl) {
      console.warn('KURO::ICON — WebGL2 unavailable, falling back to posters');
      this.fallback = true;
      return;
    }

    this.fallback = false;
    this._initPipeline();
    this._initFBOs(MAX_SIZE);
  }

  _initPipeline() {
    const gl = this.gl;

    // Compile shader programs
    this.thicknessProgram = createProgram(gl, THICKNESS_VERT, THICKNESS_FRAG);
    this.glassProgram = createProgram(gl, GLASS_VERT, GLASS_FRAG);

    // Cache attribute locations
    this.thicknessAttribs = {
      position: gl.getAttribLocation(this.thicknessProgram, 'aPosition'),
    };
    this.glassAttribs = {
      position: gl.getAttribLocation(this.glassProgram, 'aPosition'),
      normal: gl.getAttribLocation(this.glassProgram, 'aNormal'),
      curvature: gl.getAttribLocation(this.glassProgram, 'aCurvature'),
    };

    // Cache uniform locations for glass program
    this.glassUniforms = {};
    const names = [
      'uModelViewProjection', 'uModelView', 'uNormalMatrix',
      'uThicknessMap', 'uBackground', 'uEnvMap',
    ];
    for (const name of names) {
      this.glassUniforms[name] = gl.getUniformLocation(this.glassProgram, name);
    }
    this.thicknessUniforms = {
      mvp: gl.getUniformLocation(this.thicknessProgram, 'uModelViewProjection'),
      mv: gl.getUniformLocation(this.thicknessProgram, 'uModelView'),
    };

    // Enable depth + blending
    gl.enable(gl.DEPTH_TEST);
  }

  _initFBOs(size) {
    const gl = this.gl;

    // ── Thickness FBO ──
    this.thicknessTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.thicknessTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16F, size, size, 0, gl.RED, gl.HALF_FLOAT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    this.thicknessDepth = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, this.thicknessDepth);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, size, size);

    this.thicknessFBO = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.thicknessFBO);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.thicknessTex, 0);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.thicknessDepth);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    this.fboSize = size;
  }

  /**
   * Render a single icon to a target 2D canvas context.
   * 
   * @param {Object} opts
   * @param {CanvasRenderingContext2D} opts.targetCtx - 2D context to draw into
   * @param {Object} opts.mesh - { vao, indexCount, indexType }
   * @param {Object} opts.material - glass parameter overrides
   * @param {Object} opts.camera - { mvp, mv, normalMat }
   * @param {Object} opts.env - { cubeTexture, maxLod }
   * @param {number} opts.size - render resolution
   * @param {Object} opts.state - { lightDir, lightIntensity, highContrast, ... }
   */
  render(opts) {
    if (this.fallback) return;

    const gl = this.gl;
    const { targetCtx, mesh, material, camera, env, size, state } = opts;

    // Resize shared canvas if needed
    if (this.canvas.width !== size || this.canvas.height !== size) {
      this.canvas.width = size;
      this.canvas.height = size;
      this._initFBOs(size);
    }

    // ════════════════════════════════
    // PASS 1: THICKNESS BUFFER
    // ════════════════════════════════
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.thicknessFBO);
    gl.viewport(0, 0, size, size);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    gl.useProgram(this.thicknessProgram);
    gl.uniformMatrix4fv(this.thicknessUniforms.mvp, false, camera.mvp);
    gl.uniformMatrix4fv(this.thicknessUniforms.mv, false, camera.mv);

    // Render BACK faces for thickness
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.FRONT); // draw back faces
    gl.bindVertexArray(mesh.vao);
    gl.drawElements(gl.TRIANGLES, mesh.indexCount, mesh.indexType, 0);

    // ════════════════════════════════
    // PASS 2: GLASS COMPOSITE
    // ════════════════════════════════
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); // render to screen
    gl.viewport(0, 0, size, size);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    gl.useProgram(this.glassProgram);

    // Camera matrices
    gl.uniformMatrix4fv(this.glassUniforms.uModelViewProjection, false, camera.mvp);
    gl.uniformMatrix4fv(this.glassUniforms.uModelView, false, camera.mv);
    gl.uniformMatrix3fv(this.glassUniforms.uNormalMatrix, false, camera.normalMat);

    // Bind thickness texture
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.thicknessTex);
    gl.uniform1i(this.glassUniforms.uThicknessMap, 0);

    // Bind environment map
    if (env && env.cubeTexture) {
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_CUBE_MAP, env.cubeTexture);
      gl.uniform1i(this.glassUniforms.uEnvMap, 2);
    }

    // Upload material uniforms
    uploadGlassUniforms(gl, this.glassProgram, material, {
      ...state,
      width: size,
      height: size,
      envMaxLod: env ? env.maxLod : 4.0,
    });

    // Render FRONT faces for final composite
    gl.cullFace(gl.BACK);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    gl.bindVertexArray(mesh.vao);
    gl.drawElements(gl.TRIANGLES, mesh.indexCount, mesh.indexType, 0);

    gl.disable(gl.BLEND);
    gl.bindVertexArray(null);

    // ════════════════════════════════
    // COPY TO TARGET CANVAS
    // ════════════════════════════════
    targetCtx.clearRect(0, 0, size, size);
    targetCtx.drawImage(this.canvas, 0, 0);
  }

  /** Clean up (unlikely needed for singleton, but available) */
  destroy() {
    if (this.gl) {
      this.gl.getExtension('WEBGL_lose_context')?.loseContext();
    }
    _instance = null;
  }
}
