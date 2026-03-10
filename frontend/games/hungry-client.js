// Hungry Lasse client — multiplayer food chase with phases & LONGSHOT TWIST
let _hungryCleanup = [];

function initHungryClient(socket, myId, room) {
  const gameArea = document.getElementById("game-area");
  gameArea.innerHTML = "";

  const wrapper = document.createElement("div");
  wrapper.style.cssText = "text-align:center;position:relative;";
  gameArea.appendChild(wrapper);

  const canvas = document.createElement("canvas");
  canvas.width = 1200;
  canvas.height = 700;
  canvas.style.display = "block";
  canvas.style.margin = "0 auto";
  canvas.style.borderRadius = "14px";
  canvas.style.border = "3px solid #2a3a5e";
  canvas.style.width = "100%";
  canvas.style.maxWidth = "1200px";
  canvas.style.height = "auto";
  canvas.style.boxShadow = "0 0 40px rgba(79, 140, 255, 0.15)";
  wrapper.appendChild(canvas);
  const ctx = canvas.getContext("2d");

  // Banner overlay (for phase transitions & twist)
  const bannerOverlay = document.createElement("div");
  bannerOverlay.style.cssText = "display:none;position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:10;overflow:hidden;";
  wrapper.appendChild(bannerOverlay);

  const bannerText = document.createElement("div");
  bannerText.style.cssText = "position:absolute;top:50%;left:50%;transform:translate(-50%,-50%) scale(0);font-family:monospace;font-size:80px;font-weight:900;color:#f7c948;text-align:center;text-shadow:0 0 40px #f7c948,0 0 80px #e94560,0 0 120px #f7c948,4px 4px 0 #e94560;line-height:1.1;letter-spacing:4px;white-space:nowrap;";
  bannerOverlay.appendChild(bannerText);

  // Inject keyframes once
  if (!document.getElementById("hungry-keyframes")) {
    var style = document.createElement("style");
    style.id = "hungry-keyframes";
    style.textContent = [
      "@keyframes bannerEntry{0%{transform:translate(-50%,-50%) scale(0) rotate(-180deg);opacity:0}30%{transform:translate(-50%,-50%) scale(1.3) rotate(10deg);opacity:1}50%{transform:translate(-50%,-50%) scale(0.9) rotate(-5deg)}70%{transform:translate(-50%,-50%) scale(1.1) rotate(3deg)}100%{transform:translate(-50%,-50%) scale(1) rotate(0deg)}}",
      "@keyframes bannerBlink{0%,100%{color:#f7c948;text-shadow:0 0 40px #f7c948,0 0 80px #e94560,0 0 120px #f7c948,4px 4px 0 #e94560}25%{color:#e94560;text-shadow:0 0 40px #e94560,0 0 80px #f7c948,0 0 120px #e94560,4px 4px 0 #f7c948}50%{color:#4ecca3;text-shadow:0 0 40px #4ecca3,0 0 80px #af7ac5,0 0 120px #4ecca3,4px 4px 0 #af7ac5}75%{color:#ff8c42;text-shadow:0 0 40px #ff8c42,0 0 80px #5dade2,0 0 120px #ff8c42,4px 4px 0 #5dade2}}",
      "@keyframes bannerSpin{0%{transform:translate(-50%,-50%) scale(1) rotate(0deg)}100%{transform:translate(-50%,-50%) scale(1) rotate(360deg)}}",
      "@keyframes bannerFade{0%{opacity:1;transform:translate(-50%,-50%) scale(1) rotate(0deg)}100%{opacity:0;transform:translate(-50%,-50%) scale(2) rotate(30deg)}}",
      "@keyframes bannerBg{0%{background:rgba(233,69,96,0.4)}25%{background:rgba(247,201,72,0.4)}50%{background:rgba(78,204,163,0.4)}75%{background:rgba(175,122,197,0.4)}100%{background:rgba(233,69,96,0.4)}}",
      "@keyframes dessertEntry{0%{transform:translate(-50%,-50%) scale(0) rotate(0deg);opacity:0}40%{transform:translate(-50%,-50%) scale(1.2) rotate(5deg);opacity:1}70%{transform:translate(-50%,-50%) scale(0.95) rotate(-2deg)}100%{transform:translate(-50%,-50%) scale(1) rotate(0deg)}}",
      "@keyframes dessertBlink{0%,100%{color:#ff8c42;text-shadow:0 0 30px #ff8c42,0 0 60px #f7c948,3px 3px 0 #c8a060}50%{color:#f7c948;text-shadow:0 0 30px #f7c948,0 0 60px #ff8c42,3px 3px 0 #e94560}}",
    ].join("\n");
    document.head.appendChild(style);
  }

  var controls = document.createElement("div");
  controls.style.cssText = "margin-top:8px;font-family:monospace;font-size:13px;color:#8892a4;";
  controls.textContent = "WASD/Arrows to chase chickens. Bump others to stun! Grab power-ups!";
  wrapper.appendChild(controls);

  var lasseImg = new Image();
  lasseImg.src = "assets/lasse.webp";
  var chickenImg = new Image();
  chickenImg.src = "assets/chicken.jpg";
  var goldenChickenImg = new Image();
  goldenChickenImg.src = "assets/golden-chicken.jpg";
  var cookieImg = new Image();
  cookieImg.src = "assets/cookie.jpg";

  var COLORS = ["#f7c948", "#e94560", "#4ecca3", "#5dade2", "#af7ac5", "#ff8c42", "#42f5b0", "#f542e0"];
  var NOM_PHRASES = ["NOM!", "nam nam nam!", "sjiit sa godt!", "bedre enn kvaefjordkaka!", "NOM NOM!", "DIGG!", "nam!", "MMM!"];
  var COOKIE_PHRASES = ["DESSERT!", "SMA GODT!", "DIGG COOKIE!", "NOM NOM!", "SUKKER!", "MMM COOKIES!"];
  var GOLD_PHRASES = ["GULL!", "5x COMBO!", "JACKPOT!", "MEGA NOM!", "GULLANSEN!", "KA-CHING!"];
  var POWERUP_ICONS = { speed: "\u26A1", magnet: "\uD83E\uDDF2", ghost: "\uD83D\uDC7B" };
  var POWERUP_COLORS = { speed: "#f7c948", magnet: "#e94560", ghost: "#af7ac5" };
  var playerPhrases = {};
  var particles = [];
  var shakeTimer = 0;
  var lastScores = {};
  var cachedObstacles = [];
  var currentPhase = 1;
  var twistActive = false;
  var twistStartTime = 0;
  var bannerTimeout1 = null, bannerTimeout2 = null, bannerTimeout3 = null;

  // Phase-dependent background colors
  var BG_COLORS = {
    1: "#0f172a",   // dark navy (chicken room)
    2: "#1a0f0a",   // warm dark brown (dessert room)
    3: "#0f172a",   // back to navy for twist
  };
  var GRID_COLORS = {
    1: "rgba(255,255,255,0.02)",
    2: "rgba(255,200,100,0.03)",
    3: "rgba(255,255,255,0.02)",
  };
  var OBSTACLE_COLORS = {
    1: { fill: "#1e2d4a", highlight: "#2a4060", border: "#4a6a9e", cross: "rgba(255,255,255,0.06)" },
    2: { fill: "#3a2010", highlight: "#4a3020", border: "#7a5a3a", cross: "rgba(255,200,100,0.08)" },
    3: { fill: "#1e2d4a", highlight: "#2a4060", border: "#4a6a9e", cross: "rgba(255,255,255,0.06)" },
  };

  function showBanner(text, color, animStyle) {
    clearTimeout(bannerTimeout1);
    clearTimeout(bannerTimeout2);
    clearTimeout(bannerTimeout3);

    bannerText.innerHTML = text;
    bannerText.style.color = color;
    bannerOverlay.style.display = "block";

    if (animStyle === "twist") {
      bannerOverlay.style.animation = "bannerBg 0.3s linear infinite";
      bannerText.style.animation = "bannerEntry 1.2s cubic-bezier(0.34,1.56,0.64,1) forwards";
      bannerTimeout1 = setTimeout(function() {
        bannerText.style.animation = "bannerBlink 0.4s linear infinite, bannerSpin 3s linear infinite";
      }, 1200);
      bannerTimeout2 = setTimeout(function() {
        bannerText.style.animation = "bannerFade 1s ease-out forwards";
        bannerOverlay.style.animation = "none";
        bannerOverlay.style.background = "none";
      }, 3500);
      bannerTimeout3 = setTimeout(function() {
        bannerOverlay.style.display = "none";
      }, 4500);
    } else {
      bannerOverlay.style.animation = "none";
      bannerOverlay.style.background = "rgba(0,0,0,0.5)";
      bannerText.style.animation = "dessertEntry 1s cubic-bezier(0.34,1.56,0.64,1) forwards";
      bannerTimeout1 = setTimeout(function() {
        bannerText.style.animation = "dessertBlink 0.5s linear infinite";
      }, 1000);
      bannerTimeout2 = setTimeout(function() {
        bannerText.style.animation = "bannerFade 0.8s ease-out forwards";
        bannerOverlay.style.background = "none";
      }, 3000);
      bannerTimeout3 = setTimeout(function() {
        bannerOverlay.style.display = "none";
      }, 3800);
    }
  }

  function onPhase(data) {
    currentPhase = data.phase;
    if (data.phase === 2) {
      shakeTimer = 20;
      showBanner("DESSERT<br>ROOM", "#ff8c42", "dessert");
      controls.textContent = "Cookies worth 2 pts! Catch them all!";
      controls.style.color = "#ff8c42";
      canvas.style.border = "3px solid #7a5a3a";
      canvas.style.boxShadow = "0 0 40px rgba(255,140,60,0.2)";
    }
  }

  function onTwist() {
    twistActive = true;
    twistStartTime = Date.now();
    currentPhase = 3;
    shakeTimer = 30;
    showBanner("LONGSHOT<br>TWIST", "#f7c948", "twist");
    controls.textContent = "CONTROLS REVERSED! Golden chickens = 5 points!";
    controls.style.color = "#f7c948";
    canvas.style.border = "3px solid #e94560";
    canvas.style.boxShadow = "0 0 40px rgba(233,69,96,0.3)";
  }

  function drawObstacle(o) {
    var colors = OBSTACLE_COLORS[currentPhase] || OBSTACLE_COLORS[1];
    ctx.fillStyle = colors.fill;
    ctx.fillRect(o.x, o.y, o.w, o.h);
    ctx.fillStyle = colors.highlight;
    ctx.fillRect(o.x, o.y, o.w, o.h / 3);
    ctx.strokeStyle = colors.border;
    ctx.lineWidth = 2;
    ctx.strokeRect(o.x, o.y, o.w, o.h);
    ctx.strokeStyle = colors.cross;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(o.x, o.y); ctx.lineTo(o.x + o.w, o.y + o.h);
    ctx.moveTo(o.x + o.w, o.y); ctx.lineTo(o.x, o.y + o.h);
    ctx.stroke();
  }

  function drawPowerup(pu) {
    ctx.save();
    var pulse = 1 + Math.sin(Date.now() * 0.006 + pu.id * 2) * 0.15;
    var color = POWERUP_COLORS[pu.type] || "#fff";
    ctx.shadowColor = color;
    ctx.shadowBlur = 12;
    ctx.fillStyle = "rgba(15,23,42,0.8)";
    ctx.beginPath();
    ctx.arc(pu.x, pu.y, 18 * pulse, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.font = Math.round(20 * pulse) + "px serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#fff";
    ctx.fillText(POWERUP_ICONS[pu.type] || "?", pu.x, pu.y);
    ctx.textBaseline = "alphabetic";
    ctx.restore();
  }

  function onCountdown(data) {
    var count = data.count;
    ctx.fillStyle = "#0f172a";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (lasseImg.complete) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(canvas.width / 2 - 80, canvas.height / 2 - 50, 50, 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(lasseImg, canvas.width / 2 - 130, canvas.height / 2 - 100, 100, 100);
      ctx.restore();
    }
    if (chickenImg.complete) {
      ctx.drawImage(chickenImg, canvas.width / 2 + 30, canvas.height / 2 - 80, 70, 70);
    }

    ctx.fillStyle = "#f7c948";
    ctx.font = "bold 96px monospace";
    ctx.textAlign = "center";
    ctx.fillText(count > 0 ? count : "EAT!", canvas.width / 2, canvas.height / 2 + 80);
    ctx.fillStyle = "#8892a4";
    ctx.font = "18px monospace";
    ctx.fillText("Catch the chickens! Bump others to stun!", canvas.width / 2, canvas.height / 2 + 115);
  }

  function onState(data) {
    var players = data.players;
    var chickens = data.chickens;
    var powerups = data.powerups;
    var obstacles = data.obstacles;
    var timeLeft = data.timeLeft;
    var totalTimeLeft = data.totalTimeLeft;
    var phase = data.phase;
    var twist = data.twist;

    if (obstacles) cachedObstacles = obstacles;
    if (phase && phase !== currentPhase && phase < 3) currentPhase = phase;
    if (twist && !twistActive) onTwist();

    // Eat particles
    players.forEach(function(p) {
      if (p.justAte && (!lastScores[p.id] || lastScores[p.id] < p.score)) {
        var scoreDiff = p.score - (lastScores[p.id] || 0);
        var isGoldEat = scoreDiff >= 5;
        var isCookieEat = !isGoldEat && currentPhase === 2;
        playerPhrases[p.id] = isGoldEat
          ? GOLD_PHRASES[Math.floor(Math.random() * GOLD_PHRASES.length)]
          : (isCookieEat
            ? COOKIE_PHRASES[Math.floor(Math.random() * COOKIE_PHRASES.length)]
            : NOM_PHRASES[Math.floor(Math.random() * NOM_PHRASES.length)]);
        var particleCount = isGoldEat ? 25 : (isCookieEat ? 15 : 12);
        for (var i = 0; i < particleCount; i++) {
          var angle = Math.random() * Math.PI * 2;
          var speed = 2 + Math.random() * (isGoldEat ? 5 : 3);
          particles.push({
            x: p.x, y: p.y,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed - 2,
            life: 1,
            color: isGoldEat
              ? ["#f7c948", "#ffd700", "#ffe066", "#ffb347"][Math.floor(Math.random() * 4)]
              : (isCookieEat
                ? ["#ff8c42", "#c8a060", "#f7c948", "#8B4513"][Math.floor(Math.random() * 4)]
                : ["#f7c948", "#ff8c42", "#c8a060", "#e94560"][Math.floor(Math.random() * 4)]),
            size: isGoldEat ? 4 + Math.random() * 6 : 3 + Math.random() * 4,
          });
        }
        if (p.id === myId) shakeTimer = isGoldEat ? 12 : 6;
      }
      lastScores[p.id] = p.score;
    });

    particles = particles.filter(function(p) {
      p.x += p.vx; p.y += p.vy; p.vy += 0.12; p.life -= 0.025;
      return p.life > 0;
    });

    ctx.save();
    if (shakeTimer > 0) {
      shakeTimer--;
      ctx.translate((Math.random() - 0.5) * shakeTimer * 2, (Math.random() - 0.5) * shakeTimer * 2);
    }

    // Background
    var bg = BG_COLORS[currentPhase] || BG_COLORS[1];
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Twist red pulse overlay
    if (twistActive) {
      var twistElapsed = Date.now() - twistStartTime;
      var pulse = Math.sin(twistElapsed * 0.003) * 0.08;
      ctx.fillStyle = "rgba(233,69,96," + (0.08 + pulse) + ")";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    // Grid
    ctx.strokeStyle = GRID_COLORS[currentPhase] || GRID_COLORS[1];
    ctx.lineWidth = 1;
    for (var gx = 0; gx < canvas.width; gx += 60) {
      ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, canvas.height); ctx.stroke();
    }
    for (var gy = 0; gy < canvas.height; gy += 60) {
      ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(canvas.width, gy); ctx.stroke();
    }

    // Obstacles
    cachedObstacles.forEach(drawObstacle);

    // Power-ups
    if (powerups) powerups.forEach(drawPowerup);

    // Food (chickens, cookies, golden)
    chickens.forEach(function(c) {
      ctx.save();
      var wobble = Math.sin(Date.now() * 0.008 + c.x) * 2;
      var bounce = Math.abs(Math.sin(Date.now() * 0.006 + c.y)) * (2 + c.panic * 4);

      if (c.golden) {
        // Golden glow
        ctx.shadowColor = "#ffd700";
        ctx.shadowBlur = 20 + Math.sin(Date.now() * 0.01) * 10;
        // Sparkles
        for (var sp = 0; sp < 3; sp++) {
          var spAngle = Date.now() * 0.004 + sp * (Math.PI * 2 / 3) + c.x;
          var spDist = 22 + Math.sin(Date.now() * 0.008 + sp) * 6;
          var spx = c.x + Math.cos(spAngle) * spDist;
          var spy = c.y - bounce + wobble + Math.sin(spAngle) * spDist;
          ctx.fillStyle = "#ffd700";
          ctx.globalAlpha = 0.5 + Math.sin(Date.now() * 0.01 + sp) * 0.4;
          ctx.font = "10px monospace";
          ctx.textAlign = "center";
          ctx.fillText("\u2726", spx, spy);
        }
        ctx.globalAlpha = 1;
      }

      if (c.cookie) {
        // Cookie warm glow
        ctx.shadowColor = "#ff8c42";
        ctx.shadowBlur = 10 + Math.sin(Date.now() * 0.008) * 5;
      }

      // Shadow
      ctx.fillStyle = c.golden ? "rgba(255,215,0,0.3)" : (c.cookie ? "rgba(200,140,60,0.3)" : "rgba(0,0,0,0.2)");
      ctx.beginPath();
      ctx.ellipse(c.x, c.y + 22, c.golden ? 20 : 16, 5, 0, 0, Math.PI * 2);
      ctx.fill();

      // Sweat when panicked
      if (c.panic > 0.6 && !c.cookie) {
        ctx.fillStyle = "#5dade2";
        ctx.beginPath();
        ctx.ellipse(c.x + 18, c.y - 12 + Math.sin(Date.now() * 0.01) * 3, 2, 3, 0, 0, Math.PI * 2);
        ctx.fill();
      }

      // Image
      var img, size;
      if (c.golden) {
        img = goldenChickenImg; size = 50;
      } else if (c.cookie) {
        img = cookieImg; size = 38;
      } else {
        img = chickenImg; size = 40;
      }
      if (img.complete) {
        ctx.drawImage(img, c.x - size / 2, c.y - size / 2 - bounce + wobble, size, size);
      } else {
        ctx.fillStyle = c.golden ? "#ffd700" : (c.cookie ? "#c8a060" : "#c8a060");
        ctx.beginPath();
        ctx.arc(c.x, c.y - bounce + wobble, c.golden ? 20 : 15, 0, Math.PI * 2);
        ctx.fill();
      }

      // Value label
      if (c.golden) {
        ctx.shadowBlur = 0;
        ctx.fillStyle = "#ffd700";
        ctx.font = "bold 11px monospace";
        ctx.textAlign = "center";
        ctx.fillText("5 pts", c.x, c.y + 30 - bounce + wobble);
      } else if (c.cookie) {
        ctx.shadowBlur = 0;
        ctx.fillStyle = "#ff8c42";
        ctx.font = "bold 10px monospace";
        ctx.textAlign = "center";
        ctx.fillText("2 pts", c.x, c.y + 28 - bounce + wobble);
      }

      ctx.restore();
    });

    // Particles
    particles.forEach(function(p) {
      ctx.globalAlpha = p.life;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;

    // Players
    players.forEach(function(p) {
      var isMe = p.id === myId;
      var r = 28;
      var bobY = Math.sin(Date.now() * 0.005 + p.x) * 2;

      ctx.save();

      if (p.powerup === "ghost") ctx.globalAlpha = 0.4;

      // Shadow
      ctx.fillStyle = "rgba(0,0,0,0.25)";
      ctx.beginPath();
      ctx.ellipse(p.x, p.y + r + 4, r * 0.6, 5, 0, 0, Math.PI * 2);
      ctx.fill();

      // Power-up aura
      if (p.powerup) {
        var auraColor = POWERUP_COLORS[p.powerup] || "#fff";
        ctx.save();
        ctx.strokeStyle = auraColor;
        ctx.lineWidth = 2;
        ctx.globalAlpha = p.powerup === "ghost" ? 0.3 : 0.6;
        ctx.beginPath();
        ctx.arc(p.x, p.y + bobY, r + 8, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
        if (p.powerup === "ghost") ctx.globalAlpha = 0.4;
      }

      // Stun
      if (p.stunned) {
        ctx.globalAlpha = 0.5 + Math.sin(Date.now() * 0.02) * 0.3;
        for (var si = 0; si < 3; si++) {
          var starAngle = Date.now() * 0.005 + si * (Math.PI * 2 / 3);
          var stx = p.x + Math.cos(starAngle) * (r + 8);
          var sty = p.y - r - 5 + Math.sin(starAngle) * 5 + bobY;
          ctx.fillStyle = "#f7c948";
          ctx.font = "14px monospace";
          ctx.textAlign = "center";
          ctx.fillText("*", stx, sty);
        }
      }

      // Lasse face
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
      ctx.globalAlpha = p.stunned ? 0.4 : (p.powerup === "ghost" ? 0.4 : 1);
      ctx.strokeStyle = isMe ? "#fff" : p.color;
      ctx.lineWidth = isMe ? 4 : 2;
      ctx.beginPath();
      ctx.arc(p.x, p.y + bobY, r, 0, Math.PI * 2);
      ctx.stroke();

      // Mouth
      if (p.mouthOpen > 0.1) {
        ctx.globalAlpha = 1;
        ctx.fillStyle = "#1a1a1a";
        ctx.beginPath();
        ctx.ellipse(p.x, p.y + bobY + r * 0.35, 5 + p.mouthOpen * 8, 3 + p.mouthOpen * 6, 0, 0, Math.PI * 2);
        ctx.fill();
      }

      // Eating phrase
      if (p.justAte) {
        var phrase = playerPhrases[p.id] || "NOM!";
        ctx.globalAlpha = 1;
        ctx.fillStyle = currentPhase === 2 ? "#ff8c42" : "#f7c948";
        ctx.font = "bold 16px monospace";
        ctx.textAlign = "center";
        ctx.shadowColor = "#000";
        ctx.shadowBlur = 4;
        ctx.fillText(phrase, p.x, p.y - r - 12 + bobY);
        ctx.shadowBlur = 0;
      }

      ctx.globalAlpha = 1;

      // Name + score
      ctx.fillStyle = isMe ? "#f7c948" : "#fff";
      ctx.font = "bold 12px monospace";
      ctx.textAlign = "center";
      ctx.shadowColor = "#000";
      ctx.shadowBlur = 3;
      ctx.fillText(p.name, p.x, p.y + r + 18 + bobY);
      ctx.fillStyle = "#4ecca3";
      ctx.fillText(p.score + " pts", p.x, p.y + r + 32 + bobY);

      if (p.powerup && !p.justAte) {
        ctx.font = "14px serif";
        ctx.fillText(POWERUP_ICONS[p.powerup] || "", p.x, p.y - r - 8 + bobY);
      }
      ctx.shadowBlur = 0;

      ctx.restore();
    });

    // HUD — Phase indicator + Timer
    var phaseLabel = currentPhase === 1 ? "CHICKEN ROOM" : (currentPhase === 2 ? "DESSERT ROOM" : "LONGSHOT TWIST");
    var phaseColor = currentPhase === 1 ? "#4ecca3" : (currentPhase === 2 ? "#ff8c42" : "#e94560");

    // Phase label (top left)
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.fillRect(6, 4, 160, 22);
    ctx.fillStyle = phaseColor;
    ctx.font = "bold 13px monospace";
    ctx.textAlign = "left";
    ctx.fillText(phaseLabel, 12, 20);

    // Timer (center)
    ctx.fillStyle = twistActive ? "rgba(233,69,96,0.8)" : (currentPhase === 2 ? "rgba(140,80,20,0.7)" : "rgba(0,0,0,0.6)");
    ctx.fillRect(canvas.width / 2 - 50, 4, 100, 28);
    ctx.textAlign = "center";
    ctx.font = "bold 20px monospace";
    if (twistActive) {
      ctx.fillStyle = "#f7c948";
      ctx.fillText("\u26A1 " + timeLeft + "s \u26A1", canvas.width / 2, 26);
    } else {
      ctx.fillStyle = timeLeft <= 5 ? "#e94560" : "#fff";
      ctx.fillText(timeLeft + "s", canvas.width / 2, 26);
    }

    // Total time remaining (small, below timer)
    if (totalTimeLeft !== undefined) {
      ctx.fillStyle = "#8892a4";
      ctx.font = "10px monospace";
      ctx.textAlign = "center";
      var totalMin = Math.floor(totalTimeLeft / 60);
      var totalSec = totalTimeLeft % 60;
      ctx.fillText("total " + totalMin + ":" + (totalSec < 10 ? "0" : "") + totalSec, canvas.width / 2, 42);
    }

    // "CONTROLS REVERSED" during twist (after banner fades)
    if (twistActive && Date.now() - twistStartTime > 4500) {
      ctx.fillStyle = "rgba(233,69,96," + (0.6 + Math.sin(Date.now() * 0.008) * 0.3) + ")";
      ctx.font = "bold 18px monospace";
      ctx.textAlign = "center";
      ctx.fillText("CONTROLS REVERSED!", canvas.width / 2, 62);
    }

    // Scoreboard
    ctx.textAlign = "right";
    ctx.font = "bold 13px monospace";
    var sorted = players.slice().sort(function(a, b) { return b.score - a.score; });
    sorted.forEach(function(p, i) {
      ctx.fillStyle = p.id === myId ? "#f7c948" : COLORS[p.colorIdx % COLORS.length];
      ctx.fillText(p.name + ": " + p.score, canvas.width - 10, 20 + i * 18);
    });

    ctx.restore();
  }

  // Input
  var keys = {};
  function updateDir() {
    var dx = (keys["ArrowRight"] || keys["d"] ? 1 : 0) - (keys["ArrowLeft"] || keys["a"] ? 1 : 0);
    var dy = (keys["ArrowDown"] || keys["s"] ? 1 : 0) - (keys["ArrowUp"] || keys["w"] ? 1 : 0);
    socket.emit("hungry-input", { dx: dx, dy: dy });
  }
  function onKeyDown(e) {
    if (["ArrowLeft","ArrowRight","ArrowUp","ArrowDown","a","d","w","s"].indexOf(e.key) >= 0) {
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
  socket.on("hungry-twist", onTwist);
  socket.on("hungry-phase", onPhase);

  _hungryCleanup = [
    function() { document.removeEventListener("keydown", onKeyDown); },
    function() { document.removeEventListener("keyup", onKeyUp); },
    function() { socket.off("hungry-countdown", onCountdown); },
    function() { socket.off("hungry-state", onState); },
    function() { socket.off("hungry-twist", onTwist); },
    function() { socket.off("hungry-phase", onPhase); },
    function() { clearTimeout(bannerTimeout1); clearTimeout(bannerTimeout2); clearTimeout(bannerTimeout3); },
  ];
}

function cleanupHungryClient() {
  _hungryCleanup.forEach(function(fn) { fn(); });
  _hungryCleanup = [];
}
