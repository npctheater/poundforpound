// Fighter-select poster wall. Each bay shows its sharp still immediately, loads video only on scroll proximity,
// plays its breakout on arrival/click, and strictly pauses ALL videos the instant the wall leaves the viewport.
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const coarse = matchMedia('(pointer: coarse)').matches;

let index = null;
async function manifestFor(id) {
  index ??= fetch('assets/posters/index.json').then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
  const rel = (await index).fighters?.[id];
  if (!rel) return null;
  try {
    const url = new URL('assets/posters/' + rel, location.href);
    const m = await (await fetch(url)).json();
    return { base: new URL('.', url).href, ...m };
  } catch { return null; }
}

const probe = document.createElement('video');
const can = (t) => probe.canPlayType(t) !== '';
function pick(c) {
  if (typeof c === 'string') return c;
  if (c.webm && can('video/webm; codecs="av01.0.08M.08"')) return c.webm;
  if (c.mp4 && (can('video/mp4; codecs="hvc1.1.6.L120.90"') || !c.webm)) return c.mp4;
  return c.webm || c.mp4;
}

export async function initPosters(wall) {
  if (!wall) return;
  const bays = [...wall.querySelectorAll('.bay')];
  const state = new Map();
  const timers = new Set();
  let wallVisible = false;
  let arrived = false;

  await Promise.all(bays.map(async (bay) => {
    const m = await manifestFor(bay.dataset.poster);
    if (!m) { bay.classList.add('empty'); return; }
    const film = bay.querySelector('.bay-film');
    const idle = bay.querySelector('.bay-idle');
    const open = bay.querySelector('.bay-open');

    // Always mount the real fighter still immediately so a bay never appears as blank sky/paper
    if (m.still) {
      let stillImg = film.querySelector('.bay-still');
      if (!stillImg) {
        stillImg = document.createElement('img');
        stillImg.className = 'bay-still';
        stillImg.alt = '';
        stillImg.loading = 'lazy';
        stillImg.decoding = 'async';
        film.prepend(stillImg);
      }
      stillImg.src = m.base + m.still;
      idle.poster = m.base + m.still;
    }

    const s = {
      bay, idle, open, m, busy: false, played: false, loaded: false,
      load() {
        if (s.loaded) return;
        s.loaded = true;
        idle.src = m.base + pick(m.idle);
        open.src = m.base + pick(m.opening);
        idle.preload = open.preload = 'metadata';
      },
      pauseAll() {
        if (!idle.paused) idle.pause();
        if (!open.paused) open.pause();
        if (s.busy) {
          s.busy = false;
          bay.classList.remove('opening');
        }
      },
    };
    state.set(bay, s);

    open.addEventListener('playing', () => {
      if (!wallVisible) { open.pause(); s.busy = false; return; }
      bay.classList.add('opening');
    });
    open.addEventListener('ended', () => {
      s.busy = false;
      bay.classList.remove('opening');
      if (!wallVisible) { idle.pause(); return; }
      idle.currentTime = 0;
      const p = idle.play();
      if (p) p.catch(() => {});
      bay.classList.add('has-idle');
    });
  }));

  function clearTimers() {
    for (const t of timers) clearTimeout(t);
    timers.clear();
  }

  function breakout(bay) {
    const s = state.get(bay);
    if (!s || s.busy || !wallVisible) return;
    s.load();
    s.played = true;
    if (reduce) return;
    s.busy = true;
    s.open.currentTime = 0;
    const p = s.open.play();
    if (p) {
      p.catch(() => {
        s.busy = false;
        bay.classList.remove('opening');
      });
    }
  }

  // Track wall visibility strictly: keep crisp fighter stills visible on arrival (never blank intro sky!),
  // play portal breakout on click/tap or desktop hover, and pause ALL videos immediately off-screen.
  new IntersectionObserver(([e]) => {
    wallVisible = e.isIntersecting;
    if (!wallVisible) {
      clearTimers();
      for (const s of state.values()) s.pauseAll();
      return;
    }
    for (const s of state.values()) {
      if (s.bay.classList.contains('has-idle')) {
        const p = s.idle.play();
        if (p) p.catch(() => {});
      }
    }
  }, { threshold: 0.05 }).observe(wall);

  // Subtle highlight on active bay (CSS-only transitions, zero continuous rAF)
  let current = null;
  const light = (bay) => {
    if (bay === current) return;
    current = bay;
    bays.forEach((b) => b.classList.toggle('on', b === bay));
    wall.classList.toggle('lit', !!bay);
  };

  if (!coarse) {
    wall.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse') return;
      const r = wall.getBoundingClientRect();
      wall.style.setProperty('--lx', `${(((e.clientX - r.left) / r.width) * 100).toFixed(1)}%`);
      wall.style.setProperty('--ly', `${(Math.min(0.75, (e.clientY - r.top) / r.height) * 100).toFixed(1)}%`);
      light(e.target.closest('.bay'));
    }, { passive: true });
    wall.addEventListener('pointerleave', () => light(null));
  }

  bays.forEach((bay) => {
    bay.addEventListener('click', () => {
      if (coarse) {
        // On phones, pause other bays when tapping one so only 1 video decodes at a time
        for (const s of state.values()) if (s.bay !== bay) s.pauseAll();
      }
      current = null;
      light(bay);
      breakout(bay);
    });
    bay.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); bay.click(); } });
    bay.addEventListener('focus', () => light(bay));
  });
}
