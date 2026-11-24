// Pound for Pound site: the game glove under its moving light.
//
// What this is. The glove is shown as a 36-frame turntable (the mesh itself is never shipped), but every frame carries the
// light-independent inputs of the game's glove light instead of a finished picture: the evened-out base colour, the six AI
// relit pictures as a log-quadratic fit (even + odd parts), the bake's light to restore, the surface and detail normals and the
// sheen mask. This shader then runs the game's light equation live in screen space (the RELIT recipe as shipped on the glove,
// owner pick 3 / build 100.2): even out + restore light only, smooth relit blend at fidelity .5 and strength .75 with the soft
// knee, the soft headlight, the detail-keeping sheen (3 / 28, multiplied .85) and the letters' own coarse path. Moving the
// pointer moves the key around the glove; dragging spins it.
//
// API: mountGloveViewer(container, opts) -> Promise<{ setLight(azDeg, elDeg), dispose() }>, emits 'viewer:ready' on container.
//   opts.base        URL of the asset folder (default ../assets/glove/ next to this file)
//   opts.lightTarget element whose pointer moves steer the light (default: container)
//   opts.poster      false = do not add the poster still (default: add it, fade it out once live)
//   opts.strength    relit strength (default .75, the shipped pick; higher makes the moving light read stronger)
// Light angles: az 0 = from the viewer, positive = from the viewer's right; el = degrees above the horizon.

const NF = 36, STEP = 360 / NF;
const SHARP = 1.0;
const RC = 768, RD = 192, RS = 96, RCC = 48, MW = 4 * RD, MH = 3 * RD + RS + RCC;
const CAM_EL = 12, FOV = 20, CAM_D = 3.35, Z_LO = 2.85, Z_HI = 3.85;
const HERO = 34;                       // frame shown at rest: a 3/4 view, thumb in, the letters whole
const KEY = [-20, 47];                 // the shipped key (GloveLightPick height 47, around 20) as seen from the front
const AZ_RANGE = 85, EL_MID = 22, EL_RANGE = 48;

const VS = `#version 300 es
in vec2 p; out vec2 vUv;
void main() { vUv = p * .5 + .5; gl_Position = vec4(p, 0., 1.); }`;

