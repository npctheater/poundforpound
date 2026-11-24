// The game's heavy-bag response, ported from the Unity runtime copies (no new physics):
//   Shared/Bag/HeavyBagSolver.cs     damped swing + twist on the chain, elastic dent with hold, soft-knee ceilings
//   Shared/Bag/HeavyBagResidual.cs   residual dent sites that settle in and relax out
//   Shared/Bag/HeavyBagWave.cs       the travelling shockwave (damage anchors, slow ripple, onset delay)
//   Shared/Bag/HeavyBagPresenter.cs  the one fixed-size impact stamp (opacity fade), impact flash, chain jolt
// and the shipped config composition: HeavyBagFeelArms HEAVY (= Default) x HeavyBagSwingLevels DEFAULT (0.67 motion,
// 0.5025 wave) x HeavyBagEmphasis 1.25. Keep this file in step with those sources; it is a port, not a tuning surface.

const PI = Math.PI;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

export const EMPHASIS = 1.25;          // HeavyBagEmphasis.ShippedScale
export const SWING_MOTION = 0.67;      // HeavyBagSwingLevels DEFAULT motion column
export const SWING_WAVE = 0.5025;      // HeavyBagSwingLevels DEFAULT wave column (0.67 x 0.75)

export function defaultConfig() {      // HeavyBagConfig.Default()
  return {
    SwingPeriodS: 2.60, SwingDamping: 0.38, MaxBandTravelM: 0.24375, CeilHeadroom: 1.35, SoftKneeFrac: 0.78,
    PivotToBandM: 1.75, ScoreKnee: 40, TwistPeriodS: 1.10, TwistDamping: 0.50, MaxTwistRad: 0.60, TwistDamageExp: 1.35,
    BagRadiusM: 0.212, DentPeriodS: 0.26, DentDamping: 0.42, DentHoldS: 0.12, MaxDentM: 0.011, DentRadiusM: 0.120,
    DentRadiusMinFrac: 0.56, HandDampingPerS: 1.8,
  };
}
export function shippedConfig() {
  const c = defaultConfig();
  for (const m of [SWING_MOTION, EMPHASIS]) {           // SwingLevels.Apply then HeavyBagEmphasis.Apply
    c.MaxBandTravelM *= m; c.MaxTwistRad *= m; c.MaxDentM *= m; c.DentRadiusM *= m;
  }
  return c;
}

// ---------------------------------------------------------------- HeavyBagSolver ----
function propagate(x, v, w, z, h) {
  const wd = w * Math.sqrt(1 - z * z);
  if (wd < 1e-6) return [0, 0];
  const e = Math.exp(-z * w * h), c = Math.cos(wd * h), s = Math.sin(wd * h), zw = z * w;
  let nx = e * (x * (c + zw / wd * s) + v * (s / wd));
  let nv = e * (v * (c - zw / wd * s) - x * (w * w / wd) * s);
  if (nx > -1e-9 && nx < 1e-9 && nv > -1e-9 && nv < 1e-9) { nx = 0; nv = 0; }
  return [nx, nv];
}
function peakGain(z) { const r = Math.sqrt(1 - z * z); return r < 1e-4 ? 0.3679 : Math.exp(-z / r * Math.atan2(r, z)); }
function travelToLean(t, band) { let r = t / band; if (r >= 0.999) r = 0.999; return r <= 0 ? 0 : Math.asin(r); }
const twoPiOver = (p, fb) => 2 * PI / (p > 1e-3 ? p : fb);
const amplitude = (x, z, vx, vz, k) => { const q = Math.sqrt(vx * vx + vz * vz) * k; return Math.sqrt(x * x + z * z + q * q); };
function compress(a, K, M) { const r = M - K; if (r <= 1e-9) return a < M ? a : M; if (a <= K) return a; return K + r * (1 - Math.exp(-(a - K) / r)); }
function expand(a, K, M) { const r = M - K; if (r <= 1e-9 || a <= K) return a; let f = 1 - (a - K) / r; if (f < 1e-12) f = 1e-12; return K - r * Math.log(f); }

