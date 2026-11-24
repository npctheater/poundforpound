// Subtle physical knock for hung UI objects (mode frame swap, mobile menu open).
// Runs a short damped pendulum ONLY when knock() is called; zero scroll polling, zero idle rAF, zero continuous wobble.
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const items = new Map();
let raf = 0, last = 0;

function body(el) {
  let b = items.get(el);
  if (!b) {
    const hM = Math.max(0.25, el.offsetHeight / 900);
    b = { el, z: 0, vz: 0, x: 0, vx: 0, w: Math.sqrt(9.8 / hM) };
    items.set(el, b);
  }
  return b;
}

function step(now) {
  raf = 0;
  const dt = Math.min(0.033, (now - (last || now)) / 1000);
  last = now;
  let moving = false;
  for (const b of items.values()) {
    const zeta = 0.24, w = b.w;
    b.vz += (-w * w * b.z - 2 * zeta * w * b.vz) * dt;
    b.z += b.vz * dt;
    b.vx += (-w * w * b.x - 2 * zeta * w * b.vx) * dt;
    b.x += b.vx * dt;
    b.x = Math.max(-0.07, Math.min(0.07, b.x));
    const alive = Math.abs(b.z) + Math.abs(b.vz) + Math.abs(b.x) + Math.abs(b.vx) > 4e-4;
    if (alive) {
      b.el.classList.add('hanging-live');
      b.el.style.setProperty('--hz', `${(b.z * 57.3).toFixed(2)}deg`);
      b.el.style.setProperty('--hx', `${(b.x * 57.3).toFixed(2)}deg`);
      moving = true;
    } else if (b.el.classList.contains('hanging-live')) {
      b.z = b.vz = b.x = b.vx = 0;
      b.el.style.removeProperty('--hz');
      b.el.style.removeProperty('--hx');
      b.el.classList.remove('hanging-live');
    }
  }
  if (moving) raf = requestAnimationFrame(step);
}

export function knock(el, strength = 1, side = Math.random() < 0.5 ? -1 : 1) {
  if (reduce || !el) return;
  const b = body(el);
  b.vz += side * 0.22 * strength;
  b.vx += -0.10 * strength;
  last = performance.now();
  if (!raf) raf = requestAnimationFrame(step);
}

export function initHang() {
  // No scroll listener or automatic wobble on load; knock() drives deliberate physical feedback on interaction.
}
