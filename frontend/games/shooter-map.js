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
  };

  // ---------------------------------------------------------------- BRAND
  // Bookis company branding for the castle landmark.
  // `color` is a PLACEHOLDER — replace it with the real brand hex.
  // If a real logo image is placed at frontend/assets/bookis-logo.png it is used
  // automatically for the spinning sign faces; otherwise the wordmark is drawn.
  const BRAND = {
    name: "BOOKIS",
    color: "#0e7c6b",
    accent: "#ffffff",
    dark: "#0a2f2a",
    texture: "assets/bookis-logo.png",
  };

  const HALF = 40;
  const WALL_H = 6;
  const boxes = [];
  const signs = [];

  function box(x, y, z, w, h, d, color, opts) {
    boxes.push(Object.assign({ pos: [x, y, z], size: [w, h, d], color }, opts || {}));
  }
  const decal = (x, y, z, w, h, d, color) => box(x, y, z, w, h, d, color, { solid: false, edges: false });
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
  decal(0, 0.03, -25, 74, 0.06, 28, C.grass);                  // north park lawn
  decal(0, 0.04, -25, 6, 0.06, 28, C.path);                    // path through the park
  decal(0, 0.03, 25, 74, 0.06, 28, C.carpet);                  // south office carpet
  decal(-30, 0.03, 0, 14, 0.06, 22, C.path);                   // west plaza
  decal(30, 0.03, 0, 14, 0.06, 22, C.path);                    // east plaza

  // perimeter: brick base with a tall hedge on top (unjumpable, still reads as outdoors)
  const per = [
    [0, -HALF, HALF * 2, 1], [0, HALF, HALF * 2, 1],
    [-HALF, 0, 1, HALF * 2], [HALF, 0, 1, HALF * 2],
  ];
  for (const [x, z, w, d] of per) {
    box(x, 1.5, z, w, 3, d, C.brick);
    box(x, 4.5, z, w === 1 ? 1.4 : w, 3, d === 1 ? 1.4 : d, C.hedge);
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
  box(wx + 0.2, SHOP_H + 1.2, 0, 0.5, 1.2, SHOP_D + 1, C.stone);

  sign(0, 3.3, -wz - 0.35, 9, 2, Math.PI, "NORLI", "#f7c948", C.signBg);
  sign(0, 3.3, wz + 0.35, 9, 2, 0, "NORLI", "#f7c948", C.signBg);
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

  // outdoor staircase up to the roof, on the east side
  stairs(wx + 1.6, 0, SHOP_H + 0.6, 6, 4, "x", 1, C.stone);
  box(wx + 0.9, SHOP_H + 0.3, 0, 1.6, 0.4, 4, C.stone);        // landing onto the roof

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

  decal(KX, 0.06, KZ, CW, 0.1, CD, C.stone);                        // courtyard
  box(KX, CWALL / 2, KZ - cwz, CW, CWALL, 1, C.stone);              // north wall
  box(KX - 5.5, CWALL / 2, KZ + cwz, 7, CWALL, 1, C.stone);         // south wall,
  box(KX + 5.5, CWALL / 2, KZ + cwz, 7, CWALL, 1, C.stone);         //   split for a gate
  box(KX, CWALL - 0.5, KZ + cwz, 4, 1, 1, C.stone);                 // gate arch
  box(KX - cwx, CWALL / 2, KZ, 1, CWALL, CD, C.stone);              // west wall
  box(KX + cwx, CWALL / 2, KZ, 1, CWALL, CD, C.stone);              // east wall

  // crenellations along the wall tops (cover for anyone on the ramparts)
  for (let i = -8; i <= 8; i += 2) {
    prop(KX + i, CWALL + 0.35, KZ - cwz, 1, 0.7, 1, C.stone);
    if (Math.abs(i) > 2) prop(KX + i, CWALL + 0.35, KZ + cwz, 1, 0.7, 1, C.stone);
  }
  for (let i = -6; i <= 6; i += 2) {
    prop(KX - cwx, CWALL + 0.35, KZ + i, 1, 0.7, 1, C.stone);
    prop(KX + cwx, CWALL + 0.35, KZ + i, 1, 0.7, 1, C.stone);
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
  box(KX, 8.3, KZ, 9, 0.6, 7, C.stone);
  for (const [ox, oz, w, d] of [[0, -3.6, 9, 0.5], [0, 3.6, 9, 0.5], [-4.6, 0, 0.5, 7], [4.6, 0, 0.5, 7]]) {
    box(KX + ox, 9.1, KZ + oz, w, 1, d, C.stone);                   // roof parapet
  }
  sign(KX, 5.4, KZ + 3.1, 6, 1.6, 0, BRAND.name, BRAND.accent, BRAND.color);

  // stair run up the west side of the courtyard, with a landing onto the ramparts
  stairs(KX - 6, KZ + 5.5, 8.6, 9, 3, "z", -1, C.stone);
  box(KX - 6, 8.6, KZ - 3, 3, 0.35, 4, C.stone);                    // bridge to the keep roof
  box(KX - 7.4, 4.2, KZ + 0.5, 2.2, 0.35, 2.2, C.stone);            // step-off onto the ramparts

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

  // glass meeting pod
  const MX = 0, MZ = 20;
  box(MX, 0.15, MZ, 11, 0.3, 8, C.white);
  for (const [ox, oz, w, d] of [[0, -4, 11, 0.3], [-5.5, 0, 0.3, 8], [5.5, 0, 0.3, 8]]) {
    prop(MX + ox, 1.6, MZ + oz, w, 3.2, d, C.glass, { solid: false, collide: true, opacity: 0.3 });
  }
  prop(MX - 3.6, 1.6, MZ + 4, 3.5, 3.2, 0.3, C.glass, { solid: false, collide: true, opacity: 0.3 });
  prop(MX + 3.6, 1.6, MZ + 4, 3.5, 3.2, 0.3, C.glass, { solid: false, collide: true, opacity: 0.3 });
  box(MX, 3.4, MZ, 11.4, 0.3, 8.4, C.white);
  box(MX, 0.65, MZ, 5, 0.15, 2.2, C.desk);
  prop(MX, 0.33, MZ, 4, 0.65, 1.6, C.metal);
  sign(MX, 3.9, MZ - 4.2, 5, 0.9, Math.PI, "MEETING", "#c9d2e3", "#1b2438");

  // plants, cooler, printer
  function plant(x, z) {
    prop(x, 0.35, z, 0.7, 0.7, 0.7, C.stone);
    prop(x, 1.1, z, 1.3, 1.2, 1.3, C.leaf, { solid: false });
  }
  plant(-10, 13); plant(10, 13); plant(-27, 28); plant(27, 28);
  box(-8, 0.7, 33, 0.9, 1.4, 0.9, C.white);   // water cooler
  box(8, 0.6, 33, 1.4, 1.2, 1, C.metal);      // printer

  // ============================================ east / west plaza furniture
  // west pergola — columns and beams, good cover lane
  for (const z of [-6, 0, 6]) {
    box(-26, 1.75, z, 0.5, 3.5, 0.5, C.wood);
    box(-34, 1.75, z, 0.5, 3.5, 0.5, C.wood);
  }
  box(-30, 3.7, 0, 9.5, 0.4, 14, C.wood, { edges: false });
  plant(-30, -9); plant(-30, 9);
  // east: pallets and crates by the stairs
  for (const [x, z, s] of [[27, -7, 1.6], [29.5, -7, 1.6], [27, -9.5, 1.6], [33, 6, 2.2], [30, 9, 1.6]]) {
    box(x, s / 2, z, s, s, s, C.wood);
  }
  box(34, 1.1, -2, 1, 2.2, 10, C.brick);

  // freestanding spinning logo on a post at the south entrance
  box(0, 2.2, 36, 0.5, 4.4, 0.5, C.metal, { edges: false });

  // ============================================================== landmarks
  // Animated client-side: these spin. Not collidable, not shootable.
  const landmarks = [
    { type: "logo", pos: [0, 11.6, -26], size: [6.4, 2.8, 0.5], spin: 0.5, ring: true },
    { type: "logo", pos: [0, 5.4, 36], size: [3.4, 1.5, 0.35], spin: 0.9, ring: false },
  ];

  // ================================================================= spawns
  const spawns = [
    [-30, 0, -34], [30, 0, -34], [-34, 0, 30], [34, 0, 30],
    [0, 0, -35], [0, 0, 35], [-35, 0, 8], [35, 0, -14],
    [-20, 0, -6], [20, 0, 6],
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
    landmarks,
    spawns,
    pickups,
  };
});
