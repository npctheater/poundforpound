// Fighter-select poster wall: lean hardware-decoded 720x1080 H.264 portal breakouts + live idle loops.
// Auto-plays staggered breakouts on arrival (desktop: all three; phone: whichever bay is centered in the swipe strip),
// replays on click/tap/hover, and strictly pauses ALL videos the instant the wall leaves the viewport.
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
  if (c.mp4 && can('video/mp4; codecs="hvc1.1.6.L120.90"')) return c.mp4;
  if (c.webm && can('video/webm; codecs="av01.0.08M.08"')) return c.webm;
  return c.mp4 || c.webm;
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

    // Prefer baked-down hardware-decoded H.264 web clips (720x1080, 3.4x lighter, silky smooth on phone & desktop)
    const openFile = m.openingWeb || pick(m.opening);
    const idleFile = m.idleWeb || pick(m.idle);

    const s = {
      bay, idle, open, m, busy: false, played: false, loaded: false,
      load() {
        if (s.loaded) return;
        s.loaded = true;
        idle.src = m.base + idleFile;
        open.src = m.base + openFile;
        idle.preload = open.preload = 'auto';
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
      if (!wallVisible) { bay.classList.remove('opening'); idle.pause(); return; }
      idle.currentTime = 0;
      const p = idle.play();
      if (p) p.catch(() => {});
      bay.classList.add('has-idle');
      requestAnimationFrame(() => requestAnimationFrame(() => bay.classList.remove('opening')));
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

  // Strictly pause everything when #fighters leaves view; auto-play staggered breakouts on arrival
  new IntersectionObserver(([e]) => {
    wallVisible = e.isIntersecting;
    if (!wallVisible) {
      clearTimers();
      for (const s of state.values()) s.pauseAll();
      return;
    }
    if (!arrived) {
      arrived = true;
      const targets = coarse ? bays.slice(0, 1) : bays;
      targets.forEach((b, i) => {
        const id = setTimeout(() => { timers.delete(id); if (wallVisible) breakout(b); }, 180 + i * 420);
        timers.add(id);
      });
    } else {
      for (const s of state.values()) {
        if (s.bay.classList.contains('has-idle') && (!coarse || s.bay.classList.contains('on'))) {
          const p = s.idle.play();
          if (p) p.catch(() => {});
        }
      }
    }
  }, { threshold: 0.12 }).observe(wall);

  // On phones, play whichever fighter is centered as the user swipes horizontally (only 1 active decoder at a time)
  if (coarse) {
    const bayIO = new IntersectionObserver((es) => {
      if (!wallVisible) return;
      for (const e of es) {
        const bay = e.target;
        const s = state.get(bay);
        if (!s) continue;
        if (e.isIntersecting) {
          for (const other of state.values()) if (other.bay !== bay) other.pauseAll();
          bays.forEach((b) => b.classList.toggle('on', b === bay));
          if (!s.played) breakout(bay);
          else if (bay.classList.contains('has-idle')) s.idle.play().catch(() => {});
        }
      }
    }, { root: wall, threshold: 0.65 });
    bays.forEach((b) => bayIO.observe(b));
  }

  let current = null;
  const light = (bay) => {
    if (bay === current) return;
    current = bay;
    bays.forEach((b) => b.classList.toggle('on', b === bay));
    wall.classList.toggle('lit', !!bay);
    if (!coarse && bay && state.get(bay)?.played) breakout(bay);
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
