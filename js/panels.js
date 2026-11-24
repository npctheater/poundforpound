// Copy panels as baked objects in the gym. Each [data-panel="<kind>"] element gets a canvas behind its text that draws
// the kind's baked board (albedo + tangent-space normal map, 9-sliced to the element), relit by a light that follows
// the pointer the way the glove's does, with a soft contact shadow thrown away from the light onto the gym behind.
// The element itself tilts a few degrees toward the pointer on a spring, like a board hanging on a hook.
// Boards: assets/panels/<kind>/panel.json {albedo, normal, w, h, slice{l,t,r,b}, safe{l,t,r,b}, pxPerCss, ink}.
// One shared WebGL2 context renders every panel into its own 2D canvas, only when its light or size changes.
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const coarse = matchMedia('(pointer: coarse)').matches;
const BLEED = 46;  // css px around the board for the contact shadow

const VS = `#version 300 es
in vec2 aP; out vec2 vP; void main() { vP = aP; gl_Position = vec4(aP, 0., 1.); }`;
const FS = `#version 300 es
precision highp float;
in vec2 vP; out vec4 o;
uniform sampler2D uA, uN;
uniform vec2 uCanvas;   // canvas size, device px
uniform vec4 uRect;     // board rect inside the canvas, device px (x, y, w, h), y down
uniform vec2 uSrc;      // board source size, px
uniform vec4 uSlice;    // l, t, r, b, source px
uniform float uK;       // device px per source px for the borders
uniform vec3 uLight;    // light position, device px in canvas space (z toward the viewer)
uniform float uShadow;
float slice1(float p, float W, float a, float b, float S, float k) {
  if (p < a * k) return p / k;
  if (p > W - b * k) return S - (W - p) / k;
  return a + (p - a * k) / max(1., W - (a + b) * k) * (S - a - b);
}
void main() {
  vec2 px = (vec2(vP.x, -vP.y) * .5 + .5) * uCanvas;      // y down
  vec2 q = px - uRect.xy;
  // contact shadow: the board's rect pushed away from the light, softened with distance
  vec2 c = uRect.xy + uRect.zw * .5;
  vec2 away = normalize(c - uLight.xy + 1e-3) * 14. * uShadow;
  vec2 d2 = abs(px - c - away) - uRect.zw * .5 + 10.;
  float sd = length(max(d2, 0.)) + min(max(d2.x, d2.y), 0.) - 10.;
  float sh = (1. - smoothstep(-6., 34. * uShadow, sd)) * .62;
  if (q.x < 0. || q.y < 0. || q.x > uRect.z || q.y > uRect.w) { o = vec4(0., 0., 0., sh); return; }
  vec2 uv = vec2(slice1(q.x, uRect.z, uSlice.x, uSlice.z, uSrc.x, uK), slice1(q.y, uRect.w, uSlice.y, uSlice.w, uSrc.y, uK)) / uSrc;
  vec4 a = texture(uA, uv);
  vec4 nn = texture(uN, uv);
  vec3 N = normalize(nn.rgb * 2. - 1.);                       // map is y-down, same as px and L here
  vec3 L = normalize(vec3(uLight.xy - px, uLight.z));
  vec3 H = normalize(L + vec3(0., 0., 1.));
  float diff = max(dot(N, L), 0.);
  float lit = .78 + .42 * diff;                                // calibrated so a typical lamp angle (diff ~.6) matches the bake's beauty render
  float spec = pow(max(dot(N, H), 0.), 48.) * nn.a * .55;
  // warm lamp falloff across the board, so the lit side reads
  float fall = 1. - smoothstep(0., 1.6, length(uLight.xy - px) / max(uRect.z, uRect.w)) * .08;
  vec3 col = a.rgb * vec3(1.1, 1.04, .96) * lit * fall + spec * vec3(1., .93, .82);
  float al = a.a;
  o = vec4(col * al + vec3(0.) * (1. - al), al + sh * (1. - al));
}`;

