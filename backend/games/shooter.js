// Claudeshot Shooter — real-time 3D deathmatch (server side).
//
// Split of responsibility (see the design notes in the PR):
//   client owns FEEL  — movement, collision, aim, rendering
//   server owns TRUTH — health, deaths, respawns, kills, the round clock
//
// The server therefore needs no 3D library. It relays positions and validates
// claimed hits with plain vector maths against the shared map's AABBs.

const MAP = require("../../frontend/games/shooter-map.js");

const TICK_MS = 50;              // 20 Hz snapshots
const COUNTDOWN_MS = 3000;
const ROUND_MS = 180000;         // 3 minute round
const RESPAWN_MS = 3000;
const MAX_HP = 100;
const BODY_DAMAGE = 20;
const HEAD_DAMAGE = 45;
const MAX_RANGE = 140;
const MIN_SHOT_INTERVAL = 80;    // ms — rejects impossible fire rates
const EYE_HEIGHT = 1.35;
const CHEST_HEIGHT = 0.9;
const HEAD_HEIGHT = 1.5;
const BOX_SHRINK = 0.06;         // stops corner-grazing rejecting fair shots
const PICKUP_RADIUS = 2.6;       // how close a player must be to claim a pickup
const PICKUP_RESPAWN_MS = 20000;
const BUFF_MS = 12000;
const DAMAGE_BUFF = 2;
const HEALTH_PICKUP = 50;
const OKR_REGEN_MS = 700;        // "clear visions": steady regen while in the OKR room
const OKR_REGEN = 4;

const COLORS = ["#f7c948", "#e94560", "#4ecca3", "#5dade2", "#af7ac5", "#ff8c42", "#42f5b0", "#f542e0"];

// Pre-compute AABB min/max for line-of-sight tests. Decorative boxes
// (foliage, glass, ground decals) are marked solid:false and never block a shot.
const AABBS = MAP.boxes.filter((b) => b.solid !== false).map((b) => ({
  min: [b.pos[0] - b.size[0] / 2 + BOX_SHRINK, b.pos[1] - b.size[1] / 2 + BOX_SHRINK, b.pos[2] - b.size[2] / 2 + BOX_SHRINK],
  max: [b.pos[0] + b.size[0] / 2 - BOX_SHRINK, b.pos[1] + b.size[1] / 2 - BOX_SHRINK, b.pos[2] + b.size[2] / 2 - BOX_SHRINK],
}));

const OKR_ZONE = (MAP.zones || []).find((z) => z.id === "okr") || null;

function inZone(pos, z) {
  return pos[0] >= z.min[0] && pos[0] <= z.max[0] &&
         pos[1] >= z.min[1] - 1.2 && pos[1] <= z.max[1] &&
         pos[2] >= z.min[2] && pos[2] <= z.max[2];
}

