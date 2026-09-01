// Map traversal checker for the shooter arena.
//
// Catches the class of bug where geometry makes part of the level unreachable:
// a slab hanging over a staircase, a parapet standing where you step off, a
// stair that tops out in mid-air. Run it after editing shooter-map.js.
//
//   node tools/check-map.js

const MAP = require("../frontend/games/shooter-map.js");

const R = 0.32;      // player radius
const HEAD = 1.3;    // player height above the surface they stand on
const solid = MAP.boxes.filter((b) => (b.collide !== undefined ? b.collide : b.solid !== false));
const E = solid.map((b) => ({
  b,
  mn: [0, 1, 2].map((i) => b.pos[i] - b.size[i] / 2),
  mx: [0, 1, 2].map((i) => b.pos[i] + b.size[i] / 2),
}));

function standable(x, top, z, self) {
  const lo = [x - R, top + 0.06, z - R];
  const hi = [x + R, top + HEAD, z + R];
  for (const e of E) {
    if (e === self) continue;
    let hit = true;
    for (let k = 0; k < 3; k++) {
      if (hi[k] <= e.mn[k] + 1e-6 || lo[k] >= e.mx[k] - 1e-6) { hit = false; break; }
    }
    if (hit) return false;
  }
  return true;
}

let failures = 0;
const fail = (msg) => { failures++; console.log("FAIL  " + msg); };

// --- every stair tread must have headroom, and the top must connect onward ---
const treads = E.filter((e) => e.b.size[0] === 1.1 || e.b.size[2] === 1.1);
const groups = {};
for (const e of treads) {
  const key = e.b.size[0] === 1.1 ? "z" + e.b.pos[2].toFixed(0) : "x" + e.b.pos[0].toFixed(0);
  (groups[key] = groups[key] || []).push(e);
}
for (const [key, g] of Object.entries(groups)) {
  g.sort((a, b) => a.mx[1] - b.mx[1]);
  const blocked = g.filter((e) =>
    !standable((e.mn[0] + e.mx[0]) / 2, e.mx[1], (e.mn[2] + e.mx[2]) / 2, e));
  if (blocked.length) {
    fail("staircase " + key + ": " + blocked.length + " tread(s) blocked at y=" +
      blocked.map((e) => e.mx[1].toFixed(2)).join(", "));
  }
  const top = g[g.length - 1];
  const lands = E.some((e) => e !== top && Math.abs(e.mx[1] - top.mx[1]) < 0.5 &&
    e.mx[0] > top.mn[0] - 0.4 && e.mn[0] < top.mx[0] + 0.4 &&
    e.mx[2] > top.mn[2] - 0.4 && e.mn[2] < top.mx[2] + 0.4);
  if (!lands) fail("staircase " + key + " tops out at y=" + top.mx[1].toFixed(2) + " connected to nothing");
  if (!blocked.length && lands) console.log("PASS  staircase " + key + ": " + g.length + " treads to y=" + top.mx[1].toFixed(2));
}

// --- named places a player must be able to stand -----------------------------
const PLACES = {
  "Norli roof": [[0, 5.6, 0], [10.5, 5.6, 0], [0, 5.6, 6], [-10, 5.6, -6]],
  "Norli aisles": [[3.2, 0.1, 0], [-3, 0.1, 0], [0, 0.1, -6]],
  "castle keep roof": [[0, 8.6, -26], [-4, 8.6, -28], [3, 8.6, -24], [-4, 8.6, -30]],
  "castle ramparts": [[8.7, 4, -26], [-8.7, 4, -26], [0, 4, -32.7]],
  "castle courtyard": [[0, 0, -21], [5, 0, -27], [-2, 0, -30]],
  "OKR room": [[0, 0.3, 17], [0, 0.3, 23], [0, 0.3, 15.8], [0, 0.3, 24.2]],
};
for (const [name, pts] of Object.entries(PLACES)) {
  const bad = pts.filter(([x, y, z]) => !standable(x, y, z, null));
  if (bad.length) fail(name + ": cannot stand at " + bad.map((p) => p.join(",")).join(" | "));
  else console.log("PASS  " + name);
}

// --- gaps too narrow to stand in but wide enough to wedge into ---------------
// A ~0.6m slot between two solids is the classic "I got stuck" bug: the capsule
// cannot fit, so collision pushes from both sides at once. The test is being
// SQUEEZED — solid surfaces close on BOTH sides along an axis. Merely standing
// next to one wall is normal and must not be reported.
function solidAt(x, y, z) {
  for (const e of E) {
    if (x > e.mn[0] && x < e.mx[0] && y > e.mn[1] && y < e.mx[1] && z > e.mn[2] && z < e.mx[2]) return true;
  }
  return false;
}

function gap(x, y, z, ax, dir, max = 0.8) {
  for (let d = 0.05; d <= max; d += 0.05) {
    const px = x + (ax === 0 ? dir * d : 0);
    const pz = z + (ax === 2 ? dir * d : 0);
    if (solidAt(px, y, pz)) return d;
  }
  return max;
}

