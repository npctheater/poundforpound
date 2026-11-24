// Pound for Pound site behaviour. Free native scrolling, strictly 1 active video at a time, zero idle loops.
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const coarse = matchMedia('(pointer: coarse)').matches;

// Global single-video coordinator: never allow 2+ videos to decode concurrently anywhere on the page
window.__p4pClaimVideo = (active) => {
  document.querySelectorAll('video').forEach((v) => {
    if (v !== active && !v.paused) v.pause();
  });
};

// ---------- nav background once scrolled ----------
const nav = document.querySelector('.nav');
let navScrolled = false;
const onScrollNav = () => {
  const next = scrollY > 40;
  if (next !== navScrolled) { navScrolled = next; nav.classList.toggle('scrolled', next); }
};
addEventListener('scroll', onScrollNav, { passive: true });
onScrollNav();

// ---------- reveals (instant when visible; lightweight one-shot observer) ----------
const io = new IntersectionObserver((es) => {
  for (const e of es) if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
}, { rootMargin: '0px 0px -6% 0px', threshold: 0.08 });
document.querySelectorAll('.reveal, .mp-stage').forEach((el) => io.observe(el));

// ---------- hung objects: deliberate knock on mode swap / phone menu ----------
const hangReady = import('./hang.js?v=17').then((m) => { m.initHang(); return m; }).catch(() => null);

// ---------- modes: menu board pads swap the framed picture with a subtle knock ----------
{
  const frame = document.getElementById('mode-frame');
  const data = [...(document.getElementById('mode-data')?.content.children || [])];
  const pads = [...document.querySelectorAll('.mode-pad')];
  pads.forEach((pad) => pad.addEventListener('click', async () => {
    const i = +pad.dataset.mode, d = data[i];
    if (!d || pad.getAttribute('aria-selected') === 'true') return;
    pads.forEach((p) => p.setAttribute('aria-selected', String(p === pad)));
    const img = frame.querySelector('img'), next = new Image();
    next.src = d.dataset.img;
    try { await next.decode(); } catch { /* swap anyway */ }
    img.src = d.dataset.img; img.alt = d.dataset.alt;
    frame.querySelector('h3').textContent = d.dataset.title;
    frame.querySelector('.mode-card p').textContent = d.textContent;
    (await hangReady)?.knock(frame, 0.75, i > 0 ? 1 : -1);
  }));
}

// ---------- phone menu ----------
{
  const btn = nav?.querySelector('.nav-menu');
  const list = document.getElementById('nav-sections');
  if (btn && list) {
    list.classList.add('hang');
    const set = (open) => {
      nav.classList.toggle('open', open);
      btn.setAttribute('aria-expanded', String(open));
      if (open) hangReady.then((m) => m?.knock(list, 0.55, 1));
    };
    btn.addEventListener('click', () => set(!nav.classList.contains('open')));
    list.addEventListener('click', (e) => { if (e.target.closest('a')) set(false); });
    addEventListener('keydown', (e) => { if (e.key === 'Escape') set(false); });
  }
}

// ---------- chalkboard strikes (static SVG paths fitted on layout) ----------
import('./chalk.js?v=8').then((m) => m.initChalk(document.querySelector('.chalk-hold'))).catch((err) => console.warn('chalk unavailable', err));

// ---------- copy panels: pre-lit baked boards (zero WebGL, lazy per-panel) ----------
import('./panels.js?v=25').then((m) => m.initPanels()).catch((err) => console.warn('panels unavailable', err));

// ---------- fighter-select poster wall (lazy init only near view; 1 active fighter video at a time) ----------
{
  const wall = document.getElementById('poster-wall');
  if (wall) {
    const o = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) {
        o.disconnect();
        import('./posters.js?v=20').then((m) => m.initPosters(wall)).catch((err) => console.warn('posters unavailable', err));
      }
    }, { rootMargin: '450px 0px' });
    o.observe(wall);
  }
}

