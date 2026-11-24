// The game's heavy-bag hit sound, ported to Web Audio from the shipped route (real samples only, no synthesized cues):
//   impact  the L3 baked punch family (Audio/PunchFamilies/L3, 13 damage anchors x 8 variants): random variant with no
//           immediate repeat, amplitude-linear blend of the two neighbouring anchors of that variant, one shared pitch
//           +-45 cents, -0.85 dB +-0.7 jitter, -2.5 dB stack duck per other impact inside 0.12 s (cap -7.5).
//           Damage < 5 silent; 5-10 light (-12..0 dB, one per 0.35 s). (MpHitAudio.cs, PunchFamilyBank.cs)
//   chain   ChainV2 grains (Audio/RingFoley ch_*): BagChainGrainPlanner.Impact burst + Tick swing follower, per-row
//           gain/cents/min-interval from UiSoundSet_RING_FOLEY, no repeat of the last min(4, n-1), 2.8 kHz shelf -3..+1 dB,
//           at most 7 grains per 0.5 s.
//   room    the soundscape's own-voice "juiced" room: early reflections -8 + 2.5 d01 dB, one soft slap at
//           -22 dB x smoothstep(.45,.92,d01), and the late tail as the engine builds it (SynthGymIr: damped shaped noise,
//           RT60 1.1 s, hf 0.5, lf 1.2, 25 ms early cut), send -24 dB at damage 25 rising to -9.5 dB at 100, +1.5 dB
//           bloom at >= 80; chain grains send -12 dB. (CombatSoundscapeCore.cs, preset WIDE AND POSITIONAL, SMOOTH)
// Audio starts only on the first user gesture (unlock()).

const dbToGain = (db) => Math.pow(10, db / 20);
// web master: the L3 sources already peak near -1.5 dBFS (crest ~15 dB), and the game leaves -12 dB headroom for a
// full fight. A lone bag on a page plays them near full scale: -1.9 dB here puts a single hit's peak around -4 dBFS,
// just under the limiter, so the transient stays intact; the limiter only catches stacked hits.
const MASTER = 0.8;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const rnd = (a, b) => a + Math.random() * (b - a);
const ROWS = {   // UiSoundSet_RING_FOLEY.asset rows: gainDb, +-cents, minInterval s
  clink: { db: -23, cents: 90, gap: 0.035 }, rattle: { db: -15, cents: 60, gap: 0.12 }, settle: { db: -20, cents: 60, gap: 0.3 },
  creak: { db: -25, cents: 100, gap: 0.25 }, clank: { db: -13, cents: 50, gap: 0.2 },
};

export class BagAudio {
  constructor(base) {
    this.base = base; this.ready = false; this.muted = false; this.ctx = null;
    this.lastVariant = -1; this.recentImpacts = []; this.lastLight = -9;
    this.grainTimes = []; this.lastByRow = {}; this.recentByRow = {};
    this.burstUntil = 0; this.prevRv = 0; this.lastReversal = -9; this.twistArmed = true; this.lastTwistClink = -9;
  }

