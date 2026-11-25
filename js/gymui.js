// Pound for Pound site: the gym-made UI as real 3D objects.
//
// The nav pads, the Wishlist cushions and the section header plates are drawn as stitched, pillowed leather with athletic
// tape and dulled chrome rivets, the same construction as the game's gym-made Settings menu and mitt quick menu
// (Art/Gear/GymMadeMenu: CRAFT.md, Interactive/js/shader.js, physics.js). The shading is that lab's unlit faux light, cut down
// for small web objects: albedo tile x a designed key/fill/top light x the pebble detail map's cavity, one fixed virtual-light
// Blinn highlight (satin, never glossy), a warm facing rim and a static studio reflection for the chrome. Motion is the lab's
// faux physics: a few scalars (lift, sink, tilt, pillow flatten, dent) on closed-form damped springs, one soft overshoot.
//
// Architecture. ONE WebGL context for the whole page: an offscreen renderer draws each pad into a small viewport of its own,
// with a perspective camera centred on that pad (z = 0 maps 1:1 to CSS pixels, 1000 px eye distance, like CSS perspective),
// then copies the pixels into a 2D canvas that is a child of the pad's own element. So each pad scrolls natively with its text
// (no overlay swim, nav/lightbox z-order for free, it inherits the section's reveal fade), and a pad that has settled costs
// nothing: only pads that are moving are rendered. Idle sway (Wishlist cushion, header plates, never the nav) renders 30 times a second.
//
// The DOM stays the content: links, focus, text for SEO and screen readers. The CSS pad is hidden only after its 3D twin has
// drawn a good frame, and comes back on WebGL context loss. No WebGL2, reduced data, forced colours or a low-end device: the
// CSS pads remain exactly as they were. prefers-reduced-motion keeps the 3D look with no sway and an instant press.
//
// API: initGymUI(opts) -> Promise<controller | null>
//   Upgrades every element matching opts.selector (default [data-gym3d]). Variants (the attribute's value):
//     "pad"      black leather pad, the element's .tape child becomes a strip of athletic tape with its label  (nav links)
//     "pad-red"  the same in crimson                                                                           (nav Wishlist)
//     "cta"      crimson cushion: deeper pillow, chrome rivets, heavier press, a slow idle sway                   (hero / footer CTA)
//     "pad-discord" / "cta-discord"  the pad / cushion in Discord blurple leather (no rivets); a .pad-icon child holding an
//                svg <path> is screen-printed into the leather beside the tape, like a plate's print     (Join the Discord)
//     "plate"    section header plate for a .kicker: black leather, the label screen-printed in cream, the .num on a tape patch
//   opts: selector, force (skip the low-end gate), dprCap (default 1.75), dprCapCoarse (default 2), debug (fn(stats) per second)
//   controller: { pads, destroy() }
import * as THREE from 'three';

const URL_OF = (p) => new URL(p, import.meta.url).href;
const DEG = Math.PI / 180;
const EYE = 1000;                                   // camera distance in CSS px (same feel as CSS perspective: 1000px)

// ---------------------------------------------------------------------------------------------------------------------
// Per-variant construction and feel. Faux physics is AUTHORED per piece (CRAFT.md), not derived.
const KIND = {
  pad:       { leather: 'black', roll: .075, puff: .17, hz: 4.2, zeta: .6,  lift: 2,   tiltH: 5.5, tiltP: 8,  sink: 4.5, flat: .5,  dent: 2.6, sway: 0,  rivets: false },
  'pad-red': { leather: 'red',   roll: .075, puff: .17, hz: 4.2, zeta: .6,  lift: 2,   tiltH: 5.5, tiltP: 8,  sink: 4.5, flat: .5,  dent: 2.6, sway: 0,  rivets: false },
  cta:       { leather: 'red',   roll: .075, puff: .21, hz: 2.6, zeta: .62, lift: 3,   tiltH: 5,   tiltP: 7,  sink: 7,   flat: .8,  dent: 5,   sway: 0,  rivets: true },
  'pad-discord': { leather: 'blurple', roll: .075, puff: .17, hz: 4.2, zeta: .6, lift: 2, tiltH: 5.5, tiltP: 8, sink: 4.5, flat: .5, dent: 2.6, sway: 0, rivets: false },
  'cta-discord': { leather: 'blurple', roll: .075, puff: .21, hz: 2.6, zeta: .62, lift: 3, tiltH: 5, tiltP: 7, sink: 7, flat: .8, dent: 5, sway: 0, rivets: false },
  plate:     { leather: 'black', roll: .075, puff: .14, hz: 3.2, zeta: .62, lift: 1.5, tiltH: 3.5, tiltP: 5,  sink: 3.5, flat: .4,  dent: 3,   sway: 0,  rivets: true },
};
// lab layout.json params (leather / red / tape / metal), satin values
const MAT = {
  black: { spec: .30, shin: 60, rim: .10, specCol: [1, .88, .74], thread: [.062, .05, .04], gain: 1.55, cav: .3 },
  red:   { spec: .30, shin: 60, rim: .10, specCol: [1, .82, .70], thread: [.30, .085, .065], gain: 1.0, cav: .25 },
  blurple: { spec: .30, shin: 60, rim: .10, specCol: [.88, .90, 1], thread: [.11, .12, .34], gain: .96, cav: .28 },
};

// ---------------------------------------------------------------------------------------------------------------------
// Damped spring, closed form (Interactive/js/physics.js springStep), written in place so frames allocate nothing.
function spring(s, freq, zeta, dt) {
  const w = 2 * Math.PI * Math.max(freq, 1e-3), y = s.x - s.t, v = s.v;
  if (zeta < 0.999) {
    const wd = w * Math.sqrt(1 - zeta * zeta), e = Math.exp(-zeta * w * dt), c = Math.cos(wd * dt), sn = Math.sin(wd * dt);
    s.x = s.t + e * (y * c + ((v + zeta * w * y) / wd) * sn);
    s.v = e * (v * c - ((v * zeta * w + w * w * y) / wd) * sn);
  } else {
    const e = Math.exp(-w * dt);
    s.x = s.t + (y + (v + w * y) * dt) * e; s.v = (v - (v + w * y) * w * dt) * e;
  }
}
const S = (x = 0) => ({ x, v: 0, t: x });
const settled = (s, eps) => Math.abs(s.x - s.t) < eps && Math.abs(s.v) < eps * 12;

// small deterministic random per pad
function rng(seed) { let a = seed * 9301 + 49297; return () => ((a = (a * 233280 + 49297) % 2147483647) / 2147483647); }

// ---------------------------------------------------------------------------------------------------------------------
// Pillow surface. s = inset distance from the footprint edge (px). A quarter-round roll of radius R up to the welt seam,
// then the stuffed face bulging toward the middle (more along the short axis, a little along the long one).
function surf(dim, s, x, y) {
  const { a, b, R, Rz, puff } = dim;
  if (s <= 0) return [0, 0];
  if (s < R) { const q = 1 - s / R; return [Rz * Math.sqrt(Math.max(0, 1 - q * q)), 0]; }
  // the puff follows a stadium's inset (round ends), not the box's: its field has no 45-degree creases at the ends, so a
  // short pad shows no wedge-shaped facets beside its tape
  let sp = s;
  if (y !== undefined) { const hx = Math.max(a - b, 0); sp = Math.min(s, b - Math.hypot(Math.max(Math.abs(x) - hx, 0), y)); }
  const p = Math.min(1, Math.max(0, sp - R) / Math.max(b - R, 1)), e = p * p * (3 - 2 * p);   // zero slope at both ends: no creases
  const pc = puff * e * (1 - 0.35 * (x / a) * (x / a));
  return [Rz + pc, pc];
}
function insetOf(dim, x, y) {                        // -sdRoundRect
  const { a, b, rr } = dim;
  const qx = Math.abs(x) - (a - rr), qy = Math.abs(y) - (b - rr);
  const out = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - rr;
  return -out;
}