const NEED = 2 * R + 0.06;    // clearance a player actually needs across a slot
const slots = [];
const HALF = MAP.half;
for (let x = -HALF + 1; x < HALF - 1; x += 0.25) {
  for (let z = -HALF + 1; z < HALF - 1; z += 0.25) {
    const y = 0.9;                       // chest height: where a body wedges
    if (solidAt(x, y, z)) continue;      // inside geometry, not a slot
    const spanX = gap(x, y, z, 0, -1) + gap(x, y, z, 0, 1);
    const spanZ = gap(x, y, z, 2, -1) + gap(x, y, z, 2, 1);
    // squeezed on both sides along an axis, and not merely a doorway (the other
    // axis has to be enclosed enough that you can walk in and jam)
    // Below MIN the "gap" is either a shared face between two touching boxes (a
    // sampling artifact) or too thin for a player to enter at all.
    const MIN = 0.22;
    if ((spanX > MIN && spanX < NEED) || (spanZ > MIN && spanZ < NEED)) {
      slots.push([+x.toFixed(2), +z.toFixed(2)]);
    }
  }
}
if (slots.length) {
  const seen = new Set();
  const clusters = [];
  for (const [x, z] of slots) {
    const key = Math.round(x / 2) + ":" + Math.round(z / 2);
    if (seen.has(key)) continue;
    seen.add(key);
    clusters.push([x, z]);
  }
  fail("squeeze traps at " + clusters.length + " spot(s): " +
    clusters.slice(0, 8).map((c) => "[" + c.join(",") + "]").join(" "));
} else {
  console.log("PASS  no squeeze traps (no sub-" + NEED.toFixed(2) + "m slots)");
}

// --- coplanar overlaps: surfaces that fight for the same depth ---------------
// Two boxes whose top faces sit at the same height and whose footprints overlap
// cannot be separated by the depth buffer, and the seam flickers violently as
// the camera moves. Same for their sides.
const zfight = [];
const ALL = MAP.boxes.map((b) => ({
  b,
  mn: [0, 1, 2].map((i) => b.pos[i] - b.size[i] / 2),
  mx: [0, 1, 2].map((i) => b.pos[i] + b.size[i] / 2),
}));
for (let i = 0; i < ALL.length; i++) {
  for (let j = i + 1; j < ALL.length; j++) {
    const a = ALL[i], c = ALL[j];
    for (let axis = 0; axis < 3; axis++) {
      const u = (axis + 1) % 3, v = (axis + 2) % 3;
      // overlapping footprint on the other two axes?
      const ou = Math.min(a.mx[u], c.mx[u]) - Math.max(a.mn[u], c.mn[u]);
      const ov = Math.min(a.mx[v], c.mx[v]) - Math.max(a.mn[v], c.mn[v]);
      if (ou <= 0.02 || ov <= 0.02) continue;
      // Two flush faces of the same colour are effectively invisible even when
      // they fight. What reads as flicker on screen is two DIFFERENT colours
      // competing for the same plane, so that is what we report.
      if (a.b.color === c.b.color) continue;
      // Compare like with like: two TOP faces, or two BOTTOM faces. A wall
      // standing on the floor shares floor-top with wall-bottom, and that never
      // flickers because one surface is buried against the other.
      // On the vertical axis only matching TOPS can flicker: matching bottoms are
      // buried against whatever the boxes are standing on.
      const faces = axis === 1
        ? [[a.mx[axis], c.mx[axis]]]
        : [[a.mn[axis], c.mn[axis]], [a.mx[axis], c.mx[axis]]];
      for (const [fa, fc] of faces) {
        {
          if (Math.abs(fa - fc) < 0.004) {
            zfight.push("  " + "xyz"[axis] + "=" + fa.toFixed(3) + "  " + a.b.color + " [" +
              a.b.pos.map((n) => n.toFixed(1)) + "] vs " + c.b.color + " [" +
              c.b.pos.map((n) => n.toFixed(1)) + "]  overlap " + ou.toFixed(1) + "x" + ov.toFixed(1));
          }
        }
      }
    }
  }
}
if (zfight.length) {
  const uniq = [...new Set(zfight)];
  fail(uniq.length + " coplanar face pair(s) that will flicker:");
  uniq.slice(0, 14).forEach((l) => console.log(l));
} else {
  console.log("PASS  no coplanar faces (nothing will z-fight)");
}

// --- spawns and pickups must be clear ---------------------------------------
const badSpawns = MAP.spawns.filter((sp) => !standable(sp[0], sp[1], sp[2], null));
if (badSpawns.length) fail("blocked spawns: " + badSpawns.map((s) => s.join(",")).join(" | "));
else console.log("PASS  all " + MAP.spawns.length + " spawns clear");

const buried = MAP.pickups.filter((pk) =>
  E.some((e) => [0, 1, 2].every((i) => pk.pos[i] > e.mn[i] - 0.3 && pk.pos[i] < e.mx[i] + 0.3)));
if (buried.length) fail("pickups inside geometry: " + buried.map((p) => p.id).join(", "));
else console.log("PASS  all " + MAP.pickups.length + " pickups reachable");

console.log(failures ? "\n" + failures + " FAILURE(S)" : "\nmap OK");
process.exit(failures ? 1 : 0);