  async init() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC({ latencyHint: 'interactive' });
    const [idx, hits, chain] = await Promise.all([
      fetch(this.base + 'bag_audio.json').then((r) => r.json()),
      fetch(this.base + 'bag_hits.m4a').then((r) => r.arrayBuffer()),
      fetch(this.base + 'bag_chain.m4a').then((r) => r.arrayBuffer()),
    ]);
    const dec = (ab) => new Promise((res, rej) => ctx.decodeAudioData(ab, res, rej));
    [this.hitBuf, this.chainBuf] = await Promise.all([dec(hits), dec(chain)]);
    this.idx = idx;
    this._buildGraph();
    this.ready = true;
  }

  _buildGraph() {
    const ctx = this.ctx;
    this.master = ctx.createGain(); this.master.gain.value = this.muted ? 0 : MASTER;
    const lim = ctx.createDynamicsCompressor();     // safety limiter for stacked hits (the game has its own master dynamics)
    lim.threshold.value = -2; lim.knee.value = 2; lim.ratio.value = 12; lim.attack.value = 0.002; lim.release.value = 0.12;
    this.master.connect(lim).connect(ctx.destination);
    this.dry = ctx.createGain(); this.dry.connect(this.master);
    // early reflections: a dense handful of short taps, alternately panned, gently darkened
    this.early = ctx.createGain();
    const eLp = ctx.createBiquadFilter(); eLp.type = 'lowpass'; eLp.frequency.value = 6500;
    this.early.connect(eLp);
    const taps = [[4.8, 0.9, -0.6], [6.9, 0.8, 0.5], [9.1, 0.72, -0.3], [11.7, 0.62, 0.7], [14.6, 0.55, -0.8], [17.3, 0.48, 0.2],
      [20.9, 0.42, -0.4], [24.4, 0.36, 0.6], [28.8, 0.3, -0.7], [33.5, 0.25, 0.4]];
    for (const [ms, g, pan] of taps) {
      const d = ctx.createDelay(0.1); d.delayTime.value = ms / 1000;
      const gg = ctx.createGain(); gg.gain.value = g * 0.45;
      const p = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
      eLp.connect(d).connect(gg);
      if (p) { p.pan.value = pan; gg.connect(p).connect(this.master); } else gg.connect(this.master);
    }
    // one soft slap (slapRepeats 0.8: one repeat, toned down)
    this.slap = ctx.createGain();
    const sD = ctx.createDelay(0.5); sD.delayTime.value = 0.118;
    const sLp = ctx.createBiquadFilter(); sLp.type = 'lowpass'; sLp.frequency.value = 3200;
    const sG = ctx.createGain(); sG.gain.value = 0.8;
    this.slap.connect(sD).connect(sLp).connect(sG).connect(this.master);
    // the late tail: convolution with the engine's damped shaped-noise IR
    this.late = ctx.createGain();
    const pre = ctx.createDelay(0.2); pre.delayTime.value = 0.018;
    const conv = ctx.createConvolver(); conv.normalize = false; conv.buffer = this._gymIr();
    const lateOut = ctx.createGain(); lateOut.gain.value = dbToGain(2.0);   // lateLevelDb
    this.late.connect(pre).connect(conv).connect(lateOut).connect(this.master);
  }

  // CombatSoundscapeCore.SynthGymIr (rt60 1.1, hfRatio 0.5, lfRatio 1.2, earlyCut 25 ms, unit energy)
  _gymIr() {
    const sr = this.ctx.sampleRate, rt = 1.1, hf = 0.5, lf = 1.2, earlyCutMs = 25;
    const len = Math.max(64, Math.floor(sr * Math.min(rt * 1.6, 3.0))), cut = Math.floor(sr * earlyCutMs / 1000);
    const buf = this.ctx.createBuffer(2, len, sr), L = buf.getChannelData(0), Rr = buf.getChannelData(1);
    let seed = 1234567;
    const next = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    const lpA = 1 - Math.exp(-2 * Math.PI * 9000 / sr), hpA = 1 - Math.exp(-2 * Math.PI * 90 / sr);
    let lpL = 0, lpR = 0, hpL = 0, hpR = 0;
    const kMid = Math.log(1e-3) / rt, kHf = Math.log(1e-3) / Math.max(0.05, rt * hf), kLf = Math.log(1e-3) / Math.max(0.05, rt * lf);
    let e = 0;
    for (let i = 0; i < len; i++) {
      const t = i / sr, nl = next() * 2 - 1, nr = next() * 2 - 1;
      lpL += lpA * (nl - lpL); lpR += lpA * (nr - lpR); hpL += hpA * (nl - hpL); hpR += hpA * (nr - hpR);
      const hiL = nl - lpL, hiR = nr - lpR, loL = hpL, loR = hpR;           // one-pole LP / HP splits as in the engine
      const midL = nl - hiL - loL, midR = nr - hiR - loR;
      const eL = Math.exp(kLf * t), eM = Math.exp(kMid * t), eH = Math.exp(kHf * t);
      const w = i < cut ? 0 : (i < cut + 64 ? (i - cut) / 64 : 1);
      L[i] = (hiL * eH + midL * eM + loL * eL) * w; Rr[i] = (hiR * eH + midR * eM + loR * eL) * w;
      e += L[i] * L[i] + Rr[i] * Rr[i];
    }
    const g = 1 / Math.sqrt(Math.max(e, 1e-12));
    for (let i = 0; i < len; i++) { L[i] *= g; Rr[i] *= g; }
    return buf;
  }

  unlock() {
    if (!this.ctx) return Promise.resolve(false);
    if (this.ctx.state === 'running') return Promise.resolve(true);
    return this.ctx.resume().then(() => {
      const p = this.pending; this.pending = null;
      if (p && performance.now() - p.t < 600) this.hit(p.damage);
      return true;
    }, () => false);
  }
  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : MASTER, this.ctx.currentTime, 0.02);
  }
  get live() { return this.ready && !this.muted && this.ctx.state === 'running'; }

  _voice(buf, startS, durS, when, rate, gainLin, sends) {
    const ctx = this.ctx, src = ctx.createBufferSource();
    src.buffer = buf; src.playbackRate.value = rate;
    const g = ctx.createGain(); g.gain.value = gainLin;
    let node = src;
    if (sends.shelfDb !== undefined) {
      const sh = ctx.createBiquadFilter(); sh.type = 'highshelf'; sh.frequency.value = 2800; sh.gain.value = sends.shelfDb;
      node.connect(sh); node = sh;
    }
    node.connect(g); g.connect(this.dry);
    if (sends.early) { const s = ctx.createGain(); s.gain.value = sends.early; g.connect(s).connect(this.early); }
    if (sends.slap) { const s = ctx.createGain(); s.gain.value = sends.slap; g.connect(s).connect(this.slap); }
    if (sends.late) { const s = ctx.createGain(); s.gain.value = sends.late; g.connect(s).connect(this.late); }
    // tiny edge ramps so a sprite slice never clicks at its seams. The fade-in runs over the 2 ms of the sprite's silent
    // padding just before the slice (the punch's crack peaks ~1.6 ms in, so fading the slice itself would blunt it).
    const PRE = 0.002, t0 = when - PRE / rate;
    g.gain.setValueAtTime(0, Math.max(0, t0)); g.gain.linearRampToValueAtTime(gainLin, when);
    const end = when + durS / rate;
    g.gain.setValueAtTime(gainLin, end - 0.006); g.gain.linearRampToValueAtTime(0, end);
    src.start(Math.max(0, t0), Math.max(0, startS - PRE), durS + PRE + 0.004);
  }

  // damage 0..100 (the game's bag damage). Plays impact + room + chain burst.
  hit(damage) {
    if (!this.live) {
      // a touch pointerdown is not a user gesture, so the context may still be suspended on the very first tap; keep
      // that hit and play it the moment pointerup/touchend unlocks the audio
      if (this.ready && !this.muted && this.ctx && this.ctx.state !== 'running') this.pending = { damage, t: performance.now() };
      return;
    }
    const ctx = this.ctx, now = ctx.currentTime;
    if (damage < 5) return;
    let lightDb = 0;
    if (damage < 10) {
      if (now - this.lastLight < 0.35) return;
      this.lastLight = now; lightDb = -12 + 12 * (damage - 5) / 5;
    }
    // stack duck
    this.recentImpacts = this.recentImpacts.filter((t) => now - t < 0.12);
    const duck = Math.max(-7.5, -2.5 * this.recentImpacts.length);
    this.recentImpacts.push(now);
    // variant (no immediate repeat) and anchor blend
    const { anchors, variants } = this.idx;
    let v; do { v = Math.floor(Math.random() * variants); } while (v === this.lastVariant && variants > 1);
    this.lastVariant = v;
    const d = clamp(damage, anchors[0], anchors[anchors.length - 1]);
    let i = 0; while (i < anchors.length - 2 && d > anchors[i + 1]) i++;
    let t = (d - anchors[i]) / (anchors[i + 1] - anchors[i]);
    const parts = t < 0.02 ? [[anchors[i], 1]] : t > 0.98 ? [[anchors[i + 1], 1]] : [[anchors[i], 1 - t], [anchors[i + 1], t]];
    const rate = Math.pow(2, rnd(-45, 45) / 1200);
    const d01 = clamp(damage / 100, 0, 1);
    const base = dbToGain(-0.85 + rnd(-0.7, 0.7) + duck + lightDb);
    // late send: -24 dB at 25 rising to -9.5 dB at 100 (the engine's PCHIP; a half-linear/half-smooth blend tracks it), +1.5 bloom >= 80
    const lateDb = -24 + 14.5 * (0.5 * smoothstep(25, 100, damage) + 0.5 * clamp((damage - 25) / 75, 0, 1)) + (damage >= 80 ? 1.5 : 0);
    const sends = {
      early: dbToGain(-8 + 2.5 * d01),
      slap: dbToGain(-22) * smoothstep(0.45, 0.92, d01),
      late: damage >= 25 ? dbToGain(lateDb) : dbToGain(-24) * (damage / 25),
    };
    const when = now + 0.005;
    for (const [a, w] of parts) {
      const [st, du] = this.idx.hits[`d${String(a).padStart(3, '0')}_v${v}`];
      this._voice(this.hitBuf, st, du, when, rate, base * w, sends);
    }
    this._chainBurst(damage, when);
  }

  // BagChainGrainPlanner.Impact
  _chainBurst(damage, t0) {
    const e = clamp(damage / 90, 0, 1), win = 0.6 + 0.9 * e;
    this.burstUntil = t0 + win;
    if (e >= 0.3) this._grain('rattle', t0 + 0.010, -10 + 10 * e);
    const n = 2 + Math.round(3 * e), ts = Array.from({ length: n }, () => rnd(0.020, 0.250)).sort((a, b) => a - b);
    ts.forEach((tt, j) => this._grain('clink', t0 + tt, -6 + 6 * e - 2 * j));
    if (e >= 0.7 && Math.random() < 0.8) this._grain('clank', t0 + rnd(0.015, 0.040), -6 + 6 * e);
    if (e >= 0.5) this._grain('settle', t0 + 0.300, -8 + 4 * e);
    const tau = 0.25 + 0.35 * e, dt = 0.01;
    for (let tt = 0; tt < win; tt += dt) {
      if (Math.random() < 8 * e * Math.exp(-tt / tau) * dt) this._grain('clink', t0 + tt, -10 + 6 * e - 8 * tt / win);
    }
  }

  // BagChainGrainPlanner.Tick: creaks/clinks on swing reversals, clinks on fast twist. s = solver state.
  tick(s) {
    if (!this.live) return;
    const now = this.ctx.currentTime;
    const lean = Math.hypot(s.LeanX, s.LeanZ), A = 1.75 * lean;
    const rv = s.LeanX * s.LeanVelX + s.LeanZ * s.LeanVelZ;          // > 0 swinging out, < 0 coming back
    if (A < 0.01 && now > this.burstUntil) { this.prevRv = rv; return; }
    if (this.prevRv > 0 && rv <= 0 && A >= 0.035 && now - this.lastReversal >= 0.25) {
      this.lastReversal = now;
      const Ac = Math.min(A, 0.25);
      if (Math.random() < 0.25 + 6 * A) this._grain('creak', now + 0.01, Math.min(0, -14 + 40 * Ac + rnd(-2, 2)));
      if (Math.random() < 10 * A) {
        this._grain('clink', now + 0.01, -12 + 30 * Ac);
        if (Math.random() < 0.35) this._grain('clink', now + rnd(0.04, 0.09), -12 + 30 * Ac - 3);
      }
    }
    this.prevRv = rv;
    const tw = Math.abs(s.TwistVel);
    if (tw > 0.8 && this.twistArmed && now - this.lastTwistClink > 0.3) { this.twistArmed = false; this.lastTwistClink = now; this._grain('clink', now + 0.01, -14); }
    if (tw < 0.6) this.twistArmed = true;
  }

  _grain(row, when, grainDb) {
    const R = ROWS[row], n = this.idx.chainCounts[row];
    const last = this.lastByRow[row];
    if (last !== undefined && Math.abs(when - last) < Math.max(R.gap, row === 'creak' ? 0.5 : 0)) return;
    this.grainTimes = this.grainTimes.filter((t) => Math.abs(when - t) < 0.5);
    if (this.grainTimes.length >= 7) return;
    const recent = this.recentByRow[row] || (this.recentByRow[row] = []);
    const avoid = Math.min(4, n - 1);
    let k; do { k = 1 + Math.floor(Math.random() * n); } while (recent.slice(-avoid).includes(k));
    recent.push(k); if (recent.length > 8) recent.shift();
    this.lastByRow[row] = when; this.grainTimes.push(when);
    const [st, du] = this.idx.chain[`${row}_${String(k).padStart(2, '0')}`];
    const rate = Math.pow(2, rnd(-R.cents, R.cents) / 1200);
    this._voice(this.chainBuf, st, du, Math.max(when, this.ctx.currentTime), rate, dbToGain(R.db + grainDb + rnd(-1.5, 1.5)),
      { late: dbToGain(-12), shelfDb: rnd(-3, 1) });
  }

  dispose() { try { this.ctx && this.ctx.close(); } catch (_) { /* closed */ } }
}
