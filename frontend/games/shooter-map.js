// Shooter arena — "Norli Plaza". Shared map definition.
// Loaded by BOTH the browser (window.SHOOTER_MAP) and the Node server (require).
// Single source of truth so client collision and server hit-validation agree.
//
// Every obstacle is an axis-aligned box: { pos:[x,y,z] (centre), size:[w,h,d], color }.
// Axis-aligned everywhere is deliberate — it makes the server's line-of-sight test
// an exact ray-vs-AABB check. Ramps are staircases of boxes, never rotated slabs.
//
// Optional per-box flags:
//   solid: false   -> rendered but not collidable and ignored by hit validation
//                     (ground decals, foliage detail, glass panes you can shoot through)
//   opacity: 0..1  -> translucent material
//   edges: false   -> skip the outline pass (used for small props)
//   collide: bool  -> override collision independently of `solid`. Glass uses
//                     solid:false + collide:true: you can shoot through it but
//                     not walk through it.

(function (root, factory) {
  const map = factory();
  if (typeof module === "object" && module.exports) module.exports = map;
  else root.SHOOTER_MAP = map;
})(typeof self !== "undefined" ? self : this, function () {

  const C = {
    sky:       "#8ec5e8",
    grass:     "#5c9a52",
    grassDark: "#4f8747",
    path:      "#c6bfb0",
    plaza:     "#b2aa9d",
    brick:     "#9a5f47",
    hedge:     "#3e7a45",
    wood:      "#a9784b",
    shelf:     "#7a4f2c",
    book1:     "#c94f4f",
    book2:     "#3f7fbf",
    book3:     "#e0a53f",
    book4:     "#4f9c58",
    carpet:    "#46536e",
    desk:      "#d9c5a0",
    monitor:   "#20263a",
    cubicle:   "#7d8898",
    glass:     "#bfe4f2",
    metal:     "#9aa3b2",
    white:     "#e8ecf3",
    roof:      "#8b8f99",
    water:     "#4fa3c7",
    trunk:     "#6b4a2f",
    leaf:      "#3f8a4a",
    leafHi:    "#54a35d",
    signBg:    "#12324f",
    stone:     "#a8a29a",
    brickDark: "#7d4436",
    stoneWarm: "#b9a58c",
    slate:     "#5c6672",
    window:    "#2b3446",
    windowLit: "#f0c96a",
    rust:      "#8a4a2b",
    ash:       "#6f6a66",
    concrete:  "#9a978f",
    tower:     "#6f7d92",
    towerFar:  "#5a6679",
    ark:       "#f36000",
  };

  // ---------------------------------------------------------------- BRAND
  // Bookis company branding for the castle landmark.
  // `color` is a PLACEHOLDER — replace it with the real brand hex.
  // If a real logo image is placed at frontend/assets/bookis-logo.png it is used
  // automatically for the spinning sign faces; otherwise the wordmark is drawn.
  const BRAND = {
    name: "BOOKIS",
    color: "#c52c4c",   // crimson from the logo mark
    ink: "#1b1b1b",
    accent: "#ffffff",
    dark: "#7d1a2f",
  };

  const HALF = 48;
  const WALL_H = 6;
  const boxes = [];
  const signs = [];

  function box(x, y, z, w, h, d, color, opts) {
    boxes.push(Object.assign({ pos: [x, y, z], size: [w, h, d], color }, opts || {}));
  }
  const decal = (x, y, z, w, h, d, color) => box(x, y, z, w, h, d, color, { solid: false, edges: false });
  // Rotated boxes are ALWAYS decorative: the server's line-of-sight test is an
  // exact ray-vs-AABB check, which only holds while solids stay axis-aligned.
  const crooked = (x, y, z, w, h, d, color, rot) =>
    box(x, y, z, w, h, d, color, { solid: false, collide: false, edges: false, rot });
  const prop  = (x, y, z, w, h, d, color, o) => box(x, y, z, w, h, d, color, Object.assign({ edges: false }, o || {}));

  function sign(x, y, z, w, h, rotY, text, color, bg) {
    signs.push({ pos: [x, y, z], size: [w, h], rotY, text, color: color || "#f7c948", bg: bg || C.signBg });
  }

  function stairs(x, z, topY, steps, width, axis, dir, color) {
    const rise = topY / steps;
    const run = 1.1;
    for (let i = 0; i < steps; i++) {
      const h = rise * (i + 1);
      const off = dir * (i * run + run / 2);
      if (axis === "x") box(x + off, h / 2, z, run, h, width, color);
      else box(x, h / 2, z + off, width, h, run, color);
    }
  }

  // ======================================================== ground and shell
  box(0, -0.5, 0, HALF * 2, 1, HALF * 2, C.plaza);            // base slab
  // Ground layers are stacked on distinct heights. Where two overlap at exactly
  // the same height the depth buffer cannot separate them and the seam flickers
  // violently as the camera moves - which is what the pavement did against the
  // grass. Each layer sits a few centimetres above the one it overlaps.
  decal(0, 0.03, -28, 88, 0.06, 34, C.grass);                  // north park lawn   (top 0.06)
  decal(0, 0.03, 28, 88, 0.06, 34, C.carpet);                  // south office floor(top 0.06)
  decal(-34, 0.06, 0, 24, 0.06, 26, C.path);                   // west plaza        (top 0.09)
  decal(34, 0.06, 0, 22, 0.06, 26, C.path);                    // east plaza        (top 0.09)
  decal(0, 0.09, -28, 6, 0.06, 34, C.path);                    // park path         (top 0.12)

  // ==================================================== city block boundary
  // The arena is bounded by a continuous street of building fronts rather than a
  // fence, so it reads as a city block you are fighting inside. The run is
  // generated contiguously, which is what guarantees there is no way out.
  const FACADE_D = 3.5;
  const FRONTS = [C.brickDark, C.brick, C.stoneWarm, C.slate, C.concrete];

  function facadeRun(axis, side) {
    const mid = HALF - FACADE_D / 2;
    const face = HALF - FACADE_D - 0.07;      // inner face, where windows sit
    let t = -HALF;
    let i = 0;
    while (t < HALF - 0.01) {
      const want = 7 + ((i * 7) % 3) * 3.5;               // 7 / 10.5 / 14
      const seg = Math.min(want, HALF - t);
      const h = 8.5 + ((i * 5) % 4) * 2.75;               // 8.5 -> 16.75
      const c = t + seg / 2;
      const col = FRONTS[(i + (side > 0 ? 2 : 0)) % FRONTS.length];
      if (axis === "x") {
        box(c, h / 2, side * mid, seg, h, FACADE_D, col);
        box(c, h + 0.35, side * mid, seg + 0.5, 0.7, FACADE_D + 0.5, C.ash);   // cornice
        for (let wy = 2.6; wy < h - 1.6; wy += 2.9) {
          const lit = (i + Math.round(wy)) % 5 === 0;
          decal(c, wy, side * face, seg * 0.62, 1.15, 0.14, lit ? C.windowLit : C.window);
        }
      } else {
        box(side * mid, h / 2, c, FACADE_D, h, seg, col);
        box(side * mid, h + 0.35, c, FACADE_D + 0.5, 0.7, seg + 0.5, C.ash);
        for (let wy = 2.6; wy < h - 1.6; wy += 2.9) {
          const lit = (i + Math.round(wy)) % 5 === 0;
          decal(side * face, wy, c, 0.14, 1.15, seg * 0.62, lit ? C.windowLit : C.window);
        }
      }
      t += seg;
      i++;
    }
  }
  facadeRun("x", -1); facadeRun("x", 1);
  facadeRun("z", -1); facadeRun("z", 1);

  // Skyline beyond the block: never collidable, never shootable, purely depth.
  // Without it the tops of the fronts read as the edge of the world.
  for (let a = 0; a < 44; a++) {
    const ang = (a / 44) * Math.PI * 2;
    const rad = HALF + 12 + (a % 5) * 7;
    const h = 16 + ((a * 13) % 7) * 4.5;
    const w = 6 + (a % 4) * 3;
    prop(Math.cos(ang) * rad, h / 2, Math.sin(ang) * rad, w, h, w,
         a % 3 === 0 ? C.towerFar : C.tower, { solid: false, collide: false });
  }

  // ============================================ NORLI bookshop (centre piece)
  const SHOP_W = 22, SHOP_D = 16, SHOP_H = 5;
  const wx = SHOP_W / 2, wz = SHOP_D / 2;

  decal(0, 0.07, 0, SHOP_W, 0.1, SHOP_D, C.wood);              // shop floor
  // north + south walls, each with a 5-wide doorway in the middle
  for (const zSide of [-wz, wz]) {
    box(-7.0, SHOP_H / 2, zSide, 8, SHOP_H, 0.5, C.brick);
    box( 7.0, SHOP_H / 2, zSide, 8, SHOP_H, 0.5, C.brick);
    box(0, SHOP_H - 0.6, zSide, 6, 1.2, 0.5, C.brick);         // lintel above the door
  }
  // east + west walls with big shop windows (shootable, not solid)
  for (const xSide of [-wx, wx]) {
    box(xSide, SHOP_H / 2, -6.2, 0.5, SHOP_H, 3.6, C.brick);
    box(xSide, SHOP_H / 2, 6.2, 0.5, SHOP_H, 3.6, C.brick);
    box(xSide, 0.6, 0, 0.5, 1.2, 9, C.brick);                  // window sill
    box(xSide, 4.5, 0, 0.5, 1, 9, C.brick);                    // window head
    prop(xSide, 2.8, 0, 0.3, 3.4, 9, C.glass, { solid: false, collide: true, opacity: 0.32 });
  }
  box(0, SHOP_H + 0.3, 0, SHOP_W + 1, 0.6, SHOP_D + 1, C.roof);
  // roof parapet — cover for anyone who takes the high ground
  box(0, SHOP_H + 1.2, -wz - 0.2, SHOP_W + 1, 1.2, 0.5, C.stone);
  box(0, SHOP_H + 1.2, wz + 0.2, SHOP_W + 1, 1.2, 0.5, C.stone);
  box(-wx - 0.2, SHOP_H + 1.2, 0, 0.5, 1.2, SHOP_D + 1, C.stone);
  box(wx + 0.2, SHOP_H + 1.2, -5.35, 0.5, 1.2, 6.3, C.stone);  // east parapet, split
  box(wx + 0.2, SHOP_H + 1.2, 5.35, 0.5, 1.2, 6.3, C.stone);   //   to leave a stair doorway

  // fascia panels the 3D "norli" wordmarks are mounted on
  box(0, 3.4, -wz - 0.3, 11, 2.6, 0.2, C.white);
  box(0, 3.4, wz + 0.3, 11, 2.6, 0.2, C.white);
  sign(0, 6.6, -wz - 0.55, 7, 1, Math.PI, "BOKHANDEL", "#c9d2e3", "#0d2438");

  // shelving inside — the interior is a maze of aisles
  function shelf(x, z, len, axis) {
    const w = axis === "x" ? len : 0.8;
    const d = axis === "x" ? 0.8 : len;
    box(x, 1.1, z, w, 2.2, d, C.shelf);
    const books = [C.book1, C.book2, C.book3, C.book4];
    const n = Math.floor(len / 0.9);
    for (let i = 0; i < n; i++) {
      const off = -len / 2 + 0.45 + i * 0.9;
      const bx = axis === "x" ? x + off : x;
      const bz = axis === "x" ? z : z + off;
      prop(bx, 1.55, bz, axis === "x" ? 0.75 : 0.85, 0.5, axis === "x" ? 0.85 : 0.75, books[i % 4], { solid: false });
      prop(bx, 0.75, bz, axis === "x" ? 0.75 : 0.85, 0.5, axis === "x" ? 0.85 : 0.75, books[(i + 2) % 4], { solid: false });
    }
  }
  shelf(-6.5, -3.5, 7, "x");
  shelf(6.5, -3.5, 7, "x");
  shelf(-6.5, 3.5, 7, "x");
  shelf(6.5, 3.5, 7, "x");
  shelf(0, 0, 6, "z");
  // counter by the north door
  box(-3.5, 0.55, -5.5, 4, 1.1, 1, C.wood);
  prop(-3.5, 1.2, -5.5, 0.5, 0.3, 0.4, C.monitor);
  // display tables
  for (const [tx, tz] of [[3.5, -5.5], [3.5, 5.5], [-3.5, 5.5]]) {
    box(tx, 0.45, tz, 2.4, 0.9, 1.4, C.wood);
    prop(tx, 1.0, tz, 1.6, 0.2, 0.9, C.book2, { solid: false });
  }

  // Outdoor staircase up to the roof on the east side. It climbs WESTWARD so the
  // top tread finishes flush against the roof edge (both at y=5.6) — climbing the
  // other way tops out in mid-air, which is what stranded players before.
  stairs(wx + 6.85, 0, SHOP_H + 0.6, 6, 4, "x", -1, C.stone);   // flush to the shop wall

  // ================================================= north: park / outdoors
  function tree(x, z, s) {
    box(x, 1.6 * s, z, 0.7 * s, 3.2 * s, 0.7 * s, C.trunk, { edges: false });
    box(x, 3.9 * s, z, 3.6 * s, 2.0 * s, 3.6 * s, C.leaf, { edges: false });
    prop(x, 5.1 * s, z, 2.4 * s, 1.4 * s, 2.4 * s, C.leafHi, { solid: false });
  }
  for (const [x, z, s] of [
    [-24, -32, 1.1], [-14, -28, 0.9], [-30, -18, 1.0], [-19, -19, 0.85],
    [24, -32, 1.1], [14, -28, 0.9], [30, -18, 1.0], [19, -19, 0.85],
    [-16, -37, 1.0], [16, -37, 1.0],
  ]) tree(x, z, s);

  function bench(x, z, axis) {
    const w = axis === "x" ? 2.6 : 0.7, d = axis === "x" ? 0.7 : 2.6;
    box(x, 0.5, z, w, 0.18, d, C.wood);
    prop(x, 0.25, z, w * 0.85, 0.5, d * 0.5, C.metal);
    box(x, 0.95, z + (axis === "x" ? -0.28 : 0), w, 0.7, axis === "x" ? 0.14 : d, C.wood);
  }
  bench(-9, -14, "x"); bench(9, -14, "x"); bench(-16, -24, "z"); bench(16, -24, "z");

  function lamp(x, z) {
    box(x, 2.5, z, 0.28, 5, 0.28, C.metal, { edges: false });
    prop(x, 5.2, z, 0.9, 0.5, 0.9, C.white, { solid: false });
  }
  lamp(-13, -16); lamp(13, -16); lamp(-13, -36); lamp(13, -36);

  // ===================================== BOOKIS CASTLE (north park landmark)
  const KX = 0, KZ = -26, CW = 18, CD = 14, CWALL = 4;
  const cwx = CW / 2, cwz = CD / 2;

  // Walls are 1.8 thick so the rampart is genuinely walkable: the merlons sit on
  // the outer 0.6 and leave a 1.2 walkway inside. At 1.0 thick the merlons filled
  // the whole wall top and the rampart could not be walked at all.
  const WT = 1.8, CRO = WT / 2 - 0.3;

  decal(KX, 0.06, KZ, CW, 0.1, CD, C.stone);                        // courtyard
  box(KX, CWALL / 2, KZ - cwz, CW, CWALL, WT, C.stone);             // north wall
  box(KX - 5.5, CWALL / 2, KZ + cwz, 7, CWALL, WT, C.stone);        // south wall,
  box(KX + 5.5, CWALL / 2, KZ + cwz, 7, CWALL, WT, C.stone);        //   split for a gate
  box(KX, CWALL - 0.5, KZ + cwz, 4, 1, WT, C.stone);                // gate arch
  box(KX - cwx, CWALL / 2, KZ, WT, CWALL, CD, C.stone);             // west wall
  box(KX + cwx, CWALL / 2, KZ, WT, CWALL, CD, C.stone);             // east wall

  // crenellations, hugging the outer edge so the walkway stays clear
  for (let i = -8; i <= 8; i += 2) {
    prop(KX + i, CWALL + 0.35, KZ - cwz - CRO, 1, 0.7, 0.6, C.stone);
    if (Math.abs(i) > 2) prop(KX + i, CWALL + 0.35, KZ + cwz + CRO, 1, 0.7, 0.6, C.stone);
  }
  for (let i = -6; i <= 6; i += 2) {
    prop(KX - cwx - CRO, CWALL + 0.35, KZ + i, 0.6, 0.7, 1, C.stone);
    prop(KX + cwx + CRO, CWALL + 0.35, KZ + i, 0.6, 0.7, 1, C.stone);
  }

  // corner turrets, capped in the brand colour
  for (const [tx, tz] of [[-cwx, -cwz], [cwx, -cwz], [-cwx, cwz], [cwx, cwz]]) {
    box(KX + tx, 3.5, KZ + tz, 3.4, 7, 3.4, C.stone);
    for (const [ox, oz] of [[-1.2, -1.2], [1.2, -1.2], [-1.2, 1.2], [1.2, 1.2]]) {
      prop(KX + tx + ox, 7.35, KZ + tz + oz, 1, 0.7, 1, C.stone);
    }
    prop(KX + tx, 8.1, KZ + tz, 2.6, 0.9, 2.6, BRAND.color, { solid: false });
    prop(KX + tx, 8.9, KZ + tz, 1.4, 0.9, 1.4, BRAND.color, { solid: false });
  }

  // the keep
  box(KX, 4, KZ, 8, 8, 6, C.stone);
  box(KX, 8.3, KZ - 0.5, 9, 0.6, 8, C.stone);                       // roof, extended to meet the stair
  // Roof parapet. The west run stops short of the north-west corner, leaving a
  // doorway where the stair landing meets the roof — otherwise the parapet walls
  // off the only way up.
  box(KX + 1.25, 9.1, KZ - 4.1, 6.5, 1, 0.5, C.stone);              // north, open at its west end
  box(KX, 9.1, KZ + 3.6, 9, 1, 0.5, C.stone);                       // south
  box(KX + 4.6, 9.1, KZ - 0.5, 0.5, 1, 8, C.stone);                 // east
  box(KX - 4.6, 9.1, KZ + 1.0, 0.5, 1, 5, C.stone);                 // west, stops short of the corner
  box(KX, 5.4, KZ + 3.15, 5.8, 1.7, 0.2, C.white);                  // panel for the 3D logo

  // Stair run up the west side of the courtyard. Its top step finishes level with
  // the keep roof (both at y=8.6) and their footprints touch, so you walk straight
  // across — no landing slab, which is what used to block the top of the stairs.
  stairs(KX - 6.05, KZ + 5.5, 8.6, 9, 4.1, "z", -1, C.stone);

  // separate short flight on the east side up to the rampart walk. It reaches the
  // wall face, so the top tread is level with and touching the rampart — no
  // separate step block, and no slot behind the stairs to fall into.
  stairs(KX + 6.05, KZ + 5.5, 4, 4, 4.1, "z", -1, C.stone);

  // hedges as mid-park cover
  box(-20, 0.75, -12, 10, 1.5, 1.2, C.hedge);
  box(20, 0.75, -12, 10, 1.5, 1.2, C.hedge);
  box(-32, 0.75, -26, 1.2, 1.5, 9, C.hedge);
  box(32, 0.75, -26, 1.2, 1.5, 9, C.hedge);

  // ==================================================== south: office floor
  function desk(x, z, axis) {
    const w = axis === "x" ? 2.6 : 1.3, d = axis === "x" ? 1.3 : 2.6;
    box(x, 0.72, z, w, 0.12, d, C.desk);
    prop(x, 0.36, z, w * 0.9, 0.72, d * 0.6, C.metal);
    prop(x, 1.05, z, axis === "x" ? 0.9 : 0.08, 0.55, axis === "x" ? 0.08 : 0.9, C.monitor, { solid: false });
    prop(x + (axis === "x" ? 0 : 1.1), 0.45, z + (axis === "x" ? 1.1 : 0), 0.55, 0.9, 0.55, C.cubicle, { solid: false });
  }
  for (const [x, z] of [[-22, 16], [-16, 16], [-22, 22], [-16, 22], [16, 16], [22, 16], [16, 22], [22, 22]]) {
    desk(x, z, "x");
  }
  // cubicle dividers form lanes through the office
  box(-19, 0.85, 19, 12, 1.7, 0.3, C.cubicle);
  box(19, 0.85, 19, 12, 1.7, 0.3, C.cubicle);
  box(-13, 0.85, 19, 0.3, 1.7, 8, C.cubicle);
  box(13, 0.85, 19, 0.3, 1.7, 8, C.cubicle);
  box(0, 0.85, 30, 20, 1.7, 0.3, C.cubicle);

  // ------------------------------------------------------------- OKR room
  // Waist-high sills with a wide open window band above them: you can shoot in
  // from anywhere in the office, and shoot out from inside, over every side.
  const MX = 0, MZ = 20, MW = 12, MD = 9;
  const mwx = MW / 2, mwz = MD / 2;
  box(MX, 0.15, MZ, MW, 0.3, MD, C.white);                       // raised floor
  decal(MX, 0.31, MZ, MW - 0.6, 0.06, MD - 0.6, "#5b6c94");      // rug

  // sills, split to leave a door gap on the north and south faces
  for (const oz of [-mwz, mwz]) {
    box(MX - 3.95, 0.65, MZ + oz, 3.7, 1.0, 0.3, C.white);   // meet the corner posts,
    box(MX + 3.95, 0.65, MZ + oz, 3.7, 1.0, 0.3, C.white);   //   leaving no thin gap
  }
  box(MX - mwx, 0.65, MZ, 0.3, 1.0, MD, C.white);
  box(MX + mwx, 0.65, MZ, 0.3, 1.0, MD, C.white);

  // corner posts and roof — the band between sill and roof is open air
  for (const [ox, oz] of [[-mwx, -mwz], [mwx, -mwz], [-mwx, mwz], [mwx, mwz]]) {
    box(MX + ox, 2.0, MZ + oz, 0.4, 3.7, 0.4, C.metal);
  }
  box(MX, 3.95, MZ, MW + 0.8, 0.3, MD + 0.8, C.white);
  // a few glass panes remain on the short sides; shootable, not walkable
  for (const ox of [-mwx, mwx]) {
    prop(MX + ox, 2.4, MZ - 2.6, 0.2, 2.5, 3, C.glass, { solid: false, collide: true, opacity: 0.28 });
    prop(MX + ox, 2.4, MZ + 2.6, 0.2, 2.5, 3, C.glass, { solid: false, collide: true, opacity: 0.28 });
  }

  // boardroom table, chairs, whiteboard
  box(MX, 0.75, MZ, 5.5, 0.15, 2.4, C.desk);
  prop(MX, 0.45, MZ, 4.6, 0.75, 1.7, C.metal);
  for (const [cx, cz] of [[-2, -2], [0, -2], [2, -2], [-2, 2], [0, 2], [2, 2]]) {
    prop(MX + cx, 0.75, MZ + cz, 0.6, 1.0, 0.6, C.cubicle);
  }
  prop(MX - mwx + 0.4, 2.4, MZ, 0.12, 2.0, 4.5, C.white, { solid: false });
  sign(MX, 4.7, MZ - mwz - 0.5, 5, 1.2, Math.PI, "OKR ROOM", "#f7c948", "#12324f");
  sign(MX, 4.7, MZ + mwz + 0.5, 5, 1.2, 0, "OKR ROOM", "#f7c948", "#12324f");
  sign(MX, 3.7, MZ - mwz - 0.5, 6, 0.7, Math.PI, "HEAL + STEADY AIM", "#7ee0c0", "#0d2438");
  sign(MX, 3.7, MZ + mwz + 0.5, 6, 0.7, 0, "HEAL + STEADY AIM", "#7ee0c0", "#0d2438");

  // plants, cooler, printer
  function plant(x, z) {
    prop(x, 0.35, z, 0.7, 0.7, 0.7, C.stone);
    prop(x, 1.1, z, 1.3, 1.2, 1.3, C.leaf, { solid: false });
  }
  plant(-10, 13); plant(10, 13); plant(-27, 28); plant(27, 28);
  box(-8, 0.7, 33, 0.9, 1.4, 0.9, C.white);   // water cooler
  box(8, 0.6, 33, 1.4, 1.2, 1, C.metal);      // printer

  // ======================================= ARK — the derelict bookshop (west)
  // Squatted and falling down: roof caved in, north wall blown out, a camp set
  // up inside. Anything crooked here is decorative (`rot` implies non-solid), so
  // the server's exact axis-aligned hit maths is untouched.
  const AX = -34, AZ = 0, AH = 5.5, AT = 0.6;

  decal(AX, 0.14, AZ, 16, 0.08, 14, C.concrete);                    // cracked slab (top 0.18)

  // --- shell -----------------------------------------------------------------
  // north wall, torn open in the middle
  box(-38.5, AH / 2, AZ - 7, 7, AH, AT, C.brickDark);
  box(-29, AH / 2, AZ - 7, 6, AH, AT, C.brickDark);
  box(-33.5, AH - 0.45, AZ - 7, 3, 0.9, AT, C.brickDark);           // lintel over the breach
  prop(-34.6, 0.5, AZ - 6.2, 1.6, 1.0, 1.4, C.ash);                 // rubble spill
  prop(-33.2, 0.32, AZ - 5.4, 1.2, 0.65, 1.2, C.ash);

  // south wall with the doorway
  box(-39.5, AH / 2, AZ + 7, 5, AH, AT, C.brickDark);
  box(-30, AH / 2, AZ + 7, 8, AH, AT, C.brickDark);
  box(-35.5, AH - 0.45, AZ + 7, 3, 0.9, AT, C.brickDark);

  // west wall: mostly gone, a stub and a knee-high ruin
  box(-42, AH / 2, AZ - 4, AT, AH, 6, C.brickDark);
  box(-42, 0.9, AZ + 3.5, AT, 1.8, 7, C.brickDark);

  // east facade, with a smashed shop window you can vault through
  box(-26, AH / 2, AZ - 4.5, AT, AH, 5, C.brickDark);
  box(-26, AH / 2, AZ + 4.5, AT, AH, 5, C.brickDark);
  box(-26, 0.6, AZ, AT, 1.2, 4, C.brickDark);                       // sill, low enough to jump
  box(-26, 4.5, AZ, AT, 2, 4, C.brickDark);                         // header
  box(-24.2, 0.8, AZ + 1.4, 1.6, 1.6, 1.6, C.wood);                 // crate: a leg up to the window
  box(-25.8, 4.7, AZ + 2, 0.5, 0.22, 4.4, C.rust);                  // bracket the sign hangs from

  // what is left of the roof, open over the south-east corner
  box(-38.5, AH + 0.3, AZ, 7, AT, 14, C.ash);
  box(-33.5, AH + 0.3, AZ - 4.5, 3, AT, 5, C.ash);
  prop(-31, AH + 0.3, AZ - 6, 2, AT, 2, C.ash);
  prop(-27.5, AH + 0.3, AZ + 5, 3, AT, 4, C.ash);
  crooked(-32.2, 5.1, AZ - 1.4, 1.8, 0.25, 1.8, C.ash, [0.5, 0.3, 0.2]);   // fragment hanging by nothing

  // --- mezzanine: the fight has a second storey -------------------------------
  box(-39, 2.8, AZ - 3.5, 6, 0.4, 7, C.wood);                       // deck, top at 3.0
  box(-41.5, 3.4, AZ + 0.15, 1, 0.9, 0.3, C.rust);                  // railing, split to leave
  box(-36.5, 3.4, AZ + 0.15, 1, 0.9, 0.3, C.rust);                  //   the stair head clear
  box(-42.1, 3.4, AZ - 3.5, 0.3, 0.9, 7, C.rust);
  stairs(-39, AZ + 4.4, 3.0, 4, 4, "z", -1, C.wood);                // tops out flush with the deck
  prop(-36.6, 3.35, AZ - 5.5, 0.5, 0.7, 2.4, C.shelf, { solid: false });   // junk on the deck edge

  // --- cover on the ground floor ---------------------------------------------
  box(-38, 0.45, AZ - 3.5, 5, 0.9, 1.8, C.shelf);                   // toppled shelf
  box(-36.5, 0.45, AZ + 3, 1.8, 0.9, 5, C.shelf);                   // toppled shelf
  box(-30.5, 1.1, AZ - 5.2, 5, 2.2, 0.8, C.shelf);                  // one rack still upright
  box(-27.8, 1.5, AZ + 3.5, 0.9, 3.0, 3, C.shelf);                  // leaning on the facade
  box(-30.5, 0.5, AZ - 2, 3.6, 1.0, 1.2, C.wood);                   // wrecked counter
  box(-31.5, 0.8, AZ + 4.5, 1.6, 1.6, 1.6, C.wood);                 // crate
  box(-33.5, 0.55, AZ + 1.5, 2.2, 1.1, 1.4, C.ash);                 // rubble block, waist high

  // --- the shelter ------------------------------------------------------------
  // Someone lives here now. Sleeping bays are tucked under the mezzanine where
  // there is still a roof, belongings are stacked rather than strewn, and the
  // middle of the floor is deliberately kept clear so the room still plays.
  function bay(x, z, i) {
    prop(x, 0.17, z, 2.0, 0.3, 1.2, "#8a8f7c", { solid: false });               // mattress
    crooked(x - 0.5, 0.5, z + 0.1, 1.2, 0.4, 0.55, "#6b6f5e", [0, 0.08 * i, 0.03]);  // bedroll
    crooked(x + 1.15, 0.7, z, 0.08, 1.4, 1.25, "#a98153", [0, 0.04 * i, 0.02]);      // cardboard divider
    prop(x - 0.95, 0.28, z - 0.8, 0.55, 0.56, 0.5, "#2b2f36", { solid: false });     // bagged belongings
    crooked(x + 0.2, 0.42, z - 0.85, 0.42, 0.3, 0.32, "#5c6672", [0, 0.5 * i, 0]);   // tin mug, boots
  }
  bay(-39.4, AZ - 6.0, 0);
  bay(-39.4, AZ - 3.9, 1);
  bay(-39.4, AZ - 1.8, 2);

  // the fire, and something to sit on
  box(-32.6, 0.5, AZ + 4.3, 1.0, 1.0, 1.0, C.rust);                             // barrel, kept clear
  prop(-32.6, 1.12, AZ + 4.3, 0.8, 0.3, 0.8, "#ff8a3d", { solid: false });      //   of the rubble block
  for (const [sx, sz, r] of [[-34.4, 3.9, 0.3], [-31.2, 4.4, -0.4], [-33.4, 1.6, 0.2]]) {
    crooked(sx, 0.3, AZ + sz, 0.85, 0.6, 0.85, C.wood, [0, r, 0]);              // upturned crates
  }
  prop(-31.4, 0.25, AZ + 2.2, 0.45, 0.5, 0.45, C.metal, { solid: false });      // camping stove
  crooked(-34.6, 0.22, AZ + 2.4, 0.4, 0.44, 0.4, "#4a7d96", [0, 0.4, 0.05]);    // bucket
  crooked(-31.0, 0.24, AZ + 5.2, 0.36, 0.48, 0.36, "#8a8f7c", [0, 0.9, 0.03]);  // jerrycan

  // washing line strung from the mezzanine railing across to the facade
  prop(-32, 2.45, AZ + 0.2, 12, 0.05, 0.05, "#4a4a4a", { solid: false });
  for (let i = 0; i < 6; i++) {
    crooked(-37 + i * 2.0, 2.05, AZ + 0.2, 0.7, 0.85, 0.06,
            ["#8a8f7c", "#4a7d96", "#a98153", "#6b6f5e"][i % 4], [0, 0, 0.05 * (i % 3 - 1)]);
  }

  // a porch of tarpaulin over the smashed window
  crooked(-27.6, 2.6, AZ + 0.4, 2.6, 0.1, 3.2, "#3f6f8a", [0.14, 0, -0.22]);
  crooked(-28.9, 1.9, AZ - 1.3, 1.9, 0.09, 2.0, "#4a7d96", [-0.3, 0.35, 0.18]);

  // stacked pallets and cardboard, kept against the walls
  for (let i = 0; i < 4; i++) {
    crooked(-28.6, 0.22 + i * 0.42, AZ + 5.4 - (i % 2) * 0.3, 1.3, 0.4, 1.0,
            i % 2 ? "#a98153" : "#93704a", [0, 0.16 * i, 0.03 * (i % 3 - 1)]);
  }
  for (const [tx, tz] of [[-30.8, 6.2], [-32.2, 5.4]]) {
    prop(tx, 0.34, tz, 0.85, 0.68, 0.85, "#2b2f36", { solid: false });          // bin bags
  }
  prop(-35.8, 0.55, AZ + 5.9, 1.1, 0.7, 1.6, C.metal, { solid: false });        // trolley
  crooked(-35.8, 1.0, AZ + 6.6, 1.1, 0.55, 0.1, C.metal, [0.35, 0, 0]);

  // planks leaning on the breach
  crooked(-34.8, 1.6, AZ - 6.2, 0.3, 3.4, 0.14, C.wood, [0.42, 0.1, 0.2]);
  crooked(-33.9, 1.5, AZ - 6.0, 0.28, 3.2, 0.14, C.wood, [-0.36, -0.2, -0.15]);

  // graffiti on the standing walls
  crooked(-25.62, 2.6, AZ - 4.5, 0.02, 1.2, 3.4, "#d94f7a", [0, 0, 0.05]);
  crooked(-25.62, 3.4, AZ + 5, 0.02, 0.9, 2.6, "#4fd98f", [0, 0, -0.08]);
  crooked(-38.4, 3.2, AZ - 6.65, 3.2, 1.0, 0.02, "#e0c33f", [0, 0, 0.04]);

  // Stock swept into two piles rather than scattered over the whole floor: the
  // litter looked chaotic and got in the way of moving through the room.
  const spill = [C.book1, C.book2, C.book3, C.book4];
  const piles = [[-36.8, AZ + 2.6], [-29.6, AZ - 6.2]];
  piles.forEach(([px, pz], p) => {
    for (let i = 0; i < 7; i++) {
      const a = i * 1.3 + p;
      crooked(px + Math.cos(a) * (0.25 + i * 0.075), 0.12 + (i % 3) * 0.16,
              pz + Math.sin(a) * (0.25 + i * 0.075), 0.5, 0.15, 0.34,
              spill[i % 4], [0, a, 0.04 * (i % 3 - 1)]);
    }
  });

  // one stack that has no business standing up
  for (let i = 0; i < 11; i++) {
    crooked(-31.4 + i * 0.14, 0.28 + i * 0.33, AZ - 3.4 + i * 0.09, 0.6, 0.29, 0.42,
            spill[i % 4], [0, i * 0.36, 0.045 * i]);
  }

  // ==================================================== street furniture
  // Bays, stalls and scaffolding along the block, so the edges are somewhere to
  // fight rather than a wall you back into.
  function stall(x, z, axis) {
    const w = axis === "x" ? 4.2 : 1.6, d = axis === "x" ? 1.6 : 4.2;
    box(x, 0.55, z, w, 1.1, d, C.wood);
    for (const [ox, oz] of axis === "x" ? [[-1.9, 0], [1.9, 0]] : [[0, -1.9], [0, 1.9]]) {
      box(x + ox, 1.6, z + oz, 0.22, 3.2, 0.22, C.metal);
    }
    prop(x, 3.3, z, w + 0.8, 0.25, d + 0.8, C.book1, { solid: false });   // awning
  }
  stall(-40, 20, "x"); stall(-33, 24, "z"); stall(40, -20, "x"); stall(33, -24, "z");

  function scaffold(x, z) {                       // climbable: adds height at the edge
    for (const [ox, oz] of [[-2.4, -1.2], [2.4, -1.2], [-2.4, 1.2], [2.4, 1.2]]) {
      box(x + ox, 2, z + oz, 0.24, 4, 0.24, C.metal);
    }
    box(x, 2.1, z, 5.4, 0.3, 3, C.wood);          // deck
    // start far enough out that the top tread finishes AT the deck edge rather
    // than under it, which would trap anyone climbing
    stairs(x + 6.0, z, 2.1, 3, 2.6, "x", -1, C.metal);
  }
  scaffold(-40, -20); scaffold(38, 20);   // kept clear of the block, or the stair runs into it

  // stacked crates in the corners
  for (const [cx, cz] of [[-42, -40], [42, 40], [42, -40], [-42, 40]]) {
    box(cx, 1.1, cz, 2.2, 2.2, 2.2, C.wood);
    box(cx + (cx > 0 ? -1.9 : 1.9), 0.8, cz, 1.6, 1.6, 1.6, C.wood);
    box(cx, 2.9, cz, 1.6, 1.4, 1.6, C.rust);
  }

  // bus shelter on the south edge
  box(6, 1.4, 42, 6, 0.25, 2.6, C.metal);
  for (const ox of [-2.8, 2.8]) box(6 + ox, 1.4, 42, 0.22, 2.8, 2.4, C.glass, { solid: false, collide: true, opacity: 0.3 });
  box(6, 0.5, 43, 5.7, 1.0, 0.5, C.wood);
  plant(-20, 14); plant(20, -14); plant(-44, 6); plant(44, -6);
  // east: pallets and crates by the stairs
  for (const [x, z, s] of [[27, -7, 1.6], [29.5, -7, 1.6], [27, -9.5, 1.6], [33, 6, 2.2], [30, 9, 1.6]]) {
    box(x, s / 2, z, s, s, s, C.wood);
  }
  box(34, 1.1, -2, 1, 2.2, 10, C.brick);

  // freestanding spinning logo on a post at the south entrance
  box(0, 2.2, 36, 0.5, 4.4, 0.5, C.metal, { edges: false });

  // ================================================================ models
  // Real 3D geometry built from the logo artwork (see assets/*-logo.json).
  // Built and animated client-side; never collidable or shootable.
  const models = [
    { file: "assets/bookis-logo.json", pos: [0, 11.9, -26], height: 1.7, depth: 0.5, spin: 0.5, ring: true,
      target: { id: "bookis-keep", hp: 126, points: 3, radius: 2.2 } },
    { file: "assets/bookis-logo.json", pos: [0, 5.4, 36], height: 0.9, depth: 0.3, spin: 0.9,
      target: { id: "bookis-post", hp: 90, points: 2, radius: 1.4 } },
    { file: "assets/norli-logo.json", pos: [0, 3.4, -wz - 0.5], height: 1.9, depth: 0.35, rotY: Math.PI },
    { file: "assets/norli-logo.json", pos: [0, 3.4, wz + 0.5], height: 1.9, depth: 0.35 },
    { file: "assets/norli-logo.json", pos: [0, 7.8, 0], height: 2.2, depth: 0.4, spin: 0.4,
      target: { id: "norli-roof", hp: 126, points: 3, radius: 2.0 } },
    { file: "assets/bookis-logo.json", pos: [0, 5.4, -22.85], height: 1.0, depth: 0.25 },
    // ARK's sign still hangs on the one wall left standing, but not straight
    { file: "assets/ark-logo.json", pos: [-25.5, 3.5, 2], height: 2.8, depth: 0.35,
      rotY: Math.PI / 2, rotZ: -0.16,
      target: { id: "ark-sign", hp: 108, points: 4, radius: 1.8 } },
  ];

  // ================================================================= zones
  // Standing inside grants the OKR buff: the server heals you, the client
  // tightens your aim. Same box read by both, so they can never disagree.
  const zones = [
    { id: "okr", min: [MX - mwx, 0.3, MZ - mwz], max: [MX + mwx, 4.0, MZ + mwz] },
  ];

  // ================================================================ lights
  // Point lights placed in the world; `flicker` is animated client-side.
  const lights = [
    { pos: [-25.3, 4.3, 2], color: C.ark, intensity: 3.2, distance: 20, flicker: true },
    { pos: [-36, 3.4, 1], color: "#8fd8ff", intensity: 0.9, distance: 16 },
    { pos: [-32.6, 1.5, 4.3], color: "#ff7a3d", intensity: 1.1, distance: 11, flicker: true },
  ];

  // =============================================================== effects
  // Animated client-side. bookRing: stock still orbiting where the roof gave in.
  const effects = [
    { type: "bookRing", pos: [-30.5, 8.4, 2], radius: 3.1, count: 16, spin: 0.3, tilt: 0.12 },
    { type: "bookRing", pos: [-30.5, 10.8, 2], radius: 1.7, count: 9, spin: -0.5, tilt: -0.2 },
    { type: "bookRing", pos: [-36, 7.2, -3], radius: 1.2, count: 6, spin: 0.7, tilt: 0.3 },
  ];

  // ================================================================= spawns
  // Spread across every zone and both heights so respawns are unpredictable.
  const spawns = [
    // park, north
    [-30, 0, -34], [30, 0, -34], [0, 0, -35], [-16, 0, -14], [16, 0, -14],
    // office, south
    [-34, 0, 30], [34, 0, 30], [0, 0, 35], [-12, 0, 28], [12, 0, 28],
    // plazas, east and west
    [-35, 0, 8], [35, 0, -14], [-30, 0, -8], [31, 0, 14],
    // mid-map flanks
    [-20, 0, -6], [20, 0, 6],
    // high ground
    [-9, 5.6, -6], [9, 5.6, 6],
    // ARK and the west end
    [-38, 0, 10], [-30, 0, -12], [-43, 0, -10], [-38, 0, 22],
    // outer street, along the new block
    [42, 0, 0], [0, 0, 43], [0, 0, -43], [42, 0, 28], [-43, 0, 34],
  ];

  // =============================================================== pickups
  // type: health | ammo | damage | speed
  const pickups = [
    { id: "h1", type: "health", pos: [0, 0.6, -20] },        // by the fountain
    { id: "h2", type: "health", pos: [0, 0.6, 27] },         // office, behind the pod
    { id: "a1", type: "ammo",   pos: [-30, 0.6, 0] },        // under the pergola
    { id: "a2", type: "ammo",   pos: [30, 0.6, 0] },         // east plaza
    { id: "d1", type: "damage", pos: [0, 9.4, -26] },        // castle keep roof — high risk
    { id: "a3", type: "ammo",   pos: [0, 6.4, 0] },          // Norli roof
    { id: "s1", type: "speed",  pos: [3.2, 0.7, 0] },        // shop aisle, between the shelves
  ];

  return {
    name: "Norli Plaza",
    half: HALF,
    wallHeight: WALL_H,
    skyColor: C.sky,
    colors: C,
    brand: BRAND,
    boxes,
    signs,
    models,
    zones,
    lights,
    effects,
    spawns,
    pickups,
  };
});
