// Block Party - shared rules (browser: window.BLOCKPARTY_RULES, node: require).
//
// A 16 x 16 m platform over lava. Walls slide across it one after another,
// "sent by the Eye", each a row of 8 cells: gaps to run through, low blocks to
// jump over, and full-height blocks that shove you. Get pushed off the edge
// and you're out. Last Bookis standing wins.
//
// Every wall is a pure function of (seed, rt): no wall state is ever synced.
// rt is ms since GO.

(function (root, factory) {
  const rules = factory();
  if (typeof module === "object" && module.exports) module.exports = rules;
  else root.BLOCKPARTY_RULES = rules;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const HALF = 8;                  // platform half-size (16 x 16 m), top at y = 0
  const CELLS = 8;                 // cells per wall, each 2 m wide
  const CELL = (HALF * 2) / CELLS;
  const THICK = 1;                 // wall thickness along its travel
  const FULL_H = 3.2;
  const LOW_H = 0.7;               // jumpable (apex ~1.67 m)
  const START = HALF + 3;          // walls enter/leave this far from the centre
  const KILL_Y = -3;               // below this you're in the lava
  const LAVA_Y = -12;
  const FIRST_WAVE_MS = 2500;
  const ROUND_MS = 150000;
  const COUNTDOWN_MS = 3000;
  const LOAD_TIMEOUT_MS = 15000;
  const PLAYER = { radius: 0.45, height: 1.75 };

  // Difficulty ramp. Early waves are slow with plenty of gaps; by ~wave 25
  // they come fast and close together with a single way through.
  function speedOf(i) { return Math.min(7, 3 + 0.16 * i); }             // m/s
  function gapBefore(i) { return Math.max(1500, 4600 - 130 * i); }      // ms between wave starts

  // Wave start times, cached per seed (they only depend on the index).
  const startCache = [0];
  function waveStart(i) {
    while (startCache.length <= i) {
      const k = startCache.length;
      startCache.push(startCache[k - 1] + gapBefore(k));
    }
    return FIRST_WAVE_MS + startCache[i];
  }

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Directions a wall can travel: axis 0 = x, 1 = z; sign = direction of travel.
  const DIRS = [[0, 1], [0, -1], [1, 1], [1, -1]];

  // The wall for wave i: its direction and its cells ("F" full, "L" low, "G" gap).
  const waveCache = new Map();
  function wave(seed, i) {
    const key = seed + ":" + i;
    if (waveCache.has(key)) return waveCache.get(key);
    const rnd = mulberry32((seed * 2654435761) ^ (i * 40503 + 17));
    const d = Math.min(1, i / 22);                       // 0 easy .. 1 hard
    // Never the same direction twice running at first; later anything goes.
    let dir = DIRS[Math.floor(rnd() * 4)];
    if (i > 0 && i < 8) {
      const prev = wave(seed, i - 1).dir;
      if (prev[0] === dir[0] && prev[1] === dir[1]) dir = DIRS[(DIRS.indexOf(dir) + 1 + Math.floor(rnd() * 3)) % 4];
    }
    let cells;
    let kind = "mixed";
    if (i % 7 === 5) {
      // The Ark "A": a tall arched doorway in the middle, solid everywhere else.
      kind = "ark";
      cells = ["F", "F", "F", "G", "G", "F", "F", "F"];
      const shift = Math.floor(rnd() * 5) - 2;             // not always dead centre
      cells = cells.map((_, c) => cells[(c - shift + CELLS) % CELLS]);
    } else if (d > 0.45 && rnd() < 0.22) {
      // No way through, only over: a run of low blocks.
      kind = "hurdle";
      cells = new Array(CELLS).fill("F");
      const w = 3, at = Math.floor(rnd() * (CELLS - w + 1));
      for (let c = at; c < at + w; c++) cells[c] = "L";
    } else {
      cells = new Array(CELLS).fill("F");
      const gaps = d < 0.25 ? 3 : d < 0.6 ? 2 : 1;
      const free = [...Array(CELLS).keys()];
      for (let g = 0; g < gaps; g++) {
        const k = Math.floor(rnd() * free.length);
        cells[free[k]] = "G";
        free.splice(k, 1);
      }
      const lowChance = 0.2 + 0.35 * d;
      for (const c of free) if (rnd() < lowChance) cells[c] = "L";
    }
    const w = { i, dir, cells, kind, t0: waveStart(i), speed: speedOf(i) };
    waveCache.set(key, w);
    if (waveCache.size > 4000) waveCache.clear();
    return w;
  }

  // Where wave w's wall sits along its travel axis at rt (centre of its thickness).
  function wallOffset(w, rt) {
    return -w.dir[1] * START + w.dir[1] * w.speed * (rt - w.t0) / 1000;
  }
  function travelMs(w) { return (2 * START) / w.speed * 1000; }

  // All walls on screen at rt: [{ wave, offset, vel:[vx,vz], boxes:[{min:[x,y,z], max:[x,y,z], low}] }]
  function wallsAt(seed, rt) {
    const out = [];
    if (rt < FIRST_WAVE_MS) return out;
    // a wall lives for at most travelMs of the slowest (first) wave; scan back far enough
    let i = 0;
    while (waveStart(i + 1) <= rt) i++;
    for (let k = i; k >= 0; k--) {
      const w = wave(seed, k);
      if (rt - w.t0 > travelMs(w)) { if (rt - w.t0 > 2 * START / speedOf(0) * 1000) break; continue; }
      out.push(wallGeometry(w, rt));
    }
    return out;
  }

  function wallGeometry(w, rt) {
    const off = wallOffset(w, rt);
    const [axis, sign] = w.dir;
    const boxes = [];
    for (let c = 0; c < CELLS; c++) {
      const type = w.cells[c];
      if (type === "G") continue;
      const across0 = -HALF + c * CELL, across1 = across0 + CELL;
      const h = type === "F" ? FULL_H : LOW_H;
      const a0 = off - THICK / 2, a1 = off + THICK / 2;
      const min = axis === 0 ? [a0, 0, across0] : [across0, 0, a0];
      const max = axis === 0 ? [a1, h, across1] : [across1, h, a1];
      boxes.push({ min, max, low: type === "L", cell: c });
    }
    const vel = axis === 0 ? [sign * w.speed, 0] : [0, sign * w.speed];
    return { wave: w, offset: off, vel, boxes };
  }

  // Standing on the platform?
  function onPlatform(x, z, slack) {
    const s = HALF + (slack || 0);
    return Math.abs(x) <= s && Math.abs(z) <= s;
  }

  // Out of the round: in the lava, or well below and outside the platform.
  function isOut(x, y, z) {
    if (y < KILL_Y) return true;
    return y < -0.8 && !onPlatform(x, z, 0.4);
  }

  // Spawns: a 3 x 3 grid in the middle (8 players), facing +z.
  const SPAWNS = [];
  for (const gz of [-2.5, 0, 2.5]) for (const gx of [-2.5, 0, 2.5]) SPAWNS.push([gx, 0.05, gz]);
  SPAWNS.splice(4, 1);                                     // leave the very centre free

  return {
    HALF, CELLS, CELL, THICK, FULL_H, LOW_H, START, KILL_Y, LAVA_Y,
    FIRST_WAVE_MS, ROUND_MS, COUNTDOWN_MS, LOAD_TIMEOUT_MS, PLAYER, SPAWNS,
    speedOf, gapBefore, waveStart, wave, wallOffset, travelMs, wallsAt, wallGeometry,
    onPlatform, isOut,
  };
});
