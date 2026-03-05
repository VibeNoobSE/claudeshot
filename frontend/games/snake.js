const COLS = 40;
const ROWS = 40;
const CELL = 16;

const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");
canvas.width  = COLS * CELL;
canvas.height = ROWS * CELL;

const overlay   = document.getElementById("overlay");
const startBtn  = document.getElementById("start-btn");
const scoreEl   = document.getElementById("score");
const highEl    = document.getElementById("high-score");

const TICK_MS  = 120;
const DIR      = { UP: "UP", DOWN: "DOWN", LEFT: "LEFT", RIGHT: "RIGHT" };
const OPPOSITE = { UP: "DOWN", DOWN: "UP", LEFT: "RIGHT", RIGHT: "LEFT" };

const APPLE_GOOD_COLOR = "#e63946";
const APPLE_BAD_COLOR  = "#c1121f"; // subtly darker — easy to miss

let snake, dir, inputQueue, apples, score, highScore, tickInterval, alive;

highScore = 0;

function startGame() {
  snake = [
    { x: 5, y: 20 },
    { x: 4, y: 20 },
    { x: 3, y: 20 }
  ];
  dir        = DIR.RIGHT;
  inputQueue = [];
  apples     = [];
  score      = 0;
  alive      = true;
  scoreEl.textContent = 0;

  spawnGoodApple();
  overlay.style.display = "none";

  clearInterval(tickInterval);
  tickInterval = setInterval(tick, TICK_MS);
  scheduleRandomBadApple();
}

function scheduleRandomBadApple() {
  const delay = 2000 + Math.random() * 4000;
  setTimeout(() => {
    if (!alive) return;
    spawnBadApple();
    scheduleRandomBadApple();
  }, delay);
}

function randomFreeCell() {
  let pos;
  do {
    pos = { x: Math.floor(Math.random() * COLS), y: Math.floor(Math.random() * ROWS) };
  } while (
    snake.some(s => s.x === pos.x && s.y === pos.y) ||
    apples.some(a => a.x === pos.x && a.y === pos.y)
  );
  return pos;
}

function spawnGoodApple() {
  const pos = randomFreeCell();
  apples.push({ ...pos, type: "good" });
}

function spawnBadApple() {
  const pos = randomFreeCell();
  apples.push({ ...pos, type: "bad" });
  // Disappears after 3–7 seconds
  const lifetime = 3000 + Math.random() * 4000;
  setTimeout(() => {
    apples = apples.filter(a => !(a.x === pos.x && a.y === pos.y && a.type === "bad"));
  }, lifetime);
}

function tick() {
  if (inputQueue.length > 0) {
    const candidate = inputQueue.shift();
    if (candidate !== OPPOSITE[dir]) dir = candidate;
  }

  const head = { x: snake[0].x, y: snake[0].y };

  if (dir === DIR.UP)    head.y -= 1;
  if (dir === DIR.DOWN)  head.y += 1;
  if (dir === DIR.LEFT)  head.x -= 1;
  if (dir === DIR.RIGHT) head.x += 1;

  // Wall collision
  if (head.x < 0 || head.x >= COLS || head.y < 0 || head.y >= ROWS) {
    return endGame();
  }

  // Self collision
  if (snake.some(s => s.x === head.x && s.y === head.y)) {
    return endGame();
  }

  snake.unshift(head);

  // Apple collision
  const hitIndex = apples.findIndex(a => a.x === head.x && a.y === head.y);
  if (hitIndex !== -1) {
    const hit = apples[hitIndex];
    apples.splice(hitIndex, 1);

    if (hit.type === "bad") {
      return endGame();
    }

    // Good apple eaten — grow, score, respawn
    score++;
    scoreEl.textContent = score;
    if (score > highScore) {
      highScore = score;
      highEl.textContent = highScore;
    }

    spawnGoodApple();

    // ~1 in 3 chance to also spawn a bad apple
    if (Math.random() < 0.33) {
      spawnBadApple();
    }
  } else {
    snake.pop();
  }

  draw();
}

function endGame() {
  clearInterval(tickInterval);
  alive = false;
  draw();

  overlay.innerHTML = `
    <h2>Game Over</h2>
    <p>Score: ${score}</p>
    <button id="start-btn">Play Again</button>
  `;
  overlay.style.display = "flex";
  document.getElementById("start-btn").addEventListener("click", startGame);
}

function draw() {
  // Background
  ctx.fillStyle = "#0f172a";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Grid lines (subtle)
  ctx.strokeStyle = "rgba(255,255,255,0.03)";
  ctx.lineWidth = 0.5;
  for (let x = 0; x <= COLS; x++) {
    ctx.beginPath();
    ctx.moveTo(x * CELL, 0);
    ctx.lineTo(x * CELL, canvas.height);
    ctx.stroke();
  }
  for (let y = 0; y <= ROWS; y++) {
    ctx.beginPath();
    ctx.moveTo(0, y * CELL);
    ctx.lineTo(canvas.width, y * CELL);
    ctx.stroke();
  }

  // Apples
  apples.forEach(a => {
    ctx.fillStyle = a.type === "good" ? APPLE_GOOD_COLOR : APPLE_BAD_COLOR;
    ctx.beginPath();
    ctx.arc(
      a.x * CELL + CELL / 2,
      a.y * CELL + CELL / 2,
      CELL / 2 - 2,
      0, Math.PI * 2
    );
    ctx.fill();
  });

  // Snake
  snake.forEach((seg, i) => {
    const isHead = i === 0;
    ctx.fillStyle = isHead ? "#4ade80" : "#22c55e";
    const padding = isHead ? 1 : 2;
    ctx.beginPath();
    ctx.roundRect(
      seg.x * CELL + padding,
      seg.y * CELL + padding,
      CELL - padding * 2,
      CELL - padding * 2,
      isHead ? 4 : 3
    );
    ctx.fill();
  });
}

// Controls
window.addEventListener("keydown", (e) => {
  const map = {
    ArrowUp: DIR.UP,    w: DIR.UP,
    ArrowDown: DIR.DOWN,  s: DIR.DOWN,
    ArrowLeft: DIR.LEFT,  a: DIR.LEFT,
    ArrowRight: DIR.RIGHT, d: DIR.RIGHT
  };
  const newDir = map[e.key];
  if (newDir) {
    const last = inputQueue.length > 0 ? inputQueue[inputQueue.length - 1] : dir;
    if (newDir !== OPPOSITE[last] && newDir !== last) {
      inputQueue.push(newDir);
    }
    e.preventDefault();
  }
});

startBtn.addEventListener("click", startGame);

// Initial draw
ctx.fillStyle = "#0f172a";
ctx.fillRect(0, 0, canvas.width, canvas.height);
