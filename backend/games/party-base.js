// Claudeshot party games - shared server referee (PartyGame).
//
// Everything the Fall Guys-style party rounds (Block Party, Hex-A-Gone, Jump
// Showdown) have in common on the server: players with stable uids, colours and
// teams, the loading -> countdown -> play -> over phases, the 20 Hz state
// broadcast, reconnects, position sanity checks, eliminations and their order,
// bumps, ranking, points, the end board and handing back to the platform.
//
//   client owns FEEL  - movement, collisions, being shoved or swept off
//   server owns TRUTH - the clock and phases, who is out and when, bumps, places
//
// ---------------------------------------------------------------------------
// HOW TO BUILD A GAME ON THIS
//
//   const PartyGame = require("./party-base");
//   const R = require("../../frontend/games/mygame-rules.js");
//
//   class MygameGame extends PartyGame {
//     constructor(room, io, onEnd) {
//       super(room, io, onEnd, {
//         key: "mygame",                 // events: mygame-init/state/out/knock/over
//         countdownMs: R.COUNTDOWN_MS, roundMs: R.ROUND_MS,
//       });
//     }
//     spawnFor(i, count) { return [0, 0.05, 0]; }      // feet position (or {pos, yaw})
//     isAutoOut(p) { return p.pos[1] < -3; }            // a reported position that is out
//     validateFall(p) { return p.pos[1] < -0.5; }       // believe a client's "fell"?
//   }
//   module.exports = MygameGame;
//
// server.js routes `mygame-input` to setInput(socketId, data). Inputs handled
// here: team, ready, state, fell, bump. Anything else goes to onInput().
//
// Messages sent (prefixed with the key):
//   -init  (to one)  { uid, seed, rt, phase, countdownMs, roundMs, spawn, players:[{uid,name,color,tm}], ...initExtra(p) }
//   -state (room)    { rt, phase, seed, timeLeft, alive, left, players:[{uid,name,color,tm,rd,p,yaw,v,a,out, ...playerExtra(p)}], ...stateExtra() }
//   -out   (room)    { uid, name, left }
//   -knock (victim)  { v:[vx,vy,vz], by }
//   -over  (room)    { table:[{uid,name,place,points,survived,out, ...}], endsIn }
//
// Hooks a game may override (all optional):
//   spawnFor(index, count)        where player `index` starts
//   setup()                       once, in start(), after players exist
//   initExtra(p) / stateExtra(now, rt) / playerExtra(p)   extra fields
//   onInput(p, data, now)         game-specific inputs (after ready)
//   afterState(p, now)            after a state packet is accepted
//   isAutoOut(p, now)             reported position means out (checked on every state in play)
//   validateFall(p, now)          should a client's "fell" count? (default: yes)
//   onTick(now, rt, phase)        every tick, before the broadcast
//   isDone(now, rt, alive)        end the round early? (default: 1 left of 2+, or 0)
//   rank(now)                     final order (default: standing, then latest out first)
//   tableRow(p, i, now)           one end-board row
// ---------------------------------------------------------------------------

const TICK_MS = 50;
const TEAMS = ["bookis", "norli"];
const POINTS = [10, 6, 5, 4, 3, 2, 1, 0];
const COLORS = ["#ff4fa0", "#3fc5ff", "#ffd23f", "#7ce85a", "#a86bff", "#ff8a3d", "#2ee6c9", "#ff5a5a"];

const DEFAULTS = {
  countdownMs: 3000,
  roundMs: 150000,
  loadTimeoutMs: 15000,
  endScreenMs: 6000,
  bump: { reach: 1.7 + 1.2, speed: 9, up: 5, cooldownMs: 800 },
  // null disables the teleport guard
  teleport: { dist: 12, maxSpeed: 15, maxLagS: 10 },
  bounds: { xz: 60, yMin: -40, yMax: 40 },
};

