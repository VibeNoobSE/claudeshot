// Hungry Lasse — real-time multiplayer
// Collect chickens! Players are Lasse heads, chickens spawn randomly.
// Bump other players to stun them. Most chickens in 30s wins.

const TICK_MS = 50;
const ARENA_W = 800;
const ARENA_H = 500;
const PLAYER_SPEED = 5;
const PLAYER_RADIUS = 28;
const GAME_DURATION = 30000;
const STUN_TICKS = 30;
const BUMP_FORCE = 10;
const CHICKEN_RADIUS = 20;
const MAX_CHICKENS = 6;
const COLORS = ["#f7c948", "#e94560", "#4ecca3", "#5dade2", "#af7ac5", "#ff8c42", "#42f5b0", "#f542e0"];

class HungryGame {
  constructor(room, io, onEnd) {
    this.room = room;
    this.io = io;
    this.onEnd = onEnd;
    this.players = {};
    this.chickens = [];
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
        vx: 0, vy: 0,
        color: COLORS[i % COLORS.length],
        colorIdx: i,
        score: 0,
        stunTimer: 0,
        mouthOpen: 0,
        lastEatTick: -99,
      };
    });

    // Initial chickens
    this.spawnChickens(MAX_CHICKENS);

    let countdown = 3;
    const cdInterval = setInterval(() => {
      this.io.to(this.room.code).emit("hungry-countdown", { count: countdown });
      countdown--;
      if (countdown < 0) {
        clearInterval(cdInterval);
        this.startTime = Date.now();
        this.interval = setInterval(() => this.tick(), TICK_MS);
        this.timeout = setTimeout(() => this.endGame(), GAME_DURATION);
      }
    }, 1000);
  }

  spawnChickens(count) {
    for (let i = 0; i < count; i++) {
      this.chickens.push({
        x: 60 + Math.random() * (ARENA_W - 120),
        y: 60 + Math.random() * (ARENA_H - 120),
        vx: (Math.random() - 0.5) * 2,
        vy: (Math.random() - 0.5) * 2,
        alive: true,
        panic: 0,
        id: Math.random().toString(36).slice(2, 8),
      });
    }
  }

  tick() {
    this.tickCount++;
    const elapsed = Date.now() - this.startTime;
    const timeLeft = Math.max(0, Math.ceil((GAME_DURATION - elapsed) / 1000));

    // Replenish chickens
    const aliveChickens = this.chickens.filter(c => c.alive).length;
    if (aliveChickens < MAX_CHICKENS && this.tickCount % 40 === 0) {
      this.spawnChickens(1);
    }

    // Update players
    const playerEntries = Object.entries(this.players);
    for (const [id, p] of playerEntries) {
      // Stun
      if (p.stunTimer > 0) {
        p.stunTimer--;
        p.vx *= 0.9;
        p.vy *= 0.9;
        p.x += p.vx;
        p.y += p.vy;
        p.x = Math.max(PLAYER_RADIUS, Math.min(ARENA_W - PLAYER_RADIUS, p.x));
        p.y = Math.max(PLAYER_RADIUS, Math.min(ARENA_H - PLAYER_RADIUS, p.y));
        continue;
      }

      // Movement
      p.x += p.dx * PLAYER_SPEED + p.vx;
      p.y += p.dy * PLAYER_SPEED + p.vy;
      p.vx *= 0.85;
      p.vy *= 0.85;
      if (Math.abs(p.vx) < 0.1) p.vx = 0;
      if (Math.abs(p.vy) < 0.1) p.vy = 0;
      p.x = Math.max(PLAYER_RADIUS, Math.min(ARENA_W - PLAYER_RADIUS, p.x));
      p.y = Math.max(PLAYER_RADIUS, Math.min(ARENA_H - PLAYER_RADIUS, p.y));

      // Mouth animation decay
      p.mouthOpen = Math.max(0, p.mouthOpen - 0.05);

      // Chicken collection
      for (const c of this.chickens) {
        if (!c.alive) continue;
        const dx = p.x - c.x;
        const dy = p.y - c.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < PLAYER_RADIUS + CHICKEN_RADIUS) {
          c.alive = false;
          p.score++;
          p.mouthOpen = 1;
          p.lastEatTick = this.tickCount;
        }
      }
    }

    // Player-to-player bumping
    for (let i = 0; i < playerEntries.length; i++) {
      for (let j = i + 1; j < playerEntries.length; j++) {
        const [, a] = playerEntries[i];
        const [, b] = playerEntries[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < PLAYER_RADIUS * 2) {
          const nx = dx / (dist || 1);
          const ny = dy / (dist || 1);
          // Moving player stuns the stationary one
          const aMoving = Math.abs(a.dx) + Math.abs(a.dy) > 0;
          const bMoving = Math.abs(b.dx) + Math.abs(b.dy) > 0;
          b.vx += nx * BUMP_FORCE;
          b.vy += ny * BUMP_FORCE;
          a.vx -= nx * BUMP_FORCE;
          a.vy -= ny * BUMP_FORCE;
          if (aMoving && b.stunTimer <= 0) b.stunTimer = STUN_TICKS;
          if (bMoving && a.stunTimer <= 0) a.stunTimer = STUN_TICKS;
        }
      }
    }

    // Chicken AI — flee from nearest player
    for (const c of this.chickens) {
      if (!c.alive) continue;
      let nearestDist = 999;
      let fleeX = 0, fleeY = 0;
      for (const [, p] of playerEntries) {
        const dx = p.x - c.x;
        const dy = p.y - c.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < nearestDist) {
          nearestDist = dist;
          fleeX = -dx / (dist || 1);
          fleeY = -dy / (dist || 1);
        }
      }
      c.panic = Math.max(0, 1 - nearestDist / 200);
      if (nearestDist < 200) {
        const fleeSpeed = 2 + c.panic * 3;
        c.vx += fleeX * fleeSpeed * 0.15;
        c.vy += fleeY * fleeSpeed * 0.15;
      } else {
        c.vx += (Math.random() - 0.5) * 0.3;
        c.vy += (Math.random() - 0.5) * 0.3;
      }
      c.vx *= 0.92;
      c.vy *= 0.92;
      const spd = Math.sqrt(c.vx ** 2 + c.vy ** 2);
      if (spd > 4) { c.vx *= 4 / spd; c.vy *= 4 / spd; }
      c.x += c.vx;
      c.y += c.vy;
      if (c.x < CHICKEN_RADIUS || c.x > ARENA_W - CHICKEN_RADIUS) c.vx *= -1;
      if (c.y < CHICKEN_RADIUS || c.y > ARENA_H - CHICKEN_RADIUS) c.vy *= -1;
      c.x = Math.max(CHICKEN_RADIUS, Math.min(ARENA_W - CHICKEN_RADIUS, c.x));
      c.y = Math.max(CHICKEN_RADIUS, Math.min(ARENA_H - CHICKEN_RADIUS, c.y));
    }

    // Clean dead chickens after a bit
    this.chickens = this.chickens.filter(c => c.alive);

    // Broadcast
    const playerList = playerEntries.map(([id, p]) => ({
      id, name: p.name, x: Math.round(p.x), y: Math.round(p.y),
      color: p.color, colorIdx: p.colorIdx, score: p.score,
      stunned: p.stunTimer > 0, mouthOpen: p.mouthOpen,
      justAte: this.tickCount - p.lastEatTick < 10,
    }));

    this.io.to(this.room.code).emit("hungry-state", {
      players: playerList,
      chickens: this.chickens.filter(c => c.alive).map(c => ({
        x: Math.round(c.x), y: Math.round(c.y), panic: c.panic, id: c.id,
      })),
      timeLeft,
      arenaW: ARENA_W,
      arenaH: ARENA_H,
    });
  }

  endGame() {
    if (this.finished) return;
    this.finished = true;
    this.stop();
    const scores = Object.values(this.players).map(p => ({
      name: p.name,
      score: p.score,
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
    if (!p) return;
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

module.exports = HungryGame;
