// Hungry Lasse — real-time multiplayer
// Phase 1: Chicken Room (60s) → Phase 2: Dessert Room (60s) → LONGSHOT TWIST (10s)
// Collect food! Players are Lasse heads. Bump others to stun!

const TICK_MS = 50;
const ARENA_W = 1200;
const ARENA_H = 700;
const PLAYER_SPEED = 5.5;
const PLAYER_RADIUS = 28;
const STUN_TICKS = 30;
const BUMP_FORCE = 12;
const CHICKEN_RADIUS = 20;
const POWERUP_RADIUS = 18;
const POWERUP_TYPES = ["speed", "magnet", "ghost"];
const POWERUP_DURATION = 150; // ticks (~7.5s)
const COLORS = ["#f7c948", "#e94560", "#4ecca3", "#5dade2", "#af7ac5", "#ff8c42", "#42f5b0", "#f542e0"];

// Phase durations in ms
const PHASE1_DURATION = 60000;  // Chicken Room
const PHASE2_DURATION = 60000;  // Dessert Room
const TWIST_DURATION = 20000;   // LONGSHOT TWIST
const TOTAL_DURATION = PHASE1_DURATION + PHASE2_DURATION + TWIST_DURATION;

// Obstacle layouts per phase
const OBSTACLE_SETS = {
  // Phase 1: Chicken Room
  chicken_small: [
    { x: 280, y: 180, w: 90, h: 90 },
    { x: 830, y: 180, w: 90, h: 90 },
    { x: 550, y: 300, w: 100, h: 100 },
    { x: 280, y: 430, w: 90, h: 90 },
    { x: 830, y: 430, w: 90, h: 90 },
  ],
  chicken_large: [
    { x: 200, y: 140, w: 80, h: 80 },
    { x: 500, y: 80, w: 80, h: 80 },
    { x: 920, y: 140, w: 80, h: 80 },
    { x: 350, y: 300, w: 100, h: 100 },
    { x: 750, y: 300, w: 100, h: 100 },
    { x: 200, y: 480, w: 80, h: 80 },
    { x: 550, y: 520, w: 80, h: 80 },
    { x: 920, y: 480, w: 80, h: 80 },
  ],
  // Phase 2: Dessert Room — more maze-like
  dessert_small: [
    { x: 150, y: 100, w: 120, h: 40 },
    { x: 930, y: 100, w: 120, h: 40 },
    { x: 500, y: 200, w: 200, h: 40 },
    { x: 300, y: 350, w: 40, h: 150 },
    { x: 860, y: 350, w: 40, h: 150 },
    { x: 500, y: 460, w: 200, h: 40 },
    { x: 150, y: 560, w: 120, h: 40 },
    { x: 930, y: 560, w: 120, h: 40 },
  ],
  dessert_large: [
    { x: 100, y: 80, w: 140, h: 40 },
    { x: 960, y: 80, w: 140, h: 40 },
    { x: 450, y: 150, w: 300, h: 40 },
    { x: 200, y: 280, w: 40, h: 140 },
    { x: 960, y: 280, w: 40, h: 140 },
    { x: 550, y: 320, w: 100, h: 60 },
    { x: 200, y: 480, w: 40, h: 140 },
    { x: 960, y: 480, w: 40, h: 140 },
    { x: 450, y: 510, w: 300, h: 40 },
    { x: 100, y: 580, w: 140, h: 40 },
    { x: 960, y: 580, w: 140, h: 40 },
  ],
};

class HungryGame {
  constructor(room, io, onEnd) {
    this.room = room;
    this.io = io;
    this.onEnd = onEnd;
    this.players = {};
    this.chickens = [];
    this.obstacles = [];
    this.powerups = [];
    this.nextPowerupId = 0;
    this.interval = null;
    this.timeout = null;
    this.tickCount = 0;
    this.finished = false;
    this.phase = 1;           // 1 = chicken, 2 = dessert, 3 = twist
    this.phaseTransitioning = false;
    this.twistActivated = false;
  }

