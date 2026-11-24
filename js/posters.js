// Fighter-select poster wall. Each bay has an idle loop under a one-shot opening (the breakout).
// Media comes from assets/posters/<id>/manifest.json (Unity bakes) and falls back to the stand-in folder.
// Arriving at the wall breaks the fighters out one after another; pointing at or tapping a poster replays its breakout.
// A single lamp pool follows the pointer and the bay under it is the lit one, the way the game's select lights its pick.
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

// assets/posters/index.json lists the fighters whose Unity bake has landed: {"fighters": {"cole": "cole/manifest.json"}}.
// One request, no 404s for bakes that are still on their way.
let index = null;
async function manifestFor(id) {
  index ??= fetch('assets/posters/index.json').then(r => (r.ok ? r.json() : {})).catch(() => ({}));
  const rel = (await index).fighters?.[id];
  if (!rel) return null;
  try {
    const url = new URL('assets/posters/' + rel, location.href);
    const m = await (await fetch(url)).json();
    return { base: new URL('.', url).href, ...m };
  } catch { return null; }
}

// A clip is either a path or {webm, mp4}: AV1 webm where the browser decodes it, HEVC mp4 (Safari, iPhone) next.
const probe = document.createElement('video');
const can = t => probe.canPlayType(t) !== '';
function pick(c) {
  if (typeof c === 'string') return c;
  if (c.webm && can('video/webm; codecs="av01.0.08M.08"')) return c.webm;
  if (c.mp4 && (can('video/mp4; codecs="hvc1.1.6.L120.90"') || !c.webm)) return c.mp4;
  return c.webm || c.mp4;
}

export async function initPosters(wall) {
  if (!wall) return;
  const bays = [...wall.querySelectorAll('.bay')];
  const lamp = wall.querySelector('.wall-lamp');
  const state = new Map();
  const near = new IntersectionObserver(es => { for (const e of es) if (e.isIntersecting) { state.get(e.target)?.load(); near.unobserve(e.target); } }, { rootMargin: '75% 0px' });

  await Promise.all(bays.map(async bay => {
    const m = await manifestFor(bay.dataset.poster);
    if (!m) { bay.classList.add('empty'); return; }
    const idle = bay.querySelector('.bay-idle'), open = bay.querySelector('.bay-open');
    if (m.still) { idle.poster = m.base + m.still; }
    // the clips are big (crisp 1080x1620, 1.5-3 MB each): each bay fetches its own only as it nears the viewport
    const s = { bay, idle, open, busy: false, played: false, loaded: false,
      load() { if (s.loaded) return; s.loaded = true; idle.src = m.base + pick(m.idle); open.src = m.base + pick(m.opening); idle.preload = open.preload = 'auto'; } };
    state.set(bay, s);
    near.observe(bay);
    // the opening's first frame is the blank poster: show it until the fighter breaks out
    open.addEventListener('loadeddata', () => { if (!s.played) bay.classList.add('opening'); }, { once: true });
    open.addEventListener('ended', () => {
      // idle frame 0 is the opening's last frame, so restarting it here is seamless
      idle.currentTime = 0;
      const p = idle.play(); if (p) p.catch(() => {});
      bay.classList.add('has-idle');
      requestAnimationFrame(() => requestAnimationFrame(() => { bay.classList.remove('opening'); s.busy = false; }));
    });
  }));

  function breakout(bay) {
    const s = state.get(bay); if (!s || s.busy) return;
    s.load(); s.busy = true; s.played = true;
    if (reduce) { s.open.dispatchEvent(new Event('ended')); return; }
    s.open.currentTime = 0;
    bay.classList.add('opening');
    const p = s.open.play();
    if (p) p.catch(() => { s.busy = false; bay.classList.remove('opening'); bay.classList.add('has-idle'); });
  }

  // arrival: break out left to right with a beat between, like the select screen filling its wall
  const io = new IntersectionObserver(es => {
    for (const e of es) if (e.isIntersecting) {
      io.disconnect();
      bays.forEach((b, i) => setTimeout(() => breakout(b), 250 + i * 650));
    }
  }, { threshold: .45 });
  io.observe(wall);

  // offscreen: pause the loops, resume when back
  new IntersectionObserver(([e]) => {
    for (const s of state.values()) {
      if (!e.isIntersecting) { s.idle.pause(); } else if (s.bay.classList.contains('has-idle')) { const p = s.idle.play(); if (p) p.catch(() => {}); }
    }
  }).observe(wall);

  // the lamp: follows the pointer with a little lag, lights one bay
  let lx = .5, ly = .3, tx = .5, ty = .3, raf = 0, current = null;
  const step = () => {
    lx += (tx - lx) * .14; ly += (ty - ly) * .14;
    wall.style.setProperty('--lx', `${(lx * 100).toFixed(2)}%`); wall.style.setProperty('--ly', `${(ly * 100).toFixed(2)}%`);
    raf = Math.abs(tx - lx) + Math.abs(ty - ly) > .001 ? requestAnimationFrame(step) : 0;
  };
  const light = bay => {
    if (bay === current) return;
    current = bay;
    bays.forEach(b => b.classList.toggle('on', b === bay));
    wall.classList.toggle('lit', !!bay);
    wall.style.setProperty('--lamp', bay ? '1' : '0');
    if (bay && state.get(bay)?.played) breakout(bay);
  };
  wall.addEventListener('pointermove', e => {
    const r = wall.getBoundingClientRect();
    tx = (e.clientX - r.left) / r.width; ty = Math.min(.75, (e.clientY - r.top) / r.height);
    if (!raf) raf = requestAnimationFrame(step);
    if (e.pointerType === 'mouse') light(e.target.closest('.bay'));
  });
  wall.addEventListener('pointerleave', () => light(null));
  bays.forEach(bay => {
    bay.addEventListener('click', () => { const r = bay.getBoundingClientRect(), w = wall.getBoundingClientRect();
      tx = (r.left + r.width / 2 - w.left) / w.width; ty = .3; if (!raf) raf = requestAnimationFrame(step);
      current = null; light(bay); breakout(bay); });
    bay.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); bay.click(); } });
    bay.addEventListener('focus', () => light(bay));
  });
}
