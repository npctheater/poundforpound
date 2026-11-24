// The game's heavy bag geometry, built in the browser the same way Unity builds it at runtime.
//
// A line-for-line port of `Unity VR Boxing/Assets/VRBoxing/Shared/Bag/Look/HeavyBagV2Geometry.cs` (the shipped
// Black & Gold v2 bag: 84-segment lathe with stuffed panels and welts, four straps, D-rings, four-leg chain, master
// ring, swivel, upper chain, hook, hoist links), whose numbers mirror the Art source of truth
// `Art/Gear/HeavyBag/v2-20261001/Source/bagv2_common.py`. Nothing is downloaded for the mesh: the generator is the
// asset. Everything is computed in Unity's left-handed frame (hide-local, +Y up, bottom at 0) and mirrored to
// three.js's right-handed frame at the very end (z -> -z, tangent sign flipped, triangle winding reversed).
//
// Vertex attributes match the Unity shader's inputs: color.r = chain-metal tint, color.g = hardware tint,
// color.a = jolt weight; uv = atlas, uv1 = (leather) metric grain UV / (metal) (hoist mode, distance along chain).
import * as THREE from 'three';

export const R = 0.212, H = 1.516, SEG = 84, PANELS = 6, SEAM_U0 = 0.5 / PANELS;
export const Z_BOTTOM_SEAM = 0.062, Z_SHOULDER_SEAM = 1.383;
const STRAP_W = 0.040, D_RING_Z = 1.570, D_RING_R = 0.150;
export const MASTER_Z = 2.00;
// the shipping hook pin in hide-local units (bagv2_common.HOOK_PIN_Z): (bag-swing 3.3050 - hide bottom 0.6134) / 1.0086
export const HOOK_PIN_Y = 2.669;
const ATLAS_HIDE_V = 0.875, ATLAS_STRAP_V0 = 0.875, ATLAS_STRAP_V1 = 0.9375, STRAP_ATLAS_LEN = 0.34, GRAIN_TILE = 0.06;
const METAL_UV = [0.06, 0.97];
const LEATHER = [0, 0, 0, 0], CHAIN_METAL = [1, 0, 0, 0], HARDWARE = [0, 1, 0, 0];
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const UP = V(0, 1, 0), RIGHT = V(1, 0, 0), FWD = V(0, 0, 1);
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const repeat1 = (t) => t - Math.floor(t);

function profile() {
  const pts = [];
  for (let i = 0; i <= 6; i++) { const r = 0.150 * i / 6; pts.push([r, 0.008 * (1 - (r / 0.150) ** 2)]); }
  { const cx = 0.150, cz = Z_BOTTOM_SEAM, ax = R - 0.150, az = Z_BOTTOM_SEAM;
    for (let i = 1; i <= 8; i++) { const t = Math.PI / 2 * i / 8; pts.push([cx + ax * Math.sin(t), cz - az * Math.cos(t)]); } }
  let z = Z_BOTTOM_SEAM; const step = 0.016;
  while (z + step < Z_SHOULDER_SEAM - 0.001) { z += step; pts.push([R, z]); }
  pts.push([R, Z_SHOULDER_SEAM]);
  { const cx = 0.140, cz = Z_SHOULDER_SEAM, ax = R - 0.140, az = (H - 0.020) - Z_SHOULDER_SEAM;
    for (let i = 1; i <= 10; i++) { const t = Math.PI / 2 * i / 10; pts.push([cx + ax * Math.cos(t), cz + az * Math.sin(t)]); } }
  for (let i = 1; i <= 7; i++) { const r = 0.140 * (1 - i / 7); pts.push([r, (H - 0.020) + 0.020 * (1 - (r / 0.140) ** 2)]); }
  const o = []; let s = 0;
  for (let i = 0; i < pts.length; i++) {
    if (i > 0) s += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    o.push({ r: pts[i][0], y: pts[i][1], s });
  }
  return o;
}
function welt(z) {
  const a = (z - (Z_BOTTOM_SEAM + 0.004)) / 0.006, b = (z - (Z_SHOULDER_SEAM - 0.004)) / 0.006;
  return 0.0022 * Math.exp(-a * a) + 0.0022 * Math.exp(-b * b);
}
function pillow(u, z) {
  const ph = repeat1(u * PANELS - SEAM_U0 * PANELS);
  const p = Math.sqrt(Math.sin(Math.PI * ph));
  const fade = clamp01((z - Z_BOTTOM_SEAM) / 0.09) * clamp01((Z_SHOULDER_SEAM - z) / 0.09);
  return (-0.010 + 0.012 * p) * fade;
}
const radial = (a) => V(Math.cos(a), 0, Math.sin(a));