const FS = `#version 300 es
precision highp float; precision highp sampler2DArray;
uniform sampler2DArray uCol, uDat;
uniform vec3 uFr;            // layer a, layer b, blend
uniform vec3 uLv;            // key in view space
uniform vec3 uLo;            // key in the glove's own (Unity object) frame at the shown turn
uniform vec4 uTurn;          // cos, sin of the turn from frame a to the shown angle; the same from frame b
uniform vec3 uCam;           // cos(camera pitch), sin(camera pitch), tan(fov / 2)
uniform float uStr;          // relit strength: .75 is the shipped pick
uniform float uSharp;        // unsharp amount on the frame colour
const vec3 CAMP = vec3(0., ${(CAM_D * Math.sin(CAM_EL * Math.PI / 180)).toFixed(6)}, ${(CAM_D * Math.cos(CAM_EL * Math.PI / 180)).toFixed(6)});
in vec2 vUv; out vec4 outC;
const vec2 MS = vec2(${MW}., ${MH}.);
float tap(vec2 org, float R, vec2 uv, float L) {
  vec2 q = org + clamp(uv * R, vec2(.5), vec2(R - .5));
  return texture(uDat, vec3(q / MS, L)).r;
}
float dt(int i, vec2 uv, float L) { return tap(vec2(float(i % 4), float(i / 4)) * ${RD}., ${RD}., uv, L); }
float st(int i, vec2 uv, float L) { return tap(vec2(float(i) * ${RS}., ${3 * RD}.), ${RS}., uv, L); }
float ct(int i, vec2 uv, float L) { return tap(vec2(float(i) * ${RCC}., ${3 * RD + RS}.), ${RCC}., uv, L); }
// the smooth blend of the six relit pictures (GloveAuthoredLook.hlsl GloveRelitLog, fidelity .5, no pull); pairs in (y, z, x) order
float relitLog(vec3 e, vec3 o, vec3 l) {
  float m = (e.x + e.y + e.z) / 3.;
  return clamp(m * 6. - 3. + 3. * dot(e - m, l * l) + 6. * dot(o, l), -3., 3.);
}
// view <-> world (the camera is pitched down) and the turn about world up
vec3 toWorld(vec3 v) { return vec3(v.x, uCam.x * v.y + uCam.y * v.z, -uCam.y * v.y + uCam.x * v.z); }
vec3 toView(vec3 w) { return vec3(w.x, uCam.x * w.y - uCam.y * w.z, uCam.y * w.y + uCam.x * w.z); }
vec3 turnY(vec3 w, vec2 cs) { return vec3(cs.x * w.x + cs.y * w.z, w.y, -cs.y * w.x + cs.x * w.z); }
vec2 uvOf(vec2 q) { return vec2(q.x * .5 + .5, .5 - q.y * .5); }
// In-between angles: each frame stores its surface depth, so its pixels are carried to where that surface sits after the extra
// turn (inverse warp by fixed-point steps), and the surface is shaded there; a and b then agree instead of ghosting.
vec2 warpFrom(vec2 p, float L, vec2 cs) {
  vec2 q = p;
  for (int i = 0; i < 3; i++) {
    float z = mix(${Z_LO}, ${Z_HI}, dt(9, uvOf(q), L));
    vec3 w = turnY(toWorld(vec3(q * uCam.z * z, -z)) + CAMP, cs) - CAMP;
    vec3 v = toView(w);
    q += p - v.xy / (-v.z * uCam.z);
  }
  return q;
}
vec4 shadeFrame(float L, vec2 cs, vec2 p, vec3 V) {
  vec2 uv = cs.y == 0. ? uvOf(p) : uvOf(warpFrom(p, L, cs));
  vec3 Lo = uLo;
  vec4 c = texture(uCol, vec3(uv, L));
  if (c.a < .004) return vec4(0.);
  { // light unsharp mask: gives back the grain the frame encode softened (the canvas is upscaled on high-DPI screens)
    const float d = .75 / ${RC}.;
    vec3 bl = .25 * (texture(uCol, vec3(uv + vec2(d, d), L)).rgb + texture(uCol, vec3(uv + vec2(-d, d), L)).rgb
                   + texture(uCol, vec3(uv + vec2(d, -d), L)).rgb + texture(uCol, vec3(uv - vec2(d, d), L)).rgb);
    c.rgb = max(c.rgb + uSharp * (c.rgb - bl), 0.);
  }
  vec3 Lv = uLv;
  vec3 e = vec3(dt(0, uv, L), dt(1, uv, L), dt(2, uv, L));
  vec3 o = vec3(dt(3, uv, L), dt(4, uv, L), dt(5, uv, L)) - .5;
  vec2 nsxy = vec2(dt(6, uv, L), dt(7, uv, L)) * 2. - 1.;
  float K = dt(8, uv, L);
  vec2 nxy = vec2(st(0, uv, L), st(1, uv, L)) * 2. - 1.;
  // the print mask comes at a quarter of the glove's texel density, so its edge is re-sharpened; the bake's light is stored
  // without the mask and masked here, which keeps a dark ring from forming around the letters
  float pm = smoothstep(.2, .8, dt(10, uv, L)), lSp = dt(11, uv, L) * 2.1 * (1. - pm), sm = st(2, uv, L);
  vec3 N = normalize(vec3(nxy, sqrt(max(0., 1. - dot(nxy, nxy)))));
  vec3 Ns = normalize(vec3(nsxy, sqrt(max(0., 1. - dot(nsxy, nsxy)))));
  if (cs.y != 0.) { N = toView(turnY(toWorld(N), cs)); Ns = toView(turnY(toWorld(Ns), cs)); }
  vec3 l = Lo.yzx;
  float ndl = clamp(dot(N, Lv), -1., 1.);
  // even out (baked into the colour) + the moving key restores only the bake's light, on the smooth surface facing it
  vec3 alb = clamp(c.rgb * exp(lSp * smoothstep(.15, .85, ndl)), 0., 1.);
  float sh = .62 + .36 * clamp(dot(N, V), 0., 1.) + .06 * (uCam.x * N.y + uCam.y * N.z);
  float g = pow(max(exp(relitLog(e, o, l)), 1e-3), uStr);
  g = g > 1. ? 1. + (g - 1.) / (1. + (g - 1.) * .4825) : g;      // soft knee: satin, not chrome
  g = mix(1., g, .9);
  float relitSh = mix(sh, 1., .3);
  vec3 leather = alb * relitSh * g * .9;
  vec3 H = normalize(Lv + V);
  float lobe = pow(clamp(dot(Ns, H), 0., 1.), 28. * mix(.6, 1.6, sm));
  float sg = 3. * lobe * K * clamp(ndl * 2. + .2, 0., 1.);        // detail-keeping sheen: multiplies the lit leather
  leather = leather * (1. + sg * .85) + vec3(sg * .15 * .05 * relitSh);
  vec3 col = leather;
  if (pm > .002) {                                                 // the letters: the gains' coarse mip only, no emboss
    vec3 ec = vec3(ct(0, uv, L), ct(1, uv, L), ct(2, uv, L));
    vec3 oc = vec3(ct(3, uv, L), ct(4, uv, L), ct(5, uv, L)) - .5;
    float gL = mix(1., exp(relitLog(ec, oc, l)), .9);
    vec3 printed = alb * sh * clamp(mix(1., gL, .35), .92, 1.06) + vec3(max(gL - 1., 0.) * .03 * relitSh);
    printed += vec3(.06 * pow(clamp(dot(N, H), 0., 1.), 28.));
    col = mix(leather, printed, pm);
  }
  col = clamp(col, 0., 1.);
  col = mix(col * 12.92, 1.055 * pow(col, vec3(1. / 2.4)) - .055, step(.0031308, col));
  return vec4(col * c.a, c.a);
}
void main() {
  vec2 ndc = vUv * 2. - 1.;
  vec3 V = normalize(vec3(-ndc * uCam.z, 1.));
  vec4 a = shadeFrame(uFr.x, uTurn.xy, ndc, V);
  if (uFr.z > .001) a = mix(a, shadeFrame(uFr.y, uTurn.zw, ndc, V), uFr.z);
  outC = a;
}`;