const isVec = (v, n) => Array.isArray(v) && v.length === n && v.every(Number.isFinite);
const round2 = (x) => Math.round(x * 100) / 100;
function dist(a, b) {
  const dx = a[0] - b[0], dy = a[1] - b[1], dz = a[2] - b[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

class PartyGame {
  constructor(room, io, onEnd, config) {
    this.room = room;
    this.io = io;
    this.onEnd = onEnd;
    this.cfg = Object.assign({}, DEFAULTS, config || {});
    this.cfg.bump = Object.assign({}, DEFAULTS.bump, (config && config.bump) || {});
    this.cfg.bounds = Object.assign({}, DEFAULTS.bounds, (config && config.bounds) || {});
    if (config && config.teleport !== undefined) {
      this.cfg.teleport = config.teleport && Object.assign({}, DEFAULTS.teleport, config.teleport);
    }
    this.key = this.cfg.key;
    this.players = new Map();          // socket id -> player
    this.timer = null;
    this.startedAt = 0;
    this.goAt = 0;                     // 0 while waiting for everyone to load
    this.overAt = 0;
    this.table = null;
    this.ended = false;
    this.starters = 0;                 // how many were in at GO
    this.seed = (Math.random() * 1e9) >>> 0;
  }

  emit(to, ev, data) { this.io.to(to).emit(this.key + "-" + ev, data); }

  // ---------------------------------------------------------------- clock
  rt(now = Date.now()) {
    return this.goAt ? now - this.goAt : -this.cfg.countdownMs;
  }

  phase(now = Date.now()) {
    if (this.overAt) return "over";
    if (!this.goAt) return "loading";
    return this.rt(now) < 0 ? "countdown" : "play";
  }

  // ---------------------------------------------------------------- hooks
  spawnFor() { return [0, 0.05, 0]; }
  setup() {}
  initExtra() { return {}; }
  stateExtra() { return {}; }
  playerExtra() { return {}; }
  onInput() {}
  afterState() {}
  isAutoOut() { return false; }
  validateFall() { return true; }
  onTick() {}
  isDone(now, rt, alive) {
    return this.starters >= 2 ? alive.length <= 1 : alive.length === 0;
  }

  // ---------------------------------------------------------------- lifecycle
  start() {
    const count = this.room.players.length;
    this.room.players.forEach((rp, i) => {
      const sp = this.spawnFor(i, count);
      const pos = (Array.isArray(sp) ? sp : (sp.pos || sp.p)).slice();
      this.players.set(rp.id, {
        id: rp.id,
        uid: "u" + (i + 1),
        index: i,
        name: rp.name,
        color: COLORS[i % COLORS.length],
        team: "bookis",
        pos,
        spawn: pos.slice(),
        spawnYaw: Array.isArray(sp) ? 0 : (sp.yaw || 0),
        yaw: Array.isArray(sp) ? 0 : (sp.yaw || 0),
        v: [0, 0, 0],
        a: 0,
        ready: false,
        out: false,
        outAt: 0,                       // rt when eliminated
        lastAccept: 0,
        bumpReadyAt: 0,
      });
    });
    this.setup();
    this.startedAt = Date.now();
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.ended = true;
  }

  updatePlayerId(oldId, newId) {
    const p = this.players.get(oldId);
    if (!p) return;
    this.players.delete(oldId);
    p.id = newId;
    p.ready = false;                   // the new page must say it is built
    this.players.set(newId, p);
  }

  playerByUid(uid) {
    for (const p of this.players.values()) if (p.uid === uid) return p;
    return null;
  }

  present(p) {
    return this.room.players.some((rp) => rp.id === p.id);
  }

  alive() {
    return [...this.players.values()].filter((p) => !p.out && this.present(p));
  }

  initPayload(p) {
    return Object.assign({
      uid: p.uid,
      index: p.index,
      seed: this.seed,
      rt: this.rt(),
      phase: this.phase(),
      countdownMs: this.cfg.countdownMs,
      roundMs: this.cfg.roundMs,
      spawn: p.spawn,
      spawnYaw: p.spawnYaw,
      out: p.out,
      players: [...this.players.values()].map((q) => ({ uid: q.uid, name: q.name, color: q.color, tm: q.team })),
    }, this.initExtra(p));
  }

  // ---------------------------------------------------------------- input
  setInput(socketId, data) {
    const p = this.players.get(socketId);
    if (!p || !data || typeof data !== "object" || this.ended) return;
    const now = Date.now();

    if (data.t === "team") {
      if (TEAMS.includes(data.team)) p.team = data.team;
      return;
    }
    if (data.t === "ready") {
      if (!p.ready) p.lastAccept = now;
      p.ready = true;
      this.emit(p.id, "init", this.initPayload(p));
      return;
    }
    if (!p.ready) return;

    if (data.t === "state") return this.acceptState(p, data, now);
    if (data.t === "fell") {
      if (isVec(data.p, 3)) this.acceptState(p, { p: data.p }, now);
      return this.resolveFell(p, now);
    }
    if (data.t === "bump") return this.resolveBump(p, data, now);
    return this.onInput(p, data, now);
  }

  acceptState(p, data, now) {
    if (p.out || !isVec(data.p, 3)) return;
    const [x, y, z] = data.p;
    const B = this.cfg.bounds;
    if (Math.abs(x) > B.xz || Math.abs(z) > B.xz || y < B.yMin || y > B.yMax) return;
    const T = this.cfg.teleport;
    if (T) {
      const since = Math.min(T.maxLagS, (now - p.lastAccept) / 1000);
      const allowed = T.dist + T.maxSpeed * Math.max(0, since - TICK_MS / 1000);
      if (dist(p.pos, data.p) > allowed) return;
    }
    p.pos = [x, y, z];
    p.lastAccept = now;
    if (Number.isFinite(data.yaw)) p.yaw = data.yaw;
    if (isVec(data.v, 3)) p.v = data.v.map((c) => Math.max(-60, Math.min(60, c)));
    if (Number.isInteger(data.a) && data.a >= 0 && data.a <= 4) p.a = data.a;
    if (this.phase(now) !== "play") return;
    // belt and braces: a client that never says "fell" still goes out
    if (this.isAutoOut(p, now)) { this.eliminate(p, now); return; }
    this.afterState(p, now);
  }

  // A fall only counts if where we last saw them backs it up: nobody can
  // declare a rival out, and nobody drops out from a glitch mid-platform.
  resolveFell(p, now) {
    if (p.out || this.phase(now) !== "play") return;
    if (this.validateFall(p, now)) this.eliminate(p, now);
  }

  eliminate(p, now) {
    if (p.out) return;
    p.out = true;
    p.outAt = Math.max(0, this.rt(now));
    const left = this.alive().length;
    this.emit(this.room.code, "out", { uid: p.uid, name: p.name, left });
  }

  resolveBump(p, data, now) {
    if (this.phase(now) !== "play" || p.out || now < p.bumpReadyAt) return;
    const v = this.playerByUid(data.victim);
    if (!v || v === p || v.out || !v.ready || !this.present(v)) return;
    if (!isVec(data.dir, 2)) return;
    const B = this.cfg.bump;
    if (dist(p.pos, v.pos) > B.reach) return;
    const len = Math.hypot(data.dir[0], data.dir[1]);
    if (len < 1e-6) return;
    p.bumpReadyAt = now + B.cooldownMs;
    this.emit(v.id, "knock", {
      v: [round2(data.dir[0] / len * B.speed), B.up, round2(data.dir[1] / len * B.speed)],
      by: p.name,
    });
  }

  // ---------------------------------------------------------------- tick
  startCountdownIfLoaded(now) {
    if (this.goAt) return;
    const waiting = [...this.players.values()].filter((p) => this.present(p) && !p.ready);
    if (waiting.length && now - this.startedAt < this.cfg.loadTimeoutMs) return;
    this.goAt = now + this.cfg.countdownMs;
  }

  tick() {
    if (this.ended) return;
    const now = Date.now();
    this.startCountdownIfLoaded(now);
    const phase = this.phase(now);
    const rt = this.rt(now);

    if (phase === "play" && !this.starters) this.starters = Math.max(1, this.alive().length);
    this.onTick(now, rt, phase);
    if (this.ended) return;

    const present = [...this.players.values()].filter((p) => this.present(p));
    const alive = this.alive();
    this.emit(this.room.code, "state", Object.assign({
      rt,
      phase,
      seed: this.seed,
      timeLeft: Math.max(0, Math.ceil((this.cfg.roundMs - Math.max(0, rt)) / 1000)),
      alive: alive.length,
      left: alive.length,
      players: present.map((p) => Object.assign({
        uid: p.uid,
        name: p.name,
        color: p.color,
        tm: p.team,
        rd: p.ready,
        p: p.pos.map(round2),
        yaw: round2(p.yaw),
        v: p.v.map(round2),
        a: p.a,
        out: p.out,
      }, this.playerExtra(p))),
    }, this.stateExtra(now, rt)));

    if (phase === "play") {
      if (this.isDone(now, rt, alive) || rt >= this.cfg.roundMs) this.finish(now);
    } else if (phase === "over" && now >= this.overAt + this.cfg.endScreenMs) {
      this.stop();
      this.onEnd(this.table.map((row) => ({ name: row.name, score: row.points })));
    }
  }

  // Standing first, then whoever lasted longest. Anyone who left sorts last.
  rank() {
    const all = [...this.players.values()];
    const standing = all.filter((p) => !p.out && this.present(p));
    const out = all.filter((p) => p.out || !this.present(p))
      .sort((a, b) => (b.out ? b.outAt : -1) - (a.out ? a.outAt : -1));
    return [...standing, ...out];
  }

  tableRow(p, i, now) {
    const rt = this.rt(now);
    return {
      uid: p.uid,
      name: p.name,
      place: i + 1,
      points: POINTS[i] || 0,
      // seconds in the round; someone who left the room gets none
      survived: Math.max(0, Math.round((p.out ? p.outAt : (this.present(p) ? Math.min(rt, this.cfg.roundMs) : 0)) / 100) / 10),
      out: p.out,
    };
  }

  finish(now) {
    if (this.overAt) return;
    this.overAt = now;
    this.table = this.rank(now).map((p, i) => this.tableRow(p, i, now));
    this.emit(this.room.code, "over", { table: this.table, endsIn: this.cfg.endScreenMs });
  }
}

PartyGame.POINTS = POINTS;
PartyGame.COLORS = COLORS;
PartyGame.TEAMS = TEAMS;
PartyGame.TICK_MS = TICK_MS;
PartyGame.isVec = isVec;
PartyGame.round2 = round2;
PartyGame.dist = dist;

module.exports = PartyGame;