// ---- the small mesh builder (MB in the C#) ----
class MB {
  constructor() { this.v = []; this.n = []; this.t = []; this.c = []; this.uv0 = []; this.uv1 = []; this.tri = []; }
  add(p, nn, tan, bit, col, a, b) {
    const n = nn.clone().normalize();
    let tt = tan.clone().sub(n.clone().multiplyScalar(n.dot(tan)));
    if (tt.lengthSq() < 1e-12) tt = n.clone().cross(Math.abs(n.y) < 0.9 ? UP : RIGHT);
    tt.normalize();
    const w = n.clone().cross(tt).dot(bit) < 0 ? -1 : 1;
    this.v.push(p.clone()); this.n.push(n); this.t.push([tt.x, tt.y, tt.z, w]);
    this.c.push(col.slice()); this.uv0.push(a.slice()); this.uv1.push(b.slice());
    return this.v.length - 1;
  }
  triA(a, b, d) {
    const g = this.v[b].clone().sub(this.v[a]).cross(this.v[d].clone().sub(this.v[a]));
    const ns = this.n[a].clone().add(this.n[b]).add(this.n[d]);
    if (g.dot(ns) < 0) this.tri.push(a, d, b); else this.tri.push(a, b, d);
  }
  quad(a, b, d, e) { this.triA(a, b, d); this.triA(a, d, e); }
  transform(m, from = 0) {
    const nm = new THREE.Matrix3().getNormalMatrix(m);
    for (let i = from; i < this.v.length; i++) {
      this.v[i].applyMatrix4(m);
      this.n[i].applyMatrix3(nm).normalize();
      const tt = V(this.t[i][0], this.t[i][1], this.t[i][2]).transformDirection(m);
      this.t[i] = [tt.x, tt.y, tt.z, this.t[i][3]];
    }
  }
  append(o) {
    const base = this.v.length;
    for (let i = 0; i < o.v.length; i++) {
      this.v.push(o.v[i]); this.n.push(o.n[i]); this.t.push(o.t[i]); this.c.push(o.c[i]);
      this.uv0.push(o.uv0[i]); this.uv1.push(o.uv1[i]);
    }
    for (const k of o.tri) this.tri.push(k + base);
  }
  // Unity (left-handed) -> three.js (right-handed): mirror z, flip tangent sign, reverse winding.
  toGeometry() {
    const n = this.v.length, P = new Float32Array(n * 3), N = new Float32Array(n * 3), T = new Float32Array(n * 4);
    const C = new Float32Array(n * 4), U0 = new Float32Array(n * 2), U1 = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      P[i * 3] = this.v[i].x; P[i * 3 + 1] = this.v[i].y; P[i * 3 + 2] = -this.v[i].z;
      N[i * 3] = this.n[i].x; N[i * 3 + 1] = this.n[i].y; N[i * 3 + 2] = -this.n[i].z;
      T[i * 4] = this.t[i][0]; T[i * 4 + 1] = this.t[i][1]; T[i * 4 + 2] = -this.t[i][2]; T[i * 4 + 3] = -this.t[i][3];
      C.set(this.c[i], i * 4); U0.set(this.uv0[i], i * 2); U1.set(this.uv1[i], i * 2);
    }
    const idx = n > 65535 ? new Uint32Array(this.tri.length) : new Uint16Array(this.tri.length);
    for (let i = 0; i < this.tri.length; i += 3) { idx[i] = this.tri[i]; idx[i + 1] = this.tri[i + 2]; idx[i + 2] = this.tri[i + 1]; }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(P, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(N, 3));
    g.setAttribute('tangent', new THREE.BufferAttribute(T, 4));
    g.setAttribute('color', new THREE.BufferAttribute(C, 4));
    g.setAttribute('uv', new THREE.BufferAttribute(U0, 2));
    g.setAttribute('uv1', new THREE.BufferAttribute(U1, 2));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.computeBoundingSphere();
    return g;
  }
}

