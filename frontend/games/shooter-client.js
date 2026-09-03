// Claudeshot Shooter — real-time 3D deathmatch (client side).
//
// Exposes the two globals the platform expects: initShooterClient / cleanupShooterClient.
// three.js is pulled in with a dynamic import INSIDE init (not a module script) so
// game.html keeps its plain <script> tags and the globals exist when game.js calls them.
// The import map in game.html resolves the bare "three" specifier the addons use.
//
// Movement is the standard capsule-vs-octree approach from the three.js FPS example:
// the player is a Capsule, the level is an Octree, and each frame we push the capsule
// out of whatever it intersects. Client-authoritative movement, server-authoritative combat.

(function () {
  "use strict";

  const GRAVITY = 32;
  const JUMP_SPEED = 10.5;
  const ACCEL_GROUND = 32;
  const ACCEL_AIR = 6;
  const SUB_STEPS = 4;
  const PLAYER_RADIUS = 0.35;
  const EYE_HEIGHT = 1.35;
  const FIRE_MS = 115;
  const MAG_SIZE = 30;
  const RELOAD_MS = 1500;
  const SPREAD = 0.0018;      // near pinpoint; the kick provides the challenge
  const RANGE = 140;
  const ASSIST_RADIUS = 0.5;  // forgiveness for the lag between drawn and true positions
  const SEND_MS = 50;
  const LOOK_SENS = 0.0022;
  const SPEED_BUFF = 1.5;
  const PICKUP_REACH = 1.9;
  const CLAIM_COOLDOWN = 400;
  const STAND_SEGMENT = 1.0;      // capsule segment when upright (eye at 1.35)
  const CROUCH_SEGMENT = 0.5;     // and when ducked (eye at 0.85)
  const CROUCH_SPEED = 0.45;      // movement scale while ducked
  const ADS_FOV = 42;
  const HIP_FOV = 78;
  const ADS_SENS = 0.5;           // slower look while sighted
  const ADS_SPREAD = 0.35;
  const ADS_SPEED = 0.65;

  let session = null;

  window.initShooterClient = function (socket, myId, room) {
    if (session) session.dispose();
    session = createSession();
    boot(session, socket, myId, room).catch((err) => {
      console.error("[shooter] failed to start", err);
      const area = document.getElementById("game-area");
      if (area) area.innerHTML = '<p class="waiting-msg">Could not load the 3D engine. Check your connection and refresh.</p>';
    });
  };

  window.cleanupShooterClient = function () {
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

    const [THREE, octreeMod, capsuleMod, geoUtils] = await Promise.all([
      import("three"),
      import("three/addons/math/Octree.js"),
      import("three/addons/math/Capsule.js"),
      import("three/addons/utils/BufferGeometryUtils.js"),
    ]);
    if (s.disposed) return;

    const { Octree } = octreeMod;
    const { Capsule } = capsuleMod;
    const { mergeGeometries } = geoUtils;
    const MAP = window.SHOOTER_MAP;

    // ---------------------------------------------------------------- layout
    // The shell page is built for small canvas games; widen it while we're playing
    // and give the space back on cleanup.
    const pageStyle = document.createElement("style");
    pageStyle.textContent = [
      "body.shooter-active .container{max-width:99vw !important;width:99vw !important;padding:0.4rem !important;}",
      "body.shooter-active .page-center{padding:0 !important;}",
      "body.shooter-active .game-area-card{padding:0.4rem !important;max-width:none !important;}",
      "body.shooter-active .logo,body.shooter-active .tagline{display:none !important;}",
      "body.shooter-active #game-area{width:100%;}",
    ].join("\n");
    document.head.appendChild(pageStyle);
    document.body.classList.add("shooter-active");
    s.cleanups.push(() => {
      document.body.classList.remove("shooter-active");
      pageStyle.remove();
      if (document.fullscreenElement) document.exitFullscreen();
    });

    const area = document.getElementById("game-area");
    area.innerHTML = "";
    const wrap = document.createElement("div");
    wrap.style.cssText = "position:relative;width:100%;margin:0 auto;border-radius:10px;overflow:hidden;" +
      "background:#0b1020;display:flex;align-items:center;justify-content:center;";
    area.appendChild(wrap);

    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.domElement.style.cssText = "display:block;width:100%;height:auto;";
    wrap.appendChild(renderer.domElement);
    s.renderer = renderer;

    const hud = buildHud(wrap);
    s.cleanups.push(() => hud.stopTimers());

    const scene = new THREE.Scene();
    const sky = MAP.skyColor || "#8ec5e8";
    scene.background = new THREE.Color(sky);
    scene.fog = new THREE.Fog(sky, 70, 165);
    wrap.style.background = sky;

    const camera = new THREE.PerspectiveCamera(78, 16 / 9, 0.1, 400);
    camera.rotation.order = "YXZ";

    // The weapon lives in its own scene rendered as a second pass with the depth
    // buffer cleared. That is why it can never clip into a wall you stand against.
    const viewScene = new THREE.Scene();
    const viewCamera = new THREE.PerspectiveCamera(60, 16 / 9, 0.01, 14);
    viewScene.add(new THREE.HemisphereLight(0xffffff, 0x555c70, 1.25));
    const viewSun = new THREE.DirectionalLight(0xfff4e2, 1.15);
    viewSun.position.set(1.2, 2, 1.4);
    viewScene.add(viewSun);
    const gun = buildGun(THREE);
    viewScene.add(gun.group);
    renderer.autoClear = false;

    function resize() {
      const fs = !!document.fullscreenElement;
      let w, h;
      if (fs) {
        // Fill the screen exactly. Letterboxing here used to leave the canvas
        // smaller than the wrapper, and the browser forces a fullscreen element
        // to 100% regardless of our inline size.
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
      if (fs) {
        wrap.style.width = "";
        wrap.style.height = "";
      } else {
        wrap.style.width = w + "px";
        wrap.style.height = h + "px";
      }

      // Pin the HUD to the CANVAS, not the wrapper. An inset:0 overlay centres on
      // the wrapper, so any difference between the two put the crosshair off the
      // true centre of the view - and shots landed away from the crosshair.
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
      viewCamera.aspect = w / h;
      viewCamera.updateProjectionMatrix();
    }
    resize();
    s.on(window, "resize", resize);
    s.on(document, "fullscreenchange", () => setTimeout(resize, 60));

    // outdoor daylight: warm sun, cool sky bounce
    scene.add(new THREE.HemisphereLight(0xdcefff, 0x6a7a5e, 1.0));
    scene.add(new THREE.AmbientLight(0xffffff, 0.25));
    const sun = new THREE.DirectionalLight(0xfff2d8, 1.45);
    sun.position.set(38, 60, 22);
    scene.add(sun);
    const bounce = new THREE.DirectionalLight(0xbcd6ff, 0.35);
    bounce.position.set(-30, 20, -25);
    scene.add(bounce);

    // ----------------------------------------------------------------- world
    // Three overlapping sets, deliberately kept distinct:
    //   collideGroup — what the player capsule is pushed out of (includes glass)
    //   shotMeshes   — what stops a bullet (excludes glass and foliage, and
    //                  exactly matches the boxes the server validates against)
    //   everything is rendered either way
    const collideGroup = new THREE.Group();
    const shotMeshes = [];
    const edgeMat = new THREE.LineBasicMaterial({ color: 0x1b2233, transparent: true, opacity: 0.35 });
    for (const b of MAP.boxes) {
      const geo = new THREE.BoxGeometry(b.size[0], b.size[1], b.size[2]);
      const matOpts = { color: b.color };
      if (b.opacity !== undefined) { matOpts.transparent = true; matOpts.opacity = b.opacity; }
      const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial(matOpts));
      mesh.position.set(b.pos[0], b.pos[1], b.pos[2]);
      if (b.rot) mesh.rotation.set(b.rot[0], b.rot[1], b.rot[2]);   // decor only

      const blocksShots = b.solid !== false;
      const collides = b.collide !== undefined ? b.collide : blocksShots;
      if (collides) collideGroup.add(mesh); else scene.add(mesh);
      if (blocksShots) shotMeshes.push(mesh);

      if (b.edges !== false && Math.max(b.size[0], b.size[1], b.size[2]) >= 3) {
        const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), edgeMat);
        edges.position.copy(mesh.position);
        scene.add(edges);
      }
    }
    scene.add(collideGroup);

    const octree = new Octree().fromGraphNode(collideGroup);

    // shop / room signage, drawn as canvas textures
    for (const sg of MAP.signs || []) {
      const cv = document.createElement("canvas");
      cv.width = 512;
      cv.height = Math.max(64, Math.round(512 * sg.size[1] / sg.size[0]));
      const ctx = cv.getContext("2d");
      ctx.fillStyle = sg.bg;
      ctx.fillRect(0, 0, cv.width, cv.height);
      ctx.strokeStyle = "rgba(255,255,255,0.18)";
      ctx.lineWidth = 8;
      ctx.strokeRect(4, 4, cv.width - 8, cv.height - 8);
      ctx.fillStyle = sg.color;
      ctx.font = "900 " + Math.round(cv.height * 0.58) + "px Nunito, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(sg.text, cv.width / 2, cv.height / 2 + 2);
      const plane = new THREE.Mesh(
        new THREE.PlaneGeometry(sg.size[0], sg.size[1]),
        new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(cv) })
      );
      plane.position.set(sg.pos[0], sg.pos[1], sg.pos[2]);
      plane.rotation.y = sg.rotY || 0;
      scene.add(plane);
    }

    // ---------------------------------------------------------------- player
    const collider = new Capsule(
      new THREE.Vector3(0, PLAYER_RADIUS, 0),
      new THREE.Vector3(0, EYE_HEIGHT, 0),
      PLAYER_RADIUS
    );
    const velocity = new THREE.Vector3();
    const scratchDir = new THREE.Vector3();
    let onFloor = false;

    const keys = Object.create(null);
    let locked = false;
    let alive = true;
    let hp = 100;
    let maxHp = 100;          // replaced by the server's value on shooter-init
    let respawnIn = 0;
    let ammo = MAG_SIZE;
    let reloading = false;
    let firing = false;
    let lastFire = 0;
    let countdown = 0;
    let buffs = { bd: 0, bs: 0, bp: 0 };
    let speedMul = 1;
    let gunPhase = 0;
    let recoil = 0;
    // Aim is held separately from camera.rotation so screen shake can be layered
    // on top without permanently dragging your crosshair off target.
    let aimYaw = 0;
    let aimPitch = 0;
    // Server-assigned identity that survives reconnects. socket.id changes when
    // the connection drops, which used to make the client treat its own player
    // as a stranger and draw a motionless clone of you.
    let myUid = null;
    // recoil as a damped spring rather than random jitter
    let recoilP = 0, recoilVelP = 0, recoilY = 0, recoilVelY = 0, shotParity = 1;
    let crouch = 0;         // 0 upright, 1 fully ducked
    let stuckFor = 0;       // seconds spent trying to move and going nowhere
    const lastPos = new THREE.Vector3();
    let wantCrouch = false;
    let aiming = false;
    let ads = 0;            // 0 hip, 1 sighted
    let inOkr = false;
    let matchOver = false;
    let okrPulse = 0;
    let okrRoll = 0;
    let reloadUntil = 0;
    let flashUntil = 0;
    let timeLeft = 0;
    let snapshotPlayers = [];
    let deathMessage = "";

    function teleport(pos) {
      collider.start.set(pos[0], pos[1] + PLAYER_RADIUS, pos[2]);
      collider.end.set(pos[0], pos[1] + EYE_HEIGHT, pos[2]);
      velocity.set(0, 0, 0);
      camera.position.copy(collider.end);
    }
    // Somewhere harmless until the server tells us where we really are. The
    // origin is the centre of the Norli shop, i.e. inside the middle bookshelf.
    teleport((MAP.spawns && MAP.spawns[0]) || [0, 0, 0]);
    let spawned = false;

    function forwardVector() {
      camera.getWorldDirection(scratchDir);
      scratchDir.y = 0;
      return scratchDir.normalize();
    }
    function sideVector() {
      camera.getWorldDirection(scratchDir);
      scratchDir.y = 0;
      scratchDir.normalize();
      return scratchDir.cross(camera.up);
    }

    // Standing up is refused when there is something overhead, otherwise you
    // could uncrouch inside geometry and get shoved out of the world.
    // Probe ONLY the headroom we would newly occupy - from the crouched height up
    // to the standing height. Testing the whole capsule included the floor, so
    // ground contact flickered the stance and vibrated the camera while running.
    const standTest = new Capsule(new THREE.Vector3(), new THREE.Vector3(), PLAYER_RADIUS * 0.9);
    function canStand() {
      standTest.start.set(collider.start.x, collider.start.y + CROUCH_SEGMENT + 0.05, collider.start.z);
      standTest.end.set(collider.start.x, collider.start.y + STAND_SEGMENT, collider.start.z);
      return !octree.capsuleIntersect(standTest);
    }

    function updateStance(dt) {
      // only pay for the headroom probe when actually trying to stand up
      const target = wantCrouch ? 1 : (crouch > 0.01 && !canStand() ? 1 : 0);
      crouch += (target - crouch) * (1 - Math.exp(-14 * dt));
      if (crouch < 0.002) crouch = 0;
      if (crouch > 0.998) crouch = 1;
      collider.end.y = collider.start.y + STAND_SEGMENT - (STAND_SEGMENT - CROUCH_SEGMENT) * crouch;
    }

    function applyInput(dt) {
      if (!alive || countdown > 0 || matchOver) return;
      const stance = (1 - crouch * (1 - CROUCH_SPEED)) * (1 - ads * (1 - ADS_SPEED));
      const accel = dt * (onFloor ? ACCEL_GROUND : ACCEL_AIR) * speedMul * stance;
      if (keys.KeyW || keys.ArrowUp) velocity.add(forwardVector().multiplyScalar(accel));
      if (keys.KeyS || keys.ArrowDown) velocity.add(forwardVector().multiplyScalar(-accel));
      if (keys.KeyA || keys.ArrowLeft) velocity.add(sideVector().multiplyScalar(-accel));
      if (keys.KeyD || keys.ArrowRight) velocity.add(sideVector().multiplyScalar(accel));
      if (onFloor && keys.Space && crouch < 0.5) velocity.y = JUMP_SPEED;   // no jumping while ducked
    }

    function collide() {
      const result = octree.capsuleIntersect(collider);
      onFloor = false;
      if (!result) return;
      onFloor = result.normal.y > 0;
      if (!onFloor) velocity.addScaledVector(result.normal, -result.normal.dot(velocity));
      if (result.depth >= 1e-10) collider.translate(result.normal.multiplyScalar(result.depth));
    }

    const stepMove = new THREE.Vector3();
    function stepPlayer(dt) {
      let damping = Math.exp(-4 * dt) - 1;
      if (!onFloor) {
        velocity.y -= GRAVITY * dt;
        damping *= 0.12;
      }
      velocity.addScaledVector(velocity, damping);
      stepMove.copy(velocity).multiplyScalar(dt);
      collider.translate(stepMove);
      collide();
      camera.position.copy(collider.end);
      // safety net: if anything ever punts us out of the arena, drop back in
      if (Math.abs(camera.position.x) > MAP.half + 5 || Math.abs(camera.position.z) > MAP.half + 5 || camera.position.y < -10) {
        teleport(MAP.spawns[0]);
      }
    }

    // -------------------------------------------------------------- avatars
    // Identity check: prefer the stable uid, fall back to socket id only until
    // the server has told us our uid.
    function isMe(p) {
      return myUid ? p.uid === myUid : p.id === s.socket.id;
    }

    const avatars = new Map(); // uid -> { group, label, meshes, bar, target }
    const camRight = new THREE.Vector3();
    const losRay = new THREE.Raycaster();
    const losFrom = new THREE.Vector3();
    const losDir = new THREE.Vector3();

    function hasLineOfSight(pos) {
      losFrom.set(pos.x, pos.y + 0.9, pos.z);          // aim at the chest
      losDir.copy(losFrom).sub(camera.position);
      const range = losDir.length();
      if (range < 1.2) return true;
      losRay.set(camera.position, losDir.normalize());
      losRay.far = range - 0.45;                        // stop short of the body
      return losRay.intersectObjects(shotMeshes, false).length === 0;
    }

    function makeLabel(name, color) {
      const cv = document.createElement("canvas");
      cv.width = 256; cv.height = 64;
      const ctx = cv.getContext("2d");
      ctx.font = "bold 34px Nunito, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.lineWidth = 6;
      ctx.strokeStyle = "rgba(5,8,18,0.9)";
      ctx.strokeText(name, 128, 34);
      ctx.fillStyle = color;
      ctx.fillText(name, 128, 34);
      const tex = new THREE.CanvasTexture(cv);
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }));
      sprite.scale.set(2.4, 0.6, 1);
      sprite.position.y = 2.25;
      sprite.renderOrder = 10;
      return sprite;
    }

    function makeAvatar(p) {
      const group = new THREE.Group();
      const mat = new THREE.MeshLambertMaterial({ color: p.color });
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.16, 0.62), mat);
      body.position.y = 0.6;
      body.userData = { uid: p.uid, part: "body" };
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.58, 0.58), mat);
      head.position.y = 1.36;
      head.userData = { uid: p.uid, part: "head" };
      const visor = new THREE.Mesh(
        new THREE.BoxGeometry(0.4, 0.14, 0.06),
        new THREE.MeshBasicMaterial({ color: 0x0b1020 })
      );
      visor.position.set(0, 1.38, -0.28);
      const gun = new THREE.Mesh(
        new THREE.BoxGeometry(0.14, 0.14, 0.8),
        new THREE.MeshLambertMaterial({ color: 0x2b3350 })
      );
      gun.position.set(0.3, 0.95, -0.4);
      const label = makeLabel(p.name, p.color);
      group.add(body, head, visor, gun, label);
      scene.add(group);

      // Health bar lives in world space, not inside the avatar group: sprites
      // always face the camera, so parenting it to a rotating body would swing
      // the fill offset around as the player turned.
      const bg = new THREE.Sprite(new THREE.SpriteMaterial({
        color: 0x0d1220, transparent: true, opacity: 0.8 }));
      bg.scale.set(1.34, 0.17, 1);
      const fill = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0x4ecca3 }));
      fill.scale.set(1.26, 0.11, 1);
      scene.add(bg, fill);

      return {
        group,
        label,
        meshes: [body, head],
        bar: { bg, fill, w: 1.26 },
        target: new THREE.Vector3(p.p ? p.p[0] : 0, p.p ? p.p[1] : 0, p.p ? p.p[2] : 0),
        yaw: 0,
        fresh: true,
      };
    }

    function updateAvatars(dt) {
      const seen = new Set();
      for (const p of snapshotPlayers) {
        const key = p.uid || p.id;
        if (isMe(p)) continue;
        seen.add(key);
        let a = avatars.get(key);
        if (!a) { a = makeAvatar(p); avatars.set(key, a); }
        a.target.set(p.p[0], p.p[1], p.p[2]);
        a.yaw = p.r[0];
        const duck = p.c || 0;
        a.group.scale.y = 1 - 0.36 * duck;
        a.group.visible = p.alive;
        // exponential smoothing towards the last snapshot — no prediction needed
        const k = 1 - Math.exp(-16 * dt);
        if (a.fresh) {
          // snap on the first frame, otherwise a joining player visibly slides
          // in from the world origin
          a.group.position.copy(a.target);
          a.group.rotation.y = a.yaw;
          a.fresh = false;
        }
        a.group.position.lerp(a.target, k);

        // health bar, offset along the camera's right so it drains screen-left
        const bar = a.bar;
        const visibleToMe = p.alive && hasLineOfSight(a.group.position);
        a.label.visible = visibleToMe;
        bar.bg.visible = bar.fill.visible = visibleToMe;
        if (visibleToMe) {
          const frac = Math.max(0, Math.min(1, p.hp / maxHp));
          const bx = a.group.position.x;
          const by = a.group.position.y + 2.06 - 0.62 * (p.c || 0);
          const bz = a.group.position.z;
          bar.bg.position.set(bx, by, bz);
          bar.fill.scale.x = Math.max(0.001, bar.w * frac);
          camera.getWorldDirection(scratchDir);
          camRight.crossVectors(scratchDir, camera.up).normalize();
          bar.fill.position.set(bx, by, bz).addScaledVector(camRight, -(bar.w * (1 - frac)) / 2);
          bar.fill.material.color.setHex(frac > 0.6 ? 0x4ecca3 : frac > 0.25 ? 0xf7c948 : 0xe94560);
        }
        let dy = a.yaw - a.group.rotation.y;
        while (dy > Math.PI) dy -= Math.PI * 2;
        while (dy < -Math.PI) dy += Math.PI * 2;
        a.group.rotation.y += dy * k;
      }
      for (const [id, a] of avatars) {
        if (seen.has(id)) continue;
        scene.remove(a.group);
        scene.remove(a.bar.bg);
        scene.remove(a.bar.fill);
        avatars.delete(id);
      }
    }

    // -------------------------------------------------------------- 3D logos
    // Real geometry built from the logo artwork in assets/*-logo.json: every
    // rectangle becomes an extruded box, merged per colour into a single mesh.
    const BRAND = MAP.brand || { name: "LOGO", color: "#c52c4c", accent: "#ffffff" };
    const spinners = [];
    const logoTargets = new Map();
    const targetMeshes = [];

    function buildLogoModel(data, height, depth) {
      const [gw, gh] = data.grid;
      const unit = height / gh;
      const group = new THREE.Group();
      data.colors.forEach((hex, ci) => {
        const parts = [];
        for (const r of data.rects) {
          if (r[4] !== ci) continue;
          const g = new THREE.BoxGeometry(r[2] * unit, r[3] * unit, depth);
          // image space is y-down; flip it and centre the model on its own origin
          g.translate((r[0] + r[2] / 2 - gw / 2) * unit, -(r[1] + r[3] / 2 - gh / 2) * unit, 0);
          parts.push(g);
        }
        if (!parts.length) return;
        const merged = mergeGeometries(parts, false);
        parts.forEach((g) => g.dispose());
        group.add(new THREE.Mesh(merged, new THREE.MeshLambertMaterial({ color: hex })));
      });
      return group;
    }

    for (const m of MAP.models || []) {
      fetch(m.file)
        .then((r) => r.json())
        .then((data) => {
          if (s.disposed) return;
          const model = buildLogoModel(data, m.height, m.depth);
          model.position.set(m.pos[0], m.pos[1], m.pos[2]);
          model.rotation.y = m.rotY || 0;
          model.rotation.z = m.rotZ || 0;      // ARK's sign hangs askew
          scene.add(model);

          let ring = null;
          if (m.ring) {
            const span = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());
            ring = new THREE.Mesh(
              new THREE.TorusGeometry(span.x / 2 + 0.7, 0.08, 8, 32),
              new THREE.MeshBasicMaterial({ color: BRAND.color, transparent: true, opacity: 0.7 })
            );
            ring.rotation.x = Math.PI / 2;
            ring.position.copy(model.position);
            scene.add(ring);
            const glow = new THREE.PointLight(new THREE.Color(BRAND.color), 1.5, 24);
            glow.position.copy(model.position);
            scene.add(glow);
          }
          if (m.spin || ring) spinners.push({ mesh: model, ring, baseY: m.pos[1], spin: m.spin || 0 });

          if (m.target) {
            model.traverse((o) => { if (o.isMesh) { o.userData.targetId = m.target.id; targetMeshes.push(o); } });
            logoTargets.set(m.target.id, { model, ring, pos: m.pos.slice(), broken: false });
          }
        })
        .catch((err) => console.warn("[shooter] logo model failed to load", m.file, err));
    }

    // ---- world lights, some of which refuse to stay on ---------------------
    const flickers = [];
    for (const L of MAP.lights || []) {
      const light = new THREE.PointLight(new THREE.Color(L.color), L.intensity, L.distance || 18, 2);
      light.position.set(L.pos[0], L.pos[1], L.pos[2]);
      scene.add(light);
      if (L.flicker) flickers.push({ light, base: L.intensity, next: 0, on: true });
    }

    function updateLights(now) {
      for (const f of flickers) {
        if (now < f.next) continue;
        // irregular on/off with the occasional long dead spell
        f.on = Math.random() > (f.on ? 0.25 : 0.55);
        f.light.intensity = f.on ? f.base * (0.65 + Math.random() * 0.5) : f.base * 0.05;
        f.next = now + (f.on ? 60 + Math.random() * 500 : 40 + Math.random() * 260);
      }
    }

    // ---- stock still orbiting where the roof came down ---------------------
    const rings = [];
    const BOOK_COLORS = [0xc94f4f, 0x3f7fbf, 0xe0a53f, 0x4f9c58, 0xe8ecf3];
    for (const fx of MAP.effects || []) {
      if (fx.type !== "bookRing") continue;
      const group = new THREE.Group();
      group.position.set(fx.pos[0], fx.pos[1], fx.pos[2]);
      group.rotation.x = fx.tilt || 0;
      const palette = fx.colors || BOOK_COLORS;
      for (let i = 0; i < fx.count; i++) {
        const ang = (i / fx.count) * Math.PI * 2;
        const book = new THREE.Mesh(
          new THREE.BoxGeometry(0.42, 0.02, 0.3),
          new THREE.MeshLambertMaterial({
            color: palette[i % palette.length],
            side: THREE.DoubleSide,
          })
        );
        book.position.set(Math.cos(ang) * fx.radius, Math.sin(i * 1.7) * 0.35, Math.sin(ang) * fx.radius);
        book.rotation.set(i * 0.7, -ang, i * 0.4);
        group.add(book);
      }
      scene.add(group);
      rings.push({ group, spin: fx.spin, baseY: fx.pos[1], phase: Math.random() * 6 });
    }

    // ---- smoke: slabs drifting up and fading, recycled at the bottom --------
    const smokes = [];
    for (const fx of MAP.effects || []) {
      if (fx.type !== "smoke") continue;
      const group = new THREE.Group();
      group.position.set(fx.pos[0], fx.pos[1], fx.pos[2]);
      const puffs = [];
      for (let i = 0; i < fx.count; i++) {
        const puff = new THREE.Mesh(
          new THREE.PlaneGeometry(1.6 + Math.random() * 1.4, 1.6 + Math.random() * 1.4),
          new THREE.MeshBasicMaterial({
            color: 0x2a2724, transparent: true, opacity: 0.3, depthWrite: false, side: THREE.DoubleSide,
          })
        );
        const a = Math.random() * Math.PI * 2;
        const r = Math.random() * fx.radius;
        puff.position.set(Math.cos(a) * r, Math.random() * fx.rise, Math.sin(a) * r);
        puff.rotation.z = Math.random() * Math.PI;
        group.add(puff);
        puffs.push({ mesh: puff, speed: 0.35 + Math.random() * 0.5, drift: (Math.random() - 0.5) * 0.25 });
      }
      scene.add(group);
      smokes.push({ group, puffs, rise: fx.rise, spin: fx.spin || 0, radius: fx.radius });
    }

    function updateSmoke(dt) {
      for (const sm of smokes) {
        sm.group.rotation.y += dt * sm.spin;
        for (const p of sm.puffs) {
          const m = p.mesh;
          m.position.y += p.speed * dt;
          m.position.x += p.drift * dt;
          m.rotation.z += dt * 0.25;
          const t = m.position.y / sm.rise;
          m.material.opacity = 0.34 * Math.max(0, 1 - t) * Math.min(1, t * 4);
          m.scale.setScalar(0.6 + t * 1.5);
          if (m.position.y > sm.rise) {              // recycle at the base
            const a = Math.random() * Math.PI * 2;
            const r = Math.random() * sm.radius;
            m.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
          }
          m.lookAt(camera.position);                 // always face the viewer
        }
      }
    }

    function updateRings(dt, now) {
      for (const r of rings) {
        r.group.rotation.y += dt * r.spin;
        r.group.position.y = r.baseY + Math.sin(now / 1400 + r.phase) * 0.3;
      }
    }

    function updateModels(dt) {
      const bob = Math.sin(performance.now() / 900) * 0.16;
      for (const sp of spinners) {
        if (sp.spin) {
          sp.mesh.rotation.y += dt * sp.spin;
          sp.mesh.position.y = sp.baseY + bob;
        }
        if (sp.ring) {
          sp.ring.rotation.z -= dt * 0.9;
          sp.ring.position.y = sp.baseY + bob * 0.5;
        }
      }
    }

    // --------------------------------------------------------------- pickups
    const PICKUP_STYLE = {
      health: { color: 0x4ecca3, label: "+65 HEALTH",     short: "HP" },
      damage: { color: 0xff7a3d, label: "2\u00d7 DAMAGE",    short: "2\u00d7 DMG" },
      speed:  { color: 0x5dade2, label: "SPEED BOOST",    short: "SPEED" },
      shield: { color: 0xb58cff, label: "SHIELD \u00b7 HALF DAMAGE", short: "SHIELD" },
    };

    function buildPickupIcon(type) {
      const style = PICKUP_STYLE[type] || PICKUP_STYLE.health;
      const mat = new THREE.MeshLambertMaterial({ color: style.color, emissive: style.color, emissiveIntensity: 0.35 });
      const icon = new THREE.Group();
      if (type === "health") {
        icon.add(new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.2, 0.2), mat));
        icon.add(new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.62, 0.2), mat));
      } else if (type === "ammo") {
        icon.add(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.36, 0.36), mat));
        const band = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.1, 0.4), new THREE.MeshLambertMaterial({ color: 0x2b3245 }));
        icon.add(band);
      } else if (type === "damage") {
        icon.add(new THREE.Mesh(new THREE.OctahedronGeometry(0.38), mat));
      } else if (type === "shield") {
        const plate = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.6, 0.12), mat);
        icon.add(plate);
        const rim = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.14, 0.18),
          new THREE.MeshLambertMaterial({ color: 0xffffff }));
        rim.position.y = 0.2;
        icon.add(rim);
      } else {
        const cone = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.6, 6), mat);
        icon.add(cone);
      }
      return icon;
    }

    const pickupObjs = new Map();
    for (const pk of MAP.pickups || []) {
      const style = PICKUP_STYLE[pk.type] || PICKUP_STYLE.health;
      const group = new THREE.Group();
      group.position.set(pk.pos[0], pk.pos[1], pk.pos[2]);
      const icon = buildPickupIcon(pk.type);
      group.add(icon);
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(0.75, 0.05, 6, 20),
        new THREE.MeshBasicMaterial({ color: style.color, transparent: true, opacity: 0.75 })
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = -pk.pos[1] + 0.06;
      group.add(ring);
      const glow = new THREE.Mesh(
        new THREE.CylinderGeometry(0.55, 0.55, 1.6, 10, 1, true),
        new THREE.MeshBasicMaterial({ color: style.color, transparent: true, opacity: 0.12, side: THREE.DoubleSide })
      );
      glow.position.y = 0.2;
      group.add(glow);
      // short name floating above, so you can read what a pickup is at a glance
      const tag = makeLabel(style.short, "#" + style.color.toString(16).padStart(6, "0"));
      tag.scale.set(1.35, 0.34, 1);
      tag.position.y = 0.95;
      group.add(tag);
      scene.add(group);
      pickupObjs.set(pk.id, { group, icon, type: pk.type, pos: pk.pos, lastClaim: 0 });
    }

    let activePickups = new Set((MAP.pickups || []).map((pk) => pk.id));

    function updatePickups(dt) {
      const now = performance.now();
      for (const [id, o] of pickupObjs) {
        const on = activePickups.has(id);
        o.group.visible = on;
        if (!on) continue;
        o.icon.rotation.y += dt * 1.6;
        o.icon.position.y = Math.sin(now / 420) * 0.14;
        if (!alive || countdown > 0) continue;
        const feetY = collider.start.y - PLAYER_RADIUS;
        const dx = camera.position.x - o.pos[0];
        const dy = feetY - o.pos[1];
        const dz = camera.position.z - o.pos[2];
        if (Math.sqrt(dx * dx + dy * dy + dz * dz) > PICKUP_REACH + 0.9) continue;
        if (now - o.lastClaim < CLAIM_COOLDOWN) continue;
        o.lastClaim = now;
        s.socket.emit("shooter-input", { t: "pickup", id });
      }
    }

    // -------------------------------------------------------------- shooting
    const raycaster = new THREE.Raycaster();
    raycaster.far = RANGE;
    const aimDir = new THREE.Vector3();
    const assistTarget = new THREE.Vector3();
    const assistDelta = new THREE.Vector3();
    const effects = [];
    const muzzleLight = new THREE.PointLight(0xffc879, 0, 15, 2);
    scene.add(muzzleLight);

    function addEffect(obj, ms) {
      scene.add(obj);
      effects.push({ obj, until: performance.now() + ms });
    }

    function updateEffects() {
      const now = performance.now();
      for (let i = effects.length - 1; i >= 0; i--) {
        if (now < effects[i].until) continue;
        scene.remove(effects[i].obj);
        effects[i].obj.geometry?.dispose();
        effects.splice(i, 1);
      }
    }

    function tracer(from, to) {
      const geo = new THREE.BufferGeometry().setFromPoints([from.clone(), to.clone()]);
      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xf7c948, transparent: true, opacity: 0.8 }));
      addEffect(line, 70);
    }

    const impactGeo = new THREE.SphereGeometry(0.09, 6, 5);
    const impactMat = new THREE.MeshBasicMaterial({ color: 0xffd873 });
    function impact(point) {
      const dot = new THREE.Mesh(impactGeo, impactMat);
      dot.position.copy(point);
      addEffect(dot, 160);
    }

    function reload() {
      if (reloading || ammo === MAG_SIZE) return;
      reloading = true;
      reloadUntil = performance.now() + RELOAD_MS;
      s.timeouts.push(setTimeout(() => {
        ammo = MAG_SIZE;
        reloading = false;
      }, RELOAD_MS));
    }

    function fire() {
      if (!locked || !alive || countdown > 0 || reloading || matchOver) return;
      const now = performance.now();
      if (now - lastFire < FIRE_MS) return;
      if (ammo <= 0) { reload(); return; }
      lastFire = now;
      ammo--;

      camera.getWorldDirection(aimDir);
      const spread = SPREAD * (inOkr ? 0.02 : 1) * (1 - ads * (1 - ADS_SPREAD));   // OKR = laser
      aimDir.x += (Math.random() - 0.5) * spread;
      aimDir.y += (Math.random() - 0.5) * spread;
      aimDir.z += (Math.random() - 0.5) * spread;
      aimDir.normalize();
      raycaster.set(camera.position, aimDir);

      const targets = shotMeshes.slice();
      for (const m of targetMeshes) if (m.visible && m.parent && m.parent.visible) targets.push(m);
      for (const [, a] of avatars) if (a.group.visible) targets.push(...a.meshes);
      const hits = raycaster.intersectObjects(targets, false);
      const hit = hits[0];
      const end = hit ? hit.point : camera.position.clone().addScaledVector(aimDir, RANGE);

      // start the tracer at the barrel, not the eye, so it reads as coming from the gun
      const right = new THREE.Vector3().crossVectors(aimDir, camera.up).normalize();
      const muzzle = camera.position.clone()
        .addScaledVector(aimDir, 1.0)
        .addScaledVector(right, 0.17)
        .addScaledVector(camera.up, -0.13);
      tracer(muzzle, end);
      const steady = inOkr ? 0.15 : 1;                    // clear visions: almost no kick
      recoil = Math.min(1.4, recoil + 0.62 * steady);
      recoilVelP += 0.8 * steady;                         // kick the view up
      recoilVelY += 0.1 * shotParity * steady;            // and slightly aside
      shotParity = -shotParity;
      flashUntil = performance.now() + 55;
      muzzleLight.position.copy(muzzle);
      muzzleLight.intensity = 5;
      const limit = Math.PI / 2 * 0.95;
      aimPitch = Math.min(limit, aimPitch + 0.0025 * steady);   // a touch of muzzle climb

      if (hit) impact(hit.point);

      const targetId = hit && hit.object.userData.targetId;
      if (targetId) {
        hud.markHit(false);
        s.socket.emit("shooter-input", { t: "target", id: targetId });
        return;
      }

      let victim = hit && hit.object.userData.uid;
      let part = hit && hit.object.userData.part;

      // Aim assist. Remote players are drawn slightly behind their true position
      // (snapshots arrive at 20Hz and are smoothed), so a shot that looks like a
      // clean hit can sail past the box. Accept a near miss down the ray, as long
      // as nothing solid is closer.
      if (!victim) {
        const worldDist = hit ? hit.distance : RANGE;
        let best = null;
        for (const [uid, a] of avatars) {
          if (!a.group.visible) continue;
          assistTarget.set(a.group.position.x, a.group.position.y + 0.75, a.group.position.z);
          assistDelta.copy(assistTarget).sub(camera.position);
          const along = assistDelta.dot(aimDir);
          if (along <= 0.6 || along >= worldDist) continue;      // behind us, or behind cover
          const perp = Math.sqrt(Math.max(0, assistDelta.lengthSq() - along * along));
          if (perp > ASSIST_RADIUS) continue;
          if (!best || along < best.along) best = { uid, along };
        }
        if (best) { victim = best.uid; part = "body"; }
      }

      if (victim) {
        hud.markHit(part === "head");
        s.socket.emit("shooter-input", { t: "hit", victim, part });
      }
    }

    // ----------------------------------------------------------------- input
    s.on(document, "keydown", (e) => {
      keys[e.code] = true;
      if (e.code === "ShiftLeft" || e.code === "ShiftRight" ||
          e.code === "ControlLeft" || e.code === "ControlRight") wantCrouch = true;
      if (e.code === "KeyR") reload();
      if (e.code === "KeyU" && alive && !matchOver) {      // manual escape hatch
        teleport(nearestSpawn(camera.position));
        stuckFor = 0;
        hud.toast("UNSTUCK", "#f7c948");
      }
      if (e.code === "KeyF") {
        if (document.fullscreenElement) document.exitFullscreen();
        else wrap.requestFullscreen?.().then(() => renderer.domElement.requestPointerLock()).catch(() => {});
      }
      if (locked && (e.code === "Space" || e.code.startsWith("Arrow"))) e.preventDefault();
    });
    s.on(document, "keyup", (e) => {
      keys[e.code] = false;
      if (!(keys.ShiftLeft || keys.ShiftRight || keys.ControlLeft || keys.ControlRight)) wantCrouch = false;
    });
    s.on(document, "mousemove", (e) => {
      if (!locked) return;
      const sens = LOOK_SENS * (1 - ads * (1 - ADS_SENS));
      aimYaw -= e.movementX * sens;
      aimPitch -= e.movementY * sens;
      const limit = Math.PI / 2 * 0.98;
      aimPitch = Math.max(-limit, Math.min(limit, aimPitch));
    });
    s.on(document, "mousedown", (e) => {
      if (!locked) return;
      if (e.button === 0) firing = true;
      if (e.button === 2) aiming = true;
    });
    s.on(document, "mouseup", (e) => {
      if (e.button === 2) aiming = false;
      else firing = false;
    });
    s.on(document, "pointerlockchange", () => {
      locked = document.pointerLockElement === renderer.domElement;
      if (!locked) {
        firing = false;
        aiming = false;
        wantCrouch = false;
        for (const k in keys) keys[k] = false;
      }
      hud.setLocked(locked);
    });
    s.on(hud.lockOverlay, "click", () => renderer.domElement.requestPointerLock());
    s.on(renderer.domElement, "click", () => { if (!locked) renderer.domElement.requestPointerLock(); });
    s.on(renderer.domElement, "contextmenu", (e) => e.preventDefault());

    // -------------------------------------------------------------- network
    s.sock("shooter-init", (data) => {
      hud.setMap(data.map);
      if (data.maxHp) maxHp = data.maxHp;
    });

    s.sock("shooter-you", ({ uid }) => { myUid = uid; });

    s.sock("shooter-over", ({ table, endsIn }) => {
      matchOver = true;
      firing = false;
      aiming = false;
      if (document.pointerLockElement) document.exitPointerLock();
      hud.endScreen(table, myUid, endsIn);
    });

    s.sock("shooter-spawn", ({ pos, hp: newHp }) => {
      spawned = true;
      teleport(pos);
      hp = newHp;
      alive = true;
      ammo = MAG_SIZE;
      reloading = false;
      deathMessage = "";
    });

    s.sock("shooter-state", (state) => {
      snapshotPlayers = state.players;
      countdown = state.countdown;
      timeLeft = state.timeLeft;
      activePickups = new Set(state.pickups || []);
      if (state.targets) {
        const up = new Set(state.targets);
        for (const [id, t] of logoTargets) {
          const shouldShow = up.has(id);
          if (t.model.visible !== shouldShow) {
            t.model.visible = shouldShow;
            if (t.ring) t.ring.visible = shouldShow;
          }
        }
      }
      const me = state.players.find(isMe);
      if (me) {
        if (me.hp > hp && alive) hud.healTick(me.hp - hp);   // visible OKR regen
        hp = me.hp;
        if (alive && !me.alive) firing = false;
        alive = me.alive;
        if (!spawned && me.alive && Array.isArray(me.p)) {
          spawned = true;
          teleport(me.p);
        }
        respawnIn = me.rs || 0;
        buffs = { bd: me.bd || 0, bs: me.bs || 0, bp: me.bp || 0 };
        speedMul = buffs.bs > 0 ? SPEED_BUFF : 1;
        const nowOkr = !!me.ok;
        if (nowOkr && !inOkr) {
          okrPulse = 1;
          hud.okrBanner("OKR: CLEAR VISIONS ACTIVATED", "Healing \u00b7 Steady aim");
        }
        inOkr = nowOkr;
      }
      hud.setScores(state.players, myUid, s.socket.id);
    });

    s.sock("shooter-damaged", ({ from, hp: newHp }) => {
      hp = newHp;
      hud.flashDamage(from);
    });

    s.sock("shooter-target", ({ id, by, byUid, points, broken }) => {
      const t = logoTargets.get(id);
      if (!t) return;
      t.broken = !!broken;
      t.model.visible = !broken;
      if (t.ring) t.ring.visible = !broken;
      if (!broken) return;

      // debris burst where the sign was
      for (let i = 0; i < 14; i++) {
        const piece = new THREE.Mesh(
          new THREE.BoxGeometry(0.18 + Math.random() * 0.2, 0.14, 0.1),
          new THREE.MeshLambertMaterial({ color: i % 2 ? 0xc52c4c : 0xf36000 })
        );
        piece.position.set(
          t.pos[0] + (Math.random() - 0.5) * 1.6,
          t.pos[1] + (Math.random() - 0.5) * 1.2,
          t.pos[2] + (Math.random() - 0.5) * 1.6
        );
        piece.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
        addEffect(piece, 900);
      }
      hud.addSignFeed(by, id);
      if (byUid === myUid) hud.toast("SIGN SMASHED", "#f36000");
    });

    s.sock("shooter-target-hit", () => { hud.markHit(false); });

    s.sock("shooter-pickup", ({ id, type, byId, byUid }) => {
      activePickups.delete(id);
      if (!(byUid ? byUid === myUid : byId === s.socket.id)) return;
      const style = PICKUP_STYLE[type];
      hud.toast(style ? style.label : "PICKED UP", style ? "#" + style.color.toString(16).padStart(6, "0") : "#f7c948");
    });

    s.sock("shooter-kill", ({ killer, victim, victimId, victimUid, headshot }) => {
      hud.addFeed(killer, victim, headshot);
      const wasMe = victimUid ? victimUid === myUid : victimId === s.socket.id;
      if (wasMe) deathMessage = "Fragged by " + killer;
    });

    s.socket.emit("shooter-input", { t: "ready" });

    const sendTimer = setInterval(() => {
      if (s.disposed || !spawned) return;   // never report the pre-spawn position
      s.socket.emit("shooter-input", {
        t: "state",
        p: [collider.start.x, collider.start.y - PLAYER_RADIUS, collider.start.z],
        r: [aimYaw, aimPitch],
        c: Math.round(crouch * 100) / 100,
      });
    }, SEND_MS);
    s.intervals.push(sendTimer);

    // ---- last resort: get the player out of anything that traps them --------
    // Collision against a mesh can wedge a capsule in ways the map checks do not
    // predict. Rather than rely on having found every one, notice when someone is
    // asking to move and going nowhere, and put them back in play.
    function nearestSpawn(from) {
      let best = MAP.spawns[0];
      let bestD = Infinity;
      for (const sp of MAP.spawns) {
        const d = (sp[0] - from.x) ** 2 + (sp[2] - from.z) ** 2;
        if (d < bestD) { bestD = d; best = sp; }
      }
      return best;
    }

    function checkStuck(dt) {
      if (!alive || matchOver || countdown > 0 || !locked) { stuckFor = 0; return; }
      const wantsToMove = keys.KeyW || keys.KeyS || keys.KeyA || keys.KeyD ||
        keys.ArrowUp || keys.ArrowDown || keys.ArrowLeft || keys.ArrowRight;
      if (!wantsToMove) { stuckFor = 0; lastPos.copy(camera.position); return; }

      if (camera.position.distanceToSquared(lastPos) > 0.5 * 0.5) {
        stuckFor = 0;
        lastPos.copy(camera.position);
        return;
      }
      stuckFor += dt;
      if (stuckFor > 4) {
        stuckFor = 0;
        teleport(nearestSpawn(camera.position));
        lastPos.copy(camera.position);
        hud.toast("UNSTUCK", "#f7c948");
      }
    }

    // ------------------------------------------------------- weapon animation
    const GUN_BASE = gun.base;
    const GUN_ADS = { x: 0.27, y: -0.27, z: -0.5 };   // held clear of the centre, never over it
    function updateGun(dt) {
      gun.group.visible = alive && countdown === 0;
      const now = performance.now();
      const moving = onFloor && Math.hypot(velocity.x, velocity.z) > 1.2;
      gunPhase += dt * (moving ? 9 : 2.4);
      const amp = (moving ? 0.014 : 0.004) * (1 - ads * 0.85);   // steadier when sighted
      recoil = Math.max(0, recoil - dt * 6);
      // reload: swing the weapon down and back up over RELOAD_MS
      const remain = reloading ? Math.max(0, (reloadUntil - now) / RELOAD_MS) : 0;
      const tilt = reloading ? Math.sin(Math.PI * (1 - remain)) * 0.85 : 0;
      // slide the weapon into the sight line as you aim down it
      const bx = GUN_BASE.x + (GUN_ADS.x - GUN_BASE.x) * ads;
      const by = GUN_BASE.y + (GUN_ADS.y - GUN_BASE.y) * ads;
      const bz = GUN_BASE.z + (GUN_ADS.z - GUN_BASE.z) * ads;
      gun.group.position.set(
        bx + Math.sin(gunPhase) * amp,
        by + Math.abs(Math.cos(gunPhase)) * amp * 0.8 - tilt * 0.13,
        bz + recoil * 0.1
      );
      gun.group.rotation.set(-recoil * 0.32 + tilt, (0.05 + tilt * 0.45) * (1 - ads), tilt * 0.3);
      gun.flash.visible = now < flashUntil;
      if (gun.flash.visible) gun.flash.rotation.z = Math.random() * Math.PI;
    }

    // ------------------------------------------------------------------ loop
    const clock = new THREE.Clock();
    function animate() {
      s.raf = requestAnimationFrame(animate);
      const dt = Math.min(0.05, clock.getDelta());

      // Camera orientation = aim + decaying shake. Squaring the shake makes it
      // snap hard on the shot and settle quickly rather than wobbling on.
      // Recoil is a damped spring: a firm kick up, then a settle back down along
      // the same axis, with a small alternating sideways component. The previous
      // version jittered randomly on all three axes every frame, which read as
      // chaotic shaking rather than a weapon kicking.
      const SPRING = 62, DAMP = 10.5;
      recoilVelP += (-SPRING * recoilP - DAMP * recoilVelP) * dt;
      recoilP += recoilVelP * dt;
      recoilVelY += (-SPRING * 0.55 * recoilY - DAMP * recoilVelY) * dt;
      recoilY += recoilVelY * dt;

      okrPulse = Math.max(0, okrPulse - dt * 0.5);
      const targetRoll = inOkr ? Math.sin(performance.now() / 620) * 0.045 : 0;
      okrRoll += (targetRoll - okrRoll) * Math.min(1, dt * 3);
      camera.rotation.y = aimYaw + recoilY;
      camera.rotation.x = aimPitch + recoilP;
      camera.rotation.z = okrRoll + okrPulse * Math.sin(okrPulse * 14) * 0.12 - recoilY * 0.4;
      // lens push while the OKR effect plays, and a gentle widen while inside
      const baseFov = HIP_FOV + (ADS_FOV - HIP_FOV) * ads;
      const wantFov = baseFov + (inOkr ? 3 : 0) + okrPulse * Math.sin(okrPulse * 11) * 9;
      if (Math.abs(camera.fov - wantFov) > 0.01) {
        camera.fov += (wantFov - camera.fov) * Math.min(1, dt * 7);
        camera.updateProjectionMatrix();
      }
      muzzleLight.intensity = Math.max(0, muzzleLight.intensity - dt * 34);

      ads += ((aiming && alive && countdown === 0 ? 1 : 0) - ads) * (1 - Math.exp(-16 * dt));
      updateStance(dt);

      const sub = dt / SUB_STEPS;
      for (let i = 0; i < SUB_STEPS; i++) {
        applyInput(sub);
        stepPlayer(sub);
      }
      checkStuck(dt);
      updateAvatars(dt);
      updatePickups(dt);
      updateModels(dt);
      const nowMs = performance.now();
      updateLights(nowMs);
      updateRings(dt, nowMs);
      updateSmoke(dt);
      if (firing) fire();
      updateEffects();
      updateGun(dt);
      renderer.clear();
      renderer.render(scene, camera);
      renderer.clearDepth();           // weapon pass — never clips into geometry
      renderer.render(viewScene, viewCamera);
      hud.update({ hp, maxHp, ammo, reloading, countdown, timeLeft, alive, locked, deathMessage, buffs, inOkr, respawnIn, ads, crouch });
    }
    animate();
  }

  // ---------------------------------------------------------------- weapon
  // First-person rifle, built from boxes. Sits bottom-right of the view camera,
  // which looks down -Z, so the barrel points away from the player.
  function buildGun(THREE) {
    const group = new THREE.Group();
    const body = new THREE.MeshLambertMaterial({ color: 0x2f3648 });
    const dark = new THREE.MeshLambertMaterial({ color: 0x1c2130 });
    const trim = new THREE.MeshLambertMaterial({ color: 0xf7c948 });
    const hand = new THREE.MeshLambertMaterial({ color: 0xd6a071 });

    function part(mat, w, h, d, x, y, z) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.position.set(x, y, z);
      group.add(m);
      return m;
    }

    part(body, 0.17, 0.17, 0.92, 0, 0, 0);          // receiver
    part(dark, 0.12, 0.13, 0.5, 0, -0.01, -0.6);    // handguard
    part(dark, 0.07, 0.07, 0.66, 0, 0.02, -1.0);    // barrel
    part(dark, 0.1, 0.05, 0.1, 0, 0.09, -1.22);     // front sight
    part(dark, 0.1, 0.3, 0.17, 0, -0.21, 0.02);     // magazine
    part(dark, 0.1, 0.26, 0.13, 0, -0.19, 0.3);     // pistol grip
    part(body, 0.13, 0.17, 0.42, 0, -0.03, 0.6);    // stock
    part(trim, 0.18, 0.05, 0.22, 0, 0.07, 0.1);     // gold accent
    part(dark, 0.06, 0.09, 0.07, 0, 0.13, 0.16);    // rear sight
    part(hand, 0.15, 0.15, 0.22, 0.01, -0.13, -0.52); // support hand
    part(hand, 0.14, 0.16, 0.16, 0.01, -0.24, 0.29);  // trigger hand

    const flash = new THREE.Mesh(
      new THREE.ConeGeometry(0.14, 0.34, 6),
      new THREE.MeshBasicMaterial({ color: 0xffd873, transparent: true, opacity: 0.9 })
    );
    flash.rotation.x = -Math.PI / 2;
    flash.position.set(0, 0.02, -1.45);
    flash.visible = false;
    group.add(flash);

    const base = { x: 0.23, y: -0.21, z: -0.5 };
    group.position.set(base.x, base.y, base.z);
    group.rotation.y = 0.05;
    return { group, flash, base };
  }

  // ------------------------------------------------------------------- HUD
  function buildHud(wrap) {
    const layer = document.createElement("div");
    layer.style.cssText = "position:absolute;inset:0;pointer-events:none;font-family:Nunito,sans-serif;color:#f0f0f0;";
    wrap.appendChild(layer);

    function el(css, html) {
      const d = document.createElement("div");
      d.style.cssText = css;
      if (html) d.innerHTML = html;
      layer.appendChild(d);
      return d;
    }

    const crosshair = el("position:absolute;left:50%;top:50%;width:18px;height:18px;margin:-9px 0 0 -9px;transition:transform 220ms,filter 220ms;");
    crosshair.innerHTML =
      '<div style="position:absolute;left:8px;top:0;width:2px;height:6px;background:#f7c948;"></div>' +
      '<div style="position:absolute;left:8px;bottom:0;width:2px;height:6px;background:#f7c948;"></div>' +
      '<div style="position:absolute;top:8px;left:0;height:2px;width:6px;background:#f7c948;"></div>' +
      '<div style="position:absolute;top:8px;right:0;height:2px;width:6px;background:#f7c948;"></div>';

    const centreDot = el("position:absolute;left:50%;top:50%;width:3px;height:3px;margin:-1.5px 0 0 -1.5px;" +
      "background:#f7c948;border-radius:50%;opacity:0;transition:opacity 120ms;box-shadow:0 0 4px rgba(0,0,0,0.9);");

    const hitMarker = el("position:absolute;left:50%;top:50%;width:22px;height:22px;margin:-11px 0 0 -11px;opacity:0;transition:opacity 120ms;");
    hitMarker.innerHTML =
      '<div style="position:absolute;left:0;top:0;width:22px;height:2px;background:#fff;transform:rotate(45deg);transform-origin:center;"></div>' +
      '<div style="position:absolute;left:0;top:0;width:22px;height:2px;background:#fff;transform:rotate(-45deg);transform-origin:center;"></div>';

    const healEl = el("position:absolute;bottom:72px;left:14px;font-size:0.95rem;font-weight:900;color:#4ecca3;opacity:0;transition:opacity 200ms,transform 500ms;text-shadow:0 2px 6px rgba(0,0,0,0.9);");
    const timer = el("position:absolute;top:10px;left:50%;transform:translateX(-50%);font-weight:900;font-size:1.3rem;letter-spacing:1px;text-shadow:0 2px 6px rgba(0,0,0,0.8);");
    const board = el("position:absolute;top:10px;right:12px;font-size:0.8rem;font-weight:700;text-align:right;text-shadow:0 2px 6px rgba(0,0,0,0.8);line-height:1.5;");
    const feed = el("position:absolute;top:10px;left:12px;font-size:0.78rem;font-weight:700;text-shadow:0 2px 6px rgba(0,0,0,0.8);line-height:1.6;");
    const mapName = el("position:absolute;bottom:10px;left:50%;transform:translateX(-50%);font-size:0.7rem;color:#8892a4;letter-spacing:2px;text-transform:uppercase;");

    const healthWrap = el("position:absolute;bottom:12px;left:14px;width:190px;");
    healthWrap.innerHTML =
      '<div style="font-size:0.7rem;color:#8892a4;letter-spacing:2px;font-weight:800;">HEALTH</div>' +
      '<div style="margin-top:3px;height:12px;background:rgba(0,0,0,0.55);border-radius:6px;overflow:hidden;">' +
      '<div id="sh-hpbar" style="height:100%;width:100%;background:#4ecca3;transition:width 120ms;"></div></div>';
    const hpBar = healthWrap.querySelector("#sh-hpbar");

    const ammoEl = el("position:absolute;bottom:12px;right:14px;text-align:right;font-weight:900;font-size:1.6rem;text-shadow:0 2px 6px rgba(0,0,0,0.8);");
    const centre = el("position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:2.2rem;text-shadow:0 3px 10px rgba(0,0,0,0.9);text-align:center;");
    const damageVignette = el("position:absolute;inset:0;box-shadow:inset 0 0 90px rgba(233,69,96,0.75);opacity:0;transition:opacity 220ms;");
    const blood = el("position:absolute;inset:0;opacity:0;overflow:hidden;");
    const drops = [];
    for (let i = 0; i < 7; i++) {
      const d = document.createElement("div");
      d.style.cssText = "position:absolute;border-radius:50%;background:radial-gradient(circle at 38% 34%," +
        "rgba(176,20,32,0.85),rgba(120,8,18,0.42) 58%,rgba(120,8,18,0) 74%);";
      blood.appendChild(d);
      drops.push(d);
    }

    const buffRow = el("position:absolute;bottom:44px;left:14px;display:flex;gap:6px;font-size:0.68rem;font-weight:900;letter-spacing:1px;");
    const toastEl = el("position:absolute;bottom:78px;left:50%;transform:translateX(-50%);font-size:1rem;font-weight:900;letter-spacing:2px;opacity:0;transition:opacity 200ms;text-shadow:0 2px 8px rgba(0,0,0,0.9);");

    const okrEl = el("position:absolute;top:30%;left:50%;transform:translateX(-50%) scale(0.7);opacity:0;transition:opacity 260ms,transform 260ms;text-align:center;white-space:nowrap;");
    const adsVignette = el("position:absolute;inset:0;opacity:0;transition:opacity 120ms;box-shadow:inset 0 0 140px 40px rgba(0,0,0,0.85);");
    const stanceEl = el("position:absolute;bottom:12px;left:214px;font-size:0.7rem;font-weight:900;letter-spacing:2px;color:#8892a4;opacity:0;transition:opacity 150ms;");
    const okrTint = el("position:absolute;inset:0;box-shadow:inset 0 0 120px rgba(126,224,192,0.55);opacity:0;transition:opacity 400ms;");

    const endBoard = el("position:absolute;inset:0;display:none;align-items:center;justify-content:center;" +
      "background:rgba(6,10,20,0.9);backdrop-filter:blur(2px);z-index:5;");

    const lockOverlay = el(
      "position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:0.6rem;background:rgba(11,16,32,0.86);cursor:pointer;pointer-events:auto;text-align:center;padding:1rem;",
      '<div style="font-size:1.5rem;font-weight:900;color:#f7c948;">Click to play</div>' +
      '<div style="font-size:0.85rem;color:#c9d2e3;line-height:1.8;">' +
      '<b>WASD</b> move &nbsp;·&nbsp; <b>Space</b> jump &nbsp;·&nbsp; <b>Shift/Ctrl</b> duck<br>' +
      '<b>Right-click</b> aim down sights &nbsp;·&nbsp; <b>Mouse</b> look<br>' +
      '<b>U</b> unstick if you are ever trapped<br>' +
      '<b>Click</b> fire &nbsp;·&nbsp; <b>R</b> reload &nbsp;·&nbsp; <b>F</b> fullscreen &nbsp;·&nbsp; <b>Esc</b> release cursor<br>' +
      '<span style="color:#8892a4">Grab the glowing pickups: health, shield, 2\u00d7 damage, speed</span></div>'
    );

    let hitTimer = null;
    let dmgTimer = null;
    let toastTimer = null;
    let okrTimer = null;
    let healTimer = null;
    let endTimer = null;
    const feedItems = [];
    stanceEl.textContent = "DUCKED";

    return {
      layer,
      lockOverlay,
      stopTimers() {
        clearInterval(endTimer);
        clearTimeout(okrTimer);
        clearTimeout(healTimer);
        clearTimeout(toastTimer);
        clearTimeout(hitTimer);
        clearTimeout(dmgTimer);
      },
      setLocked(locked) { lockOverlay.style.display = locked ? "none" : "flex"; },
      setMap(name) { mapName.textContent = name || ""; },
      markHit(head) {
        hitMarker.style.opacity = "1";
        hitMarker.querySelectorAll("div").forEach((d) => { d.style.background = head ? "#f7c948" : "#fff"; });
        clearTimeout(hitTimer);
        hitTimer = setTimeout(() => { hitMarker.style.opacity = "0"; }, 130);
      },
      healTick(amount) {
        healEl.textContent = "+" + amount + " HP";
        healEl.style.opacity = "1";
        healEl.style.transform = "translateY(-10px)";
        clearTimeout(healTimer);
        healTimer = setTimeout(() => {
          healEl.style.opacity = "0";
          healEl.style.transform = "translateY(0)";
        }, 500);
      },
      endScreen(table, myUid, endsIn) {
        const rows = (table || []).map((p, i) => {
          const me = myUid && p.uid === myUid;
          const kd = (p.deaths ? p.kills / p.deaths : p.kills).toFixed(2);
          const place = ["#f7c948", "#c9d2e3", "#c98a48"][i] || "#8892a4";
          return '<tr style="color:' + (me ? "#f7c948" : "#e2e8f0") +
            ';background:' + (me ? "rgba(247,201,72,0.10)" : "transparent") + '">' +
            '<td style="padding:0.45rem 0.7rem;font-weight:900;color:' + place + '">' + (i + 1) + '</td>' +
            '<td style="padding:0.45rem 0.7rem;font-weight:800;text-align:left">' + esc(p.name) +
              (me ? ' <span style="color:#8892a4;font-size:0.75rem">you</span>' : "") + '</td>' +
            '<td style="padding:0.45rem 0.9rem;font-weight:900;font-size:1.05rem">' + p.kills + '</td>' +
            '<td style="padding:0.45rem 0.9rem;color:#8892a4">' + p.deaths + '</td>' +
            '<td style="padding:0.45rem 0.9rem;font-weight:800;color:#4ecca3">' + kd + '</td></tr>';
        }).join("");

        const winner = table && table[0] ? table[0].name : "";
        endBoard.innerHTML =
          '<div style="text-align:center;max-width:92%;">' +
          '<div style="font-size:0.8rem;letter-spacing:5px;color:#8892a4;font-weight:800">MATCH OVER</div>' +
          '<div style="margin:0.35rem 0 1rem;font-size:1.7rem;font-weight:900;color:#f7c948;' +
            'text-shadow:0 0 18px rgba(247,201,72,0.35)">' + esc(winner) + ' wins</div>' +
          '<table style="margin:0 auto;border-collapse:collapse;font-size:0.95rem">' +
          '<thead><tr style="color:#8892a4;font-size:0.7rem;letter-spacing:2px">' +
          '<th style="padding:0 0.7rem 0.4rem"></th>' +
          '<th style="padding:0 0.7rem 0.4rem;text-align:left">PLAYER</th>' +
          '<th style="padding:0 0.9rem 0.4rem">K</th>' +
          '<th style="padding:0 0.9rem 0.4rem">D</th>' +
          '<th style="padding:0 0.9rem 0.4rem">K/D</th></tr></thead>' +
          '<tbody>' + rows + '</tbody></table>' +
          '<div id="sh-endcount" style="margin-top:1.1rem;font-size:0.8rem;color:#8892a4;letter-spacing:2px"></div>' +
          '</div>';
        endBoard.style.display = "flex";

        const counter = endBoard.querySelector("#sh-endcount");
        let left = Math.ceil((endsIn || 9000) / 1000);
        const tick = () => {
          counter.textContent = left > 0 ? "RESULTS IN " + left + "s" : "";
          left--;
          if (left < -1) clearInterval(endTimer);
        };
        tick();
        clearInterval(endTimer);
        endTimer = setInterval(tick, 1000);
      },
      okrBanner(text, sub) {
        okrEl.innerHTML =
          '<div style="font-size:1.5rem;font-weight:900;letter-spacing:3px;color:#7ee0c0;' +
          'text-shadow:0 0 18px rgba(126,224,192,0.9),0 3px 10px rgba(0,0,0,0.9)">' + esc(text) + '</div>' +
          (sub ? '<div style="margin-top:0.3rem;font-size:0.95rem;font-weight:800;letter-spacing:2px;color:#e8ecf3;' +
                 'text-shadow:0 2px 8px rgba(0,0,0,0.9)">' + esc(sub) + '</div>' : "");
        okrEl.style.opacity = "1";
        okrEl.style.transform = "translateX(-50%) scale(1)";
        clearTimeout(okrTimer);
        okrTimer = setTimeout(() => {
          okrEl.style.opacity = "0";
          okrEl.style.transform = "translateX(-50%) scale(0.7)";
        }, 2200);
      },
      toast(text, color) {
        toastEl.textContent = text;
        toastEl.style.color = color || "#f7c948";
        toastEl.style.opacity = "1";
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => { toastEl.style.opacity = "0"; }, 1400);
      },
      flashDamage() {
        damageVignette.style.opacity = "1";
        // re-scatter the splatter on every hit, kept to the edges so the centre
        // of the screen stays readable while you are being shot at
        for (const d of drops) {
          const size = 55 + Math.random() * 145;
          d.style.width = size + "px";
          d.style.height = size * (0.55 + Math.random() * 0.6) + "px";
          d.style.left = (Math.random() < 0.5 ? Math.random() * 26 : 74 + Math.random() * 24) + "%";
          d.style.top = Math.random() * 86 + "%";
          d.style.transform = "rotate(" + Math.floor(Math.random() * 360) + "deg)";
        }
        blood.style.transition = "opacity 70ms";
        blood.style.opacity = "0.7";
        clearTimeout(dmgTimer);
        dmgTimer = setTimeout(() => {
          damageVignette.style.opacity = "0";
          blood.style.transition = "opacity 750ms ease-out";
          blood.style.opacity = "0";
        }, 230);
      },
      addSignFeed(who, id) {
        feedItems.unshift(
          '<span style="color:#4ecca3">' + esc(who) + '</span> smashed ' +
          '<span style="color:#f36000">' + esc(id.split("-")[0].toUpperCase()) + '</span>'
        );
        if (feedItems.length > 5) feedItems.pop();
        feed.innerHTML = feedItems.join("<br>");
      },
      addFeed(killer, victim, headshot) {
        feedItems.unshift(
          '<span style="color:#4ecca3">' + esc(killer) + '</span> ' +
          (headshot ? '<span style="color:#f7c948">✷</span>' : '→') +
          ' <span style="color:#e94560">' + esc(victim) + '</span>'
        );
        if (feedItems.length > 5) feedItems.pop();
        feed.innerHTML = feedItems.join("<br>");
      },
      setScores(players, myUid, mySocketId) {
        board.innerHTML = '<div style="color:#8892a4;font-size:0.68rem;letter-spacing:1px">KILLS / DEATHS</div>' +
          players
            .slice()
            .sort((a, b) => b.kills - a.kills || a.deaths - b.deaths)
            .map((p) => {
              const me = myUid ? p.uid === myUid : p.id === mySocketId;
              return '<div style="color:' + (me ? "#f7c948" : "#c9d2e3") + '">' +
                esc(p.name) + ' &nbsp;<b>' + p.kills + '</b>' +
                '<span style="color:#8892a4"> / ' + p.deaths + '</span></div>';
            })
            .join("");
      },
      update(st) {
        okrTint.style.opacity = st.inOkr ? "1" : "0";
        // The crosshair stays on screen while zoomed and tightens with the zoom,
        // rather than fading out - you are magnifying the view, not looking down
        // an occluding sight.
        const ads = st.ads || 0;
        const aimScale = (st.inOkr ? 0.55 : 1) * (1 - ads * 0.5);
        crosshair.style.transform = "scale(" + aimScale.toFixed(2) + ")";
        crosshair.style.opacity = "1";
        crosshair.style.filter = st.inOkr ? "drop-shadow(0 0 4px #7ee0c0)" : "none";
        centreDot.style.opacity = ads.toFixed(2);          // a precise centre appears as you zoom
        adsVignette.style.opacity = (ads * 0.28).toFixed(2);
        stanceEl.style.opacity = (st.crouch || 0) > 0.5 ? "1" : "0";
        const chips = [];
        if (st.inOkr) chips.push(["OKR \u00b7 +HEAL \u00b7 +AIM", "#7ee0c0"]);
        if (st.buffs && st.buffs.bd > 0) chips.push(["2\u00d7 DMG " + st.buffs.bd + "s", "#ff7a3d"]);
        if (st.buffs && st.buffs.bs > 0) chips.push(["SPEED " + st.buffs.bs + "s", "#5dade2"]);
        if (st.buffs && st.buffs.bp > 0) chips.push(["SHIELD " + st.buffs.bp + "s", "#b58cff"]);
        const markup = chips.map(([t, c]) =>
          '<span style="padding:2px 7px;border-radius:4px;background:rgba(0,0,0,0.5);border:1px solid ' + c + ';color:' + c + '">' + t + '</span>'
        ).join("");
        if (buffRow.innerHTML !== markup) buffRow.innerHTML = markup;

        const hpFrac = Math.max(0, Math.min(1, st.hp / (st.maxHp || 100)));
        hpBar.style.width = (hpFrac * 100) + "%";
        hpBar.style.background = hpFrac > 0.6 ? "#4ecca3" : hpFrac > 0.25 ? "#f7c948" : "#e94560";
        ammoEl.innerHTML = st.reloading
          ? '<span style="font-size:0.9rem;color:#f7c948">RELOADING</span>'
          : st.ammo + '<span style="font-size:0.9rem;color:#8892a4"> / 30</span>';
        const mins = Math.floor(st.timeLeft / 60);
        const secs = String(st.timeLeft % 60).padStart(2, "0");
        timer.textContent = mins + ":" + secs;

        if (st.countdown > 0) centre.textContent = String(st.countdown);
        else if (!st.alive) {
          centre.innerHTML =
            '<div style="font-size:1.4rem;font-weight:900;color:#e94560">' +
            esc(st.deathMessage || "Eliminated") + '</div>' +
            '<div style="margin-top:0.5rem;font-size:2.6rem;font-weight:900;color:#f7c948">' +
            (st.respawnIn > 0 ? st.respawnIn : "") + '</div>' +
            '<div style="font-size:0.85rem;color:#c9d2e3;letter-spacing:2px">' +
            (st.respawnIn > 0 ? "RESPAWNING" : "GET READY") + '</div>';
        }
        else centre.textContent = "";
      },
    };
  }

  function esc(str) {
    return String(str).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }
})();
