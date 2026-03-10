// Paint Battle — real-time multiplayer
// Players race to cover the most tiles in their color

const COLORS = ["#f7c948", "#e94560", "#4ecca3", "#5dade2", "#af7ac5", "#ff8c42", "#42f5b0", "#f542e0"];
const GRID_W = 40;
const GRID_H = 30;
const TICK_MS = 80;
const GAME_DURATION = 30000;

class PaintGame {
  constructor(room, io, onEnd) {
    this.room = room;
    this.io = io;
    this.onEnd = onEnd;
    this.grid = Array.from({ length: GRID_H }, () => new Int8Array(GRID_W).fill(-1));
    this.players = {};
    this.scores = {};       // color -> tile count, maintained incrementally
    this.dirtyTiles = [];   // changed since last emit
    this.interval = null;
    this.timeout = null;
    this.fullSyncTick = 0;
  }

  start() {
    const spawns = [
      { x: 3, y: 3 }, { x: GRID_W - 4, y: GRID_H - 4 },
      { x: GRID_W - 4, y: 3 }, { x: 3, y: GRID_H - 4 },
      { x: Math.floor(GRID_W / 2), y: 3 }, { x: Math.floor(GRID_W / 2), y: GRID_H - 4 },
      { x: 3, y: Math.floor(GRID_H / 2) }, { x: GRID_W - 4, y: Math.floor(GRID_H / 2) },
    ];

    this.room.players.forEach((p, i) => {
      const sp = spawns[i % spawns.length];
      this.players[p.id] = {
        name: p.name,
        x: sp.x, y: sp.y,
        dx: 0, dy: 0,
        color: i,
        colorHex: COLORS[i % COLORS.length],
      };
      this.scores[i] = 0;
    });

    let countdown = 3;
    const cdInterval = setInterval(() => {
      this.io.to(this.room.code).emit("paint-countdown", { count: countdown });
      countdown--;
      if (countdown < 0) {
        clearInterval(cdInterval);
        this.startTime = Date.now();
        // Send initial full grid + config
        this.io.to(this.room.code).emit("paint-config", {
          gridW: GRID_W, gridH: GRID_H, colors: COLORS,
        });
        this.interval = setInterval(() => this.tick(), TICK_MS);
        this.timeout = setTimeout(() => this.endGame(), GAME_DURATION);
      }
    }, 1000);
  }

  paintTile(x, y, color) {
    if (x < 0 || x >= GRID_W || y < 0 || y >= GRID_H) return;
    const old = this.grid[y][x];
    if (old === color) return; // already this color
    if (old >= 0) this.scores[old]--;
    this.grid[y][x] = color;
    this.scores[color]++;
    this.dirtyTiles.push(x, y, color); // flat triplets
  }

  tick() {
    this.fullSyncTick++;
    const elapsed = Date.now() - this.startTime;
    const timeLeft = Math.max(0, Math.ceil((GAME_DURATION - elapsed) / 1000));

    this.dirtyTiles = [];

    // Move and paint
    for (const [, p] of Object.entries(this.players)) {
      if (p.dx !== 0 || p.dy !== 0) {
        p.x = Math.max(0, Math.min(GRID_W - 1, p.x + p.dx));
        p.y = Math.max(0, Math.min(GRID_H - 1, p.y + p.dy));
      }
      // Paint 3x3
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          this.paintTile(p.x + dx, p.y + dy, p.color);
        }
      }
    }

    const playerList = Object.entries(this.players).map(([id, p]) => ({
      id, name: p.name, x: p.x, y: p.y, color: p.color, colorHex: p.colorHex,
    }));

    const scoreList = Object.entries(this.players).map(([, p]) => ({
      name: p.name, tiles: this.scores[p.color] || 0, color: p.color,
    }));

    // Send delta normally, full grid every 30 ticks (~2.4s)
    if (this.fullSyncTick % 30 === 0) {
      const flatGrid = [];
      for (let y = 0; y < GRID_H; y++) {
        for (let x = 0; x < GRID_W; x++) {
          flatGrid.push(this.grid[y][x]);
        }
      }
      this.io.to(this.room.code).emit("paint-state", {
        players: playerList, scores: scoreList, timeLeft,
        fullGrid: flatGrid, gridW: GRID_W, gridH: GRID_H,
      });
    } else {
      this.io.to(this.room.code).emit("paint-state", {
        players: playerList, scores: scoreList, timeLeft,
        dirty: this.dirtyTiles, // flat triplets [x,y,color, x,y,color, ...]
      });
    }
  }

  endGame() {
    this.stop();
    const scores = Object.entries(this.players).map(([, p]) => ({
      name: p.name,
      score: this.scores[p.color] || 0,
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

module.exports = PaintGame;
