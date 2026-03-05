const COLS = 40;
const ROWS = 40;
const TICK_MS = 150;

const PLAYER_COLORS = [
  "#4ade80", "#60a5fa", "#f472b6", "#fb923c",
  "#a78bfa", "#34d399", "#fbbf24", "#f87171"
];

const START_POSITIONS = [
  { x: 5,  y: 10 }, { x: 35, y: 10 },
  { x: 5,  y: 30 }, { x: 35, y: 30 },
  { x: 20, y: 5  }, { x: 20, y: 35 },
  { x: 10, y: 20 }, { x: 30, y: 20 }
];

const START_DIRS = [
  "RIGHT", "LEFT", "RIGHT", "LEFT",
  "DOWN",  "UP",   "DOWN",  "UP"
];

const OPPOSITE = { UP: "DOWN", DOWN: "UP", LEFT: "RIGHT", RIGHT: "LEFT" };

const DELTA = {
  UP:    { x: 0,  y: -1 },
  DOWN:  { x: 0,  y:  1 },
  LEFT:  { x: -1, y:  0 },
  RIGHT: { x: 1,  y:  0 }
};

class SnakeGame {
  constructor(room, io, onEnd) {
    this.room  = room;
    this.io    = io;
    this.onEnd = onEnd;
    this.tick  = 0;
    this.snakes = {};
    this.apples = [];
    this.badAppleTimers = [];
    this.interval = null;

    room.players.forEach((p, i) => {
      const start = START_POSITIONS[i % START_POSITIONS.length];
      const d     = START_DIRS[i % START_DIRS.length];
      this.snakes[p.id] = {
        id:    p.id,
        name:  p.name,
        color: PLAYER_COLORS[i % PLAYER_COLORS.length],
        dir:   d,
        inputQueue: [],
        body:  [
          { x: start.x, y: start.y },
          { x: start.x - (d === "RIGHT" ? 1 : d === "LEFT" ? -1 : 0), y: start.y - (d === "DOWN" ? 1 : d === "UP" ? -1 : 0) },
          { x: start.x - (d === "RIGHT" ? 2 : d === "LEFT" ? -2 : 0), y: start.y - (d === "DOWN" ? 2 : d === "UP" ? -2 : 0) }
        ],
        alive: true,
        score: 0
      };
    });

    this.spawnGoodApple();
  }

  start() {
    let count = 3;
    this.io.to(this.room.code).emit("snake-countdown", { count });
    const cd = setInterval(() => {
      count--;
      this.io.to(this.room.code).emit("snake-countdown", { count });
      if (count <= 0) {
        clearInterval(cd);
        this.interval = setInterval(() => this.gameTick(), TICK_MS);
        this.scheduleRandomBadApple();
      }
    }, 1000);
  }

  scheduleRandomBadApple() {
    const delay = 2000 + Math.random() * 4000;
    const t = setTimeout(() => {
      this.spawnBadApple();
      this.scheduleRandomBadApple();
    }, delay);
    this.badAppleTimers.push(t);
  }

  stop() {
    clearInterval(this.interval);
    this.badAppleTimers.forEach(t => clearTimeout(t));
  }

  updatePlayerId(oldId, newId) {
    const snake = this.snakes[oldId];
    if (!snake) return;
    snake.id = newId;
    this.snakes[newId] = snake;
    delete this.snakes[oldId];
  }

  setInput(socketId, dir) {
    const snake = this.snakes[socketId];
    if (!snake || !snake.alive) return;
    const queue = snake.inputQueue;
    const last  = queue.length > 0 ? queue[queue.length - 1] : snake.dir;
    if (dir !== OPPOSITE[last] && dir !== last) {
      queue.push(dir);
    }
  }

  randomFreeCell() {
    const occupied = new Set();
    Object.values(this.snakes).forEach(s => s.body.forEach(b => occupied.add(`${b.x},${b.y}`)));
    this.apples.forEach(a => occupied.add(`${a.x},${a.y}`));
    let pos;
    do {
      pos = { x: Math.floor(Math.random() * COLS), y: Math.floor(Math.random() * ROWS) };
    } while (occupied.has(`${pos.x},${pos.y}`));
    return pos;
  }

