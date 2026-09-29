// Jump Showdown (prototype) - server referee.
//
//   client owns FEEL  - movement, jumping, getting swept off by the bars
//   server owns TRUTH - the clock and phases, who is out and when, bumps,
//                       places and points
//
// Everything generic - phases, eliminations, bumps, the end board - is
// PartyGame (party-base.js). The bars and the falling floor are pure functions
// of (seed, rt) in the shared rules file, so the server never simulates them;
// it only uses them to sanity-check a claimed fall.

const PartyGame = require("./party-base");
const RULES = require("../../frontend/games/showdown-rules.js");

const AUTO_OUT_Y = -6;                             // a reported position this low is out, claimed or not

class ShowdownGame extends PartyGame {
  constructor(room, io, onEnd) {
    super(room, io, onEnd, {
      key: "showdown",
      countdownMs: RULES.COUNTDOWN_MS,
      roundMs: RULES.ROUND_MS,
      loadTimeoutMs: RULES.LOAD_TIMEOUT_MS,
      endScreenMs: RULES.END_SCREEN_MS,
      bump: { reach: RULES.PLAYER.reach + 1.2, speed: 9, up: 5, cooldownMs: 800 },
      // A bar can fling you a long way in one packet, and a fall is checked
      // against the floor anyway, so no teleport guard or bounds here.
      teleport: null,
      bounds: { xz: Infinity, yMin: -Infinity, yMax: Infinity },
    });
    this.seed = (Math.random() * 0xffffffff) >>> 0;
    this.rules = RULES.create(this.seed);
  }

  // evenly round the platform, facing the post
  spawnFor(i, count) {
    const sp = this.rules.spawns(count)[i];
    return { pos: sp.p.slice(), yaw: sp.yaw };
  }

  // a client that never says it fell still can't stand in the lava
  isAutoOut(p) {
    return p.pos[1] < AUTO_OUT_Y;
  }

  // A fall is believed when the last reported position is off the floor:
  // below the platform, beyond its rim, or over a segment that has dropped.
  validateFall(p, now) {
    const [x, y, z] = p.pos;
    if (y < -1) return true;
    if (Math.hypot(x, z) > RULES.ARENA_R + 0.3) return true;
    return !this.rules.floorAt(x, z, this.rt(now));
  }

  // Whoever leaves the room mid-round counts as out at that moment.
  onTick(now, rt, phase) {
    if (phase !== "play") return;
    for (const p of this.players.values()) {
      if (!p.out && !this.present(p)) { p.out = true; p.outAt = Math.max(0, rt); }
    }
  }

  // Survivors share first place; everyone else ranks by how long they lasted,
  // and falls at the same moment share a place.
  rank(now) {
    const rt = Math.min(this.rt(now), RULES.ROUND_MS);
    const all = [...this.players.values()];
    const survivors = all.filter((p) => !p.out);
    const fallen = all.filter((p) => p.out).sort((a, b) => b.outAt - a.outAt);
    this.places = new Map();
    for (const p of survivors) this.places.set(p, { place: 1, survivedMs: rt });
    let place = survivors.length + 1, prev = null, prevPlace = 0;
    for (const p of fallen) {
      const thisPlace = prev !== null && p.outAt === prev ? prevPlace : place;
      this.places.set(p, { place: thisPlace, survivedMs: p.outAt });
      prev = p.outAt; prevPlace = thisPlace;
      place++;
    }
    return [...survivors, ...fallen];
  }

  tableRow(p) {
    const { place, survivedMs } = this.places.get(p);
    return {
      uid: p.uid,
      name: p.name,
      place,
      points: PartyGame.POINTS[place - 1] || 0,
      survivedMs,
      survived: Math.round(survivedMs / 100) / 10,
      out: p.out,
    };
  }
}

module.exports = ShowdownGame;
