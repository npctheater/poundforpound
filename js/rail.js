// Artifact-free night-gym flythrough (zero depth-warp tearing, zero WebGL context, 0 idle rAF).
// - Phones / touch (<= 820px or coarse pointer): pure GPU-composited opacity + gentle scale crossfade across
//   4 crisp real stop plates (img/rail-m0..m3.webp, ~140 KB total). Locked native-compositor scroll speed.
// - Desktop (> 820px, fine pointer): 60 nominal-cropped 16:9 WebP frames pre-decoded to ImageBitmaps and blitted
//   directly onto a single DPR-capped 2D canvas (no WebGL, no WebCodecs CPU decode stalls, no depth reprojection).
//   Fades off and releases backing once scrolled below the Fight Night stop.

const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const coarse = matchMedia('(pointer: coarse)').matches;
const narrow = matchMedia('(max-width: 820px)');

export async function initRail({ canvas, manifest = 'assets/rail/seg01/frames/manifest.json', maxDpr = 1.5 } = {}) {
  if (!canvas) return null;
  const marks = [...document.querySelectorAll('[data-rail]')].map((el) => {
    const [kind, name] = el.dataset.rail.split(':');
    const fromSel = el.dataset.railFrom || null;
    return { el, kind, name, fromEl: fromSel ? document.querySelector(fromSel) : null, dim: +(el.dataset.railDim || 0) };
  });
  if (!marks.length) return null;

  // Compute progress [0..1] across the hero + damage flight + Fight Night stop, plus visibility
  function readProgress() {
    const vh = innerHeight;
    let found = null;
    for (const m of marks) {
      const r = m.el.getBoundingClientRect();
      const top = m.fromEl ? Math.min(r.top, m.fromEl.getBoundingClientRect().top) : r.top;
      const bottomEdge = m.kind === 'seg' ? 0 : vh * 0.25;
      if (r.bottom <= bottomEdge || top >= vh) continue;
      if (m.kind === 'seg') {
        const span = Math.max(1, r.bottom - top - vh);
        found = { t: clamp01(-top / span), dim: m.dim };
        break;
      } else if (!found) {
        found = { t: 1, dim: m.dim };
      }
    }
    return found;
  }

  // ---------- MOBILE / TOUCH PARADIGM: pure GPU-composited stop-plate crossfade ----------
  if (narrow.matches || coarse) {
    canvas.remove();
    const stage = document.createElement('div');
    stage.className = 'rail-mobile';
    stage.setAttribute('aria-hidden', 'true');
    const srcs = ['img/rail-m0.webp', 'img/rail-m1.webp', 'img/rail-m2.webp', 'img/rail-m3.webp'];
    const imgs = srcs.map((src, i) => {
      const img = document.createElement('img');
      img.className = 'rail-m-layer';
      img.alt = '';
      img.decoding = 'async';
      if (i === 0) { img.src = src; img.style.opacity = '1'; }
      else { img.dataset.src = src; img.style.opacity = '0'; }
      stage.appendChild(img);
      return img;
    });
    const scrim = document.createElement('div');
    scrim.className = 'rail-m-scrim';
    stage.appendChild(scrim);
    document.body.prepend(stage);

    let loadedRest = false;
    const ensureLoaded = () => {
      if (loadedRest) return;
      loadedRest = true;
      for (let i = 1; i < imgs.length; i++) {
        if (imgs[i].dataset.src) { imgs[i].src = imgs[i].dataset.src; delete imgs[i].dataset.src; }
      }
    };

    let raf = 0;
    const update = () => {
      raf = 0;
      const st = readProgress();
      if (!st) {
        stage.classList.remove('on');
        return;
      }
      stage.classList.add('on');
      if (st.t > 0.02) ensureLoaded();
      const pos = st.t * (imgs.length - 1);
      const i0 = Math.min(imgs.length - 1, Math.floor(pos));
      const i1 = Math.min(imgs.length - 1, i0 + 1);
      const frac = pos - i0;
      for (let i = 0; i < imgs.length; i++) {
        let op = 0;
        if (i === i0) op = i0 === i1 ? 1 : 1 - frac;
        else if (i === i1) op = frac;
        imgs[i].style.opacity = op.toFixed(3);
        if (!reduce && op > 0.005) {
          const local = i === i0 ? frac : frac - 1;
          const sc = 1 + (i === i0 ? local * 0.045 : (1 + local) * 0.045);
          imgs[i].style.transform = `translate3d(0,0,0) scale(${sc.toFixed(4)})`;
        }
      }
      scrim.style.opacity = (0.12 + st.dim * 0.75).toFixed(3);
      document.documentElement.classList.add('rail-live');
    };
    const kick = () => { if (!raf) raf = requestAnimationFrame(update); };
    addEventListener('scroll', kick, { passive: true });
    addEventListener('resize', kick, { passive: true });
    update();
    return { mode: 'mobile-plates', kick };
  }

  // ---------- DESKTOP PARADIGM: artifact-free 60-frame ImageBitmap 2D canvas blit ----------
  const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
  if (!ctx) { document.documentElement.classList.add('no-rail'); return null; }

  const base = new URL(manifest, location.href);
  const m = await (await fetch(base)).json();
  const N = m.frames;
  const urlFor = (i) => new URL(m.pattern.replace('{i}', String(i).padStart(m.pad || 2, '0')), base).href;

  const bitmaps = new Array(N).fill(null);
  const fetching = new Set();
  let streaming = false;

  async function fetchFrame(i) {
    if (i < 0 || i >= N || bitmaps[i] || fetching.has(i)) return;
    fetching.add(i);
    try {
      const r = await fetch(urlFor(i));
      if (!r.ok) return;
      const bm = await createImageBitmap(await r.blob());
      bitmaps[i] = bm;
      dirty = true;
      kick();
    } catch { /* fallback to nearest decoded frame */ } finally {
      fetching.delete(i);
    }
  }

  // Hero initial load: ONLY frame 0 (~50 KB). Stream the rest on first scroll, coarse-to-fine!
  fetchFrame(0);
  function startStream() {
    if (streaming) return;
    streaming = true;
    const order = [N - 1];
    const seen = new Set([0, N - 1]);
    for (const stride of [4, 2, 1]) {
      for (let i = 0; i < N; i += stride) {
        if (!seen.has(i)) { seen.add(i); order.push(i); }
      }
    }
    const q = order.slice();
    Promise.all(Array.from({ length: 3 }, async () => {
      while (q.length) {
        if (!visible && scrollY > innerHeight * 4) {
          await new Promise((r) => setTimeout(r, 300));
          continue;
        }
        await fetchFrame(q.shift());
      }
    }));
  }

  function nearestBitmap(i) {
    if (bitmaps[i]) return bitmaps[i];
    for (let r = 1; r < N; r++) {
      if (i - r >= 0 && bitmaps[i - r]) return bitmaps[i - r];
      if (i + r < N && bitmaps[i + r]) return bitmaps[i + r];
    }
    return null;
  }

  let W = 0, H = 0, visible = true, dirty = true, live = false;
  let f = 0, fv = 0, fTarget = 0, dim = 0, dimTarget = 0;
  let px = 0, py = 0, tx = 0, ty = 0;
  let raf = 0, last = performance.now();
  let lastDrawnKey = '';

  function ensureSize() {
    const dpr = Math.min(devicePixelRatio || 1, maxDpr);
    const nw = Math.max(1, Math.round((canvas.clientWidth || innerWidth) * dpr));
    const nh = Math.max(1, Math.round((canvas.clientHeight || innerHeight) * dpr));
    if (canvas.width !== nw || canvas.height !== nh) {
      W = canvas.width = nw;
      H = canvas.height = nh;
      lastDrawnKey = '';
      dirty = true;
    }
  }

  function releaseBacking() {
    if (canvas.width || canvas.height) {
      canvas.width = 0;
      canvas.height = 0;
      W = H = 0;
      lastDrawnKey = '';
    }
  }

  function draw(bm, dimVal) {
    ensureSize();
    if (!W || !H) return;
    // Slight 1.6% overscan gives room for subtle artifact-free 2D micro-pan on mouse move
    const overscan = reduce ? 1 : 1.018;
    const canAspect = W / H;
    const imgAspect = bm.width / bm.height;
    let dw, dh;
    if (canAspect > imgAspect) { dw = W * overscan; dh = dw / imgAspect; }
    else { dh = H * overscan; dw = dh * imgAspect; }
    const panX = reduce ? 0 : -px * (dw - W) * 0.45;
    const panY = reduce ? 0 : -py * (dh - H) * 0.45;
    const dx = (W - dw) * 0.5 + panX;
    const dy = (H - dh) * 0.5 + panY;

    ctx.drawImage(bm, dx, dy, dw, dh);
    if (dimVal > 0.01) {
      ctx.fillStyle = `rgba(11, 10, 12, ${clamp01(dimVal).toFixed(3)})`;
      ctx.fillRect(0, 0, W, H);
    }
    if (!live) {
      live = true;
      document.documentElement.classList.add('rail-live');
    }
  }

  function kick() { if (!raf) { last = performance.now(); raf = requestAnimationFrame(frame); } }

  function frame(now) {
    raf = 0;
    const dt = Math.min(0.05, Math.max(0.001, (now - last) / 1000));
    last = now;

    const st = readProgress();
    visible = !!st;
    canvas.classList.toggle('on', visible);
    if (!visible) {
      releaseBacking();
      return;
    }

    fTarget = st.t * (N - 1);
    dimTarget = st.dim;
    if (st.t > 0.005) startStream();

    if (reduce) {
      f = fTarget; fv = 0; dim = dimTarget; px = 0; py = 0;
    } else {
      // Smooth critically-damped glide onto exact integer frames (zero blur/double-exposure)
      const k = 110, c = 2 * Math.sqrt(k);
      fv += (k * (fTarget - f) - c * fv) * dt;
      f += fv * dt;
      if (Math.abs(fTarget - f) < 0.04 && Math.abs(fv) < 0.08) { f = Math.round(fTarget); fv = 0; }
      dim += (dimTarget - dim) * Math.min(1, dt * 8);
      if (Math.abs(dimTarget - dim) < 0.003) dim = dimTarget;
      px += (tx - px) * Math.min(1, dt * 5);
      py += (ty - py) * Math.min(1, dt * 5);
      if (Math.abs(tx - px) < 0.001) px = tx;
      if (Math.abs(ty - py) < 0.001) py = ty;
    }

    const idx = Math.max(0, Math.min(N - 1, Math.round(f)));
    // Prioritize immediate neighbor if still loading
    if (!bitmaps[idx]) fetchFrame(idx);
    const bm = nearestBitmap(idx);
    if (bm) {
      const key = `${idx}:${Math.round(dim * 200)}:${Math.round(px * 400)}:${Math.round(py * 400)}:${W}x${H}`;
      if (dirty || key !== lastDrawnKey) {
        draw(bm, dim);
        lastDrawnKey = key;
        dirty = false;
      }
    }

    const moving = Math.abs(fTarget - f) > 0.02 || Math.abs(fv) > 0.05 ||
      Math.abs(dimTarget - dim) > 0.002 || Math.abs(tx - px) > 0.001 || Math.abs(ty - py) > 0.001;
    if (moving || dirty) kick();
  }

  addEventListener('scroll', kick, { passive: true });
  addEventListener('resize', () => { dirty = true; kick(); }, { passive: true });
  if (!reduce) {
    addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse' || !visible) return;
      tx = clamp(e.clientX / innerWidth - 0.5, -0.5, 0.5);
      ty = clamp(e.clientY / innerHeight - 0.5, -0.5, 0.5);
      kick();
    }, { passive: true });
  }
  addEventListener('pagehide', () => {
    for (let i = 0; i < N; i++) { if (bitmaps[i]) { bitmaps[i].close(); bitmaps[i] = null; } }
  });

  kick();
  return { mode: 'desktop-frames', kick };
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const clamp01 = (v) => clamp(v, 0, 1);