function sweep(mb, path, radius, sides, closed, col, uvConst, refUp, joltW = 0, joltDist0 = 0) {
  const nP = path.length, start = mb.v.length;
  let prevN = V();
  for (let i = 0; i < nP; i++) {
    const tdir = closed
      ? path[(i + 1) % nP].clone().sub(path[(i - 1 + nP) % nP]).normalize()
      : path[Math.min(i + 1, nP - 1)].clone().sub(path[Math.max(i - 1, 0)]).normalize();
    let nrm = (i === 0 ? refUp : prevN).clone();
    nrm.sub(tdir.clone().multiplyScalar(nrm.dot(tdir)));
    if (nrm.lengthSq() < 1e-8) nrm = tdir.clone().cross(RIGHT);
    nrm.normalize(); prevN = nrm;
    const bin = tdir.clone().cross(nrm);
    for (let k = 0; k < sides; k++) {
      const a = 2 * Math.PI * k / sides;
      const rdir = nrm.clone().multiplyScalar(Math.cos(a)).add(bin.clone().multiplyScalar(Math.sin(a)));
      const c = col.slice(); c[3] = joltW;
      mb.add(path[i].clone().add(rdir.clone().multiplyScalar(radius)), rdir, tdir, rdir.clone().cross(tdir), c, uvConst, [0, joltDist0]);
    }
  }
  const segs = closed ? nP : nP - 1;
  for (let i = 0; i < segs; i++) {
    const r0 = start + i * sides, r1 = start + ((i + 1) % nP) * sides;
    for (let k = 0; k < sides; k++) { const k1 = (k + 1) % sides; mb.quad(r0 + k, r0 + k1, r1 + k1, r1 + k); }
  }
}
function stadiumPath(lIn, wIn, d, nseg = 5) {
  const a = (wIn + d) * 0.5, b = Math.max(0, (lIn - wIn) * 0.5), pts = [];
  for (let k = 0; k <= nseg; k++) { const t = Math.PI * k / nseg; pts.push(V(a * Math.cos(t), b + a * Math.sin(t), 0)); }
  for (let k = 0; k <= nseg; k++) { const t = Math.PI + Math.PI * k / nseg; pts.push(V(a * Math.cos(t), -b + a * Math.sin(t), 0)); }
  return pts;
}
function link(mb, m, lIn, wIn, d, col, joltW, dist, hoistMode) {
  const from = mb.v.length;
  sweep(mb, stadiumPath(lIn, wIn, d), d * 0.5, 5, true, col, METAL_UV, FWD, joltW, dist);
  if (hoistMode) for (let i = from; i < mb.uv1.length; i++) mb.uv1[i] = [1, 0];
  mb.transform(m, from);
}
function torus(mb, m, major, minor, maj, mnr, col) {
  const from = mb.v.length, path = [];
  for (let i = 0; i < maj; i++) { const a = 2 * Math.PI * i / maj; path.push(V(major * Math.cos(a), major * Math.sin(a), 0)); }
  sweep(mb, path, minor, mnr, true, col, METAL_UV, FWD);
  mb.transform(m, from);
}
const TRS = (p, q) => new THREE.Matrix4().compose(p, q || new THREE.Quaternion(), V(1, 1, 1));
const qAxis = (axis, deg) => new THREE.Quaternion().setFromAxisAngle(axis, deg * Math.PI / 180);
// Unity Quaternion.Euler(x, y, z) applies z, then x, then y ('YXZ' order in three's convention for intrinsic).
const qEuler = (x, y, z) => new THREE.Quaternion().setFromEuler(new THREE.Euler(x * Math.PI / 180, y * Math.PI / 180, z * Math.PI / 180, 'YXZ'));

