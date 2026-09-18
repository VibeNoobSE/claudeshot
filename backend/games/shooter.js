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
const RESPAWN_MS = 10000;        // you sit out a full 10s before rejoining
const MAX_HP = 150;              // ~9 body shots (~1.0s) rather than 5 (~0.6s)
const BODY_DAMAGE = 18;
const HEAD_DAMAGE = 40;
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
const HEALTH_PICKUP = 65;
const SHIELD_FACTOR = 0.5;       // a shield halves incoming damage
const OKR_REGEN_MS = 700;        // "clear visions": steady regen while in the OKR room
const OKR_REGEN = 4;
const TARGET_RESPAWN_MS = 30000;   // a smashed sign is re-hung after 30s
const END_SCREEN_MS = 9000;        // the final board stays up in-game before the platform takes over

// ---- modes: the host picks one in the lobby, or lets each round roll ------
// Server-side effects live here; the client applies the movement and visual
// ones (gravity, speed, big heads, hidden tags) from the same id.
const MODES = [
  { id: "standard",   name: "STANDARD",     blurb: "No tricks. Just aim." },
  { id: "hardcore",   name: "HARDCORE",     blurb: "60 health. No name tags. Every shot counts.", maxHp: 60 },
  { id: "oneshot",    name: "ONE SHOT",     blurb: "Any hit kills. Whoever shoots first wins.", oneShot: true },
  { id: "headhunter", name: "HEADHUNTER",   blurb: "Body shots barely scratch. Headshots drop anyone.", bodyMul: 0.35, headMul: 4 },
  { id: "lowgrav",    name: "LOW GRAVITY",  blurb: "Everyone floats. Take the high ground." },
  { id: "vampire",    name: "VAMPIRE",      blurb: "Every hit heals you. Kills heal more.", lifesteal: 0.5, killHeal: 50 },
  { id: "speed",      name: "SPEED DEMONS", blurb: "Everyone moves 60% faster." },
  { id: "bigheads",   name: "BIG HEADS",    blurb: "Heads are huge. Aim high." },
  { id: "surge",      name: "POWER SURGE",  blurb: "Pickups respawn in seconds. Buffs last twice as long.", pickupMul: 0.2, buffMul: 2 },
];

// The mode the host chose, or for "random" a different twist each round.
function pickMode(room) {
  const wanted = (room.settings && room.settings.mode) || "standard";
  if (wanted !== "random") return MODES.find((m) => m.id === wanted) || MODES[0];
  const pool = MODES.filter((m) => m.id !== "standard" && m.id !== room.lastShooterMode);
  const mode = pool[Math.floor(Math.random() * pool.length)];
  room.lastShooterMode = mode.id;
  return mode;
}

// "classic" is the hand-built map. Otherwise a seed generates the whole world: the
// host's seed if they typed one (so a good world can be replayed), else a new
// one every round.
function pickSeed(room) {
  const st = room.settings || {};
  if (st.world === "classic") return null;
  const typed = String(st.seed == null ? "" : st.seed).trim();
  if (/^\d{1,9}$/.test(typed)) return Number(typed);
  return Math.floor(Math.random() * 1000000);
}

const COLORS = ["#f7c948", "#e94560", "#4ecca3", "#5dade2", "#af7ac5", "#ff8c42", "#42f5b0", "#f542e0"];

// AABB min/max for line-of-sight tests. Decorative boxes (foliage, ground
// decals) are marked solid:false and never block a shot. Built per world, since
// a generated world adds its own cover.
const toAabbs = (boxes) => boxes.filter((b) => b.solid !== false).map((b) => ({
  min: [b.pos[0] - b.size[0] / 2 + BOX_SHRINK, b.pos[1] - b.size[1] / 2 + BOX_SHRINK, b.pos[2] - b.size[2] / 2 + BOX_SHRINK],
  max: [b.pos[0] + b.size[0] / 2 - BOX_SHRINK, b.pos[1] + b.size[1] / 2 - BOX_SHRINK, b.pos[2] + b.size[2] / 2 - BOX_SHRINK],
}));

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

function blocked(from, to, aabbs) {
  for (const box of aabbs) if (segmentHitsBox(from, to, box)) return true;
  return false;
}