// ---------- gallery lightbox (creates <img> on demand so DOM has zero empty broken images) ----------
{
  const lb = document.getElementById('lightbox');
  let lbImg = null;
  const openLb = (href, alt) => {
    if (!lbImg) { lbImg = document.createElement('img'); lb.appendChild(lbImg); }
    lbImg.src = href; lbImg.alt = alt;
    lb.hidden = false;
    lb.querySelector('.lb-close').focus();
  };
  const closeLb = () => {
    lb.hidden = true;
    if (lbImg) { lbImg.remove(); lbImg = null; }
  };
  document.querySelectorAll('.shot').forEach((a) => a.addEventListener('click', (e) => {
    e.preventDefault();
    openLb(a.getAttribute('href'), a.querySelector('img')?.alt || '');
  }));
  lb.addEventListener('click', (e) => { if (e.target !== lbImg) closeLb(); });
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && !lb.hidden) closeLb(); });
}

// ---------- lazy 3D heavy bag: mounts only when approaching #bag ----------
{
  const mountEl = document.getElementById('bag-mount');
  if (mountEl) {
    const o = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) {
        o.disconnect();
        import('./bag/heavy-bag.js?v=4')
          .then(({ mountHeavyBag }) => mountHeavyBag(mountEl, { lazy: false, readout: false, maxPixelRatio: coarse ? 1.5 : 1.75 }))
          .catch((err) => console.warn('heavy bag unavailable', err));
      }
    }, { rootMargin: '320px 0px' });
    o.observe(mountEl);
  }
}

// ---------- gym-made 3D UI: bake once into 2D canvases and release its WebGL context immediately ----------
const startGymUI = () => import('./gymui.js?v=3').then((m) => m.initGymUI()).catch((err) => console.warn('gym UI unavailable', err));
if (document.readyState === 'complete') startGymUI(); else addEventListener('load', startGymUI, { once: true });

// ---------- the rail: hardware-decoded 60fps ring backdrop (zero scroll-scrubbing, zero stepping, 0 idle rAF) ----------
import('./rail.js?v=34').then(({ initRail }) => initRail({
  canvas: document.getElementById('rail'),
})).catch((err) => { document.documentElement.classList.add('no-rail'); console.warn('rail unavailable', err); });

// ---------- highlight videos: strictly 1 active video at a time; hero auto-plays in view, others play on click/tap ----------
{
  let videoIndexPromise = null;
  const getVideoIndex = () => (videoIndexPromise ??= fetch('assets/video/index.json')
    .then((r) => (r.ok ? r.json() : {}))
    .then((j) => new Set(j.files || []))
    .catch(() => new Set()));

  const PLAY_SVG = '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><polygon points="7,4 20,12 7,20"/></svg>';
  const vids = [...document.querySelectorAll('video[data-src]')];
  vids.forEach((v) => {
    const fig = v.closest('.vid');
    const isHeroVid = v.closest('.vid-hero') !== null;

    let btn = null;
    if (!isHeroVid && fig) {
      btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'vid-play';
      btn.setAttribute('aria-label', 'Play clip');
      btn.innerHTML = PLAY_SVG;
      fig.appendChild(btn);
    }

    const syncState = () => fig?.classList.toggle('is-playing', !v.paused && !v.ended);
    v.addEventListener('play', syncState);
    v.addEventListener('pause', syncState);
    v.addEventListener('ended', syncState);

    const startPlay = async () => {
      if (!v.src) {
        const name = v.dataset.src.split('/').pop().split('?')[0];
        const idx = await getVideoIndex();
        if (!idx.has(name)) return;
        v.src = v.dataset.src;
      }
      window.__p4pClaimVideo?.(v);
      v.play().catch(() => {});
    };

    const togglePlay = () => {
      if (!v.paused) { v.pause(); return; }
      startPlay();
    };
    if (btn) btn.addEventListener('click', togglePlay);
    v.addEventListener('click', togglePlay);

    let isVis = false;
    const o = new IntersectionObserver(async ([e]) => {
      isVis = e.isIntersecting;
      if (isVis && isHeroVid && !reduce) {
        if (!v.src) {
          const name = v.dataset.src.split('/').pop().split('?')[0];
          const idx = await getVideoIndex();
          if (!isVis || !idx.has(name)) return;
          v.src = v.dataset.src;
        }
        if (isVis) {
          window.__p4pClaimVideo?.(v);
          v.play().catch(() => {});
        }
      } else if (!isVis && v.src && !v.paused) {
        v.pause();
      }
    }, { rootMargin: '60px 0px', threshold: 0.15 });
    o.observe(v);
  });
}
