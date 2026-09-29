// Party audio - every sound in the party games, synthesised with WebAudio.
//
// No audio files: each sound is a few oscillators, a noise buffer, a filter
// and an envelope, so the kit weighs nothing and never needs licensing.
// The feel is cartoony and soft (Fall Guys, not an arcade cabinet): bouncy
// pitch sweeps, rounded envelopes, and nothing that clips when eight players
// jump at once - everything goes through a master compressor.
//
//   PARTY_AUDIO.unlock()            create/resume the AudioContext. Browsers only
//                                   allow that after a user gesture, so call it
//                                   on every keydown/click; it is cheap.
//   PARTY_AUDIO.play(name, opts)    one-shot. opts: { volume 0..1, pitch (rate
//                                   multiplier), pan -1..1, at {x,y,z} }. With
//                                   `at`, volume and pan come from the distance
//                                   and direction to the listener.
//   PARTY_AUDIO.setListener(pos, yaw)  camera position and yaw (three.js rotation.y)
//   PARTY_AUDIO.loop(name, opts)    -> { set(opts), stop() } for "rumble" / "whirr"
//   PARTY_AUDIO.toggleMute() -> bool, setMuted(bool), muted   (kept in localStorage)
//
// Unknown names are ignored, and every call is safe before unlock() (it just
// stays silent), so games can call it without feature checks beyond
// `window.PARTY_AUDIO`.

