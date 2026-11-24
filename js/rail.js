// The baked rail: a fixed full-viewport WebGL canvas that plays a pre-rendered flythrough of the gym, driven by native scroll.
// Each frame is colour + quarter-res inverse depth; the pointer (or tilt) moves the camera a little and the shader
// reprojects every pixel by its depth (inverse warp by fixed-point steps, like glove-viewer's warpFrom), so the room has
// real parallax. No meshes ship: only pictures and coarse, quantised depth.
//
// Markup: any element with data-rail="seg:<name>" scrubs that segment while it scrolls through the viewport;
// data-rail="hold:<name>" holds the segment's last frame (a stop). Segments are declared in initRail({ segments }).

const VS = `#version 300 es
in vec2 aP; out vec2 vP;
void main() { vP = aP; gl_Position = vec4(aP, 0., 1.); }`;

const FS = `#version 300 es
precision highp float;
in vec2 vP; out vec4 o;
uniform sampler2D uA, uB, uDA, uDB;
uniform float uMix, uDim, uFocus, uTime;
uniform vec2 uOff;        // camera shift, in uv units at full inverse depth
uniform vec4 uPoolR[8];   // venue light: a pool of shadow behind copy, the union of its text-line boxes (canvas css px, y down)
uniform int uPoolN;
uniform vec3 uPoolP;      // strength, pad and soft edge (css px)
uniform vec2 uRes;        // canvas size, css px
uniform vec4 uKeep;       // the subject the ring spot stays on (nominal uv box): the pool never darkens it
uniform vec3 uFloor;      // phones: the floor below the ring falls off into the gym's darkness (start y, end y, strength; canvas uv)
uniform vec4 uCrop;       // nominal frame inside the rendered (overscanned) frame, in uv: x0, y0, w, h
uniform vec2 uCover;      // canvas uv -> nominal uv scale (object-fit: cover)
float depth(sampler2D d, vec2 uv) { return texture(d, uv).r; }
vec2 warp(sampler2D d, vec2 uv) {
  vec2 q = uv;
  for (int i = 0; i < 3; i++) q = uv + uOff * (depth(d, q) - uFocus);
  return q;
}
// pose reprojection: the output camera C sits between frames A and B; each output pixel is pulled from A and from B
// by iterating its depth, so the move between two baked frames is real camera motion, not a crossfade
uniform int uPose;
uniform float uTanH, uAspect, uNear;
uniform mat3 uCR, uARi, uBRi;   // C cam->world, A and B world->cam
uniform vec3 uCP, uAP, uBP;
vec3 rayOf(vec2 uv) { return vec3((uv.x * 2. - 1.) * uTanH * uAspect, (1. - 2. * uv.y) * uTanH, 1.); }
vec2 projTo(mat3 Ri, vec3 P, vec3 X) { vec3 v = Ri * (X - P); v.z = max(v.z, 1e-3); return vec2(v.x / v.z / (uTanH * uAspect) * .5 + .5, .5 - v.y / v.z / uTanH * .5); }
float zOf(sampler2D d, vec2 q) { return uNear / max(texture(d, q).r, .0025); }
vec2 reproj(sampler2D d, mat3 Ri, vec3 P, vec2 uv) {
  vec3 dirC = uCR * rayOf(uv);                 // world ray of the output pixel, scaled so its C-depth is 1
  vec3 fwdC = uCR * vec3(0., 0., 1.);
  mat3 R = transpose(Ri);                      // frame cam->world
  vec2 q = projTo(Ri, P, uCP + dirC * zOf(d, uv));
  for (int i = 0; i < 4; i++) {
    vec3 X = P + R * rayOf(clamp(q, 0., 1.)) * zOf(d, clamp(q, 0., 1.));   // the surface frame A/B sees at q
    float zc = max(dot(X - uCP, fwdC), .05);                                 // its depth from C
    q = projTo(Ri, P, uCP + dirC * zc);
  }
  return q;
}
void main() {
  vec2 c = vP * .5 + .5; c.y = 1. - c.y;
  vec2 n = (c - .5) * uCover + .5;                    // nominal uv
  vec2 uv = uCrop.xy + n * uCrop.zw;                  // rendered uv (overscan gives the warp room)
  vec3 a, b;
  if (uPose == 1) {
    a = texture(uA, clamp(reproj(uDA, uARi, uAP, uv), .001, .999)).rgb;
    b = texture(uB, clamp(reproj(uDB, uBRi, uBP, uv), .001, .999)).rgb;
  } else {
    a = texture(uA, clamp(warp(uDA, uv), .001, .999)).rgb;
    b = texture(uB, clamp(warp(uDB, uv), .001, .999)).rgb;
  }
  vec3 col = mix(a, b, uMix);
  float v = smoothstep(1.25, .35, length((c - .5) * vec2(1.15, 1.0)));
  col *= mix(.55, 1., v) * (1. - uDim);
  // the copy stands in the ring spot's falloff: exposure drops in a wide soft ellipse behind it, the fighter keeps the light
  if (uPoolN > 0) {
    vec2 pp = c * uRes; float d = 1e5;
    for (int i = 0; i < 8; i++) { if (i >= uPoolN) break; vec4 r = uPoolR[i]; d = min(d, length(max(max(r.xy - pp, pp - r.zw), 0.))); }
    float keep = smoothstep(.8, 1.35, length((n - (uKeep.xy + uKeep.zw) * .5) / max((uKeep.zw - uKeep.xy) * .5, vec2(1e-3))));   // the spot: an ellipse
    col *= 1. - uPoolP.x * (1. - smoothstep(uPoolP.y, uPoolP.y + uPoolP.z, d)) * keep;
  }
  col *= 1. - uFloor.z * smoothstep(uFloor.x, uFloor.y, c.y);
  // whisper of film grain so compression banding never shows in the dark gym
  float g = fract(sin(dot(gl_FragCoord.xy + uTime, vec2(12.9898, 78.233))) * 43758.5453) - .5;
  o = vec4(col + g * .012, 1.);
}`;

