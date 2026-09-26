// Claudeshot Eye of Ark — a Fall Mountain race up Barad-dur (client side).
//
// Exposes the two globals the platform expects: initEyeClient / cleanupEyeClient.
// three.js is pulled in with a dynamic import INSIDE init (not a module script) so
// game.html keeps its plain <script> tags, exactly like the shooter.
//
// Split of responsibility:
//   eye-course.js  the course, every hazard and the Eye's gaze, as pure functions
//                  of the race clock - shared with the server
//   eye-art.js     scenery, lighting, bloom, the beans and the crown
//   this file      the race itself: physics, camera, input, course meshes, HUD
//
// Movement is client-authoritative (a capsule against an Octree of the course,
// plus analytic collisions with the moving hazards). The server referees
// checkpoints, the crown, bumps and grabs.

(function () {
  "use strict";

  // ---- feel -------------------------------------------------------------
  const GRAVITY = 30;
  const JUMP_SPEED = 10;             // apex ~1.67 m
  const RUN_SPEED = 7.5;
  const GROUND_RATE = 16;            // how fast you reach the speed you ask for
  const AIR_RATE = 5;
  const STUN_GROUND_RATE = 1.6;
  const STUN_AIR_RATE = 0.5;
  const FLOOR_NY = 0.55;             // steeper than this is a wall
  const SUB_STEPS = 5;
  const SNAP = 0.35;                 // keeps you glued to the floor running downhill
  const COYOTE_MS = 110;
  const JUMP_BUFFER_MS = 130;
  const DIVE_SPEED = 11;
  const DIVE_HOP = 4.5;
  const DIVE_SLIDE_MS = 420;
  const DIVE_RECOVER_MS = 220;
  const DIVE_COOLDOWN_MS = 850;
  const STUN_S = 0.7;
  const SEND_MS = 50;
  const LOOK_SENS = 0.0026;
  const KEY_ORBIT = 2.4;             // rad/s the arrow keys turn the camera
  const KEY_TILT = 1.3;              // rad/s the arrow keys tilt it
  const PAD_ORBIT = 3.0;             // right stick, at full deflection
  const PAD_TILT = 1.6;
  const PAD_DEAD = 0.2;
  const AUTO_CAM_IDLE_MS = 1000;     // hands off the camera this long -> it follows you
  const AUTO_CAM_MAX = 2.6;          // rad/s the follow camera may swing, never a snap
  const CAM_DIST = 7.5;
  const CAM_HEIGHT = 1.5;
  const RESPAWN_MS = 1100;
  const GRAB_TRY_MS = 150;
  // Holds are short and strong: the victim is pinned in front of the grabber
  // and can barely move; mashing Space breaks free early.
  const HELD_SPEED = 0.08;           // victim's run speed while held
  const HOLDING_SPEED = 0.75;        // grabber's run speed while holding
  const HOLD_GAP = 1.1;              // victim kept this far in front of the grabber's hands
  const HOLD_MS = 1600;              // server's max hold, for the HUD bars
  const STRUGGLE_BREAK = 5;          // server's presses to break free
  const TEAMS = ["bookis", "norli"];
  const CROWN_TRY_MS = 300;
  const BEAN_GAP = 0.9;              // two bean radii
  const FONT = "'Titan One', Nunito, sans-serif";

  const PALETTE = {
    pink: 0xff4fa0, pinkL: 0xff86c0,
    purple: 0x8f5cff, purpleL: 0xb08cff,
    yellow: 0xffd23f, yellowL: 0xffe27a,
    cyan: 0x3fe0ff, cyanL: 0x8aefff,
    white: 0xfff6fb,
    iron: 0x2a2330, stone: 0x3a3036, gold: 0xffc21a,
  };

  // Logos live in assets/, next to games/ - resolved from this script so the
  // dev sandbox (one folder deeper) finds them too.
  const ASSETS = (() => {
    try { return new URL("../assets/", document.currentScript.src).href; } catch (e) { return "assets/"; }
  })();

  let session = null;

  window.initEyeClient = function (socket, myId, room) {
    if (session) session.dispose();
    session = createSession();
    boot(session, socket, myId, room).catch((err) => {
      console.error("[eye] failed to start", err);
      const area = document.getElementById("game-area");
      if (area) area.innerHTML = '<p class="waiting-msg">Could not load the 3D engine. Check your connection and refresh.</p>';
    });
  };

  window.cleanupEyeClient = function () {
    if (session) session.dispose();
    session = null;
  };

  function createSession() {
    const s = {
      disposed: false,
      raf: 0,
      intervals: [],
      timeouts: [],
      domListeners: [],
      socketEvents: [],
      cleanups: [],
      renderer: null,
      socket: null,
    };
    s.on = function (target, type, fn, opts) {
      target.addEventListener(type, fn, opts);
      s.domListeners.push([target, type, fn, opts]);
    };
    s.sock = function (event, fn) {
      s.socket.on(event, fn);
      s.socketEvents.push([event, fn]);
    };
    s.dispose = function () {
      if (s.disposed) return;
      s.disposed = true;
      cancelAnimationFrame(s.raf);
      s.intervals.forEach(clearInterval);
      s.timeouts.forEach(clearTimeout);
      s.domListeners.forEach(([t, ty, fn, o]) => t.removeEventListener(ty, fn, o));
      s.cleanups.forEach((fn) => { try { fn(); } catch (e) { /* best effort */ } });
      if (s.socket) s.socketEvents.forEach(([e, fn]) => s.socket.off(e, fn));
      if (document.pointerLockElement) document.exitPointerLock();
      if (s.renderer) { s.renderer.dispose(); s.renderer.forceContextLoss?.(); }
      const area = document.getElementById("game-area");
      if (area) area.innerHTML = "";
    };
    return s;
  }

  async function boot(s, socket, myId, room) {
    s.socket = socket;
    const course = window.EYE_COURSE;
    const DEBUG = window.EYE_DEBUG || {};

    // The loading screen goes up before anything heavy is fetched, and stays
    // until the server starts the intro for everyone at once.
    const fontLink = document.createElement("link");
    fontLink.rel = "stylesheet";
    fontLink.href = "https://fonts.googleapis.com/css2?family=Titan+One&display=swap";
    document.head.appendChild(fontLink);
    const loader = buildLoader(course);
    s.cleanups.push(() => loader.dispose());
    {
      const area0 = document.getElementById("game-area");
      if (area0) { area0.innerHTML = ""; area0.appendChild(loader.el); }
    }
    loader.step("Summoning the Dark Tower\u2026", 0.12);

    const [THREE, octreeMod, capsuleMod, geoUtils, roundedMod] = await Promise.all([
      import("three"),
      import("three/addons/math/Octree.js"),
      import("three/addons/math/Capsule.js"),
      import("three/addons/utils/BufferGeometryUtils.js"),
      import("three/addons/geometries/RoundedBoxGeometry.js"),
    ]);
    if (s.disposed) return;
    const { Octree } = octreeMod;
    const { Capsule } = capsuleMod;
    const { mergeGeometries } = geoUtils;
    const { RoundedBoxGeometry } = roundedMod;

    loader.step("Raising the tower of ARK\u2026", 0.35);

    // ---------------------------------------------------------------- layout
    const pageStyle = document.createElement("style");
    pageStyle.textContent = [
      "body.eye-active .container{max-width:99vw !important;width:99vw !important;padding:0.4rem !important;}",
      "body.eye-active .page-center{padding:0 !important;}",
      "body.eye-active .game-area-card{padding:0.4rem !important;max-width:none !important;}",
      "body.eye-active .logo,body.eye-active .tagline{display:none !important;}",
      "body.eye-active #game-area{width:100%;}",
      "@keyframes eyePop{0%{transform:scale(2.2);opacity:0}25%{transform:scale(0.9);opacity:1}40%{transform:scale(1.05)}100%{transform:scale(1);opacity:1}}",
      "@keyframes eyePulse{0%,100%{transform:scale(1);opacity:0.75}50%{transform:scale(1.18);opacity:1}}",
      "@keyframes eyeWobble{0%,100%{transform:translateX(-50%) rotate(-2deg)}50%{transform:translateX(-50%) rotate(2deg)}}",
      "@keyframes eyeHeld{0%,100%{filter:brightness(1)}50%{filter:brightness(1.6)}}",
      "@keyframes eyeSlam{0%{transform:scale(3.4);filter:blur(14px);opacity:0}32%{transform:scale(0.9);filter:blur(0);opacity:1}48%{transform:scale(1.07)}64%{transform:scale(0.97)}100%{transform:scale(1);opacity:1}}",
      "@keyframes eyeRise{0%{transform:translateY(34px);opacity:0;letter-spacing:22px}100%{transform:translateY(0);opacity:1;letter-spacing:5px}}",
      "@keyframes eyeCount{0%{transform:scale(0.15) rotate(-14deg);opacity:0}42%{transform:scale(1.28) rotate(5deg);opacity:1}66%{transform:scale(0.9) rotate(-2deg)}84%{transform:scale(1.05)}100%{transform:scale(1) rotate(0)}}",
      "@keyframes eyeSlideIn{0%{transform:translateX(-130%) skewX(-12deg);opacity:0}60%{transform:translateX(6%) skewX(-12deg);opacity:1}100%{transform:translateX(0) skewX(-12deg);opacity:1}}",
      "@keyframes eyeCut{0%{opacity:0.95}100%{opacity:0}}",
      "@keyframes eyeFire{0%,100%{background-position:0% 40%}50%{background-position:0% 70%}}",
      "@keyframes eyeFlicker{0%,100%{opacity:1;transform:scale(1)}40%{opacity:0.82;transform:scale(1.03,0.97)}70%{opacity:0.95;transform:scale(0.98,1.03)}}",
      "@keyframes eyeSpin{to{transform:rotate(360deg)}}",
      "@keyframes eyeShake{0%,100%{transform:translate(0,0) rotate(-1.5deg)}25%{transform:translate(-6px,3px) rotate(1.5deg)}50%{transform:translate(5px,-3px) rotate(-1deg)}75%{transform:translate(-3px,-4px) rotate(1deg)}}",
    ].join("\n");
    document.head.appendChild(pageStyle);
    document.body.classList.add("eye-active");
    s.cleanups.push(() => {
      document.body.classList.remove("eye-active");
      pageStyle.remove();
      fontLink.remove();
      if (document.fullscreenElement) document.exitFullscreen();
    });

    const area = document.getElementById("game-area");
    area.innerHTML = "";
    const wrap = document.createElement("div");
    wrap.style.cssText = "position:relative;width:100%;margin:0 auto;border-radius:10px;overflow:hidden;" +
      "background:#1a0b0e;display:flex;align-items:center;justify-content:center;";
    area.appendChild(wrap);
    loader.attach(wrap);

    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.domElement.style.cssText = "display:block;width:100%;height:auto;";
    wrap.appendChild(renderer.domElement);
    s.renderer = renderer;

    const hud = buildHud(wrap, course);
    s.cleanups.push(() => hud.stopTimers());

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(70, 16 / 9, 0.1, 1500);

    // Scenery comes from the art module; a small stand-in keeps the race
    // playable if it is missing or fails.
    let art = null;
    if (window.EYE_ART && typeof window.EYE_ART.buildWorld === "function") {
      try {
        art = await window.EYE_ART.buildWorld(THREE, { scene, renderer, camera, course });
      } catch (err) {
        console.warn("[eye] art failed, using the stand-in", err);
        art = null;
      }
    }
    if (s.disposed) { art?.dispose?.(); return; }
    if (!art) art = stubWorld(THREE, scene, renderer, camera, course);
    loader.step("Lighting the Eye\u2026", 0.6);
    s.cleanups.push(() => { try { art.dispose(); } catch (e) { /* ignore */ } });

    const makeBean = (opts) => {
      if (window.EYE_ART && typeof window.EYE_ART.buildBean === "function") {
        try { return window.EYE_ART.buildBean(THREE, opts); } catch (e) { console.warn("[eye] bean failed", e); }
      }
      return stubBean(THREE, opts);
    };
    const makeHostages = () => {
      if (window.EYE_ART && typeof window.EYE_ART.buildHostages === "function") {
        try { return window.EYE_ART.buildHostages(THREE, { course }); } catch (e) { console.warn("[eye] hostages failed", e); }
      }
      return null;
    };
    const makeCrown = () => {
      if (window.EYE_ART && typeof window.EYE_ART.buildCrown === "function") {
        try { return window.EYE_ART.buildCrown(THREE); } catch (e) { console.warn("[eye] crown failed", e); }
      }
      return stubCrown(THREE);
    };

    function resize() {
      const fs = !!document.fullscreenElement;
      let w, h;
      if (fs) {
        w = window.innerWidth;
        h = window.innerHeight;
      } else {
        const availW = Math.max(320, wrap.clientWidth || window.innerWidth - 24);
        const availH = Math.max(320, window.innerHeight - 110);
        w = availW;
        h = Math.round(w * 9 / 16);
        if (h > availH) { h = availH; w = Math.round(h * 16 / 9); }
      }
      renderer.setSize(w, h, false);
      renderer.domElement.style.width = w + "px";
      renderer.domElement.style.height = h + "px";
      wrap.style.width = fs ? "" : w + "px";
      wrap.style.height = fs ? "" : h + "px";
      const layer = hud.layer;
      layer.style.width = w + "px";
      layer.style.height = h + "px";
      layer.style.left = "50%";
      layer.style.top = "50%";
      layer.style.right = "auto";
      layer.style.bottom = "auto";
      layer.style.transform = "translate(-50%, -50%)";
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      try { art.setSize(w, h); } catch (e) { /* ignore */ }
    }
    resize();
    s.on(window, "resize", resize);
    s.on(document, "fullscreenchange", () => setTimeout(resize, 60));

    // ------------------------------------------------------------- the course
    // Two parallel builds of every piece:
    //   collideGroup - plain boxes/cylinders, never drawn: the Octree, the
    //                  camera's line-of-sight rays
    //   visuals      - rounded candy geometry, merged per material
    const collideGroup = new THREE.Group();
    const shelterMeshes = [];
    const mats = new Map();
    const batches = new Map();       // material key -> geometries (world space)
    const texCache = [];

    function candy(hex, opts) {
      const key = hex + JSON.stringify(opts || {});
      if (mats.has(key)) return mats.get(key);
      const m = new THREE.MeshStandardMaterial(Object.assign({
        color: hex, roughness: 0.5, metalness: 0.0,
        emissive: hex, emissiveIntensity: 0.1,
      }, opts || {}));
      mats.set(key, m);
      return m;
    }
    const MAT = {
      iron: candy(PALETTE.iron, { roughness: 0.42, metalness: 0.75, emissiveIntensity: 0.0 }),
      stone: candy(PALETTE.stone, { roughness: 0.92, emissiveIntensity: 0.0 }),
      white: candy(PALETTE.white),
      rune: new THREE.MeshStandardMaterial({ color: 0xff6a1a, emissive: 0xff5a10, emissiveIntensity: 2.6 }),
      gold: candy(PALETTE.gold, { roughness: 0.3, metalness: 0.8, emissiveIntensity: 0.15 }),
    };

    function addBatch(mat, geo) {
      let b = batches.get(mat);
      if (!b) { b = []; batches.set(mat, b); }
      const g = geo.index ? geo.toNonIndexed() : geo;
      if (g !== geo) geo.dispose();
      for (const name of Object.keys(g.attributes)) {
        if (name !== "position" && name !== "normal" && name !== "uv") g.deleteAttribute(name);
      }
      g.clearGroups();
      b.push(g);
    }

    const _m4 = new THREE.Matrix4();
    const _q = new THREE.Quaternion();
    const _e = new THREE.Euler();
    const _v = new THREE.Vector3();
    const _one = new THREE.Vector3(1, 1, 1);
    function pieceMatrix(p) {
      if (p.shape === "box") _e.set(p.rot ? p.rot[0] : 0, p.rot ? p.rot[1] : 0, 0, "YXZ");
      else _e.set(0, 0, 0);
      _q.setFromEuler(_e);
      _m4.compose(_v.set(p.pos[0], p.pos[1], p.pos[2]), _q, _one);
      return _m4;
    }

    function canvasTex(w, h, draw, repeat) {
      const cv = document.createElement("canvas");
      cv.width = w; cv.height = h;
      draw(cv.getContext("2d"), w, h);
      const t = new THREE.CanvasTexture(cv);
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 4;
      if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
      texCache.push(t);
      return t;
    }
    const hexCss = (h) => "#" + h.toString(16).padStart(6, "0");

    const stripeTex = (a, b, n) => canvasTex(256, 64, (ctx, w, h) => {
      ctx.fillStyle = hexCss(a); ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = hexCss(b);
      const step = w / n;
      for (let i = -1; i < n + 1; i++) {
        ctx.beginPath();
        ctx.moveTo(i * step, 0); ctx.lineTo(i * step + step / 2, 0);
        ctx.lineTo(i * step + step / 2 + h * 0.6, h); ctx.lineTo(i * step + h * 0.6, h);
        ctx.closePath(); ctx.fill();
      }
    });

    const discTopTex = canvasTex(512, 512, (ctx, w) => {
      const c = w / 2;
      for (let i = 0; i < 16; i++) {
        ctx.fillStyle = i % 2 ? hexCss(PALETTE.white) : hexCss(PALETTE.pink);
        ctx.beginPath(); ctx.moveTo(c, c);
        ctx.arc(c, c, c, (i / 16) * Math.PI * 2, ((i + 1) / 16) * Math.PI * 2);
        ctx.closePath(); ctx.fill();
      }
      ctx.fillStyle = hexCss(PALETTE.yellow);
      ctx.beginPath(); ctx.arc(c, c, c * 0.2, 0, Math.PI * 2); ctx.fill();
      ctx.lineWidth = 18; ctx.strokeStyle = hexCss(PALETTE.purple);
      ctx.beginPath(); ctx.arc(c, c, c - 9, 0, Math.PI * 2); ctx.stroke();
    });
    const summitTex = canvasTex(1024, 1024, (ctx, w) => {
      const c = w / 2;
      ctx.fillStyle = "#1c1620"; ctx.fillRect(0, 0, w, w);
      for (let r = c; r > 40; r -= 70) {
        ctx.strokeStyle = r % 140 < 70 ? "#ffc21a" : "#ff4fa0";
        ctx.lineWidth = 14;
        ctx.beginPath(); ctx.arc(c, c, r - 20, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.fillStyle = "rgba(255,120,30,0.35)";
      for (let i = 0; i < 24; i++) {
        const a = (i / 24) * Math.PI * 2;
        ctx.save(); ctx.translate(c + Math.cos(a) * c * 0.72, c + Math.sin(a) * c * 0.72); ctx.rotate(a);
        ctx.fillRect(-6, -24, 12, 48); ctx.restore();
      }
    });
    const emblemTex = canvasTex(256, 320, (ctx, w, h) => {
      ctx.fillStyle = "#1a1220"; ctx.beginPath();
      ctx.roundRect ? ctx.roundRect(6, 6, w - 12, h - 12, 26) : ctx.rect(6, 6, w - 12, h - 12);
      ctx.fill();
      ctx.lineWidth = 8; ctx.strokeStyle = "#ff6a1a"; ctx.stroke();
      // the Eye
      const cx = w / 2, cy = 120;
      const g = ctx.createRadialGradient(cx, cy, 5, cx, cy, 80);
      g.addColorStop(0, "#fff2a0"); g.addColorStop(0.45, "#ff8a1a"); g.addColorStop(1, "#b3200e");
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.ellipse(cx, cy, 80, 46, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#120808";
      ctx.beginPath(); ctx.ellipse(cx, cy, 9, 40, 0, 0, Math.PI * 2); ctx.fill();
      // crossed out
      ctx.strokeStyle = "#ff2d55"; ctx.lineWidth = 20; ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(cx - 90, cy + 70); ctx.lineTo(cx + 90, cy - 70); ctx.stroke();
      ctx.fillStyle = "#fff6fb";
      ctx.font = "900 50px Nunito, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText("COVER", cx, 258);
    });
    const barTex = stripeTex(0xff2d55, PALETTE.white, 6);
    const ballTex = stripeTex(PALETTE.purple, PALETTE.yellow, 4);
    const postTex = stripeTex(PALETTE.pink, PALETTE.white, 4);
    const stoneSideTex = stripeTex(PALETTE.pink, PALETTE.pinkL, 3);
    const rockTex = canvasTex(256, 256, (ctx, w, h) => {
      ctx.fillStyle = "#2a1512"; ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = "#ff7a1a"; ctx.lineCap = "round";
      for (let i = 0; i < 26; i++) {
        ctx.lineWidth = 2 + Math.random() * 5;
        ctx.beginPath();
        let x = Math.random() * w, y = Math.random() * h;
        ctx.moveTo(x, y);
        for (let k = 0; k < 4; k++) { x += (Math.random() - 0.5) * 70; y += (Math.random() - 0.5) * 70; ctx.lineTo(x, y); }
        ctx.stroke();
      }
    });

    const STYLE = {
      start: [PALETTE.yellow, PALETTE.yellowL],
      path: [PALETTE.pink, PALETTE.pinkL],
      checkpoint: [PALETTE.cyan, PALETTE.cyanL],
      bridge: [PALETTE.purple, PALETTE.purpleL],
      wall: [PALETTE.pink, PALETTE.pink],
    };

    let chunkIndex = 0;
    for (const p of course.pieces) {
      // collision twin
      const cgeo = p.shape === "box"
        ? new THREE.BoxGeometry(p.size[0], p.size[1], p.size[2])
        : new THREE.CylinderGeometry(p.radius, p.radius, p.height, 28);
      const cmesh = new THREE.Mesh(cgeo);
      cmesh.applyMatrix4(pieceMatrix(p).clone());
      // Walkway chunks collide as one smooth ribbon per section (built below):
      // chord boxes meet at slightly different yaws and leave ridges on ramps.
      const ribboned = STYLE[p.style] && p.shape === "box" && p.style !== "wall";
      if (p.collide !== false && !ribboned) collideGroup.add(cmesh);
      if (p.shelter) shelterMeshes.push(cmesh);

      const M = pieceMatrix(p).clone();
      if (STYLE[p.style] && p.shape === "box") {
        // walkway chunk: candy slab with a white lip under the edge
        const [a, b] = STYLE[p.style];
        const col = (chunkIndex++ % 2) ? b : a;
        const r = Math.min(0.28, p.size[1] / 2 - 0.02);
        const slab = new RoundedBoxGeometry(p.size[0], p.size[1], p.size[2], 2, r);
        slab.applyMatrix4(M);
        addBatch(candy(col), slab);
        const lip = new RoundedBoxGeometry(p.size[0] + 0.35, 0.4, p.size[2] - 0.1, 2, 0.16);
        lip.translate(0, -p.size[1] / 2 + 0.05, 0);
        lip.applyMatrix4(M);
        addBatch(MAT.white, lip);
        // support pillars down into the lava on every other chunk
        if (p.style !== "wall" && chunkIndex % 2 === 0) {
          const bottom = p.pos[1] - p.size[1] / 2;
          const len = bottom - (course.LAVA_Y - 2);
          if (len > 1) {
            const spots = p.size[0] > 12 ? [-p.size[0] / 4, p.size[0] / 4] : [0];
            for (const lat of spots) {
              const rad = Math.min(1.3, p.size[0] * 0.13);
              const g = new THREE.CylinderGeometry(rad * 0.8, rad * 1.25, len, 10);
              const ox = Math.cos(p.rot[1]) * lat, oz = -Math.sin(p.rot[1]) * lat;
              g.translate(p.pos[0] + ox, bottom - len / 2, p.pos[2] + oz);
              addBatch(MAT.stone, g);
            }
          }
        }
        continue;
      }
      if (p.style === "disc") {
        const g = new THREE.CylinderGeometry(p.radius, p.radius, p.height, 48);
        const mesh = new THREE.Mesh(g, [candy(PALETTE.pink), new THREE.MeshStandardMaterial({ map: discTopTex, roughness: 0.5, emissive: 0xffffff, emissiveMap: discTopTex, emissiveIntensity: 0.08 }), MAT.white]);
        mesh.applyMatrix4(M);
        scene.add(mesh);
        const rim = new THREE.TorusGeometry(p.radius, 0.22, 8, 64);
        rim.rotateX(Math.PI / 2);
        rim.translate(p.pos[0], p.pos[1] - p.height / 2 + 0.05, p.pos[2]);
        addBatch(MAT.white, rim);
        const len = p.pos[1] - (course.LAVA_Y - 2);
        const pil = new THREE.CylinderGeometry(1.4, 2.2, len, 12);
        pil.translate(p.pos[0], p.pos[1] - len / 2, p.pos[2]);
        addBatch(MAT.stone, pil);
        continue;
      }
      if (p.style === "stone") {
        const g = new THREE.CylinderGeometry(p.radius, p.radius, p.height, 32);
        const side = new THREE.MeshStandardMaterial({ map: stoneSideTex, roughness: 0.5, emissive: 0xffffff, emissiveMap: stoneSideTex, emissiveIntensity: 0.08 });
        stoneSideTex.repeat.set(3, 6);
        stoneSideTex.wrapS = stoneSideTex.wrapT = THREE.RepeatWrapping;
        const mesh = new THREE.Mesh(g, [side, candy(PALETTE.yellow), MAT.stone]);
        mesh.applyMatrix4(M);
        scene.add(mesh);
        const cap = new THREE.TorusGeometry(p.radius, 0.16, 8, 40);
        cap.rotateX(Math.PI / 2);
        cap.translate(p.pos[0], p.pos[1] + p.height / 2 - 0.05, p.pos[2]);
        addBatch(MAT.white, cap);
        const bottom = p.pos[1] - p.height / 2;
        const len = bottom - (course.LAVA_Y - 2);
        if (len > 0.5) {
          const pil = new THREE.CylinderGeometry(p.radius * 0.9, p.radius * 1.1, len, 12);
          pil.translate(p.pos[0], bottom - len / 2, p.pos[2]);
          addBatch(MAT.stone, pil);
        }
        continue;
      }
      if (p.style === "post") {
        const g = new THREE.CylinderGeometry(p.radius, p.radius, p.height, 20);
        const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: postTex, roughness: 0.5, emissive: 0xffffff, emissiveMap: postTex, emissiveIntensity: 0.08 }));
        mesh.applyMatrix4(M);
        scene.add(mesh);
        continue;
      }
      if (p.style === "summit") {
        const g = new THREE.CylinderGeometry(p.radius, p.radius * 0.96, p.height, 64);
        const top = new THREE.MeshStandardMaterial({ map: summitTex, roughness: 0.4, metalness: 0.4, emissive: 0xffffff, emissiveMap: summitTex, emissiveIntensity: 0.12 });
        const mesh = new THREE.Mesh(g, [MAT.iron, top, MAT.iron]);
        mesh.applyMatrix4(M);
        scene.add(mesh);
        const rim = new THREE.TorusGeometry(p.radius, 0.2, 8, 80);
        rim.rotateX(Math.PI / 2);
        rim.translate(0, p.pos[1] + p.height / 2, 0);
        addBatch(MAT.rune, rim);
        continue;
      }
      if (p.style === "pedestal") {
        const g = new THREE.CylinderGeometry(p.radius * 0.8, p.radius, p.height, 32);
        g.applyMatrix4(M);
        addBatch(MAT.gold, g);
        continue;
      }
      if (p.style === "horn") {
        const g = new THREE.CylinderGeometry(p.radius * 0.8, p.radius, p.height, 16);
        g.applyMatrix4(M);
        addBatch(MAT.iron, g);
        continue;
      }
      if (p.style === "arch") {
        const r = Math.min(0.2, Math.min(p.size[0], p.size[1], p.size[2]) / 2 - 0.02);
        const g = new RoundedBoxGeometry(p.size[0], p.size[1], p.size[2], 2, r);
        g.applyMatrix4(M);
        addBatch(MAT.iron, g);
        // roofs get glowing rune strips and a crossed-out Eye at each end
        if (p.shelter && p.size[1] <= 0.8) {
          for (const side of [-1, 1]) {
            const strip = new THREE.BoxGeometry(0.12, 0.14, p.size[2] - 0.4);
            strip.translate(side * (p.size[0] / 2 - 0.1), -p.size[1] / 2 - 0.02, 0);
            strip.applyMatrix4(M);
            addBatch(MAT.rune, strip);
          }
          // a two-faced COVER sign standing on the roof: readable from both
          // directions and from afar, and never in front of the camera
          const emblemMat = new THREE.MeshBasicMaterial({ map: emblemTex, transparent: true, toneMapped: false });
          const sign = new THREE.Group();
          for (const flip of [0, Math.PI]) {
            const plane = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 2.0), emblemMat);
            plane.rotation.y = flip;
            sign.add(plane);
          }
          sign.position.set(0, p.size[1] / 2 + 1.05, 0);
          const holder = new THREE.Group();
          holder.add(sign);
          holder.applyMatrix4(M);
          scene.add(holder);
        }
        continue;
      }
      // anything unknown: plain candy
      const g = p.shape === "box"
        ? new RoundedBoxGeometry(p.size[0], p.size[1], p.size[2], 2, 0.15)
        : new THREE.CylinderGeometry(p.radius, p.radius, p.height, 24);
      g.applyMatrix4(M);
      addBatch(candy(PALETTE.purple), g);
    }

    // checkpoint banners over the course (visual only)
    const bannerTex = (text, bg) => canvasTex(1024, 160, (ctx, w, h) => {
      ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = "rgba(255,255,255,0.25)";
      for (let i = 0; i < w; i += 64) ctx.fillRect(i, 0, 32, 14), ctx.fillRect(i + 32, h - 14, 32, 14);
      ctx.font = "900 92px Nunito, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.lineWidth = 12; ctx.strokeStyle = "#2b0f3a"; ctx.strokeText(text, w / 2, h / 2 + 4);
      ctx.fillStyle = "#fff6fb"; ctx.fillText(text, w / 2, h / 2 + 4);
    });
    function addBanner(sAt, text, bg, lift) {
      const q = course.pathPoint(sAt);
      const half = q.width / 2 + 0.6;
      const top = q.y + (lift || 6.2);
      for (const lat of [-half, half]) {
        const g = new THREE.CylinderGeometry(0.22, 0.28, top - q.y + 0.5, 12);
        g.translate(q.x + q.side[0] * lat, (q.y + top) / 2 - 0.25, q.z + q.side[2] * lat);
        addBatch(MAT.white, g);
        const ball = new THREE.SphereGeometry(0.42, 16, 10);
        ball.translate(q.x + q.side[0] * lat, top + 0.5, q.z + q.side[2] * lat);
        addBatch(candy(PALETTE.yellow), ball);
      }
      const banner = new THREE.Mesh(
        new THREE.PlaneGeometry(half * 2, half * 2 * 160 / 1024 * 1.6),
        new THREE.MeshBasicMaterial({ map: bannerTex(text, bg), side: THREE.DoubleSide, toneMapped: false })
      );
      banner.position.set(q.x, top, q.z);
      banner.rotation.y = q.yaw + Math.PI;     // readable to runners coming up the path
      scene.add(banner);
    }
    course.CHECKPOINTS.forEach((cp) => {
      // high enough to sit above the follow camera's view, not across it
      if (cp.index === 0) addBanner(20, "GO GO GO!", "#ff4fa0", 11);
      else addBanner(cp.s, cp.name, "#16b7d9", 9.5);
    });

    for (const [mat, geos] of batches) {
      const merged = mergeGeometries(geos, false);
      geos.forEach((g) => g.dispose());
      if (!merged) continue;
      scene.add(new THREE.Mesh(merged, mat));
    }
    batches.clear();

    // smooth collision ribbons for every walk section: top, sides and bottom
    for (const sec of course.SECTIONS) {
      if (sec.kind !== "walk") continue;
      const verts = [];
      const tri = (a, b, c, wantUp) => {
        // wind so the face normal points the way we want (Octree uses it)
        const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
        const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
        const n = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
        const dot = n[0] * wantUp[0] + n[1] * wantUp[1] + n[2] * wantUp[2];
        if (dot >= 0) verts.push(...a, ...b, ...c); else verts.push(...a, ...c, ...b);
      };
      const T = 1.0;
      const s0 = sec.from - 0.3, s1 = sec.to + 0.3;
      const n = Math.max(2, Math.ceil((s1 - s0) / 0.5));
      let prev = null;
      for (let i = 0; i <= n; i++) {
        const sv = s0 + (s1 - s0) * (i / n);
        const q = course.pathPoint(Math.max(0, Math.min(course.PATH_END, sv)));
        const y = course.floorAt(Math.max(0, sv));
        const hw = sec.width / 2;
        const L = [q.x + q.side[0] * hw, y, q.z + q.side[2] * hw];
        const Rr = [q.x - q.side[0] * hw, y, q.z - q.side[2] * hw];
        const Lb = [L[0], y - T, L[2]], Rb = [Rr[0], y - T, Rr[2]];
        const cur = { L, R: Rr, Lb, Rb, side: q.side };
        if (prev) {
          tri(prev.L, prev.R, cur.L, [0, 1, 0]); tri(prev.R, cur.R, cur.L, [0, 1, 0]);
          tri(prev.Lb, cur.Lb, prev.Rb, [0, -1, 0]); tri(prev.Rb, cur.Lb, cur.Rb, [0, -1, 0]);
          tri(prev.L, cur.L, prev.Lb, q.side); tri(prev.Lb, cur.L, cur.Lb, q.side);
          const out = [-q.side[0], 0, -q.side[2]];
          tri(prev.R, prev.Rb, cur.R, out); tri(prev.Rb, cur.Rb, cur.R, out);
        }
        prev = cur;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
      collideGroup.add(new THREE.Mesh(g));
    }

    collideGroup.updateMatrixWorld(true);
    const octree = new Octree().fromGraphNode(collideGroup);
    const cameraBlockers = collideGroup.children.slice();
    s.cleanups.push(() => {
      collideGroup.traverse((o) => o.geometry && o.geometry.dispose());
      texCache.forEach((t) => t.dispose());
      mats.forEach((m) => m.dispose());
    });

    // ---------------------------------------------------------------- hazards
    const hazardViews = [];
    for (const h of course.hazards) {
      if (h.kind === "bar") {
        const group = new THREE.Group();
        const bar = new THREE.Mesh(
          new THREE.CylinderGeometry(h.radius, h.radius, h.length, 20),
          new THREE.MeshStandardMaterial({ map: barTex, roughness: 0.55, emissive: 0xffffff, emissiveMap: barTex, emissiveIntensity: 0.1 })
        );
        barTex.wrapS = barTex.wrapT = THREE.RepeatWrapping;
        barTex.repeat.set(1, 6);
        bar.rotation.z = Math.PI / 2;           // along local x
        group.add(bar);
        for (const e of [-1, 1]) {
          const cap = new THREE.Mesh(new THREE.SphereGeometry(h.radius * 1.5, 16, 12), candy(PALETTE.yellow));
          cap.position.x = e * h.length / 2;
          group.add(cap);
        }
        const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.75, 0.5, 20), candy(PALETTE.purple));
        group.add(hub);
        group.position.set(h.center[0], h.center[1], h.center[2]);
        scene.add(group);
        hazardViews.push({ h, update(pose) { group.rotation.y = -pose.angle; } });
      } else if (h.kind === "pendulum") {
        const ball = new THREE.Mesh(
          new THREE.SphereGeometry(h.radius, 28, 20),
          new THREE.MeshStandardMaterial({ map: ballTex, roughness: 0.4, emissive: 0xffffff, emissiveMap: ballTex, emissiveIntensity: 0.1 })
        );
        const spikes = new THREE.Group();
        for (let i = 0; i < 10; i++) {
          const cone = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.55, 10), candy(PALETTE.white));
          const dir = new THREE.Vector3().setFromSphericalCoords(1, Math.acos(1 - 2 * (i + 0.5) / 10), i * 2.4);
          cone.position.copy(dir).multiplyScalar(h.radius + 0.15);
          cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
          spikes.add(cone);
        }
        ball.add(spikes);
        const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 1, 8), MAT.iron);
        const pivot = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 8), MAT.gold);
        pivot.position.set(h.pivot[0], h.pivot[1], h.pivot[2]);
        scene.add(ball, chain, pivot);
        const up = new THREE.Vector3(0, 1, 0);
        const dir = new THREE.Vector3();
        hazardViews.push({
          h,
          update(pose) {
            const c = pose.colliders[0].c;
            ball.position.set(c[0], c[1], c[2]);
            ball.rotation.y += 0.02;
            dir.set(h.pivot[0] - c[0], h.pivot[1] - c[1], h.pivot[2] - c[2]);
            const len = dir.length();
            chain.position.set((h.pivot[0] + c[0]) / 2, (h.pivot[1] + c[1]) / 2, (h.pivot[2] + c[2]) / 2);
            chain.scale.set(1, len, 1);
            chain.quaternion.setFromUnitVectors(up, dir.normalize());
          },
        });
      } else if (h.kind === "boulders") {
        const rockMat = new THREE.MeshStandardMaterial({
          color: 0x3a2320, roughness: 0.95, flatShading: true,
          emissive: 0xffffff, emissiveMap: rockTex, emissiveIntensity: 1.6,
        });
        const pool = [];
        const geo = new THREE.IcosahedronGeometry(h.radius, 1);
        const pos = geo.attributes.position;
        for (let i = 0; i < pos.count; i++) {
          _v.fromBufferAttribute(pos, i);
          _v.multiplyScalar(0.88 + ((Math.sin(i * 12.9898) * 43758.5453) % 1 + 1) % 1 * 0.22);
          pos.setXYZ(i, _v.x, _v.y, _v.z);
        }
        geo.computeVertexNormals();
        const axis = new THREE.Vector3();
        hazardViews.push({
          h,
          update(pose) {
            while (pool.length < pose.balls.length) {
              const m = new THREE.Mesh(geo, rockMat);
              scene.add(m);
              pool.push(m);
            }
            pool.forEach((m, i) => {
              const b = pose.balls[i];
              m.visible = !!b;
              if (!b) return;
              m.position.set(b.c[0], b.c[1], b.c[2]);
              const q = course.pathPoint(b.s);
              axis.set(q.side[0], 0, q.side[2]).normalize();
              m.quaternion.setFromAxisAngle(axis, b.roll);
            });
          },
        });
      }
    }

    // ---------------------------------------------------------------- crown
    const crown = makeCrown();
    crown.group.position.set(course.CROWN.pos[0], course.CROWN.pos[1], course.CROWN.pos[2]);
    scene.add(crown.group);
    s.cleanups.push(() => { try { crown.dispose(); } catch (e) { /* ignore */ } });

    // ------------------------------------------------------------- hostages
    // Bookis and Norli soldiers caged on the summit. Their cages are solid
    // until someone takes the crown and breaks them open.
    const hostages = makeHostages();
    let hostageSolids = [];
    if (hostages) {
      scene.add(hostages.group);
      hostageSolids = (hostages.solids || []).filter((c) => Array.isArray(c.pos) && c.radius > 0 && c.height > 0);
      s.cleanups.push(() => { try { hostages.dispose(); } catch (e) { /* ignore */ } });
    }

    // ---------------------------------------------------------------- player
    const R = course.PLAYER.radius;
    const H = course.PLAYER.height;
    const collider = new Capsule(new THREE.Vector3(0, R, 0), new THREE.Vector3(0, H - R, 0), R);
    const velocity = new THREE.Vector3();
    let onFloor = false;
    let lastGroundAt = 0;
    let jumpQueuedAt = -1e9;
    let faceYaw = 0;
    let camYaw = 0;
    let camPitch = 0.32;
    let camDist = CAM_DIST;
    let shake = 0;
    let stun = 0;
    let burn = 0;
    let diving = false;
    let diveAt = 0;
    let diveLandedAt = 0;
    let diveBumped = false;
    let recoverUntil = 0;
    let lastDiveAt = -1e9;
    let grabHeld = false;
    let lastGrabTry = 0;
    let grabPending = false;
    let lastCrownTry = 0;
    let lastGazeHit = -1e9;
    const hazardCooldown = new Map();
    let gone = false;
    let goneUntil = 0;
    let spawned = false;
    let myUid = null;
    let myIndex = 0;
    let myCp = 0;
    let myPlace = 1;
    let gb = null;            // uid grabbing me
    let gr = null;            // uid I'm grabbing
    let grabLeft = 0;         // ms left on my hold (as grabber)
    let struggles = 0;        // my presses towards breaking free (as victim)
    let myTeam = "bookis";
    try { const saved = localStorage.getItem("eyeTeam"); if (TEAMS.includes(saved)) myTeam = saved; } catch (e) { /* private mode */ }
    if (TEAMS.includes(DEBUG.team)) myTeam = DEBUG.team;
    let phase = "countdown";
    let timeLeft = Math.round(course.ROUND_MS / 1000);
    let clockOffset = null;
    let playersById = new Map();   // uid -> latest server record
    let snapshot = [];
    let matchOver = false;
    let winner = null;
    let loadingPhase = false;      // server still waiting for everyone to load
    const keys = Object.create(null);
    let locked = false;
    const lastPos = new THREE.Vector3();
    let stuckFor = 0;
    // Playing needs no mouse and nothing gates it: the keyboard works from the
    // first frame. `started` is false only while the Esc help menu is open.
    let started = true;
    let lastLookAt = -1e9;          // last mouse / stick camera input; the camera follows you once idle
    const pad = { moveF: 0, moveR: 0, lookX: 0, lookY: 0, prev: [] };

    const stats = window.EYE_STATS = { s: 0, maxS: 0, falls: 0, hazardHits: 0, gazeHits: 0, onFloor: false, rt: 0, cp: 0, crowned: false };

    const nowMs = () => performance.now();
    function raceTime() {
      if (clockOffset === null) return -course.COUNTDOWN_MS;
      return nowMs() - clockOffset;
    }

    function feet() { return [collider.start.x, collider.start.y - R, collider.start.z]; }

    function teleport(pos, yaw) {
      collider.start.set(pos[0], pos[1] + R, pos[2]);
      collider.end.set(pos[0], pos[1] + H - R, pos[2]);
      velocity.set(0, 0, 0);
      if (yaw !== undefined) { faceYaw = yaw; camYaw = yaw; }
      diving = false;
      stun = 0;
      lastPos.copy(collider.start);
    }

    function spawnPoint() {
      const cp = course.CHECKPOINTS[Math.max(0, Math.min(course.CHECKPOINTS.length - 1, myCp))];
      return { pos: cp.spawns[myIndex % cp.spawns.length], yaw: cp.yaw };
    }

    function respawn() {
      const sp = spawnPoint();
      teleport(sp.pos, sp.yaw);
      if (DEBUG.spawnAt !== undefined && !spawned) {
        const q = course.pathPoint(DEBUG.spawnAt);
        teleport(course.pathOffset(DEBUG.spawnAt, DEBUG.lateral || 0, 0.4), q.yaw);
      }
      spawned = true;
      gone = false;
      if (myBean) myBean.group.visible = true;
    }

    // Park somewhere sensible until the server says who we are.
    teleport(course.CHECKPOINTS[0].spawns[0], course.CHECKPOINTS[0].yaw);

    // ---------------------------------------------------------------- beans
    let myBean = null;
    const beans = new Map();      // uid -> { bean, label, pos, yaw, fresh, rec }

    function makeLabel(name, color) {
      const cv = document.createElement("canvas");
      cv.width = 320; cv.height = 72;
      const ctx = cv.getContext("2d");
      ctx.font = "900 40px Nunito, sans-serif";
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.lineWidth = 9; ctx.strokeStyle = "rgba(30,8,40,0.95)";
      ctx.strokeText(name, 160, 38);
      ctx.fillStyle = color;
      ctx.fillText(name, 160, 38);
      const tex = new THREE.CanvasTexture(cv);
      tex.colorSpace = THREE.SRGBColorSpace;
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, toneMapped: false }));
      sprite.scale.set(2.6, 0.58, 1);
      sprite.renderOrder = 10;
      return sprite;
    }

    let myBeanTeam = null;
    let myRec = null;
    function ensureMyBean(rec) {
      if (rec) myRec = rec;
      if (!myRec || (myBean && myBeanTeam === myTeam)) return;
      if (myBean) {
        scene.remove(myBean.group);
        try { myBean.dispose(); } catch (e) { /* ignore */ }
      }
      myBean = makeBean({ color: myRec.color || "#ff4fa0", name: myRec.name || "You", team: myTeam });
      myBeanTeam = myTeam;
      scene.add(myBean.group);
      myBean.group.visible = !gone;
    }

    function syncBeans() {
      const seen = new Set();
      for (const p of snapshot) {
        if (p.uid === myUid) continue;
        seen.add(p.uid);
        let b = beans.get(p.uid);
        const team = TEAMS.includes(p.tm) ? p.tm : "bookis";
        if (b && b.team !== team) {
          // switched sides: swap the model, keep the label and position
          scene.remove(b.bean.group);
          try { b.bean.dispose(); } catch (e) { /* ignore */ }
          b.bean = makeBean({ color: p.color, name: p.name, team });
          b.team = team;
          scene.add(b.bean.group);
        }
        if (!b) {
          const bean = makeBean({ color: p.color, name: p.name, team });
          scene.add(bean.group);
          const label = makeLabel(p.name, p.color);
          scene.add(label);
          b = { bean, label, team, pos: new THREE.Vector3(), target: new THREE.Vector3(), yaw: 0, fresh: true, rec: p, prevY: 0 };
          beans.set(p.uid, b);
        }
        b.rec = p;
        if (Array.isArray(p.p)) {
          const v = p.v || [0, 0, 0];
          b.target.set(p.p[0] + v[0] * 0.06, p.p[1] + v[1] * 0.06, p.p[2] + v[2] * 0.06);
        }
      }
      for (const [uid, b] of beans) {
        if (seen.has(uid)) continue;
        scene.remove(b.bean.group, b.label);
        try { b.bean.dispose(); } catch (e) { /* ignore */ }
        b.label.material.map.dispose();
        b.label.material.dispose();
        beans.delete(uid);
      }
    }

    function updateBeans(dt, t) {
      const k = 1 - Math.exp(-14 * dt);
      for (const [, b] of beans) {
        const p = b.rec;
        if (b.fresh) { b.pos.copy(b.target); b.yaw = p.yaw || 0; b.fresh = false; }
        b.pos.lerp(b.target, k);
        let dy = (p.yaw || 0) - b.yaw;
        while (dy > Math.PI) dy -= Math.PI * 2;
        while (dy < -Math.PI) dy += Math.PI * 2;
        b.yaw += dy * k;
        const visible = p.a !== 4;
        b.bean.group.visible = visible;
        b.label.visible = visible;
        b.bean.group.position.copy(b.pos);
        b.bean.group.rotation.y = b.yaw;
        b.label.position.set(b.pos.x, b.pos.y + H + 0.55, b.pos.z);
        const v = p.v || [0, 0, 0];
        b.bean.update(dt, {
          speed: Math.hypot(v[0], v[2]),
          air: p.a === 1 || p.a === 2,
          vy: v[1],
          dive: p.a === 2,
          grab: !!(p.g || p.gr),
          grabbed: !!p.gb,
          stun: p.a === 3 ? 0.8 : 0,
          burn: 0,
          t,
        });
      }
    }

    // ------------------------------------------------------------ grab ropes
    // Every hold is drawn for everyone: a thick glowing rope that sags from
    // the grabber's hands to the victim, and a "GRAB!" pop when it starts.
    const ROPE_SEGS = 6;
    const ropeGeo = new THREE.CylinderGeometry(1, 1, 1, 8, 1, true);
    const ropeMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff4fa0).multiplyScalar(1.6), toneMapped: false });
    const knotGeo = new THREE.SphereGeometry(1, 12, 8);
    const ropes = [];                         // pool of { group, segs, knots }
    const popTex = canvasTex(256, 128, (ctx, w, h) => {
      ctx.clearRect(0, 0, w, h);
      ctx.font = "900 78px 'Titan One', Nunito, sans-serif";
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.lineWidth = 14; ctx.strokeStyle = "#2b0f3a"; ctx.strokeText("GRAB!", w / 2, h / 2 + 4);
      ctx.fillStyle = "#ffd23f"; ctx.fillText("GRAB!", w / 2, h / 2 + 4);
    });
    const pops = [];                          // { sprite, born }
    let holdKeys = new Set();
    const ropeA = new THREE.Vector3(), ropeB = new THREE.Vector3(), ropeM = new THREE.Vector3();
    const segP = new THREE.Vector3(), segQ = new THREE.Vector3(), segD = new THREE.Vector3();
    const UP = new THREE.Vector3(0, 1, 0);

    function ropeFor(i) {
      while (ropes.length <= i) {
        const group = new THREE.Group();
        const segs = [], knots = [];
        for (let k = 0; k < ROPE_SEGS; k++) {
          const m = new THREE.Mesh(ropeGeo, ropeMat);
          group.add(m); segs.push(m);
        }
        for (let k = 0; k < 2; k++) {
          const m = new THREE.Mesh(knotGeo, ropeMat);
          m.scale.setScalar(0.2);
          group.add(m); knots.push(m);
        }
        scene.add(group);
        ropes.push({ group, segs, knots });
      }
      return ropes[i];
    }

    // where a bean is and which way it faces; me from physics, others smoothed
    function beanFrame(uid) {
      if (uid === myUid) { const f = feet(); return { x: f[0], y: f[1], z: f[2], yaw: faceYaw }; }
      const b = beans.get(uid);
      if (!b || !b.bean.group.visible) return null;
      return { x: b.pos.x, y: b.pos.y, z: b.pos.z, yaw: b.yaw };
    }

    function updateRopes(t) {
      const pairs = [];
      for (const p of snapshot) if (p.gr) pairs.push([p.uid, p.gr]);
      let used = 0;
      const keysNow = new Set();
      for (const [gu, vu] of pairs) {
        const g = beanFrame(gu), v = beanFrame(vu);
        if (!g || !v) continue;
        const key = gu + ">" + vu;
        keysNow.add(key);
        // hands: in front of the grabber at chest height; victim: its chest
        ropeA.set(g.x + Math.sin(g.yaw) * 0.55, g.y + 1.0, g.z + Math.cos(g.yaw) * 0.55);
        ropeB.set(v.x, v.y + 0.95, v.z);
        const span = ropeA.distanceTo(ropeB);
        ropeM.addVectors(ropeA, ropeB).multiplyScalar(0.5);
        ropeM.y -= 0.12 + span * 0.12 + Math.sin(t * 22) * 0.04;     // sag, and a taut tremble
        const rope = ropeFor(used++);
        rope.group.visible = true;
        const thick = 0.075 + 0.02 * Math.sin(t * 16);
        for (let k = 0; k < ROPE_SEGS; k++) {
          quadAt(k / ROPE_SEGS, segP);
          quadAt((k + 1) / ROPE_SEGS, segQ);
          const m = rope.segs[k];
          segD.subVectors(segQ, segP);
          const len = segD.length() || 1e-3;
          m.position.addVectors(segP, segQ).multiplyScalar(0.5);
          m.quaternion.setFromUnitVectors(UP, segD.divideScalar(len));
          m.scale.set(thick, len + 0.02, thick);
        }
        rope.knots[0].position.copy(ropeA);
        rope.knots[1].position.copy(ropeB);
        if (!holdKeys.has(key)) spawnPop(ropeB);
      }
      for (let i = used; i < ropes.length; i++) ropes[i].group.visible = false;
      holdKeys = keysNow;

      const now = nowMs();
      for (let i = pops.length - 1; i >= 0; i--) {
        const pop = pops[i];
        const u = (now - pop.born) / 800;
        if (u >= 1) { scene.remove(pop.sprite); pop.sprite.material.dispose(); pops.splice(i, 1); continue; }
        const grow = u < 0.25 ? 0.4 + u / 0.25 * 1.0 : 1.4 - (u - 0.25) * 0.3;
        pop.sprite.scale.set(2.4 * grow, 1.2 * grow, 1);
        pop.sprite.position.y = pop.baseY + u * 0.9;
        pop.sprite.material.opacity = u < 0.7 ? 1 : 1 - (u - 0.7) / 0.3;
      }
    }

    // quadratic Bezier from the hands to the victim that passes through the sag point
    function quadAt(u, out) {
      const a = (1 - u) * (1 - u), b = 2 * u * (1 - u), c = u * u;
      const cx = 2 * ropeM.x - (ropeA.x + ropeB.x) / 2;
      const cy = 2 * ropeM.y - (ropeA.y + ropeB.y) / 2;
      const cz = 2 * ropeM.z - (ropeA.z + ropeB.z) / 2;
      return out.set(ropeA.x * a + cx * b + ropeB.x * c, ropeA.y * a + cy * b + ropeB.y * c, ropeA.z * a + cz * b + ropeB.z * c);
    }

    function spawnPop(at) {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: popTex, transparent: true, depthTest: false, toneMapped: false }));
      sprite.renderOrder = 12;
      sprite.position.set(at.x, at.y + 1.3, at.z);
      scene.add(sprite);
      pops.push({ sprite, born: nowMs(), baseY: at.y + 1.3 });
    }

    // ---------------------------------------------------------------- physics
    const tmpA = new THREE.Vector3();
    const tmpB = new THREE.Vector3();
    const tmpC = new THREE.Vector3();

    function wishDir() {
      let f = 0, r = 0;
      // WASD (arrows turn the camera, they don't run) plus the left stick
      if (keys.KeyW) f += 1;
      if (keys.KeyS) f -= 1;
      if (keys.KeyD) r += 1;
      if (keys.KeyA) r -= 1;
      if (DEBUG.auto) return autoWish();
      if (DEBUG.holdW) f = 1;
      f += pad.moveF; r += pad.moveR;
      if (Math.hypot(f, r) < 0.05) return null;
      const fx = Math.sin(camYaw), fz = Math.cos(camYaw);
      const rx = -fz, rz = fx;
      let x = fx * f + rx * r, z = fz * f + rz * r;
      const len = Math.hypot(x, z);
      return [x / len, z / len];
    }

    // Test pilot: steer along the course and hop whatever needs hopping.
    function autoWish() {
      const f = feet();
      const prog = course.progressAt(f[0], f[1], f[2]);
      const sec = course.sectionAt(prog.s);
      let target;
      if (sec.name === "stones") {
        const stones = course.pieces.filter((p) => p.style === "stone")
          .map((p) => ({ p, s: course.progressAt(p.pos[0], p.pos[1] + p.height / 2, p.pos[2]).s }))
          .filter((o) => o.s > prog.s + 1.2);
        target = stones.length ? [stones[0].p.pos[0], 0, stones[0].p.pos[2]] : course.pathOffset(prog.s + 5, 0, 0);
      } else target = course.pathOffset(Math.min(course.PATH_END, prog.s + 4), 0, 0);
      let x = target[0] - f[0], z = target[2] - f[2];
      const len = Math.hypot(x, z) || 1;
      if (onFloor && (sec.name === "stones" || (sec.name === "ledge" && prog.s > 148) || prog.s > course.PATH_END - 3.5)) jumpQueuedAt = nowMs();
      if (prog.s > course.PATH_END - 1.5) return null;
      return [x / len, z / len];
    }

    function canControl() {
      return spawned && !gone && !matchOver && raceTime() >= 0 && phase !== "over" && !DEBUG.cam;
    }

    function resolveStatic() {
      for (let i = 0; i < 3; i++) {
        const r = octree.capsuleIntersect(collider);
        // a zero-depth touch comes back with an arbitrary normal; acting on it
        // used to cancel your velocity mid-ramp
        if (!r || r.depth < 1e-4) return;
        if (r.normal.y > FLOOR_NY) {
          collider.translate(tmpA.set(0, Math.min(r.depth / r.normal.y, r.depth * 2.2), 0));
          if (velocity.y < 0) velocity.y = 0;
          onFloor = true;
        } else {
          collider.translate(r.normal.clone().multiplyScalar(r.depth));
          const d = velocity.dot(r.normal);
          if (d < 0) velocity.addScaledVector(r.normal, -d);
        }
      }
    }

    function snapDown() {
      collider.translate(tmpA.set(0, -SNAP, 0));
      const r = octree.capsuleIntersect(collider);
      if (r && r.depth >= 1e-4 && r.normal.y > FLOOR_NY) {
        collider.translate(tmpA.set(0, Math.min(r.depth / r.normal.y, SNAP + 0.1), 0));
        onFloor = true;
        if (velocity.y < 0) velocity.y = 0;
      } else {
        collider.translate(tmpA.set(0, SNAP, 0));
      }
    }

    // closest point on segment ab to p -> out
    function closestOnSeg(a, b, p, out) {
      tmpC.subVectors(b, a);
      const len2 = tmpC.lengthSq();
      const t = len2 > 1e-9 ? Math.max(0, Math.min(1, tmpC.dot(tmpB.subVectors(p, a)) / len2)) : 0;
      return out.copy(a).addScaledVector(tmpC, t);
    }
    // closest points between segments p1q1 and p2q2 (Ericson). Returns [s, t].
    function segSeg(p1, q1, p2, q2, c1, c2) {
      const d1 = new THREE.Vector3().subVectors(q1, p1);
      const d2 = new THREE.Vector3().subVectors(q2, p2);
      const r = new THREE.Vector3().subVectors(p1, p2);
      const a = d1.lengthSq(), e = d2.lengthSq(), f = d2.dot(r);
      let s, t;
      if (a <= 1e-9 && e <= 1e-9) { s = t = 0; }
      else if (a <= 1e-9) { s = 0; t = Math.max(0, Math.min(1, f / e)); }
      else {
        const c = d1.dot(r);
        if (e <= 1e-9) { t = 0; s = Math.max(0, Math.min(1, -c / a)); }
        else {
          const b = d1.dot(d2), denom = a * e - b * b;
          s = denom !== 0 ? Math.max(0, Math.min(1, (b * f - c * e) / denom)) : 0;
          t = (b * s + f) / e;
          if (t < 0) { t = 0; s = Math.max(0, Math.min(1, -c / a)); }
          else if (t > 1) { t = 1; s = Math.max(0, Math.min(1, (b - c) / a)); }
        }
      }
      c1.copy(p1).addScaledVector(d1, s);
      c2.copy(p2).addScaledVector(d2, t);
      return t;
    }

    let hazardFrame = [];   // [{h, cols:[{...col, vel:[..]}]}]
    function buildHazardFrame(rt) {
      hazardFrame = [];
      for (const view of hazardViews) {
        const h = view.h;
        const pose = course.hazardPose(h, rt);
        view.update(pose);
        const prev = course.hazardPose(h, rt - 20);
        const cols = pose.colliders.map((c, i) => {
          let pc = prev.colliders[i];
          if (h.kind === "boulders") {
            const id = pose.balls[i].id;
            const j = prev.balls.findIndex((b) => b.id === id);
            pc = j >= 0 ? prev.colliders[j] : null;
          }
          return { c, prev: pc };
        });
        hazardFrame.push({ h, cols });
      }
    }

    const hp = new THREE.Vector3(), hq = new THREE.Vector3(), ha = new THREE.Vector3(), hb = new THREE.Vector3();
    const hpa = new THREE.Vector3(), hpb = new THREE.Vector3();
    function collideHazards() {
      if (gone) return;
      const now = nowMs();
      for (const { h, cols } of hazardFrame) {
        for (const { c, prev } of cols) {
          let dist, rr, t = 0;
          if (c.type === "sphere") {
            hq.set(c.c[0], c.c[1], c.c[2]);
            closestOnSeg(collider.start, collider.end, hq, hp);
            rr = c.r + R;
          } else {
            ha.set(c.a[0], c.a[1], c.a[2]);
            hb.set(c.b[0], c.b[1], c.b[2]);
            t = segSeg(collider.start, collider.end, ha, hb, hp, hq);
            rr = c.r + R;
          }
          dist = hp.distanceTo(hq);
          if (dist >= rr) continue;
          // push out
          const n = tmpA.subVectors(hp, hq);
          if (dist < 1e-4) n.set(0, 1, 0); else n.divideScalar(dist);
          collider.translate(tmpB.copy(n).multiplyScalar(rr - dist + 0.01));
          // how fast was the thing that hit us moving?
          let vx = 0, vy = 0, vz = 0;
          if (prev) {
            if (c.type === "sphere") {
              vx = (c.c[0] - prev.c[0]) / 0.02; vy = (c.c[1] - prev.c[1]) / 0.02; vz = (c.c[2] - prev.c[2]) / 0.02;
            } else {
              hpa.set(prev.a[0], prev.a[1], prev.a[2]);
              hpb.set(prev.b[0], prev.b[1], prev.b[2]);
              const px = hpa.x + (hpb.x - hpa.x) * t, py = hpa.y + (hpb.y - hpa.y) * t, pz = hpa.z + (hpb.z - hpa.z) * t;
              vx = (hq.x - px) / 0.02; vy = (hq.y - py) / 0.02; vz = (hq.z - pz) / 0.02;
            }
          }
          if ((hazardCooldown.get(h.id) || 0) > now) {
            const d = velocity.dot(n);
            if (d < 0) velocity.addScaledVector(n, -d);
            continue;
          }
          hazardCooldown.set(h.id, now + 350);
          let dx = n.x, dz = n.z;
          const hs = Math.hypot(vx, vz);
          if (hs > 0.5) { dx += vx / hs * 0.9; dz += vz / hs * 0.9; }
          let dl = Math.hypot(dx, dz);
          if (dl < 1e-3) { dx = -Math.sin(faceYaw); dz = -Math.cos(faceYaw); dl = 1; }
          velocity.x = dx / dl * h.knock + vx * 0.25;
          velocity.z = dz / dl * h.knock + vz * 0.25;
          velocity.y = Math.max(velocity.y, 4 + h.knock * 0.22 + Math.max(0, vy) * 0.3);
          onFloor = false;
          diving = false;
          stun = STUN_S;
          shake = Math.max(shake, 0.35);
          stats.hazardHits++;
          hud.toast(h.kind === "boulders" ? "BONK! BOULDER" : h.kind === "pendulum" ? "WHACKED!" : "SWEPT!", "#ffd23f");
        }
      }
    }

    function collideBeans() {
      if (gone) return;
      const f = feet();
      for (const [uid, b] of beans) {
        if (!b.bean.group.visible) continue;
        const dy = f[1] - b.pos.y;
        if (Math.abs(dy) > H - 0.15) continue;
        let dx = f[0] - b.pos.x, dz = f[2] - b.pos.z;
        let d = Math.hypot(dx, dz);
        if (diving && !diveBumped && d < BEAN_GAP + 0.45) {
          diveBumped = true;
          const vl = Math.hypot(velocity.x, velocity.z) || 1;
          s.socket.emit("eye-input", { t: "bump", victim: uid, dir: [velocity.x / vl, velocity.z / vl] });
        }
        if (d >= BEAN_GAP) continue;
        if (d < 1e-3) { dx = Math.random() - 0.5; dz = Math.random() - 0.5; d = Math.hypot(dx, dz); }
        const push = (BEAN_GAP - d) * 0.8;
        collider.translate(tmpA.set(dx / d * push, 0, dz / d * push));
        const vn = (velocity.x * dx + velocity.z * dz) / d;
        if (vn < 0) { velocity.x -= dx / d * vn * 0.6; velocity.z -= dz / d * vn * 0.6; }
      }
    }

    // Hostage cages: upright cylinders. Walls push you sideways, the roof is a floor.
    function collideCages() {
      if (!hostageSolids.length) return;
      const f = feet();
      for (const c of hostageSolids) {
        const bottom = c.pos[1] - c.height / 2, top = c.pos[1] + c.height / 2;
        if (f[1] > top + 0.05 || f[1] + H < bottom) continue;
        const dx = f[0] - c.pos[0], dz = f[2] - c.pos[2];
        const d = Math.hypot(dx, dz);
        const reach = c.radius + R;
        if (d >= reach) continue;
        if (f[1] > top - 0.35 && velocity.y <= 0.5) {       // landed on the roof
          collider.translate(tmpA.set(0, top - f[1], 0));
          if (velocity.y < 0) velocity.y = 0;
          onFloor = true;
          continue;
        }
        const nx = d > 1e-3 ? dx / d : 1, nz = d > 1e-3 ? dz / d : 0;
        collider.translate(tmpA.set(nx * (reach - d), 0, nz * (reach - d)));
        const vn = velocity.x * nx + velocity.z * nz;
        if (vn < 0) { velocity.x -= nx * vn; velocity.z -= nz * vn; }
      }
    }

    function stepPlayer(dt) {
      const now = nowMs();
      const control = canControl();
      const wish = control ? wishDir() : null;
      const grabbedBy = gb ? beans.get(gb) : null;
      let maxSpeed = RUN_SPEED * (gb ? HELD_SPEED : 1) * (gr ? HOLDING_SPEED : 1);
      const recovering = now < recoverUntil;

      // horizontal
      if (diving) {
        if (onFloor) {
          const k = Math.exp(-2.6 * dt);
          velocity.x *= k; velocity.z *= k;
          if (!diveLandedAt) diveLandedAt = now;
          if (now - diveLandedAt > DIVE_SLIDE_MS) { diving = false; recoverUntil = now + DIVE_RECOVER_MS; }
        }
        if (now - diveAt > 2500) diving = false;
      } else if (!control || recovering) {
        if (onFloor) {
          const k = Math.exp(-(stun > 0 ? STUN_GROUND_RATE : 8) * dt);
          velocity.x *= k; velocity.z *= k;
        }
      } else {
        const rate = stun > 0 ? (onFloor ? STUN_GROUND_RATE : STUN_AIR_RATE) : (onFloor ? GROUND_RATE : AIR_RATE);
        const k = 1 - Math.exp(-rate * dt);
        if (wish) {
          velocity.x += (wish[0] * maxSpeed - velocity.x) * k;
          velocity.z += (wish[1] * maxSpeed - velocity.z) * k;
          const want = Math.atan2(wish[0], wish[1]);
          let d = want - faceYaw;
          while (d > Math.PI) d -= Math.PI * 2;
          while (d < -Math.PI) d += Math.PI * 2;
          faceYaw += d * (1 - Math.exp(-14 * dt));
        } else if (onFloor) {
          velocity.x += -velocity.x * k;
          velocity.z += -velocity.z * k;
        } else {
          const kk = Math.exp(-0.4 * dt);
          velocity.x *= kk; velocity.z *= kk;
        }
      }

      // Pinned in front of whoever grabbed us: a hard leash to a spot just
      // ahead of their hands, so they can drag us about.
      if (grabbedBy) {
        const f = feet();
        const tx = grabbedBy.pos.x + Math.sin(grabbedBy.yaw) * HOLD_GAP;
        const tz = grabbedBy.pos.z + Math.cos(grabbedBy.yaw) * HOLD_GAP;
        const dx = tx - f[0], dz = tz - f[2];
        const d = Math.hypot(dx, dz);
        if (d > 0.15) {
          const k = Math.min(1, dt * 14);
          collider.translate(tmpA.set(dx * k, 0, dz * k));
          // lose whatever velocity pulls against the leash
          const vn = (velocity.x * dx + velocity.z * dz) / d;
          if (vn < 0) { velocity.x -= dx / d * vn; velocity.z -= dz / d * vn; }
        }
      }

      // jump (buffered, with a little coyote time)
      const canJump = control && !gb && !diving && !recovering && stun <= 0;
      if (canJump && now - jumpQueuedAt < JUMP_BUFFER_MS && (onFloor || now - lastGroundAt < COYOTE_MS)) {
        velocity.y = JUMP_SPEED;
        onFloor = false;
        lastGroundAt = -1e9;
        jumpQueuedAt = -1e9;
      }

      velocity.y -= GRAVITY * dt;
      if (velocity.y < -40) velocity.y = -40;

      const wasOnFloor = onFloor;
      collider.translate(tmpA.copy(velocity).multiplyScalar(dt));
      onFloor = false;
      resolveStatic();
      if (!onFloor && wasOnFloor && velocity.y <= 0.5) snapDown();
      if (!DEBUG.noHazards) collideHazards();
      collideBeans();
      collideCages();
      if (onFloor) lastGroundAt = now;
    }

    // ------------------------------------------------------------- the Eye
    const gazeRay = new THREE.Raycaster();
    const eyeVec = new THREE.Vector3(course.EYE_POS[0], course.EYE_POS[1], course.EYE_POS[2]);
    const chestVec = new THREE.Vector3();
    let gazeWarn = 0;

    function checkGaze(rt) {
      const g = course.gazeAt(rt);
      const f = feet();
      const chest = [f[0], f[1] + 0.9, f[2]];
      // approach warning: is the beam sweeping towards us?
      gazeWarn = 0;
      if ((g.active || g.warning) && Math.hypot(f[0], f[2]) > course.GAZE.minRadius && !gone && rt >= 0) {
        const diff = course.angleDiff(course.azimuth(f[0], f[2]), g.phi);
        const ahead = diff * Math.sign(course.GAZE.omega);
        if (ahead > -g.halfWidth && ahead < 1.05) gazeWarn = g.active ? 1 - Math.max(0, ahead) / 1.05 : 0.25;
      }
      if (DEBUG.gazeOff || gone || !spawned || rt < 0 || matchOver) return;
      if (!course.inGaze(chest[0], chest[1], chest[2], rt)) return;
      const now = nowMs();
      if (now - lastGazeHit < course.GAZE.cooldownMs) return;
      chestVec.set(chest[0], chest[1], chest[2]);
      const dir = tmpA.subVectors(chestVec, eyeVec);
      const dist = dir.length();
      gazeRay.set(eyeVec, dir.normalize());
      gazeRay.far = dist - 0.5;
      if (gazeRay.intersectObjects(shelterMeshes, false).length) return;   // hiding: safe
      lastGazeHit = now;
      const prog = course.progressAt(f[0], f[1], f[2]);
      const q = course.pathPoint(prog.s);
      const K = course.GAZE.knock;
      velocity.x = -q.forward[0] * K.back - q.side[0] * K.out;
      velocity.z = -q.forward[2] * K.back - q.side[2] * K.out;
      velocity.y = K.up;
      onFloor = false;
      diving = false;
      stun = STUN_S + 0.3;
      burn = 1;
      shake = 0.6;
      stats.gazeHits++;
      hud.gazeHit();
    }

    // ------------------------------------------------------------- camera
    const camTarget = new THREE.Vector3();
    const camWant = new THREE.Vector3();
    const camRay = new THREE.Raycaster();
    const lookAt = new THREE.Vector3();

    function followCamera(dt) {
      const f = feet();
      camTarget.set(f[0], f[1] + CAM_HEIGHT, f[2]);
      const cp = Math.cos(camPitch);
      camWant.set(-Math.sin(camYaw) * cp, Math.sin(camPitch), -Math.cos(camYaw) * cp);
      camRay.set(camTarget, camWant);
      camRay.far = CAM_DIST;
      const hits = camRay.intersectObjects(cameraBlockers, false);
      const limit = hits.length ? Math.max(1.2, hits[0].distance - 0.35) : CAM_DIST;
      if (limit < camDist) camDist = limit;
      else camDist += (limit - camDist) * (1 - Math.exp(-3 * dt));
      const pos = tmpB.copy(camTarget).addScaledVector(camWant, camDist);
      // never inside the tower
      const tr = course.towerRadiusAt(pos.y) + 3;
      const rad = Math.hypot(pos.x, pos.z);
      if (rad < tr && pos.y < course.SUMMIT.y - 1) { pos.x *= tr / rad; pos.z *= tr / rad; }
      lookAt.set(camTarget.x, camTarget.y + 0.2, camTarget.z);
      return pos;
    }

    // ---------------------------------------------------------------- intro
    // A 12 s cinematic, driven purely by the race clock so every player sees
    // the same shot at the same moment and a late loader cuts straight in:
    //   establish -> crane up the tower -> over the summit onto the hostages
    //   -> dive down the spiral -> hero shot of your bean -> GO.
    // Laid out on a 20 s timeline (stretched if COUNTDOWN_MS differs). Every
    // shot carries a title card for almost its whole length, so the intro
    // explains the game rather than just touring it. The 3-2-1-GO stays in the
    // last 3 s at full punch (see the HUD).
    const IT = introTime(course);
    const INTRO = {
      establish: [IT(-20000), IT(-16400)],
      crane: [IT(-16400), IT(-13200)],
      summit: [IT(-13200), IT(-8200)],     // hostages, then the crown
      demo: [IT(-8200), IT(-3000)],        // the Eye knocks a soldier off
      hero: [IT(-3000), 0],
    };
    const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
    const polar = (phi, r, y) => V3(Math.cos(phi) * r, y, Math.sin(phi) * r);
    const easeIO = (u) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);
    const smooth = (u) => u * u * (3 - 2 * u);
    const clamp01 = (u) => Math.max(0, Math.min(1, u));
    const spline = (pts) => new THREE.CatmullRomCurve3(pts, false, "centripetal");
    const B_PHI = course.SUMMIT.bridgePhi;
    const START_PHI = course.pathPoint(0).phi;
    const CRANE_PHI = B_PHI + Math.PI;                 // the face between the horns, away from the bridge
    const EYE = V3(course.EYE_POS[0], course.EYE_POS[1], course.EYE_POS[2]);

    // 1. sweep in low over the lava towards the tower
    const estPos = spline([
      polar(START_PHI + 0.55, 300, 34), polar(START_PHI + 0.4, 190, 20),
      polar(START_PHI + 0.22, 112, 13), polar(START_PHI + 0.08, 74, 19),
    ]);
    const estLook = spline([V3(0, 46, 0), V3(0, 42, 0), V3(0, 36, 0), V3(0, 44, 0)]);
    // 2. crane up the tower face, turning a little, ending on the Eye
    const cranePos = spline([0, 0.25, 0.5, 0.75, 1].map((u) => {
      const y = 4 + u * 50;
      return polar(CRANE_PHI - 0.55 + u * 0.7, course.towerRadiusAt(Math.min(y, course.SUMMIT.y)) + 7.5 + u * 8, y);
    }));
    // 3. rise over the Eye and drop onto the caged hostages, seen from the bridge
    const summitPos = spline([
      polar(CRANE_PHI + 0.15, 23.5, 54), polar(CRANE_PHI + 0.05, 15, 69), V3(0, 81, 0).add(polar(B_PHI, 4, 0)),
      polar(B_PHI, 10, 56), polar(B_PHI, 11.8, 44.4),
    ]);
    const cageLook = V3(0, course.CROWN.pos[1] - 0.9, 0);   // the crown, a cage either side
    const summitLook = spline([EYE.clone(), V3(0, 62, 0), V3(0, 50, 0).lerp(cageLook, 0.5), cageLook.clone(), cageLook.clone()]);
    // 4. the Eye demo, at checkpoint 1's cover. Two stand-in soldiers: one out
    //    in the open, one under the roof. The beam sweeps past, blasts the
    //    exposed one off into the lava and can't reach the one under cover.
    //    All of it is a function of rt, so everyone sees the same moment.
    const DEMO = (() => {
      const openFeet = course.pathOffset(83, -4, 0);      // negative lateral = away from the tower
      const safeFeet = course.pathOffset(77, 1.5, 0);
      const q = course.pathPoint(83);
      const speed = Math.abs(course.GAZE.omega);          // rad/s, same sweep speed as the race
      const lead = 0.5;                                    // the beam starts this far ahead of its victim
      const sweepAt = IT(-7300);
      const d = {
        openFeet, safeFeet, sweepAt,
        phiOpen: course.azimuth(openFeet[0], openFeet[2]),
        lead, speed,
        hitAt: sweepAt + lead / speed * 1000,
        // back down the path, up, and out over the edge: a big, readable launch
        launch: [-q.forward[0] * 7 - q.side[0] * 8, 11, -q.forward[2] * 7 - q.side[2] * 8],
        camPos: V3(...course.pathOffset(84.5, -22, 8.5)),   // beside the cover, so no post hides the hit
        camLook: V3(...course.pathOffset(80.5, 1, 1.6)),
      };
      return d;
    })();

    function demoGaze(rt) {
      if (rt < INTRO.demo[0] || rt >= INTRO.demo[1]) return null;
      const g = course.gazeAt(rt);
      const phi = DEMO.phiOpen + DEMO.lead - DEMO.speed * (rt - DEMO.sweepAt) / 1000;
      if (rt < DEMO.sweepAt) {                            // the Eye wakes: flicker, then burn
        return { phi, active: false, warning: true, intensity: 0.4 + 0.3 * Math.sin(rt / 45), halfWidth: g.halfWidth };
      }
      return { phi, active: true, intensity: 1, halfWidth: g.halfWidth };
    }

    const demoOpen = makeBean({ color: "#ff4fa0", name: "", team: "bookis" });
    const demoSafe = makeBean({ color: "#3fe0ff", name: "", team: "norli" });
    const demoOpenTag = makeLabel("EXPOSED!", "#ff6a3d");
    const demoSafeTag = makeLabel("SAFE \u2713", "#7dff9a");
    demoOpenTag.scale.multiplyScalar(1.8);
    demoSafeTag.scale.multiplyScalar(1.8);
    for (const o of [demoOpen.group, demoSafe.group, demoOpenTag, demoSafeTag]) { o.visible = false; scene.add(o); }
    s.cleanups.push(() => { try { demoOpen.dispose(); demoSafe.dispose(); } catch (e) { /* ignore */ } });
    const faceCam = (f) => Math.atan2(DEMO.camPos.x - f[0], DEMO.camPos.z - f[2]);

    function updateDemo(dt, rt, tSec) {
      const on = rt >= INTRO.demo[0] && rt < INTRO.demo[1];
      demoOpen.group.visible = demoSafe.group.visible = on;
      demoOpenTag.visible = demoSafeTag.visible = on && rt > DEMO.sweepAt - 1200;
      if (!on) return;
      const since = (rt - DEMO.hitAt) / 1000;
      const o = DEMO.openFeet, L = DEMO.launch;
      if (since < 0) {
        demoOpen.group.position.set(o[0], o[1], o[2]);
        demoOpen.group.rotation.set(0, faceCam(o), 0);
      } else {
        // a ballistic arc from the moment the beam touches it
        demoOpen.group.position.set(o[0] + L[0] * since, o[1] + L[1] * since - 0.5 * GRAVITY * since * since, o[2] + L[2] * since);
        demoOpen.group.rotation.set(since * 5, faceCam(o) + since * 7, since * 3);
        demoOpen.group.visible = demoOpen.group.position.y > course.LAVA_Y;
      }
      demoOpenTag.position.set(o[0], o[1] + H + 1.1, o[2]);
      demoOpenTag.visible = demoOpenTag.visible && since < 0.6;
      demoOpen.update(dt, {
        speed: 0, air: since >= 0, vy: since >= 0 ? L[1] - GRAVITY * since : 0, dive: false, grab: false,
        grabbed: false, stun: since >= 0 ? 1 : 0, burn: since >= 0 ? Math.max(0, 1 - since * 0.8) : 0, t: tSec,
      });
      const f = DEMO.safeFeet;
      demoSafe.group.position.set(f[0], f[1], f[2]);
      demoSafe.group.rotation.set(0, faceCam(f), 0);
      demoSafeTag.position.set(f[0], f[1] + H + 1.1, f[2]);
      demoSafe.update(dt, {
        speed: 0, air: false, vy: 0, dive: false, grab: since > 0.3, grabbed: false, stun: 0, burn: 0, t: tSec,
      });
    }

    const introPos = new THREE.Vector3(), introLook = new THREE.Vector3();
    const heroB = new THREE.Vector3(), heroLook = new THREE.Vector3();
    const followPos = new THREE.Vector3(), followLook = new THREE.Vector3();
    let introFov = 70, introRoll = 0, introShake = 0;

    // Fills introPos / introLook; returns false once the intro is over.
    function introCamera(rt, dt) {
      if (rt >= 0) return false;
      introRoll = 0;
      introFov = 62;
      const span = (k) => clamp01((rt - INTRO[k][0]) / (INTRO[k][1] - INTRO[k][0]));
      if (rt < INTRO.establish[1]) {
        const u = easeIO(span("establish"));
        estPos.getPoint(u, introPos);
        estLook.getPoint(u, introLook);
        introRoll = 0.06 * Math.sin(u * Math.PI);
        introFov = 55 + 10 * u;
      } else if (rt < INTRO.crane[1]) {
        const u = easeIO(span("crane"));
        cranePos.getPoint(u, introPos);
        // look at the wall just above the camera, then lift to the Eye
        const phi = Math.atan2(introPos.z, introPos.x);
        const wall = polar(phi + 0.12, 0, introPos.y + 8);
        introLook.copy(wall).lerp(EYE, smooth(clamp01((u - 0.45) / 0.55)));
        introFov = 68 - 10 * u;
        introRoll = -0.04 * Math.sin(u * Math.PI);
      } else if (rt < INTRO.summit[1]) {
        const u = easeIO(span("summit"));
        summitPos.getPoint(u, introPos);
        summitLook.getPoint(u, introLook);
        introFov = 58 + 6 * Math.sin(u * Math.PI);
      } else if (rt < INTRO.demo[1]) {
        // a calm, slow push-in on the two soldiers with the tower behind them
        const u = smooth(span("demo"));
        introPos.copy(DEMO.camPos).lerp(DEMO.camLook, 0.18 * u);
        introPos.y += 1.5 * (1 - u);
        introLook.copy(DEMO.camLook);
        introFov = 60 - 6 * u;
      } else {
        // 5. hero: land in front of your bean, then swing round behind it and
        //    hand over to the follow camera exactly on GO
        const raw = span("hero");
        const f = feet();
        const yaw = faceYaw;
        const fx = Math.sin(yaw), fz = Math.cos(yaw);
        heroLook.set(f[0], f[1] + 1.05, f[2]);
        // orbit from in front (theta 0) to behind (theta PI) around the bean
        const theta = Math.PI * smooth(clamp01((raw - 0.42) / 0.5));
        const r = 3.6 + (CAM_DIST * Math.cos(camPitch) - 3.6) * smooth(clamp01((raw - 0.42) / 0.5));
        const h = 1.7 + (CAM_HEIGHT + Math.sin(camPitch) * CAM_DIST - 1.7) * smooth(clamp01((raw - 0.42) / 0.5));
        const ox = fx * Math.cos(theta) + fz * Math.sin(theta);
        const oz = fz * Math.cos(theta) - fx * Math.sin(theta);
        heroB.set(f[0] + ox * r, f[1] + h, f[2] + oz * r);
        // cut straight in front of your bean, then orbit round behind it
        const land = 1;
        introPos.copy(heroB);
        introLook.copy(heroLook);
        introFov = 78 - 22 * land + 16 * smooth(clamp01((raw - 0.42) / 0.5));
        // melt into the follow camera over the last beat
        const hand = smooth(clamp01((raw - 0.82) / 0.18));
        if (hand > 0) {
          followPos.copy(followCamera(dt));
          followLook.copy(lookAt);
          introPos.lerp(followPos, hand);
          introLook.lerp(followLook, hand);
          introFov += (70 - introFov) * hand;
        }
      }
      return true;
    }

    // one-shot moments on the intro timeline (lightning, cuts, the Eye flaring)
    const INTRO_EVENTS = [
      { t: IT(-19000), fn: () => { art.flash?.("lightning"); introShake = 0.7; hud.cut("#fff1d6"); } },
      { t: IT(-16400), fn: () => { art.flash?.("lightning"); hud.cut("#ffffff"); } },
      { t: IT(-13700), fn: () => { art.flash?.("eye"); introShake = 0.35; } },
      { t: IT(-8200), fn: () => { hud.cut("#ffd7a8"); } },
      { t: DEMO.hitAt, fn: () => { art.flash?.("eye"); introShake = 0.5; hud.cut("#ff6a3d"); } },
      { t: IT(-3000), fn: () => { hud.cut("#ffffff"); } },
      { t: 0, fn: () => { shake = Math.max(shake, 0.35); } },
    ];
    let lastEventRt = null;
    function introEvents(rt) {
      if (lastEventRt !== null) {
        for (const ev of INTRO_EVENTS) {
          // fire on crossing, but never replay a stale moment to a late loader
          if (lastEventRt < ev.t && rt >= ev.t && rt - ev.t < 400) ev.fn();
        }
      }
      lastEventRt = rt;
    }

    function updateCamera(dt, rt) {
      if (DEBUG.cam) {
        camera.position.set(DEBUG.cam.pos[0], DEBUG.cam.pos[1], DEBUG.cam.pos[2]);
        camera.lookAt(DEBUG.cam.look[0], DEBUG.cam.look[1], DEBUG.cam.look[2]);
        return;
      }
      introShake = Math.max(0, introShake - dt * 1.4);
      if (introCamera(rt, dt)) {
        camera.position.copy(introPos);
        if (introShake > 0) {
          const t = nowMs() / 1000, a = introShake * introShake * 0.9;
          camera.position.x += Math.sin(t * 47) * a;
          camera.position.y += Math.sin(t * 59 + 1) * a;
          camera.position.z += Math.sin(t * 53 + 2) * a;
        }
        camera.lookAt(introLook);
        if (introRoll) camera.rotateZ(introRoll);
        if (Math.abs(camera.fov - introFov) > 0.01) { camera.fov = introFov; camera.updateProjectionMatrix(); }
        return;
      }
      if (Math.abs(camera.fov - 70) > 0.01) {
        camera.fov += (70 - camera.fov) * Math.min(1, dt * 6);
        camera.updateProjectionMatrix();
      }
      const pos = followCamera(dt);
      camera.position.copy(pos);
      if (shake > 0) {
        camera.position.x += (Math.random() - 0.5) * shake * 0.5;
        camera.position.y += (Math.random() - 0.5) * shake * 0.5;
        camera.position.z += (Math.random() - 0.5) * shake * 0.5;
      }
      camera.lookAt(lookAt);
    }

    // ------------------------------------------------------------------ input
    const isDiveKey = (c) => c === "ShiftLeft" || c === "ShiftRight" || c === "ControlLeft" || c === "ControlRight";
    function startDive() {
      const now = nowMs();
      if (!canControl() || diving || gb || now - lastDiveAt < DIVE_COOLDOWN_MS || stun > 0) return;
      lastDiveAt = now;
      diving = true;
      diveAt = now;
      diveLandedAt = 0;
      diveBumped = false;
      const w = wishDir();
      if (w) faceYaw = Math.atan2(w[0], w[1]);
      velocity.x = Math.sin(faceYaw) * DIVE_SPEED;
      velocity.z = Math.cos(faceYaw) * DIVE_SPEED;
      velocity.y = onFloor ? DIVE_HOP : Math.max(velocity.y, 2);
      onFloor = false;
    }
    function setGrab(on) {
      if (on === grabHeld) return;
      grabHeld = on;
      if (!on && (gr || grabPending)) {
        s.socket.emit("eye-input", { t: "release" });
        grabPending = false;
      }
    }
    function tryGrab() {
      const now = nowMs();
      if (!grabHeld || gr || gb || diving || !canControl() || now - lastGrabTry < GRAB_TRY_MS) return;
      lastGrabTry = now;
      const f = feet();
      const fx = Math.sin(faceYaw), fz = Math.cos(faceYaw);
      let best = null, bestD = Infinity;
      for (const [uid, b] of beans) {
        if (!b.bean.group.visible) continue;
        const dx = b.pos.x - f[0], dz = b.pos.z - f[2], dy = b.pos.y - f[1];
        const d = Math.hypot(dx, dz);
        if (d > course.PLAYER.reach + 0.4 || Math.abs(dy) > 1.4) continue;
        if (d > 0.3 && (dx * fx + dz * fz) / d < 0.2) continue;
        if (d < bestD) { bestD = d; best = uid; }
      }
      if (best) {
        grabPending = true;
        s.socket.emit("eye-input", { t: "grab", victim: best });
      }
    }

    const isGrabKey = (c) => c === "KeyE" || c === "KeyJ";
    const blocksPage = (c) => c === "Space" || c.startsWith("Arrow") || c === "Tab";
    // Esc help menu: Esc / Enter / Space / a click closes it again.
    function startPlaying() {
      if (matchOver) return;
      started = true;
      hud.setLocked(true);
    }
    function showMenu() {
      started = false;
      for (const k in keys) keys[k] = false;
      setGrab(false);
      if (document.pointerLockElement) document.exitPointerLock();
      hud.setLocked(matchOver);
    }
    function pressJump() {
      jumpQueuedAt = nowMs();
      if (gb) { s.socket.emit("eye-input", { t: "struggle" }); hud.struggle(); }
    }

    s.on(document, "keydown", (e) => {
      const playing = started || locked;
      if (playing && blocksPage(e.code)) e.preventDefault();
      if (!playing && !matchOver) {
        if (e.code === "Enter" || e.code === "Space" || e.code === "NumpadEnter" || e.code === "Escape") { e.preventDefault(); startPlaying(); }
        return;
      }
      if (e.code === "Escape" && !locked && started) { showMenu(); return; }
      if (keys[e.code]) return;               // key repeat
      keys[e.code] = true;
      if (e.code === "Space") pressJump();
      if (isDiveKey(e.code) || e.code === "KeyK") startDive();
      if (isGrabKey(e.code)) setGrab(true);
      if (e.code === "KeyU" && spawned && !gone && !matchOver) { respawn(); hud.toast("BACK TO THE CHECKPOINT", "#ffd23f"); }
      if (e.code === "KeyF") {
        if (document.fullscreenElement) document.exitFullscreen();
        else wrap.requestFullscreen?.().then(() => renderer.domElement.requestPointerLock()).catch(() => {});
      }
    });
    s.on(document, "keyup", (e) => {
      keys[e.code] = false;
      if (isGrabKey(e.code) && !keys.KeyE && !keys.KeyJ && !pad.grab) setGrab(false);
    });
    s.on(document, "mousemove", (e) => {
      if (!locked) return;
      camYaw -= e.movementX * LOOK_SENS;
      camPitch += e.movementY * LOOK_SENS;
      camPitch = Math.max(-0.25, Math.min(1.25, camPitch));
      if (e.movementX || e.movementY) lastLookAt = nowMs();
    });
    s.on(document, "mousedown", (e) => { if (locked && e.button === 0) setGrab(true); });
    s.on(document, "mouseup", (e) => { if (e.button === 0 && !keys.KeyE && !keys.KeyJ) setGrab(false); });
    s.on(document, "pointerlockchange", () => {
      locked = document.pointerLockElement === renderer.domElement;
      if (!locked) setGrab(false);             // keep the keys: keyboard play carries on
      hud.setLocked(locked || started || matchOver);
    });
    // Clicking the canvas adds mouse-look; clicking the menu just closes it.
    s.on(hud.lockOverlay, "click", () => startPlaying());
    s.on(renderer.domElement, "click", () => { if (!locked && !matchOver && !DEBUG.nolock) renderer.domElement.requestPointerLock(); });
    s.on(renderer.domElement, "contextmenu", (e) => e.preventDefault());
    hud.setLocked(true);

    // ---------------------------------------------------------------- gamepad
    // Left stick runs, right stick looks, A jumps, X/B dive, RB/RT grab, Start plays.
    function pollPad() {
      const pads = navigator.getGamepads ? navigator.getGamepads() : [];
      let gp = null;
      for (const p of pads) if (p && p.connected) { gp = p; break; }
      if (!gp) { pad.moveF = pad.moveR = pad.lookX = pad.lookY = 0; pad.grab = false; return; }
      const dz = (v) => (Math.abs(v) < PAD_DEAD ? 0 : (v - Math.sign(v) * PAD_DEAD) / (1 - PAD_DEAD));
      const ax = gp.axes || [];
      pad.moveR = dz(ax[0] || 0);
      pad.moveF = -dz(ax[1] || 0);
      pad.lookX = dz(ax[2] || 0);
      pad.lookY = dz(ax[3] || 0);
      const down = (i) => !!(gp.buttons[i] && (gp.buttons[i].pressed || gp.buttons[i].value > 0.5));
      const edge = (i) => down(i) && !pad.prev[i];
      if (!started && !locked && !matchOver) {
        if (edge(0) || edge(9)) startPlaying();
      } else {
        if (edge(0)) pressJump();
        if (edge(1) || edge(2)) startDive();
        const g = down(5) || down(7);
        if (g !== !!pad.grab) { pad.grab = g; if (g) setGrab(true); else if (!keys.KeyE && !keys.KeyJ) setGrab(false); }
        if (edge(9)) showMenu();
      }
      pad.prev = gp.buttons.map((b, i) => down(i));
    }

    // arrows / right stick turn the camera; hands off -> the camera follows you
    function steerCamera(dt) {
      let yawIn = 0, tiltIn = 0;
      if (started || locked) {
        if (keys.ArrowLeft) yawIn += KEY_ORBIT;
        if (keys.ArrowRight) yawIn -= KEY_ORBIT;
        if (keys.ArrowUp) tiltIn -= KEY_TILT;
        if (keys.ArrowDown) tiltIn += KEY_TILT;
      }
      yawIn -= pad.lookX * PAD_ORBIT;
      tiltIn += pad.lookY * PAD_TILT;
      if (yawIn || tiltIn) {
        camYaw += yawIn * dt;
        camPitch = Math.max(-0.25, Math.min(1.25, camPitch + tiltIn * dt));
        lastLookAt = nowMs();
        return;
      }
      if (nowMs() - lastLookAt < AUTO_CAM_IDLE_MS || !canControl()) return;

      // Swing round behind the way you're running, leaning towards the way the
      // course goes, so holding W alone carries you up the spiral.
      const speed = Math.hypot(velocity.x, velocity.z);
      if (speed < 1.2) return;
      const travel = Math.atan2(velocity.x, velocity.z);
      let target = travel;
      const f = feet();
      const prog = course.progressAt(f[0], f[1], f[2]);
      if (prog.dist < course.widthAt(prog.s) / 2 + 3 && prog.s < course.PATH_END - 6) {
        const q = course.pathPoint(Math.min(course.PATH_END, prog.s + 2));
        const along = Math.cos(course.angleDiff(q.yaw, travel));
        if (along < -0.2) return;                    // running back down: leave the camera be
        if (along > 0.2) {
          // Look at a spot ~8 m up the course, in your own lane if it still
          // fits there, pulled in if the course narrows (plaza -> ramp).
          let narrow = Infinity;
          for (let k = 0; k <= 14; k += 2) narrow = Math.min(narrow, course.widthAt(prog.s + k));
          const room = Math.max(0, narrow / 2 - 1.5);
          const lane = Math.max(-room, Math.min(room, prog.lateral));
          const outside = Math.abs(prog.lateral - lane) > 0.5;      // off the lane that fits: head in sooner
          const aim = course.pathOffset(Math.min(course.PATH_END, prog.s + (outside ? 5 : 8)), lane, 0);
          const aimYaw = Math.atan2(aim[0] - f[0], aim[2] - f[2]);
          target = travel + course.angleDiff(aimYaw, travel) * (outside ? 1 : 0.8);
        }
      }
      const diff = course.angleDiff(target, camYaw);
      const straight = Math.max(0, Math.cos(course.angleDiff(travel, camYaw)));
      const rate = 0.7 + 2.3 * Math.min(1, speed / RUN_SPEED) * straight;
      let step = diff * (1 - Math.exp(-rate * dt));
      const cap = AUTO_CAM_MAX * dt;
      step = Math.max(-cap, Math.min(cap, step));
      camYaw += step;
      // settle the tilt back to the default view too
      camPitch += (0.32 - camPitch) * (1 - Math.exp(-0.8 * dt));
    }

    // ---------------------------------------------------------------- network
    function syncClock(rt) {
      if (!Number.isFinite(rt)) return;
      const est = nowMs() - rt;
      if (clockOffset === null || Math.abs(est - clockOffset) > 500) clockOffset = est;
      else clockOffset += (est - clockOffset) * 0.08;
    }

    s.sock("eye-init", (data) => {
      const first = !myUid;
      myUid = data.uid;
      if (first) s.socket.emit("eye-input", { t: "team", team: myTeam });
      // the clock is taken from eye-state, which also says whether the server
      // is still waiting for everyone to load
      if (data.phase && data.phase !== "loading") syncClock(data.rt);
      if (Array.isArray(data.players)) {
        const idx = data.players.findIndex((p) => p.uid === myUid);
        if (idx >= 0) myIndex = idx;
        else myIndex = Math.max(0, (parseInt(String(myUid).replace(/\D/g, ""), 10) || 1) - 1);
        ensureMyBean(data.players.find((p) => p.uid === myUid));
      }
      if (Number.isFinite(data.cp)) myCp = data.cp;
      if (!spawned) respawn();
    });

    s.sock("eye-state", (st) => {
      // While the server waits for everyone to load, the clock stands still at
      // the start of the intro; it starts for all players together.
      loadingPhase = st.phase === "loading";
      if (loadingPhase) clockOffset = null;
      else syncClock(st.rt);
      phase = st.phase || phase;
      if (Number.isFinite(st.timeLeft)) timeLeft = st.timeLeft;
      snapshot = st.players || [];
      playersById = new Map(snapshot.map((p) => [p.uid, p]));
      const me = myUid ? playersById.get(myUid) : null;
      if (me) {
        if (TEAMS.includes(me.tm) && me.tm !== myTeam && myUid) myTeam = me.tm;   // the server's word wins
        ensureMyBean(me);
        if (Number.isFinite(me.cp)) myCp = me.cp;
        myPlace = me.place || myPlace;
        const newGb = me.gb || null;
        if (newGb && !gb) shake = Math.max(shake, 0.5);
        gb = newGb;
        struggles = gb ? (me.st || 0) : 0;
        const newGr = me.gr || null;
        gr = newGr;
        grabLeft = gr ? (me.gt || 0) : 0;
        if (gr) grabPending = false;
        if (gr && !grabHeld) s.socket.emit("eye-input", { t: "release" });
      }
      if (!winner && (st.phase === "won" || st.phase === "over")) {
        const w = snapshot.find((p) => p.fin);
        if (w) onWin(w.uid, w.name);
      }
      syncBeans();
      hud.setRace(snapshot, myUid);
      loader.players(snapshot, myUid, loadingPhase);
    });

    s.sock("eye-knock", ({ v, by }) => {
      if (!Array.isArray(v) || gone) return;
      velocity.set(v[0], v[1], v[2]);
      onFloor = false;
      diving = false;
      stun = STUN_S;
      shake = Math.max(shake, 0.3);
      hud.toast((by ? String(by).toUpperCase() + " " : "") + "BUMPED YOU!", "#ff4fa0");
    });

    s.sock("eye-cp", ({ cp, name }) => {
      if (Number.isFinite(cp)) myCp = cp;
      hud.banner(name || "CHECKPOINT!", "#3fe0ff", 1600);
    });

    s.sock("eye-win", ({ uid, name }) => onWin(uid, name));

    // Also reached from eye-state, so a page that loads after the win still
    // sees the cages open.
    function onWin(uid, name) {
      if (winner) return;
      winner = { uid, name };
      crown.group.visible = false;
      try { art.flash("win"); } catch (e) { /* ignore */ }
      if (hostages) { try { hostages.free(); } catch (e) { /* ignore */ } }
      hostageSolids = [];
      if (uid === myUid) { hud.banner("YOU FREED THE HOSTAGES!", "#ffd23f", 5000); stats.crowned = true; }
      else hud.banner(String(name).toUpperCase() + " FREED THE HOSTAGES!", "#ffd23f", 5000);
    }

    s.sock("eye-over", ({ table, endsIn }) => {
      matchOver = true;
      setGrab(false);
      if (document.pointerLockElement) document.exitPointerLock();
      hud.endScreen(table, myUid, endsIn);
    });

    // The team was picked in the lobby; it goes with every ready.
    const sayReady = () => {
      s.socket.emit("eye-input", { t: "team", team: myTeam });
      s.socket.emit("eye-input", { t: "ready" });
    };
    // Compile every shader behind the loading screen. Otherwise each part of
    // the scene compiles the first time the intro camera sweeps past it, and
    // the intro stutters. Only then do we say we're ready: the server starts
    // the intro when everyone is, so nobody's intro runs on a cold GPU.
    loader.step("Forging the Dark Tower\u2026", 0.78);
    try { art.prepare?.(); } catch (e) { /* shadows just adopt later */ }
    try {
      if (renderer.compileAsync) await renderer.compileAsync(scene, camera);
      else renderer.compile(scene, camera);
    } catch (e) { /* compiles on first use instead */ }
    if (s.disposed) return;
    try {      // one frame through the post pipeline builds bloom and shadows too
      const rt0 = -course.COUNTDOWN_MS;
      art.update(0, rt0, course.gazeAt(rt0), camera.position);
      art.render();
    } catch (e) { /* ignore */ }
    if (s.disposed) return;
    loader.step("Waiting for the other soldiers\u2026", 0.85);
    const readyTimer = setInterval(() => {
      if (myUid) { clearInterval(readyTimer); return; }
      sayReady();
    }, 700);
    s.intervals.push(readyTimer);
    sayReady();

    function animState() {
      if (gone) return 4;
      if (stun > 0) return 3;
      if (diving) return 2;
      if (!onFloor) return 1;
      return 0;
    }

    const sendTimer = setInterval(() => {
      if (s.disposed || !spawned || !myUid) return;
      const f = feet();
      s.socket.emit("eye-input", {
        t: "state",
        p: [+f[0].toFixed(3), +f[1].toFixed(3), +f[2].toFixed(3)],
        yaw: +faceYaw.toFixed(3),
        v: [+velocity.x.toFixed(2), +velocity.y.toFixed(2), +velocity.z.toFixed(2)],
        a: animState(),
        g: grabHeld ? 1 : 0,
      });
    }, SEND_MS);
    s.intervals.push(sendTimer);

    // ------------------------------------------------------- falls and stuck
    function checkFall() {
      if (gone || !spawned) {
        if (gone && nowMs() >= goneUntil) { respawn(); hud.fade(false); }
        return;
      }
      const f = feet();
      if (!course.isFallen(f[0], f[1], f[2])) return;
      gone = true;
      goneUntil = nowMs() + RESPAWN_MS;
      stats.falls++;
      if (myBean) myBean.group.visible = false;
      s.socket.emit("eye-input", { t: "fell" });
      hud.fade(true);
      hud.toast(["SPLOSH!", "INTO THE LAVA!", "OOPS!", "WHOOPS!"][stats.falls % 4], "#ff6a1a");
    }

    function checkStuck(dt) {
      if (gone || matchOver || !canControl()) { stuckFor = 0; lastPos.copy(collider.start); return; }
      const moving = keys.KeyW || keys.KeyS || keys.KeyA || keys.KeyD || DEBUG.holdW || Math.hypot(pad.moveF, pad.moveR) > 0.3;
      if (!moving) { stuckFor = 0; lastPos.copy(collider.start); return; }
      if (collider.start.distanceToSquared(lastPos) > 0.25) { stuckFor = 0; lastPos.copy(collider.start); return; }
      stuckFor += dt;
      if (stuckFor > 4) { stuckFor = 0; respawn(); hud.toast("UNSTUCK", "#ffd23f"); }
    }

    function checkCrown(rt) {
      if (winner || gone || !spawned || rt < 0 || matchOver) return;
      const f = feet();
      const c = course.CROWN.pos;
      const d = Math.hypot(f[0] - c[0], f[1] + 0.9 - c[1], f[2] - c[2]);
      if (d > course.CROWN.reach) return;
      const now = nowMs();
      if (now - lastCrownTry < CROWN_TRY_MS) return;
      lastCrownTry = now;
      s.socket.emit("eye-input", { t: "crown" });
    }

    // ------------------------------------------------------------------ loop
    const clock = new THREE.Clock();
    let loaderGone = false;
    let tSec = 0;
    function animate() {
      s.raf = requestAnimationFrame(animate);
      const dt = Math.min(0.05, clock.getDelta());
      tSec += dt;
      const rt = raceTime();

      pollPad();
      steerCamera(dt);
      buildHazardFrame(rt);
      if (!gone && spawned) {
        const sub = dt / SUB_STEPS;
        for (let i = 0; i < SUB_STEPS; i++) stepPlayer(sub);
        tryGrab();
      }
      stun = Math.max(0, stun - dt);
      burn = Math.max(0, burn - dt * 0.8);
      shake = Math.max(0, shake - dt * 1.8);
      if (gb) shake = Math.max(shake, 0.28);                 // held: the camera never settles
      checkGaze(rt);
      checkFall();
      checkStuck(dt);
      checkCrown(rt);

      if (myBean) {
        const f = feet();
        myBean.group.position.set(f[0], f[1], f[2]);
        myBean.group.rotation.y = faceYaw;
        myBean.update(dt, {
          speed: Math.hypot(velocity.x, velocity.z),
          air: !onFloor,
          vy: velocity.y,
          dive: diving,
          grab: grabHeld || !!gr,
          grabbed: !!gb,
          stun: stun / (STUN_S + 0.3),
          burn,
          t: tSec,
        });
      }
      updateBeans(dt, tSec);
      updateRopes(tSec);
      crown.update(dt, tSec);
      if (hostages) { try { hostages.update(dt, tSec); } catch (e) { /* keep racing */ } }
      if (clockOffset !== null) introEvents(rt);
      updateCamera(dt, rt);

      updateDemo(dt, rt, tSec);
      try { art.update(dt, rt, demoGaze(rt) || course.gazeAt(rt), camera.position); } catch (e) { /* keep racing */ }
      if (!DEBUG.norender) art.render();
      // the loading screen lifts once the server has started the intro for all
      if (!loaderGone && ((clockOffset !== null && myUid) || DEBUG.cam)) { loaderGone = true; loader.hide(); }

      const f = feet();
      const prog = course.progressAt(f[0], f[1], f[2]);
      stats.s = prog.s;
      stats.maxS = Math.max(stats.maxS, prog.s);
      stats.onFloor = onFloor;
      stats.rt = Math.round(rt);
      stats.cp = myCp;
      stats.pos = f.map((v) => +v.toFixed(2));
      if (DEBUG.titleStats) {
        stats.cam = camera.position.toArray().map((v) => +v.toFixed(1));
        stats.frames = (stats.frames || 0) + 1;
        stats.spawned = spawned; stats.gone = gone; stats.uid = myUid;
        const camErr = Math.abs(course.angleDiff(camYaw, course.pathPoint(Math.min(course.PATH_END, prog.s + 2)).yaw));
        if (rt > 1500) stats.maxCamErr = Math.max(stats.maxCamErr || 0, camErr);
        if (stats.frames % 20 === 0) (stats.trace = stats.trace || []).push([Math.round(rt), +prog.s.toFixed(1), +f[1].toFixed(2), onFloor ? 1 : 0, +Math.hypot(velocity.x, velocity.z).toFixed(1), +camErr.toFixed(2)]);
        document.title = JSON.stringify(stats);
      }

      const meRec = myUid ? playersById.get(myUid) : null;
      hud.update({
        intro: clockOffset !== null && rt < 0 && !DEBUG.cam,
        myName: meRec ? meRec.name : "", myTeam, myColor: meRec ? meRec.color : "#ff4fa0",
        rt, phase, timeLeft, place: myPlace, count: Math.max(1, snapshot.length), cp: myCp,
        gazeWarn, grabbed: !!gb, grabbing: !!gr, burn, winner,
        heldBy: gb ? (playersById.get(gb) || {}).name : "",
        holding: gr ? (playersById.get(gr) || {}).name : "",
        struggles, grabLeft,
      });
    }
    animate();
  }

  // ------------------------------------------------------------ stand-ins
  // Minimal versions of the art module, so the race still runs without it.
  function stubWorld(THREE, scene, renderer, camera, course) {
    scene.background = new THREE.Color(0x3a1414);
    scene.fog = new THREE.Fog(0x3a1414, 80, 420);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    const hemi = new THREE.HemisphereLight(0xffd9c2, 0x401010, 1.4);
    const sun = new THREE.DirectionalLight(0xffe0c0, 2.2);
    sun.position.set(60, 120, 40);
    scene.add(hemi, sun);
    const lava = new THREE.Mesh(
      new THREE.CircleGeometry(600, 48),
      new THREE.MeshStandardMaterial({ color: 0xff4a10, emissive: 0xff3a00, emissiveIntensity: 1.2 })
    );
    lava.rotation.x = -Math.PI / 2;
    lava.position.y = course.LAVA_Y;
    const P = course.TOWER_PROFILE.map(([y, r]) => new THREE.Vector2(r, y));
    const tower = new THREE.Mesh(new THREE.LatheGeometry(P, 24), new THREE.MeshStandardMaterial({ color: 0x151015, roughness: 0.6, metalness: 0.6 }));
    const eye = new THREE.Mesh(new THREE.SphereGeometry(4, 24, 16), new THREE.MeshBasicMaterial({ color: 0xff8a1a }));
    eye.scale.set(0.7, 1.4, 0.5);
    eye.position.fromArray(course.EYE_POS);
    const beam = new THREE.Mesh(
      new THREE.ConeGeometry(12, 60, 24, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xff3a10, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false })
    );
    beam.geometry.translate(0, -30, 0);
    const beamPivot = new THREE.Group();
    beamPivot.position.fromArray(course.EYE_POS);
    beamPivot.add(beam);
    scene.add(lava, tower, eye, beamPivot);
    return {
      update(dt, rt, gaze) {
        beamPivot.rotation.set(0, 0, 0);
        const dir = new THREE.Vector3(Math.cos(gaze.phi) * 35, -48, Math.sin(gaze.phi) * 35).normalize();
        beamPivot.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir);
        beam.material.opacity = 0.05 + 0.2 * gaze.intensity;
      },
      render() { renderer.render(scene, camera); },
      setSize() {},
      flash() {},
      dispose() {},
    };
  }

  function stubBean(THREE, { color }) {
    const group = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.45, 0.85, 6, 14), new THREE.MeshStandardMaterial({ color, roughness: 0.4 }));
    body.position.y = 0.875;
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.2, 0.1), new THREE.MeshStandardMaterial({ color: 0xffffff }));
    visor.position.set(0, 1.3, 0.4);
    group.add(body, visor);
    return {
      group,
      update(dt, pose) {
        const sq = pose.air ? 1 + Math.max(-0.15, Math.min(0.15, pose.vy * 0.02)) : 1;
        body.scale.set(1 / sq, sq, 1 / sq);
        group.children.forEach((c) => { c.rotation.x = pose.dive ? Math.PI / 2 : 0; });
      },
      dispose() {},
    };
  }

  function stubCrown(THREE) {
    const group = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: 0xffc21a, metalness: 0.8, roughness: 0.3, emissive: 0xff8a00, emissiveIntensity: 0.4 });
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 0.5, 24, 1, true), mat);
    group.add(band);
    for (let i = 0; i < 6; i++) {
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.5, 8), mat);
      const a = (i / 6) * Math.PI * 2;
      spike.position.set(Math.cos(a) * 0.8, 0.45, Math.sin(a) * 0.8);
      group.add(spike);
    }
    return {
      group,
      update(dt, t) { group.rotation.y = t * 1.2; group.position.y += Math.sin(t * 2) * 0.002; },
      dispose() {},
    };
  }

  // ------------------------------------------------------------------- HUD
  // The intro is designed on a 20 s timeline; this maps a design time (ms
  // before GO) onto the real countdown, however long the course makes it.
  function introTime(course) {
    const k = (course.COUNTDOWN_MS || 20000) / 20000;
    return (ms) => ms * k;
  }

  // ---------------------------------------------------------------- loader
  // The loading screen: up from the first moment (before three.js is even
  // fetched), then a roll-call of who is ready while the server waits for
  // everyone, and it lifts when the intro starts for all players together.
  function buildLoader(course) {
    const OUTLINE = "-webkit-text-stroke:2px #2b0f3a;paint-order:stroke fill;text-shadow:0 4px 0 #2b0f3a,0 6px 14px rgba(0,0,0,0.5);";
    const TIPS = [
      "When the Eye sweeps past, hide under the dark <b>COVER</b> shelters",
      "Hold <b>E</b> to grab a rival - they can mash <b>Space</b> to break free",
      "<b>Shift</b> dives forward: great for gaps, and for bumping people off ledges",
      "Fall in the lava and you respawn at your last <b>checkpoint</b>",
      "Jump to grab the burning <b>Ark crown</b> and the cages break open",
      "No mouse needed: <b>WASD</b> + <b>← →</b> for the camera",
    ];
    const el = document.createElement("div");
    el.style.cssText = "position:relative;width:100%;aspect-ratio:16/9;max-height:80vh;border-radius:10px;overflow:hidden;" +
      "display:flex;flex-direction:column;align-items:center;justify-content:center;gap:0.55rem;text-align:center;" +
      "font-family:Nunito,sans-serif;color:#fff;transition:opacity 700ms ease;z-index:20;" +
      "background:radial-gradient(ellipse at 50% 125%,#b8330c 0%,#5a1208 28%,#22070a 58%,#0b0306 100%);";
    el.innerHTML =
      // lava glow breathing along the bottom, and embers drifting up
      '<div style="position:absolute;left:-10%;right:-10%;bottom:-18%;height:45%;background:radial-gradient(ellipse at 50% 100%,rgba(255,120,20,0.55),rgba(255,60,10,0) 70%);animation:eyeFlicker 2.2s ease-in-out infinite;"></div>' +
      '<div data-embers style="position:absolute;inset:0;pointer-events:none"></div>' +
      '<div style="position:relative;font-size:0.9rem;letter-spacing:10px;color:#ffb199;font-weight:900;' + OUTLINE + '">EYE OF ARK</div>' +
      // the Eye, with the Ark logo burning in its pupil
      '<div style="position:relative;width:190px;height:112px;margin:0.2rem 0;animation:eyeFlicker 1.3s ease-in-out infinite">' +
        '<svg width="190" height="112" viewBox="0 0 190 112" style="position:absolute;inset:0;filter:drop-shadow(0 0 22px rgba(255,120,20,0.9))">' +
        '<defs><radialGradient id="ldg" cx="50%" cy="50%" r="55%"><stop offset="0" stop-color="#fff5b8"/><stop offset="0.35" stop-color="#ffb02e"/>' +
        '<stop offset="0.75" stop-color="#ff5a0e"/><stop offset="1" stop-color="#8a1206"/></radialGradient></defs>' +
        '<path d="M4 56 Q95 -30 186 56 Q95 142 4 56 Z" fill="url(#ldg)" stroke="#2b0f3a" stroke-width="4"/></svg>' +
        '<div style="position:absolute;left:50%;top:50%;width:70px;height:70px;margin:-35px 0 0 -35px;border-radius:50%;' +
        'box-shadow:0 0 0 5px #1a0605,0 0 26px 8px rgba(255,80,0,0.9);background:#1a0605">' +
        '<img src="' + ASSETS + 'ark.svg" alt="ARK" style="width:100%;height:100%;display:block;border-radius:50%"></div>' +
      '</div>' +
      '<div style="position:relative;font-family:' + FONT + ';font-size:2.9rem;line-height:1.05;padding:0 0.2em;' +
        'background:linear-gradient(180deg,#fff7c8 0%,#ffd23f 30%,#ff7a1a 62%,#c0200e 100%);background-size:100% 160%;' +
        '-webkit-background-clip:text;background-clip:text;color:transparent;-webkit-text-stroke:3px #2b0f3a;paint-order:stroke fill;' +
        'filter:drop-shadow(0 5px 0 #2b0f3a) drop-shadow(0 0 20px rgba(255,110,20,0.6));animation:eyeFire 1.6s ease-in-out infinite">THE DARK TOWER OF ARK</div>' +
      '<div data-status style="position:relative;font-family:' + FONT + ';font-size:1.15rem;color:#fff6fb;margin-top:0.3rem;' + OUTLINE + '"></div>' +
      '<div style="position:relative;width:min(420px,70%);height:16px;border:3px solid #fff6fb;border-radius:12px;background:rgba(30,10,40,0.7);box-shadow:0 4px 0 #2b0f3a;overflow:hidden">' +
        '<div data-bar style="height:100%;width:0;background:linear-gradient(90deg,#ff4fa0,#ffd23f,#ff7a1a);transition:width 500ms ease"></div></div>' +
      '<div data-players style="position:relative;display:flex;flex-wrap:wrap;justify-content:center;gap:8px;max-width:86%;margin-top:0.35rem"></div>' +
      '<div data-tip style="position:absolute;bottom:5%;left:0;right:0;font-size:0.9rem;color:#ffd7c2;font-weight:800;transition:opacity 400ms"></div>';
    const q = (k) => el.querySelector("[data-" + k + "]");
    const statusEl = q("status"), barEl = q("bar"), playersEl = q("players"), tipEl = q("tip"), embersEl = q("embers");

    // CSS embers: a few dozen dots rising and fading on their own clocks
    let emberCss = "";
    for (let i = 0; i < 26; i++) {
      const x = Math.round(Math.random() * 100), d = (3 + Math.random() * 4).toFixed(2), delay = (-Math.random() * 7).toFixed(2);
      const size = (2 + Math.random() * 3).toFixed(1);
      emberCss += '<span style="position:absolute;left:' + x + '%;bottom:-4%;width:' + size + 'px;height:' + size + 'px;border-radius:50%;' +
        'background:#ffb35a;box-shadow:0 0 6px 2px rgba(255,120,30,0.9);animation:eyeEmber ' + d + 's linear ' + delay + 's infinite"></span>';
    }
    embersEl.innerHTML = emberCss;
    const style = document.createElement("style");
    style.textContent =
      "@keyframes eyeEmber{0%{transform:translate(0,0);opacity:0}10%{opacity:1}100%{transform:translate(30px,-110vh);opacity:0}}" +
      "@keyframes eyeFlicker{0%,100%{opacity:1;transform:scale(1)}40%{opacity:0.82;transform:scale(1.03,0.97)}70%{opacity:0.95;transform:scale(0.98,1.03)}}" +
      "@keyframes eyeFire{0%,100%{background-position:0% 40%}50%{background-position:0% 70%}}" +
      "@keyframes eyePop{0%{transform:scale(0.6);opacity:0}60%{transform:scale(1.06);opacity:1}100%{transform:scale(1);opacity:1}}" +
      "@keyframes eyeSpin{to{transform:rotate(360deg)}}";
    document.head.appendChild(style);

    let tipIndex = Math.floor(Math.random() * TIPS.length);
    tipEl.innerHTML = "TIP: " + TIPS[tipIndex];
    const tipTimer = setInterval(() => {
      tipIndex = (tipIndex + 1) % TIPS.length;
      tipEl.style.opacity = "0";
      setTimeout(() => { tipEl.innerHTML = "TIP: " + TIPS[tipIndex]; tipEl.style.opacity = "1"; }, 400);
    }, 3600);
    let hideTimer = null, lastKey = "", hidden = false;

    const esc = (str) => String(str).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

    return {
      el,
      // move over the game canvas once it exists
      attach(wrap) {
        el.style.position = "absolute";
        el.style.inset = "0";
        el.style.width = "auto";
        el.style.aspectRatio = "auto";
        el.style.maxHeight = "none";
        el.style.borderRadius = "0";
        wrap.appendChild(el);
      },
      step(text, frac) {
        statusEl.textContent = text;
        barEl.style.width = Math.round(frac * 100) + "%";
      },
      players(list, myUid, loading) {
        if (hidden || !list || !list.length) return;
        const readyCount = list.filter((p) => p.rd !== false).length;
        const key = (loading ? "L" : "C") + list.map((p) => p.uid + p.name + p.tm + (p.rd !== false)).join("|");
        if (key === lastKey) return;
        lastKey = key;
        if (loading) {
          statusEl.innerHTML = "WAITING FOR SOLDIERS… <span style=\"color:#ffd23f\">" + readyCount + " / " + list.length + "</span> READY";
          barEl.style.width = Math.round(85 + 15 * readyCount / list.length) + "%";
        } else {
          statusEl.textContent = "MARCHING ON THE TOWER…";
          barEl.style.width = "100%";
        }
        playersEl.innerHTML = list.map((p) => {
          const norli = p.tm === "norli";
          const ready = p.rd !== false;
          const me = p.uid === myUid;
          return '<div style="display:flex;align-items:center;gap:7px;padding:5px 11px 5px 6px;border-radius:12px;background:rgba(30,10,40,0.78);' +
            'border:2px solid ' + (me ? "#ffd23f" : "rgba(255,246,251,0.35)") + ';box-shadow:0 3px 0 #12060a;font-weight:900;font-size:0.9rem">' +
            '<span style="width:14px;height:14px;border-radius:50%;background:' + esc(p.color || "#fff") + ';border:2px solid #2b0f3a"></span>' +
            '<span>' + esc(p.name || "?") + '</span>' +
            '<span style="font-size:0.66rem;letter-spacing:1px;padding:2px 6px;border-radius:6px;color:#fff;background:' + (norli ? "#003190" : "#dc2359") + '">' +
              (norli ? "NORLI" : "BOOKIS") + '</span>' +
            (ready
              ? '<span style="color:#8fff5c">✓</span>'
              : '<span style="display:inline-block;width:12px;height:12px;border:2px solid #ffd23f;border-top-color:transparent;border-radius:50%;animation:eyeSpin 0.8s linear infinite"></span>') +
            '</div>';
        }).join("");
      },
      hide() {
        if (hidden) return;
        hidden = true;
        el.style.opacity = "0";
        el.style.pointerEvents = "none";
        hideTimer = setTimeout(() => { el.style.display = "none"; }, 750);
      },
      dispose() {
        clearInterval(tipTimer);
        clearTimeout(hideTimer);
        style.remove();
        el.remove();
      },
    };
  }

  function buildHud(wrap, course) {
    const layer = document.createElement("div");
    layer.style.cssText = "position:absolute;inset:0;pointer-events:none;font-family:Nunito,sans-serif;color:#fff;overflow:hidden;";
    wrap.appendChild(layer);
    const OUTLINE = "-webkit-text-stroke:2px #2b0f3a;paint-order:stroke fill;text-shadow:0 4px 0 #2b0f3a,0 6px 14px rgba(0,0,0,0.5);";

    function el(css, html) {
      const d = document.createElement("div");
      d.style.cssText = css;
      if (html) d.innerHTML = html;
      layer.appendChild(d);
      return d;
    }

    const fadeEl = el("position:absolute;inset:0;background:#12060a;opacity:0;transition:opacity 260ms;");
    const burnEl = el("position:absolute;inset:0;opacity:0;background:radial-gradient(ellipse at center,rgba(255,150,40,0) 30%,rgba(255,90,10,0.75) 100%);");
    const grabEl = el("position:absolute;inset:0;opacity:0;transition:opacity 200ms;box-shadow:inset 0 0 120px rgba(63,224,255,0.6);");

    const timer = el("position:absolute;top:12px;left:16px;font-family:" + FONT + ";font-size:1.9rem;letter-spacing:1px;" + OUTLINE);
    const placeEl = el("position:absolute;top:8px;right:18px;text-align:right;font-family:" + FONT + ";" + OUTLINE);
    const cpEl = el("position:absolute;top:66px;right:18px;font-family:" + FONT + ";font-size:0.85rem;letter-spacing:2px;color:#8aefff;" + OUTLINE);

    // progress strip: a dot per bean, checkpoints ticked, the crown at the end
    const strip = el("position:absolute;top:16px;left:50%;transform:translateX(-50%);width:44%;height:16px;" +
      "background:rgba(30,10,40,0.6);border:3px solid #fff6fb;border-radius:12px;box-shadow:0 4px 0 #2b0f3a;");
    for (const cp of course.CHECKPOINTS) {
      if (!cp.index) continue;
      const tick = document.createElement("div");
      tick.style.cssText = "position:absolute;top:-3px;bottom:-3px;width:3px;background:#3fe0ff;left:" + (cp.s / course.PATH_END * 100) + "%;";
      strip.appendChild(tick);
    }
    const crownIcon = document.createElement("div");
    crownIcon.textContent = "\u{1F451}";
    crownIcon.style.cssText = "position:absolute;right:-30px;top:-10px;font-size:1.4rem;";
    strip.appendChild(crownIcon);
    const dotLayer = document.createElement("div");
    dotLayer.style.cssText = "position:absolute;inset:0;";
    strip.appendChild(dotLayer);

    const warnEl = el("position:absolute;top:48px;left:50%;transform:translateX(-50%);display:flex;align-items:center;gap:10px;opacity:0;" +
      "font-family:" + FONT + ";font-size:1.05rem;letter-spacing:1px;color:#ffb199;white-space:nowrap;" + OUTLINE);
    warnEl.innerHTML =
      '<svg width="54" height="34" viewBox="0 0 54 34" style="animation:eyePulse 0.6s infinite">' +
      '<defs><radialGradient id="eyeg"><stop offset="0" stop-color="#fff2a0"/><stop offset="0.5" stop-color="#ff8a1a"/><stop offset="1" stop-color="#c0200e"/></radialGradient></defs>' +
      '<ellipse cx="27" cy="17" rx="26" ry="15" fill="url(#eyeg)" stroke="#2b0f3a" stroke-width="2.5"/>' +
      '<ellipse cx="27" cy="17" rx="3.5" ry="13" fill="#140606"/></svg>' +
      '<span>THE EYE IS COMING — TAKE COVER</span>';

    const centre = el("position:absolute;left:0;right:0;top:12%;text-align:center;font-family:" + FONT + ";font-size:9rem;line-height:1;color:#ffd23f;z-index:5;" + OUTLINE);
    const bannerEl = el("position:absolute;left:0;right:0;top:22%;text-align:center;font-family:" + FONT + ";font-size:2.6rem;opacity:0;transition:opacity 250ms;" + OUTLINE);
    const toastEl = el("position:absolute;left:50%;bottom:16%;transform:translateX(-50%);font-family:" + FONT + ";font-size:1.4rem;letter-spacing:1px;opacity:0;transition:opacity 200ms;white-space:nowrap;" + OUTLINE);
    const gazeEl = el("position:absolute;left:50%;top:40%;transform:translateX(-50%);font-family:" + FONT + ";font-size:2.8rem;color:#ff6a1a;opacity:0;transition:opacity 200ms;white-space:nowrap;" + OUTLINE);
    gazeEl.textContent = "THE EYE SEES YOU!";
    const statusEl = el("position:absolute;left:50%;bottom:9%;transform:translateX(-50%);font-family:" + FONT + ";font-size:1rem;color:#3fe0ff;white-space:nowrap;" + OUTLINE);

    const endBoard = el("position:absolute;inset:0;display:none;align-items:center;justify-content:center;" +
      "background:rgba(20,6,24,0.88);backdrop-filter:blur(2px);z-index:5;pointer-events:auto;");

    // Esc help menu. The race never waits for it: it only lists the controls.
    const lockOverlay = el(
      "position:absolute;inset:0;display:none;flex-direction:column;align-items:center;justify-content:center;gap:0.6rem;z-index:6;" +
      "background:radial-gradient(ellipse at center,rgba(60,10,30,0.82),rgba(14,4,10,0.93));cursor:pointer;pointer-events:auto;text-align:center;padding:1rem;",
      '<div style="font-family:' + FONT + ';font-size:0.95rem;letter-spacing:4px;color:#ff9a5a;' + OUTLINE + '">EYE OF ARK</div>' +
      '<div style="font-family:' + FONT + ';font-size:2.3rem;color:#ff7a1a;margin-top:-0.4rem;' + OUTLINE + '">THE DARK TOWER OF ARK</div>' +
      '<div style="font-size:0.95rem;color:#ffe3ef;font-weight:800">Free the Bookis &amp; Norli hostages caged at the top!</div>' +
      '<div style="font-size:0.72rem;letter-spacing:3px;color:#b8a6c9;font-weight:900;margin-top:0.4rem">CONTROLS</div>' +
      '<div style="font-size:0.9rem;color:#ffe3ef;line-height:1.8;font-weight:700">' +
      '<b>WASD</b> run &nbsp;·&nbsp; <b>← →</b> turn camera &nbsp;·&nbsp; <b>↑ ↓</b> tilt &nbsp;·&nbsp; <b>Space</b> jump<br>' +
      '<b>Shift</b> / <b>K</b> dive &nbsp;·&nbsp; <b>E</b> / <b>J</b> grab &nbsp;·&nbsp; grabbed? <b>mash Space</b><br>' +
      '<span style="color:#b8a6c9">Hands off the camera and it follows you up the tower</span><br>' +
      '<span style="color:#b8a6c9">Click the game for mouse-look (hold left click to grab) &nbsp;·&nbsp; Gamepad: sticks, A jump, X/B dive, RB grab</span><br>' +
      '<b>U</b> back to checkpoint &nbsp;·&nbsp; <b>F</b> fullscreen<br>' +
      '<span style="color:#ffb199">Race up the tower and grab the burning Ark crown to break the cages.<br>When the Eye sweeps past, hide under the dark <b>COVER</b> shelters!</span></div>' +
      '<div style="font-family:' + FONT + ';font-size:1.15rem;color:#fff;margin-top:0.4rem;' + OUTLINE + '"><span style="color:#ffd23f">ESC</span> / <span style="color:#ffd23f">ENTER</span> back to the race</div>'
    );

    // ---- cinematic layer: letterbox, title cards, cuts, your name card
    const barTop = el("position:absolute;left:0;right:0;top:0;height:0;background:#050103;transition:height 650ms cubic-bezier(.2,.8,.2,1);z-index:3;");
    const barBot = el("position:absolute;left:0;right:0;bottom:0;height:0;background:#050103;transition:height 650ms cubic-bezier(.2,.8,.2,1);z-index:3;");
    const cardEl = el("position:absolute;left:0;right:0;top:27%;text-align:center;opacity:0;transition:opacity 380ms;z-index:4;");
    const cutEl = el("position:absolute;inset:0;opacity:0;z-index:4;");
    const nameCard = el("position:absolute;left:5%;bottom:16%;opacity:0;transition:opacity 300ms;z-index:4;");
    const hintEl = el("position:absolute;left:50%;bottom:4%;transform:translateX(-50%);padding:7px 16px;border-radius:12px;" +
      "background:rgba(20,6,24,0.72);border:2px solid rgba(255,246,251,0.35);font-size:0.82rem;font-weight:800;color:#ffe3ef;" +
      "white-space:nowrap;opacity:0;transition:opacity 500ms;",
      '<b style="color:#ffd23f">WASD</b> run &nbsp;·&nbsp; <b style="color:#ffd23f">← →</b> camera &nbsp;·&nbsp; <b style="color:#ffd23f">Space</b> jump &nbsp;·&nbsp; ' +
      '<b style="color:#ffd23f">Shift</b> dive &nbsp;·&nbsp; <b style="color:#ffd23f">E</b> grab &nbsp;·&nbsp; <b style="color:#ffd23f">Esc</b> help');
    const IT = introTime(course);
    // Title cards: few words, solid colours on a dark panel so they read over
    // any shot. The two that teach the game (hostages, the Eye) stay longest.
    const PANEL = "display:inline-block;background:rgba(18,6,20,0.78);border:3px solid rgba(255,246,251,0.28);" +
      "border-radius:20px;padding:14px 36px 16px;box-shadow:0 8px 0 rgba(10,2,8,0.6);";
    const card = (title, color, sub) =>
      '<div style="' + PANEL + '">' +
        '<div style="font-family:' + FONT + ';font-size:4.4rem;line-height:1.05;color:' + color + ';' + OUTLINE + '">' + title + '</div>' +
        (sub ? '<div style="margin-top:0.35rem;font-size:1.45rem;font-weight:900;letter-spacing:2px;color:#fff6fb;' + OUTLINE + '">' + sub + '</div>' : '') +
      '</div>';
    const POP = "eyePop 450ms cubic-bezier(.2,.9,.3,1) both";
    const CARDS = [
      { t0: IT(-19400), t1: IT(-16700), key: "title", top: "58%", anim: POP, html: card("EYE OF ARK", "#ff9a2a") },
      { t0: IT(-15900), t1: IT(-13400), key: "tower", top: "60%", anim: POP, html: card("THE DARK TOWER OF ARK", "#ff9a2a") },
      { t0: IT(-12900), t1: IT(-10700), key: "free",  top: "64%", anim: POP, html: card("FREE THE HOSTAGES!", "#ffd23f", "Caged at the top") },
      { t0: IT(-10500), t1: IT(-8400),  key: "race",  top: "64%", anim: POP, html: card("GRAB THE CROWN!", "#3fe0ff", "It breaks the cages") },
      { t0: IT(-8000),  t1: IT(-3100),  key: "eye",   top: "10%", anim: POP, html: card("HIDE FROM THE EYE!", "#ff6a3d", "Stand under <span style=\"color:#ffd23f\">COVER</span>") },
    ];
    let cardKey = "", nameKey = "";

    // Held: the whole screen says so.
    const heldEl = el("position:absolute;inset:0;opacity:0;transition:opacity 120ms;animation:eyeHeld 0.45s infinite;" +
      "box-shadow:inset 0 0 160px 30px rgba(255,40,110,0.85);background:radial-gradient(ellipse at center,rgba(255,79,160,0) 45%,rgba(255,40,110,0.35) 100%);");
    const heldText = el("position:absolute;left:0;right:0;top:30%;text-align:center;opacity:0;transition:opacity 120ms;");
    const holdEl = el("position:absolute;left:50%;bottom:12%;transform:translateX(-50%);text-align:center;opacity:0;transition:opacity 150ms;");

    let toastTimer = null, bannerTimer = null, gazeTimer = null, endTimer = null;
    let lastCount = null;
    let lastDots = "";
    let burnShown = 0;

    function esc(str) {
      return String(str).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
    }

    let struggleFlash = 0;
    let heldKey = "", holdKey = "";

    return {
      layer,
      lockOverlay,
      cut(color) {
        cutEl.style.background = color || "#fff";
        cutEl.style.animation = "none";
        void cutEl.offsetWidth;
        cutEl.style.animation = "eyeCut 420ms ease-out forwards";
      },
      struggle() { struggleFlash = 1; },
      stopTimers() {
        clearTimeout(toastTimer); clearTimeout(bannerTimer); clearTimeout(gazeTimer); clearInterval(endTimer);
      },
      setLocked(hidden) { lockOverlay.style.display = hidden ? "none" : "flex"; },
      fade(on) { fadeEl.style.opacity = on ? "1" : "0"; },
      toast(text, color) {
        toastEl.textContent = text;
        toastEl.style.color = color || "#ffd23f";
        toastEl.style.opacity = "1";
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => { toastEl.style.opacity = "0"; }, 1500);
      },
      banner(text, color, ms) {
        bannerEl.textContent = text;
        bannerEl.style.color = color || "#ffd23f";
        bannerEl.style.opacity = "1";
        bannerEl.style.animation = "none";
        void bannerEl.offsetWidth;
        bannerEl.style.animation = "eyePop 500ms ease-out";
        clearTimeout(bannerTimer);
        bannerTimer = setTimeout(() => { bannerEl.style.opacity = "0"; }, ms || 1500);
      },
      gazeHit() {
        gazeEl.style.opacity = "1";
        gazeEl.style.animation = "none";
        void gazeEl.offsetWidth;
        gazeEl.style.animation = "eyePop 400ms ease-out";
        burnShown = 1;
        clearTimeout(gazeTimer);
        gazeTimer = setTimeout(() => { gazeEl.style.opacity = "0"; }, 1300);
      },
      setRace(players, myUid) {
        const dots = players.slice().sort((a, b) => (a.uid === myUid) - (b.uid === myUid)).map((p) => {
          const me = p.uid === myUid;
          const size = me ? 18 : 12;
          return '<div title="' + esc(p.name) + '" style="position:absolute;top:50%;left:' + (Math.max(0, Math.min(1, p.prog || 0)) * 100).toFixed(2) +
            '%;width:' + size + 'px;height:' + size + 'px;margin:-' + size / 2 + 'px 0 0 -' + size / 2 + 'px;border-radius:50%;background:' +
            esc(p.color || "#fff") + ';border:' + (me ? "3px solid #fff" : "2px solid #2b0f3a") + ';box-shadow:0 2px 0 #2b0f3a;' +
            (p.fin ? "outline:2px solid #ffd23f;" : "") + '"></div>';
        }).join("");
        if (dots !== lastDots) { dotLayer.innerHTML = dots; lastDots = dots; }
      },
      endScreen(table, myUid, endsIn) {
        const rows = (table || []).map((p) => {
          const me = myUid && p.uid === myUid;
          const medal = ["#ffd23f", "#e8ecf3", "#ff9f5a"][p.place - 1] || "#b8a6c9";
          return '<tr style="color:' + (me ? "#ffd23f" : "#fff6fb") + ';background:' + (me ? "rgba(255,210,63,0.12)" : "transparent") + '">' +
            '<td style="padding:0.45rem 0.8rem;font-family:' + FONT + ';color:' + medal + '">' + p.place + '</td>' +
            '<td style="padding:0.45rem 0.8rem;font-weight:900;text-align:left">' + (p.crown ? "\u{1F451} " : "") + esc(p.name) +
              (me ? ' <span style="color:#b8a6c9;font-size:0.75rem">you</span>' : "") + '</td>' +
            '<td style="padding:0.45rem 0.9rem;font-family:' + FONT + ';font-size:1.1rem">' + p.points + '</td>' +
            '<td style="padding:0.45rem 0.9rem;color:#8aefff">' + (p.crown ? "FREED THEM" : "CP " + (p.cp || 0)) + '</td>' +
            '<td style="padding:0.45rem 0.9rem;color:#ff9f5a">' + (p.falls || 0) + '</td></tr>';
        }).join("");
        const top = table && table[0];
        endBoard.innerHTML =
          '<div style="text-align:center;max-width:92%">' +
          '<div style="font-size:0.8rem;letter-spacing:5px;color:#b8a6c9;font-weight:900">RACE OVER</div>' +
          '<div style="margin:0.3rem 0 1rem;font-family:' + FONT + ';font-size:2.2rem;color:#ffd23f;' + OUTLINE + '">' +
            (top ? esc(top.name) + (top.crown ? " FREED THE HOSTAGES" : " GOT FURTHEST") : "") + '</div>' +
          '<table style="margin:0 auto;border-collapse:collapse;font-size:0.95rem">' +
          '<thead><tr style="color:#b8a6c9;font-size:0.7rem;letter-spacing:2px">' +
          '<th></th><th style="text-align:left;padding:0 0.8rem 0.4rem">BEAN</th><th style="padding:0 0.9rem 0.4rem">PTS</th>' +
          '<th style="padding:0 0.9rem 0.4rem">REACHED</th><th style="padding:0 0.9rem 0.4rem">FALLS</th></tr></thead>' +
          '<tbody>' + rows + '</tbody></table>' +
          '<div id="eye-endcount" style="margin-top:1.1rem;font-size:0.8rem;color:#b8a6c9;letter-spacing:2px"></div></div>';
        endBoard.style.display = "flex";
        const counter = endBoard.querySelector("#eye-endcount");
        let left = Math.ceil((endsIn || 8000) / 1000);
        const tick = () => {
          counter.textContent = left > 0 ? "RESULTS IN " + left + "s" : "";
          left--;
          if (left < -1) clearInterval(endTimer);
        };
        tick();
        clearInterval(endTimer);
        endTimer = setInterval(tick, 1000);
      },
      update(st) {
        // ---- cinematic layer: bars and titles during the intro, then the race HUD
        const cine = st.intro && st.rt < IT(-700);
        const barH = cine ? "11%" : "0";
        if (barTop.style.height !== barH) { barTop.style.height = barH; barBot.style.height = barH; }
        const chromeOp = cine ? "0" : "1";
        for (const c of [timer, placeEl, cpEl, strip]) {
          if (c.style.opacity !== chromeOp) { c.style.transition = "opacity 500ms"; c.style.opacity = chromeOp; }
        }
        let card = null;
        if (st.intro) for (const c of CARDS) if (st.rt >= c.t0 && st.rt < c.t1) card = c;
        const ck = card ? card.key : "";
        if (ck !== cardKey) {
          cardKey = ck;
          if (card) {
            cardEl.style.top = card.top || "27%";
            cardEl.innerHTML = '<div style="animation:' + card.anim + '">' + card.html + '</div>';
            cardEl.style.opacity = "1";
          } else cardEl.style.opacity = "0";
        }
        const showName = st.intro && st.rt >= -2900 && st.rt < -250 && st.myName;
        const nk = showName ? st.myName + "|" + st.myTeam + "|" + st.myColor : "";
        if (nk !== nameKey) {
          nameKey = nk;
          if (showName) {
            const norli = st.myTeam === "norli";
            nameCard.innerHTML =
              '<div style="animation:eyeSlideIn 650ms cubic-bezier(.2,.9,.3,1) both;transform:skewX(-12deg);background:#2b0f3a;' +
              'border:4px solid #fff6fb;border-left:14px solid ' + (norli ? "#003190" : "#dc2359") + ';border-radius:16px;padding:10px 28px 14px 20px;' +
              'box-shadow:0 7px 0 #12060a,0 0 30px rgba(255,120,40,0.35)">' +
              '<div style="transform:skewX(12deg)">' +
              '<div style="font-size:0.78rem;letter-spacing:6px;font-weight:900;color:#ffb199">YOU ARE</div>' +
              '<div style="font-family:' + FONT + ';font-size:3rem;line-height:1.05;color:' + esc(st.myColor || "#ffd23f") + ';' + OUTLINE + '">' + esc(String(st.myName).toUpperCase()) + '</div>' +
              '<div style="display:flex;align-items:center;gap:10px;margin-top:4px">' +
              '<span style="background:#fff6fb;border-radius:8px;padding:3px 8px;display:inline-flex"><img src="' + ASSETS + (norli ? "norli.svg" : "bookis-logo.png") + '" alt="" style="height:20px"></span>' +
              '<span style="font-family:' + FONT + ';font-size:1.25rem;color:#fff6fb;' + OUTLINE + '">' + (norli ? "NORLI" : "BOOKIS") + ' SOLDIER</span></div>' +
              '</div></div>';
            nameCard.style.opacity = "1";
          } else nameCard.style.opacity = "0";
        }
        const hint = !st.intro && st.rt >= 0 && st.rt < 8000 && !st.winner;
        hintEl.style.opacity = hint ? "1" : "0";

        const secs = Math.max(0, st.phase === "countdown" || st.rt < 0 ? Math.round(course.ROUND_MS / 1000) : st.timeLeft);
        const t = Math.floor(secs / 60) + ":" + String(secs % 60).padStart(2, "0");
        if (timer.textContent !== t) timer.textContent = t;
        timer.style.color = secs <= 30 && st.rt > 0 ? "#ff6a8a" : "#fff";

        const placeHtml = '<span style="font-size:2.6rem;color:#ffd23f">#' + st.place + '</span>' +
          '<span style="font-size:1.1rem"> / ' + st.count + '</span>';
        if (placeEl.innerHTML !== placeHtml) placeEl.innerHTML = placeHtml;
        const cpText = st.cp > 0 ? "CHECKPOINT " + st.cp : "";
        if (cpEl.textContent !== cpText) cpEl.textContent = cpText;

        // 3-2-1-GO
        let count = "";
        if (st.rt < 0 && st.rt >= -3000) count = String(Math.ceil(-st.rt / 1000));
        else if (st.rt >= 0 && st.rt < 650) count = "GO!";
        if (count !== lastCount) {
          centre.textContent = count;
          centre.style.color = count === "GO!" ? "#3fe0ff" : "#ffd23f";
          centre.style.animation = "none";
          void centre.offsetWidth;
          if (count) centre.style.animation = "eyeCount 750ms cubic-bezier(.2,.9,.3,1) both";
          lastCount = count;
        }

        warnEl.style.opacity = st.gazeWarn > 0 && !st.winner ? String(0.55 + 0.45 * st.gazeWarn) : "0";
        burnShown = Math.max(st.burn, burnShown * 0.94);
        burnEl.style.opacity = burnShown.toFixed(2);
        grabEl.style.opacity = "0";
        if (statusEl.textContent) statusEl.textContent = "";

        // held: pulsing pink vignette, shaking headline, struggle meter
        heldEl.style.opacity = st.grabbed ? "1" : "0";
        heldText.style.opacity = st.grabbed ? "1" : "0";
        struggleFlash = Math.max(0, struggleFlash - 0.08);
        if (st.grabbed) {
          const n = Math.min(STRUGGLE_BREAK, st.struggles || 0);
          const key = st.heldBy + "|" + n;
          if (key !== heldKey) {
            heldKey = key;
            let pips = "";
            for (let i = 0; i < STRUGGLE_BREAK; i++) {
              pips += '<span style="display:inline-block;width:34px;height:18px;margin:0 3px;border-radius:9px;border:3px solid #2b0f3a;' +
                'background:' + (i < n ? "#ffd23f" : "rgba(255,246,251,0.35)") + ';box-shadow:0 3px 0 #2b0f3a"></span>';
            }
            heldText.innerHTML =
              '<div style="display:inline-block;animation:eyeShake 0.18s infinite;font-family:' + FONT + ';font-size:3.4rem;color:#ff4fa0;' + OUTLINE + '">HELD BY ' + esc(String(st.heldBy || "SOMEONE").toUpperCase()) + '!</div>' +
              '<div style="margin-top:0.3rem;font-family:' + FONT + ';font-size:1.5rem;color:#fff6fb;' + OUTLINE + '">MASH <span style="color:#ffd23f">SPACE</span> TO BREAK FREE</div>' +
              '<div style="margin-top:0.6rem">' + pips + '</div>';
          }
          heldText.style.transform = "scale(" + (1 + struggleFlash * 0.12).toFixed(3) + ")";
        } else heldKey = "";

        // holding: who, and how long the grip lasts
        holdEl.style.opacity = st.grabbing ? "1" : "0";
        if (st.grabbing) {
          const frac = Math.max(0, Math.min(1, (st.grabLeft || 0) / HOLD_MS));
          const key = st.holding + "|" + frac.toFixed(2);
          if (key !== holdKey) {
            holdKey = key;
            holdEl.innerHTML =
              '<div style="font-family:' + FONT + ';font-size:1.8rem;color:#3fe0ff;' + OUTLINE + '">HOLDING ' + esc(String(st.holding || "").toUpperCase()) + '!</div>' +
              '<div style="margin:6px auto 0;width:260px;height:16px;border:3px solid #fff6fb;border-radius:10px;background:rgba(30,10,40,0.6);box-shadow:0 4px 0 #2b0f3a;overflow:hidden">' +
              '<div style="height:100%;width:' + (frac * 100).toFixed(1) + '%;background:linear-gradient(90deg,#3fe0ff,#ff4fa0)"></div></div>';
          }
        } else holdKey = "";
      },
    };
  }
})();