let gl = null, glCanvas = null, prog = null, U = null, glLost = false;
function initGL() {
  glCanvas = document.createElement('canvas');
  gl = glCanvas.getContext('webgl2', { premultipliedAlpha: true, alpha: true, antialias: false, preserveDrawingBuffer: true });
  if (!gl) return false;
  glCanvas.addEventListener('webglcontextlost', e => { e.preventDefault(); glLost = true; onLost(); });
  const sh = (t, s) => { const x = gl.createShader(t); gl.shaderSource(x, s); gl.compileShader(x); if (!gl.getShaderParameter(x, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(x)); return x; };
  prog = gl.createProgram(); gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(prog);
  gl.useProgram(prog);
  const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const l = gl.getAttribLocation(prog, 'aP'); gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, 2, gl.FLOAT, false, 0, 0);
  U = n => gl.getUniformLocation(prog, n);
  gl.uniform1i(U('uA'), 0); gl.uniform1i(U('uN'), 1);
  return true;
}
let onLost = () => {};
const boards = new Map();
const p0fit = new WeakMap();
function board(kind) {
  if (!boards.has(kind)) boards.set(kind, (async () => {
    const base = `assets/panels/${kind}/`;
    const m = await (await fetch(base + 'panel.json')).json();
    const load = async f => createImageBitmap(await (await fetch(base + f)).blob(), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
    const [a, n] = await Promise.all([load(m.albedo), load(m.normal)]);
    const mk = img => { const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img); gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); return t; };
    return { ...m, ta: mk(a), tn: mk(n) };
  })());
  return boards.get(kind);
}