export function newState() {
  return { LeanX: 0, LeanZ: 0, LeanVelX: 0, LeanVelZ: 0, Twist: 0, TwistVel: 0, Dent: 0, DentVel: 0, DentHoldLeftS: 0, DentR: 0 };
}
export const unitForScore = (cfg, score) => (!(score > 0) ? 0 : 1 - Math.exp(-score / (cfg.ScoreKnee > 1e-3 ? cfg.ScoreKnee : 34)));
export function dentRadiusFor(cfg, unit) {
  const max = cfg.DentRadiusM > 1e-4 ? cfg.DentRadiusM : 0.075;
  const frac = clamp(cfg.DentRadiusMinFrac <= 0 ? 0.56 : cfg.DentRadiusMinFrac, 0.05, 1);
  return max * (frac + (1 - frac) * clamp(unit, 0, 1));
}
export const dentDepthM = (s) => (s.Dent > 0 ? s.Dent : 0);
export const dentRadiusM = (s, cfg) => (s.DentR > 1e-4 ? s.DentR : (cfg.DentRadiusM > 1e-4 ? cfg.DentRadiusM : 0.075));

function stepDent(s, w, z, holdS, dt) {
  if (!(holdS > 0)) { s.DentHoldLeftS = 0; [s.Dent, s.DentVel] = propagate(s.Dent, s.DentVel, w, z, dt); return; }
  if (s.DentHoldLeftS > 0) {
    if (dt < s.DentHoldLeftS) { s.DentHoldLeftS -= dt; return; }
    dt -= s.DentHoldLeftS; s.DentHoldLeftS = 0; if (!(dt > 0)) return;
  }
  if (s.Dent === 0 && s.DentVel === 0) return;
  const wd = w * Math.sqrt(1 - z * z);
  if (wd < 1e-6) { [s.Dent, s.DentVel] = propagate(s.Dent, s.DentVel, w, z, dt); return; }
  let phase = Math.atan2(s.DentVel * wd, (z * w) * s.DentVel + w * w * s.Dent);
  if (phase <= 0) phase += 2 * PI;
  const peakTime = phase / wd;
  if (peakTime > dt) { [s.Dent, s.DentVel] = propagate(s.Dent, s.DentVel, w, z, dt); return; }
  [s.Dent, s.DentVel] = propagate(s.Dent, s.DentVel, w, z, peakTime);
  let remaining = Math.max(0, dt - peakTime);
  s.DentVel = 0;
  if (!(s.Dent > 0)) return;
  const period = 2 * PI / wd, cycle = holdS + period, cycles = Math.floor(remaining / cycle);
  if (cycles > 0) {
    s.Dent *= Math.exp(-(z * w) * period * cycles);
    remaining = Math.max(0, remaining - cycles * cycle);
    if (s.Dent < 1e-9) { s.Dent = 0; return; }
  }
  if (remaining < holdS) { s.DentHoldLeftS = holdS - remaining; return; }
  [s.Dent, s.DentVel] = propagate(s.Dent, s.DentVel, w, z, remaining - holdS);
}
function scaleToShell(o, kx, kz, kvx, kvz, velScale, ceil) {
  if (!(ceil > 0) || !(velScale > 0)) return;
  const x = o[kx], z = kz ? o[kz] : 0, vx = o[kvx], vz = kvz ? o[kvz] : 0;
  const pos2 = x * x + z * z, vel2 = (vx * vx + vz * vz) * velScale * velScale, budget = ceil * ceil - pos2;
  if (budget <= 0) {
    const pm = Math.sqrt(pos2); if (pm < 1e-7) return;
    const nx = x / pm, nz = z / pm, out = vx * nx + vz * nz;
    if (out > 0) { o[kvx] = vx - out * nx; if (kvz) o[kvz] = vz - out * nz; }
    return;
  }
  if (vel2 <= budget) return;
  const k = Math.sqrt(budget / vel2);
  o[kvx] = vx * k; if (kvz) o[kvz] = vz * k;
}
function applyCeilings(s, cfg, wS, zS, wT) {
  const band = cfg.PivotToBandM > 1e-3 ? cfg.PivotToBandM : 1.75, head = cfg.CeilHeadroom > 1 ? cfg.CeilHeadroom : 1;
  scaleToShell(s, 'LeanX', 'LeanZ', 'LeanVelX', 'LeanVelZ', peakGain(zS) / wS, travelToLean(cfg.MaxBandTravelM, band) * head);
  const zT = clamp(cfg.TwistDamping, 0.02, 0.98);
  scaleToShell(s, 'Twist', null, 'TwistVel', null, peakGain(zT) / wT, cfg.MaxTwistRad * head);
  const dCeil = cfg.MaxDentM * 1.35;
  if (s.Dent > dCeil) { s.Dent = dCeil; if (s.DentVel > 0) s.DentVel = 0; }
}
export function step(s, cfg, dt) {
  if (!(dt > 0) || !isFinite(dt)) return;
  const wS = twoPiOver(cfg.SwingPeriodS, 2.60), zS = clamp(cfg.SwingDamping, 0.02, 0.98);
  [s.LeanX, s.LeanVelX] = propagate(s.LeanX, s.LeanVelX, wS, zS, dt);
  [s.LeanZ, s.LeanVelZ] = propagate(s.LeanZ, s.LeanVelZ, wS, zS, dt);
  const wT = twoPiOver(cfg.TwistPeriodS, 1.10);
  [s.Twist, s.TwistVel] = propagate(s.Twist, s.TwistVel, wT, clamp(cfg.TwistDamping, 0.02, 0.98), dt);
  stepDent(s, twoPiOver(cfg.DentPeriodS, 0.18), clamp(cfg.DentDamping, 0.02, 0.98), cfg.DentHoldS, dt);
  applyCeilings(s, cfg, wS, zS, wT);
}
function admitLeanVelocity(s, cfg, dx, dz, dv, wS, zS) {
  const velScale = peakGain(zS) / wS;
  const pos = Math.sqrt(s.LeanX * s.LeanX + s.LeanZ * s.LeanZ);
  const a0 = amplitude(s.LeanX, s.LeanZ, s.LeanVelX, s.LeanVelZ, velScale);
  const nvx = s.LeanVelX + dx * dv, nvz = s.LeanVelZ + dz * dv;
  const aRaw = amplitude(s.LeanX, s.LeanZ, nvx, nvz, velScale);
  if (aRaw <= a0) { s.LeanVelX = nvx; s.LeanVelZ = nvz; return aRaw - a0; }
  const band = cfg.PivotToBandM > 1e-3 ? cfg.PivotToBandM : 1.75;
  const M = travelToLean(cfg.MaxBandTravelM, band) * (cfg.CeilHeadroom > 1 ? cfg.CeilHeadroom : 1);
  const K = M * clamp(cfg.SoftKneeFrac <= 0 ? 0.78 : cfg.SoftKneeFrac, 0.05, 1);
  let a1 = compress(expand(a0, K, M) + (aRaw - a0), K, M);
  if (a1 < a0) a1 = a0;
  const want = Math.sqrt(Math.max(0, a1 * a1 - pos * pos)) / velScale;
  const nvLen = Math.sqrt(nvx * nvx + nvz * nvz);
  if (nvLen > 1e-9) { s.LeanVelX = nvx / nvLen * want; s.LeanVelZ = nvz / nvLen * want; }
  else { s.LeanVelX = dx * want; s.LeanVelZ = dz * want; }
  return a1 - a0;
}
// hit: { score, off: [x,y,z] contact minus pivot in the rest frame, dir: [x,y,z] punch direction }
export function apply(s, cfg, hit) {
  const score = hit.score;
  if (!(score > 0)) return 0;
  const wS = twoPiOver(cfg.SwingPeriodS, 2.60), zS = clamp(cfg.SwingDamping, 0.02, 0.98);
  const unit = unitForScore(cfg, score);
  let dx = hit.dir[0], dz = hit.dir[2];
  const hs = Math.max(Math.abs(dx), Math.abs(dz));
  if (hs > 0 && isFinite(hs)) { dx /= hs; dz /= hs; } else { dx = -hit.off[0]; dz = -hit.off[2]; }
  const dLen = Math.sqrt(dx * dx + dz * dz);
  if (!(dLen >= 1e-4) || !isFinite(dLen)) return 0;
  dx /= dLen; dz /= dLen;
  const band = cfg.PivotToBandM > 1e-3 ? cfg.PivotToBandM : 1.75;
  const lever = clamp(-hit.off[1] / band, 0, 1.45);
  const peakLean = travelToLean(cfg.MaxBandTravelM, band) * unit * lever;
  const admitted = admitLeanVelocity(s, cfg, dx, dz, peakLean * wS / peakGain(zS), wS, zS);
  const radius = cfg.BagRadiusM > 1e-3 ? cfg.BagRadiusM : 0.212;
  const moment = (hit.off[2] * dx - hit.off[0] * dz) / radius;
  const wT = twoPiOver(cfg.TwistPeriodS, 1.10), zT = clamp(cfg.TwistDamping, 0.02, 0.98);
  const tDamage = (cfg.TwistDamageExp > 0 && cfg.TwistDamageExp !== 1) ? Math.pow(unit, cfg.TwistDamageExp) : unit;
  const peakTwist = cfg.MaxTwistRad * tDamage * clamp(moment, -1, 1);
  {
    const tScale = peakGain(zT) / wT;
    const t0 = amplitude(s.Twist, 0, s.TwistVel, 0, tScale);
    const ntv = s.TwistVel + peakTwist * wT / peakGain(zT);
    const tRaw = amplitude(s.Twist, 0, ntv, 0, tScale);
    if (tRaw <= t0) s.TwistVel = ntv;
    else {
      const TM = cfg.MaxTwistRad * (cfg.CeilHeadroom > 1 ? cfg.CeilHeadroom : 1);
      const TK = TM * clamp(cfg.SoftKneeFrac <= 0 ? 0.78 : cfg.SoftKneeFrac, 0.05, 1);
      let t1 = compress(expand(t0, TK, TM) + (tRaw - t0), TK, TM);
      if (t1 < t0) t1 = t0;
      const tp = Math.abs(s.Twist);
      const tw = Math.sqrt(Math.max(0, t1 * t1 - tp * tp)) / tScale;
      s.TwistVel = ntv >= 0 ? tw : -tw;
    }
  }
  const wD = twoPiOver(cfg.DentPeriodS, 0.18), zD = clamp(cfg.DentDamping, 0.02, 0.98);
  s.DentVel += (cfg.MaxDentM * unit) * wD / peakGain(zD);
  s.DentHoldLeftS = 0;
  s.DentR = dentRadiusFor(cfg, unit);
  applyCeilings(s, cfg, wS, zS, wT);
  return admitted;
}
// ResolveSwing: axis-angle of the lean (axis = (-LeanZ, 0, LeanX) / |lean|)
export function resolveSwing(s, out) {
  const m = Math.sqrt(s.LeanX * s.LeanX + s.LeanZ * s.LeanZ);
  if (m < 1e-7) { out.set(1, 0, 0); return 0; }
  out.set(-s.LeanZ / m, 0, s.LeanX / m);
  return m;
}

