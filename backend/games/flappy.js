// Flappy Bird — parallel singleplayer
// Everyone plays simultaneously, you see when others die. Last alive or highest score wins.

const TICK_MS = 30;
const GAME_W = 400;
const GAME_H = 500;
const GRAVITY = 0.5;
const FLAP_POWER = -7;
const PIPE_SPEED = 2.5;
const PIPE_GAP = 140;
const PIPE_INTERVAL = 90; // ticks between pipes
const BIRD_X = 80;
const BIRD_RADIUS = 12;

class FlappyGame {
  constructor(room, io, onEnd) {
    this.room = room;
    this.io = io;
    this.onEnd = onEnd;
    this.players = {};
    this.pipes = [];
    this.interval = null;
    this.tickCount = 0;
    this.finished = false;
  }

  start() {
    this.room.players.forEach((p, i) => {
      this.players[p.id] = {
        name: p.name,
        y: GAME_H / 2,
        vy: 0,
        alive: true,
        score: 0,
        colorIdx: i,
      };
    });

    // Countdown
    let countdown = 3;
    const cdInterval = setInterval(() => {
      this.io.to(this.room.code).emit("flappy-countdown", { count: countdown });
      countdown--;
      if (countdown < 0) {
        clearInterval(cdInterval);
        this.interval = setInterval(() => this.tick(), TICK_MS);
      }
    }, 1000);
  }

  tick() {
    this.tickCount++;

    // Spawn pipes
    if (this.tickCount % PIPE_INTERVAL === 0) {
      const gapY = 60 + Math.random() * (GAME_H - 60 - PIPE_GAP);
      this.pipes.push({ x: GAME_W + 20, gapY, scored: false });
    }

    // Move pipes
    this.pipes.forEach(pipe => { pipe.x -= PIPE_SPEED; });
    this.pipes = this.pipes.filter(p => p.x > -60);

    let aliveCount = 0;
    for (const [id, p] of Object.entries(this.players)) {
      if (!p.alive) continue;
      aliveCount++;

      // Physics
      p.vy += GRAVITY;
      p.y += p.vy;

      // Floor/ceiling
      if (p.y < BIRD_RADIUS || p.y > GAME_H - BIRD_RADIUS) {
        p.alive = false;
        continue;
      }

      // Pipe collision
      for (const pipe of this.pipes) {
        if (Math.abs(BIRD_X - pipe.x) < 26) {
          if (p.y - BIRD_RADIUS < pipe.gapY || p.y + BIRD_RADIUS > pipe.gapY + PIPE_GAP) {
            p.alive = false;
            break;
          }
        }
        // Score
        if (!pipe.scored && pipe.x < BIRD_X - 26) {
          // Only score once per pipe per player — use a set
          if (!pipe._scoredBy) pipe._scoredBy = new Set();
          if (!pipe._scoredBy.has(id)) {
            pipe._scoredBy.add(id);
            p.score++;
          }
        }
      }
    }

    // Mark pipes as scored globally
    this.pipes.forEach(pipe => {
      if (pipe.x < BIRD_X - 26) pipe.scored = true;
    });

    // Broadcast state
    const playerList = Object.entries(this.players).map(([id, p]) => ({
      id, name: p.name, y: Math.round(p.y), alive: p.alive,
      score: p.score, colorIdx: p.colorIdx,
    }));

    this.io.to(this.room.code).emit("flappy-state", {
      players: playerList,
      pipes: this.pipes.map(p => ({ x: Math.round(p.x), gapY: Math.round(p.gapY) })),
      gameW: GAME_W,
      gameH: GAME_H,
      birdX: BIRD_X,
      pipeGap: PIPE_GAP,
    });

    // End when all dead
    if (aliveCount === 0 && !this.finished) {
      this.endGame();
    }
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
    this.interval = null;
  }

  setInput(socketId, data) {
    const p = this.players[socketId];
    if (!p || !p.alive) return;
    if (data.action === "flap") {
      p.vy = FLAP_POWER;
    }
  }

  updatePlayerId(oldId, newId) {
    if (this.players[oldId]) {
      this.players[newId] = this.players[oldId];
      delete this.players[oldId];
    }
  }
}

module.exports = FlappyGame;