export async function initPanels(root = document) {
  const els = [...root.querySelectorAll('[data-panel]')];
  if (!els.length || !initGL()) return;
  const dpr = () => Math.min(2, devicePixelRatio || 1);
  const light = { x: innerWidth * .3, y: innerHeight * .15, tx: innerWidth * .3, ty: innerHeight * .15, z: 520 };
  let raf = 0, last = performance.now(), px = -1, py = -1, live = [];   // declared before any observer can call kick()
  // any failure leaves the element exactly as authored: plain readable copy on the dark gym, never an empty board
  const unmount = p => { p.cv.remove(); p.el.classList.remove('panel-on', 'ink-light', 'chalky', 'tilt');
    for (const v of ['--safe-l', '--safe-t', '--safe-r', '--safe-b', '--panel-ink', '--panel-accent', '--tilt-x', '--tilt-y']) p.el.style.removeProperty(v);
    p.dead = true; live = live.filter(q => q !== p); };
  onLost = () => { [...live].forEach(unmount); };
  const panels = await Promise.all(els.map(async el => {
    const b = await board(el.dataset.panel).catch(() => null);
    if (!b) return null;
    const cv = document.createElement('canvas'); cv.className = 'panel-art'; cv.setAttribute('aria-hidden', 'true');
    el.prepend(cv); el.classList.add('panel-on');
    // css px per source px; on phones the frame is drawn at 70% so a chunky border still leaves room for the copy (still crisp: downsampled)
    const fit = innerWidth < 500 ? .7 : 1, k = fit / b.pxPerCss; p0fit.set(el, fit);
    el.style.setProperty('--safe-l', `${b.safe.l * k}px`); el.style.setProperty('--safe-t', `${b.safe.t * k}px`);
    el.style.setProperty('--safe-r', `${b.safe.r * k}px`); el.style.setProperty('--safe-b', `${b.safe.b * k}px`);
    if (b.ink) {
      el.style.setProperty('--panel-ink', b.ink);
      const [r, g, bl] = [1, 3, 5].map(i => parseInt(b.ink.slice(i, i + 2), 16) / 255);
      el.classList.toggle('ink-light', .2126 * r + .7152 * g + .0722 * bl > .5);   // cream/chalk ink on a dark board
    }
    if (b.accent) el.style.setProperty('--panel-accent', b.accent);
    el.classList.toggle('chalky', b.surface === 'slate');   // copy is written in chalk on the slate
    const p = { el, cv, ctx: cv.getContext('2d'), b, w: 0, h: 0, vis: false, dirty: true, rx: 0, ry: 0, vx: 0, vy: 0, trx: 0, try: 0 };
    new ResizeObserver(() => { p.dirty = true; kick(); }).observe(el);
    return p;
  }));
  live = panels.filter(Boolean);
  // off screen, a board's canvas gives its backing store back (two dozen live canvases starved Chromium's tile raster on 11-24)
  const io = new IntersectionObserver(es => { for (const e of es) { const p = live.find(q => q.el === e.target); if (p) { p.vis = e.isIntersecting; p.dirty = true; if (!p.vis && p.cv.width) { p.cv.width = 0; p.cv.height = 0; } } } kick(); }, { rootMargin: '200px' });
  live.forEach(p => io.observe(p.el));

  function render(p) {
    const d = dpr(), w = p.el.offsetWidth, h = p.el.offsetHeight;
    const cw = Math.round((w + 2 * BLEED) * d), ch = Math.round((h + 2 * BLEED) * d);
    if (p.cv.width !== cw || p.cv.height !== ch) { p.cv.width = cw; p.cv.height = ch; }
    if (glCanvas.width < cw || glCanvas.height < ch) { glCanvas.width = Math.max(glCanvas.width, cw); glCanvas.height = Math.max(glCanvas.height, ch); }
    gl.viewport(0, glCanvas.height - ch, cw, ch);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    const r = p.el.getBoundingClientRect();
    const b = p.b;
    gl.uniform2f(U('uCanvas'), cw, ch);
    gl.uniform4f(U('uRect'), BLEED * d, BLEED * d, w * d, h * d);
    gl.uniform2f(U('uSrc'), b.w, b.h);
    gl.uniform4f(U('uSlice'), b.slice.l, b.slice.t, b.slice.r, b.slice.b);
    gl.uniform1f(U('uK'), d * (p0fit.get(p.el) || 1) / b.pxPerCss);
    gl.uniform3f(U('uLight'), (light.x - r.left + BLEED) * d, (light.y - r.top + BLEED) * d, light.z * d);
    gl.uniform1f(U('uShadow'), 1);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, b.ta);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, b.tn);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    p.ctx.clearRect(0, 0, cw, ch);
    p.ctx.drawImage(glCanvas, 0, 0, cw, ch, 0, 0, cw, ch);
    p.dirty = false;
    if (!p.ok) {   // first draw: confirm the board really landed (centre pixel opaque) before trusting the panel styling
      let a = 0; try { a = p.ctx.getImageData(cw >> 1, ch >> 1, 1, 1).data[3]; } catch (e) { a = 0; }
      if (a < 128 || gl.getError() !== gl.NO_ERROR) { console.warn('panel board failed to draw; showing plain copy', p.el.dataset.panel); unmount(p); return; }
      p.ok = true;
    }
  }

  function kick() { if (!raf) raf = requestAnimationFrame(step); }
  function step(now) {
    raf = 0;
    const dt = Math.min(.05, (now - last) / 1000); last = now;
    // no pointer (touch, or before the mouse moves): the lamp drifts slowly with the scroll, so boards still catch light
    if (px < 0) { const s = scrollY / innerHeight; light.tx = innerWidth * (.5 + .35 * Math.sin(s * 1.3)); light.ty = innerHeight * (.12 + .1 * Math.cos(s)); }
    const ease = 1 - Math.exp(-dt * 7);
    const lm = Math.abs(light.tx - light.x) + Math.abs(light.ty - light.y);
    light.x += (light.tx - light.x) * ease; light.y += (light.ty - light.y) * ease;
    let moving = lm > .5;
    if (glLost) return;
    for (const p of [...live]) {
      if (!p.vis || p.dead) continue;
      // hang on a hook: a damped spring toward a small tilt that faces the pointer
      if (!reduce && px >= 0 && !coarse) {
        const r = p.el.getBoundingClientRect();
        const nx = Math.max(-1, Math.min(1, (px - (r.left + r.width / 2)) / (r.width * .9)));
        const ny = Math.max(-1, Math.min(1, (py - (r.top + r.height / 2)) / (r.height * 1.2)));
        p.trx = -ny * 3.2; p.try = nx * 4.2;
      } else { p.trx = 0; p.try = 0; }
      const k = 60, c = 2 * Math.sqrt(k) * .55;      // under-damped: it settles with a little sway, like something hanging
      p.vx += (k * (p.trx - p.rx) - c * p.vx) * dt; p.rx += p.vx * dt;
      p.vy += (k * (p.try - p.ry) - c * p.vy) * dt; p.ry += p.vy * dt;
      const tilting = Math.abs(p.rx) + Math.abs(p.ry) + Math.abs(p.vx) + Math.abs(p.vy) > .002;   // 3D layer only while it actually swings
      p.el.classList.toggle('tilt', tilting);
      if (tilting) { p.el.style.setProperty('--tilt-x', `${p.rx.toFixed(3)}deg`); p.el.style.setProperty('--tilt-y', `${p.ry.toFixed(3)}deg`); }
      if (Math.abs(p.vx) + Math.abs(p.vy) + Math.abs(p.trx - p.rx) + Math.abs(p.try - p.ry) > .01) moving = true;
      if (lm > .5 || p.dirty) render(p);
    }
    if (moving) kick();
  }
  addEventListener('pointermove', e => { if (e.pointerType !== 'mouse') return; px = e.clientX; py = e.clientY; light.tx = px; light.ty = py; kick(); }, { passive: true });
  addEventListener('scroll', () => { for (const p of live) if (p.vis) p.dirty = true; kick(); }, { passive: true });
  addEventListener('resize', () => { live.forEach(p => { p.dirty = true; }); kick(); });
  kick();
}
