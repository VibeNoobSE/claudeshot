// Battle Royale client — real-time with bump & dash mechanics
let _royaleCleanup = [];

function initRoyaleClient(socket, myId, room) {
  const gameArea = document.getElementById("game-area");
  gameArea.innerHTML = "";

  const wrapper = document.createElement("div");
  wrapper.style.cssText = "text-align:center;";
  gameArea.appendChild(wrapper);

  const canvas = document.createElement("canvas");
  canvas.width = 800;
  canvas.height = 500;
  canvas.style.display = "block";
  canvas.style.margin = "0 auto";
  canvas.style.borderRadius = "8px";
  canvas.style.border = "2px solid #2a3a5e";
  wrapper.appendChild(canvas);
  const ctx = canvas.getContext("2d");

  const controls = document.createElement("div");
  controls.style.cssText = "margin-top:6px;font-family:monospace;font-size:12px;color:#888;";
  controls.textContent = "WASD/Arrows to move — SPACE to dash (bumps enemies!)";
  wrapper.appendChild(controls);

  function onCountdown({ count }) {
    ctx.fillStyle = "#0a0a12";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#e94560";
    ctx.font = "bold 72px monospace";
    ctx.textAlign = "center";
    ctx.fillText(count > 0 ? count : "SURVIVE!", canvas.width / 2, canvas.height / 2 + 20);
    ctx.fillStyle = "#888";
    ctx.font = "16px monospace";
    ctx.fillText("SPACE to dash & bump others!", canvas.width / 2, canvas.height / 2 + 60);
  }

  function onState({ players, pickups, zoneRadius, zoneCx, zoneCy }) {
    // Background
    ctx.fillStyle = "#0a0a12";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Zone danger area (red tint outside)
    ctx.save();
    ctx.fillStyle = "rgba(200, 40, 40, 0.2)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.globalCompositeOperation = "destination-out";
    ctx.beginPath();
    ctx.arc(zoneCx, zoneCy, zoneRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Zone safe area subtle glow
    ctx.save();
    ctx.fillStyle = "rgba(78, 204, 163, 0.04)";
    ctx.beginPath();
    ctx.arc(zoneCx, zoneCy, zoneRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Zone border
    ctx.strokeStyle = "#4ecca3";
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 4]);
    ctx.beginPath();
    ctx.arc(zoneCx, zoneCy, zoneRadius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    // Pickups
    pickups.forEach(pu => {
      ctx.fillStyle = "#4ecca3";
      ctx.beginPath();
      ctx.arc(pu.x, pu.y, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.font = "bold 12px monospace";
      ctx.textAlign = "center";
      ctx.fillText("+", pu.x, pu.y + 5);
    });

    // Players
    players.forEach(p => {
      const isMe = p.id === myId;

      if (!p.alive) {
        // Dead marker
        ctx.globalAlpha = 0.25;
        ctx.fillStyle = "#666";
        ctx.beginPath();
        ctx.arc(p.x, p.y, 14, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#999";
        ctx.font = "bold 16px monospace";
        ctx.textAlign = "center";
        ctx.fillText("X", p.x, p.y + 6);
        ctx.globalAlpha = 1;
        return;
      }

      // Dash glow
      if (p.dashing) {
        ctx.fillStyle = p.color;
        ctx.globalAlpha = 0.3;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 22, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }

      // Body
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 14, 0, Math.PI * 2);
      ctx.fill();

      // Self highlight
      if (isMe) {
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 3;
        ctx.stroke();
      }

      // Name
      ctx.fillStyle = "#fff";
      ctx.font = "bold 11px monospace";
      ctx.textAlign = "center";
      ctx.shadowColor = "#000";
      ctx.shadowBlur = 3;
      ctx.fillText(p.name, p.x, p.y - 24);
      ctx.shadowBlur = 0;

      // HP bar
      const barW = 34;
      ctx.fillStyle = "#222";
      ctx.fillRect(p.x - barW / 2, p.y - 20, barW, 5);
      const hpColor = p.hp > 60 ? "#4ecca3" : p.hp > 30 ? "#f7c948" : "#e94560";
      ctx.fillStyle = hpColor;
      ctx.fillRect(p.x - barW / 2, p.y - 20, barW * (p.hp / 100), 5);

      // Kill count
      if (p.kills > 0) {
        ctx.fillStyle = "#e94560";
        ctx.font = "bold 10px monospace";
        ctx.fillText(p.kills + " kill" + (p.kills > 1 ? "s" : ""), p.x, p.y + 24);
      }
    });

    // HUD — my status
    const me = players.find(p => p.id === myId);
    if (me) {
      // Dash indicator
      ctx.fillStyle = me.dashReady ? "#4ecca3" : "#444";
      ctx.font = "bold 14px monospace";
      ctx.textAlign = "left";
      ctx.fillText(me.dashReady ? "[SPACE] DASH READY" : "[SPACE] cooldown...", 10, canvas.height - 12);

      if (!me.alive) {
        ctx.fillStyle = "rgba(0,0,0,0.6)";
        ctx.fillRect(0, canvas.height / 2 - 25, canvas.width, 50);
        ctx.fillStyle = "#e94560";
        ctx.font = "bold 28px monospace";
        ctx.textAlign = "center";
        ctx.fillText("ELIMINATED", canvas.width / 2, canvas.height / 2 + 8);
      }
    }

    // Alive count
    const alive = players.filter(p => p.alive).length;
    ctx.fillStyle = "#fff";
    ctx.font = "bold 16px monospace";
    ctx.textAlign = "right";
    ctx.fillText("Alive: " + alive + "/" + players.length, canvas.width - 12, 24);
  }

  // Input
  const keys = {};
  function updateDir() {
    const dx = (keys["ArrowRight"] || keys["d"] ? 1 : 0) - (keys["ArrowLeft"] || keys["a"] ? 1 : 0);
    const dy = (keys["ArrowDown"] || keys["s"] ? 1 : 0) - (keys["ArrowUp"] || keys["w"] ? 1 : 0);
    socket.emit("royale-input", { dx, dy });
  }
  function onKeyDown(e) {
    if (e.key === " ") {
      e.preventDefault();
      socket.emit("royale-input", { action: "dash" });
      return;
    }
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
  socket.on("royale-countdown", onCountdown);
  socket.on("royale-state", onState);

  _royaleCleanup = [
    () => document.removeEventListener("keydown", onKeyDown),
    () => document.removeEventListener("keyup", onKeyUp),
    () => socket.off("royale-countdown", onCountdown),
    () => socket.off("royale-state", onState),
  ];
}

function cleanupRoyaleClient() {
  _royaleCleanup.forEach(fn => fn());
  _royaleCleanup = [];
}
