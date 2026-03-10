// Battle Royale — real-time multiplayer
// Shrinking arena, bump others into the zone, collect health. Last alive wins.

const TICK_MS = 50;
const ARENA_W = 800;
const ARENA_H = 500;
const PLAYER_SPEED = 5;
const DASH_SPEED = 14;
const DASH_TICKS = 6;
const DASH_COOLDOWN = 40; // ticks
const PLAYER_RADIUS = 14;
const BUMP_FORCE = 12;
const ZONE_DAMAGE = 0.6;
const PICKUP_HEAL = 30;
const INITIAL_HP = 100;
const GAME_DURATION = 45000; // 45s max
const COLORS = ["#f7c948", "#e94560", "#4ecca3", "#5dade2", "#af7ac5", "#ff8c42", "#42f5b0", "#f542e0"];

class RoyaleGame {
  constructor(room, io, onEnd) {
    this.room = room;
    this.io = io;
    this.onEnd = onEnd;
    this.players = {};
    this.pickups = [];
    this.zoneRadius = 350;
    this.zoneCx = ARENA_W / 2;
    this.zoneCy = ARENA_H / 2;
    this.interval = null;
    this.timeout = null;
    this.tickCount = 0;
    this.finished = false;
  }

  start() {
    const n = this.room.players.length;
    this.room.players.forEach((p, i) => {
      const angle = (i / n) * Math.PI * 2;
      this.players[p.id] = {
        name: p.name,
        x: ARENA_W / 2 + Math.cos(angle) * 120,
        y: ARENA_H / 2 + Math.sin(angle) * 120,
        dx: 0, dy: 0,
        vx: 0, vy: 0, // velocity from bumps
        hp: INITIAL_HP,
        alive: true,
        color: COLORS[i % COLORS.length],
        colorIdx: i,
        survivalTime: 0,
        kills: 0,
        dashCooldown: 0,
        dashing: 0,
        dashDx: 0, dashDy: 0,
      };
    });

    // Spawn pickups
    this.spawnPickups(10);

    let countdown = 3;
    const cdInterval = setInterval(() => {
      this.io.to(this.room.code).emit("royale-countdown", { count: countdown });
      countdown--;
      if (countdown < 0) {
        clearInterval(cdInterval);
        this.interval = setInterval(() => this.tick(), TICK_MS);
        this.timeout = setTimeout(() => this.endGame(), GAME_DURATION);
      }
    }, 1000);
  }