function chain(mb, p0, p1, lIn, wIn, d, roll0, joltPeak) {
  const dv = p1.clone().sub(p0), len = dv.length();
  const n = Math.max(1, Math.round(len / lIn)), pitch = len / n;
  const q = new THREE.Quaternion().setFromUnitVectors(UP, dv.clone().divideScalar(len));
  for (let k = 0; k < n; k++) {
    const u = (k + 0.5) / n;
    const c = p0.clone().add(dv.clone().multiplyScalar(u));
    const r = q.clone().multiply(qAxis(UP, roll0 + (k % 2 === 1 ? 90 : 0)));
    link(mb, TRS(c, r), pitch, wIn, d, CHAIN_METAL, joltPeak * Math.sin(Math.PI * u), len * (1 - u), false);
  }
}

// THE HIDE: lathe + four straps (hide-local).
export function buildHide() {
  const prof = profile(), arc = prof[prof.length - 1].s, mb = new MB(), rows = [];
  for (let i = 0; i < prof.length; i++) {
    const p = prof[i], pole = p.r < 1e-6, row = [];
    for (let j = 0; j <= SEG; j++) {
      const u = j / SEG, a = 2 * Math.PI * u;
      const barrel = p.y > Z_BOTTOM_SEAM && p.y < Z_SHOULDER_SEAM;
      const rr = p.r + (p.r > 0.1 ? welt(p.y) : 0) + (barrel ? pillow(u, p.y) : 0);
      const pos = V(rr * Math.cos(a), p.y, rr * Math.sin(a));
      const pp = prof[Math.max(i - 1, 0)], np = prof[Math.min(i + 1, prof.length - 1)];
      let sx = np.r - pp.r, sy = np.y - pp.y; const sl = Math.hypot(sx, sy) || 1; sx /= sl; sy /= sl;
      const n2x = sy, n2y = -sx;
      const rad = radial(a), tanA = V(-Math.sin(a), 0, Math.cos(a));
      const dPdu = barrel ? (pillow(u + 0.0005, p.y) - pillow(u - 0.0005, p.y)) / (0.001 * 2 * Math.PI * Math.max(rr, 0.01)) : 0;
      let nrm = rad.clone().multiplyScalar(n2x).add(V(0, n2y, 0)).sub(tanA.clone().multiplyScalar(dPdu)).normalize();
      if (pole) nrm = p.y < 0.5 ? V(0, -1, 0) : V(0, 1, 0);
      const along = rad.clone().multiplyScalar(sx).add(V(0, sy, 0));
      const uv = [pole ? (j + 0.5) / SEG : u, p.s / arc * ATLAS_HIDE_V];
      const circ = 2 * Math.PI * R;
      row.push(mb.add(pos, nrm, tanA, along, LEATHER, uv, [u * circ / GRAIN_TILE, p.s / GRAIN_TILE]));
    }
    rows.push(row);
  }
  for (let i = 0; i < prof.length - 1; i++) for (let j = 0; j < SEG; j++) {
    const a = rows[i][j], b = rows[i][j + 1], c = rows[i + 1][j + 1], d = rows[i + 1][j];
    if (prof[i].r < 1e-6) mb.triA(a, c, d); else if (prof[i + 1].r < 1e-6) mb.triA(a, b, d); else mb.quad(a, b, c, d);
  }
  for (let k = 0; k < 4; k++) {
    const ang = (45 + 90 * k) * Math.PI / 180, rd = radial(ang), tang = V(-Math.sin(ang), 0, Math.cos(ang));
    const path = [];
    for (const p of prof) if (p.y >= 1.27 && p.y <= H && p.r >= D_RING_R + 0.012) path.push(rd.clone().multiplyScalar(p.r + welt(p.y) + 0.0045).add(V(0, p.y, 0)));
    const bar = rd.clone().multiplyScalar(D_RING_R).add(V(0, D_RING_Z - 0.020, 0));
    const last = path[path.length - 1];
    for (const t of [0.35, 0.7, 1]) path.push(last.clone().lerp(bar.clone().add(rd.clone().multiplyScalar(0.008)).sub(V(0, 0.006, 0)), t));
    for (let kk = 1; kk <= 6; kk++) { const aa = Math.PI * kk / 6; path.push(bar.clone().add(rd.clone().multiplyScalar(0.008 * Math.cos(aa))).add(V(0, 0.008 * Math.sin(aa), 0))); }
    path.push(bar.clone().sub(rd.clone().multiplyScalar(0.008)).sub(V(0, 0.030, 0)));
    const th = 0.0022, hw = STRAP_W * 0.5; let L = 0; const ring = [];
    for (let i = 0; i < path.length; i++) {
      if (i > 0) L += path[i].distanceTo(path[i - 1]);
      const td = path[Math.min(i + 1, path.length - 1)].clone().sub(path[Math.max(i - 1, 0)]).normalize();
      let outN = td.clone().cross(tang).normalize();
      if (outN.dot(rd) < 0 && i < path.length - 7) outN.negate();
      const ua = L / STRAP_ATLAS_LEN, g = [0, L / GRAIN_TILE];
      const P = path[i], tw = tang.clone().multiplyScalar(hw), on = outN.clone().multiplyScalar(th);
      const q = [
        mb.add(P.clone().sub(tw).add(on), outN, td, tang, LEATHER, [ua, ATLAS_STRAP_V0], g),
        mb.add(P.clone().add(tw).add(on), outN, td, tang, LEATHER, [ua, ATLAS_STRAP_V1], [g[0] + STRAP_W / GRAIN_TILE, g[1]]),
        mb.add(P.clone().add(tw).add(on), tang, outN, td, LEATHER, [ua, ATLAS_STRAP_V1 - 0.002], g),
        mb.add(P.clone().add(tw).sub(on), tang, outN, td, LEATHER, [ua, ATLAS_STRAP_V1 - 0.002], g),
        mb.add(P.clone().sub(tw).add(on), tang.clone().negate(), outN, td, LEATHER, [ua, ATLAS_STRAP_V0 + 0.002], g),
        mb.add(P.clone().sub(tw).sub(on), tang.clone().negate(), outN, td, LEATHER, [ua, ATLAS_STRAP_V0 + 0.002], g),
        mb.add(P.clone().sub(tw).sub(on), outN.clone().negate(), td, tang, LEATHER, [ua, ATLAS_STRAP_V0], g),
        mb.add(P.clone().add(tw).sub(on), outN.clone().negate(), td, tang, LEATHER, [ua, ATLAS_STRAP_V1], g),
      ];
      ring.push(q);
    }
    for (let i = 0; i < ring.length - 1; i++) {
      const a = ring[i], b = ring[i + 1];
      mb.quad(a[0], a[1], b[1], b[0]); mb.quad(a[2], a[3], b[3], b[2]);
      mb.quad(a[4], a[5], b[5], b[4]); mb.quad(a[6], a[7], b[7], b[6]);
    }
  }
  return mb.toGeometry();
}

