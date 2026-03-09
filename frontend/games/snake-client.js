const COLS = 40;
const ROWS = 40;
const CELL = 16;

const OPPOSITE = { UP: "DOWN", DOWN: "UP", LEFT: "RIGHT", RIGHT: "LEFT" };

let _socket, _myId, _lastDir, _canvas, _ctx, _keyHandler, _latestState;

function initSnakeClient(socket, myId) {
  _socket  = socket;
  _myId    = myId;
  _lastDir = null; // set from first server state so it matches actual starting direction

  // Build canvas inside #game-area
  const gameArea = document.getElementById("game-area");
  gameArea.innerHTML = "";
  gameArea.style.display = "flex";
  gameArea.style.flexDirection = "column";
  gameArea.style.alignItems = "center";
  gameArea.style.gap = "0.75rem";

  // Status bar
  const statusBar = document.createElement("div");
  statusBar.id = "snake-status";
  statusBar.style.cssText = "font-size:0.9rem; color:#8892a4; font-weight:700; letter-spacing:1px;";
  statusBar.textContent = "Get ready!";
  gameArea.appendChild(statusBar);

  // Canvas
  _canvas = document.createElement("canvas");
  _canvas.width  = COLS * CELL;
  _canvas.height = ROWS * CELL;
  _canvas.style.cssText = "border-radius:8px; border:2px solid rgba(255,255,255,0.08);";
  gameArea.appendChild(_canvas);
  _ctx = _canvas.getContext("2d");

  // Draw waiting screen
  _ctx.fillStyle = "#0f172a";
  _ctx.fillRect(0, 0, _canvas.width, _canvas.height);

  // Keyboard input
  _keyHandler = (e) => {
    const map = {
      ArrowUp: "UP",    w: "UP",
      ArrowDown: "DOWN",  s: "DOWN",
      ArrowLeft: "LEFT",  a: "LEFT",
      ArrowRight: "RIGHT", d: "RIGHT"
    };
    const dir = map[e.key];
    if (!dir) return;
    e.preventDefault(); // always prevent page scroll for arrow/WASD

    if (_lastDir && dir !== OPPOSITE[_lastDir] && dir !== _lastDir) {
      _lastDir = dir;
      _socket.emit("snake-input", { dir });
    }
  };
  window.addEventListener("keydown", _keyHandler);

  // Countdown before game starts
  socket.on("snake-countdown", ({ count }) => {
    _ctx.fillStyle = "#0f172a";
    _ctx.fillRect(0, 0, _canvas.width, _canvas.height);

    const bar = document.getElementById("snake-status");
    if (bar) bar.textContent = count > 0 ? "Get ready!" : "GO!";

    _ctx.textAlign = "center";
    _ctx.textBaseline = "middle";

    if (count > 0) {
      _ctx.font = "bold 120px Nunito, sans-serif";
      _ctx.fillStyle = "#f7c948";
      _ctx.fillText(count, _canvas.width / 2, _canvas.height / 2);
    } else {
      _ctx.font = "bold 80px Nunito, sans-serif";
      _ctx.fillStyle = "#4ade80";
      _ctx.fillText("GO!", _canvas.width / 2, _canvas.height / 2);
    }

    _ctx.textBaseline = "alphabetic";
  });

  // Receive game state
  socket.on("snake-state", (state) => {
    _latestState = state;

    // Sync _lastDir from server on first state (picks up actual starting direction)
    if (_lastDir === null) {
      const me = state.snakes.find(s => s.id === _myId);
      if (me && me.alive && me.body.length >= 2) {
        const dx = me.body[0].x - me.body[1].x;
        const dy = me.body[0].y - me.body[1].y;
        if      (dx ===  1) _lastDir = "RIGHT";
        else if (dx === -1) _lastDir = "LEFT";
        else if (dy ===  1) _lastDir = "DOWN";
        else if (dy === -1) _lastDir = "UP";
      }
    }

    drawState(state);
    updateStatus(state);
  });
}

function cleanupGame() {
  if (_keyHandler) window.removeEventListener("keydown", _keyHandler);
}

function updateStatus(state) {
  const bar = document.getElementById("snake-status");
  if (!bar) return;
  const alive = state.snakes.filter(s => s.alive).length;
  bar.textContent = `Snakes alive: ${alive} / ${state.snakes.length}`;
}

function drawState(state) {
  // Background
  _ctx.fillStyle = "#0f172a";
  _ctx.fillRect(0, 0, _canvas.width, _canvas.height);

  // Grid
  _ctx.strokeStyle = "rgba(255,255,255,0.03)";
  _ctx.lineWidth = 0.5;
  for (let x = 0; x <= COLS; x++) {
    _ctx.beginPath();
    _ctx.moveTo(x * CELL, 0);
    _ctx.lineTo(x * CELL, _canvas.height);
    _ctx.stroke();
  }
  for (let y = 0; y <= ROWS; y++) {
    _ctx.beginPath();
    _ctx.moveTo(0, y * CELL);
    _ctx.lineTo(_canvas.width, y * CELL);
    _ctx.stroke();
  }

  // Apples
  state.apples.forEach(a => {
    _ctx.fillStyle = a.type === "good" ? "#e63946" : "#c1121f";
    _ctx.beginPath();
    _ctx.arc(
      a.x * CELL + CELL / 2,
      a.y * CELL + CELL / 2,
      CELL / 2 - 2,
      0, Math.PI * 2
    );
    _ctx.fill();
  });

  // Snakes (dead first so alive render on top)
  const dead  = state.snakes.filter(s => !s.alive);
  const alive = state.snakes.filter(s =>  s.alive);

  [...dead, ...alive].forEach(snake => {
    const isMe   = snake.id === _myId;
    const isDead = !snake.alive;

    snake.body.forEach((seg, i) => {
      const isHead = i === 0;

      let color;
      if (isDead) {
        color = "rgba(120,120,120,0.35)";
      } else if (isMe) {
        color = isHead ? lighten(snake.color, 40) : snake.color;
      } else {
        color = isHead ? snake.color : darken(snake.color, 20);
      }

      const padding = isHead ? 1 : 2;
      _ctx.fillStyle = color;
      _ctx.beginPath();
      _ctx.roundRect(
        seg.x * CELL + padding,
        seg.y * CELL + padding,
        CELL - padding * 2,
        CELL - padding * 2,
        isHead ? 4 : 3
      );
      _ctx.fill();
    });

    // Player name above head
    if (snake.body.length > 0) {
      const head = snake.body[0];
      _ctx.font = "bold 10px Nunito, sans-serif";
      _ctx.textAlign = "center";
      _ctx.fillStyle = isDead ? "rgba(120,120,120,0.5)" : (isMe ? "#fff" : "#ccc");
      _ctx.fillText(
        snake.name,
        head.x * CELL + CELL / 2,
        head.y * CELL - 3
      );
    }
  });
}

function lighten(hex, amount) {
  return adjustColor(hex, amount);
}

function darken(hex, amount) {
  return adjustColor(hex, -amount);
}

function adjustColor(hex, amount) {
  const num = parseInt(hex.replace("#", ""), 16);
  const r = Math.min(255, Math.max(0, (num >> 16) + amount));
  const g = Math.min(255, Math.max(0, ((num >> 8) & 0xff) + amount));
  const b = Math.min(255, Math.max(0, (num & 0xff) + amount));
  return `rgb(${r},${g},${b})`;
}