// ---------------------------------------------------------------- HeavyBagResidualField ----
export class Residual {
  constructor() {
    this.cfg = { ResidualFraction: 0.50, ResidualMaxM: 0.022, MergeRadiusM: 0.12, SettleTauS: 0.21, RelaxTauS: 5,
      RedistributeFrac: 0.55, RadiusScale: 0.80, RetireDepthM: 0.0002 };
    this.s = Array.from({ length: 6 }, () => ({ live: false, c: [0, 0, 0], depth: 0, target: 0, r: 0 }));
  }
  deposit(p, peakM, radiusM) {
    const C = this.cfg; const add = C.ResidualFraction * peakM;
    if (!(add > 0)) return -1;
    const idx = this._pick(p, add); if (idx < 0) return -1;
    const s = this.s[idx], rWant = Math.max(0.02, radiusM * C.RadiusScale);
    if (!s.live) { s.live = true; s.c = p.slice(); s.depth = 0; s.target = 0; s.r = rWant; }
    else {
      const w = add / Math.max(1e-6, s.target + add);
      for (let k = 0; k < 3; k++) s.c[k] += (p[k] - s.c[k]) * w;
      if (rWant > s.r) s.r += (rWant - s.r) * w;
    }
    const head = Math.max(0, 1 - s.target / Math.max(1e-6, C.ResidualMaxM));
    const gained = add * head;
    s.target += gained;
    if (C.RedistributeFrac > 0 && gained > 0) {
      let pool = 0; this.s.forEach((o, i) => { if (i !== idx && o.live) pool += o.target; });
      if (pool > 1e-6) {
        const give = Math.min(pool, C.RedistributeFrac * gained);
        this.s.forEach((o, i) => { if (i !== idx && o.live) o.target = Math.max(0, o.target - give * (o.target / pool)); });
      }
    }
    return idx;
  }
  step(dt) {
    if (!(dt > 0)) return;
    const C = this.cfg, a = Math.exp(-dt / C.RelaxTauS), b = Math.exp(-dt / C.SettleTauS), coef = 1 / (1 - C.SettleTauS / C.RelaxTauS);
    for (const s of this.s) {
      if (!s.live) continue;
      const t0 = s.target, d0 = s.depth;
      s.target = t0 * a;
      const d = d0 * b + t0 * coef * (a - b);
      s.depth = d > 0 ? d : 0;
      if (s.depth < C.RetireDepthM && s.target < C.RetireDepthM) { s.live = false; s.depth = 0; s.target = 0; }
    }
  }
  _pick(p, add) {
    let near = -1, nearD2 = Infinity, free = -1, shallow = -1, shallowT = Infinity;
    const merge2 = this.cfg.MergeRadiusM ** 2;
    this.s.forEach((s, i) => {
      if (!s.live) { if (free < 0) free = i; return; }
      const d2 = (p[0] - s.c[0]) ** 2 + (p[1] - s.c[1]) ** 2 + (p[2] - s.c[2]) ** 2;
      if (d2 < nearD2) { nearD2 = d2; near = i; }
      if (s.target < shallowT) { shallowT = s.target; shallow = i; }
    });
    if (near >= 0 && nearD2 <= merge2) return near;
    if (free >= 0) return free;
    if (shallow >= 0 && shallowT < add) { this.s[shallow].live = false; return shallow; }
    return near;
  }
}

