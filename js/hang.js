// Things that hang in the gym. Every .hang element is a board on a hook at its top edge: a damped pendulum whose
// period follows its height (a tall board swings slower), swinging in-plane (rotateZ) and in depth (rotateX).
// It gets a swing the first time it comes into view (just hung), a depth sway when the scroll speeds up or brakes
// (the air and the wall move, it lags), and knock(el, strength) for when something hits or changes it.
// No fades, no translate-ups: it is already there, it just moves the way a hanging thing moves.
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const items = new Map();
let raf = 0, last = 0, lastY = scrollY, lastV = 0;

function body(el) {
  let b = items.get(el);
  if (!b) {
    const hM = Math.max(.25, el.offsetHeight / 900);           // ~900 css px per metre of board
    b = { el, z: 0, vz: 0, x: 0, vx: 0, w: Math.sqrt(9.8 / hM), seen: false, vis: false };
    items.set(el, b);
  }
  return b;
}

function step(now) {
  raf = 0;
  const dt = Math.min(.033, (now - (last || now)) / 1000); last = now;
  // scroll acceleration drives the depth sway of everything on screen
  const v = (scrollY - lastY) / Math.max(dt, .001); lastY = scrollY;
  const acc = dt > 0 ? (v - lastV) / Math.max(dt, .008) : 0; lastV = v * .6 + lastV * .4;
  let moving = false;
  for (const b of items.values()) {
    if (!b.vis) continue;
    const zeta = .16, w = b.w;
    b.vz += (-w * w * b.z - 2 * zeta * w * b.vz) * dt; b.z += b.vz * dt;
    b.vx += (-w * w * b.x - 2 * zeta * w * b.vx - acc * 2.2e-6 * w) * dt; b.x += b.vx * dt;
    b.x = Math.max(-.09, Math.min(.09, b.x));
    b.el.style.setProperty('--hz', `${(b.z * 57.3).toFixed(3)}deg`);
    b.el.style.setProperty('--hx', `${(b.x * 57.3).toFixed(3)}deg`);
    if (Math.abs(b.z) + Math.abs(b.vz) + Math.abs(b.x) + Math.abs(b.vx) > 2e-4) moving = true;
  }
  if (moving || Math.abs(v) > 1) raf = requestAnimationFrame(step);
}
const kick = () => { if (!raf && !reduce) raf = requestAnimationFrame(step); };

export function knock(el, strength = 1, side = Math.random() < .5 ? -1 : 1) {
  if (reduce || !el) return;
  const b = body(el); b.vis = true;
  b.vz += side * .28 * strength; b.vx += -.14 * strength;
  kick();
}

export function initHang(root = document) {
  if (reduce) return;
  const els = [...root.querySelectorAll('.hang')];
  const io = new IntersectionObserver(es => {
    for (const e of es) {
      const b = body(e.target); b.vis = e.isIntersecting;
      if (e.isIntersecting && !b.seen) {
        // just hung: it arrives already swinging a little, the side alternating down the page
        b.seen = true; b.z = (els.indexOf(e.target) % 2 ? 1 : -1) * (.025 + Math.random() * .015); b.vz = 0;
      }
    }
    kick();
  }, { threshold: .2 });
  els.forEach(el => io.observe(el));
  addEventListener('scroll', kick, { passive: true });
}
