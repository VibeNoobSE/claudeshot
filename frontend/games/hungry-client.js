// Hungry Lasse client — multiplayer chicken chase with photo sprites
let _hungryCleanup = [];

function initHungryClient(socket, myId, room) {
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
  canvas.style.borderRadius = "12px";
  canvas.style.border = "2px solid #2a3a5e";
  wrapper.appendChild(canvas);
  const ctx = canvas.getContext("2d");

  const controls = document.createElement("div");
  controls.style.cssText = "margin-top:6px;font-family:monospace;font-size:12px;color:#888;";
  controls.textContent = "WASD/Arrows to chase chickens. Bump other players to stun them!";
  wrapper.appendChild(controls);

  // Load images
  const lasseImg = new Image();
  lasseImg.src = "assets/lasse.webp";
  const chickenImg = new Image();
  chickenImg.src = "assets/chicken.jpg";

  const COLORS = ["#f7c948", "#e94560", "#4ecca3", "#5dade2", "#af7ac5", "#ff8c42", "#42f5b0", "#f542e0"];
  const NOM_PHRASES = ["NOM!", "nam nam nam!", "sjiit så godt!", "bedre enn kvæfjordkaka!", "NOM NOM!", "DIGG!", "nam!"];
  const playerPhrases = {}; // id -> current phrase
  let particles = [];
  let shakeTimer = 0;
  let lastScores = {};

  function onCountdown({ count }) {
    ctx.fillStyle = "#0f172a";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw lasse and chicken preview
    if (lasseImg.complete) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(canvas.width / 2 - 60, canvas.height / 2 - 40, 35, 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(lasseImg, canvas.width / 2 - 95, canvas.height / 2 - 75, 70, 70);
      ctx.restore();
    }
    if (chickenImg.complete) {
      ctx.drawImage(chickenImg, canvas.width / 2 + 20, canvas.height / 2 - 60, 50, 50);
    }

    ctx.fillStyle = "#f7c948";
    ctx.font = "bold 72px monospace";
    ctx.textAlign = "center";
    ctx.fillText(count > 0 ? count : "EAT!", canvas.width / 2, canvas.height / 2 + 60);
    ctx.fillStyle = "#888";
    ctx.font = "14px monospace";
    ctx.fillText("Catch the chickens! Bump others to stun!", canvas.width / 2, canvas.height / 2 + 90);
  }

  function onState({ players, chickens, timeLeft }) {
    // Check for new eats — trigger particles
    players.forEach(p => {
      if (p.justAte && (!lastScores[p.id] || lastScores[p.id] < p.score)) {
        playerPhrases[p.id] = NOM_PHRASES[Math.floor(Math.random() * NOM_PHRASES.length)];
        for (let i = 0; i < 12; i++) {
          const angle = Math.random() * Math.PI * 2;
          const speed = 2 + Math.random() * 3;
          particles.push({
            x: p.x, y: p.y,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed - 2,
            life: 1,
            color: ["#f7c948", "#ff8c42", "#c8a060", "#e94560"][Math.floor(Math.random() * 4)],
            size: 3 + Math.random() * 4,
          });
        }
        if (p.id === myId) shakeTimer = 6;
      }
      lastScores[p.id] = p.score;
    });

    // Update particles
    particles = particles.filter(p => {
      p.x += p.vx; p.y += p.vy; p.vy += 0.12; p.life -= 0.025;
      return p.life > 0;
    });

    ctx.save();
    if (shakeTimer > 0) {
      shakeTimer--;
      ctx.translate((Math.random() - 0.5) * shakeTimer * 2, (Math.random() - 0.5) * shakeTimer * 2);
    }

    // Background
    ctx.fillStyle = "#0f172a";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Ground line
    ctx.fillStyle = "#1a2744";
    ctx.fillRect(0, canvas.height - 20, canvas.width, 20);

    // Chickens
    chickens.forEach(c => {
      ctx.save();
      const wobble = Math.sin(Date.now() * 0.008 + c.x) * 2;
      const bounce = Math.abs(Math.sin(Date.now() * 0.006 + c.y)) * (2 + c.panic * 4);

      // Shadow
      ctx.fillStyle = "rgba(0,0,0,0.2)";
      ctx.beginPath();
      ctx.ellipse(c.x, c.y + 22, 16, 5, 0, 0, Math.PI * 2);
      ctx.fill();

      // Sweat when panicked
      if (c.panic > 0.6) {
        ctx.fillStyle = "#5dade2";
        ctx.beginPath();
        ctx.ellipse(c.x + 18, c.y - 12 + Math.sin(Date.now() * 0.01) * 3, 2, 3, 0, 0, Math.PI * 2);
        ctx.fill();
      }

      // Chicken image
      if (chickenImg.complete) {
        ctx.drawImage(chickenImg, c.x - 20, c.y - 20 - bounce + wobble, 40, 40);
      } else {
        ctx.fillStyle = "#c8a060";
        ctx.beginPath();
        ctx.arc(c.x, c.y - bounce + wobble, 15, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    });

    // Particles
    particles.forEach(p => {
      ctx.globalAlpha = p.life;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;

    // Players (Lasse heads!)
    players.forEach(p => {
      const isMe = p.id === myId;
      const r = 28;
      const bobY = Math.sin(Date.now() * 0.005 + p.x) * 2;

      ctx.save();

      // Shadow
      ctx.fillStyle = "rgba(0,0,0,0.25)";
      ctx.beginPath();
      ctx.ellipse(p.x, p.y + r + 4, r * 0.6, 5, 0, 0, Math.PI * 2);
      ctx.fill();

      // Stun effect
      if (p.stunned) {
        ctx.globalAlpha = 0.5 + Math.sin(Date.now() * 0.02) * 0.3;
        // Stars around head
        for (let i = 0; i < 3; i++) {
          const starAngle = Date.now() * 0.005 + i * (Math.PI * 2 / 3);
          const sx = p.x + Math.cos(starAngle) * (r + 8);
          const sy = p.y - r - 5 + Math.sin(starAngle) * 5 + bobY;
          ctx.fillStyle = "#f7c948";
          ctx.font = "14px monospace";
          ctx.textAlign = "center";
          ctx.fillText("*", sx, sy);
        }
      }

      // Lasse face (circular crop)
      ctx.save();
      ctx.translate(p.x, p.y + bobY);
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.clip();
      if (lasseImg.complete) {
        ctx.drawImage(lasseImg, -r, -r, r * 2, r * 2);
      } else {
        ctx.fillStyle = p.color;
        ctx.fill();
      }
      ctx.restore();

      // Color ring
      ctx.globalAlpha = p.stunned ? 0.4 : 1;
      ctx.strokeStyle = isMe ? "#fff" : p.color;
      ctx.lineWidth = isMe ? 4 : 2;
      ctx.beginPath();
      ctx.arc(p.x, p.y + bobY, r, 0, Math.PI * 2);
      ctx.stroke();

      // Mouth when eating
      if (p.mouthOpen > 0.1) {
        ctx.fillStyle = "#1a1a1a";
        ctx.beginPath();
        ctx.ellipse(p.x, p.y + bobY + r * 0.35, 5 + p.mouthOpen * 8, 3 + p.mouthOpen * 6, 0, 0, Math.PI * 2);
        ctx.fill();
      }

      // Eating phrase
      if (p.justAte) {
        const phrase = playerPhrases[p.id] || "NOM!";
        ctx.fillStyle = "#f7c948";
        ctx.font = "bold 16px monospace";
        ctx.textAlign = "center";
        ctx.shadowColor = "#000";
        ctx.shadowBlur = 4;
        ctx.fillText(phrase, p.x, p.y - r - 12 + bobY);
        ctx.shadowBlur = 0;
      }

      ctx.globalAlpha = 1;

      // Name + score below
      ctx.fillStyle = isMe ? "#f7c948" : "#fff";
      ctx.font = `bold 12px monospace`;
      ctx.textAlign = "center";
      ctx.shadowColor = "#000";
      ctx.shadowBlur = 3;
      ctx.fillText(p.name, p.x, p.y + r + 18 + bobY);
      ctx.fillStyle = "#4ecca3";
      ctx.fillText(p.score + " chicken" + (p.score !== 1 ? "s" : ""), p.x, p.y + r + 32 + bobY);
      ctx.shadowBlur = 0;

      ctx.restore();
    });

    // Timer
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.fillRect(canvas.width / 2 - 40, 4, 80, 28);
    ctx.fillStyle = timeLeft <= 5 ? "#e94560" : "#fff";
    ctx.font = "bold 20px monospace";
    ctx.textAlign = "center";
    ctx.fillText(timeLeft + "s", canvas.width / 2, 26);

    // Scoreboard top-right
    ctx.textAlign = "right";
    ctx.font = "bold 13px monospace";
    const sorted = [...players].sort((a, b) => b.score - a.score);
    sorted.forEach((p, i) => {
      ctx.fillStyle = p.id === myId ? "#f7c948" : COLORS[p.colorIdx % COLORS.length];
      ctx.fillText(`${p.name}: ${p.score}`, canvas.width - 10, 20 + i * 18);
    });

    ctx.restore();
  }

  // Input
  const keys = {};
  function updateDir() {
    const dx = (keys["ArrowRight"] || keys["d"] ? 1 : 0) - (keys["ArrowLeft"] || keys["a"] ? 1 : 0);
    const dy = (keys["ArrowDown"] || keys["s"] ? 1 : 0) - (keys["ArrowUp"] || keys["w"] ? 1 : 0);
    socket.emit("hungry-input", { dx, dy });
  }
  function onKeyDown(e) {
    if (["ArrowLeft","ArrowRight","ArrowUp","ArrowDown","a","d","w","s"].includes(e.key)) {
      e.preventDefault();
      keys[e.key] = true;
      updateDir();
    }
  }
  function onKeyUp(e) {
    if (keys[e.key]) { delete keys[e.key]; updateDir(); }
  }

  document.addEventListener("keydown", onKeyDown);
  document.addEventListener("keyup", onKeyUp);
  socket.on("hungry-countdown", onCountdown);
  socket.on("hungry-state", onState);

  _hungryCleanup = [
    () => document.removeEventListener("keydown", onKeyDown),
    () => document.removeEventListener("keyup", onKeyUp),
    () => socket.off("hungry-countdown", onCountdown),
    () => socket.off("hungry-state", onState),
  ];
}

function cleanupHungryClient() {
  _hungryCleanup.forEach(fn => fn());
  _hungryCleanup = [];
}
