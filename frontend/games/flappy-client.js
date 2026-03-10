// Flappy Bird client — parallel singleplayer with live ghosts
let _flappyCleanup = [];

const FLAPPY_COLORS = ["#f7c948", "#e94560", "#4ecca3", "#5dade2", "#af7ac5", "#ff8c42", "#42f5b0", "#f542e0"];

function initFlappyClient(socket, myId, room) {
  const gameArea = document.getElementById("game-area");
  gameArea.innerHTML = "";

  const canvas = document.createElement("canvas");
  canvas.width = 400;
  canvas.height = 500;
  canvas.style.display = "block";
  canvas.style.margin = "0 auto";
  canvas.style.borderRadius = "8px";
  canvas.style.border = "2px solid #2a3a5e";
  gameArea.appendChild(canvas);
  const ctx = canvas.getContext("2d");

  const scoreboard = document.createElement("div");
  scoreboard.style.cssText = "display:flex;justify-content:center;gap:1.5rem;margin-top:8px;font-family:monospace;font-size:14px;";
  gameArea.appendChild(scoreboard);

  function onCountdown({ count }) {
    ctx.fillStyle = "#1a3a5e";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#f7c948";
    ctx.font = "bold 72px monospace";
    ctx.textAlign = "center";
    ctx.fillText(count > 0 ? count : "FLAP!", canvas.width / 2, canvas.height / 2 + 20);
  }

  function onState({ players, pipes, gameW, gameH, birdX, pipeGap }) {
    // Background
    ctx.fillStyle = "#1a3a5e";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Pipes
    pipes.forEach(pipe => {
      ctx.fillStyle = "#4ecca3";
      // Top pipe
      ctx.fillRect(pipe.x - 26, 0, 52, pipe.gapY);
      // Bottom pipe
      ctx.fillRect(pipe.x - 26, pipe.gapY + pipeGap, 52, gameH - pipe.gapY - pipeGap);
    });

    // Players (other players as ghosts, self as solid)
    players.forEach(p => {
      const isMe = p.id === myId;
      const color = FLAPPY_COLORS[p.colorIdx % FLAPPY_COLORS.length];

      if (!p.alive) {
        ctx.globalAlpha = 0.2;
      } else {
        ctx.globalAlpha = isMe ? 1 : 0.5;
      }

      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(birdX, p.y, 12, 0, Math.PI * 2);
      ctx.fill();

      if (isMe && p.alive) {
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      // Name (only for non-self to reduce clutter)
      if (!isMe) {
        ctx.fillStyle = color;
        ctx.font = "9px monospace";
        ctx.textAlign = "center";
        ctx.fillText(p.name, birdX, p.y - 16);
      }
    });
    ctx.globalAlpha = 1;

    // My score big
    const me = players.find(p => p.id === myId);
    if (me) {
      ctx.fillStyle = "#fff";
      ctx.font = "bold 32px monospace";
      ctx.textAlign = "center";
      ctx.fillText(me.score.toString(), gameW / 2, 40);
      if (!me.alive) {
        ctx.fillStyle = "rgba(0,0,0,0.5)";
        ctx.fillRect(0, gameH / 2 - 30, gameW, 60);
        ctx.fillStyle = "#e94560";
        ctx.font = "bold 24px monospace";
        ctx.fillText("YOU DIED", gameW / 2, gameH / 2 + 8);
      }
    }

    // Alive count
    const alive = players.filter(p => p.alive).length;
    ctx.fillStyle = "#aaa";
    ctx.font = "12px monospace";
    ctx.textAlign = "right";
    ctx.fillText("Alive: " + alive + "/" + players.length, gameW - 8, 18);

    // Scoreboard below
    scoreboard.innerHTML = players
      .sort((a, b) => b.score - a.score)
      .map(p => `<span style="color:${FLAPPY_COLORS[p.colorIdx % FLAPPY_COLORS.length]};opacity:${p.alive ? 1 : 0.4}">${p.name}: ${p.score}${p.alive ? "" : " ☠"}</span>`)
      .join("");
  }

  function onKeyDown(e) {
    if (e.key === " " || e.key === "ArrowUp" || e.key === "w") {
      e.preventDefault();
      socket.emit("flappy-input", { action: "flap" });
    }
  }

  document.addEventListener("keydown", onKeyDown);
  socket.on("flappy-countdown", onCountdown);
  socket.on("flappy-state", onState);

  _flappyCleanup = [
    () => document.removeEventListener("keydown", onKeyDown),
    () => socket.off("flappy-countdown", onCountdown),
    () => socket.off("flappy-state", onState),
  ];
}

function cleanupFlappyClient() {
  _flappyCleanup.forEach(fn => fn());
  _flappyCleanup = [];
}