  spawnPickups(count) {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = Math.random() * (this.zoneRadius - 40);
      this.pickups.push({
        x: this.zoneCx + Math.cos(angle) * dist,
        y: this.zoneCy + Math.sin(angle) * dist,
        active: true,
      });
    }
  }

  tick() {
    this.tickCount++;

    // Zone shrinks faster over time
    const shrinkRate = 0.15 + this.tickCount * 0.0003;
    this.zoneRadius = Math.max(30, this.zoneRadius - shrinkRate);

    // Spawn pickups periodically
    if (this.tickCount % 100 === 0) this.spawnPickups(3);

    // Deactivate pickups outside zone
    this.pickups.forEach(pu => {
      if (!pu.active) return;
      const d = Math.sqrt((pu.x - this.zoneCx) ** 2 + (pu.y - this.zoneCy) ** 2);
      if (d > this.zoneRadius) pu.active = false;
    });

    let aliveCount = 0;
    const alivePlayers = [];

    for (const [id, p] of Object.entries(this.players)) {
      if (!p.alive) continue;
      aliveCount++;
      alivePlayers.push([id, p]);
      p.survivalTime++;
      if (p.dashCooldown > 0) p.dashCooldown--;

      // Movement
      let speed = PLAYER_SPEED;
      if (p.dashing > 0) {
        speed = DASH_SPEED;
        p.dashing--;
        p.x += p.dashDx * speed;
        p.y += p.dashDy * speed;
      } else {
        p.x += p.dx * speed;
        p.y += p.dy * speed;
      }

      // Apply bump velocity (decaying)
      p.x += p.vx;
      p.y += p.vy;
      p.vx *= 0.85;
      p.vy *= 0.85;
      if (Math.abs(p.vx) < 0.1) p.vx = 0;
      if (Math.abs(p.vy) < 0.1) p.vy = 0;

      // Clamp to arena
      p.x = Math.max(PLAYER_RADIUS, Math.min(ARENA_W - PLAYER_RADIUS, p.x));
      p.y = Math.max(PLAYER_RADIUS, Math.min(ARENA_H - PLAYER_RADIUS, p.y));

      // Zone damage
      const dist = Math.sqrt((p.x - this.zoneCx) ** 2 + (p.y - this.zoneCy) ** 2);
      if (dist > this.zoneRadius) {
        const outside = (dist - this.zoneRadius) / 50; // more damage further out
        p.hp -= ZONE_DAMAGE + outside * 0.3;
        if (p.hp <= 0) { p.hp = 0; p.alive = false; }
      }

      // Pickup collection
      this.pickups.forEach(pu => {
        if (!pu.active) return;
        const d = Math.sqrt((p.x - pu.x) ** 2 + (p.y - pu.y) ** 2);
        if (d < PLAYER_RADIUS + 8) {
          pu.active = false;
          p.hp = Math.min(INITIAL_HP, p.hp + PICKUP_HEAL);
        }
      });
    }

    // Player-to-player bumping
    for (let i = 0; i < alivePlayers.length; i++) {
      for (let j = i + 1; j < alivePlayers.length; j++) {
        const [idA, a] = alivePlayers[i];
        const [idB, b] = alivePlayers[j];
        if (!a.alive || !b.alive) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < PLAYER_RADIUS * 2) {
          const nx = dx / (dist || 1);
          const ny = dy / (dist || 1);
          // Whoever is dashing gets a bigger bump
          const aForce = a.dashing > 0 ? BUMP_FORCE * 1.5 : BUMP_FORCE * 0.6;
          const bForce = b.dashing > 0 ? BUMP_FORCE * 1.5 : BUMP_FORCE * 0.6;
          b.vx += nx * aForce;
          b.vy += ny * aForce;
          a.vx -= nx * bForce;
          a.vy -= ny * bForce;
          // Small damage on collision
          a.hp -= 3;
          b.hp -= 3;
          if (a.hp <= 0) { a.hp = 0; a.alive = false; b.kills++; }
          if (b.hp <= 0) { b.hp = 0; b.alive = false; a.kills++; }
        }
      }
    }

    // Broadcast
    const playerList = Object.entries(this.players).map(([id, p]) => ({
      id, name: p.name, x: Math.round(p.x), y: Math.round(p.y),
      hp: Math.round(p.hp), alive: p.alive, color: p.color,
      dashing: p.dashing > 0, kills: p.kills, dashReady: p.dashCooldown <= 0,
    }));

    this.io.to(this.room.code).emit("royale-state", {
      players: playerList,
      pickups: this.pickups.filter(p => p.active).map(p => ({ x: Math.round(p.x), y: Math.round(p.y) })),
      zoneRadius: Math.round(this.zoneRadius),
      zoneCx: this.zoneCx, zoneCy: this.zoneCy,
      arenaW: ARENA_W, arenaH: ARENA_H,
    });

    // End conditions
    const realAlive = Object.values(this.players).filter(p => p.alive).length;
    const totalPlayers = Object.keys(this.players).length;
    if (totalPlayers > 1 && realAlive <= 1) this.endGame();
    if (realAlive === 0) this.endGame();
  }

  endGame() {
    if (this.finished) return;
    this.finished = true;
    this.stop();
    const scores = Object.values(this.players).map(p => ({
      name: p.name,
      score: Math.round(p.survivalTime / 2) + (p.alive ? 200 : 0) + p.kills * 50,
    }));
    this.onEnd(scores);
  }

  stop() {
    if (this.interval) clearInterval(this.interval);
    if (this.timeout) clearTimeout(this.timeout);
    this.interval = null;
    this.timeout = null;
  }

  setInput(socketId, data) {
    const p = this.players[socketId];
    if (!p || !p.alive) return;
    if (data.action === "dash") {
      if (p.dashCooldown <= 0 && (p.dx !== 0 || p.dy !== 0)) {
        const len = Math.sqrt(p.dx * p.dx + p.dy * p.dy) || 1;
        p.dashDx = p.dx / len;
        p.dashDy = p.dy / len;
        p.dashing = DASH_TICKS;
        p.dashCooldown = DASH_COOLDOWN;
      }
      return;
    }
    p.dx = data.dx || 0;
    p.dy = data.dy || 0;
  }

  updatePlayerId(oldId, newId) {
    if (this.players[oldId]) {
      this.players[newId] = this.players[oldId];
      delete this.players[oldId];
    }
  }
}

module.exports = RoyaleGame;