function padGeometry(dim) {
  const { a, b, rr, R, depth, stitch } = dim;
  // rings from the back wall to the spine; one ring sits exactly on the stitch line so dashes are exact
  const sv = [-depth, 0];
  for (const f of [.08, .2, .35, .5, .65, .8, .92, 1]) sv.push(R * f);
  for (const f of [.12, .3, .5, .7, .85, 1]) sv.push(R + (b - R) * f);
  if (stitch > 0 && stitch < b) sv.push(stitch);
  sv.sort((p, q) => p - q);
  const rings = sv.filter((v, i) => i === 0 || v - sv[i - 1] > 0.05);
  const nC = 7, nT = Math.max(4, Math.ceil((2 * (a - rr)) / 7)), nS = Math.max(2, Math.ceil((2 * (b - rr)) / 7));
  const nS1 = Math.floor(nS / 2);
  const N = 2 * nT + 2 * nS + 4 * nC;                // per ring, +1 duplicate column to close the dash coordinate
  const M = N + 1;
  const pos = new Float32Array(rings.length * M * 3), aS = new Float32Array(rings.length * M), aPer = new Float32Array(rings.length * M);
  const aPuff = new Float32Array(rings.length * M), uv = new Float32Array(rings.length * M * 2);
  const px = new Float64Array(M), py = new Float64Array(M), ex = new Float64Array(M), ey = new Float64Array(M);
  // arc length up the roll's profile (quarter ellipse R wide, Rz tall), so its leather is not smeared down the slope
  const arcTo = (s) => { let L = 0, zp = 0, n = 12; for (let i = 1; i <= n; i++) { const si = (s * i) / n, z = surf(dim, si, 0)[0]; L += Math.hypot(s / n, z - zp); zp = z; } return L; };
  rings.forEach((s0, ri) => {
    const s = Math.max(0, s0), A = Math.max(a - s, 0), B = Math.max(b - s, 0), r = Math.max(Math.min(rr - s, B, A), 0);
    let k = 0;
    const put = (x, y) => { px[k] = x; py[k] = y; k++; };
    // start mid-left edge (planar there, so the closing seam is invisible), go up, clockwise (y up)
    for (let i = 0; i < nS1; i++) put(-A, (B - r) * (i / nS1));
    for (let i = 0; i < nC; i++) { const t = Math.PI - (Math.PI / 2) * (i / nC); put(-(A - r) + r * Math.cos(t), (B - r) + r * Math.sin(t)); }
    for (let i = 0; i < nT; i++) put(-(A - r) + 2 * (A - r) * (i / nT), B);
    for (let i = 0; i < nC; i++) { const t = Math.PI / 2 - (Math.PI / 2) * (i / nC); put((A - r) + r * Math.cos(t), (B - r) + r * Math.sin(t)); }
    for (let i = 0; i < nS; i++) put(A, (B - r) - 2 * (B - r) * (i / nS));
    for (let i = 0; i < nC; i++) { const t = -(Math.PI / 2) * (i / nC); put((A - r) + r * Math.cos(t), -(B - r) + r * Math.sin(t)); }
    for (let i = 0; i < nT; i++) put((A - r) - 2 * (A - r) * (i / nT), -B);
    for (let i = 0; i < nC; i++) { const t = -Math.PI / 2 - (Math.PI / 2) * (i / nC); put(-(A - r) + r * Math.cos(t), -(B - r) + r * Math.sin(t)); }
    for (let i = 0; i < nS - nS1; i++) put(-A, -(B - r) + (B - r) * (i / (nS - nS1)));
    px[N] = px[0]; py[N] = py[0];
    if (ri <= 1) { ex.set(px); ey.set(py); }               // the footprint edge (first ring at s = 0)
    // extra leather the slope adds over its planar width; fades out across the puff so the UVs stay continuous (no seam band)
    const sr = Math.min(Math.max(s0, 0), R);
    const extra = s0 > 0 ? (arcTo(sr) - sr) * (s0 <= R ? 1 : Math.max(0, 1 - (s0 - R) / Math.max(b - R, 1e-3))) : 0;
    let L = 0;
    for (let j = 0; j < M; j++) {
      if (j > 0) L += Math.hypot(px[j] - px[j - 1], py[j] - py[j - 1]);
      const o = ri * M + j;
      const [z, pc] = s0 < 0 ? [s0, 0] : surf(dim, s, px[j], py[j]);
      pos[o * 3] = px[j]; pos[o * 3 + 1] = py[j]; pos[o * 3 + 2] = z;
      aS[o] = s0; aPer[o] = L; aPuff[o] = pc; uv[o * 2] = px[j]; uv[o * 2 + 1] = py[j];
      if (extra > 0) {
        const dx = px[j] - ex[j], dy = py[j] - ey[j], dl = Math.hypot(dx, dy) || 1;
        uv[o * 2] += (dx / dl) * extra; uv[o * 2 + 1] += (dy / dl) * extra;
      }
    }
    for (let j = 0; j < M; j++) aPer[ri * M + j] /= Math.max(L, 1e-3);
  });
  const idx = [];
  for (let ri = 0; ri < rings.length - 1; ri++) {
    for (let j = 0; j < N; j++) {
      const o0 = ri * M + j, o1 = o0 + 1, i0 = o0 + M, i1 = i0 + 1;
      idx.push(o0, i0, o1, o1, i0, i1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('aS', new THREE.BufferAttribute(aS, 1));
  g.setAttribute('aPer', new THREE.BufferAttribute(aPer, 1));
  g.setAttribute('aPuff', new THREE.BufferAttribute(aPuff, 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// a strip (tape) laid on the pillow: grid in its own frame, rotated by ang, conformed to the surface
function tapeGeometry(dim, cx, cy, w, h, ang, lift) {
  const nx = Math.max(8, Math.ceil(w / 6)), ny = 4, M = (nx + 1) * (ny + 1);
  const pos = new Float32Array(M * 3), uv = new Float32Array(M * 2), aS = new Float32Array(M), aPuff = new Float32Array(M), aPer = new Float32Array(M);
  const c = Math.cos(ang), s = Math.sin(ang);
  for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) {
    const o = j * (nx + 1) + i, u = i / nx, v = j / ny;
    const lx = (u - .5) * w, ly = (v - .5) * h;
    const x = cx + lx * c - ly * s, y = cy + lx * s + ly * c;
    const si = insetOf(dim, x, y), [z, pc] = surf(dim, si, x, y);
    pos[o * 3] = x; pos[o * 3 + 1] = y; pos[o * 3 + 2] = z + lift;
    uv[o * 2] = u; uv[o * 2 + 1] = v; aS[o] = si; aPuff[o] = pc;
  }
  const idx = [];
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const a0 = j * (nx + 1) + i, a1 = a0 + 1, b0 = a0 + nx + 1, b1 = b0 + 1;
    idx.push(a0, a1, b0, a1, b1, b0);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('aS', new THREE.BufferAttribute(aS, 1));
  g.setAttribute('aPuff', new THREE.BufferAttribute(aPuff, 1));
  g.setAttribute('aPer', new THREE.BufferAttribute(aPer, 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// ---------------------------------------------------------------------------------------------------------------------
// Shaders. Everything is computed in the pad camera's view space; the key is fixed there (the baked key of the game menu:
// from above, a little left, toward the viewer), so tilting a pad moves its highlight along the top roll.
const GLSL_COMMON = /* glsl */`
uniform float uFlatten, uBulge, uDent, uDentR, uB, uR;
uniform vec2 uDentP;
vec3 srgbOut(vec3 c) { c = clamp(c, 0.0, 1.0); return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
float hash3(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float vnoise(vec3 x) {
  vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash3(i), hash3(i + vec3(1,0,0)), f.x), mix(hash3(i + vec3(0,1,0)), hash3(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hash3(i + vec3(0,0,1)), hash3(i + vec3(1,0,1)), f.x), mix(hash3(i + vec3(0,1,1)), hash3(i + vec3(1,1,1)), f.x), f.y), f.z);
}
`;
const VERT = /* glsl */`
attribute float aS, aPuff, aPer;
varying vec3 vN, vVP, vT;
varying vec2 vL, vTex;
varying float vS, vPer;
${GLSL_COMMON}
void main() {
  vec3 p = position, n = normal;
  vTex = uv;
  float w = clamp(aPuff / max(uB * 0.14, 0.5), 0.0, 1.0);
  p.z -= aPuff * uFlatten;                                    // the press flattens the pillow...
  n.xy *= 1.0 - uFlatten * w * 0.8; n = normalize(n);         // ...and its slopes
  p.xy *= 1.0 + uBulge * w;                                   // flattened leather spreads a little
  vec2 d = position.xy - uDentP;                              // the glove's dent where it landed
  float g = exp(-dot(d, d) / (uDentR * uDentR)) * smoothstep(0.0, uR, aS);
  p.z -= uDent * g;
  vec2 grad = uDent * g * 2.0 * d / (uDentR * uDentR);
  n = normalize(n - vec3(grad, 0.0) * max(n.z, 0.0));
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vVP = mv.xyz; vN = normalize(normalMatrix * n); vT = normalize(normalMatrix * vec3(1.0, 0.0, 0.0));
  vL = position.xy; vS = aS; vPer = aPer;
  gl_Position = projectionMatrix * mv;
}
`;
const LIGHT = /* glsl */`
uniform vec3 uKey;
uniform vec2 uHalf;
uniform float uGlow;
uniform vec4 uPtr;                                            // pointer x, y (local px), radius, amount
vec3 fauxLight(vec3 N, vec2 L, float ao) {
  float ndl = dot(N, uKey);
  float diff = 0.36 + 0.82 * clamp(ndl * 0.6 + 0.4, 0.0, 1.0);   // wrapped key
  float top = max(N.y, 0.0) * 0.28;                               // a top light catching the upper roll
  float pool = 1.0 + 0.16 * clamp(L.y / max(uHalf.y, 1.0), -1.0, 1.0);   // lamp overhead: warmer, brighter toward the top
  vec2 dp = L - uPtr.xy;
  float near = uPtr.w * exp(-dot(dp, dp) / (uPtr.z * uPtr.z));    // a little warm lift under the pointer
  return vec3(1.05, 1.0, 0.93) * (diff + top) * ao * pool * (1.0 + 0.3 * uGlow) + vec3(0.42, 0.30, 0.17) * near;
}
`;
const PAD_FRAG = /* glsl */`
uniform sampler2D tAlb, tDet, tInk;
uniform vec4 uTile;                                           // albedo tile px, detail tile px, offset x, y
uniform float uHasInk, uSt, uDash, uSeed, uGain, uCav, uSpec, uShin, uRim, uRed;
uniform vec3 uSpecCol, uThread;
uniform vec4 uInk;                                            // face ink rect x0, y0, w, h (local px)
uniform vec4 uTape0, uTape1;                                  // tape footprints (cx, cy, hw, hh) for their contact shadow
uniform vec4 uRiv;                                            // rivet x1, x2, y, radius
uniform vec4 uChalk;                                          // x, y, radius, amount
uniform float uPress;
varying vec3 vN, vVP, vT;
varying vec2 vL, vTex;
varying float vS, vPer;
${GLSL_COMMON}
${LIGHT}
float boxSd(vec2 p, vec4 r) { vec2 q = abs(p - r.xy) - r.zw; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0); }
void main() {
  vec2 L = vL;
  vec3 alb = texture2D(tAlb, (vTex + uTile.zw) / uTile.x).rgb;
  vec4 det = texture2D(tDet, (vTex + uTile.wz * 1.7) / uTile.y);
  // wear: worn lighter edges on the roll, darker contact zone in the middle, no two pads alike
  float n1 = vnoise(vec3(L * 0.05, uSeed)), n2 = vnoise(vec3(L * 0.21, uSeed + 3.0));
  float roll = 1.0 - smoothstep(uR * 0.15, uR * 1.05, vS);
  float worn = roll * smoothstep(0.3, 0.85, n1 * 0.65 + n2 * 0.35) * step(0.0, vS);
  alb = mix(alb, alb * (uRed > 0.5 ? 1.35 : 2.2) + (uRed > 0.5 ? vec3(0.02, 0.012, 0.01) : vec3(0.012, 0.010, 0.008)), worn * 0.6);
  float mid = 1.0 - smoothstep(0.0, 1.0, length(L / max(uHalf, vec2(1.0))));
  alb *= 1.0 - 0.10 * mid * smoothstep(0.35, 0.7, n2);
  // face print (screen-printed cream, solid letters: legibility beats grit)
  float ink = 0.0;
  if (uHasInk > 0.5) {
    vec2 iu = (L - uInk.xy) / uInk.zw;
    if (iu.x > 0.0 && iu.x < 1.0 && iu.y > 0.0 && iu.y < 1.0) ink = texture2D(tInk, iu).r;
    alb = mix(alb, vec3(0.70, 0.62, 0.47), ink);
  }
  // the welt seam where the roll meets the face, then one tonal stitch row on it (thread matches its leather)
  float fwS = max(fwidth(vS), 1e-3);
  alb *= 1.0 - 0.38 * (1.0 - smoothstep(0.0, 0.9 + fwS, abs(vS - uR)));
  float sd = abs(vS - uSt);
  float line = 1.0 - smoothstep(0.5, 0.5 + fwS * 1.2, sd);
  float f = fract(vPer * uDash);
  float fwP = max(fwidth(vPer * uDash), 1e-3);
  float dash = smoothstep(0.2, 0.2 + fwP, f) * (1.0 - smoothstep(0.62, 0.62 + fwP, f));
  float stitch = line * dash * step(0.0, uSt);
  float groove = (1.0 - smoothstep(0.0, 1.6, sd)) * step(0.0, uSt);
  alb *= 1.0 - 0.5 * groove * (1.0 - stitch);
  alb = mix(alb, uThread, stitch);
  // rivet seats and tape edges press faint contact shadows into the leather
  float occ = 0.0;
  if (uRiv.w > 0.0) {
    float dr = min(length(L - vec2(uRiv.x, uRiv.z)), length(L - vec2(uRiv.y, uRiv.z)));
    occ = max(occ, (1.0 - smoothstep(uRiv.w * 0.9, uRiv.w * 1.9, dr)) * 0.55);
  }
  if (uTape0.z > 0.0) occ = max(occ, (1.0 - smoothstep(-0.6, 2.2, boxSd(L + vec2(-0.5, 0.9), uTape0))) * 0.42);
  if (uTape1.z > 0.0) occ = max(occ, (1.0 - smoothstep(-0.6, 2.2, boxSd(L + vec2(-0.5, 0.9), uTape1))) * 0.42);
  // normal: geometry + tiling pebble grain (less under the print)
  vec3 N = normalize(vN);
  vec3 T = normalize(vT - N * dot(N, vT)), Bt = cross(N, T);
  vec2 dn = (det.xy * 2.0 - 1.0) * (1.0 - ink * 0.75) * (1.0 - stitch) * mix(0.5, 0.72, smoothstep(0.0, uR, vS));
  N = normalize(N + T * dn.x + Bt * dn.y);
  vec3 V = normalize(-vVP);
  float ao = mix(0.42, 1.0, smoothstep(-2.0, uR * 0.9, vS)) * (1.0 - occ);
  // stuffed, not slab: the face swells toward the middle and its edges sit compressed and darker
  float dome = smoothstep(uR * 0.6, max(uB, uR + 1.0), vS);
  ao *= mix(0.80, 1.06, dome) * (1.0 - 0.26 * uPress);
  ao *= 1.0 - 0.28 * (1.0 - smoothstep(-1.0, uR * 1.4, vS)) * smoothstep(-0.2, 0.9, -L.y / uHalf.y);
  vec3 col = alb * fauxLight(N, L, ao) * uGain;
  col *= 1.0 - uCav + det.a * uCav * (1.0 - ink) + uCav * ink;
  float spec = pow(max(dot(N, normalize(uKey + V)), 0.0), uShin) * uSpec * (1.0 - ink * 0.85) * (1.0 + 0.6 * uGlow) * ao;
  col += spec * uSpecCol;
  col += pow(max(dot(N, normalize(uKey + V)), 0.0), 9.0) * 0.05 * ao * uSpecCol * (1.0 - ink);   // broad satin sheen over the swell
  float fr = 1.0 - pow(abs(dot(V, N)), 0.7);
  col += pow(fr, 3.0) * uRim * vec3(1.0, 0.78, 0.55);
  // chalk print where the glove landed (the lab pad's press mark), fades over a second
  if (uChalk.w > 0.002) {
    float dc = distance(L, uChalk.xy);
    float grain = smoothstep(0.25, 0.75, vnoise(vec3(L * 0.9, 2.0)) * 0.6 + vnoise(vec3(L * 2.3, 5.0)) * 0.4);
    float ch = (1.0 - smoothstep(uChalk.z * 0.3, uChalk.z, dc)) * grain * uChalk.w;
    col = mix(col, vec3(0.62, 0.60, 0.56), ch * 0.55);
  }
  gl_FragColor = vec4(srgbOut(col), 1.0);
}
`;
const TAPE_FRAG = /* glsl */`
uniform sampler2D tTape;
varying vec3 vN, vVP, vT;
varying vec2 vL;
varying float vS, vPer;
${GLSL_COMMON}
${LIGHT}
varying vec2 vUvT;
void main() {
  vec4 t = texture2D(tTape, vUvT);                            // premultiplied
  if (t.a < 0.003) discard;
  vec3 N = normalize(vN), V = normalize(-vVP);
  vec3 c = t.rgb / t.a;
  vec3 col = c * fauxLight(N, vL, 1.0) * 0.98;
  col += pow(max(dot(N, normalize(uKey + V)), 0.0), 20.0) * 0.05;
  gl_FragColor = vec4(srgbOut(col) * t.a, t.a);
}
`;
const TAPE_VERT = VERT.replace('varying float vS, vPer;', 'varying float vS, vPer;\nvarying vec2 vUvT;').replace('vL = position.xy;', 'vL = position.xy; vUvT = uv;');
const METAL_FRAG = /* glsl */`
varying vec3 vN, vVP, vT;
varying vec2 vL;
varying float vS, vPer;
${GLSL_COMMON}
uniform vec3 uKey;
void main() {
  vec3 N = normalize(vN), V = normalize(-vVP), R = reflect(-V, N);
  // static studio reflection: dark floor, warm gym wall, lamp band overhead; dulled (never the brightest thing in frame)
  float t = R.y;
  vec3 env = mix(vec3(0.035, 0.03, 0.028), vec3(0.34, 0.27, 0.21), smoothstep(-0.35, 0.25, t));
  env = mix(env, vec3(0.62, 0.58, 0.52), smoothstep(0.45, 0.85, t));
  env += vec3(0.55, 0.40, 0.22) * exp(-pow((t - 0.6) * 5.0, 2.0)) * smoothstep(-0.6, 0.4, -R.x);
  env += pow(max(dot(N, normalize(uKey + V)), 0.0), 40.0) * vec3(0.32, 0.29, 0.25);   // dulled: broad, soft glint
  gl_FragColor = vec4(srgbOut(env * 0.85), 1.0);
}
`;
const SHADOW_VERT = /* glsl */`
varying vec2 vL;
void main() { vL = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
const SHADOW_FRAG = /* glsl */`
uniform vec4 uSh;                                             // drop shadow: offset x, offset y, blur, strength
uniform vec4 uSh2;                                            // contact shadow: offset y, blur, strength, inset
uniform vec3 uBox;                                            // half w, half h, corner radius
varying vec2 vL;
float boxD(vec2 p, vec2 hb, float r) { vec2 q = abs(p) - hb + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }
void main() {
  float d1 = boxD(vL - uSh.xy, uBox.xy, uBox.z);
  float drop = 1.0 - smoothstep(-uSh.z * 0.7, uSh.z, d1);
  drop *= drop * (3.0 - 2.0 * drop);                          // a gaussian-like falloff, not a hard ramp
  float d2 = boxD(vL - vec2(0.0, uSh2.x), uBox.xy - uSh2.w, max(uBox.z - uSh2.w, 0.0));
  float contact = 1.0 - smoothstep(-uSh2.y * 0.5, uSh2.y, d2);
  float a = 1.0 - (1.0 - drop * uSh.w) * (1.0 - contact * uSh2.z);
  gl_FragColor = vec4(0.0, 0.0, 0.0, a);
}
`;

// ---------------------------------------------------------------------------------------------------------------------
const CSS = `
.g3d{position:relative}
.g3d-on{-webkit-tap-highlight-color:transparent}
.g3d>.g3d-cv{position:absolute;pointer-events:none;z-index:1;display:block}
.g3d-on.pad{background:none!important;box-shadow:none!important;filter:none!important;transition:transform .16s cubic-bezier(.2,.9,.3,1.3),filter .16s ease!important}
.g3d-on.pad:hover{background:none!important;box-shadow:none!important;transform:translateY(-2px)!important;filter:brightness(1.08)!important}
.g3d-on.pad:active{background:none!important;box-shadow:none!important;transform:translateY(1px) scale(.975)!important;filter:brightness(.96)!important}
.g3d-on.pad::before{display:none}
.g3d-on .tape,.g3d-on .pad-icon{opacity:0!important}
.kicker.g3d-plate{display:inline-flex;align-items:center;gap:12px;font:400 27px/1 var(--display,Anton,sans-serif);letter-spacing:.05em;color:var(--cream,#f3ead8);padding:11px 24px 10px 24px;margin-bottom:22px;border-radius:10px}
.kicker.g3d-plate .num{font:400 21px/1 var(--display,Anton,sans-serif);letter-spacing:.05em;color:var(--tape-ink,#1d1b19);background:var(--tape,#ece5d2);border:0;border-radius:0;padding:5px 7px 4px;transform:rotate(-3deg)}
.g3d-on.kicker{color:transparent}
.g3d-on.kicker .num{color:transparent;background:none}
@media (max-width:760px){.kicker.g3d-plate{font-size:23px;padding:10px 20px 9px}.kicker.g3d-plate .num{font-size:18px}}@media (max-width:430px){.kicker.g3d-plate{font-size:17px;letter-spacing:.03em;padding:9px 14px 8px;gap:9px}.kicker.g3d-plate .num{font-size:15px}}
`;

// ---------------------------------------------------------------------------------------------------------------------
export async function initGymUI(opts = {}) {
  const sel = opts.selector || '[data-gym3d]';
  const hosts = [...document.querySelectorAll(sel)].filter((el) => KIND[el.dataset.gym3d]);
  if (!hosts.length) return null;
  const mq = (q) => matchMedia(q).matches;
  const reduce = mq('(prefers-reduced-motion: reduce)');
  const coarse = mq('(pointer: coarse)');
  if (mq('(forced-colors: active)')) return null;
  if (!opts.force) {
    const nav = navigator;
    if (nav.connection && nav.connection.saveData) return null;
    if ((nav.hardwareConcurrency || 8) <= 2) return null;
    if (nav.deviceMemory && nav.deviceMemory < 2) return null;
  }
  const glCanvas = document.createElement('canvas');
  let renderer;
  try {
    if (!glCanvas.getContext('webgl2', { alpha: true })) return null;
    renderer = new THREE.WebGLRenderer({ canvas: glCanvas, alpha: true, antialias: true, premultipliedAlpha: true, powerPreference: 'low-power', preserveDrawingBuffer: false });
  } catch (e) { return null; }
  renderer.setPixelRatio(1);
  renderer.setClearColor(0x000000, 0);
  renderer.autoClear = true;
  let glW = 256, glH = 128;
  renderer.setSize(glW, glH, false);
  const maxAniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());

  // textures (the site's own WebP copies of the menu tiles + the lab's pebble detail map)
  const loader = new THREE.TextureLoader();
  const load = (url, srgb) => new Promise((res, rej) => loader.load(url, (t) => {
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = maxAniso;
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; res(t);
  }, undefined, rej));
  let tex;
  try {
    const needBlurple = hosts.some((el) => KIND[el.dataset.gym3d].leather === 'blurple');
    const [black, red, det, tapeImg, blurple] = await Promise.all([
      load(URL_OF('../img/tex-leather-black-tile.webp'), true), load(URL_OF('../img/tex-leather-red-tile.webp'), true),
      load(URL_OF('../assets/gymui/detail_leather.webp'), false),
      new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL_OF('../img/tex-tape-tile.webp'); }),
      needBlurple ? load(URL_OF('../img/tex-leather-blurple-tile.webp?v=1'), true) : null,
    ]);
    tex = { black, red, det, tapeImg, blurple };
    const fonts = Promise.all([document.fonts.load('400 20px "Archivo Black"'), document.fonts.load('400 20px "Anton"')]);
    await Promise.race([fonts, new Promise((r) => setTimeout(r, 2500))]);
  } catch (e) { renderer.dispose(); return null; }
  if (!document.getElementById('g3d-style')) {
    const st = document.createElement('style'); st.id = 'g3d-style'; st.textContent = CSS; document.head.appendChild(st);
  }

  const key = new THREE.Vector3(-0.148, 0.805, 0.575).normalize();     // the game menu's baked key (Blender -> three)
  const camera = new THREE.PerspectiveCamera(20, 1, EYE - 400, EYE + 400);
  const measCtx = document.createElement('canvas').getContext('2d');
  const blankInk = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1); blankInk.needsUpdate = true;
  const capFine = opts.dprCap || 1.75, capCoarse = opts.dprCapCoarse || 2;   // per-pad canvases are small; 1.25 left labels soft on 3x phones
  const dprNow = () => Math.min(window.devicePixelRatio || 1, coarse ? capCoarse : capFine);
  let dpr = dprNow();
  const pads = [];
  let time = 0, raf = 0, last = 0, frameNo = 0, alive = true, rendersThisSec = 0, framesThisSec = 0, secT = 0;

  // ------------------------------------------------------------------------------------------- one pad
  class Pad {
    constructor(host, i) {
      this.host = host; this.i = i; this.kind = host.dataset.gym3d; this.K = KIND[this.kind];
      this.rand = rng(i + 7); this.seed = this.rand() * 40;
      this.cv = document.createElement('canvas'); this.cv.className = 'g3d-cv'; this.cv.setAttribute('aria-hidden', 'true');
      this.ctx = this.cv.getContext('2d');
      this.visible = false; this.built = false; this.needsBuild = true; this.dirty = true; this.on = false;
      this.lift = S(); this.sink = S(); this.rx = S(); this.ry = S(); this.flat = S(); this.dent = S(); this.glow = S();
      this.hover = false; this.focus = false; this.pressed = false; this.pressT = 0; this.releaseAt = -1;
      this.px = 0; this.py = 0; this.chalk = 0; this.ptrAmt = S();
      this.phase = this.rand() * 6.28; this.phase2 = this.rand() * 6.28;
      host.classList.add('g3d');
      if (this.kind === 'plate') host.classList.add('g3d-plate');
      host.appendChild(this.cv);
      this.U = {
        uFlatten: { value: 0 }, uBulge: { value: 0 }, uDent: { value: 0 }, uDentR: { value: 10 }, uDentP: { value: new THREE.Vector2() },
        uB: { value: 10 }, uR: { value: 4 }, uKey: { value: key }, uHalf: { value: new THREE.Vector2(1, 1) }, uGlow: { value: 0 },
        uPtr: { value: new THREE.Vector4(0, 0, 20, 0) },
      };
      this.listen = () => {};
    }
    _unused_listen() {
      const h = this.host, o = { passive: true };
      const local = (e) => {
        const r = h.getBoundingClientRect();
        this.px = Math.max(-1, Math.min(1, ((e.clientX - r.left) / r.width) * 2 - 1));
        this.py = Math.max(-1, Math.min(1, 1 - ((e.clientY - r.top) / r.height) * 2));
      };
      h.addEventListener('pointerenter', (e) => { if (e.pointerType !== 'touch') { this.hover = true; local(e); this.aim(); } }, o);
      h.addEventListener('pointermove', (e) => { if (e.pointerType !== 'touch') { local(e); this.aim(); } }, o);
      h.addEventListener('pointerleave', () => { this.hover = false; if (this.pressed) this.release(); this.aim(); }, o);
      h.addEventListener('pointerdown', (e) => { if (e.button > 0) return; local(e); this.press(); }, o);
      h.addEventListener('pointerup', () => this.release(), o);
      h.addEventListener('pointercancel', () => { this.release(); this.hover = false; this.aim(); }, o);
      h.addEventListener('focus', () => { this.focus = true; this.aim(); }, o);
      h.addEventListener('blur', () => { this.focus = false; this.aim(); }, o);
      h.addEventListener('keydown', (e) => {
        if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) { this.px = 0; this.py = 0; this.press(); setTimeout(() => this.release(), 90); }
      }, o);
    }
    // spring targets from the current hover / press state
    aim() {
      const K = this.K, hv = this.hover || this.focus, pr = this.pressed;
      const wScale = Math.sqrt(Math.min(1, 120 / Math.max(this.w || 120, 1)));
      const tilt = (pr ? K.tiltP : hv ? K.tiltH : 0) * DEG;
      const px = this.hover || pr ? this.px : 0, py = this.hover || pr ? this.py : 0;
      this.ry.t = px * tilt * wScale;                     // the side under the pointer gives
      this.rx.t = -py * tilt;
      this.lift.t = hv ? K.lift : 0;
      this.sink.t = pr ? K.sink : 0;
      this.flat.t = pr ? K.flat : 0;
      this.dent.t = pr ? K.dent : 0;
      this.glow.t = hv || pr ? 1 : 0;
      this.ptrAmt.t = this.hover || pr ? 1 : 0;
      if (this.w) {
        this.U.uPtr.value.x = px * this.w * 0.5; this.U.uPtr.value.y = py * this.h * 0.5;
        if (pr) this.U.uDentP.value.set(px * (this.w * 0.5 - this.h * 0.25), py * this.h * 0.3);
      }
      if (reduce) for (const s of [this.lift, this.sink, this.rx, this.ry, this.flat, this.dent, this.glow, this.ptrAmt]) { s.x = s.t; s.v = 0; }
      this.dirty = true; wake();
    }
    press() {
      this.pressed = true; this.pressT = time; this.releaseAt = -1;
      this.aim();
      if (!reduce) { this.sink.v += this.K.sink * 22; this.dent.v += this.K.dent * 14; }   // a punch, not a press
      if (this.w) { this.chalkX = this.px * this.w * 0.5; this.chalkY = this.py * this.h * 0.5; this.chalk = reduce ? 0 : 1; }
    }
    release() {
      if (!this.pressed) return;
      const held = time - this.pressT;
      if (held < 0.07 && !reduce) { this.releaseAt = this.pressT + 0.07; wake(); return; }   // let a quick tap land
      this.pressed = false; this.releaseAt = -1; this.aim();
    }
    measure() {
      const h = this.host, cs = getComputedStyle(h);
      this.w = h.offsetWidth; this.h = h.offsetHeight;
      const r0 = h.getBoundingClientRect();
      const rel = (r) => ({ x: r.left - r0.left, y: r.top - r0.top, w: r.width, h: r.height });
      const textOf = (el, excl) => {
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        const nodes = [];
        for (let n = walker.nextNode(); n; n = walker.nextNode()) if (!(excl && excl.contains(n)) && n.data.trim()) nodes.push(n);
        if (!nodes.length) return null;
        const first = nodes[0], lastN = nodes[nodes.length - 1];
        const range = document.createRange();
        range.setStart(first, first.data.length - first.data.trimStart().length);
        range.setEnd(lastN, lastN.data.trimEnd().length);
        const style = getComputedStyle(first.parentElement);
        let str = nodes.map((n) => n.data).join('').replace(/\s+/g, ' ').trim();
        if (style.textTransform === 'uppercase') str = str.toUpperCase();
        return { str, rect: rel(range.getBoundingClientRect()), style };
      };
      this.labels = [];
      if (this.kind === 'plate') {
        const num = h.querySelector('.num');
        if (num) this.labels.push({ kind: 'tape', box: rel(num.getBoundingClientRect()), text: textOf(num), ang: (this.rand() < 0.5 ? -1 : 1) * (2 + this.rand() * 2.5) * DEG });
        const t = textOf(h, num);
        if (t) this.labels.push({ kind: 'print', text: t });
      } else {
        const tape = h.querySelector('.tape');
        if (tape) this.labels.push({ kind: 'tape', box: rel(tape.getBoundingClientRect()), text: textOf(tape), ang: (this.rand() - 0.5) * 2.6 * DEG });
        const icon = h.querySelector('.pad-icon');
        const path = icon && icon.querySelector('path');
        if (path) {
          const svg = icon.closest('svg') || icon.querySelector('svg') || icon;
          const vb = (svg.getAttribute('viewBox') || '0 0 24 24').split(/[\s,]+/).map(Number);
          this.labels.push({ kind: 'icon', box: rel(svg.getBoundingClientRect()), d: path.getAttribute('d'), vb });
        }
      }
      this.radius = parseFloat(cs.borderTopLeftRadius) || Math.min(this.h * 0.3, 12);
      this.align();
    }
    // canvas placement so the backing store lands on whole device pixels (crisp labels)
    align() {
      const r = this.host.getBoundingClientRect();
      const m = Math.round(18 + this.h * 0.32), mx = m + Math.round(this.w * 0.03);
      // never let the canvas poke past the page's sides (a phone would widen its layout viewport and zoom out)
      const vw = document.documentElement.clientWidth;
      const mxL = Math.max(0, Math.min(mx, Math.floor(r.left))), mxR = Math.max(0, Math.min(mx, Math.floor(vw - r.right) - 1));
      const fx = ((r.left - mxL) * dpr) % 1, fy = ((r.top - m) * dpr) % 1;
      const fxp = fx < 0 ? fx + 1 : fx, fyp = fy < 0 ? fy + 1 : fy;
      this.cw = Math.floor((this.w + mxL + mxR) * dpr); this.ch = Math.ceil((this.h + 2 * m) * dpr + 1);
      if (this.cv.width !== this.cw || this.cv.height !== this.ch) { this.cv.width = this.cw; this.cv.height = this.ch; }
      const st = this.cv.style;
      st.left = `${-mxL - fxp / dpr}px`; st.top = `${-m - fyp / dpr}px`; st.width = `${this.cw / dpr}px`; st.height = `${this.ch / dpr}px`;
      // pad centre relative to the canvas centre, in CSS px, y up
      this.offX = (mxL * dpr + fxp + (this.w * dpr) / 2) / dpr - this.cw / dpr / 2;
      this.offY = this.ch / dpr / 2 - (m * dpr + fyp + (this.h * dpr) / 2) / dpr;
      if (this.group) { this.group.position.x = this.offX; this.group.position.y = this.offY; this.shadow.position.x = this.offX; this.shadow.position.y = this.offY; }
      if (this.cw > glW || this.ch > glH) { glW = Math.max(glW, this.cw); glH = Math.max(glH, this.ch); renderer.setSize(glW, glH, false); }
      this.dirty = true;
    }
    disposeGL() {
      if (!this.scene) return;
      this.scene.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
      for (const t of this.texs || []) t.dispose();
      this.scene = null; this.group = null;
    }
    build() {
      this.disposeGL();
      this.measure();
      const K = this.K, w = this.w, h = this.h;
      const a = w / 2, b = h / 2, rr = Math.min(this.radius, b);
      // a narrow, tall rolled edge (a thick cushion seen from the front) with the stitch run just inside it, about 8-10% of
      // the pad's height from the edge as on the game's mitt pads; the face inside is the label's, with room to breathe
      const R = Math.max(2.2, Math.min(h * K.roll, 7)), Rz = Math.max(2.6, Math.min(h * 0.14, 7.5));
      const dim = { a, b, rr, R, Rz, puff: Math.max(1.4, Math.min(h * K.puff, 9)), depth: 4, stitch: R + Math.max(0.9, h * 0.016) };
      this.dim = dim;
      const mat = MAT[K.leather];
      this.U.uB.value = b; this.U.uR.value = R; this.U.uHalf.value.set(a, b); this.U.uDentR.value = Math.max(8, h * 0.55);
      this.U.uPtr.value.z = Math.max(16, h * 0.9);
      const scene = new THREE.Scene(), group = new THREE.Group();
      this.texs = [];
      // the face print (plates): rasterised from the DOM label in its own computed font
      let inkTex = blankInk, inkRect = new THREE.Vector4(0, 0, 1, 1), hasInk = 0;
      const tapes = [];
      const iconLb = this.labels.find((l) => l.kind === 'icon');
      for (const lb of this.labels) {
        if (lb.kind === 'icon') {
          // the logo, screen-printed into the leather in the plates' cream ink (shaded, dented and pressed with the pad)
          const sc = Math.min(dpr * 2, 2048 / w);
          const c = document.createElement('canvas'); c.width = Math.ceil(w * sc); c.height = Math.ceil(h * sc);
          const g = c.getContext('2d');
          g.fillStyle = '#000'; g.fillRect(0, 0, c.width, c.height);
          const bx = lb.box, [vx, vy, vw, vh] = lb.vb, k = Math.min(bx.w / vw, bx.h / vh) * sc;
          g.setTransform(k, 0, 0, k, (bx.x + (bx.w - vw * k / sc) / 2) * sc - vx * k, (bx.y + (bx.h - vh * k / sc) / 2) * sc - vy * k);
          g.fillStyle = '#fff'; g.fill(new Path2D(lb.d));
          const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.NoColorSpace; t.anisotropy = maxAniso; t.generateMipmaps = true;
          t.minFilter = THREE.LinearMipmapLinearFilter; t.flipY = true;
          inkTex = t; this.texs.push(t); hasInk = 1; inkRect.set(-a, -b, w, h);
        } else if (lb.kind === 'print') {
          const sc = Math.min(dpr * 2, 2048 / w);
          const c = document.createElement('canvas'); c.width = Math.ceil(w * sc); c.height = Math.ceil(h * sc);
          const g = c.getContext('2d');
          g.fillStyle = '#000'; g.fillRect(0, 0, c.width, c.height);
          drawText(g, lb.text, sc, 0, 0, '#fff');
          const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.NoColorSpace; t.anisotropy = maxAniso; t.generateMipmaps = true;
          t.minFilter = THREE.LinearMipmapLinearFilter; t.flipY = true;
          inkTex = t; this.texs.push(t); hasInk = 1; inkRect.set(-a, -b, w, h);
        } else if (lb.box) {
          // the tape carries its label in the game's condensed print (Anton stands in for the house varsity face), so the
          // strip is cut to the word, not to the wide DOM fallback face: more leather shows, as on the game's pads
          const bx = lb.box, str = lb.text ? lb.text.str : '';
          let fpx, th, tw, textW;
          const measure = (f) => { measCtx.font = `400 ${f}px Anton, "Archivo Black", sans-serif`; return measCtx.measureText(str).width + f * 0.05 * Math.max(0, str.length - 1); };
          if (this.kind === 'plate') {                       // the plate's number patch keeps its DOM box
            fpx = Math.max(10, bx.h * 0.7); textW = measure(fpx); th = bx.h * 0.94; tw = Math.min(bx.w + 2, textW + 2 * Math.max(5, th * 0.4));
          } else {
            const iw = w - 2 * dim.stitch, ih = h - 2 * dim.stitch;
            th = ih * (h < 40 ? 0.7 : 0.6);
            fpx = th * (this.host.classList.contains('mode-pad') && w < 140 ? 0.58 : 0.86);
            textW = measure(fpx);
            const padX = Math.max(5, th * 0.42), maxW = iw * (h < 40 ? 0.9 : 0.84);
            if (textW + 2 * padX > maxW) { fpx *= (maxW - 2 * padX) / textW; textW = measure(fpx); }
            tw = Math.min(maxW, Math.max(textW + 2 * padX, iw * 0.7));
            if (iconLb) {                                    // share the face with the printed logo: the strip sits right of it
              const x0 = iconLb.box.x + iconLb.box.w + Math.max(4, th * 0.22), x1 = w - dim.stitch - Math.max(3, th * 0.12);
              const room = Math.max(10, x1 - x0);
              if (textW + 2 * padX > room) { fpx *= Math.max(0.5, (room - 2 * padX) / textW); textW = measure(fpx); }
              tw = Math.min(room, textW + 2 * padX);
              lb.cx = (x0 + x1) / 2 - a;
            }
          }
          lb.tw = tw;
          const t = tapeTexture(str, fpx, textW, tw, th, this.rand);
          this.texs.push(t);
          const cx = this.kind === 'plate' ? bx.x + bx.w / 2 - a : (lb.cx || 0), cy = this.kind === 'plate' ? b - (bx.y + bx.h / 2) : 0;
          const geo = tapeGeometry(dim, cx, cy, tw, th, lb.ang, 0.55);
          const m = new THREE.ShaderMaterial({
            vertexShader: TAPE_VERT, fragmentShader: TAPE_FRAG, transparent: true, premultipliedAlpha: true, depthWrite: false,
            uniforms: { ...this.U, tTape: { value: t } },
          });
          m.blending = THREE.CustomBlending; m.blendSrc = THREE.OneFactor; m.blendDst = THREE.OneMinusSrcAlphaFactor;
          m.blendSrcAlpha = THREE.OneFactor; m.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
          const mesh = new THREE.Mesh(geo, m); mesh.renderOrder = 3; group.add(mesh);
          tapes.push(new THREE.Vector4(cx, cy, tw / 2 - 1.2, th / 2 - 0.4));
        }
      }
      // rivets: small, dulled chrome, in the padding at both ends
      let riv = new THREE.Vector4(0, 0, 0, 0);
      const gapOK = (() => { const l = this.labels.find((q) => q.box); return !l || this.kind === 'plate' || a - l.tw / 2 - dim.stitch > 9; })();
      if (K.rivets && gapOK) {
        // seat them in the leather left beside the tape / print, never under a label
        const lb = this.labels.find((l) => l.box) || null, pt = this.labels.find((l) => l.kind === 'print');
        let gap = lb && this.kind !== 'plate' ? a - lb.tw / 2 : (lb ? lb.box.x : (pt ? pt.text.rect.x : 24));
        if (pt) gap = Math.min(gap, w - pt.text.rect.x - pt.text.rect.w);
        const rad = Math.max(2.2, Math.min(h * 0.06, (gap - dim.stitch) * 0.28, 4.4));
        const rx = this.kind === 'plate' ? a - Math.max(Math.min(gap * 0.5, dim.stitch + rad + 4), dim.stitch + rad + 1) : a - (dim.stitch + gap) / 2;
        riv.set(-rx, rx, 0, rad);
        const geo = new THREE.SphereGeometry(rad, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2); geo.rotateX(Math.PI / 2); geo.scale(1, 1, 0.55);
        const m = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: METAL_FRAG, uniforms: this.U, transparent: true });
        geo.setAttribute('aS', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count).fill(-10), 1));
        geo.setAttribute('aPuff', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count), 1));
        geo.setAttribute('aPer', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count), 1));
        this.rivets = [-rx, rx].map((x) => {
          const mesh = new THREE.Mesh(geo, m); const [z] = surf(dim, insetOf(dim, x, 0), x, 0);
          mesh.position.set(x, 0, z - 0.6); mesh.userData.z0 = z - 0.6; mesh.userData.puff = surf(dim, insetOf(dim, x, 0), x, 0)[1];
          mesh.renderOrder = 2; group.add(mesh); return mesh;
        });
      } else this.rivets = null;
      const padMat = new THREE.ShaderMaterial({
        vertexShader: VERT, fragmentShader: PAD_FRAG, transparent: true,   // opaque output; transparent only so renderOrder is the draw order
        uniforms: {
          ...this.U,
          tAlb: { value: tex[K.leather] }, tDet: { value: tex.det }, tInk: { value: inkTex },
          uTile: { value: new THREE.Vector4(130, 44, this.rand() * 180, this.rand() * 180) },
          uHasInk: { value: hasInk }, uInk: { value: inkRect },
          uSt: { value: dim.stitch }, uDash: { value: 1 }, uSeed: { value: this.seed }, uGain: { value: mat.gain }, uCav: { value: mat.cav },
          uSpec: { value: mat.spec }, uShin: { value: mat.shin }, uRim: { value: mat.rim }, uRed: { value: K.leather !== 'black' ? 1 : 0 },
          uSpecCol: { value: new THREE.Vector3(...mat.specCol) }, uThread: { value: new THREE.Vector3(...mat.thread) },
          uTape0: { value: tapes[0] || new THREE.Vector4() }, uTape1: { value: tapes[1] || new THREE.Vector4() },
          uRiv: { value: riv }, uPress: { value: 0 }, uChalk: { value: new THREE.Vector4(0, 0, Math.max(5, h * 0.18), 0) },
        },
      });
      // a whole number of stitches round the seam so the dash closes cleanly
      const sa = a - dim.stitch, sb = b - dim.stitch, sr = Math.max(rr - dim.stitch, 0);
      const per = 4 * (sa - sr) + 4 * (sb - sr) + 2 * Math.PI * sr;
      padMat.uniforms.uDash.value = Math.max(8, Math.round(per / (h < 40 ? 4.2 : 5.2)));
      if (dim.stitch >= b) padMat.uniforms.uSt.value = -1;
      this.padMat = padMat;
      const padMesh = new THREE.Mesh(padGeometry(dim), padMat); padMesh.renderOrder = 1; group.add(padMesh);
      // the soft contact shadow on the page (stays on the wall; the pad lifts and sinks above it)
      const shGeo = new THREE.PlaneGeometry(w + 140, h + 110);
      const shMat = new THREE.ShaderMaterial({
        vertexShader: SHADOW_VERT, fragmentShader: SHADOW_FRAG, transparent: true, depthWrite: false, depthTest: false, premultipliedAlpha: true,
        uniforms: { uSh: { value: new THREE.Vector4(0, -3, 6, 0.5) }, uSh2: { value: new THREE.Vector4(-1, 2, 0.6, 1) }, uBox: { value: new THREE.Vector3(a, b, rr) } },
      });
      shMat.blending = THREE.CustomBlending; shMat.blendSrc = THREE.OneFactor; shMat.blendDst = THREE.OneMinusSrcAlphaFactor;
      shMat.blendSrcAlpha = THREE.OneFactor; shMat.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
      const shadow = new THREE.Mesh(shGeo, shMat); shadow.renderOrder = 0;
      shadow.position.set(this.offX, this.offY, -dim.depth - 1.5);
      scene.add(shadow, group);
      group.position.set(this.offX, this.offY, 0);
      this.scene = scene; this.group = group; this.shadow = shadow; this.shU = shMat.uniforms.uSh.value; this.shU2 = shMat.uniforms.uSh2.value;
      this.built = true; this.needsBuild = false; this.dirty = true;
    }
    // advance the faux physics; returns true while anything is still moving
    step(dt) {
      const K = this.K;
      if (this.releaseAt > 0 && time >= this.releaseAt) { this.pressed = false; this.releaseAt = -1; this.aim(); }
      const hz = K.hz, z = K.zeta;
      if (!reduce) {
        spring(this.lift, hz * 0.8, 0.75, dt); spring(this.sink, hz, z, dt); spring(this.rx, hz * 0.85, z + 0.05, dt);
        spring(this.ry, hz * 0.85, z + 0.05, dt); spring(this.flat, hz, z, dt); spring(this.dent, hz * 1.1, z, dt);
        spring(this.glow, 5, 1, dt); spring(this.ptrAmt, 6, 1, dt);
      }
      if (this.chalk > 0) { this.chalk = Math.max(0, this.chalk - dt * (this.pressed ? 0.25 : 1.1)); }
      const moving = !(settled(this.lift, .01) && settled(this.sink, .01) && settled(this.rx, 1e-4) && settled(this.ry, 1e-4) &&
        settled(this.flat, 1e-3) && settled(this.dent, .01) && settled(this.glow, 2e-3) && settled(this.ptrAmt, 2e-3)) || this.chalk > 0 || this.releaseAt > 0;
      this.swaying = K.sway > 0 && !reduce;
      return moving;
    }
    apply() {
      const K = this.K, U = this.U, g = this.group;
      let sx = 0, sy = 0, sz = 0;
      if (this.swaying) {                                   // a hung piece breathing very slightly, never "too much movement"
        const amp = K.sway * (1 - 0.6 * this.glow.x);
        sx = amp * 0.32 * DEG * Math.sin(time * 2 * Math.PI * 0.13 + this.phase);
        sy = amp * 0.45 * DEG * Math.sin(time * 2 * Math.PI * 0.085 + this.phase2) * Math.sqrt(Math.min(1, 160 / this.w));
        sz = amp * 0.35 * Math.sin(time * 2 * Math.PI * 0.11 + this.phase2);
      }
      g.rotation.set(this.rx.x + sx, this.ry.x + sy, 0);
      g.position.z = this.lift.x - this.sink.x + sz;
      // seen nearly head-on, depth alone barely reads: the punch also gives the pad a small squash (and the overshoot a small pop)
      const pk = this.sink.x / K.sink;
      const hv = 1 + 0.018 * (this.lift.x / K.lift);      // hover: it comes up to meet you a touch
      g.scale.set(hv * (1 - 0.03 * pk + 0.012 * this.flat.x), hv * (1 - 0.045 * pk), 1);
      U.uFlatten.value = this.flat.x; U.uBulge.value = this.flat.x * 0.035; U.uDent.value = this.dent.x;
      U.uGlow.value = this.glow.x; U.uPtr.value.w = this.ptrAmt.x * 0.7;
      this.padMat.uniforms.uPress.value = Math.max(0, Math.min(1, this.sink.x / K.sink));
      const ch = this.padMat.uniforms.uChalk.value; ch.x = this.chalkX || 0; ch.y = this.chalkY || 0; ch.w = this.chalk;
      if (this.rivets) for (const r of this.rivets) r.position.z = r.userData.z0 - r.userData.puff * this.flat.x;
      const up = this.lift.x - this.sink.x + sz;              // shadow: lifts spread and soften it, a press tightens it
      // a thick leather object standing off the page: a soft drop shadow (deeper and wider on the hover lift, tucked in on a
      // press) and a tight contact shadow where it sits (thins as it lifts, darkens as it is pressed home)
      const pr = Math.max(0, Math.min(1, this.sink.x / K.sink)), lf = Math.max(0, up);
      this.shU.x = -up * 0.2; this.shU.y = -3.5 - this.h * 0.06 - lf * 1.6 + pr * 2.5;
      this.shU.z = Math.max(3, 7 + this.h * 0.14 + lf * 2.2 - pr * 4);
      this.shU.w = Math.min(0.9, Math.max(0.22, 0.72 + lf * 0.03 - pr * 0.36));
      this.shU2.x = -0.8 - lf * 0.3; this.shU2.y = Math.max(1.2, 2.2 + lf * 0.6 - pr * 0.8);
      this.shU2.z = Math.min(0.85, Math.max(0.25, 0.62 - lf * 0.06 + pr * 0.15)); this.shU2.w = 0.6;
    }
    render() {
      if (this.cv.width !== this.cw || this.cv.height !== this.ch) { this.cv.width = this.cw; this.cv.height = this.ch; }   // re-allocated after an off-screen release
      this.apply();
      renderer.setViewport(0, 0, this.cw, this.ch);
      renderer.setScissor(0, 0, this.cw, this.ch);
      renderer.setScissorTest(true);
      const hc = this.ch / dpr / 2;
      camera.fov = (2 * Math.atan(hc / EYE)) / DEG; camera.aspect = this.cw / this.ch;
      camera.position.set(0, 0, EYE); camera.updateProjectionMatrix();
      renderer.render(this.scene, camera);
      const c = this.ctx;
      c.clearRect(0, 0, this.cw, this.ch);
      c.drawImage(glCanvas, 0, glH - this.ch, this.cw, this.ch, 0, 0, this.cw, this.ch);
      rendersThisSec++;
      this.dirty = false;
      if (!this.on) { this.on = true; this.host.classList.add('g3d-on'); }
    }
  }

  // label text drawn in the DOM's own font at the DOM's own position (so the strip and the print sit where the HTML was)
  function drawText(g, text, sc, ox, oy, color) {
    const st = text.style, r = text.rect;
    const size = parseFloat(st.fontSize);
    g.save();
    g.font = `${st.fontStyle} ${st.fontWeight} ${size * sc}px ${st.fontFamily}`;
    const ls = (parseFloat(st.letterSpacing) || 0) * sc;
    const m = g.measureText(text.str);
    const asc = m.fontBoundingBoxAscent != null ? m.fontBoundingBoxAscent : size * sc * 0.8;
    const natural = m.width + ls * text.str.length;
    const fit = Math.max(0.9, Math.min(1.1, (r.w * sc) / Math.max(natural, 1)));
    g.translate((r.x - ox) * sc, (r.y - oy) * sc + asc);
    g.scale(fit, 1);
    g.fillStyle = color; g.textBaseline = 'alphabetic';
    let x = 0;
    for (const chr of text.str) { g.fillText(chr, x, 0); x += g.measureText(chr).width + ls; }
    g.restore();
  }

  // athletic tape: the real tape tile, grime at the edges, torn ends, the label in solid ink (legibility beats grit)
  function tapeTexture(str, fpx, textW, tw, th, rnd) {
    const sc = Math.min(dpr * 2, 2048 / tw);
    const c = document.createElement('canvas'); c.width = Math.ceil(tw * sc); c.height = Math.ceil(th * sc);
    const g = c.getContext('2d'), W = c.width, H = c.height;
    const pat = g.createPattern(tex.tapeImg, 'repeat');
    pat.setTransform(new DOMMatrix().translate(rnd() * 200, rnd() * 200).scale((sc * 200) / 512));
    g.fillStyle = '#ece5d2'; g.fillRect(0, 0, W, H);
    g.globalAlpha = 0.62; g.fillStyle = pat; g.fillRect(0, 0, W, H); g.globalAlpha = 1;
    const gr = g.createLinearGradient(0, 0, 0, H);
    gr.addColorStop(0, 'rgba(70,55,40,.16)'); gr.addColorStop(.18, 'rgba(70,55,40,0)'); gr.addColorStop(.82, 'rgba(70,55,40,0)'); gr.addColorStop(1, 'rgba(70,55,40,.2)');
    g.fillStyle = gr; g.fillRect(0, 0, W, H);
    for (let i = 0; i < 3; i++) {
      const x = rnd() * W, y = rnd() * H, rr = (6 + rnd() * 14) * sc;
      const rg = g.createRadialGradient(x, y, 0, x, y, rr); rg.addColorStop(0, 'rgba(95,78,58,.07)'); rg.addColorStop(1, 'rgba(95,78,58,0)');
      g.fillStyle = rg; g.fillRect(0, 0, W, H);
    }
    if (str) {
      g.font = `400 ${fpx * sc}px Anton, "Archivo Black", sans-serif`;
      g.fillStyle = 'rgba(24,22,19,.97)'; g.textBaseline = 'alphabetic';
      const m = g.measureText(str);
      const asc = m.actualBoundingBoxAscent || fpx * sc * 0.72, desc = m.actualBoundingBoxDescent || 0;
      const ls = fpx * 0.05 * sc;
      let x = (W - textW * sc) / 2;
      const y = H / 2 + (asc - desc) / 2;
      for (const ch of str) { g.fillText(ch, x, y); x += g.measureText(ch).width + ls; }
    }
    // torn ends, slightly uneven long edges; shallow tears so no leather "specks" show through at the corners
    g.globalCompositeOperation = 'destination-in';
    g.beginPath();
    const tear = 1.4 * sc, step = 1.3 * sc;
    g.moveTo(tear * 0.5, 0);
    for (let x = step; x < W - tear; x += step * 2.5) g.lineTo(x, rnd() * 0.3 * sc);
    for (let y = 0; y <= H; y += step) g.lineTo(W - tear * (0.2 + 0.8 * rnd()), y);
    for (let x = W - tear; x > tear; x -= step * 2.5) g.lineTo(x, H - rnd() * 0.3 * sc);
    for (let y = H; y >= 0; y -= step) g.lineTo(tear * (0.2 + 0.8 * rnd()), y);
    g.closePath(); g.fillStyle = '#fff'; g.fill();
    g.globalCompositeOperation = 'source-over';
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace; t.premultiplyAlpha = true; t.anisotropy = maxAniso;
    t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter;
    return t;
  }

  // ------------------------------------------------------------------------------------------- loop
  // one loop only: a wake() from inside a frame (a spring retargeting) just asks the running frame to continue
  let inFrame = false, wokeInFrame = false;
  function wake() {
    if (inFrame) { wokeInFrame = true; return; }
    if (!raf && alive && !document.hidden) { last = performance.now(); raf = requestAnimationFrame(frame); }
  }
  function frame(t) {
    raf = 0;
    if (!alive) return;
    inFrame = true; wokeInFrame = false;
    const dt = Math.min(0.05, Math.max(0, (t - last) / 1000)); last = t; time += dt; frameNo++;
    let any = false;
    for (const p of pads) {
      if (!p.visible || p.failed) continue;
      try {
        if (p.needsBuild) { p.build(); }
        const moving = p.step(dt);
        if (moving || p.dirty) { p.render(); any = true; }
        else if (p.swaying) { any = true; p.swayAcc = (p.swayAcc || 0) + dt; if (p.swayAcc >= 1 / 30) { p.swayAcc = 0; p.render(); } }   // idle sway: 30 renders/s is plenty for 0.3 deg
      } catch (err) {                                  // one bad pad falls back to its CSS look; the rest carry on
        p.failed = true; p.cv.remove(); p.host.classList.remove('g3d-on', 'g3d-plate');
        console.warn('gym UI pad fell back to CSS', err);
      }
    }
    framesThisSec++;
    if (opts.debug && t - secT > 1000) { opts.debug({ fps: framesThisSec * 1000 / (t - secT), renders: rendersThisSec, pads: pads.length, active: pads.filter((p) => p.visible).length, dpr }); secT = t; framesThisSec = 0; rendersThisSec = 0; }
    inFrame = false;
    if ((any || wokeInFrame) && !document.hidden) raf = requestAnimationFrame(frame);
  }

  hosts.forEach((h, i) => {
    const p = new Pad(h, i);
    // Bake once in a single quick pass then release the WebGL context immediately (0 persistent GL contexts, 0 idle rAF)
    pads.push(p);
  });
  function bakeAll() {
    for (const p of pads) {
      if (p.failed) continue;
      const w = p.host.offsetWidth, h = p.host.offsetHeight;
      if (w < 2 || h < 2) continue;
      try {
        p.build();
        p.render();
        p.disposeGL();
      } catch (err) {
        p.failed = true; p.cv.remove(); p.host.classList.remove('g3d-on', 'g3d-plate');
        console.warn('gym UI pad fell back to CSS', err);
      }
    }
    // Release the WebGL2 context immediately so active WebGL contexts stay strictly <= 1 across the site
    try {
      for (const t of [tex.black, tex.red, tex.det, blankInk]) t.dispose();
      renderer.forceContextLoss();
      renderer.dispose();
    } catch { /* already disposed */ }
  }
  bakeAll();

  function destroy() {
    alive = false; if (raf) cancelAnimationFrame(raf);
    for (const p of pads) { p.disposeGL(); p.cv.remove(); p.host.classList.remove('g3d', 'g3d-on', 'g3d-plate'); }
    try { renderer.dispose(); } catch { /* noop */ }
  }
  return { pads, destroy, renderer: null };
}
