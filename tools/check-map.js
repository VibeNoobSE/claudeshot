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
