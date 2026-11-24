// The chalkboard of VR boxing's old tricks, already marked up: every name is written in bright chalk, struck through with
// one thin hand line (so it still reads through the cross-out), and the KO beside it is circled. It is static: no
// scroll-driven strike, no pinning (owner, 11-24). The strokes are hand-drawn paths fitted to the laid-out text and
// refitted when the rows reflow (insets arriving, font swap, rotation).
const NS = 'http://www.w3.org/2000/svg';

function rng(seed) { let x = seed * 9301 + 49297; return () => ((x = (x * 9301 + 49297) % 233280) / 233280); }

export function initChalk(hold) {
  const board = hold?.querySelector('.rail-card-plague');
  if (!board) return;
  const items = [...board.querySelectorAll('.plague li')].map((li) => {
    const box = li.querySelector('span') || li;
    const name = document.createElement('span'); name.className = 'ink-line'; name.append(...box.childNodes); box.append(name);
    const svg = document.createElementNS(NS, 'svg'); svg.setAttribute('class', 'chalk-ink'); svg.setAttribute('aria-hidden', 'true');
    li.append(svg);
    return { li, name, svg, strokes: [] };
  });

  function shape() {
    for (const it of items) {
      it.w = it.li.offsetWidth; it.h = it.li.offsetHeight;
      const R = it.li.getBoundingClientRect(), sx = R.width / Math.max(1, it.w), sy = R.height / Math.max(1, it.h);
      const loc = (q) => ({ left: (q.left - R.left) / sx, right: (q.right - R.left) / sx, top: (q.top - R.top) / sy, height: q.height / sy, width: q.width / sx });
      const nr = loc(it.name.getBoundingClientRect());
      it.svg.setAttribute('viewBox', `0 0 ${it.w} ${it.h}`);
      it.svg.setAttribute('width', it.w); it.svg.setAttribute('height', it.h);
      const r = rng(it.li.textContent.length * 7 + items.indexOf(it));
      const lines = [...it.name.getClientRects()].map(loc).filter((q) => q.width > 4);
      it.strokes.forEach((p) => p.remove()); it.strokes = [];
      for (const q of (lines.length ? lines : [nr])) {
        const x0 = q.left - 5, x1 = q.right + 7, ym = q.top + q.height * 0.56;
        const rise = -(1.5 + r() * 3.5), n = Math.max(6, Math.round((x1 - x0) / 18));
        let d = `M${x0.toFixed(1)} ${(ym + 1.2).toFixed(1)}`;
        for (let k = 1; k <= n; k++) {
          const t = k / n, x = x0 + (x1 - x0) * t;
          const y = ym + rise * t - Math.sin(t * Math.PI) * 1.6 + (r() - 0.5) * 1.8;
          d += ` L${x.toFixed(1)} ${y.toFixed(1)}`;
        }
        const p = document.createElementNS(NS, 'path'); p.setAttribute('class', 'strike'); p.setAttribute('d', d);
        it.svg.append(p); it.strokes.push(p);
      }
    }
  }

  const reshape = () => { shape(); for (const it of items) it.li.classList.add('struck'); };
  document.fonts?.ready.then(reshape);
  // rows change width when the board's insets arrive or fonts swap, even when the board's outer box doesn't
  let last = '';
  const ro = new ResizeObserver(() => { const k = items.map(it => it.li.offsetWidth + 'x' + it.li.offsetHeight).join(); if (k !== last) { last = k; reshape(); } });
  ro.observe(board); items.forEach(it => ro.observe(it.li));
  reshape();
}
