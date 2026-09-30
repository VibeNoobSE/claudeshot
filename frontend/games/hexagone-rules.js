// Hex-A-Gone - shared rules and arena (prototype).
// Loaded by BOTH the browser (window.HEX_RULES) and the Node server (require),
// so the client's collision and the server's refereeing use the same tiles.
//
// Three stacked floors of hexagonal tiles over lava. Every tile you stand on
// starts to fall FALL_DELAY_MS after you first touch it. Drop through a hole
// and you land on the floor below; fall below the last floor and you're out.
// Last one standing wins.
//
// Tiles are pointy-top hexes in axial coordinates (q, r) on the x/z plane.
// A tile's `y` is the height of its top surface.

(function (root, factory) {
  const rules = factory();
  if (typeof module === "object" && module.exports) module.exports = rules;
  else root.HEX_RULES = rules;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // ---------------------------------------------------------------- timing
  const LOAD_TIMEOUT_MS = 15000;
  const COUNTDOWN_MS = 3000;
  const ROUND_MS = 180000;
  const END_SCREEN_MS = 6000;
  const FALL_DELAY_MS = 450;           // first touch -> the tile drops

  // ---------------------------------------------------------------- arena
  const PLAYER = { radius: 0.45, height: 1.75, reach: 1.7 };
  const HEX_SIZE = 1.18;               // circumradius: ~2 m flat to flat
  const INNER = HEX_SIZE * Math.sqrt(3) / 2;
  const GRID_R = 7;                    // rings around the centre tile
  const TILE_THICK = 0.7;
  const LAYERS = [
    { y: 0, color: "#ff4fa0" },
    { y: -9, color: "#ffd23f" },
    { y: -18, color: "#3fe0ff" },
  ];
  const BOTTOM_TOP = LAYERS[LAYERS.length - 1].y;
  const OUT_Y = BOTTOM_TOP - 2;        // clearly below the last floor
  const KILL_Y = BOTTOM_TOP - 8;       // the client calls it here
  const LAVA_Y = BOTTOM_TOP - 16;
  const FOOT = 0.28;                   // how far past a tile's edge a bean still stands on it

  function tileXZ(q, r) {
    return [HEX_SIZE * Math.sqrt(3) * (q + r / 2), HEX_SIZE * 1.5 * r];
  }

  const tiles = [];
  const index = new Map();             // "layer,q,r" -> id
  LAYERS.forEach((layer, li) => {
    for (let q = -GRID_R; q <= GRID_R; q++) {
      for (let r = Math.max(-GRID_R, -q - GRID_R); r <= Math.min(GRID_R, -q + GRID_R); r++) {
        const [x, z] = tileXZ(q, r);
        const id = tiles.length;
        tiles.push({ id, layer: li, q, r, x, z, y: layer.y });
        index.set(li + "," + q + "," + r, id);
      }
    }
  });
  const ARENA_RADIUS = HEX_SIZE * Math.sqrt(3) * (GRID_R + 0.5);

  function axialRound(fq, fr) {
    const fs = -fq - fr;
    let q = Math.round(fq), r = Math.round(fr), s = Math.round(fs);
    const dq = Math.abs(q - fq), dr = Math.abs(r - fr), ds = Math.abs(s - fs);
    if (dq > dr && dq > ds) q = -r - s;
    else if (dr > ds) r = -q - s;
    return [q, r];
  }

  function cellAt(x, z) {
    const fq = (Math.sqrt(3) / 3 * x - z / 3) / HEX_SIZE;
    const fr = (2 / 3 * z) / HEX_SIZE;
    return axialRound(fq, fr);
  }

  const NEIGH = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, -1], [-1, 1]];

  // Tiles under a bean's footprint on one layer, whether up or not.
  function tilesUnder(layer, x, z) {
    const [cq, cr] = cellAt(x, z);
    const out = [];
    for (const [dq, dr] of NEIGH) {
      const id = index.get(layer + "," + (cq + dq) + "," + (cr + dr));
      if (id === undefined) continue;
      const t = tiles[id];
      if (Math.hypot(x - t.x, z - t.z) < INNER + FOOT) out.push(id);
    }
    return out;
  }

  // Tiles a bean with its feet at (x, y, z) is standing on: the footprint
  // touches them and the feet are at their top. `isUp(id)` says which still stand.
  function standingOn(x, y, z, isUp) {
    for (let li = 0; li < LAYERS.length; li++) {
      const top = LAYERS[li].y;
      if (y < top - 0.45 || y > top + 0.3) continue;
      return tilesUnder(li, x, z).filter((id) => !isUp || isUp(id));
    }
    return [];
  }

  // Opening positions: a ring on the top floor, facing the middle.
  function spawn(i, n) {
    const count = Math.max(1, n);
    const a = (i / count) * Math.PI * 2 + 0.3;
    const rad = count === 1 ? 0 : 6;
    const x = Math.cos(a) * rad, z = Math.sin(a) * rad;
    return { pos: [x, LAYERS[0].y + 0.05, z], yaw: Math.atan2(-x, -z) };
  }

  return {
    LOAD_TIMEOUT_MS, COUNTDOWN_MS, ROUND_MS, END_SCREEN_MS, FALL_DELAY_MS,
    PLAYER, HEX_SIZE, INNER, GRID_R, TILE_THICK, LAYERS, BOTTOM_TOP, OUT_Y, KILL_Y, LAVA_Y,
    ARENA_RADIUS, tiles, tileXZ, cellAt, tilesUnder, standingOn, spawn,
  };
});
