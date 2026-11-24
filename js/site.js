// Pound for Pound site behaviour. Free scrolling only: every effect is transform/opacity, light, and never holds the page.
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const coarse = matchMedia('(pointer: coarse)').matches;

// ---------- nav background once scrolled ----------
const nav = document.querySelector('.nav');
const onScrollNav = () => nav.classList.toggle('scrolled', scrollY > 40);
addEventListener('scroll', onScrollNav, { passive: true }); onScrollNav();

// ---------- reveals ----------
const io = new IntersectionObserver(es => {
  for (const e of es) if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
}, { rootMargin: '0px 0px -8% 0px', threshold: 0.12 });
document.querySelectorAll('.reveal').forEach(el => io.observe(el));
document.querySelectorAll('.mp-stage').forEach(el => io.observe(el));

// ---------- hero parallax (pointer + gentle scroll), one rAF loop, only while the hero is on screen ----------
const hero = document.querySelector('.hero');
const layers = [...document.querySelectorAll('.hero .layer[data-depth]')].map(el => ({ el, d: +el.dataset.depth, fighter: el.classList.contains('layer-fighter') }));
let px = 0, py = 0, tx = 0, ty = 0, heroOn = true, raf = 0;
if (!reduce) {
  addEventListener('pointermove', e => { if (e.pointerType === 'mouse') { tx = e.clientX / innerWidth - .5; ty = e.clientY / innerHeight - .5; } }, { passive: true });
  if (coarse && window.DeviceOrientationEvent) {
    addEventListener('deviceorientation', e => { if (e.gamma != null) { tx = Math.max(-.5, Math.min(.5, e.gamma / 50)); ty = Math.max(-.5, Math.min(.5, (e.beta - 45) / 70)); } }, { passive: true });
  }
  new IntersectionObserver(([e]) => { heroOn = e.isIntersecting; if (heroOn) kick(); }).observe(hero);
}
function kick() { if (!raf) raf = requestAnimationFrame(tick); }
function tick() {
  raf = 0;
  if (!heroOn) return;
  px += (tx - px) * .06; py += (ty - py) * .06;
  const s = Math.min(scrollY, innerHeight);
  for (const L of layers) {
    const x = -px * 40 * L.d, y = -py * 22 * L.d + s * L.d * .28;
    const base = L.fighter ? 'translateX(-50%) ' : '';
    const scale = L.fighter ? ` scale(${1 + s / innerHeight * .06})` : '';
    L.el.style.transform = `${base}translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0)${scale}`;
  }
  dust && dust.step();
  raf = requestAnimationFrame(tick);
}
// place the fighter even before the loop runs
layers.forEach(L => { if (L.fighter) L.el.style.transform = 'translateX(-50%)'; });

// ---------- dust motes drifting through the lamp light ----------
const dust = (() => {
  const c = document.querySelector('.layer-dust');
  if (!c || reduce) return null;
  const ctx = c.getContext('2d');
  const N = coarse ? 26 : 46; const motes = [];
  let w = 0, h = 0, dpr = 1;
  const size = () => { dpr = Math.min(devicePixelRatio || 1, 1.5); w = c.clientWidth; h = c.clientHeight; c.width = w * dpr; c.height = h * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); };
  size(); addEventListener('resize', size);
  for (let i = 0; i < N; i++) motes.push({ x: Math.random(), y: Math.random(), r: .6 + Math.random() * 1.8, vx: (Math.random() - .5) * .00012, vy: -.00004 - Math.random() * .00012, p: Math.random() * 6.28 });
  return { step() {
    ctx.clearRect(0, 0, w, h);
    for (const m of motes) {
      m.x += m.vx + Math.sin(m.p += .006) * .00006; m.y += m.vy;
      if (m.y < -.02) { m.y = 1.02; m.x = Math.random(); }
      if (m.x < -.02) m.x = 1.02; else if (m.x > 1.02) m.x = -.02;
      // brighter near the lamps at the top centre
      const lit = Math.max(0, 1 - Math.hypot(m.x - .5, (m.y - .1) * 1.4) * 1.5);
      const a = .08 + lit * .5;
      ctx.fillStyle = `rgba(255, 214, 160, ${a.toFixed(3)})`;
      ctx.beginPath(); ctx.arc(m.x * w, m.y * h, m.r, 0, 6.283); ctx.fill();
    }
  } };
})();
if (!reduce) kick();

