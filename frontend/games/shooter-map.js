// Shooter arena — shared map definition.
// Loaded by BOTH the browser (window.SHOOTER_MAP) and the Node server (require).
// Single source of truth so client collision and server hit-validation can never disagree.
//
// Every obstacle is an axis-aligned box: { pos:[x,y,z] (centre), size:[w,h,d], color }.
// Keeping everything axis-aligned is deliberate — it makes the server's
// line-of-sight check an exact ray-vs-AABB test instead of an approximation.
// Ramps are therefore built as staircases of boxes rather than rotated slabs.

(function (root, factory) {
  const map = factory();
  if (typeof module === "object" && module.exports) module.exports = map;
  else root.SHOOTER_MAP = map;
})(typeof self !== "undefined" ? self : this, function () {

  const C = {
    floor:    "#16213e",
    wall:     "#0f3460",
    platform: "#1a1a2e",
    crate:    "#e94560",
    crateAlt: "#f7c948",
    pillar:   "#8892a4",
  };

  const HALF = 30;          // arena spans -30..30 on X and Z
  const WALL_H = 9;
  const boxes = [];

  function box(x, y, z, w, h, d, color) {
    boxes.push({ pos: [x, y, z], size: [w, h, d], color });
  }

  // --- shell: floor, ceiling-less walls -------------------------------------
  box(0, -0.5, 0, HALF * 2, 1, HALF * 2, C.floor);
  box(0, WALL_H / 2, -HALF, HALF * 2, WALL_H, 1, C.wall);
  box(0, WALL_H / 2,  HALF, HALF * 2, WALL_H, 1, C.wall);
  box(-HALF, WALL_H / 2, 0, 1, WALL_H, HALF * 2, C.wall);
  box( HALF, WALL_H / 2, 0, 1, WALL_H, HALF * 2, C.wall);

  // --- staircase helper -----------------------------------------------------
  // Builds `steps` boxes rising from ground to `topY`, marching along `axis`.
  function stairs(x, z, topY, steps, width, axis, dir, color) {
    const rise = topY / steps;
    const run = 1.2;
    for (let i = 0; i < steps; i++) {
      const h = rise * (i + 1);
      const off = dir * (i * run + run / 2);
      if (axis === "x") box(x + off, h / 2, z, run, h, width, color);
      else box(x, h / 2, z + off, width, h, run, color);
    }
  }

  // --- central raised platform ---------------------------------------------
  const PLAT_Y = 3.2;
  box(0, PLAT_Y, 0, 15, 0.6, 15, C.platform);
  for (const [px, pz] of [[-6.5, -6.5], [6.5, -6.5], [-6.5, 6.5], [6.5, 6.5]]) {
    box(px, PLAT_Y / 2, pz, 1, PLAT_Y, 1, C.pillar);
  }
  // sightline breaker on top
  box(0, PLAT_Y + 1.6, 0, 4, 2.6, 4, C.crateAlt);
  // stairs up to it from two opposite sides
  stairs(7.5, 0, PLAT_Y, 5, 5, "x",  1, C.platform);
  stairs(-7.5, 0, PLAT_Y, 5, 5, "x", -1, C.platform);

  // --- corner platforms -----------------------------------------------------
  const CORNER_Y = 2.4;
  for (const [cx, cz, sx] of [[-21, -21, 1], [21, 21, -1]]) {
    box(cx, CORNER_Y, cz, 11, 0.6, 11, C.platform);
    box(cx, CORNER_Y / 2, cz, 1, CORNER_Y, 1, C.pillar);
    stairs(cx + sx * 6.5, cz, CORNER_Y, 4, 4, "x", sx, C.platform);
    box(cx, CORNER_Y + 1.1, cz + (cz < 0 ? 4 : -4), 6, 1.6, 1, C.pillar); // waist-high cover
  }

  // --- crate clusters -------------------------------------------------------
  const crates = [
    [-18, 4, 1.6], [-15.5, 6, 1.6], [-18, 6.5, 3.2],
    [18, -5, 1.6], [15.5, -7, 1.6], [18, -7.5, 3.2],
    [-4, -18, 2.2], [3, -20, 1.6], [0, -14, 1.6],
    [4, 18, 2.2], [-3, 20, 1.6], [0, 14, 1.6],
    [-22, 8, 1.6], [22, -9, 1.6], [-10, 24, 1.6], [10, -24, 1.6],
  ];
  crates.forEach(([x, z, s], i) => {
    box(x, s / 2, z, s, s, s, i % 3 === 0 ? C.crateAlt : C.crate);
  });

  // long low walls for mid-map cover
  box(-12, 1.1, -8, 1, 2.2, 9, C.pillar);
  box(12, 1.1, 8, 1, 2.2, 9, C.pillar);
  box(-8, 1.1, 12, 9, 2.2, 1, C.pillar);
  box(8, 1.1, -12, 9, 2.2, 1, C.pillar);

  // --- spawn points (feet position) ----------------------------------------
  const spawns = [
    [-25, 0, -25], [25, 0, 25], [-25, 0, 25], [25, 0, -25],
    [0, 0, -26], [0, 0, 26], [-26, 0, 0], [26, 0, 0],
    [-21, CORNER_Y + 0.4, -21], [21, CORNER_Y + 0.4, 21],
  ];

  return {
    name: "Atrium",
    half: HALF,
    wallHeight: WALL_H,
    colors: C,
    boxes,
    spawns,
  };
});