class ShooterGame {
  constructor(room, io, onEnd) {
    this.room = room;
    this.io = io;
    this.onEnd = onEnd;
    this.players = new Map();
    this.pickups = new Map();
    this.targets = new Map();
    this.timer = null;
    this.startedAt = 0;
    this.ended = false;
    this.mode = pickMode(room);
    this.seed = pickSeed(room);
    this.map = MAP.forSeed(this.seed);
    this.aabbs = toAabbs(this.map.boxes);
    // the OKR room moves with the world, so its zone is per world too
    this.okrZone = (this.map.zones || []).find((z) => z.id === "okr") || null;
    this.maxHp = this.mode.maxHp || MAX_HP;
    this.bodyMul = this.mode.bodyMul || 1;
    this.headMul = this.mode.headMul || 1;
    this.lifesteal = this.mode.lifesteal || 0;
    this.killHeal = this.mode.killHeal || 0;
    this.buffMs = BUFF_MS * (this.mode.buffMul || 1);
    this.pickupRespawnMs = PICKUP_RESPAWN_MS * (this.mode.pickupMul || 1);
  }

  // Everything a client needs before it can play. Sent on "ready" as well as at
  // start: the start broadcast only reaches the lobby sockets, which are about to
  // be replaced by the game page, so on its own it never arrived.
  initPayload() {
    return {
      map: MAP.name,
      roundMs: ROUND_MS,
      countdownMs: COUNTDOWN_MS,
      maxHp: this.maxHp,
      mode: { id: this.mode.id, name: this.mode.name, blurb: this.mode.blurb },
      seed: this.seed,
    };
  }

