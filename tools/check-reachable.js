// Finds places you can get into but not out of.
//
// Movement is directed: you can always drop down, but you can only climb about
// 1.5m. So a pit is not "unreachable" - it is reachable and inescapable, and a
// checker that only floods outward from the spawns will never see one. This
// floods twice over a directed graph:
//
//   canEnter - nodes reachable from a spawn, following edges forwards
//   canLeave - nodes from which a spawn is reachable, following edges backwards
//
// A trap is a node you can enter but not leave.
//
// The graph is multi-level: a column of space can hold several standable
// surfaces (courtyard floor, the stair above it, the roof above that), and
// collapsing them to one - say, the highest - makes a walled courtyard look like
// a rooftop and hides exactly the bugs this is meant to find.
//
//   node tools/check-reachable.js

const MAP = require("../frontend/games/shooter-map.js");

const STEP = 0.5;             // sampling resolution, metres
const R = 0.32;               // player radius
const HEAD = 1.3;             // headroom needed to stand
const CLIMB = 1.55;           // how far up a player can get from standing
const CEILING = 14;           // ignore surfaces above this
const HALF = MAP.half;

const solid = MAP.boxes.filter((b) => (b.collide !== undefined ? b.collide : b.solid !== false));
const boxes = solid.map((b) => ({
  mn: [0, 1, 2].map((i) => b.pos[i] - b.size[i] / 2),
  mx: [0, 1, 2].map((i) => b.pos[i] + b.size[i] / 2),
}));

const BUCKET = 4;
const buckets = new Map();
const bkey = (cx, cz) => cx + ":" + cz;
for (const b of boxes) {
  for (let cx = Math.floor((b.mn[0] - R) / BUCKET); cx <= Math.floor((b.mx[0] + R) / BUCKET); cx++) {
    for (let cz = Math.floor((b.mn[2] - R) / BUCKET); cz <= Math.floor((b.mx[2] + R) / BUCKET); cz++) {
      const k = bkey(cx, cz);
      if (!buckets.has(k)) buckets.set(k, []);
      buckets.get(k).push(b);
    }
  }
}
const near = (x, z) => buckets.get(bkey(Math.floor(x / BUCKET), Math.floor(z / BUCKET))) || [];

// every height a player could be standing at in this column, not just the top
function levelsAt(x, z) {
  const cols = near(x, z).filter((b) =>
    x + R > b.mn[0] && x - R < b.mx[0] && z + R > b.mn[2] && z - R < b.mx[2]);
  const candidates = [...new Set([0, ...cols.map((b) => b.mx[1])])].filter((t) => t <= CEILING);
  const out = [];
  for (const top of candidates) {
    const lo = top + 0.06, hi = top + HEAD;
    const blocked = cols.some((b) => b.mx[1] > lo + 1e-6 && b.mn[1] < hi - 1e-6);
    if (!blocked) out.push(top);
  }
  return out.sort((a, b) => a - b);
}

const N = Math.floor((HALF * 2) / STEP);
const toW = (i) => -HALF + i * STEP + STEP / 2;
const toI = (w) => Math.round((w + HALF - STEP / 2) / STEP);

const levels = [];
let nodeCount = 0;
for (let i = 0; i < N; i++) {
  levels.push([]);
  for (let j = 0; j < N; j++) {
    const ls = levelsAt(toW(i), toW(j));
    levels[i].push(ls);
    nodeCount += ls.length;
  }
}

const key = (i, j, l) => i + "," + j + "," + l;
const inB = (i, j) => i >= 0 && j >= 0 && i < N && j < N;
const NEIGHBOURS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

function flood(reverse) {
  const seen = new Set();
  const queue = [];
  for (const sp of MAP.spawns) {
    const i = toI(sp[0]), j = toI(sp[2]);
    if (!inB(i, j)) continue;
    levels[i][j].forEach((h, l) => {
      if (Math.abs(h - sp[1]) > 1.2) return;          // the level the spawn sits on
      seen.add(key(i, j, l));
      queue.push([i, j, l]);
    });
  }
  while (queue.length) {
    const [i, j, l] = queue.pop();
    const h = levels[i][j][l];
    for (const [di, dj] of NEIGHBOURS) {
      const ni = i + di, nj = j + dj;
      if (!inB(ni, nj)) continue;
      levels[ni][nj].forEach((nh, nl) => {
        const k = key(ni, nj, nl);
        if (seen.has(k)) return;
        // forwards: step from here to there. backwards: from there to here.
        if (!(reverse ? nh - h >= -CLIMB : nh - h <= CLIMB)) return;
        seen.add(k);
        queue.push([ni, nj, nl]);
      });
    }
  }
  return seen;
}

const canEnter = flood(false);
const canLeave = flood(true);

const stuck = [];
for (let i = 0; i < N; i++) {
  for (let j = 0; j < N; j++) {
    levels[i][j].forEach((h, l) => {
      const k = key(i, j, l);
      if (canEnter.has(k) && !canLeave.has(k)) stuck.push([toW(i), toW(j), h]);
    });
  }
}

const groups = [];
for (const [x, z, y] of stuck) {
  const g = groups.find((q) => Math.abs(q.x - x) < 5 && Math.abs(q.z - z) < 5 && Math.abs(q.y - y) < 2);
  if (g) { g.n++; g.x = (g.x * (g.n - 1) + x) / g.n; g.z = (g.z * (g.n - 1) + z) / g.n; }
  else groups.push({ x, z, y, n: 1 });
}

console.log("standable nodes:", nodeCount, "| can walk into:", canEnter.size, "| can get back out:", canLeave.size);
if (!groups.length) {
  console.log("PASS  everywhere you can get into, you can get out of");
  process.exit(0);
}
console.log("FAIL  " + groups.length + " place(s) you can get into and not out of:");
groups.sort((a, b) => b.n - a.n).forEach((g) =>
  console.log("   around [" + g.x.toFixed(1) + ", " + g.z.toFixed(1) + "] standing at y=" + g.y.toFixed(2) +
    "  (" + (g.n * STEP * STEP).toFixed(1) + " m2)"));
process.exit(1);
