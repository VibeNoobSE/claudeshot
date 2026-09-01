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
    panel:     "#a3a29c",
    panelDark: "#8b8a84",
    panelWorn: "#b4b0a4",
    rebar:     "#7a5a44",
    sodium:    "#ffb45e",
    mosaicA:   "#3f7d8c",
    mosaicB:   "#c9762f",
    mosaicC:   "#d8cbb0",
    mosaicD:   "#6b8f4e",
    paint:     "#4c6b7a",
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

  // A flight starting at `baseY` rather than the ground, for stairs between
  // floors. Each tread is a solid block from baseY up to its own top.
  function stairsAt(baseY, x, z, rise, steps, width, axis, dir, color) {
    const step = rise / steps;
    const run = 1.1;
    for (let i = 0; i < steps; i++) {
      const h = step * (i + 1);
      const off = dir * (i * run + run / 2);
      if (axis === "x") box(x + off, baseY + h / 2, z, run, h, width, color);
      else box(x, baseY + h / 2, z + off, width, h, run, color);
    }
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

  // ============================== ARK — Blokk 4, a concrete-panel bookshop
  // Eastern-bloc civic architecture gone to seed: a two-storey prefab slab with
  // the state bookshop on the ground floor, an external stair tower, and a
  // courtyard with a carpet-beating rack and a dead fountain. Built for the
  // fight: a column grid for cover downstairs, a balcony that overlooks it, and
  // a roof worth climbing to.
  const BX = -37, BZ = 0;                       // building centre
  const BW = 14, BD = 20;                       // 14 x 20 footprint
  const F1 = 3.6, F2 = 7.6;                     // floor slab heights
  const bwx = BW / 2, bwz = BD / 2;             // -44..-30, -10..10

  decal(BX, 0.14, BZ, BW, 0.08, BD, C.concrete);
  decal(-27, 0.14, 0, 8, 0.08, 30, C.panelWorn);                  // courtyard apron

  // --- shell: precast panels with the joints showing --------------------------
  function panelWall(x, y, z, w, h, d, tone) {
    box(x, y, z, w, h, d, tone || C.panel);
  }
  // rear (west) wall, service door at the south end
  panelWall(-44.4, F1 / 2, BZ - 4.7, 0.8, F1, 11.4, C.panelDark); // set into the block front,
  panelWall(-44.4, F1 / 2, BZ + 7.7, 0.8, F1, 5.4, C.panelDark);  //   leaving no gap behind
  panelWall(-44.4, F1 - 0.4, BZ + 3, 0.8, 0.8, 4, C.panelDark);   // lintel over the service door
  panelWall(-44.4, F1 + (F2 - F1) / 2, BZ, 0.8, F2 - F1, BD, C.panel);

  // north and south gables
  panelWall(BX, F2 / 2 + 0.2, BZ - bwz, BW, F2 + 0.4, 0.6, C.panel);
  panelWall(BX - 4, F2 / 2 + 0.2, BZ + bwz, 6, F2 + 0.4, 0.6, C.panel);
  panelWall(BX + 4.5, F2 / 2 + 0.2, BZ + bwz, 5, F2 + 0.4, 0.6, C.panel);
  panelWall(BX + 0.5, F1 + 1.4, BZ + bwz, 3, 4.8, 0.6, C.panel);  // over the south opening

  // east face: shop front below, window band above
  for (const [pz, pw] of [[-8.4, 3.2], [-3.6, 3.2], [6, 3.2]]) {   // the 1.2 mullion is gone
    panelWall(-30, F1 / 2, BZ + pz, 0.6, F1, 1.4, C.panelDark);   // mullions between openings
  }
  panelWall(-30, F1 - 0.35, BZ, 0.6, 0.7, BD, C.panelDark);       // shopfront head
  panelWall(-30, F1 + (F2 - F1) / 2, BZ - 9.25, 0.6, F2 - F1, 1.5, C.panel);
  panelWall(-30, F1 + (F2 - F1) / 2, BZ + 1.75, 0.6, F2 - F1, 16.5, C.panel);
  panelWall(-30, F2 - 0.6, BZ - 7.5, 0.6, 1.2, 2, C.panel);       // head of the first-floor door

  // window grid, punched into the upper storey
  for (const wz of [-8, -5.5, -3, -0.5, 2, 4.5, 7, 9]) {
    decal(-30.35, 5.7, BZ + wz, 0.12, 1.5, 1.5, C.window);
    decal(-43.65, 5.7, BZ + wz, 0.12, 1.5, 1.5, C.window);
  }
  for (const wx of [-42, -39.5, -37, -34.5, -32]) {
    decal(wx, 5.7, BZ - bwz - 0.35, 1.5, 1.5, 0.12, C.window);
  }

  // --- floor slabs ------------------------------------------------------------
  // First floor covers the west half plus the north end, leaving a void over the
  // shop floor: you can shoot down into it, and drop in from the balcony.
  box(-40.5, F1 + 0.2, BZ, 7, 0.4, BD, C.panelDark);
  box(-33.5, F1 + 0.2, BZ - 6, 7, 0.4, 8, C.panelDark);
  box(-36.5, F1 + 0.75, BZ - 1.8, 1, 1.1, 0.3, C.rebar);          // balcony rail, gapped
  box(-33.5, F1 + 0.75, BZ - 1.8, 5, 1.1, 0.3, C.rebar);
  box(-37, F1 + 0.75, BZ + 5, 0.3, 1.1, 10, C.rebar);
  // roof slab and parapet
  box(-35, F2 + 0.2, BZ, 10, 0.4, BD, C.panelDark);               // roof, with a stairwell
  box(-43.5, F2 + 0.2, BZ, 1, 0.4, BD, C.panelDark);              //   opening cut out of it
  box(-41.5, F2 + 0.2, BZ - 9.5, 3, 0.4, 1, C.panelDark);
  box(-41.5, F2 + 0.2, BZ + 3.25, 3, 0.4, 13.5, C.panelDark);
  box(BX, F2 + 0.9, BZ - bwz + 0.3, BW, 1, 0.5, C.panelWorn);
  box(BX, F2 + 0.9, BZ + bwz - 0.3, BW, 1, 0.5, C.panelWorn);
  box(BX - bwx + 0.3, F2 + 0.9, BZ, 0.5, 1, BD, C.panelWorn);
  box(BX + bwx - 0.3, F2 + 0.9, BZ + 4, 0.5, 1, 12, C.panelWorn);

  // --- column grid: the cover that makes the shop floor playable --------------
  for (const cx of [-41.5, -37, -32.5]) {
    for (const cz of [-7, -2.5, 2, 6.5]) {
      box(cx, F1 / 2, BZ + cz, 0.7, F1, 0.7, C.panelWorn);
    }
  }

  // --- shopfittings -----------------------------------------------------------
  function rack(x, z, len) {                                       // steel shelving
    box(x, 1.05, z, 0.9, 2.1, len, C.slate);
    const spines = [C.book1, C.book2, C.book3, C.book4];
    for (let i = 0; i < Math.floor(len / 0.95); i++) {
      const off = -len / 2 + 0.5 + i * 0.95;
      prop(x, 1.5, z + off, 0.95, 0.42, 0.86, spines[i % 4], { solid: false });
      prop(x, 0.72, z + off, 0.95, 0.42, 0.86, spines[(i + 2) % 4], { solid: false });
    }
  }
  rack(-39.5, BZ + 4.5, 7);
  rack(-35, BZ + 4.5, 7);
  rack(-39.5, BZ - 5.5, 6);
  box(-32.8, 0.55, BZ - 1.5, 2.6, 1.1, 4, C.slate);                // service counter
  prop(-32.8, 1.2, BZ - 2.6, 0.5, 0.2, 0.6, C.monitor, { solid: false });
  crooked(-34.6, 0.4, BZ + 8.6, 1.2, 0.8, 1.2, C.wood, [0, 0.3, 0.05]);   // stock crate
  crooked(-33.4, 0.36, BZ + 7.8, 1.0, 0.7, 1.0, C.wood, [0, -0.5, 0.04]);

  // first floor up to the roof, inside the west bay, under the stairwell opening
  stairsAt(F1 + 0.4, -41.5, BZ - 9.0, 4.0, 5, 3, "z", 1, C.panelWorn);

  // --- external stair, courtyard side ----------------------------------------
  // Ground to first floor outside the building, landing hard against the facade
  // so there is no slot behind it, then in through the upper door.
  stairs(-28.5, BZ - 14, F1 + 0.4, 5, 3, "z", 1, C.panelWorn);
  box(-28.5, F1 + 0.2, BZ - 7.5, 4, 0.4, 2, C.panelWorn);          // landing at the door
  box(-26.8, F1 + 0.9, BZ - 7.5, 0.3, 1.0, 2, C.rebar);            // its handrail

  // frame for the sign on the roof
  for (const fz of [-1.4, 3.4]) box(-30.9, F2 + 1.4, BZ + fz, 0.3, 2.4, 0.3, C.rebar);
  box(-30.9, F2 + 2.6, BZ + 1, 0.3, 0.22, 5, C.rebar);

  // --- roof clutter -----------------------------------------------------------
  box(BX - 3, F2 + 1.0, BZ + 6, 2.4, 1.6, 2.4, C.slate);           // plant housing
  box(BX + 3, F2 + 0.85, BZ - 2, 1.8, 1.3, 1.8, C.slate);
  prop(BX + 3, F2 + 1.8, BZ - 2, 1.4, 0.5, 1.4, C.metal);
  for (const [dx, dz] of [[-41, -7], [-39, 8]]) {                  // satellite dishes
    prop(dx, F2 + 0.9, BZ + dz, 0.24, 1.4, 0.24, C.metal, { solid: false });
    crooked(dx, F2 + 1.6, BZ + dz, 1.5, 0.24, 1.5, C.white, [0.55, 0.4, 0], { solid: false });
  }
  prop(BX, F2 + 0.7, BZ + 9.2, 12, 0.18, 0.18, C.rebar, { solid: false });   // aerial run

  // --- mosaic mural on the north gable ----------------------------------------
  const tiles = [C.mosaicA, C.mosaicB, C.mosaicC, C.mosaicD];
  for (let i = 0; i < 44; i++) {
    const mx = -43 + (i % 11) * 1.15;
    const my = 1.6 + Math.floor(i / 11) * 1.15;
    decal(mx, my, BZ - bwz - 0.35, 1.05, 1.05, 0.12, tiles[(i * 3 + Math.floor(i / 11)) % 4]);
  }

  // --- courtyard --------------------------------------------------------------
  // carpet-beating rack: the most Eastern-bloc object there is
  for (const ox of [-1.9, 1.9]) {
    box(-26 + ox, 1.1, BZ + 15, 0.22, 2.2, 0.22, C.rebar);
    box(-26 + ox, 1.1, BZ + 17.6, 0.22, 2.2, 0.22, C.rebar);
  }
  box(-26, 2.1, BZ + 16.3, 4.2, 0.16, 0.16, C.rebar);
  box(-26, 1.5, BZ + 16.3, 4.2, 0.14, 0.14, C.rebar);
  crooked(-26.6, 1.75, BZ + 16.3, 1.6, 0.06, 1.2, "#7d5a86", [0.06, 0, 0.04]);  // a rug left out

  // climbing frame, rusted
  for (const ox of [-1.6, 1.6]) box(-26 + ox, 1.0, BZ + 20.5, 0.18, 2.0, 0.18, C.rust);
  box(-26, 1.95, BZ + 20.5, 3.6, 0.16, 0.16, C.rust);
  for (const oz of [-0.6, 0.6]) box(-26, 1.0, BZ + 20.5 + oz, 3.6, 0.12, 0.12, C.rust);

  // dead fountain: a cracked basin with nothing in it
  for (const [ox, oz, w, d] of [[0, -2.6, 6, 0.5], [0, 2.6, 6, 0.5], [-2.75, 0, 0.5, 5.7], [2.75, 0, 0.5, 5.7]]) {
    box(-26.5 + ox, 0.45, BZ + 11 + oz, w, 0.9, d, C.panelWorn);
  }
  decal(-26.5, 0.2, BZ + 11, 5, 0.1, 4.7, C.ash);
  crooked(-26.5, 0.7, BZ + 11, 0.8, 1.4, 0.8, C.panelWorn, [0.22, 0.3, 0.1]);   // toppled plinth

  // kiosk
  box(-28, 1.4, BZ + 24, 3.2, 2.8, 3.2, C.paint);
  box(-28, 2.95, BZ + 24, 3.8, 0.3, 3.8, C.slate);
  decal(-29.65, 1.6, BZ + 24, 0.12, 1.2, 2.0, C.window);
  crooked(-28, 3.5, BZ + 24, 2.4, 0.6, 0.14, C.ark, [0, 0, 0.07]);             // its crooked sign

  // planters and bollards along the apron
  for (const pz of [12, 16, 20, 26]) {
    box(-28.6, 0.4, BZ + pz, 1.4, 0.8, 2.6, C.panelWorn);
    prop(-28.6, 1.0, BZ + pz, 1.1, 0.7, 2.2, C.leaf, { solid: false });
  }
  for (const pz of [9.5, 13, 22, 26]) box(-23.2, 0.35, BZ + pz, 0.3, 0.7, 0.3, C.rebar);

  // a boxy little car, long dead
  box(-22.4, 0.62, BZ + 21, 2.0, 0.85, 4.4, "#8c9a7d");
  box(-22.4, 1.35, BZ + 21.3, 1.8, 0.7, 2.2, "#8c9a7d");
  for (const [wx2, wz2] of [[-1.0, -1.5], [1.0, -1.5], [-1.0, 1.5], [1.0, 1.5]]) {
    prop(-22.4 + wx2, 0.32, BZ + 21 + wz2, 0.3, 0.62, 0.62, C.monitor, { solid: false });
  }

  // ============================== the aircraft that came down on Blokk 4
  // It skidded in from the east and buried its nose through the shopfront. The
  // fuselage steps down as it goes, which makes it a climbable ramp from the
  // courtyard up onto the first floor - the reason it is laid out this way.
  const PLANE = "#e8ecf3", TRIM = "#2f5d9e";
  const hull = [
    [-21.5, 2.4, 3.4, 4.4, 3.6],     // tail, sitting high
    [-25.0, 2.1, 3.6, 3.8, 3.4],
    [-28.5, 1.8, 3.6, 3.2, 3.2],     // through the shopfront here
    [-32.0, 1.5, 3.6, 2.6, 3.3],   // meets the column, no slot
    [-35.0, 1.2, 2.8, 2.0, 2.4],     // nose, buried in the shop floor
  ];
  hull.forEach(([hx, hy, sx, sy, sz], i) => {
    box(hx, hy, BZ, sx, sy, sz, i === 4 ? "#d8d2c4" : PLANE);
    decal(hx, hy + sy / 2 - 0.5, BZ - sz / 2 - 0.06, sx * 0.95, 0.34, 0.12, TRIM);   // cheatline
    decal(hx, hy + sy / 2 - 0.5, BZ + sz / 2 + 0.06, sx * 0.95, 0.34, 0.12, TRIM);
    for (const wz of [-1, 1]) {                                                      // cabin windows
      for (let w = 0; w < 3; w++) {
        decal(hx - sx / 3 + w * (sx / 3), hy + sy / 2 - 0.95, BZ + wz * (sz / 2 + 0.05),
              0.22, 0.22, 0.1, C.window);
      }
    }
  });

  // tail fin and stabilisers
  box(-20.6, 6.2, BZ, 0.5, 3.6, 2.8, PLANE);
  decal(-20.35, 6.6, BZ, 0.12, 2.4, 1.8, TRIM);
  box(-20.6, 4.5, BZ, 0.5, 0.28, 7, PLANE);

  // the wing that stayed on: a walkable slab over the north courtyard
  box(-24.5, 2.3, BZ - 7, 5, 0.4, 10, PLANE);                   // clear of the outside stair
  box(-24.7, 1.15, BZ - 9.5, 2.4, 2.0, 2.4, C.slate);            // engine, under the wing
  prop(-24.7, 1.15, BZ - 10.8, 2.0, 1.7, 0.3, C.monitor, { solid: false });
  crooked(-23.0, 2.62, BZ - 11.6, 2.4, 0.14, 2.0, PLANE, [0.12, 0.2, -0.3]);   // torn winglet

  // the wing that did not: sheared off and lying in the yard
  crooked(-24.5, 0.7, BZ + 6.5, 9, 0.35, 3.4, PLANE, [0.05, 0.42, 0.12]);
  crooked(-21.8, 1.1, BZ + 9.6, 2.2, 1.8, 2.2, C.slate, [0.2, 0.3, 0.5]);      // its engine, thrown clear

  // debris and scorching
  for (let i = 0; i < 14; i++) {
    const a = i * 2.4;
    crooked(-27 + Math.cos(a) * (3 + i * 0.55), 0.2 + (i % 3) * 0.18, BZ + Math.sin(a) * (4 + i * 0.5),
            0.8 + (i % 3) * 0.5, 0.16, 0.6 + (i % 2) * 0.4,
            i % 3 ? PLANE : C.slate, [0.1 * (i % 4), a, 0.08 * (i % 5 - 2)]);
  }
  decal(-27.5, 0.2, BZ, 14, 0.06, 7, "#3a3632");                  // scorched apron
  decal(-30.4, 2.2, BZ, 0.1, 3.4, 3.4, "#2a2724");                // soot around the entry hole
  for (const [rx, rz] of [[-29.2, -2.6], [-29.2, 2.6], [-30.6, 0]]) {
    crooked(rx, 0.5, BZ + rz, 1.2, 1.0, 1.0, C.panelDark, [0.2, 0.4, 0.15]);   // blown-out panels
  }

  // service pipes along the base of the block
  prop(-29.7, 1.9, BZ, 0.3, 0.3, 18, C.rust, { solid: false });
  prop(-29.7, 0.9, BZ - 3, 0.24, 0.24, 12, C.rust, { solid: false });

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
      target: { id: "bookis-keep", hp: 126, points: 0, radius: 2.2 } },
    { file: "assets/bookis-logo.json", pos: [0, 5.4, 36], height: 0.9, depth: 0.3, spin: 0.9,
      target: { id: "bookis-post", hp: 90, points: 0, radius: 1.4 } },
    { file: "assets/norli-logo.json", pos: [0, 3.4, -wz - 0.5], height: 1.9, depth: 0.35, rotY: Math.PI },
    { file: "assets/norli-logo.json", pos: [0, 3.4, wz + 0.5], height: 1.9, depth: 0.35 },
    { file: "assets/norli-logo.json", pos: [0, 7.8, 0], height: 2.2, depth: 0.4, spin: 0.4,
      target: { id: "norli-roof", hp: 126, points: 0, radius: 2.0 } },
    { file: "assets/bookis-logo.json", pos: [0, 5.4, -22.85], height: 1.0, depth: 0.25 },
    // ARK's sign still hangs on the one wall left standing, but not straight
    { file: "assets/ark-logo.json", pos: [-30.9, 9.9, BZ + 1], height: 2.6, depth: 0.4,
      rotY: Math.PI / 2, rotZ: -0.09,
      target: { id: "ark-sign", hp: 108, points: 0, radius: 1.8 } },
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
    { pos: [-31.8, 9.6, BZ + 1], color: C.ark, intensity: 3.0, distance: 20, flicker: true },
    { pos: [-37, 3.1, BZ + 3], color: "#cfe6d8", intensity: 1.0, distance: 15, flicker: true },
    { pos: [-40, 3.1, BZ - 6], color: "#cfe6d8", intensity: 0.8, distance: 13 },
    { pos: [-27, 4.6, BZ - 4], color: C.sodium, intensity: 1.6, distance: 18, flicker: true },
    { pos: [-28, 2.4, BZ + 24], color: C.sodium, intensity: 0.9, distance: 10 },
    // fires still burning in the wreck
    { pos: [-29.5, 1.6, BZ], color: "#ff7326", intensity: 2.6, distance: 16, flicker: true },
    { pos: [-24.9, 1.8, BZ - 9.5], color: "#ff8a3d", intensity: 1.8, distance: 12, flicker: true },
  ];

  // =============================================================== effects
  // Animated client-side. bookRing: stock still orbiting where the roof gave in.
  // Paper caught in the updraught between the block and the courtyard wall.
  const PAPER = ["#d8cbb0", "#e8e4d6", "#c9c2ae", "#b9b3a0"];
  const effects = [
    { type: "bookRing", pos: [-26.5, 2.4, BZ - 1], radius: 3.4, count: 14, spin: 0.22, tilt: 0.06, colors: PAPER },
    { type: "bookRing", pos: [-26.5, 4.6, BZ - 1], radius: 2.0, count: 9, spin: -0.34, tilt: -0.12, colors: PAPER },
    { type: "bookRing", pos: [-24, 1.5, BZ + 13], radius: 1.4, count: 7, spin: 0.5, tilt: 0.2, colors: PAPER },
    // smoke off the wreck
    { type: "smoke", pos: [-29.6, 2.6, BZ], radius: 1.5, count: 16, rise: 4.5, spin: 0.16 },
    { type: "smoke", pos: [-24.9, 2.4, BZ - 9.5], radius: 1.1, count: 11, rise: 3.6, spin: -0.2 },
  ];

  // ================================================================= spawns
  // Spread across every zone and both heights so respawns are unpredictable.
  const spawns = [
    // park, north
    [-30, 0, -34], [30, 0, -34], [0, 0, -35], [-16, 0, -14], [16, 0, -14],
    // office, south
    [-34, 0, 30], [34, 0, 30], [0, 0, 35], [-12, 0, 28], [12, 0, 28],
    // plazas, east and west
    [-24, 0, -4], [35, 0, -14], [-20, 0, 27], [31, 0, 14],
    // mid-map flanks
    [-20, 0, -6], [20, 0, 6],
    // high ground
    [-9, 5.6, -6], [9, 5.6, 6],
    // ARK and the west end
    [-38, 0, 16], [-24, 0, -14], [-40, 0, 22], [-26, 0, 16],
    // outer street, along the new block
    [42, 0, 0], [0, 0, 43], [0, 0, -43], [42, 0, 28], [-43, 0, 34],
    // corners: where openings are drawn from
    [-43, 0, -36], [43, 0, -36], [-43, 0, 36], [43, 0, 36],
    [-36, 0, -43], [36, 0, -43], [-36, 0, 43], [36, 0, 43],
  ];

  // =============================================================== pickups
  // type: health | ammo | damage | speed
  const pickups = [
    { id: "h1", type: "health", pos: [0, 0.6, -20] },        // by the fountain
    { id: "h2", type: "health", pos: [0, 0.6, 27] },         // office, behind the pod
    { id: "a1", type: "ammo",   pos: [-38, 0.6, 4.5] },      // ARK shop floor, between the racks
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
