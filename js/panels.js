// Copy panels as baked gym boards (zero WebGL contexts, zero per-scroll/per-pointer redraws).
// Each [data-panel="<kind>"] draws its pre-lit RGBA beauty.webp 9-sliced once into a 2D canvas when visible or resized,
// and releases its canvas backing when off-screen so GPU tile memory stays lean.
const coarse = matchMedia('(pointer: coarse)').matches;
const boards = new Map();

function loadBoard(kind) {
  if (!boards.has(kind)) {
    boards.set(kind, (async () => {
      const base = `assets/panels/${kind}/`;
      const m = await (await fetch(base + 'panel.json')).json();
      const file = m.beauty || m.albedo;
      const img = await createImageBitmap(await (await fetch(base + file)).blob());
      return { ...m, img, hasBeauty: !!m.beauty };
    })());
  }
  return boards.get(kind);
}

// 9-slice draw from pre-lit beauty image (which includes beautyBleed px of baked contact shadow on each side)
function drawNineSlice(ctx, img, bw, bh, b, fit, dpr) {
  const bleedSrc = b.hasBeauty ? (b.beautyBleed || 0) : 0;
  const sw = img.width, sh = img.height;
  const sl = (b.slice.l + bleedSrc);
  const sr = (b.slice.r + bleedSrc);
  const st = (b.slice.t + bleedSrc);
  const sb = (b.slice.b + bleedSrc);
  const bleedCss = bleedSrc * fit / b.pxPerCss;
  const cw = Math.round((bw + 2 * bleedCss) * dpr);
  const ch = Math.round((bh + 2 * bleedCss) * dpr);
  if (cw <= 0 || ch <= 0) return null;

  const k = fit * dpr / b.pxPerCss;
  let dl = Math.round(sl * k), dr = Math.round(sr * k);
  let dt = Math.round(st * k), db = Math.round(sb * k);
  // Clamp border slices so short/narrow boards on phones never invert or smudge the centre strip
  if (dl + dr > cw - 2) { const sc = (cw - 2) / Math.max(1, dl + dr); dl = Math.floor(dl * sc); dr = Math.floor(dr * sc); }
  if (dt + db > ch - 2) { const sc = (ch - 2) / Math.max(1, dt + db); dt = Math.floor(dt * sc); db = Math.floor(db * sc); }

  const sx = [0, sl, sw - sr, sw];
  const sy = [0, st, sh - sb, sh];
  const dx = [0, dl, cw - dr, cw];
  const dy = [0, dt, ch - db, ch];

  ctx.clearRect(0, 0, cw, ch);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  for (let row = 0; row < 3; row++) {
    const sh0 = sy[row + 1] - sy[row], dh0 = dy[row + 1] - dy[row];
    if (sh0 <= 0 || dh0 <= 0) continue;
    for (let col = 0; col < 3; col++) {
      const sw0 = sx[col + 1] - sx[col], dw0 = dx[col + 1] - dx[col];
      if (sw0 <= 0 || dw0 <= 0) continue;
      ctx.drawImage(img, sx[col], sy[row], sw0, sh0, dx[col], dy[row], dw0, dh0);
    }
  }
  // Feather the outermost edge of the baked shadow bleed so it never shows a rectangular canvas edge clip
  const f = Math.max(4, Math.round(bleedCss * dpr * 0.42));
  if (f > 4 && cw > f * 2 && ch > f * 2) {
    ctx.save();
    ctx.globalCompositeOperation = 'destination-in';
    const gH = ctx.createLinearGradient(0, 0, cw, 0);
    gH.addColorStop(0, 'rgba(0,0,0,0)'); gH.addColorStop(f / cw, 'rgba(0,0,0,1)');
    gH.addColorStop(1 - f / cw, 'rgba(0,0,0,1)'); gH.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gH; ctx.fillRect(0, 0, cw, ch);
    const gV = ctx.createLinearGradient(0, 0, 0, ch);
    gV.addColorStop(0, 'rgba(0,0,0,0)'); gV.addColorStop(f / ch, 'rgba(0,0,0,1)');
    gV.addColorStop(1 - f / ch, 'rgba(0,0,0,1)'); gV.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gV; ctx.fillRect(0, 0, cw, ch);
    ctx.restore();
  }
  return { cw, ch, bleedCss };
}