  start() {
    this.room.players.forEach((p, i) => {
      this.players.set(p.id, {
        id: p.id,
        // Socket ids change on every reconnect. Rendering keys off this stable
        // uid instead, so a reconnecting player is never drawn as a second
        // "ghost" avatar of themselves and never blinks out of existence.
        uid: "u" + (i + 1),
        name: p.name,
        color: COLORS[i % COLORS.length],
        hp: this.maxHp,
        alive: true,
        kills: 0,
        deaths: 0,
        pos: [0, 0, 0],
        rot: [0, 0],
        lastShot: 0,
        respawnAt: 0,
        damageUntil: 0,
        speedUntil: 0,
        shieldUntil: 0,
        okr: false,
        crouch: 0,
        spawnAcked: false,
        lastRegen: 0,
        lastSpawn: -1,
      });
    });

    // Opening spawns: outer positions only, then greedily spread so players start
    // on opposite sides of the block. Dealing randomly from the whole list put
    // people in the middle of the map, sometimes inside a building.
    const count = this.players.size;
    const all = this.map.spawns.map((sp, idx) => ({ sp, idx, r: Math.hypot(sp[0], sp[2]) }));
    const corners = all.filter((c) => Math.abs(c.sp[0]) > 30 && Math.abs(c.sp[2]) > 30);
    const outer = all.filter((c) => c.r > 26);
    const pool = corners.length >= count ? corners : (outer.length >= count ? outer : all);

    const chosen = [pool[Math.floor(Math.random() * pool.length)]];
    while (chosen.length < count) {
      let best = null;
      let bestDist = -1;
      for (const c of pool) {
        if (chosen.includes(c)) continue;
        let nearest = Infinity;
        for (const taken of chosen) nearest = Math.min(nearest, dist(c.sp, taken.sp));
        if (nearest > bestDist) { bestDist = nearest; best = c; }
      }
      if (!best) break;
      chosen.push(best);
    }

    let i = 0;
    for (const p of this.players.values()) {
      const c = chosen[i % chosen.length];
      p.pos = c.sp.slice();
      p.lastSpawn = c.idx;
      i++;
    }

    // Shootable signage. Smashing one scores, and it goes back up after a while.
    for (const m of this.map.models || []) {
      if (!m.target) continue;
      this.targets.set(m.target.id, {
        id: m.target.id,
        pos: m.pos.slice(),
        maxHp: m.target.hp,
        hp: m.target.hp,
        points: m.target.points,
        radius: m.target.radius || 1.5,
        readyAt: 0,
      });
    }

    for (const pk of this.map.pickups) {
      this.pickups.set(pk.id, { id: pk.id, type: pk.type, pos: pk.pos, readyAt: 0 });
    }

    this.startedAt = Date.now();
    this.io.to(this.room.code).emit("shooter-init", this.initPayload());

    for (const p of this.players.values()) {
      this.io.to(p.id).emit("shooter-you", { uid: p.uid });
      this.io.to(p.id).emit("shooter-spawn", { pos: p.pos, hp: this.maxHp });
    }

    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.endTimer) { clearTimeout(this.endTimer); this.endTimer = null; }
    this.ended = true;
  }

  updatePlayerId(oldId, newId) {
    const p = this.players.get(oldId);
    if (!p) return;
    this.players.delete(oldId);
    p.id = newId;
    this.players.set(newId, p);
    p.spawnAcked = false;                 // the new page must ask for its spawn
    this.io.to(newId).emit("shooter-you", { uid: p.uid });
    this.io.to(newId).emit("shooter-spawn", { pos: p.pos, hp: p.hp });
  }

  // Hits are reported by uid, never socket id: sockets are re-created when a
  // player moves from the lobby to the game page, which used to leave the
  // client reporting an id the server no longer knew, so no shot ever landed.
  playerByUid(uid) {
    for (const p of this.players.values()) if (p.uid === uid) return p;
    return null;
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
      // Ignore position reports until the client has been told where it spawns,
      // otherwise its pre-spawn holding position overwrites the spawn we chose.
      if (!p.spawnAcked) return;
      p.pos = data.p;
      if (Array.isArray(data.r) && data.r.length === 2 && data.r.every(Number.isFinite)) p.rot = data.r;
      if (Number.isFinite(data.c)) p.crouch = Math.max(0, Math.min(1, data.c));
      return;
    }

    // The client loads three.js from a CDN before it can register socket
    // handlers, so any spawn we pushed at game start or on reconnect arrived
    // before anything was listening. It asks for its spawn when actually ready.
    // The whole world comes from the seed, so the client asks which one before it
    // builds anything. Nothing else happens until it is built and sends "ready".
    if (data.t === "hello") {
      this.io.to(p.id).emit("shooter-world", { seed: this.seed });
      return;
    }
    if (data.t === "ready") {
      p.spawnAcked = true;
      this.io.to(p.id).emit("shooter-init", this.initPayload());
      this.io.to(p.id).emit("shooter-you", { uid: p.uid });
      this.io.to(p.id).emit("shooter-spawn", { pos: p.pos, hp: p.hp });
      return;
    }
    if (data.t === "hit") return this.resolveHit(p, data);
    if (data.t === "target") return this.resolveTarget(p, data);
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
      if (player.hp >= this.maxHp) return;              // no point burning it
      player.hp = Math.min(this.maxHp, player.hp + HEALTH_PICKUP);
    } else if (pk.type === "damage") {
      player.damageUntil = now + this.buffMs;
    } else if (pk.type === "speed") {
      player.speedUntil = now + this.buffMs;
    } else if (pk.type === "shield") {
      player.shieldUntil = now + this.buffMs;
    }

    pk.readyAt = now + this.pickupRespawnMs;
    this.io.to(this.room.code).emit("shooter-pickup", {
      id: pk.id,
      type: pk.type,
      by: player.name,
      byId: player.id,
      byUid: player.uid,
    });
  }

  resolveHit(shooter, data) {
    if (this.inCountdown()) return;
    const victim = this.playerByUid(data.victim) || this.players.get(data.victim);
    if (!victim || victim === shooter) return;
    if (!shooter.alive || !victim.alive) return;

    const now = Date.now();
    if (now - shooter.lastShot < MIN_SHOT_INTERVAL) return;
    shooter.lastShot = now;

    if (dist(shooter.pos, victim.pos) > MAX_RANGE) return;

    // Line of sight: try the chest, then the head, before rejecting. Aiming at a
    // player peeking over cover legitimately clears one point but not the other.
    // Both are lowered when the target is ducked, and the shooter's own eye drops
    // when they are - otherwise crouching would not actually take you out of a
    // sightline, which is the whole point of it.
    const eyeH = EYE_HEIGHT - 0.5 * shooter.crouch;
    const chestH = CHEST_HEIGHT - 0.32 * victim.crouch;
    const headH = HEAD_HEIGHT - 0.5 * victim.crouch;
    const eye = [shooter.pos[0], shooter.pos[1] + eyeH, shooter.pos[2]];
    const chest = [victim.pos[0], victim.pos[1] + chestH, victim.pos[2]];
    const head = [victim.pos[0], victim.pos[1] + headH, victim.pos[2]];
    if (blocked(eye, chest, this.aabbs) && blocked(eye, head, this.aabbs)) return;

    let damage = data.part === "head" ? HEAD_DAMAGE * this.headMul : BODY_DAMAGE * this.bodyMul;
    if (now < shooter.damageUntil) damage *= DAMAGE_BUFF;
    if (this.mode.oneShot) damage = victim.hp * 2 + 999;   // survives a shield halving it
    this.damagePlayer(shooter, victim, damage, { headshot: data.part === "head" });
  }

  // One path for all damage, so shields, lifesteal and kill credit apply the
  // same wherever the damage came from.
  damagePlayer(attacker, victim, amount, opts = {}) {
    if (!victim.alive) return;
    if (Date.now() < victim.shieldUntil) amount *= SHIELD_FACTOR;
    amount = Math.max(1, Math.round(amount));          // keep health a whole number
    const dealt = Math.min(victim.hp, amount);
    victim.hp -= amount;

    if (this.lifesteal && attacker.alive && dealt > 0) {
      attacker.hp = Math.min(this.maxHp, attacker.hp + Math.round(dealt * this.lifesteal));
    }
    this.io.to(victim.id).emit("shooter-damaged", { from: attacker.name, hp: Math.max(0, victim.hp) });

    if (victim.hp <= 0) this.killPlayer(attacker, victim, !!opts.headshot, opts.weapon);
  }

  resolveTarget(shooter, data) {
    if (!shooter.alive || this.inCountdown()) return;
    const t = this.targets.get(data.id);
    if (!t || t.hp <= 0) return;

    const now = Date.now();
    if (now - shooter.lastShot < MIN_SHOT_INTERVAL) return;
    shooter.lastShot = now;
    if (dist(shooter.pos, t.pos) > MAX_RANGE) return;

    // Aim at a point just in front of the sign: signs hang on walls, and testing
    // the sign's own centre would be blocked by the wall carrying it.
    const eye = [shooter.pos[0], shooter.pos[1] + EYE_HEIGHT - 0.5 * shooter.crouch, shooter.pos[2]];
    const dx = eye[0] - t.pos[0], dy = eye[1] - t.pos[1], dz = eye[2] - t.pos[2];
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
    const face = [t.pos[0] + (dx / len) * 0.7, t.pos[1] + (dy / len) * 0.7, t.pos[2] + (dz / len) * 0.7];
    if (blocked(eye, face, this.aabbs)) return;

    let damage = BODY_DAMAGE;
    if (now < shooter.damageUntil) damage *= DAMAGE_BUFF;
    t.hp -= damage;

    if (t.hp <= 0) {
      t.hp = 0;
      t.readyAt = now + TARGET_RESPAWN_MS;
      this.io.to(this.room.code).emit("shooter-target", {
        id: t.id, by: shooter.name, byUid: shooter.uid, points: t.points, broken: true,
      });
    } else {
      this.io.to(shooter.id).emit("shooter-target-hit", { id: t.id, hp: t.hp, maxHp: t.maxHp });
    }
  }

  killPlayer(killer, victim, headshot, weapon) {
    victim.hp = 0;
    victim.alive = false;
    victim.deaths++;
    victim.respawnAt = Date.now() + RESPAWN_MS;
    killer.kills++;
    if (this.killHeal && killer.alive) killer.hp = Math.min(this.maxHp, killer.hp + this.killHeal);

    this.io.to(this.room.code).emit("shooter-kill", {
      killer: killer.name,
      killerId: killer.id,
      killerUid: killer.uid,
      victim: victim.name,
      victimId: victim.id,
      victimUid: victim.uid,
      headshot: !!headshot,
      weapon: weapon || "rifle",
    });
  }

  respawn(p) {
    // Rank spawns by how far they are from the nearest living opponent, then pick
    // at random from the safest half. Always taking the single furthest spawn is
    // deterministic, which is why players kept reappearing in the same place.
    const others = [...this.players.values()].filter((o) => o !== p && o.alive);
    const scored = this.map.spawns
      .map((sp, idx) => {
        let nearest = Infinity;
        for (const o of others) nearest = Math.min(nearest, dist(sp, o.pos));
        return { sp, idx, score: others.length ? nearest : 0 };
      })
      .filter((c) => c.idx !== p.lastSpawn || this.map.spawns.length < 3)
      .sort((a, b) => b.score - a.score);

    const pool = others.length ? Math.max(3, Math.ceil(scored.length / 2)) : scored.length;
    const pick = scored[Math.floor(Math.random() * Math.min(pool, scored.length))];
    p.lastSpawn = pick.idx;
    p.pos = pick.sp.slice();
    p.hp = this.maxHp;
    p.alive = true;
    p.damageUntil = 0;   // buffs die with you
    p.speedUntil = 0;
    p.shieldUntil = 0;
    this.io.to(p.id).emit("shooter-spawn", { pos: p.pos, hp: this.maxHp });
  }

  tick() {
    if (this.ended) return;
    const now = Date.now();

    for (const t of this.targets.values()) {
      if (t.hp <= 0 && now >= t.readyAt) {
        t.hp = t.maxHp;
        this.io.to(this.room.code).emit("shooter-target", { id: t.id, broken: false });
      }
    }

    for (const p of this.players.values()) {
      if (!p.alive && now >= p.respawnAt) { this.respawn(p); continue; }
      if (!p.alive) continue;
      // OKR room: standing inside heals you steadily (the client tightens your aim)
      p.okr = !!(this.okrZone && inZone(p.pos, this.okrZone));
      if (p.okr && p.hp < this.maxHp && now - p.lastRegen >= OKR_REGEN_MS) {
        p.hp = Math.min(this.maxHp, p.hp + OKR_REGEN);
        p.lastRegen = now;
      }
    }

    const elapsed = this.elapsed();
    this.io.to(this.room.code).emit("shooter-state", {
      t: now,
      countdown: this.inCountdown() ? Math.ceil((COUNTDOWN_MS - elapsed) / 1000) : 0,
      timeLeft: Math.max(0, Math.ceil((ROUND_MS + COUNTDOWN_MS - elapsed) / 1000)),
      pickups: [...this.pickups.values()].filter((pk) => now >= pk.readyAt).map((pk) => pk.id),
      targets: [...this.targets.values()].filter((t) => t.hp > 0).map((t) => t.id),
      players: [...this.players.values()].map((p) => ({
        id: p.id,
        uid: p.uid,
        name: p.name,
        color: p.color,
        p: p.pos,
        r: p.rot,
        c: p.crouch,
        hp: p.hp,
        alive: p.alive,
        kills: p.kills,
        deaths: p.deaths,
        ok: p.okr ? 1 : 0,
        rs: p.alive ? 0 : Math.max(0, Math.ceil((p.respawnAt - now) / 1000)),
        bd: Math.max(0, Math.ceil((p.damageUntil - now) / 1000)),
        bs: Math.max(0, Math.ceil((p.speedUntil - now) / 1000)),
        bp: Math.max(0, Math.ceil((p.shieldUntil - now) / 1000)),
      })),
    });

    if (elapsed >= ROUND_MS + COUNTDOWN_MS) this.finish();
  }

  finish() {
    if (this.ended) return;
    this.stop();

    const table = [...this.players.values()]
      .map((p) => ({
        uid: p.uid,
        name: p.name,
        kills: p.kills,
        deaths: p.deaths,
        kd: p.deaths ? p.kills / p.deaths : p.kills,
      }))
      .sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);

    this.io.to(this.room.code).emit("shooter-over", { table, endsIn: END_SCREEN_MS, mode: this.mode.name });

    // Hold the final board inside the game before handing back to the platform,
    // which is what sends everyone to the results page.
    const scores = table.map((p) => ({ name: p.name, score: p.kills }));
    this.endTimer = setTimeout(() => {
      this.endTimer = null;
      this.onEnd(scores);
    }, END_SCREEN_MS);
  }
}

module.exports = ShooterGame;
