/**
 * KURO::ICON — Mesh Cache
 * 
 * Minimal GLB parser. Extracts position, normal, curvature (vertex color R),
 * and indices. Creates WebGL2 VAOs. Manages LOD selection.
 */

import { LOD_THRESHOLDS } from './constants.js';
import { IconRenderer } from './renderer.js';

const cache = new Map(); // name → { lods: [{ vao, indexCount, indexType }], bounds }

/**
 * Parse a binary GLB file into geometry data.
 * Minimal parser — supports single-mesh, single-primitive GLBs
 * as produced by the KURO bevel pipeline.
 */
function parseGLB(buffer) {
  const view = new DataView(buffer);

  // GLB header
  const magic = view.getUint32(0, true);
  if (magic !== 0x46546C67) throw new Error('Not a valid GLB');
  // const version = view.getUint32(4, true);
  // const totalLength = view.getUint32(8, true);

  // Chunk 0: JSON
  const jsonLength = view.getUint32(12, true);
  // const jsonType = view.getUint32(16, true);
  const jsonStr = new TextDecoder().decode(new Uint8Array(buffer, 20, jsonLength));
  const gltf = JSON.parse(jsonStr);

  // Chunk 1: Binary
  const binOffset = 20 + jsonLength;
  const binLength = view.getUint32(binOffset, true);
  // const binType = view.getUint32(binOffset + 4, true);
  const binData = new Uint8Array(buffer, binOffset + 8, binLength);

  // Extract first mesh, first primitive
  const prim = gltf.meshes[0].primitives[0];
  const accessors = gltf.accessors;
  const bufferViews = gltf.bufferViews;

  function getAccessorData(accIdx, TypedArray) {
    const acc = accessors[accIdx];
    const bv = bufferViews[acc.bufferView];
    const offset = (bv.byteOffset || 0) + (acc.byteOffset || 0);
    const count = acc.count;
    const components = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[acc.type];
    return new TypedArray(binData.buffer, binData.byteOffset + offset, count * components);
  }

  // Required: POSITION, NORMAL, indices
  const positions = getAccessorData(prim.attributes.POSITION, Float32Array);
  const normals = prim.attributes.NORMAL !== undefined
    ? getAccessorData(prim.attributes.NORMAL, Float32Array)
    : null;

  // Optional: curvature baked into COLOR_0.r
  let curvatures = null;
  if (prim.attributes.COLOR_0 !== undefined) {
    const colors = getAccessorData(prim.attributes.COLOR_0, Float32Array);
    const stride = accessors[prim.attributes.COLOR_0].type === 'VEC4' ? 4 : 3;
    curvatures = new Float32Array(colors.length / stride);
    for (let i = 0; i < curvatures.length; i++) {
      curvatures[i] = colors[i * stride]; // R channel = curvature
    }
  }

  // Indices
  const idxAcc = accessors[prim.indices];
  const idxBv = bufferViews[idxAcc.bufferView];
  const idxOffset = (idxBv.byteOffset || 0) + (idxAcc.byteOffset || 0);
  const idxComponentType = idxAcc.componentType;
  let indices;
  if (idxComponentType === 5123) { // UNSIGNED_SHORT
    indices = new Uint16Array(binData.buffer, binData.byteOffset + idxOffset, idxAcc.count);
  } else if (idxComponentType === 5125) { // UNSIGNED_INT
    indices = new Uint32Array(binData.buffer, binData.byteOffset + idxOffset, idxAcc.count);
  }

  // Bounding box from accessor
  const posAcc = accessors[prim.attributes.POSITION];
  const bounds = {
    min: posAcc.min,
    max: posAcc.max,
    center: posAcc.min.map((v, i) => (v + posAcc.max[i]) / 2),
    size: posAcc.min.map((v, i) => posAcc.max[i] - v),
  };
  bounds.maxExtent = Math.max(...bounds.size);

  return { positions, normals, curvatures, indices, indexType: idxComponentType, bounds };
}

/**
 * Upload geometry to GPU as VAO.
 */
function createVAO(gl, geometry, attribs) {
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);

  // Position
  const posBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
  gl.bufferData(gl.ARRAY_BUFFER, geometry.positions, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(attribs.position);
  gl.vertexAttribPointer(attribs.position, 3, gl.FLOAT, false, 0, 0);

  // Normal
  if (geometry.normals && attribs.normal >= 0) {
    const normBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, normBuf);
    gl.bufferData(gl.ARRAY_BUFFER, geometry.normals, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(attribs.normal);
    gl.vertexAttribPointer(attribs.normal, 3, gl.FLOAT, false, 0, 0);
  }

  // Curvature
  if (geometry.curvatures && attribs.curvature >= 0) {
    const curvBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, curvBuf);
    gl.bufferData(gl.ARRAY_BUFFER, geometry.curvatures, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(attribs.curvature);
    gl.vertexAttribPointer(attribs.curvature, 1, gl.FLOAT, false, 0, 0);
  } else if (attribs.curvature >= 0) {
    // Default curvature = 0 (no edge highlight)
    gl.disableVertexAttribArray(attribs.curvature);
    gl.vertexAttrib1f(attribs.curvature, 0.0);
  }

  // Indices
  const idxBuf = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxBuf);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, geometry.indices, gl.STATIC_DRAW);

  gl.bindVertexArray(null);

  const glType = geometry.indexType === 5125 ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT;

  return {
    vao,
    indexCount: geometry.indices.length,
    indexType: glType,
  };
}

/**
 * Load a mesh by name. Fetches GLB, parses, uploads to GPU.
 * Returns cached if already loaded.
 * 
 * @param {string} name - Icon name (maps to `/assets/meshes/{name}.glb`)
 * @param {string} [basePath='/kuro-icon/assets/meshes'] - Asset base URL
 * @returns {Promise<{ lods: Array, bounds: Object }>}
 */
export async function loadMesh(name, basePath = '/kuro-icon/assets/meshes') {
  if (cache.has(name)) return cache.get(name);

  const renderer = IconRenderer.get();
  if (renderer.fallback) return null;

  const gl = renderer.gl;

  // For v1, single LOD per mesh (LOD built into asset pipeline)
  // Future: load {name}-lod0.glb, {name}-lod1.glb, etc.
  const url = `${basePath}/${name}.glb`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`KURO::ICON mesh not found: ${url}`);

  const buffer = await response.arrayBuffer();
  const geometry = parseGLB(buffer);

  // Create VAO for glass pass (full attribs)
  const glassVAO = createVAO(gl, geometry, renderer.glassAttribs);

  // Create VAO for thickness pass (position only)
  const thickVAO = createVAO(gl, geometry, {
    position: renderer.thicknessAttribs.position,
    normal: -1,
    curvature: -1,
  });

  const entry = {
    glass: glassVAO,
    thickness: thickVAO,
    bounds: geometry.bounds,
  };

  cache.set(name, entry);
  return entry;
}

/**
 * Select LOD level based on render size.
 */
export function selectLOD(size) {
  for (let i = 0; i < LOD_THRESHOLDS.length; i++) {
    if (size >= LOD_THRESHOLDS[i]) return i;
  }
  return LOD_THRESHOLDS.length - 1;
}

/**
 * Clear all cached meshes.
 */
export function clearMeshCache() {
  cache.clear();
}
