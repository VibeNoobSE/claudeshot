// Claudeshot Eye of Ark — Fall Mountain race up Barad-dur (server side).
//
// Split of responsibility, as in the shooter:
//   client owns FEEL  — movement, collision, hazards, the Eye's gaze on yourself
//   server owns TRUTH — the race clock, checkpoints, the crown, places, bumps and grabs
//
// Every obstacle on the course is a pure function of the race clock, so the
// server never simulates them. It relays positions, referees contact between
// players, and decides who reached what.

const COURSE = require("../../frontend/games/eye-course.js");

const TICK_MS = 50;                    // 20 Hz snapshots
const BUMP_COOLDOWN_MS = 800;
const BUMP_SLACK = 1.2;                // lag allowance on top of PLAYER.reach
const BUMP_SPEED = 9;
const BUMP_UP = 5;
// Grabs are short and strong: the victim is pinned for up to 1.6 s, and can
// mash their way out sooner.
const GRAB_SLACK = 1.2;
const GRAB_MAX_MS = 1600;
const GRAB_BREAK_DIST = 4;
const GRAB_COOLDOWN_MS = 1800;         // grabber, after a release
const GRAB_IMMUNE_MS = 1200;           // victim, after a release
const STRUGGLE_BREAK = 5;              // presses that break a hold early
const STRUGGLE_MIN_MS = 60;            // presses closer together than this don't count
const TEAMS = ["bookis", "norli"];
const CROWN_SLACK = 0.8;
const FALL_DEBOUNCE_MS = 800;
const TELEPORT_DIST = 25;              // metres per packet before we get suspicious
const MAX_SPEED = 15;                  // m/s — a knock is the fastest anyone legitimately moves
const MAX_LAG_S = 10;                  // lag allowance stops growing after this long without a packet
const SPAWN_SNAP = 3;                  // a respawn lands within this of a checkpoint spawn
const WORLD_LIMIT = 400;
const POINTS = [6, 5, 4, 3, 2, 1, 0];  // places 2..8; 1st gets 10 with the crown, 8 without

// Bright Fall Guys bean colours, one per player.
const COLORS = ["#ff4fa0", "#3fc5ff", "#ffd23f", "#7ce85a", "#a86bff", "#ff8a3d", "#2ee6c9", "#ff5a5a"];

const CP = COURSE.CHECKPOINTS;
const LAST_CP = CP.length - 1;