export async function initPanels(root = document) {
  const els = [...root.querySelectorAll('[data-panel]')];
  if (!els.length) return;

  const dprNow = () => Math.min(devicePixelRatio || 1, coarse ? 1.5 : 1.75);
  const state = new Map();

  async function mount(p) {
    if (p.loading || p.dead) return;
    p.loading = true;
    try {
      const b = await loadBoard(p.kind);
      p.b = b;
      const fit = innerWidth < 500 ? 0.72 : 1;
      const k = fit / b.pxPerCss;
      const el = p.el;
      el.style.setProperty('--safe-l', `${(b.safe.l * k).toFixed(1)}px`);
      el.style.setProperty('--safe-t', `${(b.safe.t * k).toFixed(1)}px`);
      el.style.setProperty('--safe-r', `${(b.safe.r * k).toFixed(1)}px`);
      el.style.setProperty('--safe-b', `${(b.safe.b * k).toFixed(1)}px`);
      if (b.ink) {
        el.style.setProperty('--panel-ink', b.ink);
        const [r, g, bl] = [1, 3, 5].map((i) => parseInt(b.ink.slice(i, i + 2), 16) / 255);
        el.classList.toggle('ink-light', 0.2126 * r + 0.7152 * g + 0.0722 * bl > 0.5);
      }
      if (b.accent) el.style.setProperty('--panel-accent', b.accent);
      el.classList.toggle('chalky', b.surface === 'slate');
      if (!p.cv) {
        p.cv = document.createElement('canvas');
        p.cv.className = 'panel-art';
        p.cv.setAttribute('aria-hidden', 'true');
        p.ctx = p.cv.getContext('2d');
        el.prepend(p.cv);
      }
      el.classList.add('panel-on');
      p.ready = true;
      if (p.vis) paint(p);
    } catch (err) {
      p.dead = true;
      console.warn('panel board unavailable; showing plain copy', p.kind, err);
    } finally {
      p.loading = false;
    }
  }

  function paint(p) {
    if (!p.ready || !p.vis || !p.b) return;
    const bw = p.el.offsetWidth, bh = p.el.offsetHeight;
    if (bw < 2 || bh < 2) return;
    const fit = innerWidth < 500 ? 0.72 : 1;
    const dpr = dprNow();
    const bleedSrc = p.b.hasBeauty ? (p.b.beautyBleed || 0) : 0;
    const bleedCss = bleedSrc * fit / p.b.pxPerCss;
    const cw = Math.round((bw + 2 * bleedCss) * dpr);
    const ch = Math.round((bh + 2 * bleedCss) * dpr);
    if (p.drawnW === cw && p.drawnH === ch && p.cv.width === cw && p.cv.height === ch) return;
    p.cv.width = cw;
    p.cv.height = ch;
    p.cv.style.left = `${-bleedCss.toFixed(1)}px`;
    p.cv.style.top = `${-bleedCss.toFixed(1)}px`;
    p.cv.style.width = `${(bw + 2 * bleedCss).toFixed(1)}px`;
    p.cv.style.height = `${(bh + 2 * bleedCss).toFixed(1)}px`;
    drawNineSlice(p.ctx, p.b.img, bw, bh, p.b, fit, dpr);
    p.drawnW = cw;
    p.drawnH = ch;
  }

  const ro = new ResizeObserver((es) => {
    for (const e of es) {
      const p = state.get(e.target);
      if (p && p.vis && p.ready) paint(p);
    }
  });

  // Lazy-load board textures only as each board approaches the viewport, and release backing when far off-screen
  const io = new IntersectionObserver((es) => {
    for (const e of es) {
      const p = state.get(e.target);
      if (!p) continue;
      p.vis = e.isIntersecting;
      if (p.vis) {
        if (!p.ready) mount(p);
        else paint(p);
      } else if (p.cv && p.cv.width) {
        p.cv.width = 0;
        p.cv.height = 0;
        p.drawnW = 0;
        p.drawnH = 0;
      }
    }
  }, { rootMargin: '360px 0px' });

  for (const el of els) {
    const p = { el, kind: el.dataset.panel, cv: null, ctx: null, b: null, vis: false, ready: false, loading: false, dead: false, drawnW: 0, drawnH: 0 };
    state.set(el, p);
    io.observe(el);
    ro.observe(el);
  }

  let resizeTimer = 0;
  addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      for (const p of state.values()) {
        if (!p.ready || !p.b) continue;
        const fit = innerWidth < 500 ? 0.72 : 1;
        const k = fit / p.b.pxPerCss;
        p.el.style.setProperty('--safe-l', `${(p.b.safe.l * k).toFixed(1)}px`);
        p.el.style.setProperty('--safe-t', `${(p.b.safe.t * k).toFixed(1)}px`);
        p.el.style.setProperty('--safe-r', `${(p.b.safe.r * k).toFixed(1)}px`);
        p.el.style.setProperty('--safe-b', `${(p.b.safe.b * k).toFixed(1)}px`);
        p.drawnW = 0;
        if (p.vis) paint(p);
      }
    }, 120);
  }, { passive: true });
}