const wrap = d => ((d % 360) + 360) % 360;
const near = (from, to) => from + ((((to - from) % 360) + 540) % 360) - 180;   // the copy of angle `to` nearest `from`

export async function mountGloveViewer(container, opts = {}) {
  const base = opts.base ? new URL(opts.base, location.href) : new URL('../assets/glove/', import.meta.url);
  const lightTarget = opts.lightTarget || container;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const coarse = matchMedia('(pointer: coarse)');
  if (getComputedStyle(container).position === 'static') container.style.position = 'relative';

  let poster = null;
  if (opts.poster !== false) {
    poster = document.createElement('img');
    poster.src = new URL('poster.webp', base).href; poster.alt = ''; poster.decoding = 'async'; poster.draggable = false;
    poster.setAttribute('aria-hidden', 'true');
    Object.assign(poster.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', objectFit: 'contain', pointerEvents: 'none', transition: 'opacity .6s ease' });
    container.appendChild(poster);
  }
  const canvas = document.createElement('canvas');
  Object.assign(canvas.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', display: 'block', opacity: '0', transition: 'opacity .6s ease', touchAction: 'pan-y', cursor: 'grab', userSelect: 'none', webkitUserSelect: 'none' });
  canvas.setAttribute('role', 'img'); canvas.setAttribute('aria-label', 'The Pound for Pound glove. Move the pointer to move the light; drag to turn it.');
  container.appendChild(canvas);

  const gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, powerPreference: 'default' });
  const fail = msg => { canvas.remove(); console.warn('[glove-viewer] ' + msg + ': showing the still'); return { setLight() {}, dispose() { poster?.remove(); } }; };
  if (!gl) return fail('WebGL2 unavailable');

  // ---------------------------------------------------------------- GL setup
  const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
  let prog;
  try {
    prog = gl.createProgram(); gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
    gl.bindAttribLocation(prog, 0, 'p'); gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  } catch (e) { return fail('shader failed (' + e.message + ')'); }
  gl.useProgram(prog);
  const vbo = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  const loc = n => gl.getUniformLocation(prog, n);
  const uFr = loc('uFr'), uLv = loc('uLv'), uLo = loc('uLo'), uTurn = loc('uTurn');
  gl.uniform1i(loc('uCol'), 0); gl.uniform1i(loc('uDat'), 1);
  const ce = Math.cos(CAM_EL * Math.PI / 180), se = Math.sin(CAM_EL * Math.PI / 180);
  gl.uniform3f(loc('uCam'), ce, se, Math.tan(FOV * Math.PI / 360));
  gl.uniform1f(loc('uSharp'), Number.isFinite(opts.sharpen) ? opts.sharpen : SHARP);
  gl.uniform1f(loc('uStr'), Number.isFinite(opts.strength) ? opts.strength : .75);
  const mkArray = (unit, internal, w, h) => {
    const t = gl.createTexture(); gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D_ARRAY, t);
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, internal, w, h, NF);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  };
  const texCol = mkArray(0, gl.SRGB8_ALPHA8, RC, RC), texDat = mkArray(1, gl.R8, MW, MH);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE); gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.disable(gl.BLEND); gl.clearColor(0, 0, 0, 0);

  // ---------------------------------------------------------------- frames: hero first, then outward, so the light is live at once
  const loaded = new Uint8Array(NF); let nLoaded = 0, disposed = false, ready = false;
  const order = []; for (let i = 0; i < NF; i++) { const d = (i + 1) >> 1; order.push(((HERO + (i & 1 ? d : -d)) % NF + NF) % NF); }
  const ctl = new AbortController();
  const bitmap = async url => {
    const r = await fetch(url, { signal: ctl.signal }); if (!r.ok) throw new Error(url + ' ' + r.status);
    return createImageBitmap(await r.blob(), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  };
  const loadFrame = async k => {
    const n = String(k).padStart(2, '0');
    const [c, d] = await Promise.all([bitmap(new URL(`frames/c${n}.webp`, base)), bitmap(new URL(`frames/d${n}.webp`, base))]);
    if (disposed) { c.close(); d.close(); return; }
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D_ARRAY, texCol);
    gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, k, RC, RC, 1, gl.RGBA, gl.UNSIGNED_BYTE, c);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D_ARRAY, texDat);
    gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, k, MW, MH, 1, gl.RED, gl.UNSIGNED_BYTE, d);
    c.close(); d.close(); loaded[k] = 1; nLoaded++; dirty = true; wake();
  };
  const loadAll = async () => {
    let i = 0; const worker = async () => { while (i < order.length && !disposed) await loadFrame(order[i++]); };
    await loadFrame(order[i++]);           // the hero frame alone first
    await Promise.all([worker(), worker(), worker(), worker()]);
  };

  // ---------------------------------------------------------------- state (all numbers: the frame loop allocates nothing)
  let yaw = HERO * STEP, vel = 0, dragging = false, dragId = -1, lastX = 0, lastT = 0, lastInput = -1e9;
  let az = KEY[0], el = KEY[1], tAz = KEY[0], tEl = KEY[1], pointerIn = false, pinned = false, dirty = true;
  let homeTimer = 0, driftT0 = 0, running = false, raf = 0, prevT = 0, visible = true, onscreen = true, side = 0, ox = 0, oy = 0;
  const Lv = new Float32Array(3), Lo = new Float32Array(3);
  let lastYaw = NaN, lastAz = NaN, lastEl = NaN, lastLoaded = -1;

  const lightAt = (cx, cy) => {
    const r = container.getBoundingClientRect(); if (!r.width || !r.height) return;
    const nx = Math.max(-1.3, Math.min(1.3, (cx - (r.left + r.width / 2)) / (r.width / 2)));
    const ny = Math.max(-1.3, Math.min(1.3, (cy - (r.top + r.height / 2)) / (r.height / 2)));
    tAz = nx * AZ_RANGE; tEl = Math.max(-20, Math.min(78, EL_MID - ny * EL_RANGE)); pinned = false; pointerIn = true; wake();
  };
  const onMove = e => {
    if (e.pointerType !== 'touch' || dragId === e.pointerId) lightAt(e.clientX, e.clientY);
    if (dragging && e.pointerId === dragId) {
      const now = performance.now(), dx = e.clientX - lastX, dtm = Math.max(1, now - lastT);
      const d = dx * 260 / Math.max(240, container.clientWidth);
      yaw += d; const v = Math.max(-600, Math.min(600, d / dtm * 1000)); vel = vel * .6 + v * .4;
      lastX = e.clientX; lastT = now; lastInput = now; wake();
    }
  };
  const onLeave = e => { if (e.pointerType !== 'touch') { pointerIn = false; wake(); } };
  const onDown = e => {
    if (e.button > 0) return;
    dragging = true; dragId = e.pointerId; lastX = e.clientX; lastT = performance.now(); lastInput = lastT; vel = 0;
    if (e.pointerType !== 'touch') { try { canvas.setPointerCapture(e.pointerId); } catch {} canvas.style.cursor = 'grabbing'; }
    lightAt(e.clientX, e.clientY);
  };
  const onUp = e => {
    if (e.pointerId !== dragId) return;
    dragging = false; dragId = -1; canvas.style.cursor = 'grab'; lastInput = performance.now();
    if (performance.now() - lastT > 90) vel = 0;              // held still before letting go: no fling
    if (reduced.matches) { vel = 0; yaw = Math.round(yaw / STEP) * STEP; }
    if (e.pointerType === 'touch') pointerIn = false;
    wake();
  };
  lightTarget.addEventListener('pointermove', onMove, { passive: true });
  lightTarget.addEventListener('pointerleave', onLeave, { passive: true });
  const ownMove = lightTarget !== container && !lightTarget.contains(container);   // a separate light area: the glove still steers too
  if (ownMove) container.addEventListener('pointermove', onMove, { passive: true });
  canvas.addEventListener('pointerdown', onDown, { passive: true });
  canvas.addEventListener('pointerup', onUp, { passive: true });
  canvas.addEventListener('pointercancel', onUp, { passive: true });
  canvas.addEventListener('dragstart', e => e.preventDefault());

  // ---------------------------------------------------------------- size, visibility
  const resize = () => {
    const cap = coarse.matches ? 1.25 : 1.75, dpr = Math.min(devicePixelRatio || 1, cap);
    const w = Math.max(1, Math.round(container.clientWidth * dpr)), h = Math.max(1, Math.round(container.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    side = Math.min(w, h); ox = (w - side) >> 1; oy = (h - side) >> 1; dirty = true; wake();
  };
  const ro = new ResizeObserver(resize); ro.observe(container);
  const io = new IntersectionObserver(es => { onscreen = es[es.length - 1].isIntersecting; wake(); }, { rootMargin: '100px' }); io.observe(container);
  const onVis = () => { visible = document.visibilityState === 'visible'; prevT = 0; wake(); };
  document.addEventListener('visibilitychange', onVis);
  const onLost = e => { e.preventDefault(); stop(); canvas.style.opacity = '0'; if (poster) { poster.style.visibility = 'visible'; poster.style.opacity = '1'; } };
  canvas.addEventListener('webglcontextlost', onLost);
  resize();

  // ---------------------------------------------------------------- frame loop
  function wake() { if (!running && visible && onscreen && !disposed && nLoaded) { running = true; prevT = 0; raf = requestAnimationFrame(tick); } }
  function stop() { running = false; cancelAnimationFrame(raf); }
  function tick(t) {
    if (!visible || !onscreen || disposed) { running = false; return; }
    const dt = prevT ? Math.min(.05, (t - prevT) / 1000) : 1 / 60; prevT = t;
    const rm = reduced.matches;
    // light: follow the pointer; with no pointer, the shipped key with a slow drift so the page shows the light is live
    let gAz = tAz, gEl = tEl;
    if (!pointerIn && !pinned) {
      gAz = KEY[0]; gEl = KEY[1];
      if (!rm && ready) { const s = Math.max(0, t - driftT0) / 1000, ramp = Math.min(1, s / 4); gAz += 32 * ramp * Math.sin(s * .55); gEl += 9 * ramp * Math.sin(s * .37); }
    }
    const kL = 1 - Math.exp(-dt / (pointerIn ? .09 : .6));
    az += (gAz - az) * kL; el += (gEl - el) * kL;
    // spin: drag, then a gentle fling, then settle on a whole frame; after a quiet spell glide home to the 3/4 view
    if (!dragging) {
      const idle = t - lastInput;
      if (!rm && Math.abs(vel) > 25) { yaw += vel * dt; vel *= Math.exp(-dt / .35); }
      else {
        vel = 0;
        const homeAfter = idle > 4500 && !rm;
        const goal = homeAfter ? near(yaw, HERO * STEP) : Math.round(yaw / STEP) * STEP;
        const k = 1 - Math.exp(-dt * (homeAfter ? 1.6 : 9));
        if (rm && !homeAfter) yaw = goal; else yaw += (goal - yaw) * k;
        if (Math.abs(goal - yaw) < .01) yaw = goal;
      }
    }
    const moving = dragging || vel !== 0 || Math.abs(yaw - Math.round(yaw / STEP) * STEP) > .01 || (t - lastInput > 4500 && !rm && Math.abs(near(yaw, HERO * STEP) - yaw) > .01);
    const lightMoving = Math.abs(gAz - az) > .02 || Math.abs(gEl - el) > .02;
    if (yaw !== lastYaw || az !== lastAz || el !== lastEl || nLoaded !== lastLoaded || dirty) draw();
    if (moving || lightMoving || (!pointerIn && !pinned && !rm) || nLoaded < NF) raf = requestAnimationFrame(tick);
    else { running = false; if (!rm && !dragging && Math.abs(near(yaw, HERO * STEP) - yaw) > .01) { clearTimeout(homeTimer); homeTimer = setTimeout(wake, Math.max(50, 4600 - (t - lastInput))); } }
  }
  function gloveLo(out, deg, lx, ly, lz) {
    const a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
    out[0] = -(c * lx - s * lz); out[1] = ly; out[2] = s * lx + c * lz;   // glove (glTF) frame, then Unity object axes (x mirrored)
  }
  function nearestLoaded(k) { for (let d = 0; d <= NF / 2; d++) { if (loaded[(k + d) % NF]) return (k + d) % NF; if (loaded[(k - d + NF) % NF]) return (k - d + NF) % NF; } return k; }
  function draw() {
    dirty = false; lastYaw = yaw; lastAz = az; lastEl = el; lastLoaded = nLoaded;
    const w = wrap(yaw), f = w / STEP; let ka = Math.floor(f) % NF, kb = (ka + 1) % NF, m = f - Math.floor(f);
    let da = m * STEP, db = da - STEP;                            // the turn from each frame to the shown angle
    if (!loaded[ka] || !loaded[kb]) { ka = kb = nearestLoaded(m < .5 ? ka : kb); m = 0; da = db = 0; }
    const ar = az * Math.PI / 180, er = el * Math.PI / 180;
    const lx = Math.sin(ar) * Math.cos(er), ly = Math.sin(er), lz = Math.cos(ar) * Math.cos(er);
    Lv[0] = lx; Lv[1] = ce * ly - se * lz; Lv[2] = se * ly + ce * lz;
    gloveLo(Lo, da === 0 && m === 0 ? ka * STEP : w, lx, ly, lz);
    gl.viewport(0, 0, canvas.width, canvas.height); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.viewport(ox, oy, side, side);
    const ra = da * Math.PI / 180, rb = db * Math.PI / 180;
    gl.uniform3f(uFr, ka, kb, m); gl.uniform3fv(uLv, Lv); gl.uniform3fv(uLo, Lo);
    gl.uniform4f(uTurn, Math.cos(ra), Math.sin(ra), Math.cos(rb), Math.sin(rb));
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (!ready && loaded[HERO]) {
      ready = true; driftT0 = performance.now(); canvas.style.opacity = '1';
      if (poster) { poster.style.opacity = '0'; setTimeout(() => { if (ready && !disposed) poster.style.visibility = 'hidden'; }, 700); }
      container.dispatchEvent(new CustomEvent('viewer:ready', { bubbles: true }));
    }
  }

  const api = {
    setLight(azDeg, elDeg) { tAz = +azDeg || 0; tEl = Math.max(-89, Math.min(89, +elDeg || 0)); pinned = true; pointerIn = false; wake(); },
    dispose() {
      if (disposed) return; disposed = true; stop(); clearTimeout(homeTimer); ctl.abort();
      lightTarget.removeEventListener('pointermove', onMove); lightTarget.removeEventListener('pointerleave', onLeave);
      if (ownMove) container.removeEventListener('pointermove', onMove);
      document.removeEventListener('visibilitychange', onVis); ro.disconnect(); io.disconnect();
      gl.deleteTexture(texCol); gl.deleteTexture(texDat); gl.deleteBuffer(vbo); gl.deleteProgram(prog);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      canvas.remove(); poster?.remove();
    },
    // dev/test hooks (not part of the page contract)
    _debug: {
      setYaw(d) { yaw = d; vel = 0; lastInput = performance.now(); dirty = true; wake(); },
      shot(yawDeg, azDeg, elDeg) { yaw = yawDeg; vel = 0; az = tAz = azDeg; el = tEl = elDeg; pinned = true; pointerIn = false; lastInput = performance.now(); draw(); return canvas.toDataURL('image/png'); },
      state: () => ({ yaw, az, el, nLoaded, running }),
    },
  };
  loadAll().catch(e => { if (!disposed && e.name !== 'AbortError') { console.warn('[glove-viewer] frames failed to load:', e.message); if (!ready) canvas.remove(); } });
  return api;
}
