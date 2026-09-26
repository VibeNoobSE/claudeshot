// Eye of Ark - shared course definition.
// Loaded by BOTH the browser (window.EYE_COURSE) and the Node server (require),
// so client physics and server refereeing always agree on the same course.
//
// The race is Fall Mountain around Barad-dur: a spiral of candy-coloured
// platforms winds up around the tower, over a lava lake, to a summit deck on
// top of the tower where the burning Ark crown floats beneath the Eye.
//
// Coordinates: y is up, the tower stands on the y axis. Azimuth phi is
// measured as atan2(z, x). Runners travel towards increasing phi.
//
// Everything that moves is a pure function of the race clock `rt`
// (milliseconds since GO, negative during the countdown). Nothing about the
// course needs to be synchronised: every client computes the same obstacles
// from the same clock.
//
// Path frame. pathPoint(s) gives the centre line of the course at distance s:
//   forward - direction of travel (horizontal, unit)
//   side    - horizontal unit vector pointing TOWARDS THE TOWER (inward).
//             A positive lateral offset is towards the tower.
//   yaw     - rotation.y that turns a mesh's local +z to `forward`
//
// Piece schema (static solids; everything is collidable unless collide:false):
//   { id, shape: "box", pos:[x,y,z] centre, size:[w,h,d] (w across, h up,
//     d along forward), rot:[pitch, yaw] applied as Euler order "YXZ",
//     style, shelter? }
//   { id, shape: "cyl", pos:[x,y,z] centre, radius, height, style, shelter? }
// Styles: start, path, checkpoint, bridge, disc, post, stone, arch, wall,
//         summit, pedestal, horn
// shelter:true pieces block the Eye's gaze (the client raycasts from EYE_POS).