// ---------------------------------------------------------------- HeavyBagWave ----
export const WAVE = {
  AmpMaxM: 0.060, SpeedMPerS: 1.6, PacketLenM: 0.09, DecayM: 0.75, TauS: 1.1, LifeS: 2.2, Crest: 1,
  SlowFraction: 0.25, OnsetDelayS: 0.07, DepthScale: 1.7,
  curve: [[70, 0.2], [75, 0.229167], [80, 0.3], [85, 0.4125], [88, 0.5], [90, 0.566667], [95, 0.7625], [100, 1]],
};
const TIME_SCALE = clamp(1 - WAVE.SlowFraction, 0.25, 1);
export const WAVE_LIVE = { speed: WAVE.SpeedMPerS * TIME_SCALE, tau: WAVE.TauS / TIME_SCALE, life: WAVE.LifeS / TIME_SCALE, onset: clamp(WAVE.OnsetDelayS, 0, 0.25) };
// presenter ResolvedWaveAmpMaxM: AmpMaxM x swing wave column x DepthScale x emphasis
export const WAVE_AMP_MAX = WAVE.AmpMaxM * SWING_WAVE * WAVE.DepthScale * EMPHASIS;
export function waveAmpFor(score, ampMax = WAVE_AMP_MAX) {
  const c = WAVE.curve;
  if (!(score >= c[0][0])) return 0;
  for (let i = 1; i < c.length; i++) if (score <= c[i][0]) {
    const t = (score - c[i - 1][0]) / Math.max(1e-6, c[i][0] - c[i - 1][0]);
    return ampMax * (c[i - 1][1] + t * (c[i][1] - c[i - 1][1]));
  }
  return ampMax * c[c.length - 1][1];
}
export class Wave {
  constructor() { this.T = -1; this.amp = 0; this.origin = [0, 0, 0]; this.delay = 0; this.pAmp = 0; this.pOrigin = [0, 0, 0]; }
  get running() { return this.T >= 0 && this.amp > 0; }
  launch(p, amp) { if (!(amp > 0)) return; this.pOrigin = p.slice(); this.pAmp = amp; this.delay = WAVE_LIVE.onset; }
  step(dt) {
    if (this.T >= 0) { this.T += dt; if (this.T > WAVE_LIVE.life) { this.T = -1; this.amp = 0; } }
    if (this.delay > 0) {
      this.delay -= dt; if (this.delay > 0) return;
      this.origin = this.pOrigin; this.amp = this.pAmp; this.T = -this.delay; this.delay = 0; this.pAmp = 0;
    }
  }
}

// ---------------------------------------------------------------- presenter constants ----
export const MARK = {                 // HeavyBagPresenter: one small impact stamp, opacity-only fade
  strength: Math.min(1, 0.50 * EMPHASIS),   // MarkStrengthNow = MarkAoStrength 0.50 x emphasis
  radiusScale: 0.67,                         // shipping footprint (owner 2026-08-19 evening: "double its size" of 0.335)
  freshRadiusFrac: 0.85, gain: 0.60, warm: 0.65, fadeS: 0.40,
};
export const IMPACT = { tint: [1.15 * 0.8, 0.95 * 0.8, 0.70 * 0.8], riseS: 0.05, durS: 0.30, lifeS: 0.32, radiusM: 0.10 };  // HeavyBagLook Soft
export const JOLT = { maxM: 0.022 * EMPHASIS, hz: 3.2, tauS: 0.42, speed: 9 };                                                  // HeavyBagLook.KickChain
