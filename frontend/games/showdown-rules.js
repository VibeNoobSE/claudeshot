// Jump Showdown - shared rules. Loaded by BOTH the browser (window.SHOWDOWN_RULES)
// and the Node server (require), so client physics and server refereeing agree.
//
// A round platform of 8 wedge segments around a dark post with the Eye on top.
// Two bars sweep round the post: a LOW bar you jump over and a HIGH bar you must
// not jump into. They speed up and now and then reverse. From 40 s the floor
// drops away one segment at a time until two are left.
//
// Everything is a pure function of (seed, rt): rt is ms since GO, negative in
// the countdown. Azimuth is atan2(z, x), like Eye of Ark.

(function (root, factory) {
  const rules = factory();
  if (typeof module === "object" && module.exports) module.exports = rules;
  else root.SHOWDOWN_RULES = rules;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const TAU = Math.PI * 2;

  const LOAD_TIMEOUT_MS = 15000;
  const COUNTDOWN_MS = 3000;
  const ROUND_MS = 150000;
  const END_SCREEN_MS = 6000;

  const PLAYER = { radius: 0.45, height: 1.75, reach: 1.7 };
  const ARENA_R = 12;        // platform radius; top of the platform is y = 0
  const POST_R = 1.2;        // the central post the bars hang from
  const POST_H = 7;
  const SEGMENTS = 8;
  const SEG_ANGLE = TAU / SEGMENTS;
  const KILL_Y = -4;         // below this you are in the lava
  const LAVA_Y = -9;

  // Bars: capsules from rIn to rOut at a fixed height, sweeping round the post.
  //   LOW  - top at 0.68 m: jump over it
  //   HIGH - bottom at 1.95 m: a standing bean (1.75 m) is safe, a jumping one is not
  const BARS = [
    { id: "low", height: 0.42, radius: 0.26, rIn: 1.25, rOut: 12.6, knock: 11,
      w0: 0.75, w1: 1.9, rampS: 110, flipChance: 0.45, flipMin: 7, flipMax: 12, phase: 0 },
    { id: "high", height: 2.25, radius: 0.3, rIn: 1.25, rOut: 12.6, knock: 13,
      w0: 0.5, w1: 1.45, rampS: 110, flipChance: 0.35, flipMin: 8, flipMax: 14, phase: Math.PI },
  ];

  // Floor drops: a 3 s warning, then the segment falls. Six drops leave two.
  const DROP_TIMES_S = [40, 51, 61, 70, 78, 85];
  const DROP_WARN_MS = 3000;

  // ---------------------------------------------------------------- seeded rng
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const FLIP_EASE_S = 0.8;   // a reversal slows, stops and comes back over this long
  const TABLE_DT = 0.02;     // seconds per sample of the precomputed angle table

  function makeBar(cfg, rng, horizonS) {
    const firstDir = rng() < 0.5 ? 1 : -1;
    const flips = [];
    for (let t = 6 + rng() * 4; t < horizonS; t += cfg.flipMin + rng() * (cfg.flipMax - cfg.flipMin)) {
      if (rng() < cfg.flipChance) flips.push(t);
    }
    // direction in [-1, 1], easing through zero at each flip
    function dirAt(t) {
      let d = firstDir;
      for (const f of flips) {
        if (t < f - FLIP_EASE_S / 2) break;
        if (t > f + FLIP_EASE_S / 2) { d = -d; continue; }
        d *= Math.cos(Math.PI * (t - (f - FLIP_EASE_S / 2)) / FLIP_EASE_S);
        break;
      }
      return d;
    }
    function omegaAt(t) {                      // rad/s at t seconds after GO
      if (t <= 0) return 0;
      const ramp = cfg.w0 + (cfg.w1 - cfg.w0) * Math.min(1, t / cfg.rampS);
      const easeIn = Math.min(1, t / 2);       // bars wind up over the first 2 s
      return dirAt(t) * ramp * easeIn;
    }
    // integrate once; lookups interpolate
    const n = Math.ceil(horizonS / TABLE_DT) + 1;
    const table = new Float64Array(n + 1);
    table[0] = cfg.phase;
    for (let i = 1; i <= n; i++) {
      const tm = (i - 0.5) * TABLE_DT;
      table[i] = table[i - 1] + omegaAt(tm) * TABLE_DT;
    }
    function angleAt(t) {
      if (t <= 0) return cfg.phase;
      const x = t / TABLE_DT;
      const i = Math.min(n - 1, Math.floor(x));
      const f = Math.min(1, x - i);
      return table[i] + (table[i + 1] - table[i]) * f;
    }
    // a reversal is coming within the next second (for a warning flash)
    function flipSoon(t) {
      for (const f of flips) if (f > t && f - t < 1) return true;
      return false;
    }
    return Object.assign({}, cfg, { angleAt, omegaAt, flipSoon, flips, firstDir });
  }

  function segmentIndex(x, z) {
    let a = Math.atan2(z, x);
    if (a < 0) a += TAU;
    return Math.min(SEGMENTS - 1, Math.floor(a / SEG_ANGLE));
  }

  // Everything that depends on the seed.
  function create(seed) {
    const rng = mulberry32((seed >>> 0) || 1);
    const horizonS = ROUND_MS / 1000 + 10;
    const bars = BARS.map((cfg) => makeBar(cfg, rng, horizonS));

    const order = [...Array(SEGMENTS).keys()];
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    const dropAtMs = new Array(SEGMENTS).fill(Infinity);
    DROP_TIMES_S.forEach((s, k) => { dropAtMs[order[k]] = s * 1000; });

    // { alive, warn 0..1 (1 = about to go), fallMs since it dropped }
    function segmentState(i, rt) {
      const at = dropAtMs[i];
      if (rt >= at) return { alive: false, warn: 0, fallMs: rt - at };
      if (rt >= at - DROP_WARN_MS) return { alive: true, warn: (rt - (at - DROP_WARN_MS)) / DROP_WARN_MS, fallMs: 0 };
      return { alive: true, warn: 0, fallMs: 0 };
    }

    // Is there floor under this point? (inside the ring, segment still there)
    function floorAt(x, z, rt) {
      const r = Math.hypot(x, z);
      if (r > ARENA_R || r < POST_R) return false;
      return rt < dropAtMs[segmentIndex(x, z)];
    }

    function aliveSegments(rt) {
      let n = 0;
      for (let i = 0; i < SEGMENTS; i++) if (rt < dropAtMs[i]) n++;
      return n;
    }

    // bar pose: angle, capsule endpoints, angular speed
    function barPose(b, rt) {
      const bar = bars[b];
      const t = rt / 1000;
      const a = bar.angleAt(t);
      const c = Math.cos(a), s = Math.sin(a);
      return {
        angle: a,
        omega: bar.omegaAt(t),
        flipSoon: bar.flipSoon(t),
        a: [c * bar.rIn, bar.height, s * bar.rIn],
        b: [c * bar.rOut, bar.height, s * bar.rOut],
        r: bar.radius,
      };
    }

    // spawn spots: evenly round the platform, facing the post
    function spawns(n) {
      const out = [];
      const count = Math.max(n, 1);
      for (let i = 0; i < count; i++) {
        const a = (i + 0.5) / count * TAU + 0.2;
        const r = count > 4 ? 7.5 : 6.5;
        out.push({ p: [Math.cos(a) * r, 0, Math.sin(a) * r], yaw: Math.atan2(-Math.cos(a), -Math.sin(a)) });
      }
      return out;
    }

    return { seed, bars, dropAtMs, order, segmentState, floorAt, aliveSegments, barPose, spawns };
  }

  return {
    LOAD_TIMEOUT_MS, COUNTDOWN_MS, ROUND_MS, END_SCREEN_MS,
    PLAYER, ARENA_R, POST_R, POST_H, SEGMENTS, SEG_ANGLE, KILL_Y, LAVA_Y,
    BARS, DROP_TIMES_S, DROP_WARN_MS,
    segmentIndex, create,
  };
});