function dist(a, b) {
  const dx = a[0] - b[0], dy = a[1] - b[1], dz = a[2] - b[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

const isVec = (v, n) => Array.isArray(v) && v.length === n && v.every(Number.isFinite);
const round2 = (x) => Math.round(x * 100) / 100;

class EyeGame {
  constructor(room, io, onEnd) {
    this.room = room;
    this.io = io;
    this.onEnd = onEnd;
    this.players = new Map();          // socket id -> player
    this.timer = null;
    this.startedAt = 0;
    this.goAt = 0;
    this.ended = false;                // stopped: no more input, no more ticks
    this.winner = null;
    this.wonAt = 0;
    this.overAt = 0;                   // when eye-over went out; 0 while racing
    this.table = null;
  }

  // ---------------------------------------------------------------- clock
  // The intro is a synced cinematic, so its clock only starts once everyone
  // has loaded (or the slowest has had LOAD_TIMEOUT_MS). Until then goAt is 0
  // and the clock stands at the very start of the intro.
  rt(now = Date.now()) {
    return this.goAt ? now - this.goAt : -COURSE.COUNTDOWN_MS;
  }

  phase(now = Date.now()) {
    if (this.overAt) return "over";
    if (this.winner) return "won";
    if (!this.goAt) return "loading";
    return this.rt(now) < 0 ? "countdown" : "race";
  }

  startCountdownIfLoaded(now) {
    if (this.goAt) return;
    const waiting = [...this.players.values()].filter((p) => this.present(p) && !p.ready);
    if (waiting.length && now - this.startedAt < COURSE.LOAD_TIMEOUT_MS) return;
    this.goAt = now + COURSE.COUNTDOWN_MS;
  }

  // ---------------------------------------------------------------- lifecycle
  start() {
    this.room.players.forEach((rp, i) => {
      const spawn = CP[0].spawns[i % CP[0].spawns.length].slice();
      this.players.set(rp.id, {
        id: rp.id,
        // Socket ids change when a player moves from the lobby to the game
        // page or reconnects; everything the clients see is keyed by uid.
        uid: "u" + (i + 1),
        name: rp.name,
        color: COLORS[i % COLORS.length],
        team: "bookis",
        pos: spawn,
        yaw: CP[0].yaw,
        v: [0, 0, 0],
        a: 0,
        g: 0,
        cp: 0,
        s: COURSE.progressAt(spawn[0], spawn[1], spawn[2]).s,
        falls: 0,
        fin: false,
        ready: false,
        lastAccept: 0,
        lastFall: 0,
        gb: null,                      // uid of whoever is grabbing me
        gr: null,                      // uid of whoever I am grabbing
        grabUntil: 0,
        grabReadyAt: 0,
        struggles: 0,                  // presses towards breaking the current hold
        lastStruggle: 0,
        immuneUntil: 0,
        bumpReadyAt: 0,
      });
    });

    this.startedAt = Date.now();
    this.goAt = 0;                     // set once everyone has loaded
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

  // Still in the room? A player who left stops counting for places.
  present(p) {
    return this.room.players.some((rp) => rp.id === p.id);
  }

  initPayload(p) {
    return {
      uid: p.uid,
      rt: this.rt(),
      countdownMs: COURSE.COUNTDOWN_MS,
      roundMs: COURSE.ROUND_MS,
      cp: p.cp,
      players: [...this.players.values()].map((q) => ({ uid: q.uid, name: q.name, color: q.color, tm: q.team })),
    };
  }

  // ---------------------------------------------------------------- input
  setInput(socketId, data) {
    const p = this.players.get(socketId);
    if (!p || !data || typeof data !== "object" || this.ended) return;
    const now = Date.now();

    // The client loads three.js and builds the course before it listens, so
    // it asks for its identity when ready — and keeps asking until answered.
    if (data.t === "ready") {
      if (!p.ready) p.lastAccept = now;  // the teleport guard counts from here, never from zero
      p.ready = true;
      this.io.to(p.id).emit("eye-init", this.initPayload(p));
      return;
    }
    if (!p.ready) return;

    if (data.t === "state") return this.acceptState(p, data, now);
    if (data.t === "fell") {
      if (now - p.lastFall >= FALL_DEBOUNCE_MS) {
        p.falls++;
        p.lastFall = now;
      }
      return;
    }
    if (data.t === "crown") return this.resolveCrown(p, now);
    if (data.t === "bump") return this.resolveBump(p, data, now);
    if (data.t === "grab") return this.resolveGrab(p, data, now);
    if (data.t === "release") {
      if (p.gr) this.release(p, now);
      return;
    }
    if (data.t === "struggle") return this.resolveStruggle(p, now);
    if (data.t === "team") {
      if (TEAMS.includes(data.team)) p.team = data.team;
      return;
    }
  }

  acceptState(p, data, now) {
    if (!isVec(data.p, 3)) return;
    const [x, y, z] = data.p;
    if (Math.abs(x) > WORLD_LIMIT || Math.abs(z) > WORLD_LIMIT || y < -60 || y > 200) return;

    // Teleport guard. A respawn legitimately jumps to a checkpoint spawn, and a
    // lagging client legitimately covers ground between packets; anything
    // else that far is not a Bookis running.
    const jump = dist(p.pos, data.p);
    const since = Math.min(MAX_LAG_S, (now - p.lastAccept) / 1000);
    const allowed = TELEPORT_DIST + MAX_SPEED * Math.max(0, since - TICK_MS / 1000);
    if (jump > allowed && !this.nearOwnSpawn(p, data.p)) return;

    p.pos = [x, y, z];
    p.lastAccept = now;
    if (Number.isFinite(data.yaw)) p.yaw = data.yaw;
    if (isVec(data.v, 3)) p.v = data.v.map((c) => Math.max(-60, Math.min(60, c)));
    if (Number.isInteger(data.a) && data.a >= 0 && data.a <= 4) p.a = data.a;
    if (data.g === 0 || data.g === 1) p.g = data.g;

    if (COURSE.isFallen(x, y, z)) return;
    const prog = COURSE.progressAt(x, y, z);
    p.s = prog.s;

    // Checkpoints advance one at a time, and only for a Bookis standing on the
    // course near its centre line (not falling past it underneath).
    if (this.phase(now) === "race" && p.cp < LAST_CP) {
      const next = CP[p.cp + 1];
      const near = Math.max(6, COURSE.widthAt(prog.s) / 2 + 1.5);
      if (prog.s >= next.s && prog.dist < near && y >= prog.floorY - 1.5) {
        p.cp++;
        this.io.to(p.id).emit("eye-cp", { cp: p.cp, name: next.name });
      }
    }
  }

  nearOwnSpawn(p, pos) {
    for (let c = 0; c <= p.cp; c++) {
      for (const sp of CP[c].spawns) if (dist(sp, pos) <= SPAWN_SNAP) return true;
    }
    return false;
  }

  resolveCrown(p, now) {
    if (this.phase(now) !== "race" || p.cp !== LAST_CP || !this.present(p)) return;
    const chest = [p.pos[0], p.pos[1] + 0.9, p.pos[2]];
    if (dist(chest, COURSE.CROWN.pos) > COURSE.CROWN.reach + CROWN_SLACK) return;
    p.fin = true;
    p.s = COURSE.PATH_END;
    this.winner = p;
    this.wonAt = now;
    for (const q of this.players.values()) if (q.gr) this.release(q, now);
    this.io.to(this.room.code).emit("eye-win", { uid: p.uid, name: p.name });
  }

  resolveBump(p, data, now) {
    if (this.phase(now) !== "race" || now < p.bumpReadyAt) return;
    const v = this.playerByUid(data.victim);
    if (!v || v === p || !v.ready || !this.present(v) || !this.present(p)) return;
    if (dist(p.pos, v.pos) > COURSE.PLAYER.reach + BUMP_SLACK) return;

    let dx = 0, dz = 0;
    if (isVec(data.dir, 2)) { dx = data.dir[0]; dz = data.dir[1]; }
    let len = Math.hypot(dx, dz);
    if (len < 1e-6) {                          // no direction: shove away from the attacker
      dx = v.pos[0] - p.pos[0];
      dz = v.pos[2] - p.pos[2];
      len = Math.hypot(dx, dz) || 1;
    }
    p.bumpReadyAt = now + BUMP_COOLDOWN_MS;
    this.io.to(v.id).emit("eye-knock", {
      v: [round2(dx / len * BUMP_SPEED), BUMP_UP, round2(dz / len * BUMP_SPEED)],
      by: p.name,
    });
  }

  resolveGrab(p, data, now) {
    if (this.phase(now) !== "race" || p.gr || now < p.grabReadyAt) return;
    const v = this.playerByUid(data.victim);
    if (!v || v === p || v.gb || now < v.immuneUntil || !this.present(v) || !this.present(p)) return;
    if (dist(p.pos, v.pos) > COURSE.PLAYER.reach + GRAB_SLACK) return;
    p.gr = v.uid;
    p.grabUntil = now + GRAB_MAX_MS;
    v.gb = p.uid;
    v.struggles = 0;
  }

  // The held Bookis mashes Space; enough presses and the grip breaks.
  resolveStruggle(v, now) {
    if (!v.gb || now - v.lastStruggle < STRUGGLE_MIN_MS) return;
    v.lastStruggle = now;
    v.struggles++;
    if (v.struggles < STRUGGLE_BREAK) return;
    const grabber = this.playerByUid(v.gb);
    if (grabber && grabber.gr === v.uid) this.release(grabber, now);
    else v.gb = null;
  }

  release(grabber, now) {
    const v = this.playerByUid(grabber.gr);
    if (v && v.gb === grabber.uid) {
      v.gb = null;
      v.struggles = 0;
      v.immuneUntil = now + GRAB_IMMUNE_MS;
    }
    grabber.gr = null;
    grabber.grabUntil = 0;
    grabber.grabReadyAt = now + GRAB_COOLDOWN_MS;
  }

  // ---------------------------------------------------------------- ranking
  // Crown winner first, then furthest along, then most checkpoints, then fewest falls.
  ranked(list) {
    return list.slice().sort((a, b) =>
      (b.fin - a.fin) || (b.s - a.s) || (b.cp - a.cp) || (a.falls - b.falls));
  }

  // ---------------------------------------------------------------- tick
  tick() {
    if (this.ended) return;
    const now = Date.now();

    // grabs end on their own: time up, dragged apart, someone left, race over
    for (const p of this.players.values()) {
      if (!p.gr) continue;
      const v = this.playerByUid(p.gr);
      if (!v || now >= p.grabUntil || dist(p.pos, v.pos) > GRAB_BREAK_DIST ||
          !this.present(p) || !this.present(v) || this.phase(now) !== "race") {
        this.release(p, now);
      }
    }

    this.startCountdownIfLoaded(now);
    const phase = this.phase(now);
    const rt = this.rt(now);
    const active = [...this.players.values()].filter((p) => this.present(p));
    const places = new Map(this.ranked(active).map((p, i) => [p.uid, i + 1]));

    this.io.to(this.room.code).emit("eye-state", {
      rt,
      phase,
      timeLeft: Math.max(0, Math.ceil((COURSE.ROUND_MS - Math.max(0, rt)) / 1000)),
      players: active.map((p) => ({
        uid: p.uid,
        name: p.name,
        color: p.color,
        tm: p.team,
        rd: p.ready,
        p: p.pos.map(round2),
        yaw: round2(p.yaw),
        v: p.v.map(round2),
        a: p.a,
        g: p.g,
        cp: p.cp,
        prog: Math.max(0, Math.min(1, p.s / COURSE.PATH_END)),
        place: places.get(p.uid),
        gb: p.gb,
        gr: p.gr,
        gt: p.gr ? Math.max(0, p.grabUntil - now) : 0,     // ms left on my hold
        st: p.gb ? p.struggles : 0,                          // my struggle presses so far
        fin: p.fin,
        falls: p.falls,
      })),
    });

    if (phase === "race" && rt >= COURSE.ROUND_MS) this.finish(now);
    else if (phase === "won" && now >= this.wonAt + COURSE.WIN_HOLD_MS) this.finish(now);
    else if (phase === "over" && now >= this.overAt + COURSE.END_SCREEN_MS) {
      // Hold the final board inside the game before handing back to the
      // platform, which is what sends everyone on to the results.
      this.stop();
      this.onEnd(this.table.map((row) => ({ name: row.name, score: row.points })));
    }
  }

  finish(now) {
    if (this.overAt) return;
    this.overAt = now;
    for (const p of this.players.values()) if (p.gr) this.release(p, now);

    // Players still here rank first; anyone who left keeps a row at the bottom.
    const all = [...this.players.values()];
    const order = [
      ...this.ranked(all.filter((p) => this.present(p))),
      ...this.ranked(all.filter((p) => !this.present(p))),
    ];
    this.table = order.map((p, i) => ({
      uid: p.uid,
      name: p.name,
      place: i + 1,
      points: i === 0 ? (p.fin ? 10 : 8) : (POINTS[i - 1] || 0),
      crown: p.fin,
      cp: p.cp,
      falls: p.falls,
      prog: Math.max(0, Math.min(1, p.s / COURSE.PATH_END)),
    }));
    this.io.to(this.room.code).emit("eye-over", { table: this.table, endsIn: COURSE.END_SCREEN_MS });
  }
}

module.exports = EyeGame;