(function (root, factory) {
  const course = factory();
  if (typeof module === "object" && module.exports) module.exports = course;
  else root.EYE_COURSE = course;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const TAU = Math.PI * 2;

  // ---------------------------------------------------------------- timing
  const LOAD_TIMEOUT_MS = 15000;       // longest the race waits for a slow loader
  const COUNTDOWN_MS = 20000;          // slow Mario Kart-style intro, then 3-2-1-GO
  const ROUND_MS = 240000;             // 4 minutes to reach the crown
  const WIN_HOLD_MS = 5000;            // celebration after the crown is taken
  const END_SCREEN_MS = 8000;          // in-game results before the platform takes over

  // ---------------------------------------------------------------- player
  const PLAYER = {
    radius: 0.45,
    height: 1.75,                      // feet to top of head
    reach: 1.7,                        // grab / dive-bump reach, centre to centre
  };

  // ---------------------------------------------------------------- world
  const LAVA_Y = -14;
  const TOWER_PROFILE = [              // [y, radius] of the tower body - scenery
    [-14, 27], [0, 20], [20, 14.5], [40, 9.5],
  ];
  function towerRadiusAt(y) {
    const P = TOWER_PROFILE;
    if (y <= P[0][0]) return P[0][1];
    for (let i = 1; i < P.length; i++) {
      if (y <= P[i][0]) {
        const t = (y - P[i - 1][0]) / (P[i][0] - P[i - 1][0]);
        return P[i - 1][1] + (P[i][1] - P[i - 1][1]) * t;
      }
    }
    return P[P.length - 1][1];
  }

  // ---------------------------------------------------------------- spiral
  // A spiral that tightens as it climbs: radius R0 at the start down to R1 at
  // the top. phi is chosen so that s is arc length (dphi/ds = 1/R).
  const SPIRAL_LEN = 300;
  const R0 = 46, R1 = 22;
  const PHI0 = Math.PI / 2;            // the start plaza sits on +z
  const K = SPIRAL_LEN / (R1 - R0);
  const DR = (R1 - R0) / SPIRAL_LEN;   // dR/ds
  function spiralR(s) { return R0 + DR * s; }
  function spiralPhi(s) { return PHI0 + K * Math.log(spiralR(s) / R0); }
  const PHI_END = spiralPhi(SPIRAL_LEN);

  // After the spiral, a straight bridge runs radially inward to the summit
  // deck on top of the tower, and the path ends at the crown on the axis.
  const SUMMIT_Y = 40;
  const SUMMIT = {
    y: SUMMIT_Y,
    radius: 9.5,
    bridgePhi: PHI_END,
    hornPhi: [PHI_END + Math.PI / 2, PHI_END - Math.PI / 2],
    hornRing: 8.3,                     // horn bases stand on this radius
    hornBaseRadius: 1.8,
  };
  const PATH_END = SPIRAL_LEN + R1;    // the crown, on the axis
  const PEDESTAL_TOP = SUMMIT_Y + 0.9;
  const CROWN = { pos: [0, SUMMIT_Y + 2.8, 0], reach: 2.2 };   // jump to grab it
  const EYE_POS = [0, 58, 0];

  // Floor height keyframes along s. Piecewise linear.
  const FLOOR = [
    [0, 0], [22, 0], [70, 11], [102.5, 11], [107.5, 12.5], [120.5, 12.5],
    [125.5, 14], [150, 14], [188, 18.6], [202, 18.6], [250, 29], [262, 29],
    [300, SUMMIT_Y], [PATH_END, SUMMIT_Y],
  ];
  function floorAt(s) {
    if (s <= FLOOR[0][0]) return FLOOR[0][1];
    for (let i = 1; i < FLOOR.length; i++) {
      if (s <= FLOOR[i][0]) {
        const t = (s - FLOOR[i - 1][0]) / (FLOOR[i][0] - FLOOR[i - 1][0]);
        return FLOOR[i - 1][1] + (FLOOR[i][1] - FLOOR[i - 1][1]) * t;
      }
    }
    return FLOOR[FLOOR.length - 1][1];
  }

  function pathPoint(s) {
    let x, z, fx, fz, r, phi;
    if (s <= SPIRAL_LEN) {
      r = spiralR(s);
      phi = spiralPhi(s);
      const c = Math.cos(phi), sn = Math.sin(phi);
      x = r * c;
      z = r * sn;
      fx = DR * c - sn;
      fz = DR * sn + c;
      const len = Math.hypot(fx, fz);
      fx /= len; fz /= len;
    } else {
      phi = PHI_END;
      r = Math.max(0, R1 - (s - SPIRAL_LEN));
      x = r * Math.cos(phi);
      z = r * Math.sin(phi);
      fx = -Math.cos(phi);
      fz = -Math.sin(phi);
    }
    return {
      x, y: floorAt(s), z, r, phi,
      forward: [fx, 0, fz],
      side: [-fz, 0, fx],             // inward, towards the tower
      yaw: Math.atan2(fx, fz),
      width: widthAt(s),
    };
  }

  // A point at distance s, `lateral` metres towards the tower, `up` above the floor.
  function pathOffset(s, lateral, up) {
    const p = pathPoint(s);
    return [p.x + p.side[0] * lateral, p.y + (up || 0), p.z + p.side[2] * lateral];
  }

  // ---------------------------------------------------------------- sections
  // kind "walk" becomes a strip of chord boxes; the rest are built specially.
  const DISC_R = 6.5;
  const DISCS = [96, 114, 132];
  const STONES = [
    { s: 154, lat: 0 }, { s: 159, lat: 1.6 }, { s: 164, lat: -1.4 }, { s: 169, lat: 1.2 },
    { s: 174, lat: -1.6 }, { s: 179, lat: 1.4 }, { s: 184, lat: 0 },
  ];
  const STONE_R = 1.7;
  const SECTIONS = [
    { name: "start",      from: 0,     to: 22,    kind: "walk",   width: 18,  style: "start" },
    { name: "boulders",   from: 22,    to: 70,    kind: "walk",   width: 11,  style: "path" },
    { name: "cp1",        from: 70,    to: 84,    kind: "walk",   width: 14,  style: "checkpoint" },
    { name: "bridge",     from: 84,    to: 89.5,  kind: "walk",   width: 5,   style: "bridge" },
    { name: "disc1",      from: 89.5,  to: 102.5, kind: "disc",   width: 13 },
    { name: "bridge",     from: 102.5, to: 107.5, kind: "walk",   width: 5,   style: "bridge" },
    { name: "disc2",      from: 107.5, to: 120.5, kind: "disc",   width: 13 },
    { name: "bridge",     from: 120.5, to: 125.5, kind: "walk",   width: 5,   style: "bridge" },
    { name: "disc3",      from: 125.5, to: 138.5, kind: "disc",   width: 13 },
    { name: "ledge",      from: 138.5, to: 150,   kind: "walk",   width: 8,   style: "path" },
    { name: "stones",     from: 150,   to: 188,   kind: "stones", width: 6 },
    { name: "cp2",        from: 188,   to: 202,   kind: "walk",   width: 14,  style: "checkpoint" },
    { name: "pendulums",  from: 202,   to: 250,   kind: "walk",   width: 4.5, style: "bridge" },
    { name: "cp3",        from: 250,   to: 262,   kind: "walk",   width: 14,  style: "checkpoint" },
    { name: "final",      from: 262,   to: 300,   kind: "walk",   width: 9,   style: "path" },
    { name: "summitBridge", from: 300, to: 313,   kind: "walk",   width: 6,   style: "bridge" },
    { name: "summit",     from: 313,   to: PATH_END, kind: "summit", width: 19 },
  ];
  function sectionAt(s) {
    for (const sec of SECTIONS) if (s >= sec.from && s < sec.to) return sec;
    return s < 0 ? SECTIONS[0] : SECTIONS[SECTIONS.length - 1];
  }
  function widthAt(s) { return sectionAt(s).width; }

  // ---------------------------------------------------------------- pieces
  const pieces = [];
  let pieceId = 0;
  const THICK = 1.0;

  function addBoxBetween(sa, sb, width, style, extra) {
    const a = pathPoint(sa), b = pathPoint(sb);
    const dx = b.x - a.x, dz = b.z - a.z, dy = b.y - a.y;
    const horiz = Math.hypot(dx, dz);
    const yaw = Math.atan2(dx, dz);
    const pitch = -Math.atan2(dy, horiz);
    const len = Math.hypot(horiz, dy) + 0.5;           // overlap hides chord seams
    // the box's local up after Euler "YXZ" (pitch, then yaw)
    const up = [Math.sin(pitch) * Math.sin(yaw), Math.cos(pitch), Math.sin(pitch) * Math.cos(yaw)];
    const mid = [(a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2];
    pieces.push(Object.assign({
      id: "p" + (pieceId++),
      shape: "box",
      pos: [mid[0] - up[0] * THICK / 2, mid[1] - up[1] * THICK / 2, mid[2] - up[2] * THICK / 2],
      size: [width, THICK, len],
      rot: [pitch, yaw],
      style,
    }, extra || {}));
  }

  function addWalk(sec) {
    const n = Math.max(1, Math.ceil((sec.to - sec.from) / 3));
    for (let i = 0; i < n; i++) {
      const sa = sec.from + (sec.to - sec.from) * (i / n);
      const sb = sec.from + (sec.to - sec.from) * ((i + 1) / n);
      addBoxBetween(sa, sb, sec.width, sec.style);
    }
  }

  // A roofed arch across the path. The roof (and posts) hide you from the Eye.
  function addShelter(sa, sb, name) {
    const mid = (sa + sb) / 2;
    const p = pathPoint(mid);
    const w = Math.max(widthAt(sa), widthAt(sb)) + 1;
    const floorTop = Math.max(floorAt(sa), floorAt(sb));
    const roofY = floorTop + 4.6;
    pieces.push({
      id: "sh-" + name, shape: "box",
      pos: [p.x, roofY, p.z], size: [w, 0.6, sb - sa], rot: [0, p.yaw],
      style: "arch", shelter: true, cover: [sa, sb],
    });
    // The Eye looks down on the path from the tower's axis, and near the top it
    // is almost overhead, so a roof alone leaves the tower side of the path in
    // plain sight. A solid wall on the tower side closes that gap: every ray
    // from the Eye to someone underneath has to cross the wall or the roof.
    const floorLow = Math.min(floorAt(sa), floorAt(sb));
    const wallH = roofY - floorLow + 0.2;
    pieces.push({
      id: "shw-" + name, shape: "box",
      pos: [p.x + p.side[0] * (w / 2 - 0.35), floorLow + wallH / 2 - 0.3, p.z + p.side[2] * (w / 2 - 0.35)],
      size: [0.7, wallH, sb - sa], rot: [0, p.yaw],
      style: "arch", shelter: true,
    });
    for (const s of [sa + 0.5, sb - 0.5]) {
      const q = pathPoint(s);
      for (const lat of [-(w / 2 - 0.5), w / 2 - 0.5]) {
        const base = q.y;
        const h = roofY - 0.3 - base;
        pieces.push({
          id: "shp-" + name + "-" + s.toFixed(1) + "-" + (lat > 0 ? "i" : "o"),
          shape: "box",
          pos: [q.x + q.side[0] * lat, base + h / 2, q.z + q.side[2] * lat],
          size: [0.8, h, 0.8], rot: [0, q.yaw], style: "arch", shelter: true,
        });
      }
    }
  }

  for (const sec of SECTIONS) {
    if (sec.kind === "walk") addWalk(sec);
  }

  // back wall behind the start grid, so nobody backs off the plaza at GO
  {
    const p = pathPoint(0);
    pieces.push({
      id: "startwall", shape: "box",
      pos: [p.x - p.forward[0] * 0.5, 1.5, p.z - p.forward[2] * 0.5],
      size: [18, 3, 1], rot: [0, p.yaw], style: "wall",
    });
  }

  // spin discs, each with a post in the middle that carries the sweeper bar
  DISCS.forEach((s, i) => {
    const p = pathPoint(s);
    pieces.push({
      id: "disc" + (i + 1), shape: "cyl",
      pos: [p.x, p.y - THICK / 2, p.z], radius: DISC_R, height: THICK, style: "disc",
    });
    pieces.push({
      id: "post" + (i + 1), shape: "cyl",
      pos: [p.x, p.y + 0.7, p.z], radius: 0.6, height: 1.4, style: "post",
    });
  });

  // stepping stones: tall columns rising out of the lava
  STONES.forEach((st, i) => {
    const q = pathPoint(st.s);
    const top = floorAt(st.s);
    const h = 8;
    pieces.push({
      id: "stone" + (i + 1), shape: "cyl",
      pos: [q.x + q.side[0] * st.lat, top - h / 2, q.z + q.side[2] * st.lat],
      radius: STONE_R, height: h, style: "stone",
    });
  });

  // summit deck on top of the tower, the crown pedestal, and the horn bases
  pieces.push({
    id: "summit", shape: "cyl", pos: [0, SUMMIT_Y - 1.5, 0],
    radius: SUMMIT.radius, height: 3, style: "summit",
  });
  pieces.push({
    id: "pedestal", shape: "cyl", pos: [0, SUMMIT_Y + 0.45, 0],
    radius: 1.3, height: 0.9, style: "pedestal",
  });
  SUMMIT.hornPhi.forEach((phi, i) => {
    pieces.push({
      id: "horn" + (i + 1), shape: "cyl",
      pos: [Math.cos(phi) * SUMMIT.hornRing, SUMMIT_Y + 3.5, Math.sin(phi) * SUMMIT.hornRing],
      radius: SUMMIT.hornBaseRadius, height: 7, style: "horn",
    });
  });

  // shelters: every checkpoint, plus a few along the way
  addShelter(44, 50, "ramp");
  addShelter(73, 81, "cp1");
  addShelter(190, 200, "cp2");
  addShelter(252, 260, "cp3");
  addShelter(278, 284, "final");

  // pendulum gantries: two posts and a crossbeam with a short roof on top.
  // Not shelters: the pendulums swing through where a tower-side wall would go,
  // and without one the Eye sees straight under the roof.
  const GANTRIES = [210, 222, 234, 246];
  GANTRIES.forEach((s, i) => {
    const q = pathPoint(s);
    const top = q.y + 7.6;
    for (const lat of [-3.3, 3.3]) {
      pieces.push({
        id: "gp" + i + (lat > 0 ? "i" : "o"), shape: "box",
        pos: [q.x + q.side[0] * lat, (q.y - 1 + top) / 2, q.z + q.side[2] * lat],
        size: [0.7, top - q.y + 1, 0.7], rot: [0, q.yaw], style: "arch",
      });
    }
    pieces.push({
      id: "groof" + i, shape: "box",
      pos: [q.x, top + 0.35, q.z], size: [7.6, 0.7, 2.4], rot: [0, q.yaw],
      style: "arch",
    });
  });

  // ---------------------------------------------------------------- checkpoints
  function gridSpawns(sFront, rows, lats) {
    const out = [];
    for (let r = 0; r < rows; r++) {
      for (const lat of lats) out.push(pathOffset(sFront - r * 2.6, lat, 0.05));
    }
    return out;
  }
  const CHECKPOINTS = [
    { index: 0, name: "START", s: 0,   spawns: gridSpawns(11, 2, [-6, -2, 2, 6]) },
    { index: 1, name: "CHECKPOINT 1", s: 72,  spawns: gridSpawns(79, 2, [-4.5, -1.5, 1.5, 4.5]) },
    { index: 2, name: "CHECKPOINT 2", s: 189, spawns: gridSpawns(197, 2, [-4.5, -1.5, 1.5, 4.5]) },
    { index: 3, name: "CHECKPOINT 3", s: 251, spawns: gridSpawns(258, 2, [-4.5, -1.5, 1.5, 4.5]) },
  ].map((cp) => Object.assign(cp, { yaw: pathPoint(cp.s + 4).yaw, pos: pathOffset(cp.s + 4, 0, 0) }));

  // ---------------------------------------------------------------- hazards
  // Every hazard is a function of the race clock. hazardPose(h, rt) returns
  //   { colliders: [{type:"sphere", c:[x,y,z], r} | {type:"capsule", a, b, r}],
  //     ...visual pose (angle, balls) }
  // and h.knock is how hard it launches a Bookis (m/s).
  const hazards = [];
  hazards.push({
    id: "boulders1", kind: "boulders", from: 69, to: 23, lanes: [-3.4, 0, 3.4],
    period: 5200, stagger: 1700, speed: 8, radius: 1.25, knock: 13,
  });
  DISCS.forEach((s, i) => {
    const p = pathPoint(s);
    hazards.push({
      id: "bar" + (i + 1), kind: "bar",
      center: [p.x, p.y + 0.6, p.z], length: 12.6, radius: 0.32,
      omega: [1.2, -1.5, 1.85][i], phase: [0, 1.0, 2.1][i], knock: 11,
    });
  });
  GANTRIES.forEach((s, i) => {
    const q = pathPoint(s);
    hazards.push({
      id: "pendulum" + (i + 1), kind: "pendulum",
      pivot: [q.x, q.y + 7.6, q.z], swing: q.side.slice(), yaw: q.yaw,
      length: 6.4, radius: 1.05, amp: 1.0,
      period: [2800, 3100, 2600, 3300][i], phase: [0, 1.7, 3.4, 5.0][i], knock: 15,
    });
  });
  hazards.push({
    id: "boulders2", kind: "boulders", from: 299, to: 263, lanes: [-2.3, 2.3],
    period: 4400, stagger: 2200, speed: 9, radius: 1.3, knock: 14,
  });

  function hazardPose(h, rt) {
    const t = rt / 1000;
    if (h.kind === "bar") {
      const angle = h.phase + h.omega * t;
      const dx = Math.cos(angle) * h.length / 2, dz = Math.sin(angle) * h.length / 2;
      const c = h.center;
      return {
        angle,
        colliders: [{ type: "capsule", a: [c[0] - dx, c[1], c[2] - dz], b: [c[0] + dx, c[1], c[2] + dz], r: h.radius }],
      };
    }
    if (h.kind === "pendulum") {
      const angle = h.amp * Math.sin(TAU * rt / h.period + h.phase);
      const off = Math.sin(angle) * h.length, down = Math.cos(angle) * h.length;
      const p = h.pivot;
      const bob = [p[0] + h.swing[0] * off, p[1] - down, p[2] + h.swing[2] * off];
      return {
        angle,
        colliders: [
          { type: "sphere", c: bob, r: h.radius },
          { type: "capsule", a: p.slice(), b: bob, r: 0.18 },
        ],
      };
    }
    if (h.kind === "boulders") {
      const travelMs = (h.from - h.to) / h.speed * 1000;
      const balls = [];
      h.lanes.forEach((lat, i) => {
        const off = i * h.stagger;
        const nFirst = Math.ceil((rt - off - travelMs) / h.period);
        const nLast = Math.floor((rt - off) / h.period);
        for (let n = nFirst; n <= nLast; n++) {
          const age = rt - (n * h.period + off);
          const dist = h.speed * age / 1000;
          const s = h.from - dist;
          const c = pathOffset(s, lat, h.radius);
          balls.push({ id: i + ":" + n, c, roll: dist / h.radius, s });
        }
      });
      return { balls, colliders: balls.map((b) => ({ type: "sphere", c: b.c, r: h.radius })) };
    }
    return { colliders: [] };
  }

  // ---------------------------------------------------------------- the Eye
  // The gaze is a lighthouse beam that sweeps AGAINST the runners, so you see
  // it coming. It opens after warmMs, then in every cycle it burns for
  // activeMs and closes for the rest, flickering for warnMs before reopening.
  const GAZE = {
    warmMs: 8000,
    cycleMs: 20000,
    activeMs: 14000,
    warnMs: 1500,
    omega: -TAU / 14,                  // rad/s: one full turn per burning window
    phi0: PHI0 + 1.2,
    halfWidth: 0.17,                   // radians either side of the beam centre
    minRadius: 11,                     // it cannot see straight down its own tower
    knock: { back: 9, up: 7, out: 2 }, // m/s: back down the path, up, and away from the tower
    cooldownMs: 1500,                  // one knock per pass
  };

  function gazeAt(rt) {
    const phi = GAZE.phi0 + GAZE.omega * rt / 1000;
    if (rt < GAZE.warmMs) {
      const k = rt < 0 ? 0.15 : 0.15 + 0.5 * (rt / GAZE.warmMs);
      return { phi, active: false, intensity: k, halfWidth: GAZE.halfWidth };
    }
    const cyc = (rt - GAZE.warmMs) % GAZE.cycleMs;
    if (cyc < GAZE.activeMs) return { phi, active: true, intensity: 1, halfWidth: GAZE.halfWidth };
    const untilOpen = GAZE.cycleMs - cyc;
    if (untilOpen < GAZE.warnMs) {
      const flicker = 0.35 + 0.35 * (0.5 + 0.5 * Math.sin(rt / 45));
      return { phi, active: false, intensity: flicker, warning: true, halfWidth: GAZE.halfWidth };
    }
    return { phi, active: false, intensity: 0.12, halfWidth: GAZE.halfWidth };
  }

  function azimuth(x, z) { return Math.atan2(z, x); }
  function angleDiff(a, b) {
    let d = (a - b) % TAU;
    if (d > Math.PI) d -= TAU;
    if (d < -Math.PI) d += TAU;
    return d;
  }

  // Is this point inside the burning wedge? Ignores shelters: the client
  // raycasts from EYE_POS against shelter pieces for that.
  function inGaze(x, _y, z, rt) {
    const g = gazeAt(rt);
    if (!g.active) return false;
    if (Math.hypot(x, z) < GAZE.minRadius) return false;
    return Math.abs(angleDiff(azimuth(x, z), g.phi)) < g.halfWidth;
  }

  // ---------------------------------------------------------------- progress
  const SAMPLE_STEP = 0.5;
  const samples = [];
  for (let s = 0; s <= PATH_END + 1e-6; s += SAMPLE_STEP) {
    const p = pathPoint(s);
    samples.push({ s, x: p.x, y: p.y, z: p.z, side: p.side });
  }

  // Nearest point on the course centre line. Height counts too, so a Bookis
  // who fell off one lap is never credited with the lap above.
  function progressAt(x, y, z) {
    let best = samples[0], bestD = Infinity;
    for (const q of samples) {
      const dx = x - q.x, dy = y - q.y, dz = z - q.z;
      const d = dx * dx + dz * dz + dy * dy;
      if (d < bestD) { bestD = d; best = q; }
    }
    const lateral = (x - best.x) * best.side[0] + (z - best.z) * best.side[2];
    return { s: best.s, lateral, floorY: best.y, dist: Math.sqrt(bestD) };
  }

  // Off the course and not coming back: in the lava, or well below the floor.
  function isFallen(x, y, z) {
    if (y < LAVA_Y + 2) return true;
    return y < progressAt(x, y, z).floorY - 10;
  }

  return {
    LOAD_TIMEOUT_MS, COUNTDOWN_MS, ROUND_MS, WIN_HOLD_MS, END_SCREEN_MS,
    PLAYER, LAVA_Y, TOWER_PROFILE, towerRadiusAt,
    SUMMIT, CROWN, EYE_POS, PEDESTAL_TOP, PATH_END, SPIRAL_LEN,
    SECTIONS, sectionAt, floorAt, widthAt, pathPoint, pathOffset,
    pieces, CHECKPOINTS, hazards, hazardPose,
    GAZE, gazeAt, inGaze, azimuth, angleDiff,
    progressAt, isFallen,
  };
});
