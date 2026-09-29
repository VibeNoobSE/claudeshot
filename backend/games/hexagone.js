// Claudeshot Hex-A-Gone — last one standing on falling hex tiles (server side, prototype).
//
// Everything generic - phases, eliminations, bumps, ranking - is PartyGame
// (party-base.js). What's left is the tiles: the server decides tile falls from
// the positions players report. A tile is scheduled to drop FALL_DELAY_MS after
// anyone first stands on it, and every client is told the exact fall time, so
// all screens agree on the holes.

const PartyGame = require("./party-base");
const R = require("../../frontend/games/hexagone-rules.js");

// Standing at a floor's height with no tile left underneath means you've
// fallen through - your screen just hasn't caught up. A tab left in the
// background stops simulating, and would otherwise stand on air forever.
const FLOAT_MS = 1200;

class HexagoneGame extends PartyGame {
  constructor(room, io, onEnd) {
    super(room, io, onEnd, {
      key: "hexagone",
      countdownMs: R.COUNTDOWN_MS,
      roundMs: R.ROUND_MS,
      loadTimeoutMs: R.LOAD_TIMEOUT_MS,
      endScreenMs: R.END_SCREEN_MS,
      // falling between floors is the fastest anyone moves
      teleport: { dist: 12, maxSpeed: 40, maxLagS: 10 },
      bounds: { xz: 200, yMin: -80, yMax: 60 },
    });
    this.fallAt = new Map();           // tile id -> rt the tile drops
    this.newFalls = [];                // scheduled since the last broadcast
  }

  spawnFor(i, count) {
    return R.spawn(i, count);
  }

  setup() {
    for (const p of this.players.values()) p.floatingSince = 0;
  }

  initExtra() {
    return { tiles: [...this.fallAt.entries()] };
  }

  isUp(id, rt) {
    const at = this.fallAt.get(id);
    return at === undefined || rt < at;
  }

  isAutoOut(p) {
    return p.pos[1] < R.KILL_Y;
  }

  // The client says it fell; believe it only if we last saw it below the floors.
  validateFall(p) {
    return p.pos[1] < R.OUT_Y;
  }

  // Whatever this bean stands on starts to fall.
  afterState(p, now) {
    const [x, y, z] = p.pos;
    const rt = this.rt(now);
    const under = R.standingOn(x, y, z, (tid) => this.isUp(tid, rt));
    for (const id of under) {
      if (this.fallAt.has(id)) continue;
      const at = rt + R.FALL_DELAY_MS;
      this.fallAt.set(id, at);
      this.newFalls.push([id, at]);
    }
    const atFloor = R.LAYERS.some((L) => y >= L.y - 0.45 && y <= L.y + 0.3);
    if (!atFloor || under.length) { p.floatingSince = 0; return; }
    if (!p.floatingSince) p.floatingSince = now;
    else if (now - p.floatingSince > FLOAT_MS) this.eliminate(p, now);
  }

  eliminate(p, now) {
    if (!p.out) p.a = 4;
    super.eliminate(p, now);
  }

  onTick() {
    if (!this.newFalls.length) return;
    this.emit(this.room.code, "tiles", { add: this.newFalls });
    this.newFalls = [];
  }

  // Whoever is still up first (higher floor first), then the rest by how long
  // they lasted. Anyone who left the room comes last.
  rank() {
    const all = [...this.players.values()];
    const here = all.filter((p) => this.present(p));
    const standing = here.filter((p) => !p.out).sort((a, b) => b.pos[1] - a.pos[1]);
    const fallen = here.filter((p) => p.out).sort((a, b) => b.outAt - a.outAt);
    const gone = all.filter((p) => !this.present(p));
    return [...standing, ...fallen, ...gone];
  }
}

module.exports = HexagoneGame;