// ---------- damage section: the punch lands once when it comes into view ----------
const impact = document.getElementById('impact');
if (impact) {
  const num = impact.querySelector('.dmg-num');
  new IntersectionObserver(([e], obs) => {
    if (!e.isIntersecting) return;
    obs.disconnect();
    setTimeout(() => {
      impact.classList.add('hit');
      if (reduce) { num.textContent = '91'; return; }
      const t0 = performance.now();
      const run = t => { const k = Math.min(1, (t - t0) / 900); num.textContent = Math.round(91 * (1 - Math.pow(1 - k, 3))); if (k < 1) requestAnimationFrame(run); };
      requestAnimationFrame(run);
    }, 450);
  }, { threshold: .55 }).observe(impact);
}

// ---------- hung objects: prints, boards and the modes picture swing on their hooks ----------
const hangReady = import('./hang.js?v=16').then(m => { m.initHang(); return m; }).catch(() => null);

// ---------- modes: the menu board's pads swap the hung picture, and the swap knocks it ----------
{
  const frame = document.getElementById('mode-frame'), data = [...(document.getElementById('mode-data')?.content.children || [])];
  const pads = [...document.querySelectorAll('.mode-pad')];
  pads.forEach(pad => pad.addEventListener('click', async () => {
    const i = +pad.dataset.mode, d = data[i]; if (!d || pad.getAttribute('aria-selected') === 'true') return;
    pads.forEach(p => p.setAttribute('aria-selected', String(p === pad)));
    const img = frame.querySelector('img'), next = new Image(); next.src = d.dataset.img;
    try { await next.decode(); } catch { /* swap anyway */ }
    img.src = d.dataset.img; img.alt = d.dataset.alt;
    frame.querySelector('h3').textContent = d.dataset.title; frame.querySelector('.mode-card p').textContent = d.textContent;
    (await hangReady)?.knock(frame, .9, i > 0 ? 1 : -1);
  }));
}

// ---------- phones: some copy sits on a board only in the portrait layout ----------
const phone = matchMedia('(max-width: 760px)').matches;
if (phone) document.querySelectorAll('[data-panel-phone]').forEach(el => { el.dataset.panel = el.dataset.panelPhone; });

// ---------- phone menu: a leather board of section pads that drops from the nav and swings on its hook ----------
{
  const nav = document.querySelector('.nav'), btn = nav?.querySelector('.nav-menu'), list = document.getElementById('nav-sections');
  if (btn && list) {
    list.classList.add('hang');
    const set = open => { nav.classList.toggle('open', open); btn.setAttribute('aria-expanded', String(open)); if (open) hangReady.then(m => m?.knock(list, .7, 1)); };
    btn.addEventListener('click', () => set(!nav.classList.contains('open')));
    list.addEventListener('click', e => { if (e.target.closest('a')) set(false); });
    addEventListener('keydown', e => { if (e.key === 'Escape') set(false); });
  }
}

// ---------- the chalkboard: tricks already struck through, KOs circled (static) ----------
import('./chalk.js?v=7').then(m => m.initChalk(document.querySelector('.chalk-hold'))).catch(err => console.warn('chalk unavailable', err));

// ---------- copy panels: baked boards relit by the pointer ----------
import('./panels.js?v=22').then(m => m.initPanels()).catch(err => console.warn('panels unavailable', err));

// ---------- fighter-select poster wall (idle loops, breakout on arrival / point / tap) ----------
{
  const wall = document.getElementById('poster-wall');
  if (wall) {
    const go = () => import('./posters.js?v=17').then(m => m.initPosters(wall)).catch(err => console.warn('posters unavailable', err));
    const o = new IntersectionObserver(([e]) => { if (e.isIntersecting) { o.disconnect(); go(); } }, { rootMargin: '900px' });
    o.observe(wall);
  }
}

// ---------- gallery lightbox ----------
const lb = document.getElementById('lightbox'); const lbImg = lb.querySelector('img');
document.querySelectorAll('.shot').forEach(a => a.addEventListener('click', e => {
  e.preventDefault(); lbImg.src = a.getAttribute('href'); lbImg.alt = a.querySelector('img').alt; lb.hidden = false; lb.querySelector('.lb-close').focus();
}));
const closeLb = () => { lb.hidden = true; lbImg.removeAttribute('src'); };
lb.addEventListener('click', e => { if (e.target !== lbImg) closeLb(); });
addEventListener('keydown', e => { if (e.key === 'Escape' && !lb.hidden) closeLb(); });