  start() {
    const n = this.room.players.length;
    this.playerCount = n;
    this.maxChickens = Math.min(4 + n * 2, 16);

    // Phase 1 obstacles
    this.obstacles = JSON.parse(JSON.stringify(n >= 4 ? OBSTACLE_SETS.chicken_large : OBSTACLE_SETS.chicken_small));

    this.room.players.forEach((p, i) => {
      const angle = (i / n) * Math.PI * 2;
      this.players[p.id] = {
        name: p.name,
        x: ARENA_W / 2 + Math.cos(angle) * 180,
        y: ARENA_H / 2 + Math.sin(angle) * 180,
        dx: 0, dy: 0,
        vx: 0, vy: 0,
        color: COLORS[i % COLORS.length],
        colorIdx: i,
        score: 0,
        stunTimer: 0,
        mouthOpen: 0,
        lastEatTick: -99,
        powerup: null,
        powerupTimer: 0,
      };
    });

    // Initial chickens
    this.spawnChickens(this.maxChickens);

    let countdown = 3;
    const cdInterval = setInterval(() => {
      this.io.to(this.room.code).emit("hungry-countdown", { count: countdown });
      countdown--;
      if (countdown < 0) {
        clearInterval(cdInterval);
        this.startTime = Date.now();
        this.interval = setInterval(() => this.tick(), TICK_MS);
        this.timeout = setTimeout(() => this.endGame(), TOTAL_DURATION);
      }
    }, 1000);
  }

  spawnChickens(count) {
    for (let i = 0; i < count; i++) {
      let x, y, tries = 0;
      do {
        x = 60 + Math.random() * (ARENA_W - 120);
        y = 60 + Math.random() * (ARENA_H - 120);
        tries++;
      } while (tries < 20 && this.collidesObstacle(x, y, CHICKEN_RADIUS));

      this.chickens.push({
        x, y,
        vx: (Math.random() - 0.5) * 2,
        vy: (Math.random() - 0.5) * 2,
        alive: true,
        panic: 0,
        id: Math.random().toString(36).slice(2, 8),
      });
    }
  }

  spawnCookies(count) {
    for (let i = 0; i < count; i++) {
      let x, y, tries = 0;
      do {
        x = 60 + Math.random() * (ARENA_W - 120);
        y = 60 + Math.random() * (ARENA_H - 120);
        tries++;
      } while (tries < 20 && this.collidesObstacle(x, y, CHICKEN_RADIUS));

      this.chickens.push({
        x, y,
        vx: (Math.random() - 0.5) * 3,
        vy: (Math.random() - 0.5) * 3,
        alive: true,
        panic: 0,
        id: "cookie_" + Math.random().toString(36).slice(2, 8),
        cookie: true,
        value: 2,
      });
    }
  }

  spawnPowerup() {
    let x, y, tries = 0;
    do {
      x = 80 + Math.random() * (ARENA_W - 160);
      y = 80 + Math.random() * (ARENA_H - 160);
      tries++;
    } while (tries < 20 && this.collidesObstacle(x, y, POWERUP_RADIUS));

    this.powerups.push({
      x, y,
      type: POWERUP_TYPES[Math.floor(Math.random() * POWERUP_TYPES.length)],
      id: this.nextPowerupId++,
      spawnTick: this.tickCount,
    });
  }

  collidesObstacle(px, py, radius) {
    for (const o of this.obstacles) {
      const closestX = Math.max(o.x, Math.min(o.x + o.w, px));
      const closestY = Math.max(o.y, Math.min(o.y + o.h, py));
      const dx = px - closestX;
      const dy = py - closestY;
      if (dx * dx + dy * dy < radius * radius) return true;
    }
    return false;
  }

