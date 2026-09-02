// Finds places you can fall into but not climb out of.
//
// The squeeze-trap check in check-map.js catches gaps too narrow to stand in.
// This catches the opposite problem: a pocket you fit in perfectly well, with
// walls too high to get back over. Falling behind a staircase is the classic
// case. It floods the walkable ground outward from the spawns, allowing steps
// and jumps up and free movement down, and reports standable ground the flood
// never reaches.
//
//   node tools/check-reachable.js

const MAP = require("../frontend/games/shooter-map.js");

const STEP = 0.5;             // sampling resolution, metres
const R = 0.32;               // player radius
const HEAD = 1.3;             // headroom needed to stand
const CLIMB = 1.55;           // how far up a player can get (jump from standing).
                              // Drop to 0.7 to find places that need a precise
                              // jump to leave, rather than only true traps.
const HALF = MAP.half;

const solid = MAP.boxes.filter((b) => (b.collide !== undefined ? b.collide : b.solid !== false));
const boxes = solid.map((b) => ({
  mn: [0, 1, 2].map((i) => b.pos[i] - b.size[i] / 2),
  mx: [0, 1, 2].map((i) => b.pos[i] + b.size[i] / 2),
}));

// bucket boxes by column so ground lookups stay cheap
const BUCKET = 4;
const buckets = new Map();
const key = (cx, cz) => cx + ":" + cz;
for (const b of boxes) {
  for (let cx = Math.floor(b.mn[0] / BUCKET); cx <= Math.floor(b.mx[0] / BUCKET); cx++) {
    for (let cz = Math.floor(b.mn[2] / BUCKET); cz <= Math.floor(b.mx[2] / BUCKET); cz++) {
      const k = key(cx, cz);
      if (!buckets.has(k)) buckets.set(k, []);
      buckets.get(k).push(b);
    }
  }
}
const near = (x, z) => buckets.get(key(Math.floor(x / BUCKET), Math.floor(z / BUCKET))) || [];

function overlapsColumn(b, x, z) {
  return x + R > b.mn[0] && x - R < b.mx[0] && z + R > b.mn[2] && z - R < b.mx[2];
}

// the surface a player standing at (x,z) would end up on, or null if there is none
function groundAt(x, z) {
  const cols = near(x, z).filter((b) => overlapsColumn(b, x, z));
  const tops = [0, ...cols.map((b) => b.mx[1])].sort((a, b) => b - a);
  for (const top of tops) {
    if (top > 14) continue;
    const lo = top + 0.06, hi = top + HEAD;
    const blocked = cols.some((b) => b.mx[1] > lo + 1e-6 && b.mn[1] < hi - 1e-6);
    if (!blocked) return top;
  }
  return null;
}

const N = Math.floor((HALF * 2) / STEP);
const toX = (i) => -HALF + i * STEP + STEP / 2;
const grid = [];
for (let i = 0; i < N; i++) {
  grid.push([]);
  for (let j = 0; j < N; j++) grid[i].push(groundAt(toX(i), toX(j)));
}

// flood from the spawns: up to CLIMB is climbable, downward is always possible
const seen = new Set();
const queue = [];
for (const sp of MAP.spawns) {
  const i = Math.round((sp[0] + HALF - STEP / 2) / STEP);
  const j = Math.round((sp[2] + HALF - STEP / 2) / STEP);
  if (grid[i] && grid[i][j] !== null && grid[i][j] !== undefined) {
    seen.add(i + "," + j);
    queue.push([i, j]);
  }
}
while (queue.length) {
  const [i, j] = queue.pop();
  const h = grid[i][j];
  for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const ni = i + di, nj = j + dj;
    if (ni < 0 || nj < 0 || ni >= N || nj >= N) continue;
    const k = ni + "," + nj;
    if (seen.has(k)) continue;
    const nh = grid[ni][nj];
    if (nh === null || nh === undefined) continue;
    if (nh - h > CLIMB) continue;                 // too high to get up
    seen.add(k);
    queue.push([ni, nj]);
  }
}

const stuck = [];
for (let i = 0; i < N; i++) {
  for (let j = 0; j < N; j++) {
    if (grid[i][j] === null || grid[i][j] === undefined) continue;
    if (!seen.has(i + "," + j)) stuck.push([toX(i), toX(j), grid[i][j]]);
  }
}

// A pocket only traps you if you can GET into it: somewhere nearby and reachable
// must be high enough above it to fall from. Unreachable rooftops and cornices
// are not traps - you cannot fall into them either.
const reachableAt = (i, j) => (seen.has(i + "," + j) ? grid[i][j] : null);
const trapped = stuck.filter(([x, z, y]) => {
  const i = Math.round((x + HALF - STEP / 2) / STEP);
  const j = Math.round((z + HALF - STEP / 2) / STEP);
  for (let di = -3; di <= 3; di++) {
    for (let dj = -3; dj <= 3; dj++) {
      const h = reachableAt(i + di, j + dj);
      if (h !== null && h !== undefined && h > y + CLIMB) return true;   // a ledge to fall off
    }
  }
  return false;
});
stuck.length = 0;
stuck.push(...trapped);

// group them so one pit is reported once
const groups = [];
for (const [x, z, y] of stuck) {
  const g = groups.find((q) => Math.abs(q.x - x) < 4 && Math.abs(q.z - z) < 4 && Math.abs(q.y - y) < 2);
  if (g) { g.n++; g.x = (g.x * (g.n - 1) + x) / g.n; g.z = (g.z * (g.n - 1) + z) / g.n; }
  else groups.push({ x, z, y, n: 1 });
}

console.log("standable cells:", stuck.length + seen.size, "| reachable from spawns:", seen.size);
if (!groups.length) {
  console.log("PASS  nowhere you can fall in and not climb out");
  process.exit(0);
}
console.log("FAIL  " + groups.length + " pocket(s) you cannot climb out of:");
groups.sort((a, b) => b.n - a.n).forEach((g) =>
  console.log("   around [" + g.x.toFixed(1) + ", " + g.z.toFixed(1) + "] floor y=" + g.y.toFixed(2) +
    "  (" + (g.n * STEP * STEP).toFixed(1) + " m2)"));
process.exit(1);
