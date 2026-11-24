// Hardware-decoded 60fps night-gym ring backdrop (zero scroll-scrubbing, zero stepping, zero WebGL, 0 rAF loops).
// Plays Cole's continuous ring fly-in -> close front face -> counter punch smoothly on the browser's GPU video
// decoder while scrolling stays 100% native-compositor locked, and pauses immediately once below #fightnight.

const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const coarse = matchMedia('(pointer: coarse)').matches;
const narrow = matchMedia('(max-width: 820px)');

export function initRail({ canvas } = {}) {
  const marks = [...document.querySelectorAll('[data-rail]')];
  if (!marks.length) return null;
  if (canvas) canvas.remove();

  const isMobile = narrow.matches || coarse;
  const stage = document.createElement('div');
  stage.className = 'rail-stage on';
  stage.setAttribute('aria-hidden', 'true');

  const img = document.createElement('img');
  img.className = 'rail-poster';
  img.src = isMobile ? 'img/rail-m0.webp' : 'img/hero-rail0.webp';
  img.alt = '';
  img.decoding = 'async';
  stage.appendChild(img);

  let video = null;
  if (!reduce) {
    video = document.createElement('video');
    video.className = 'rail-video';
    video.muted = true;
    video.loop = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.poster = img.src;
    video.src = isMobile ? 'assets/video/hero-ring-m.mp4?v=2' : 'assets/video/hero-ring.mp4?v=2';
    video.addEventListener('playing', () => {
      video.classList.add('ready');
      document.documentElement.classList.add('rail-live');
    }, { once: true });
    stage.appendChild(video);
  }

  const scrim = document.createElement('div');
  scrim.className = 'rail-scrim';
  stage.appendChild(scrim);
  document.body.prepend(stage);

  const lastMark = marks[marks.length - 1];
  const dmgMark = document.getElementById('damage');
  let visible = true;
  let raf = 0;

  function sync() {
    raf = 0;
    const vh = innerHeight;
    const bot = lastMark.getBoundingClientRect().bottom;
    const nextVis = bot > vh * 0.08;
    if (nextVis !== visible) {
      visible = nextVis;
      stage.classList.toggle('on', visible);
      if (video) {
        if (visible) {
          window.__p4pClaimVideo?.(video);
          video.play().catch(() => {});
        } else if (!video.paused) {
          video.pause();
        }
      }
    }
    if (visible && dmgMark) {
      const r = dmgMark.getBoundingClientRect();
      const inDamage = r.top < vh * 0.55 && r.bottom > vh * 0.25;
      scrim.classList.toggle('dim', inDamage);
    }
  }

  const kick = () => { if (!raf) raf = requestAnimationFrame(sync); };
  addEventListener('scroll', kick, { passive: true });
  addEventListener('resize', kick, { passive: true });
  document.addEventListener('visibilitychange', () => {
    if (!video) return;
    if (document.hidden) video.pause();
    else if (visible) { window.__p4pClaimVideo?.(video); video.play().catch(() => {}); }
  });

  if (video) {
    window.__p4pClaimVideo?.(video);
    video.play().catch(() => {});
  }
  sync();
  return { mode: 'hw-video-backdrop', kick };
}