  spawnGoodApple() {
    const pos = this.randomFreeCell();
    this.apples.push({ ...pos, type: "good" });
  }

  spawnBadApple() {
    const pos = this.randomFreeCell();
    this.apples.push({ ...pos, type: "bad" });
    const lifetime = 3000 + Math.random() * 4000;
    const t = setTimeout(() => {
      this.apples = this.apples.filter(a => !(a.x === pos.x && a.y === pos.y && a.type === "bad"));
    }, lifetime);
    this.badAppleTimers.push(t);
  }

  gameTick() {
    this.tick++;

    const aliveSnakes = Object.values(this.snakes).filter(s => s.alive);
    if (aliveSnakes.length === 0) return this.endGame();

    // Move each alive snake
    const newHeads = {};
    aliveSnakes.forEach(snake => {
      if (snake.inputQueue.length > 0) {
        const candidate = snake.inputQueue.shift();
        if (candidate !== OPPOSITE[snake.dir]) snake.dir = candidate;
      }
      const delta = DELTA[snake.dir];
      newHeads[snake.id] = {
        x: snake.body[0].x + delta.x,
        y: snake.body[0].y + delta.y
      };
    });

    // Detect collisions
    aliveSnakes.forEach(snake => {
      const head = newHeads[snake.id];

      // Wall
      if (head.x < 0 || head.x >= COLS || head.y < 0 || head.y >= ROWS) {
        snake.alive = false;
        return;
      }

      // Self collision
      if (snake.body.some(b => b.x === head.x && b.y === head.y)) {
        snake.alive = false;
        return;
      }

      // Collision with other snakes' current bodies
      Object.values(this.snakes).forEach(other => {
        if (other.id === snake.id) return;
        if (other.body.some(b => b.x === head.x && b.y === head.y)) {
          snake.alive = false;
        }
      });
    });

    // Head-to-head collision
    aliveSnakes.forEach(a => {
      aliveSnakes.forEach(b => {
        if (a.id !== b.id) {
          if (newHeads[a.id].x === newHeads[b.id].x &&
              newHeads[a.id].y === newHeads[b.id].y) {
            a.alive = false;
            b.alive = false;
          }
        }
      });
    });

    // Apply movement and apple logic
    aliveSnakes.forEach(snake => {
      if (!snake.alive) return;
      const head = newHeads[snake.id];
      snake.body.unshift(head);

      const hitIdx = this.apples.findIndex(a => a.x === head.x && a.y === head.y);
      if (hitIdx !== -1) {
        const hit = this.apples[hitIdx];
        this.apples.splice(hitIdx, 1);

        if (hit.type === "bad") {
          snake.alive = false;
          snake.body.shift();
          return;
        }

        snake.score++;
        this.spawnGoodApple();
        if (Math.random() < 0.33) this.spawnBadApple();
      } else {
        snake.body.pop();
      }
    });

    // Broadcast state
    const state = this.getState();
    this.io.to(this.room.code).emit("snake-state", state);
    console.log(`[Snake] Room ${this.room.code} tick ${this.tick} — alive: ${Object.values(this.snakes).filter(s => s.alive).length}`);

    // Check win condition
    const stillAlive = Object.values(this.snakes).filter(s => s.alive);
    const total      = Object.values(this.snakes).length;

    if (total === 1 && stillAlive.length === 0) return this.endGame();
    if (total > 1  && stillAlive.length <= 1)  return this.endGame();
  }

  getState() {
    return {
      snakes: Object.values(this.snakes).map(s => ({
        id:    s.id,
        name:  s.name,
        color: s.color,
        body:  s.body,
        alive: s.alive,
        score: s.score
      })),
      apples: this.apples,
      tick:   this.tick
    };
  }

  endGame() {
    this.stop();
    const snakes  = Object.values(this.snakes);
    const sorted  = [...snakes].sort((a, b) => {
      if (a.alive !== b.alive) return a.alive ? -1 : 1;
      return b.score - a.score;
    });
    const scores  = sorted.map((s, i) => ({ name: s.name, score: sorted.length - i }));
    console.log(`[Snake] Game over in room ${this.room.code}`);
    this.onEnd(scores);
  }
}

module.exports = SnakeGame;