function dist(a, b) {
  const dx = a[0] - b[0], dy = a[1] - b[1], dz = a[2] - b[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

// Slab method: does the segment from→to hit this axis-aligned box?
function segmentHitsBox(from, to, box) {
  let tMin = 0;
  let tMax = 1;
  for (let i = 0; i < 3; i++) {
    const d = to[i] - from[i];
    if (Math.abs(d) < 1e-8) {
      if (from[i] < box.min[i] || from[i] > box.max[i]) return false;
      continue;
    }
    let t1 = (box.min[i] - from[i]) / d;
    let t2 = (box.max[i] - from[i]) / d;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
    if (t1 > tMin) tMin = t1;
    if (t2 < tMax) tMax = t2;
    if (tMin > tMax) return false;
  }
  return true;
}

function blocked(from, to) {
  for (const box of AABBS) if (segmentHitsBox(from, to, box)) return true;
  return false;
}

class ShooterGame {
  constructor(room, io, onEnd) {
    this.room = room;
    this.io = io;
    this.onEnd = onEnd;
    this.players = new Map();
    this.pickups = new Map();
    this.timer = null;
    this.startedAt = 0;
    this.ended = false;
  }

  start() {
    this.room.players.forEach((p, i) => {
      this.players.set(p.id, {
        id: p.id,
        name: p.name,
        color: COLORS[i % COLORS.length],
        hp: MAX_HP,
        alive: true,
        kills: 0,
        deaths: 0,
        pos: [0, 0, 0],
        rot: [0, 0],
        lastShot: 0,
        respawnAt: 0,
        damageUntil: 0,
        speedUntil: 0,
        okr: false,
        lastRegen: 0,
      });
    });

    // Spread the initial spawns as widely as the spawn list allows.
    let i = 0;
    for (const p of this.players.values()) {
      p.pos = MAP.spawns[(i * 2) % MAP.spawns.length].slice();
      i++;
    }

    for (const pk of MAP.pickups) {
      this.pickups.set(pk.id, { id: pk.id, type: pk.type, pos: pk.pos, readyAt: 0 });
    }

    this.startedAt = Date.now();
    this.io.to(this.room.code).emit("shooter-init", {
      map: MAP.name,
      roundMs: ROUND_MS,
      countdownMs: COUNTDOWN_MS,
      maxHp: MAX_HP,
      you: null,
      players: [...this.players.values()].map((p) => ({ id: p.id, name: p.name, color: p.color })),
    });

    for (const p of this.players.values()) {
      this.io.to(p.id).emit("shooter-spawn", { pos: p.pos, hp: MAX_HP });
    }

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
    this.players.set(newId, p);
    this.io.to(newId).emit("shooter-spawn", { pos: p.pos, hp: p.hp });
  }

  elapsed() {
    return Date.now() - this.startedAt;
  }

  inCountdown() {
    return this.elapsed() < COUNTDOWN_MS;
  }

  setInput(socketId, data) {
    const p = this.players.get(socketId);
    if (!p || !data || this.ended) return;

    if (data.t === "state") {
      if (!Array.isArray(data.p) || data.p.length !== 3) return;
      if (!data.p.every(Number.isFinite)) return;
      p.pos = data.p;
      if (Array.isArray(data.r) && data.r.length === 2 && data.r.every(Number.isFinite)) p.rot = data.r;
      return;
    }

    if (data.t === "hit") return this.resolveHit(p, data);
    if (data.t === "pickup") return this.resolvePickup(p, data);
  }

  resolvePickup(player, data) {
    if (!player.alive || this.inCountdown()) return;
    const pk = this.pickups.get(data.id);
    if (!pk) return;

    const now = Date.now();
    if (now < pk.readyAt) return;                       // still respawning
    if (dist(player.pos, pk.pos) > PICKUP_RADIUS) return; // claimed from too far away

    if (pk.type === "health") {
      if (player.hp >= MAX_HP) return;                  // no point burning it
      player.hp = Math.min(MAX_HP, player.hp + HEALTH_PICKUP);
    } else if (pk.type === "damage") {
      player.damageUntil = now + BUFF_MS;
    } else if (pk.type === "speed") {
      player.speedUntil = now + BUFF_MS;
    }
    // "ammo" is purely a client-side magazine refill; the server just gates it.

    pk.readyAt = now + PICKUP_RESPAWN_MS;
    this.io.to(this.room.code).emit("shooter-pickup", {
      id: pk.id,
      type: pk.type,
      by: player.name,
      byId: player.id,
    });
  }

  resolveHit(shooter, data) {
    if (this.inCountdown()) return;
    const victim = this.players.get(data.victim);
    if (!victim || victim === shooter) return;
    if (!shooter.alive || !victim.alive) return;

    const now = Date.now();
    if (now - shooter.lastShot < MIN_SHOT_INTERVAL) return;
    shooter.lastShot = now;

    if (dist(shooter.pos, victim.pos) > MAX_RANGE) return;

    // Line of sight: try the chest, then the head, before rejecting. Aiming at a
    // player peeking over cover legitimately clears one point but not the other.
    const eye = [shooter.pos[0], shooter.pos[1] + EYE_HEIGHT, shooter.pos[2]];
    const chest = [victim.pos[0], victim.pos[1] + CHEST_HEIGHT, victim.pos[2]];
    const head = [victim.pos[0], victim.pos[1] + HEAD_HEIGHT, victim.pos[2]];
    if (blocked(eye, chest) && blocked(eye, head)) return;

    let damage = data.part === "head" ? HEAD_DAMAGE : BODY_DAMAGE;
    if (now < shooter.damageUntil) damage *= DAMAGE_BUFF;
    victim.hp -= damage;

    this.io.to(victim.id).emit("shooter-damaged", { from: shooter.name, hp: Math.max(0, victim.hp) });

    if (victim.hp <= 0) this.killPlayer(shooter, victim, data.part === "head");
  }

  killPlayer(killer, victim, headshot) {
    victim.hp = 0;
    victim.alive = false;
    victim.deaths++;
    victim.respawnAt = Date.now() + RESPAWN_MS;
    killer.kills++;

    this.io.to(this.room.code).emit("shooter-kill", {
      killer: killer.name,
      killerId: killer.id,
      victim: victim.name,
      victimId: victim.id,
      headshot: !!headshot,
    });
  }

  respawn(p) {
    // Spawn furthest from the nearest living opponent — cheap anti-spawn-camping.
    const others = [...this.players.values()].filter((o) => o !== p && o.alive);
    let best = MAP.spawns[0];
    let bestScore = -Infinity;
    for (const s of MAP.spawns) {
      let nearest = Infinity;
      for (const o of others) nearest = Math.min(nearest, dist(s, o.pos));
      const score = others.length ? nearest : Math.random();
      if (score > bestScore) { bestScore = score; best = s; }
    }
    p.pos = best.slice();
    p.hp = MAX_HP;
    p.alive = true;
    p.damageUntil = 0;   // buffs die with you
    p.speedUntil = 0;
    this.io.to(p.id).emit("shooter-spawn", { pos: p.pos, hp: MAX_HP });
  }

  tick() {
    if (this.ended) return;
    const now = Date.now();

    for (const p of this.players.values()) {
      if (!p.alive && now >= p.respawnAt) { this.respawn(p); continue; }
      if (!p.alive) continue;
      // OKR room: standing inside heals you steadily (the client tightens your aim)
      p.okr = !!(OKR_ZONE && inZone(p.pos, OKR_ZONE));
      if (p.okr && p.hp < MAX_HP && now - p.lastRegen >= OKR_REGEN_MS) {
        p.hp = Math.min(MAX_HP, p.hp + OKR_REGEN);
        p.lastRegen = now;
      }
    }

    const elapsed = this.elapsed();
    this.io.to(this.room.code).emit("shooter-state", {
      t: now,
      countdown: this.inCountdown() ? Math.ceil((COUNTDOWN_MS - elapsed) / 1000) : 0,
      timeLeft: Math.max(0, Math.ceil((ROUND_MS + COUNTDOWN_MS - elapsed) / 1000)),
      pickups: [...this.pickups.values()].filter((pk) => now >= pk.readyAt).map((pk) => pk.id),
      players: [...this.players.values()].map((p) => ({
        id: p.id,
        name: p.name,
        color: p.color,
        p: p.pos,
        r: p.rot,
        hp: p.hp,
        alive: p.alive,
        kills: p.kills,
        deaths: p.deaths,
        ok: p.okr ? 1 : 0,
        bd: Math.max(0, Math.ceil((p.damageUntil - now) / 1000)),
        bs: Math.max(0, Math.ceil((p.speedUntil - now) / 1000)),
      })),
    });

    if (elapsed >= ROUND_MS + COUNTDOWN_MS) this.finish();
  }

  finish() {
    if (this.ended) return;
    this.stop();
    const scores = [...this.players.values()]
      .map((p) => ({ name: p.name, score: p.kills }))
      .sort((a, b) => b.score - a.score);
    this.io.to(this.room.code).emit("shooter-over", { scores });
    this.onEnd(scores);
  }
}

module.exports = ShooterGame;
