// Claudeshot Block Party — walls slide across a platform; find the gap or get
// pushed into the lava. Last one standing wins. (Server side, prototype.)
//
// Everything generic - phases, eliminations, bumps, ranking - is PartyGame
// (party-base.js). Walls are pure functions of (seed, rt) in
// blockparty-rules.js, so the server never simulates them.

const PartyGame = require("./party-base");
const R = require("../../frontend/games/blockparty-rules.js");

class BlockpartyGame extends PartyGame {
  constructor(room, io, onEnd) {
    super(room, io, onEnd, {
      key: "blockparty",
      countdownMs: R.COUNTDOWN_MS,
      roundMs: R.ROUND_MS,
      loadTimeoutMs: R.LOAD_TIMEOUT_MS,
      endScreenMs: 6000,
      teleport: { dist: 12, maxSpeed: 15, maxLagS: 10 },
      bounds: { xz: 60, yMin: -40, yMax: 40 },
    });
  }

  spawnFor(i) {
    return R.SPAWNS[i % R.SPAWNS.length].slice();
  }

  isAutoOut(p) {
    const [x, y, z] = p.pos;
    return R.isOut(x, y, z);
  }

  // believe "fell" only if they're off the platform or on the way down
  validateFall(p) {
    const [x, y, z] = p.pos;
    return R.isOut(x, y, z) || y < -0.5 || !R.onPlatform(x, z, 0.3);
  }
}

module.exports = BlockpartyGame;
