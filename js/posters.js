// Fighter-select poster wall: lean hardware-decoded 720x1080 H.264 portal breakouts + live idle loops.
// Strictly 1 active fighter video at a time so scrolling stays locked 60fps: Cole plays on arrival,
// hovering/clicking (desktop) or swiping/tapping (phone) any fighter pauses the others and plays its breakout + idle.
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
  let wallVisible = false;
  let activeBay = null;

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

    const openFile = m.openingWeb || pick(m.opening);
    const idleFile = m.idleWeb || pick(m.idle);

    const s = {
      bay, idle, open, m, busy: false, played: false, loaded: false,
      load() {
        if (s.loaded) return;
        s.loaded = true;
        idle.src = m.base + idleFile;
        open.src = m.base + openFile;
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
      if (!wallVisible || activeBay !== bay) { open.pause(); s.busy = false; return; }
      bay.classList.add('opening');
    });
    open.addEventListener('ended', () => {
      s.busy = false;
      if (!wallVisible || activeBay !== bay) { bay.classList.remove('opening'); idle.pause(); return; }
      window.__p4pClaimVideo?.(idle);
      idle.currentTime = 0;
      const p = idle.play();
      if (p) p.catch(() => {});
      bay.classList.add('has-idle');
      requestAnimationFrame(() => requestAnimationFrame(() => bay.classList.remove('opening')));
    });
  }));

  function activateBay(bay, replayOpening = true) {
    if (!bay || !wallVisible) return;
    const s = state.get(bay);
    if (!s) return;
    for (const other of state.values()) if (other.bay !== bay) other.pauseAll();
    activeBay = bay;
    bays.forEach((b) => b.classList.toggle('on', b === bay));
    if (reduce) return;
    s.load();
    if (replayOpening || !s.played) {
      s.played = true;
      s.busy = true;
      window.__p4pClaimVideo?.(s.open);
      s.open.currentTime = 0;
      const p = s.open.play();
      if (p) p.catch(() => { s.busy = false; bay.classList.remove('opening'); });
    } else if (bay.classList.contains('has-idle')) {
      window.__p4pClaimVideo?.(s.idle);
      s.idle.play().catch(() => {});
    }
  }

  let arriveTimer = 0;
  new IntersectionObserver(([e]) => {
    wallVisible = e.isIntersecting;
    if (!wallVisible) {
      if (arriveTimer) { clearTimeout(arriveTimer); arriveTimer = 0; }
      for (const s of state.values()) s.pauseAll();
      return;
    }
    if (!activeBay) {
      // Brief pause so all three painted fighter posters register cleanly on arrival before Cole's portal breakout plays
      arriveTimer = setTimeout(() => { arriveTimer = 0; if (wallVisible && !activeBay) activateBay(bays[0], true); }, 650);
    } else {
      activateBay(activeBay, false);
    }
  }, { threshold: 0.15 }).observe(wall);

  if (coarse) {
    const bayIO = new IntersectionObserver((es) => {
      if (!wallVisible) return;
      for (const e of es) {
        if (e.isIntersecting && e.target !== activeBay) activateBay(e.target, false);
      }
    }, { root: wall, threshold: 0.65 });
    bays.forEach((b) => bayIO.observe(b));
  } else {
    let hoverBay = null;
    wall.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse') return;
      const bay = e.target.closest('.bay');
      if (bay === hoverBay) return;
      hoverBay = bay;
      wall.classList.toggle('lit', !!bay);
      if (bay && bay !== activeBay) activateBay(bay, true);
    }, { passive: true });
    wall.addEventListener('pointerleave', () => {
      hoverBay = null;
      wall.classList.remove('lit');
    });
  }

  bays.forEach((bay) => {
    bay.addEventListener('click', () => activateBay(bay, true));
    bay.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activateBay(bay, true); } });
    bay.addEventListener('focus', () => { if (bay !== activeBay) activateBay(bay, false); });
  });
}