// ---------- lazy 3D: mount each viewer only when its section nears view ----------
function whenNear(el, fn, margin = '600px') {
  if (!el) return;
  const o = new IntersectionObserver(([e]) => { if (e.isIntersecting) { o.disconnect(); fn(); } }, { rootMargin: margin });
  o.observe(el);
}
// glove section removed (owner, 11-24); glove-viewer.js stays in the repo as the relight reference for hero Cole and the panels
whenNear(document.getElementById('bag-mount'), async () => {
  try {
    const { mountHeavyBag } = await import('./bag/heavy-bag.js?v=2');
    mountHeavyBag(document.getElementById('bag-mount'), { lazy: false, readout: false });
  } catch (err) { console.warn('heavy bag unavailable', err); }
});

// ---------- gym-made 3D UI: nav pads, Wishlist cushions and section plates as real leather (the CSS pads stay the fallback) ----------
const startGymUI = () => import('./gymui.js?v=2').then((m) => m.initGymUI()).catch((err) => console.warn('gym UI unavailable', err));
if (document.readyState === 'complete') startGymUI(); else addEventListener('load', startGymUI, { once: true });

// ---------- the rail: baked gym flythrough on the fixed canvas, driven by native scroll ----------
// 'flight' is store-art's seg01 (hero wide to ring POV), web copy from site-tools/make_rail_web.py; the full flythrough's segments follow.
import('./rail.js?v=26').then(({ initRail }) => initRail({
  canvas: document.getElementById('rail'),
  segments: { flight: 'assets/rail/seg01/v/seg.json' },
})).catch(err => { document.documentElement.classList.add('no-rail'); console.warn('rail unavailable', err); });

// ---------- body-tracking videos: load and play only near view, and only once assets/video/index.json lists the file ----------
const videoIndex = fetch('assets/video/index.json').then(r => (r.ok ? r.json() : {})).then(j => new Set(j.files || [])).catch(() => new Set());
document.querySelectorAll('video[data-src]').forEach(v => {
  const o = new IntersectionObserver(async ([e]) => {
    if (e.isIntersecting) {
      if (!v.src) {
        const name = v.dataset.src.split('/').pop();
        if (!(await videoIndex).has(name)) return;
        v.src = v.dataset.src;
      }
      if (!matchMedia('(prefers-reduced-motion: reduce)').matches) v.play().catch(() => {});
    } else if (v.src) v.pause();
  }, { rootMargin: '200px' });
  o.observe(v);
});

// ---------- rail cards: approach from the depth of the gym, then fly past overhead (scroll-linked, never pinned) ----------
{
  const cards = [...document.querySelectorAll('.rail-card:not(.rail-card-plague)')];
  const rm = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!rm && cards.length && !phone) {
    let ticking = false;
    const upd = () => {
      ticking = false; const vh = innerHeight;
      for (const c of cards) {
        if (!c.classList.contains('in')) continue;
        if (!c.classList.contains('fly')) { if (!c._t) c._t = setTimeout(() => c.classList.add('fly'), 850); continue; }
        const r = c.getBoundingClientRect(); const k = ((r.top + r.height / 2) - vh / 2) / vh;  // + below centre, - above
        const side = c.classList.contains('rail-card-plague') || c.classList.contains('rail-card-fn') ? 1 : -1;
        if (k > 0) { // coming toward you out of the gym
          c.style.setProperty('--fz', `${(-k * 420).toFixed(1)}px`); c.style.setProperty('--frx', `${(k * 16).toFixed(2)}deg`);
          c.style.setProperty('--fry', `${(side * k * 10).toFixed(2)}deg`); c.style.setProperty('--fx', `${(side * k * 40).toFixed(1)}px`);
          // boards never fade: they are objects, so they only move
        } else {     // passing overhead and behind you
          c.style.setProperty('--fz', `${(-k * 260).toFixed(1)}px`); c.style.setProperty('--frx', `${(k * 22).toFixed(2)}deg`);
          c.style.setProperty('--fry', '0deg'); c.style.setProperty('--fx', '0px');
          // (no fade on the way out either)
        }
      }
    };
    const req = () => { if (!ticking) { ticking = true; requestAnimationFrame(upd); } };
    addEventListener('scroll', req, { passive: true }); addEventListener('resize', req);
    setInterval(req, 400);
  }
}