(function () {
  "use strict";

  const MASTER = 0.5;
  const JITTER = 0.04;              // ±4% pitch per play so repeats don't sound robotic
  const HEAR_RANGE = 14;            // metres at which a spatial sound is at half volume
  const MIN_GAP_MS = { step: 55, struggle: 40 };   // rapid-fire sounds, thinned
  const DEFAULT_GAP_MS = 18;

  let ctx = null;
  let master = null;
  let noiseBuf = null;
  let brownBuf = null;
  let muted = false;
  try { muted = localStorage.getItem("partyMuted") === "1"; } catch (e) { /* private mode */ }
  const listener = { x: 0, y: 0, z: 0, yaw: 0, set: false };
  const lastPlayed = Object.create(null);
  const loops = new Set();

  // ---------------------------------------------------------------- context
  function unlock() {
    try {
      if (!ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        ctx = new AC();
        const comp = ctx.createDynamicsCompressor();
        comp.threshold.value = -14;
        comp.knee.value = 12;
        comp.ratio.value = 5;
        comp.attack.value = 0.003;
        comp.release.value = 0.18;
        master = ctx.createGain();
        master.gain.value = muted ? 0 : MASTER;
        master.connect(comp);
        comp.connect(ctx.destination);
        noiseBuf = makeNoise(false);
        brownBuf = makeNoise(true);
        for (const l of loops) l.ensure();
      }
      if (ctx.state === "suspended") ctx.resume();
    } catch (e) { /* no audio on this device */ }
  }

  function makeNoise(brown) {
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (brown) {                  // integrated white noise: a deep, soft rumble
        last = (last + 0.02 * w) / 1.02;
        d[i] = last * 3.5;
      } else d[i] = w;
    }
    return buf;
  }

  // ---------------------------------------------------------------- building blocks
  // Each voice function receives (out, t0, r) - a destination node, the start
  // time and the pitch rate - and returns how long it lasts in seconds.

  // Attack to `peak`, then an exponential-ish decay to silence at t0+dur.
  function env(param, t0, attack, peak, dur, curve) {
    param.setValueAtTime(0.0001, t0);
    param.linearRampToValueAtTime(peak, t0 + attack);
    if (curve === "lin") param.linearRampToValueAtTime(0.0001, t0 + dur);
    else param.exponentialRampToValueAtTime(0.0001, t0 + dur);
  }

  function tone(out, t0, { type = "sine", f0, f1, dur, attack = 0.008, peak = 0.4, glide = dur, curve, detune = 0 }) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.detune.value = detune;
    o.frequency.setValueAtTime(f0, t0);
    if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t0 + glide);
    env(g.gain, t0, attack, peak, dur, curve);
    o.connect(g).connect(out);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
    return o;
  }

  function noise(out, t0, { dur, attack = 0.005, peak = 0.3, filter = "bandpass", f0 = 1000, f1, q = 1, brown = false, curve }) {
    const src = ctx.createBufferSource();
    src.buffer = brown ? brownBuf : noiseBuf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = filter;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t0);
    if (f1 && f1 !== f0) f.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
    const g = ctx.createGain();
    env(g.gain, t0, attack, peak, dur, curve);
    src.connect(f).connect(g).connect(out);
    src.start(t0, Math.random() * 1.5);
    src.stop(t0 + dur + 0.05);
    return { src, f, g };
  }

  // A gentle vibrato on an oscillator's frequency.
  function vibrato(osc, t0, dur, rate, depth) {
    const lfo = ctx.createOscillator();
    const lg = ctx.createGain();
    lfo.frequency.value = rate;
    lg.gain.value = depth;
    lfo.connect(lg).connect(osc.frequency);
    lfo.start(t0);
    lfo.stop(t0 + dur + 0.05);
  }

  // A note that goes through a low-pass, for brassy/horny sounds.
  function brass(out, t0, { f, dur, peak = 0.2, cutoff = 1800, attack = 0.03, vib = 0 }) {
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(cutoff * 0.5, t0);
    lp.frequency.linearRampToValueAtTime(cutoff, t0 + attack * 2);
    lp.Q.value = 0.7;
    lp.connect(out);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(peak, t0 + attack);
    g.gain.setValueAtTime(peak, t0 + dur * 0.7);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    g.connect(lp);
    for (const det of [-6, 6]) {                    // two slightly detuned saws: warm, not buzzy
      const o = ctx.createOscillator();
      o.type = "sawtooth";
      o.frequency.value = f;
      o.detune.value = det;
      if (vib) vibrato(o, t0 + dur * 0.35, dur * 0.65, 5.5, vib);
      o.connect(g);
      o.start(t0);
      o.stop(t0 + dur + 0.05);
    }
  }

  const NOTE = (n) => 440 * Math.pow(2, (n - 69) / 12);   // midi -> Hz

  // ---------------------------------------------------------------- the kit
  const VOICES = {
    jump(out, t, r) {                               // a bouncy "hup!"
      tone(out, t, { f0: 290 * r, f1: 640 * r, dur: 0.2, glide: 0.1, peak: 0.42 });
      tone(out, t, { type: "triangle", f0: 580 * r, f1: 1280 * r, dur: 0.12, glide: 0.08, peak: 0.1 });
      return 0.22;
    },
    land(out, t, r) {                               // soft rubbery thump
      tone(out, t, { f0: 150 * r, f1: 62 * r, dur: 0.16, glide: 0.1, peak: 0.45 });
      noise(out, t, { dur: 0.07, filter: "lowpass", f0: 420 * r, peak: 0.16 });
      return 0.18;
    },
    dive(out, t, r) {                               // lunge: a whoosh plus a little "hyah"
      noise(out, t, { dur: 0.3, attack: 0.03, filter: "bandpass", f0: 700 * r, f1: 2300 * r, q: 1.3, peak: 0.5 });
      tone(out, t, { f0: 520 * r, f1: 260 * r, dur: 0.16, peak: 0.16 });
      return 0.32;
    },
    bump(out, t, r) {                               // jelly-bean boink
      const o = tone(out, t, { f0: 240 * r, f1: 150 * r, dur: 0.2, glide: 0.14, peak: 0.45 });
      vibrato(o, t, 0.2, 28, 18 * r);
      tone(out, t, { type: "triangle", f0: 480 * r, f1: 300 * r, dur: 0.1, peak: 0.1 });
      noise(out, t, { dur: 0.03, filter: "highpass", f0: 1800, peak: 0.12 });
      return 0.22;
    },
    knock(out, t, r) {                              // launched: a rising cartoon "fwoop" and a smack
      noise(out, t, { dur: 0.06, filter: "lowpass", f0: 900, peak: 0.35 });
      tone(out, t, { f0: 110 * r, f1: 60 * r, dur: 0.14, peak: 0.45 });
      const o = tone(out, t + 0.03, { type: "triangle", f0: 220 * r, f1: 1150 * r, dur: 0.42, glide: 0.36, peak: 0.28 });
      vibrato(o, t + 0.03, 0.42, 16, 25 * r);
      noise(out, t + 0.03, { dur: 0.45, attack: 0.05, filter: "bandpass", f0: 500 * r, f1: 2600 * r, q: 1.1, peak: 0.2 });
      return 0.5;
    },
    grab(out, t, r) {                               // "gnk-gnk" squeeze
      tone(out, t, { type: "triangle", f0: 560 * r, f1: 880 * r, dur: 0.07, peak: 0.3 });
      tone(out, t + 0.075, { type: "triangle", f0: 660 * r, f1: 1020 * r, dur: 0.08, peak: 0.3 });
      return 0.17;
    },
    release(out, t, r) {
      tone(out, t, { type: "triangle", f0: 900 * r, f1: 460 * r, dur: 0.13, peak: 0.26 });
      return 0.15;
    },
    struggle(out, t, r) {                           // squeaky wriggle, pitched a bit at random
      const f = (680 + Math.random() * 360) * r;
      tone(out, t, { type: "triangle", f0: f, f1: f * 1.25, dur: 0.06, peak: 0.22 });
      return 0.07;
    },
    step(out, t, r) {                               // tiny soft pat
      noise(out, t, { dur: 0.04, attack: 0.002, filter: "lowpass", f0: (1100 + Math.random() * 600) * r, peak: 0.2 });
      return 0.04;
    },
    tick(out, t, r) {                               // countdown bell-blip
      tone(out, t, { f0: 880 * r, dur: 0.28, attack: 0.004, peak: 0.34 });
      tone(out, t, { f0: 1760 * r, dur: 0.12, attack: 0.004, peak: 0.07 });
      return 0.3;
    },
    go(out, t, r) {                                 // bright major-chord horn with a whistle on top
      for (const n of [72, 76, 79]) brass(out, t, { f: NOTE(n) * r, dur: 0.62, peak: 0.13, cutoff: 2400 });
      const w = tone(out, t, { f0: 1900 * r, f1: 2250 * r, dur: 0.4, glide: 0.08, attack: 0.02, peak: 0.08 });
      vibrato(w, t, 0.4, 24, 60);
      return 0.65;
    },
    out(out, t, r) {                                // slide whistle all the way down, then a plop
      const o = tone(out, t, { f0: 1250 * r, f1: 190 * r, dur: 0.8, attack: 0.03, peak: 0.26, curve: "lin" });
      vibrato(o, t, 0.8, 7, 18 * r);
      VOICES.splash(out, t + 0.74, r);
      return 1.2;
    },
    splash(out, t, r) {                             // a thick "plop" into lava or ink
      tone(out, t, { f0: 320 * r, f1: 110 * r, dur: 0.14, peak: 0.35 });
      noise(out, t, { dur: 0.4, attack: 0.01, filter: "lowpass", f0: 2600 * r, f1: 280, peak: 0.36 });
      noise(out, t + 0.06, { dur: 0.25, filter: "bandpass", f0: 1500 * r, f1: 700, q: 2, peak: 0.1 });
      return 0.45;
    },
    win(out, t, r) {                                // short bright fanfare, last note held with vibrato
      const notes = [72, 76, 79, 84];
      notes.forEach((n, i) => {
        const last = i === notes.length - 1;
        const o = tone(out, t + i * 0.11, { type: "triangle", f0: NOTE(n) * r, dur: last ? 0.7 : 0.16, attack: 0.01, peak: 0.26 });
        if (last) vibrato(o, t + i * 0.11 + 0.15, 0.55, 6, 7);
        tone(out, t + i * 0.11, { f0: NOTE(n + 12) * r, dur: last ? 0.5 : 0.1, attack: 0.01, peak: 0.05 });
      });
      return 1.1;
    },
    lose(out, t, r) {                               // sad trombone: wah, wah, wah, waaaah
      const notes = [55, 54, 53];
      notes.forEach((n, i) => brass(out, t + i * 0.38, { f: NOTE(n) * r, dur: 0.34, peak: 0.16, cutoff: 900, attack: 0.05 }));
      brass(out, t + 3 * 0.38, { f: NOTE(52) * r, dur: 0.9, peak: 0.16, cutoff: 900, attack: 0.05, vib: 6 });
      return 2.1;
    },
    cheer(out, t, r) {                              // a crowd-ish swell of filtered noise that flutters
      const n = noise(out, t, { dur: 1.5, attack: 0.3, filter: "bandpass", f0: 1150 * r, f1: 1500 * r, q: 0.6, peak: 0.26, curve: "lin" });
      const lfo = ctx.createOscillator();
      const lg = ctx.createGain();
      lfo.frequency.value = 11;
      lg.gain.value = 0.08;
      lfo.connect(lg).connect(n.g.gain);
      lfo.start(t);
      lfo.stop(t + 1.55);
      noise(out, t + 0.05, { dur: 1.2, attack: 0.25, filter: "bandpass", f0: 2600 * r, q: 1.2, peak: 0.07, curve: "lin" });
      return 1.6;
    },
    warn(out, t, r) {                               // two soft alarm blips
      for (const dt of [0, 0.14]) {
        const lp = ctx.createBiquadFilter();
        lp.type = "lowpass";
        lp.frequency.value = 2600;
        lp.connect(out);
        tone(lp, t + dt, { type: "square", f0: 988 * r, dur: 0.09, attack: 0.004, peak: 0.2 });
      }
      return 0.26;
    },
    whoosh(out, t, r) {                             // something sweeping past: rise and fall
      const n = noise(out, t, { dur: 0.55, attack: 0.18, filter: "bandpass", f0: 380 * r, q: 1.4, peak: 0.55, curve: "lin" });
      n.f.frequency.exponentialRampToValueAtTime(1500 * r, t + 0.25);
      n.f.frequency.exponentialRampToValueAtTime(420 * r, t + 0.55);
      return 0.58;
    },
    crack(out, t, r) {                              // a tile or segment giving way: little splintering clicks
      [0, 0.035, 0.08, 0.1].forEach((dt, i) =>
        noise(out, t + dt, { dur: 0.025 + i * 0.006, attack: 0.001, filter: "highpass", f0: 1400 * r, peak: 0.32 - i * 0.05 }));
      tone(out, t, { f0: 110 * r, f1: 70 * r, dur: 0.12, peak: 0.2 });
      return 0.2;
    },
    fall(out, t, r) {                               // a big piece of floor dropping away
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 320;
      lp.connect(out);
      tone(lp, t, { type: "sawtooth", f0: 130 * r, f1: 38 * r, dur: 0.85, attack: 0.02, peak: 0.4 });
      noise(out, t, { dur: 0.9, attack: 0.02, filter: "lowpass", f0: 900 * r, f1: 150, peak: 0.24 });
      return 0.9;
    },
    thud(out, t, r) {                               // heavy impact
      tone(out, t, { f0: 95 * r, f1: 42 * r, dur: 0.3, glide: 0.2, attack: 0.003, peak: 0.6 });
      noise(out, t, { dur: 0.09, attack: 0.001, filter: "lowpass", f0: 260 * r, peak: 0.3 });
      return 0.32;
    },
    pop(out, t, r) {                                // bubbly UI pop
      tone(out, t, { f0: 520 * r, f1: 1240 * r, dur: 0.1, glide: 0.05, attack: 0.003, peak: 0.3 });
      return 0.11;
    },
    click(out, t, r) {
      tone(out, t, { type: "triangle", f0: 1800 * r, dur: 0.03, attack: 0.001, peak: 0.16 });
      return 0.04;
    },
    checkpoint(out, t, r) {                         // two-note sparkly chime
      tone(out, t, { f0: NOTE(84) * r, dur: 0.6, attack: 0.004, peak: 0.24 });
      tone(out, t + 0.09, { f0: NOTE(91) * r, dur: 0.7, attack: 0.004, peak: 0.2 });
      tone(out, t + 0.09, { f0: NOTE(103) * r, dur: 0.3, attack: 0.004, peak: 0.04 });
      return 0.8;
    },
    zap(out, t, r) {                                // the Eye's beam: a hot crackling sizzle
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = 1400 * r;
      bp.Q.value = 0.8;
      bp.connect(out);
      const o = tone(bp, t, { type: "sawtooth", f0: 1500 * r, f1: 180 * r, dur: 0.32, attack: 0.004, peak: 0.36 });
      vibrato(o, t, 0.32, 55, 90 * r);
      noise(out, t, { dur: 0.35, attack: 0.002, filter: "highpass", f0: 2500, peak: 0.16 });
      return 0.36;
    },
    tear(out, t, r) {                               // paper tearing: jagged bursts of bright noise
      const n = noise(out, t, { dur: 0.38, attack: 0.004, filter: "bandpass", f0: 2800 * r, f1: 3600 * r, q: 1.8, peak: 0.34, curve: "lin" });
      const steps = 22;
      const curve = new Float32Array(steps);
      for (let i = 0; i < steps; i++) curve[i] = (Math.random() < 0.7 ? 0.35 + Math.random() * 0.65 : 0.05) * (1 - i / steps);
      n.g.gain.cancelScheduledValues(t);
      n.g.gain.setValueCurveAtTime(curve.map((v) => v * 0.7), t, 0.38);
      return 0.4;
    },
    slide(out, t, r) {                              // a heavy shelf grinding along
      const n = noise(out, t, { dur: 0.7, attack: 0.08, filter: "lowpass", f0: 650 * r, peak: 0.5, curve: "lin" });
      const lfo = ctx.createOscillator();
      const lg = ctx.createGain();
      lfo.frequency.value = 14;
      lg.gain.value = 0.1;
      lfo.connect(lg).connect(n.g.gain);
      lfo.start(t);
      lfo.stop(t + 0.75);
      noise(out, t, { dur: 0.7, attack: 0.08, filter: "bandpass", f0: 240 * r, q: 2, peak: 0.18, curve: "lin" });
      return 0.72;
    },
  };

  // ---------------------------------------------------------------- spatial
  function spatial(at) {
    if (!at || !listener.set) return { vol: 1, pan: 0 };
    const dx = at.x - listener.x, dy = (at.y || 0) - listener.y, dz = at.z - listener.z;
    const d = Math.hypot(dx, dy, dz);
    const vol = 1 / (1 + Math.pow(d / HEAR_RANGE, 2));
    if (d < 0.5) return { vol, pan: 0 };
    // the camera looks along -z turned by yaw, so its right is (cos yaw, 0, -sin yaw)
    const rx = Math.cos(listener.yaw), rz = -Math.sin(listener.yaw);
    const h = Math.hypot(dx, dz) || 1;
    return { vol, pan: Math.max(-1, Math.min(1, ((dx * rx + dz * rz) / h) * 0.75)) };
  }

  function play(name, opts) {
    const voice = VOICES[name];
    if (!voice || !ctx || muted || ctx.state !== "running") return;
    const now = performance.now();
    const gap = MIN_GAP_MS[name] || DEFAULT_GAP_MS;
    if (lastPlayed[name] && now - lastPlayed[name] < gap) return;
    lastPlayed[name] = now;
    const o = opts || {};
    const sp = spatial(o.at);
    const vol = (o.volume === undefined ? 1 : o.volume) * sp.vol;
    if (vol < 0.02) return;                         // too far away to matter
    try {
      const t = ctx.currentTime + 0.005;
      const g = ctx.createGain();
      g.gain.value = Math.min(1, vol);
      const pan = o.pan !== undefined ? o.pan : sp.pan;
      if (ctx.createStereoPanner && pan) {
        const p = ctx.createStereoPanner();
        p.pan.value = Math.max(-1, Math.min(1, pan));
        g.connect(p).connect(master);
      } else g.connect(master);
      const rate = (o.pitch || 1) * (1 + (Math.random() * 2 - 1) * JITTER);
      const len = voice(g, t, rate);
      setTimeout(() => { try { g.disconnect(); } catch (e) { /* already gone */ } }, (len + 0.3) * 1000);
    } catch (e) { /* a sound must never break a game */ }
  }

  function setListener(pos, yaw) {
    if (!pos) return;
    listener.x = pos.x; listener.y = pos.y; listener.z = pos.z;
    listener.yaw = yaw || 0;
    listener.set = true;
  }

  // ---------------------------------------------------------------- loops
  const LOOPS = {
    rumble(out) {                                   // deep brown-noise rumble with a sub tone
      const src = ctx.createBufferSource();
      src.buffer = brownBuf;
      src.loop = true;
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 170;
      src.connect(lp).connect(out);
      const sub = ctx.createOscillator();
      sub.frequency.value = 46;
      const sg = ctx.createGain();
      sg.gain.value = 0.25;
      sub.connect(sg).connect(out);
      src.start();
      sub.start();
      return { nodes: [src, sub], pitch: (p) => { lp.frequency.setTargetAtTime(170 * p, ctx.currentTime, 0.1); } };
    },
    whirr(out) {                                    // a spinning bar: "whoom-whoom" that speeds up with pitch
      const src = ctx.createBufferSource();
      src.buffer = noiseBuf;
      src.loop = true;
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = 420;
      bp.Q.value = 2.5;
      const am = ctx.createGain();
      am.gain.value = 0.5;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 6;
      const lg = ctx.createGain();
      lg.gain.value = 0.45;
      lfo.connect(lg).connect(am.gain);
      src.connect(bp).connect(am).connect(out);
      src.start();
      lfo.start();
      return {
        nodes: [src, lfo],
        pitch: (p) => {
          bp.frequency.setTargetAtTime(420 * p, ctx.currentTime, 0.1);
          lfo.frequency.setTargetAtTime(6 * p, ctx.currentTime, 0.1);
        },
      };
    },
  };

  function loop(name, opts) {
    const make = LOOPS[name];
    const state = Object.assign({ volume: 0.5, pitch: 1 }, opts || {});
    let built = null, gain = null, stopped = false;
    const handle = {
      ensure() {
        if (built || stopped || !make || !ctx) return;
        try {
          gain = ctx.createGain();
          gain.gain.value = 0.0001;
          gain.connect(master);
          built = make(gain);
          handle.set({});
        } catch (e) { built = null; }
      },
      set(o) {
        Object.assign(state, o || {});
        handle.ensure();
        if (!built) return;
        const sp = spatial(state.at);
        const v = Math.max(0.0001, Math.min(0.8, state.volume * sp.vol));
        gain.gain.setTargetAtTime(v, ctx.currentTime, 0.08);    // glide, never click
        built.pitch(state.pitch || 1);
      },
      stop() {
        stopped = true;
        loops.delete(handle);
        if (!built) return;
        const b = built, g = gain;
        built = null;
        try {
          g.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.06);
          setTimeout(() => {
            for (const n of b.nodes) { try { n.stop(); } catch (e) { /* already stopped */ } }
            try { g.disconnect(); } catch (e) { /* ignore */ }
          }, 400);
        } catch (e) { /* ignore */ }
      },
    };
    if (make) loops.add(handle);
    handle.ensure();
    return handle;
  }

  // ---------------------------------------------------------------- mute
  function setMuted(m) {
    muted = !!m;
    try { localStorage.setItem("partyMuted", muted ? "1" : "0"); } catch (e) { /* ignore */ }
    if (master) master.gain.setTargetAtTime(muted ? 0 : MASTER, ctx.currentTime, 0.03);
  }

  // For level checks: render one sound offline (no master, no jitter) and
  // report its peak sample. Used by the dev test page, not by games.
  async function measurePeak(name) {
    const voice = VOICES[name];
    if (!voice) return null;
    unlock();
    if (!ctx) return null;
    const live = ctx;
    const off = new OfflineAudioContext(1, Math.ceil(live.sampleRate * 2.5), live.sampleRate);
    ctx = off;                                      // voices build on `ctx`; swap it just while building
    try { voice(off.destination, 0.01, 1); } finally { ctx = live; }
    const data = (await off.startRendering()).getChannelData(0);
    let peak = 0;
    for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i]));
    return peak;
  }

  window.PARTY_AUDIO = {
    unlock,
    play,
    setListener,
    loop,
    setMuted,
    toggleMute() { setMuted(!muted); return muted; },
    get muted() { return muted; },
    names: Object.keys(VOICES),
    loopNames: Object.keys(LOOPS),
    measurePeak,
  };
})();
