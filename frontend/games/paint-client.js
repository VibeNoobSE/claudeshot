// Paint Battle client — real-time canvas renderer with delta updates
let _paintCleanup = [];

function initPaintClient(socket, myId, room) {
  const gameArea = document.getElementById("game-area");
  gameArea.innerHTML = "";

  const wrapper = document.createElement("div");
  wrapper.style.cssText = "text-align:center;";
  gameArea.appendChild(wrapper);

  const canvas = document.createElement("canvas");
  canvas.style.display = "block";
  canvas.style.margin = "0 auto";
  canvas.style.borderRadius = "8px";
  canvas.style.border = "2px solid #2a3a5e";
  canvas.style.imageRendering = "pixelated";
  wrapper.appendChild(canvas);
  const ctx = canvas.getContext("2d");

  const scoreboard = document.createElement("div");
  scoreboard.style.cssText = "display:flex;justify-content:center;gap:1.5rem;margin-top:8px;font-family:monospace;font-size:14px;";
  wrapper.appendChild(scoreboard);

  let COLORS = [];
  let GRID_W = 40, GRID_H = 30;
  const CELL = 20;
  let localGrid = null; // client-side grid for smooth rendering

  function onConfig({ gridW, gridH, colors }) {
    GRID_W = gridW; GRID_H = gridH; COLORS = colors;
    canvas.width = GRID_W * CELL;
    canvas.height = GRID_H * CELL;
    localGrid = new Int8Array(GRID_W * GRID_H).fill(-1);
    // Draw initial background
    ctx.fillStyle = "#16213e";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  function onCountdown({ count }) {
    // Use a default size during countdown
    if (!canvas.width || canvas.width < 100) {
      canvas.width = 800; canvas.height = 600;
    }
    ctx.fillStyle = "#16213e";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#f7c948";
    ctx.font = "bold 72px monospace";
    ctx.textAlign = "center";
    ctx.fillText(count > 0 ? count : "GO!", canvas.width / 2, canvas.height / 2 + 20);
  }

  function onState({ players, scores, timeLeft, fullGrid, dirty, gridW, gridH }) {
    if (!localGrid) return;

    // Apply updates to local grid
    if (fullGrid) {
      // Full sync
      GRID_W = gridW; GRID_H = gridH;
      localGrid = new Int8Array(fullGrid);
      // Redraw entire grid
      ctx.fillStyle = "#16213e";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      for (let i = 0; i < localGrid.length; i++) {
        if (localGrid[i] >= 0) {
          ctx.fillStyle = COLORS[localGrid[i] % COLORS.length];
          const x = (i % GRID_W) * CELL;
          const y = Math.floor(i / GRID_W) * CELL;
          ctx.fillRect(x, y, CELL, CELL);
        }
      }
    } else if (dirty && dirty.length > 0) {
      // Delta update — triplets [x, y, color, ...]
      for (let i = 0; i < dirty.length; i += 3) {
        const x = dirty[i], y = dirty[i + 1], c = dirty[i + 2];
        localGrid[y * GRID_W + x] = c;
        if (c >= 0) {
          ctx.fillStyle = COLORS[c % COLORS.length];
        } else {
          ctx.fillStyle = "#16213e";
        }
        ctx.fillRect(x * CELL, y * CELL, CELL, CELL);
      }
    }

    // Draw players on top (clear their area first, then draw)
    players.forEach(p => {
      // Draw player circle
      const px = p.x * CELL + CELL / 2;
      const py = p.y * CELL + CELL / 2;
      ctx.fillStyle = p.colorHex;
      ctx.beginPath();
      ctx.arc(px, py, CELL * 0.6, 0, Math.PI * 2);
      ctx.fill();
      if (p.id === myId) {
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 3;
        ctx.stroke();
      } else {
        ctx.strokeStyle = "rgba(0,0,0,0.5)";
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      // Name
      ctx.fillStyle = "#fff";
      ctx.font = "bold 12px monospace";
      ctx.textAlign = "center";
      ctx.shadowColor = "#000";
      ctx.shadowBlur = 4;
      ctx.fillText(p.name, px, py - CELL * 0.8);
      ctx.shadowBlur = 0;
    });

    // Timer overlay
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.fillRect(canvas.width - 70, 4, 66, 28);
    ctx.fillStyle = timeLeft <= 5 ? "#e94560" : "#fff";
    ctx.font = "bold 18px monospace";
    ctx.textAlign = "right";
    ctx.fillText(timeLeft + "s", canvas.width - 12, 26);

    // Scoreboard
    scoreboard.innerHTML = scores
      .sort((a, b) => b.tiles - a.tiles)
      .map(s => `<span style="color:${COLORS[s.color % COLORS.length]};font-weight:bold">${s.name}: ${s.tiles}</span>`)
      .join("");
  }

  // Input — track which keys are held for proper diagonal + release
  const keys = {};
  function updateDir() {
    const dx = (keys["ArrowRight"] || keys["d"] ? 1 : 0) - (keys["ArrowLeft"] || keys["a"] ? 1 : 0);
    const dy = (keys["ArrowDown"] || keys["s"] ? 1 : 0) - (keys["ArrowUp"] || keys["w"] ? 1 : 0);
    socket.emit("paint-input", { dx, dy });
  }
  function onKeyDown(e) {
    if (["ArrowLeft","ArrowRight","ArrowUp","ArrowDown","a","d","w","s"].includes(e.key)) {
      e.preventDefault();
      keys[e.key] = true;
      updateDir();
    }
  }
  function onKeyUp(e) {
    if (keys[e.key]) {
      delete keys[e.key];
      updateDir();
    }
  }

  document.addEventListener("keydown", onKeyDown);
  document.addEventListener("keyup", onKeyUp);
  socket.on("paint-config", onConfig);
  socket.on("paint-countdown", onCountdown);
  socket.on("paint-state", onState);

  _paintCleanup = [
    () => document.removeEventListener("keydown", onKeyDown),
    () => document.removeEventListener("keyup", onKeyUp),
    () => socket.off("paint-config", onConfig),
    () => socket.off("paint-countdown", onCountdown),
    () => socket.off("paint-state", onState),
  ];
}

function cleanupPaintClient() {
  _paintCleanup.forEach(fn => fn());
  _paintCleanup = [];
}
