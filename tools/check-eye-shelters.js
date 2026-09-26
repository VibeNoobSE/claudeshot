// Checks that every Eye of Ark shelter actually hides a Bookis from the gaze.
// For each shelter roof, stand a player on a grid of spots underneath it and
// cast the Eye's ray (EYE_POS -> chest) against all shelter pieces.
// Usage: node tools/check-eye-shelters.js   (exits non-zero if any spot is exposed)

const C = require("../frontend/games/eye-course.js");

const shelterPieces = C.pieces.filter((p) => p.shelter);

// Ray vs box (oriented by rot [pitch, yaw], Euler "YXZ"). Returns true if the
// segment from a to b passes through the box.
function segmentHitsBox(a, b, p) {
  const [pitch, yaw] = p.rot || [0, 0];
  // world -> local: undo translation, then yaw, then pitch
  const toLocal = (v) => {
    let x = v[0] - p.pos[0], y = v[1] - p.pos[1], z = v[2] - p.pos[2];
    const cy = Math.cos(-yaw), sy = Math.sin(-yaw);
    [x, z] = [x * cy + z * sy, -x * sy + z * cy];
    const cp = Math.cos(-pitch), sp = Math.sin(-pitch);
    [y, z] = [y * cp - z * sp, y * sp + z * cp];
    return [x, y, z];
  };
  const la = toLocal(a), lb = toLocal(b);
  const half = [p.size[0] / 2, p.size[1] / 2, p.size[2] / 2];
  let t0 = 0, t1 = 1;
  for (let i = 0; i < 3; i++) {
    const d = lb[i] - la[i];
    if (Math.abs(d) < 1e-9) {
      if (la[i] < -half[i] || la[i] > half[i]) return false;
      continue;
    }
    let ta = (-half[i] - la[i]) / d, tb = (half[i] - la[i]) / d;
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta);
    t1 = Math.min(t1, tb);
    if (t0 > t1) return false;
  }
  return true;
}

function blocked(chest) {
  for (const p of shelterPieces) {
    if (p.shape === "box" && segmentHitsBox(C.EYE_POS, chest, p)) return true;
  }
  return false;
}

// Every roof defines a covered stretch: [s0, s1] along the path.
const roofs = shelterPieces.filter((p) => p.cover);
let exposed = 0, total = 0;
for (const r of roofs) {
  const [s0, s1] = r.cover;
  let bad = 0, n = 0;
  for (let s = s0 + 0.8; s <= s1 - 0.8; s += 0.5) {
    const w = C.widthAt(s);
    for (let lat = -w / 2 + 0.6; lat <= w / 2 - 0.6; lat += 0.5) {
      const feet = C.pathOffset(s, lat, 0);
      const chest = [feet[0], feet[1] + 0.9, feet[2]];
      n++;
      if (!blocked(chest)) bad++;
    }
  }
  total += n;
  exposed += bad;
  console.log(`${r.id.padEnd(12)} s ${s0}-${s1}: ${bad ? "EXPOSED " + bad + "/" + n : "ok (" + n + " spots)"}`);
}
if (exposed) {
  console.log(`FAIL  ${exposed}/${total} covered spots can be seen by the Eye`);
  process.exit(1);
}
console.log(`PASS  all ${total} covered spots are hidden from the Eye`);