  pushOutOfObstacles(px, py, radius) {
    let x = px, y = py;
    for (const o of this.obstacles) {
      const closestX = Math.max(o.x, Math.min(o.x + o.w, x));
      const closestY = Math.max(o.y, Math.min(o.y + o.h, y));
      const dx = x - closestX;
      const dy = y - closestY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < radius && dist > 0) {
        const nx = dx / dist;
        const ny = dy / dist;
        x = closestX + nx * radius;
        y = closestY + ny * radius;
      }
    }
    return { x, y };
  }

  transitionToPhase2() {
    this.phase = 2;
    this.phaseTransitioning = true;

    // Clear old chickens and powerups
    this.chickens = [];
    this.powerups = [];

    // New dessert room obstacles
    this.obstacles = JSON.parse(JSON.stringify(
      this.playerCount >= 4 ? OBSTACLE_SETS.dessert_large : OBSTACLE_SETS.dessert_small
    ));

    // Push players out of new obstacles
    for (const [, p] of Object.entries(this.players)) {
      const pushed = this.pushOutOfObstacles(p.x, p.y, PLAYER_RADIUS);
      p.x = pushed.x; p.y = pushed.y;
      p.stunTimer = 0;
      p.powerup = null;
      p.powerupTimer = 0;
    }

    // Spawn cookies
    this.spawnCookies(this.maxChickens + 2);

    // Emit phase change event
    this.io.to(this.room.code).emit("hungry-phase", { phase: 2, name: "DESSERT ROOM" });

    setTimeout(() => { this.phaseTransitioning = false; }, 100);
  }

  activateTwist() {
    this.phase = 3;
    this.twistActivated = true;
    this.io.to(this.room.code).emit("hungry-twist");

    // Spawn golden chickens worth 5 pts
    for (let i = 0; i < 5; i++) {
      let x, y, tries = 0;
      do {
        x = 60 + Math.random() * (ARENA_W - 120);
        y = 60 + Math.random() * (ARENA_H - 120);
        tries++;
      } while (tries < 10 && this.collidesObstacle(x, y, CHICKEN_RADIUS));
      this.chickens.push({
        x, y,
        vx: (Math.random() - 0.5) * 6,
        vy: (Math.random() - 0.5) * 6,
        alive: true,
        panic: 0,
        id: "gold_" + Math.random().toString(36).slice(2, 8),
        golden: true,
        value: 5,
      });
    }

    // Clear all stuns
    for (const [, p] of Object.entries(this.players)) {
      p.stunTimer = 0;
    }
  }

  tick() {
    this.tickCount++;
    const elapsed = Date.now() - this.startTime;
    const totalTimeLeft = Math.max(0, Math.ceil((TOTAL_DURATION - elapsed) / 1000));

    // Phase transitions
    if (this.phase === 1 && elapsed >= PHASE1_DURATION) {
      this.transitionToPhase2();
    }
    if (this.phase === 2 && elapsed >= PHASE1_DURATION + PHASE2_DURATION && !this.twistActivated) {
      this.activateTwist();
    }

    // Phase-specific time display
    let phaseTimeLeft;
    if (this.phase === 1) {
      phaseTimeLeft = Math.max(0, Math.ceil((PHASE1_DURATION - elapsed) / 1000));
    } else if (this.phase === 2) {
      phaseTimeLeft = Math.max(0, Math.ceil((PHASE1_DURATION + PHASE2_DURATION - elapsed) / 1000));
    } else {
      phaseTimeLeft = Math.max(0, Math.ceil((TOTAL_DURATION - elapsed) / 1000));
    }

    // Replenish food
    const aliveFood = this.chickens.filter(c => c.alive).length;
    const maxFood = this.phase === 2 ? this.maxChickens + 2 : this.maxChickens;
    if (aliveFood < maxFood && this.tickCount % 30 === 0) {
      if (this.phase === 2 && !this.twistActivated) {
        this.spawnCookies(1);
      } else {
        this.spawnChickens(1);
      }
    }

    // Spawn power-ups: ~3% chance per tick, max 2 on field
    // Phase 2: slightly more frequent
    const puChance = this.phase >= 2 ? 0.04 : 0.03;
    if (this.tickCount > 20 && Math.random() < puChance && this.powerups.length < 2) {
      this.spawnPowerup();
    }

    // Update players
    const playerEntries = Object.entries(this.players);
    for (const [, p] of playerEntries) {
      // Power-up timer
      if (p.powerupTimer > 0) {
        p.powerupTimer--;
        if (p.powerupTimer <= 0) p.powerup = null;
      }

      // Stun
      if (p.stunTimer > 0) {
        p.stunTimer--;
        p.vx *= 0.9;
        p.vy *= 0.9;
        p.x += p.vx;
        p.y += p.vy;
        p.x = Math.max(PLAYER_RADIUS, Math.min(ARENA_W - PLAYER_RADIUS, p.x));
        p.y = Math.max(PLAYER_RADIUS, Math.min(ARENA_H - PLAYER_RADIUS, p.y));
        const pushed = this.pushOutOfObstacles(p.x, p.y, PLAYER_RADIUS);
        p.x = pushed.x; p.y = pushed.y;
        continue;
      }

      // Movement (reversed + boosted during twist)
      let speed = p.powerup === "speed" ? PLAYER_SPEED * 1.6 : PLAYER_SPEED;
      // Phase 2: slightly faster base speed
      if (this.phase >= 2) speed *= 1.1;
      const dir = this.twistActivated ? -1 : 1;
      if (this.twistActivated) speed *= 1.3;
      p.x += p.dx * speed * dir + p.vx;
      p.y += p.dy * speed * dir + p.vy;
      p.vx *= 0.85;
      p.vy *= 0.85;
      if (Math.abs(p.vx) < 0.1) p.vx = 0;
      if (Math.abs(p.vy) < 0.1) p.vy = 0;
      p.x = Math.max(PLAYER_RADIUS, Math.min(ARENA_W - PLAYER_RADIUS, p.x));
      p.y = Math.max(PLAYER_RADIUS, Math.min(ARENA_H - PLAYER_RADIUS, p.y));

      // Obstacle collision (ghost walks through)
      if (p.powerup !== "ghost") {
        const pushed = this.pushOutOfObstacles(p.x, p.y, PLAYER_RADIUS);
        p.x = pushed.x; p.y = pushed.y;
      }

      // Mouth animation decay
      p.mouthOpen = Math.max(0, p.mouthOpen - 0.05);

      // Food collection
      const collectRadius = p.powerup === "magnet" ? PLAYER_RADIUS + CHICKEN_RADIUS + 40 : PLAYER_RADIUS + CHICKEN_RADIUS;
      for (const c of this.chickens) {
        if (!c.alive) continue;
        const dx = p.x - c.x;
        const dy = p.y - c.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        // Magnet pull
        if (p.powerup === "magnet" && dist < 150) {
          c.vx += dx / (dist || 1) * 1.5;
          c.vy += dy / (dist || 1) * 1.5;
        }

        if (dist < collectRadius) {
          c.alive = false;
          p.score += c.value || 1;
          p.mouthOpen = 1;
          p.lastEatTick = this.tickCount;
        }
      }

      // Power-up collection
      for (let i = this.powerups.length - 1; i >= 0; i--) {
        const pu = this.powerups[i];
        const dx = p.x - pu.x;
        const dy = p.y - pu.y;
        if (Math.sqrt(dx * dx + dy * dy) < PLAYER_RADIUS + POWERUP_RADIUS) {
          p.powerup = pu.type;
          p.powerupTimer = POWERUP_DURATION;
          this.powerups.splice(i, 1);
        }
      }
    }

    // Player-to-player bumping (double stun in phase 2+)
    const stunMultiplier = this.phase >= 2 ? 1.5 : 1;
    for (let i = 0; i < playerEntries.length; i++) {
      for (let j = i + 1; j < playerEntries.length; j++) {
        const [, a] = playerEntries[i];
        const [, b] = playerEntries[j];
        if (a.powerup === "ghost" || b.powerup === "ghost") continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < PLAYER_RADIUS * 2) {
          const nx = dx / (dist || 1);
          const ny = dy / (dist || 1);
          const aMoving = Math.abs(a.dx) + Math.abs(a.dy) > 0;
          const bMoving = Math.abs(b.dx) + Math.abs(b.dy) > 0;
          b.vx += nx * BUMP_FORCE;
          b.vy += ny * BUMP_FORCE;
          a.vx -= nx * BUMP_FORCE;
          a.vy -= ny * BUMP_FORCE;
          if (aMoving && b.stunTimer <= 0) b.stunTimer = Math.round(STUN_TICKS * stunMultiplier);
          if (bMoving && a.stunTimer <= 0) a.stunTimer = Math.round(STUN_TICKS * stunMultiplier);
        }
      }
    }

    // Food AI — flee from nearest player, bounce off obstacles
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
      const isGolden = c.golden;
      const isCookie = c.cookie;
      // Cookies flee less aggressively than chickens, golden flee most
      const fleeRange = isGolden ? 350 : (isCookie ? 160 : 200);
      c.panic = Math.max(0, 1 - nearestDist / fleeRange);
      if (nearestDist < fleeRange) {
        const fleeSpeed = isGolden ? (4 + c.panic * 5) : (isCookie ? (2 + c.panic * 2.5) : (2.5 + c.panic * 3.5));
        const fleeMult = isGolden ? 0.25 : (isCookie ? 0.12 : 0.15);
        c.vx += fleeX * fleeSpeed * fleeMult;
        c.vy += fleeY * fleeSpeed * fleeMult;
      } else {
        const wander = isGolden ? 0.8 : (isCookie ? 0.4 : 0.3);
        c.vx += (Math.random() - 0.5) * wander;
        c.vy += (Math.random() - 0.5) * wander;
      }
      const drag = isGolden ? 0.95 : (isCookie ? 0.90 : 0.92);
      c.vx *= drag;
      c.vy *= drag;
      const maxSpd = isGolden ? 7 : (isCookie ? 4 : 4.5);
      const spd = Math.sqrt(c.vx ** 2 + c.vy ** 2);
      if (spd > maxSpd) { c.vx *= maxSpd / spd; c.vy *= maxSpd / spd; }
      c.x += c.vx;
      c.y += c.vy;

      // Obstacle bounce
      const pushed = this.pushOutOfObstacles(c.x, c.y, CHICKEN_RADIUS);
      if (pushed.x !== c.x || pushed.y !== c.y) {
        c.vx *= -0.5; c.vy *= -0.5;
        c.x = pushed.x; c.y = pushed.y;
      }

      if (c.x < CHICKEN_RADIUS || c.x > ARENA_W - CHICKEN_RADIUS) c.vx *= -1;
      if (c.y < CHICKEN_RADIUS || c.y > ARENA_H - CHICKEN_RADIUS) c.vy *= -1;
      c.x = Math.max(CHICKEN_RADIUS, Math.min(ARENA_W - CHICKEN_RADIUS, c.x));
      c.y = Math.max(CHICKEN_RADIUS, Math.min(ARENA_H - CHICKEN_RADIUS, c.y));
    }

    // Clean dead food
    this.chickens = this.chickens.filter(c => c.alive);

    // Despawn old power-ups after ~10s
    this.powerups = this.powerups.filter(pu => this.tickCount - pu.spawnTick < 200);

    // Broadcast
    const playerList = playerEntries.map(([id, p]) => ({
      id, name: p.name, x: Math.round(p.x), y: Math.round(p.y),
      color: p.color, colorIdx: p.colorIdx, score: p.score,
      stunned: p.stunTimer > 0, mouthOpen: p.mouthOpen,
      justAte: this.tickCount - p.lastEatTick < 10,
      powerup: p.powerup,
    }));

    this.io.to(this.room.code).emit("hungry-state", {
      players: playerList,
      chickens: this.chickens.filter(c => c.alive).map(c => ({
        x: Math.round(c.x), y: Math.round(c.y), panic: c.panic, id: c.id,
        golden: c.golden || false, cookie: c.cookie || false, value: c.value || 1,
      })),
      powerups: this.powerups.map(pu => ({
        x: Math.round(pu.x), y: Math.round(pu.y), type: pu.type, id: pu.id,
      })),
      obstacles: this.obstacles,
      timeLeft: phaseTimeLeft,
      totalTimeLeft,
      phase: this.phase,
      twist: this.twistActivated,
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