const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const coarse = matchMedia('(pointer: coarse)').matches;
const narrow = matchMedia('(max-width: 760px)');

export async function initRail({ canvas, segments, maxDpr = 2 }) {
  const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, powerPreference: 'high-performance' });
  if (!gl) { document.documentElement.classList.add('no-rail'); return null; }

  const prog = link(gl, VS, FS);
  const U = n => gl.getUniformLocation(prog, n);
  const u = { A: U('uA'), B: U('uB'), DA: U('uDA'), DB: U('uDB'), mix: U('uMix'), dim: U('uDim'), focus: U('uFocus'), off: U('uOff'), crop: U('uCrop'), cover: U('uCover'), time: U('uTime'), poolR: U('uPoolR'), poolN: U('uPoolN'), poolP: U('uPoolP'), res: U('uRes'), keep: U('uKeep'), floor: U('uFloor'), pose: U('uPose'), tanH: U('uTanH'), aspect: U('uAspect'), near: U('uNear'), CR: U('uCR'), ARi: U('uARi'), BRi: U('uBRi'), CP: U('uCP'), AP: U('uAP'), BP: U('uBP') };
  const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'aP'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const tex = () => { const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); return t; };
  const slot = [{ c: tex(), d: tex(), key: '' }, { c: tex(), d: tex(), key: '' }];

  // ---------- segments: compressed bytes stay in memory, a small LRU of decoded bitmaps feeds the GPU ----------
  const segs = {};
  for (const [name, url] of Object.entries(segments)) segs[name] = await loadManifest(url);
  const lru = new Map(); const LRU_MAX = 10; const decoding = new Set();
  // ---------- video path: WebCodecs decodes whole GOPs on demand; a small LRU of VideoFrames feeds the GPU ----------
  const VLRU = coarse ? 12 : 24;
  function wantVideo(seg, i) {
    const V = seg.vid, fr = V.cache.get(i);
    let d = seg.dbm.get(i);
    if (!d && seg.dblobs[i] && !seg.dpending.has(i)) {
      seg.dpending.add(i);
      createImageBitmap(seg.dblobs[i]).then(bm => { seg.dpending.delete(i); seg.dbm.set(i, bm);
        while (seg.dbm.size > 64) { const [k0, b0] = seg.dbm.entries().next().value; seg.dbm.delete(k0); b0.close(); }
        dirty = true; kick(); }).catch(() => seg.dpending.delete(i));
    } else if (d) { seg.dbm.delete(i); seg.dbm.set(i, d); }
    if (fr) { V.cache.delete(i); V.cache.set(i, fr); }
    else requestGop(seg, Math.floor(i / V.gop));
    return fr && d ? { c: fr, d } : null;
  }
  function requestGop(seg, g) {
    const V = seg.vid;
    if (V.busy === g || V.want.includes(g)) return;
    V.want.push(g); if (V.want.length > 3) V.want.shift();   // only the newest few requests matter while scrubbing
    pumpVideo(seg);
  }
  function pumpVideo(seg) {
    const V = seg.vid;
    if (V.busy !== -1 || !V.want.length) return;
    const g = V.want[V.want.length - 1];
    const a0 = g * V.gop, a1 = Math.min(seg.frames, a0 + V.gop);
    let have = true;
    for (let k = a0; k < a1; k++) if (!V.cache.has(k)) { have = false; break; }
    if (have) { V.want = V.want.filter(x => x !== g); return pumpVideo(seg); }
    for (let k = a0; k < a1; k++) if (!V.buf[V.frames[k][0]]) return;            // bytes not here yet: the fetcher kicks us
    V.want = V.want.filter(x => x !== g); V.busy = g;
    try {
      for (let k = a0; k < a1; k++) {
        const [fi, off, len, key] = V.frames[k];
        V.dec.decode(new EncodedVideoChunk({ type: key || k === a0 ? 'key' : 'delta', timestamp: k * 1000, data: V.buf[fi].subarray(off, off + len) }));
      }
      V.dec.flush().then(() => { V.busy = -1; pumpVideo(seg); dirty = true; kick(); }, () => { V.busy = -1; });
    } catch (e) { V.busy = -1; resetVideo(seg); }
  }
  function resetVideo(seg) {
    const V = seg.vid; V.gen++;
    try { V.dec.reset(); V.dec.configure(V.cfg); } catch { seg.vid = null; }
  }
  function want(seg, i) {
    if (seg.vid) return wantVideo(seg, i);
    const k = seg.name + i;
    if (lru.has(k)) { const v = lru.get(k); lru.delete(k); lru.set(k, v); return v; }
    if (!decoding.has(k) && seg.blobs[i] && seg.dblobs[i]) {
      decoding.add(k);
      Promise.all([createImageBitmap(seg.blobs[i]), createImageBitmap(seg.dblobs[i])]).then(([c, d]) => {
        decoding.delete(k); lru.set(k, { c, d });
        while (lru.size > LRU_MAX) { const [ok, ov] = lru.entries().next().value; lru.delete(ok); ov.c.close(); ov.d.close(); }
        dirty = true; kick();
      }).catch(() => decoding.delete(k));
    }
    return null;
  }
  // nearest frame that is decoded (or at least fetched), searching outward
  function nearest(seg, i) {
    for (let r = 0; r < seg.frames; r++) {
      for (const j of [i - r, i + r]) if (j >= 0 && j < seg.frames) { const v = want(seg, j); if (v) return [j, v]; }
      if (r > 6) break;
    }
    // video path: any decoded frame will do, because the output camera sits at the true pose and reprojects it
    if (seg.vid && seg.poses) {
      let best = -1;
      for (const k of seg.vid.cache.keys()) if (seg.dbm.has(k) && (best < 0 || Math.abs(k - i) < Math.abs(best - i))) best = k;
      if (best >= 0) return [best, { c: seg.vid.cache.get(best), d: seg.dbm.get(best) }];
    }
    return null;
  }
  function upload(s, key, v) {
    if (slot[s].key === key) return;
    gl.bindTexture(gl.TEXTURE_2D, slot[s].c);
    try { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, v.c); }
    catch { return; }
    gl.bindTexture(gl.TEXTURE_2D, slot[s].d); gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, gl.RED, gl.UNSIGNED_BYTE, v.d);
    slot[s].key = key;
  }

  // ---------- timeline from the DOM ----------
  const marks = [...document.querySelectorAll('[data-rail]')].map(el => { const [kind, name] = el.dataset.rail.split(':'); return { el, kind, name }; });
  let seg = null, fTarget = 0, f = 0, fv = 0, visible = false, dimTarget = 0, dim = 0, snapT = null, mode = 'rail';
  // below the last rail mark the page stays in the gym: the wide opening frame held deep in the night (the 'tail'),
  // so every later section sits in one continuous space, never on flat black
  const TAIL_DIM = .74, lastMark = marks[marks.length - 1];
  function readTimeline() {
    const vh = innerHeight; let found = null;
    for (const m of marks) {
      const r = m.el.getBoundingClientRect();
      // a segment can start earlier than its own element (data-rail-from), so the hero already stands in the gym
      const from = m.el.dataset.railFrom && document.querySelector(m.el.dataset.railFrom);
      const top = from ? Math.min(r.top, from.getBoundingClientRect().top) : r.top;
      if (r.bottom <= (m.kind === 'seg' ? 0 : vh * .4) || top >= vh) continue;   // a stop lets go before the next section's copy arrives over him
      const s = segs[m.name]; if (!s) continue;
      if (m.kind === 'seg') { const t = clamp01(-top / Math.max(1, r.bottom - top - vh)); found = { s, f: t * (s.frames - 1), dim: +(m.el.dataset.railDim || 0) }; }
      else if (!found) found = { s, f: s.frames - 1, dim: +(m.el.dataset.railDim || 0) };
    }
    if (found) found.mode = 'rail';
    else if (lastMark && segs[marks[0].name] && lastMark.el.getBoundingClientRect().bottom < vh * .4 + 1) found = { s: segs[marks[0].name], f: 0, dim: TAIL_DIM, mode: 'tail' };
    visible = !!found;
    if (found) {
      if (seg && mode !== found.mode) {   // ring <-> tail: cut under black, never as a visible jump or a rewind of the film
        dimTarget = 1;
        if (dim > .94) { mode = found.mode; seg = found.s; f = fTarget = found.f; fv = 0; snapT = null; dirty = true; }
      } else { mode = found.mode; if (seg !== found.s) { seg = found.s; f = found.f; } fTarget = found.f; dimTarget = found.dim; }
    }
    canvas.classList.toggle('on', visible);
  }

  let raf = 0, dirty = true, last = performance.now();
  // ---------- pointer / tilt camera ----------
  let px = 0, py = 0, tx = 0, ty = 0;
  if (!reduce) {
    addEventListener('pointermove', e => { if (e.pointerType === 'mouse') { tx = e.clientX / innerWidth - .5; ty = e.clientY / innerHeight - .5; kick(); } }, { passive: true });
    addEventListener('deviceorientation', e => { if (e.gamma == null) return; tx = clamp(e.gamma / 40, -.5, .5); ty = clamp((e.beta - 50) / 60, -.5, .5); kick(); }, { passive: true });
  }

  // ---------- size ----------
  let W = 0, H = 0;
  function resize() {
    const dpr = Math.min(devicePixelRatio || 1, maxDpr);
    // the canvas is the whole window on desktop and the top stage on phones (css owns its box)
    W = Math.round((canvas.clientWidth || innerWidth) * dpr); H = Math.round((canvas.clientHeight || innerHeight) * dpr);
    canvas.width = W; canvas.height = H; gl.viewport(0, 0, W, H); dirty = true; kick();
  }
  addEventListener('resize', resize); resize();
  // [data-rail-pool="strength"]: copy that wants the venue's shadow behind it. The pool hugs the type itself: every text
  // line (Range rects, one per wrapped line) inside the element, skipping boards and pads that carry their own surface.
  // Lines are measured relative to the element and cached (resize, font load), never per frame; the pool follows the
  // element and fades as it leaves. data-rail-keep="x0 y0 x1 y1" (nominal frame uv) is the subject the spot stays on.
  const poolEls = [...document.querySelectorAll('[data-rail-pool]')];
  const poolExt = new Map(), poolBuf = new Float32Array(32);
  const measurePool = () => { for (const el of poolEls) {
    const b = el.getBoundingClientRect(), rg = document.createRange(), lines = [];
    const tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, { acceptNode: t => !t.nodeValue.trim() || t.parentElement.closest('.pad, [aria-hidden="true"], .panel-on')
      || getComputedStyle(t.parentElement).visibility === 'hidden' ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT });
    for (let t; (t = tw.nextNode());) {
      rg.selectNodeContents(t);
      for (const q of rg.getClientRects()) {
        if (q.width < 2) continue;
        const L = lines.find(l => Math.abs(l[1] - q.top) < 3 && Math.abs(l[3] - q.bottom) < 3);   // same line box: widen it
        if (L) { L[0] = Math.min(L[0], q.left); L[2] = Math.max(L[2], q.right); } else lines.push([q.left, q.top, q.right, q.bottom]);
      }
    }
    // glyphs fill roughly the middle of a line box; trim the leading so the pool does not grow with line-height
    poolExt.set(el, lines.slice(0, 8).map(l => { const h = l[3] - l[1], tr = h * .12; return [l[0] - b.left, l[1] + tr - b.top, l[2] - b.left, l[3] - tr - b.top]; }));
  } dirty = true; };
  addEventListener('resize', measurePool); document.fonts?.ready.then(measurePool); measurePool();
  function pool() {
    const cr = canvas.getBoundingClientRect();
    for (const el of poolEls) {
      const e = poolExt.get(el); if (!e || !e.length) continue;
      const box = el.getBoundingClientRect(), ox = box.left - cr.left, oy = box.top - cr.top;
      const y0 = Math.min(...e.map(l => l[1])) + oy, y1 = Math.max(...e.map(l => l[3])) + oy;
      if (y1 < 0 || y0 > cr.height) continue;
      const vis = Math.max(0, Math.min(y1, cr.height) - Math.max(y0, 0)) / Math.max(1, Math.min(y1 - y0, cr.height));
      e.forEach((l, i) => poolBuf.set([l[0] + ox, l[1] + oy, l[2] + ox, l[3] + oy], i * 4));
      const k = (el.dataset.railKeep || '2 2 2 2').split(/\s+/).map(Number);
      return { n: e.length, s: +el.dataset.railPool * Math.min(1, vis * 1.4), keep: k };
    }
    return { n: 0, s: 0, keep: [2, 2, 2, 2] };
  }
  addEventListener('scroll', () => kick(), { passive: true });

  // ---------- loop: runs only while something is moving ----------
  function kick() { if (!raf) raf = requestAnimationFrame(frame); }
  function frame(now) {
    raf = 0;
    const dt = Math.min(.05, (now - last) / 1000); last = now;
    readTimeline();
    if (!visible || !seg) return;
    // critically damped spring on the frame position: scroll stays native, the film glides after it
    const k = reduce ? 1e4 : 90, c = 2 * Math.sqrt(k);
    // at rest the film holds exactly on one frame (two blended frames read as soft); it lets go when scroll moves
    if (snapT !== null && Math.abs(fTarget - snapT) > 1e-3) snapT = null;
    if (snapT === null) {
      fv += (k * (fTarget - f) - c * fv) * dt; f += fv * dt;
      if (reduce) { f = fTarget; fv = 0; }
      if (Math.abs(fv) < .03 && Math.abs(fTarget - f) < .03) { f = Math.round(fTarget); fv = 0; snapT = fTarget; }
    }
    px += (tx - px) * Math.min(1, dt * 4); py += (ty - py) * Math.min(1, dt * 4);
    dim += (dimTarget - dim) * Math.min(1, dt * 6);
    const i0 = Math.max(0, Math.min(seg.frames - 1, Math.floor(f))), frac = f - i0, i1 = Math.min(seg.frames - 1, i0 + 1);
    const a = nearest(seg, i0), b = frac > .01 ? nearest(seg, i1) : a;
    // decode a little ahead in the direction of travel
    want(seg, Math.min(seg.frames - 1, i1 + (fv >= 0 ? 2 : -2) ));
    if (a) {
      upload(0, seg.name + a[0], a[1]); upload(1, seg.name + (b ? b[0] : a[0]), (b || a)[1]);
      const ib = b ? b[0] : a[0];
      draw(ib !== a[0] ? clamp01((f - a[0]) / (ib - a[0])) : 0, now, a[0], ib);
    }
    const moving = (snapT === null && (Math.abs(fTarget - f) > .002 || Math.abs(fv) > .002)) || Math.abs(tx - px) > .0005 || Math.abs(ty - py) > .0005 || Math.abs(dimTarget - dim) > .002 || !a || decoding.size;
    if (moving || dirty) { dirty = false; kick(); }
  }
  function draw(mixv, now, ia = 0, ib = 0) {
    gl.useProgram(prog);
    const s = seg, cw = s.crop.w / s.width, ch = s.crop.h / s.height;
    const nomAspect = s.crop.w / s.crop.h, canAspect = W / H;
    const cover = canAspect > nomAspect ? [1, nomAspect / canAspect] : [canAspect / nomAspect, 1];
    gl.uniform4f(u.crop, s.crop.x0 / s.width, s.crop.y0 / s.height, cw, ch);
    gl.uniform2f(u.cover, cover[0], cover[1]);
    const amp = .045 * Math.min(cw, ch) * (coarse ? .7 : 1);
    gl.uniform2f(u.off, px * amp * 2, py * amp * 1.2);
    gl.uniform1f(u.focus, Array.isArray(s.focus) ? s.focus[Math.max(0, Math.min(s.focus.length - 1, Math.round(f)))] : s.focus);
    gl.uniform1f(u.mix, mixv); gl.uniform1f(u.dim, dim); gl.uniform1f(u.time, (now % 1000));
    { const pl = pool(); gl.uniform1i(u.poolN, pl.n); gl.uniform4fv(u.poolR, poolBuf); gl.uniform3f(u.poolP, pl.s, 18, 64);
      gl.uniform2f(u.res, canvas.clientWidth, canvas.clientHeight); if (narrow.matches) gl.uniform3f(u.floor, .5, .8, .72); else if (mode === 'tail') gl.uniform3f(u.floor, .3, 1, .5); else gl.uniform3f(u.floor, 0, 1, 0); gl.uniform4f(u.keep, pl.keep[0], pl.keep[1], pl.keep[2], pl.keep[3]); }
    if (s.poses) {
      // output camera: between the two frames' poses at the film position, nudged by the pointer (real parallax)
      // the output camera is the true pose for the film position, whichever decoded frames feed it
      // ...but never more than a few frames from the frames that feed it: after a jump (a nav click, a fast drag) the nearest
      // decoded frame can be far away, and a long reprojection smears the room. Hold near it until the right chunk decodes.
      const WARP = 3;
      const fc = clamp(clamp(f, Math.min(ia, ib) - WARP, Math.max(ia, ib) + WARP), 0, s.frames - 1), c0 = Math.floor(fc), c1 = Math.min(s.frames - 1, c0 + 1), t = fc - c0;
      const A = s.poses[ia], B = s.poses[ib], P0 = s.poses[c0], P1 = s.poses[c1];
      const q = nlerp(P0.q, P1.q, t), R = qmat(q);
      const P = [0, 1, 2].map(k => P0.p[k] + (P1.p[k] - P0.p[k]) * t);
      const nx = px * (coarse ? .06 : .09), ny = -py * (coarse ? .04 : .06);
      for (let k = 0; k < 3; k++) P[k] += R[k] * nx + R[3 + k] * ny;     // columns: right, up
      gl.uniform1i(u.pose, 1);
      gl.uniform1f(u.tanH, Math.tan(s.fovV * Math.PI / 360)); gl.uniform1f(u.aspect, s.width / s.height); gl.uniform1f(u.near, s.near);
      gl.uniformMatrix3fv(u.CR, false, R); gl.uniform3fv(u.CP, P);
      gl.uniformMatrix3fv(u.ARi, false, transpose3(qmat(A.q))); gl.uniform3fv(u.AP, A.p);
      gl.uniformMatrix3fv(u.BRi, false, transpose3(qmat(B.q))); gl.uniform3fv(u.BP, B.p);
    } else gl.uniform1i(u.pose, 0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, slot[0].c); gl.uniform1i(u.A, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, slot[1].c); gl.uniform1i(u.B, 1);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, slot[0].d); gl.uniform1i(u.DA, 2);
    gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, slot[1].d); gl.uniform1i(u.DB, 3);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (!live) { live = true; document.documentElement.classList.add('rail-live'); }
  }
  let live = false;

  canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); document.documentElement.classList.add('no-rail'); });

  // ---------- dust in the lamp light: 3D motes that stream past with the flight speed ----------
  const dust = (() => {
    if (reduce) return null;
    const c = document.createElement('canvas'); c.className = 'rail-dust'; c.setAttribute('aria-hidden', 'true');
    canvas.after(c);
    const ctx = c.getContext('2d'); const N = coarse ? 40 : 90; const P = [];
    const seed = m => { m.x = (Math.random() - .5) * 2.4; m.y = (Math.random() - .5) * 1.6; m.z = .3 + Math.random() * 3.7; m.r = .5 + Math.random() * 1.4; m.w = Math.random() * 6.28; };
    for (let i = 0; i < N; i++) { const m = {}; seed(m); P.push(m); }
    let w = 0, h = 0;
    const size = () => { const d = Math.min(devicePixelRatio || 1, 1.5); w = canvas.clientWidth || innerWidth; h = canvas.clientHeight || innerHeight; c.width = w * d; c.height = h * d; ctx.setTransform(d, 0, 0, d, 0, 0); };
    size(); addEventListener('resize', () => { if (c.width) size(); });
    return { off() { if (c.classList.contains('on') || c.width) { c.classList.remove('on'); c.width = 0; c.height = 0; } }, step(speed, dt) {   // off: free the full-screen backing
      if (!c.width) size();
      c.classList.toggle('on', visible);
      ctx.clearRect(0, 0, w, h);
      const fly = Math.min(6, Math.abs(speed) * .09);     // frames/s of film -> metres/s of motes
      for (const m of P) {
        m.z -= (fly + .05) * dt * Math.sign(speed || 1); m.w += dt * .6;
        if (m.z < .25) { seed(m); m.z = 4; } else if (m.z > 4.2) { seed(m); m.z = .3; }
        const sx = w / 2 + (m.x + Math.sin(m.w) * .03 - px * .25 / m.z) / m.z * w * .5;
        const sy = h / 2 + (m.y - py * .2 / m.z) / m.z * w * .5;
        if (sx < -20 || sx > w + 20 || sy < -20 || sy > h + 20) continue;
        const near = 1 - m.z / 4.2, lit = Math.max(0, 1 - Math.abs(sy / h - .25) * 1.6);
        const a = Math.min(.75, (.05 + lit * .45) * near * 1.6);
        const r = m.r * (1 + near * 2.2), streak = Math.min(40, fly * near * 9);
        ctx.strokeStyle = ctx.fillStyle = `rgba(255,214,160,${a.toFixed(3)})`;
        if (streak > 2) { ctx.lineWidth = r; ctx.lineCap = 'round'; ctx.beginPath(); const dx = (sx - w / 2) / w, dy = (sy - h / 2) / h; ctx.moveTo(sx, sy); ctx.lineTo(sx - dx * streak * 2, sy - dy * streak * 2); ctx.stroke(); }
        else { ctx.beginPath(); ctx.arc(sx, sy, r, 0, 6.283); ctx.fill(); }
      }
    } };
  })();
  const _frame = frame;
  frame = function (now) { const t0 = last; _frame(now); if (dust && visible && mode === 'rail') { dust.step(fv, Math.min(.05, (now - t0) / 1000)); if (!raf) raf = requestAnimationFrame(frame); } else if (dust) dust.off(); };
  kick();
  return { segments: segs, kick };

  async function openVideo(m, base, s) {
    for (const c of m.video) {
      const cfg = { codec: c.codec, codedWidth: m.width, codedHeight: m.height, optimizeForLatency: true };
      try { const r = await VideoDecoder.isConfigSupported(cfg); if (!r.supported) continue; } catch { continue; }
      const V = { codec: c.codec, cfg, files: c.files, frames: c.frames, gop: m.gop || 8, buf: new Array(c.files.length), cache: new Map(), want: [], busy: -1, gen: 0, dec: null };
      V.dec = new VideoDecoder({
        output: fr => {
          const k = Math.round(fr.timestamp / 1000);
          const old = V.cache.get(k); if (old) old.close();
          V.cache.set(k, fr);
          while (V.cache.size > VLRU) { const [k0, f0] = V.cache.entries().next().value; V.cache.delete(k0); f0.close(); }
          dirty = true; kick();
        },
        error: () => { V.busy = -1; resetVideo(s); },
      });
      V.dec.configure(cfg);
      console.info('rail video:', c.codec);
      return V;
    }
    return null;
  }

  async function loadManifest(url) {
    const base = new URL(url, location.href);
    const m = await (await fetch(base)).json();
    const s = { name: url, frames: m.frames, width: m.width, height: m.height, crop: m.crop, focus: m.focus ?? .35, poses: m.poses || null, fovV: m.fovV, near: m.near ?? .6,
      blobs: new Array(m.frames), dblobs: new Array(m.frames), vid: null, dbm: new Map(), dpending: new Set() };
    const path = (tpl, i) => new URL(tpl.replace('{i}', String(i).padStart(4, '0')), base).href;
    if (m.video && 'VideoDecoder' in window) s.vid = await openVideo(m, base, s);
    if (s.vid) {
      // depth stays per-frame lossless PNG; colour streams as GOP-aligned chunk files, first and last first
      // the hero frame's chunk and the hold frame's chunk come first; the flight between them streams only once the visitor
      // starts scrolling (nearest the film position first), so someone who reads the hero and leaves never pulls the film
      const nf = s.vid.files.length;
      const get = async fi => { if (s.vid.buf[fi]) return; try { s.vid.buf[fi] = new Uint8Array(await (await fetch(new URL(s.vid.files[fi], base))).arrayBuffer()); pumpVideo(s); kick(); } catch { /* neighbours cover */ } };
      (async () => { for (const fi of new Set([0, nf - 1])) await get(fi); })();
      addEventListener('scroll', async () => {
        const here = s.vid.frames[Math.max(0, Math.min(s.frames - 1, Math.round(seg === s ? f : 0)))][0];
        const order = [...Array(nf).keys()].sort((x, y) => Math.abs(x - here) - Math.abs(y - here) || x - y);
        for (const fi of order) await get(fi);
      }, { passive: true, once: true });
      const order = [0, m.frames - 1]; const seen = new Set(order);
      for (let st = 16; st >= 1; st >>= 1) for (let i = 0; i < m.frames; i += st) if (!seen.has(i)) { seen.add(i); order.push(i); }
      const dget = async i => { if (s.dblobs[i]) return; try { s.dblobs[i] = await (await fetch(path(m.depth, i))).blob(); kick(); } catch { /* */ } };
      // like the colour: the two ends now, the coarse-to-fine rest once the visitor scrolls
      (async () => { for (const i of order.slice(0, 2)) await dget(i); })();
      addEventListener('scroll', () => { const q = order.slice(2); Promise.all(Array.from({ length: 4 }, async () => { while (q.length) await dget(q.shift()); })); }, { passive: true, once: true });
      return s;
    }
    // fetch order: first and last frame, then coarse-to-fine strides, so a fast scroll always has something near
    const order = [0, m.frames - 1]; const seen = new Set(order);
    for (let st = 16; st >= 1; st >>= 1) for (let i = 0; i < m.frames; i += st) if (!seen.has(i)) { seen.add(i); order.push(i); }
    (async () => {
      const q = order.slice(); const workers = coarse ? 3 : 6;
      await Promise.all(Array.from({ length: workers }, async () => {
        while (q.length) {
          const i = q.shift();
          try {
            const [c, d] = await Promise.all([fetch(path(m.color, i)), fetch(path(m.depth, i))]);
            s.blobs[i] = await c.blob(); s.dblobs[i] = await d.blob(); kick();
          } catch { /* a missing frame falls back to its neighbours */ }
        }
      }));
    })();
    return s;
  }
}

function link(gl, vs, fs) {
  const sh = (t, s) => { const o = gl.createShader(t); gl.shaderSource(o, s); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(o)); return o; };
  const p = gl.createProgram(); gl.attachShader(p, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  return p;
}
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const clamp01 = v => clamp(v, 0, 1);
// quaternion (x, y, z, w) -> column-major mat3 (columns: right, up, forward), for WebGL uniformMatrix3fv
function qmat([x, y, z, w]) {
  return [1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w),
          2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w),
          2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y)];
}
const transpose3 = m => [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];
function nlerp(a, b, t) {
  const d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3], sg = d < 0 ? -1 : 1;
  const q = a.map((v, i) => v + (sg * b[i] - v) * t); const l = Math.hypot(...q); return q.map(v => v / l);
}
