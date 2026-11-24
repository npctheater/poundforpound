// The chalkboard of VR boxing's old tricks, already marked up: every name is written in bright chalk, struck through with
// one thin hand line (so it still reads through the cross-out), and the KO beside it is circled. It is static: no
// scroll-driven strike, no pinning (owner, 11-24). The strokes are hand-drawn paths fitted to the laid-out text and
// refitted when the rows reflow (insets arriving, font swap, rotation).
const NS = 'http://www.w3.org/2000/svg';

function rng(seed) { let x = seed * 9301 + 49297; return () => ((x = (x * 9301 + 49297) % 233280) / 233280); }

export function initChalk(hold) {
  const board = hold?.querySelector('.rail-card-plague');
  if (!board) return;
  const items = [...board.querySelectorAll('.plague li')].map((li, i) => {
    const box = li.querySelector('span') || li;
    // the flex item is one block box; an inline span inside it reports one rect per wrapped line
    const name = document.createElement('span'); name.className = 'ink-line'; name.append(...box.childNodes); box.append(name);
    const ko = document.createElement('b'); ko.className = 'ko-mark'; ko.textContent = 'KO'; ko.setAttribute('aria-hidden', 'true');
    li.append(ko);
    const svg = document.createElementNS(NS, 'svg'); svg.setAttribute('class', 'chalk-ink'); svg.setAttribute('aria-hidden', 'true');
    const loop = document.createElementNS(NS, 'path'); loop.setAttribute('class', 'ko-loop');
    for (const p of [loop]) { p.setAttribute('pathLength', '1'); p.setAttribute('stroke-dasharray', '1 1'); p.setAttribute('stroke-dashoffset', '1'); svg.append(p); }
    li.append(svg);
    return { li, name, ko, svg, strokes: [], loop };
  });

  // stroke geometry from the laid-out text, rebuilt on resize: a slightly rising hand line with a wobble, and an
  // overshooting loop round the KO
  function shape() {
    for (const it of items) {
      it.w = it.li.offsetWidth; it.h = it.li.offsetHeight;
      // measure in the row's own css px: the board may be tilted or perspective-scaled while it is measured
      const R = it.li.getBoundingClientRect(), sx = R.width / Math.max(1, it.w), sy = R.height / Math.max(1, it.h);
      const loc = q => ({ left: (q.left - R.left) / sx, right: (q.right - R.left) / sx, top: (q.top - R.top) / sy, height: q.height / sy, width: q.width / sx });
      const lr = { left: 0, top: 0, width: it.w, height: it.h }, nr = loc(it.name.getBoundingClientRect()), kr = loc(it.ko.getBoundingClientRect());
      it.svg.setAttribute('viewBox', `0 0 ${it.w} ${it.h}`);
      it.svg.setAttribute('width', it.w); it.svg.setAttribute('height', it.h);
      const r = rng(it.li.textContent.length * 7 + items.indexOf(it));
      // one stroke per text line (a long trick wraps on phones), drawn in reading order
      const lines = [...it.name.getClientRects()].map(loc).filter(q => q.width > 4);
      it.strokes.forEach(p => p.remove()); it.strokes = [];
      for (const q of (lines.length ? lines : [nr])) {
        const x0 = q.left - lr.left - 6, x1 = q.right - lr.left + 8, ym = q.top - lr.top + q.height * .56;
        const rise = -(2 + r() * 5), n = Math.max(6, Math.round((x1 - x0) / 16));
        let d = `M${x0.toFixed(1)} ${(ym + 1.5).toFixed(1)}`;
        for (let k = 1; k <= n; k++) {
          const t = k / n, x = x0 + (x1 - x0) * t;
          const y = ym + rise * t - Math.sin(t * Math.PI) * 2.2 + (r() - .5) * 2.4;
          d += ` L${x.toFixed(1)} ${y.toFixed(1)}`;
        }
        const p = document.createElementNS(NS, 'path'); p.setAttribute('class', 'strike'); p.setAttribute('d', d);
        p.setAttribute('pathLength', '1'); p.setAttribute('stroke-dasharray', '1 1'); p.setAttribute('stroke-dashoffset', '1');
        it.svg.insertBefore(p, it.loop); it.strokes.push(p);
      }
      const cx = kr.left - lr.left + kr.width / 2, cy = kr.top - lr.top + kr.height / 2;
      const rx = kr.width * .82, ry = kr.height * .78;
      let L = '';
      for (let k = 0; k <= 40; k++) {
        const a = -2.2 + (k / 40) * (Math.PI * 2 + .7), w = 1 + (r() - .5) * .07 + k / 40 * .1;
        L += `${k ? ' L' : 'M'}${(cx + Math.cos(a) * rx * w).toFixed(1)} ${(cy + Math.sin(a) * ry * w).toFixed(1)}`;
      }
      it.loop.setAttribute('d', L);
    }
  }

  const reshape = () => { shape(); for (const it of items) { it.strokes.forEach(p => p.setAttribute('stroke-dashoffset', '0')); it.loop.setAttribute('stroke-dashoffset', '0'); it.li.classList.add('struck'); } };
  document.fonts?.ready.then(reshape);
  // rows change width when the board's insets arrive or fonts swap, even when the board's outer box doesn't
  let last = '';
  const ro = new ResizeObserver(() => { const k = items.map(it => it.li.offsetWidth + 'x' + it.li.offsetHeight).join(); if (k !== last) { last = k; reshape(); } });
  ro.observe(board); items.forEach(it => ro.observe(it.li));
  reshape();
}