// ON THE BAG (twists with it): D-rings, four-leg chain, master ring, bottom anchor ring (hide-local).
export function buildBagHardware() {
  const mb = new MB(), tops = [];
  for (let k = 0; k < 4; k++) {
    const ang = (45 + 90 * k) * Math.PI / 180, rd = radial(ang), tang = V(-Math.sin(ang), 0, Math.cos(ang));
    const bar = rd.clone().multiplyScalar(D_RING_R).add(V(0, D_RING_Z - 0.020, 0));
    const th = 28 * Math.PI / 180;
    const up2 = V(0, Math.cos(th), 0).sub(rd.clone().multiplyScalar(Math.sin(th)));
    const w = 0.028, hgt = 0.052, dd = 0.009, dpath = [];
    for (let t = 0; t <= 8; t++) dpath.push([-w + 2 * w * t / 8, 0]);
    for (let t = 1; t < 10; t++) { const a = Math.PI * t / 10; dpath.push([w * Math.cos(a), (hgt - w) + w * Math.sin(a)]); }
    for (let t = 1; t <= 3; t++) dpath.push([-w, (hgt - w) * (1 - t / 4)]);
    const world = dpath.map(([x, y]) => bar.clone().add(tang.clone().multiplyScalar(x)).add(up2.clone().multiplyScalar(y)));
    sweep(mb, world, dd * 0.5, 6, true, HARDWARE, METAL_UV, tang.clone().cross(up2));
    tops.push(bar.clone().add(up2.clone().multiplyScalar(hgt + dd * 0.5)));
  }
  const master = V(0, MASTER_Z, 0), mrR = 0.034, mrr = 0.0075;
  torus(mb, TRS(master), mrR, mrr, 18, 7, HARDWARE);
  for (let k = 0; k < 4; k++) {
    const p1 = master.clone().sub(V(0, mrR, 0)).add(tops[k].clone().sub(master).normalize().multiplyScalar(0.012));
    chain(mb, tops[k], p1, 0.036, 0.018, 0.0080, 45 + 90 * k, 0.15);
  }
  torus(mb, TRS(V(0, -0.016, 0)), 0.018, 0.0045, 14, 6, HARDWARE);
  return mb.toGeometry();
}

