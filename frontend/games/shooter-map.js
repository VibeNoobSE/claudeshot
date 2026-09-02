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
  decal(0, 0.03, -28, 87.4, 0.06, 33.4, C.grass);              // north park lawn   (top 0.06)
  decal(0, 0.03, 28, 87.4, 0.06, 33.4, C.carpet);              // south office floor(top 0.06)
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
    const face = HALF - FACADE_D - 0.1;       // just proud of the inner face, never on it
    // The runs along x stop short of the corners, which the runs along z cover.
    // Overlapping both at the corner stacks two blocks in the same space and the
    // shared faces z-fight.
    const end = axis === "x" ? HALF - FACADE_D : HALF;
    let t = axis === "x" ? -HALF + FACADE_D : -HALF;
    let i = 0;
    while (t < end - 0.01) {
      const want = 7 + ((i * 7) % 3) * 3.5;               // 7 / 10.5 / 14
      const seg = Math.min(want, end - t);
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

  decal(0, 0.07, 0, SHOP_W - 0.8, 0.1, SHOP_D - 0.8, C.wood);  // shop floor, inside the walls
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
    prop(xSide, 2.8, 0, 0.36, 3.4, 8.8, C.glass, { opacity: 0.32 });
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
  stairs(wx + 6.85, 0, SHOP_H + 0.64, 6, 4, "x", -1, C.stone);  // flush to the wall, 4cm above the roof

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
  decal(MX, 0.32, MZ, MW - 1.2, 0.06, MD - 1.2, "#5b6c94");      // rug, clear of the sills

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
  // Only the east side keeps its glazing; the west side is open to the office,
  // which makes the room a place you can be pushed out of rather than a box.
  prop(MX + mwx, 2.4, MZ - 2.6, 0.36, 2.5, 3, C.glass, { opacity: 0.28 });
  prop(MX + mwx, 2.4, MZ + 2.6, 0.36, 2.5, 3, C.glass, { opacity: 0.28 });

  // boardroom table, chairs, whiteboard
  box(MX, 0.75, MZ, 5.5, 0.15, 2.4, C.desk);
  prop(MX, 0.4, MZ, 4.6, 0.66, 1.7, C.metal);                    // stops below the table top
  for (const [cx, cz] of [[-2, -2], [0, -2], [2, -2], [-2, 2], [0, 2], [2, 2]]) {
    prop(MX + cx, 0.75, MZ + cz, 0.6, 1.0, 0.6, C.cubicle);
  }
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

  // ===================== ARK — Blokk 4, with an airliner through the roof
  // A concrete-panel bookshop that an aircraft came down on. The plane is the
  // centrepiece and the level design: its fuselage steps upward from the nose,
  // so walking up the spine takes you from the shop floor out onto the roof.
  const BX = -36, BZ = -2;
  const BW = 16, BD = 28;                       // x -44..-28, z -16..12
  const WALL_TOP = 8;
  const bwx = BW / 2, bwz = BD / 2;

  decal(BX, 0.14, BZ, BW - 1.4, 0.08, BD - 1.4, C.concrete);
  decal(-24.5, 0.14, 0, 7, 0.08, 30, C.panelWorn);                 // courtyard apron

  // --- shell, torn open where the aircraft came through -----------------------
  // north gable: a hole ten metres wide punched through it
  box(-42.5, WALL_TOP / 2, BZ - bwz, 3, WALL_TOP, 0.6, C.panel);
  box(-29.5, WALL_TOP / 2, BZ - bwz, 3, WALL_TOP, 0.6, C.panel);
  box(BX, WALL_TOP - 1, BZ - bwz, 10, 2, 0.6, C.panel);            // what is left above it
  crooked(-39, 5.6, BZ - bwz + 0.5, 2.4, 2.2, 0.25, C.panelDark, [0.3, 0.15, 0.4]);
  crooked(-33.6, 5.2, BZ - bwz + 0.7, 2.0, 2.6, 0.25, C.panelDark, [-0.25, -0.2, -0.35]);

  // south gable with the way in
  box(-41, WALL_TOP / 2, BZ + bwz, 6, WALL_TOP, 0.6, C.panel);
  box(-31, WALL_TOP / 2, BZ + bwz, 6, WALL_TOP, 0.6, C.panel);
  box(BX, WALL_TOP - 1.6, BZ + bwz, 4, 4.8, 0.6, C.panel);

  // west wall, holed where the port wing struck
  box(-44.4, WALL_TOP / 2, BZ - 9.7, 0.8, WALL_TOP, 9.4, C.panelDark);
  box(-44.4, WALL_TOP / 2, BZ + 6.7, 0.8, WALL_TOP, 15.4, C.panelDark);
  box(-44.4, 1.4, BZ - 2, 0.8, 2.8, 6, C.panelDark);
  box(-44.4, 6.6, BZ - 2, 0.8, 2.8, 6, C.panelDark);

  // east wall: shopfront bays below, and the gash the starboard wing tore
  // mullions are ground-floor only and stand slightly proud of the wall above,
  // so no two faces share a plane
  for (const bz of [-13, -9.6, -5.8, 2.4, 6, 9.6]) {
    box(-28, 2.1, BZ + bz, 0.72, 4.2, 1.4, C.panelDark);
  }
  box(-28, 6.85, BZ - 3.2, 0.72, 2.1, 4, C.panelDark);             // above the gash
  box(-28, 1.1, BZ - 3.2, 0.72, 2.2, 4, C.panelDark);              // below it
  box(-28, 5.6, BZ + 4.2, 0.6, 4.8, 12, C.panel);                  // upper wall, south half
  box(-28, 5.6, BZ - 11.4, 0.6, 4.8, 5.2, C.panel);
  for (const wz of [-13, -9.6, 2.4, 6, 9.6]) {
    decal(-28.35, 5.8, BZ + wz, 0.12, 1.4, 1.2, C.window);
  }

  // frame carrying the (much larger) ARK sign above the parapet
  for (const fz of [0.5, 7.5]) box(-27.4, 10.4, BZ + fz, 0.35, 4.5, 0.35, C.rebar);
  box(-27.4, 12.5, BZ + 4, 0.35, 0.25, 7.4, C.rebar);

  // roof, with the tail through it
  box(-41.5, WALL_TOP + 0.2, BZ, 5, 0.4, BD, C.panelDark);
  box(-30.5, WALL_TOP + 0.2, BZ, 5, 0.4, BD, C.panelDark);
  box(BX, WALL_TOP + 0.2, BZ - 11, 6, 0.4, 6, C.panelDark);
  box(BX, WALL_TOP + 0.2, BZ + 11.5, 6, 0.4, 5, C.panelDark);
  for (const [pz, pw] of [[-bwz + 0.3, BW], [bwz - 0.3, BW]]) {
    box(BX, WALL_TOP + 0.9, BZ + pz, pw, 1, 0.5, C.panelWorn);
  }
  box(BX - bwx + 0.3, WALL_TOP + 0.9, BZ, 0.5, 1, BD, C.panelWorn);
  box(BX + bwx - 0.3, WALL_TOP + 0.9, BZ + 8, 0.5, 1, 12, C.panelWorn);
  crooked(-33.5, 8.6, BZ - 6, 3.4, 0.3, 3, C.panelDark, [0.22, 0.3, -0.16]);   // peeled roof panel

  // --- the aircraft -----------------------------------------------------------
  const PLANE = "#e8ecf3", PLANE2 = "#d5d9e0", TRIM = "#2f5d9e";
  // [z, centre height, radius] - the spine rises from nose to tail, and the tops
  // of these sections are the steps you walk up.
  const SECTIONS = [
    [-18.5, 1.0, 1.1], [-15.5, 1.6, 1.6], [-12.5, 2.3, 1.95], [-9.5, 3.0, 2.1],
    [-6.5, 3.8, 2.1], [-3.5, 4.6, 2.1], [-0.5, 5.4, 2.0], [2.5, 6.2, 1.8], [5.5, 7.0, 1.5],
  ];
  SECTIONS.forEach(([sz, sy, r], i) => {
    box(BX, sy, sz, 2 * r, 1.5 * r, 3.0, i % 2 ? PLANE : PLANE2);           // barrel
    box(BX, sy + 0.85 * r, sz, 1.4 * r, 0.6 * r, 3.0, i % 2 ? PLANE : PLANE2);  // crown
    box(BX, sy - 0.85 * r, sz, 1.4 * r, 0.6 * r, 3.0, i % 2 ? PLANE : PLANE2);  // belly
    decal(BX - r - 0.05, sy + 0.35 * r, sz, 0.12, 0.36, 2.8, TRIM);         // cheatline
    decal(BX + r + 0.05, sy + 0.35 * r, sz, 0.12, 0.36, 2.8, TRIM);
    if (i > 1 && i < 8) {                                                    // cabin windows
      for (const side of [-1, 1]) {
        for (let w = -1; w <= 1; w++) {
          decal(BX + side * (r + 0.05), sy + 0.62 * r, sz + w * 0.9, 0.1, 0.26, 0.26, "#1a2233");
        }
      }
    }
  });
  // cockpit glazing and nose
  for (const side of [-1, 1]) {
    decal(BX + side * 1.0, 1.35, -19.4, 0.12, 0.5, 1.0, "#1a2233");
  }
  decal(BX, 1.5, -20.0, 1.4, 0.5, 0.12, "#1a2233");

  // wings: port sheared at the wall, starboard driven out through the shopfront
  box(-40.4, 3.6, -5.5, 7.2, 0.5, 6, PLANE);
  box(-31.5, 3.6, -5.5, 9, 0.5, 5.9, PLANE);
  crooked(-22.6, 3.3, -5.5, 4.5, 0.4, 4.6, PLANE, [0.1, 0.22, -0.24]);       // torn outer panel
  box(-40, 2.5, -8.4, 2.8, 2.4, 3.4, C.slate);                               // engines
  box(-32, 2.5, -8.4, 2.8, 2.4, 3.4, C.slate);
  prop(-40, 2.5, -10.2, 2.4, 2.0, 0.3, "#1a2233", { solid: false });
  prop(-32, 2.5, -10.2, 2.4, 2.0, 0.3, "#1a2233", { solid: false });

  // tail: fin driven up through the roof, stabilisers either side
  box(BX, 10.2, 6.8, 0.7, 6.4, 4.4, PLANE);
  box(BX, 7.9, 6.8, 9, 0.4, 2.8, PLANE);
  decal(BX, 8.2, 6.8, 9.1, 0.24, 2.6, TRIM);

  // undercarriage, collapsed
  crooked(BX - 1.6, 0.6, -12, 0.9, 1.2, 0.9, C.slate, [0.4, 0.2, 0.5]);
  crooked(BX + 1.5, 0.5, -12.4, 0.9, 1.0, 0.9, C.slate, [-0.3, 0.5, -0.4]);

  // --- fire and wreckage ------------------------------------------------------
  for (const [fx, fy, fz, fs] of [[-40, 3.6, -8.4, 1.8], [-32, 3.6, -8.4, 1.8],
                                  [BX, 2.4, -13.5, 2.2], [BX - 2, 1.2, -9, 1.4]]) {
    prop(fx, fy, fz, fs, fs * 0.8, fs, "#ff7326", { solid: false });          // flame
    prop(fx, fy + fs * 0.5, fz, fs * 0.6, fs * 0.5, fs * 0.6, "#ffd873", { solid: false });
  }
  decal(BX, 0.19, -11.8, 12.6, 0.06, 15.2, "#3a3632");                       // scorched floor
  for (let i = 0; i < 16; i++) {
    const a = i * 2.3;
    crooked(BX + Math.cos(a) * (3.5 + i * 0.45), 0.22 + (i % 3) * 0.2, -10 + Math.sin(a) * (4 + i * 0.45),
            0.7 + (i % 3) * 0.5, 0.16, 0.55 + (i % 2) * 0.4,
            i % 3 ? PLANE : C.panelDark, [0.12 * (i % 4), a, 0.1 * (i % 5 - 2)]);
  }

  // --- what is left of the shop ----------------------------------------------
  for (const cx of [-41.5, -30.5]) {
    for (const cz of [4, 9]) box(cx, WALL_TOP / 2, BZ + cz, 0.7, WALL_TOP, 0.7, C.panelWorn);
  }
  function rack(x, z, len) {
    box(x, 1.05, z, 0.9, 2.1, len, C.slate);
    const spines = [C.book1, C.book2, C.book3, C.book4];
    for (let i = 0; i < Math.floor(len / 0.95); i++) {
      const off = -len / 2 + 0.5 + i * 0.95;
      prop(x, 1.5, z + off, 0.94, 0.42, 0.86, spines[i % 4], { solid: false });
      prop(x, 0.72, z + off, 0.94, 0.42, 0.86, spines[(i + 2) % 4], { solid: false });
    }
  }
  rack(-39.5, BZ + 8, 7);
  rack(-36, BZ + 8.5, 6);
  rack(-32.5, BZ + 8, 7);
  crooked(-38.5, 0.5, BZ + 2.5, 5, 0.9, 1.6, C.slate, [0, 0.12, 0.06]);      // crushed by the wing
  crooked(-33, 0.45, BZ + 1.5, 4.6, 0.85, 1.5, C.slate, [0, -0.16, -0.05]);
  box(-30.2, 0.55, BZ + 5, 2.4, 1.1, 3.4, C.slate);                          // counter
  const strewn = [C.book1, C.book2, C.book3, C.book4];
  for (let i = 0; i < 18; i++) {
    const a = i * 1.7;
    crooked(-36 + Math.cos(a) * (2 + (i % 5)), 0.13, BZ + 3 + Math.sin(a) * (1.5 + (i % 4)),
            0.5, 0.15, 0.34, strewn[i % 4], [0, a, 0.05 * (i % 3 - 1)]);
  }


  // --- courtyard --------------------------------------------------------------
  for (const ox of [-1.9, 1.9]) {
    box(-23.5 + ox, 1.1, 15, 0.22, 2.2, 0.22, C.rebar);
    box(-23.5 + ox, 1.1, 17.6, 0.22, 2.2, 0.22, C.rebar);
  }
  box(-23.5, 2.1, 16.3, 4.2, 0.16, 0.16, C.rebar);
  box(-23.5, 1.5, 16.3, 4.2, 0.14, 0.14, C.rebar);
  crooked(-24.1, 1.75, 16.3, 1.6, 0.06, 1.2, "#7d5a86", [0.06, 0, 0.04]);

  for (const ox of [-1.6, 1.6]) box(-23.5 + ox, 1.0, 21.5, 0.18, 2.0, 0.18, C.rust);
  box(-23.5, 1.95, 21.5, 3.6, 0.16, 0.16, C.rust);

  for (const [ox, oz, w, d] of [[0, -2.6, 6, 0.5], [0, 2.6, 6, 0.5], [-2.75, 0, 0.5, 5.7], [2.75, 0, 0.5, 5.7]]) {
    box(-24 + ox, 0.45, 8 + oz, w, 0.9, d, C.panelWorn);
  }
  decal(-24, 0.24, 8, 4.9, 0.1, 4.6, C.ash);
  crooked(-24, 0.7, 8, 0.8, 1.4, 0.8, C.panelWorn, [0.22, 0.3, 0.1]);

  box(-24.5, 1.4, 26, 3.2, 2.8, 3.2, C.paint);                               // kiosk
  box(-24.5, 2.95, 26, 3.8, 0.3, 3.8, C.slate);
  decal(-26.15, 1.6, 26, 0.12, 1.2, 2.0, C.window);
  crooked(-24.5, 3.5, 26, 2.4, 0.6, 0.14, C.ark, [0, 0, 0.07]);

  for (const pz of [13, 19, 24]) {
    box(-26.4, 0.4, pz, 1.4, 0.8, 2.6, C.panelWorn);
    prop(-26.4, 1.05, pz, 1.1, 0.66, 2.2, C.leaf, { solid: false });
  }
  box(-21.4, 0.62, 21, 2.0, 0.85, 4.4, "#8c9a7d");                           // the old car
  box(-21.4, 1.35, 21.3, 1.8, 0.7, 2.2, "#8c9a7d");

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
  scaffold(-38, -34); scaffold(38, 20);   // kept clear of buildings and of the wreck

  // stacked crates in the corners
  for (const [cx, cz] of [[-42, -40], [42, 40], [42, -40], [-42, 40]]) {
    box(cx, 1.1, cz, 2.2, 2.2, 2.2, C.wood);
    box(cx + (cx > 0 ? -1.9 : 1.9), 0.8, cz, 1.6, 1.6, 1.6, C.wood);
    box(cx, 2.9, cz, 1.6, 1.4, 1.6, C.rust);
  }

  // bus shelter on the south edge
  box(6, 1.4, 42, 6, 0.25, 2.6, C.metal);
  for (const ox of [-2.8, 2.8]) box(6 + ox, 1.4, 42, 0.36, 2.8, 2.4, C.glass, { opacity: 0.3 });
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
    { file: "assets/ark-logo.json", pos: [-27.4, 11.4, BZ + 4], height: 5.0, depth: 0.5,
      rotY: Math.PI / 2, rotZ: -0.07,
      target: { id: "ark-sign", hp: 108, points: 0, radius: 3.0 } },
    // and on the tail fin of the aircraft that came down on the place
    { file: "assets/ark-logo.json", pos: [-36.45, 10.6, 6.8], height: 3.2, depth: 0.15,
      rotY: -Math.PI / 2 },
    { file: "assets/ark-logo.json", pos: [-35.55, 10.6, 6.8], height: 3.2, depth: 0.15,
      rotY: Math.PI / 2 },
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
    { pos: [-27.4, 11.0, BZ + 4], color: C.ark, intensity: 3.2, distance: 22, flicker: true },
    { pos: [-36, 3.2, -13], color: "#ff7326", intensity: 3.4, distance: 20, flicker: true },
    { pos: [-40, 3.4, -8.4], color: "#ff8a3d", intensity: 2.2, distance: 14, flicker: true },
    { pos: [-32, 3.4, -8.4], color: "#ff8a3d", intensity: 2.2, distance: 14, flicker: true },
    { pos: [-36, 5.5, 2], color: "#cfe6d8", intensity: 0.9, distance: 16, flicker: true },
    { pos: [-24.5, 2.4, 26], color: C.sodium, intensity: 0.9, distance: 10 },
  ];

  // =============================================================== effects
  // Animated client-side. bookRing: stock still orbiting where the roof gave in.
  // Paper caught in the updraught between the block and the courtyard wall.
  const PAPER = ["#d8cbb0", "#e8e4d6", "#c9c2ae", "#b9b3a0"];
  const effects = [
    { type: "smoke", pos: [-36, 4.5, -13], radius: 2.4, count: 20, rise: 9, spin: 0.14 },
    { type: "smoke", pos: [-36, 9, 5], radius: 2.0, count: 16, rise: 8, spin: -0.1 },
    { type: "smoke", pos: [-40, 3.6, -8.4], radius: 1.2, count: 10, rise: 5, spin: 0.2 },
    { type: "smoke", pos: [-32, 3.6, -8.4], radius: 1.2, count: 10, rise: 5, spin: -0.22 },
    { type: "bookRing", pos: [-30, 3.0, -4], radius: 3.0, count: 12, spin: 0.2, tilt: 0.08, colors: PAPER },
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
    { id: "h1", type: "health", pos: [0, 0.6, -20] },        // by the castle gate
    { id: "h2", type: "health", pos: [0, 0.6, 27] },         // office, behind the pod
    { id: "s1", type: "speed",  pos: [3.2, 0.7, 0] },        // Norli aisle, between the shelves
    { id: "s2", type: "speed",  pos: [30, 0.6, 0] },         // east plaza
    { id: "p1", type: "shield", pos: [-38, 0.6, 4.5] },      // ARK shop floor, under the wreck
    { id: "p2", type: "shield", pos: [0, 6.4, 0] },          // Norli roof, out in the open
    { id: "d1", type: "damage", pos: [0, 9.4, -26] },        // castle keep roof - high risk
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
