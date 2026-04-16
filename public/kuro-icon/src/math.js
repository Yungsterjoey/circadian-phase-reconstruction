/**
 * KURO::ICON — Minimal Matrix Math
 * 
 * Just enough for camera transforms. No external dep.
 * All matrices are Float32Array(16) in column-major order.
 */

export function mat4Create() {
  const m = new Float32Array(16);
  m[0] = m[5] = m[10] = m[15] = 1;
  return m;
}

export function mat4Perspective(fovY, aspect, near, far) {
  const f = 1.0 / Math.tan(fovY / 2);
  const nf = 1 / (near - far);
  const m = new Float32Array(16);
  m[0] = f / aspect;
  m[5] = f;
  m[10] = (far + near) * nf;
  m[11] = -1;
  m[14] = 2 * far * near * nf;
  return m;
}

export function mat4LookAt(eye, center, up) {
  const m = new Float32Array(16);
  let zx = eye[0] - center[0], zy = eye[1] - center[1], zz = eye[2] - center[2];
  let len = 1 / Math.hypot(zx, zy, zz);
  zx *= len; zy *= len; zz *= len;

  let xx = up[1] * zz - up[2] * zy;
  let xy = up[2] * zx - up[0] * zz;
  let xz = up[0] * zy - up[1] * zx;
  len = 1 / Math.hypot(xx, xy, xz);
  xx *= len; xy *= len; xz *= len;

  let yx = zy * xz - zz * xy;
  let yy = zz * xx - zx * xz;
  let yz = zx * xy - zy * xx;

  m[0] = xx; m[1] = yx; m[2] = zx;
  m[4] = xy; m[5] = yy; m[6] = zy;
  m[8] = xz; m[9] = yz; m[10] = zz;
  m[12] = -(xx * eye[0] + xy * eye[1] + xz * eye[2]);
  m[13] = -(yx * eye[0] + yy * eye[1] + yz * eye[2]);
  m[14] = -(zx * eye[0] + zy * eye[1] + zz * eye[2]);
  m[15] = 1;
  return m;
}

export function mat4Multiply(a, b) {
  const out = new Float32Array(16);
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      out[j * 4 + i] =
        a[i] * b[j * 4] +
        a[4 + i] * b[j * 4 + 1] +
        a[8 + i] * b[j * 4 + 2] +
        a[12 + i] * b[j * 4 + 3];
    }
  }
  return out;
}

export function mat4RotateY(m, angle) {
  const s = Math.sin(angle), c = Math.cos(angle);
  const r = mat4Create();
  r[0] = c; r[2] = -s;
  r[8] = s; r[10] = c;
  return mat4Multiply(m, r);
}

export function mat4RotateX(m, angle) {
  const s = Math.sin(angle), c = Math.cos(angle);
  const r = mat4Create();
  r[5] = c; r[6] = s;
  r[9] = -s; r[10] = c;
  return mat4Multiply(m, r);
}

export function mat4Scale(m, sx, sy, sz) {
  const s = mat4Create();
  s[0] = sx; s[5] = sy; s[10] = sz;
  return mat4Multiply(m, s);
}

export function mat4Translate(m, tx, ty, tz) {
  const t = mat4Create();
  t[12] = tx; t[13] = ty; t[14] = tz;
  return mat4Multiply(m, t);
}

/**
 * Extract upper-left 3×3 normal matrix (inverse transpose of modelView).
 * For uniform scale this is just the 3×3 sub-matrix.
 */
export function mat3NormalFromMat4(mv) {
  const out = new Float32Array(9);
  out[0] = mv[0]; out[1] = mv[1]; out[2] = mv[2];
  out[3] = mv[4]; out[4] = mv[5]; out[5] = mv[6];
  out[6] = mv[8]; out[7] = mv[9]; out[8] = mv[10];
  return out;
}