// ABOVE THE SWIVEL (swings, does not twist): swivel + the single chain up to the hook pin (hide-local).
export function buildUpperChain(pinHide = V(0, HOOK_PIN_Y, 0)) {
  const mb = new MB(), master = V(0, MASTER_Z, 0), mrR = 0.034;
  const swBot = master.clone().add(V(0, mrR + 0.004, 0));
  torus(mb, TRS(swBot.clone().add(V(0, 0.012, 0)), qEuler(0, 90, 0)), 0.016, 0.0055, 14, 6, HARDWARE);
  const body = swBot.clone().add(V(0, 0.050, 0));
  sweep(mb, [body.clone().sub(V(0, 0.024, 0)), body.clone().sub(V(0, 0.022, 0)), body.clone().add(V(0, 0.022, 0)), body.clone().add(V(0, 0.024, 0))],
    0.0155, 12, false, HARDWARE, METAL_UV, RIGHT);
  torus(mb, TRS(body, qEuler(90, 0, 0)), 0.0165, 0.004, 14, 5, HARDWARE);
  const eye2 = body.clone().add(V(0, 0.040, 0));
  torus(mb, TRS(eye2), 0.016, 0.0055, 14, 6, HARDWARE);
  chain(mb, eye2.clone().add(V(0, 0.014, 0)), pinHide, 0.040, 0.020, 0.0095, 0, 0.6);
  return mb.toGeometry();
}

// The hook at the pin plus the hoist chain up out of frame (Unity pools BuildHoistLink up to the winch; same links
// here, alternating 90 degree rolls, uv1 = hoist mode so the jolt pins both ends). Hook-local: pin at the origin.
export function buildHookAndHoist(hoistTopY = 2.6) {
  const mb = new MB(), path = [];
  for (let t = 0; t <= 12; t++) { const a = (110 - 200 * t / 12) * Math.PI / 180; path.push(V(0.024 * Math.sin(a), 0.026 - 0.026 * Math.cos(a), 0)); }
  path.push(V(-0.020, 0.060, 0), V(-0.008, 0.100, 0), V(0, 0.128, 0));
  sweep(mb, path, 0.0085, 8, false, CHAIN_METAL, METAL_UV, FWD);
  torus(mb, TRS(V(0, 0.150, 0), qEuler(0, 90, 0)), 0.020, 0.0065, 14, 6, CHAIN_METAL);
  const pitch = 0.040 - 0.010 * 0.5 - 0.004;           // links interlock: inner length minus a wire's overlap
  for (let k = 0, y = 0.150 + 0.020 + pitch * 0.5; y < hoistTopY; k++, y += pitch) {
    link(mb, TRS(V(0, y, 0), qAxis(UP, k % 2 ? 0 : 90)), 0.040, 0.020, 0.010, CHAIN_METAL, 1, 0, true);
  }
  return mb.toGeometry();
}
