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
  const SPREAD = 0.005;
  const RANGE = 140;
  const SEND_MS = 50;
  const LOOK_SENS = 0.0022;

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

    const [THREE, octreeMod, capsuleMod] = await Promise.all([
      import("three"),
      import("three/addons/math/Octree.js"),
      import("three/addons/math/Capsule.js"),
    ]);
    if (s.disposed) return;

    const { Octree } = octreeMod;
    const { Capsule } = capsuleMod;
    const MAP = window.SHOOTER_MAP;

    // ---------------------------------------------------------------- layout
    const area = document.getElementById("game-area");
    area.innerHTML = "";
    const wrap = document.createElement("div");
    wrap.style.cssText = "position:relative;width:100%;max-width:960px;margin:0 auto;border-radius:10px;overflow:hidden;background:#0b1020;";
    area.appendChild(wrap);

    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.domElement.style.cssText = "display:block;width:100%;height:auto;";
    wrap.appendChild(renderer.domElement);
    s.renderer = renderer;

    const hud = buildHud(wrap);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#0b1020");
    scene.fog = new THREE.Fog("#0b1020", 55, 110);

    const camera = new THREE.PerspectiveCamera(78, 16 / 9, 0.1, 400);
    camera.rotation.order = "YXZ";

    function resize() {
      const w = wrap.clientWidth || 960;
      const h = Math.round(w * 9 / 16);
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
    resize();
    s.on(window, "resize", resize);

    scene.add(new THREE.HemisphereLight(0xbcd0ff, 0x2a2f45, 1.15));
    const sun = new THREE.DirectionalLight(0xffffff, 1.5);
    sun.position.set(24, 46, 14);
    scene.add(sun);

    // ----------------------------------------------------------------- world
    const worldGroup = new THREE.Group();
    const worldMeshes = [];
    const edgeMat = new THREE.LineBasicMaterial({ color: 0x0a0f1e, transparent: true, opacity: 0.55 });
    for (const b of MAP.boxes) {
      const geo = new THREE.BoxGeometry(b.size[0], b.size[1], b.size[2]);
      const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: b.color }));
      mesh.position.set(b.pos[0], b.pos[1], b.pos[2]);
      worldGroup.add(mesh);
      worldMeshes.push(mesh);
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), edgeMat);
      edges.position.copy(mesh.position);
      scene.add(edges);
    }
    scene.add(worldGroup);

    const octree = new Octree().fromGraphNode(worldGroup);

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
    let ammo = MAG_SIZE;
    let reloading = false;
    let firing = false;
    let lastFire = 0;
    let countdown = 0;
    let timeLeft = 0;
    let snapshotPlayers = [];
    let deathMessage = "";

    function teleport(pos) {
      collider.start.set(pos[0], pos[1] + PLAYER_RADIUS, pos[2]);
      collider.end.set(pos[0], pos[1] + EYE_HEIGHT, pos[2]);
      velocity.set(0, 0, 0);
      camera.position.copy(collider.end);
    }
    teleport([0, 0, 0]);

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

    function applyInput(dt) {
      if (!alive || countdown > 0) return;
      const accel = dt * (onFloor ? ACCEL_GROUND : ACCEL_AIR);
      if (keys.KeyW || keys.ArrowUp) velocity.add(forwardVector().multiplyScalar(accel));
      if (keys.KeyS || keys.ArrowDown) velocity.add(forwardVector().multiplyScalar(-accel));
      if (keys.KeyA || keys.ArrowLeft) velocity.add(sideVector().multiplyScalar(-accel));
      if (keys.KeyD || keys.ArrowRight) velocity.add(sideVector().multiplyScalar(accel));
      if (onFloor && keys.Space) velocity.y = JUMP_SPEED;
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
    const avatars = new Map(); // id -> { group, meshes, target, label }

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
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
      sprite.scale.set(2.4, 0.6, 1);
      sprite.position.y = 2.25;
      sprite.renderOrder = 10;
      return sprite;
    }

    function makeAvatar(p) {
      const group = new THREE.Group();
      const mat = new THREE.MeshLambertMaterial({ color: p.color });
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.72, 1.0, 0.45), mat);
      body.position.y = 0.55;
      body.userData = { playerId: p.id, part: "body" };
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.52, 0.52), mat);
      head.position.y = 1.36;
      head.userData = { playerId: p.id, part: "head" };
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
      group.add(body, head, visor, gun, makeLabel(p.name, p.color));
      scene.add(group);
      return { group, meshes: [body, head], target: new THREE.Vector3(), yaw: 0 };
    }

    function updateAvatars(dt) {
      const seen = new Set();
      for (const p of snapshotPlayers) {
        if (p.id === s.socket.id) continue;
        seen.add(p.id);
        let a = avatars.get(p.id);
        if (!a) { a = makeAvatar(p); avatars.set(p.id, a); }
        a.target.set(p.p[0], p.p[1], p.p[2]);
        a.yaw = p.r[0];
        a.group.visible = p.alive;
        // exponential smoothing towards the last snapshot — no prediction needed
        const k = 1 - Math.exp(-16 * dt);
        a.group.position.lerp(a.target, k);
        let dy = a.yaw - a.group.rotation.y;
        while (dy > Math.PI) dy -= Math.PI * 2;
        while (dy < -Math.PI) dy += Math.PI * 2;
        a.group.rotation.y += dy * k;
      }
      for (const [id, a] of avatars) {
        if (seen.has(id)) continue;
        scene.remove(a.group);
        avatars.delete(id);
      }
    }

    // -------------------------------------------------------------- shooting
    const raycaster = new THREE.Raycaster();
    raycaster.far = RANGE;
    const aimDir = new THREE.Vector3();
    const effects = [];

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
      s.timeouts.push(setTimeout(() => {
        ammo = MAG_SIZE;
        reloading = false;
      }, RELOAD_MS));
    }

    function fire() {
      if (!locked || !alive || countdown > 0 || reloading) return;
      const now = performance.now();
      if (now - lastFire < FIRE_MS) return;
      if (ammo <= 0) { reload(); return; }
      lastFire = now;
      ammo--;

      camera.getWorldDirection(aimDir);
      aimDir.x += (Math.random() - 0.5) * SPREAD;
      aimDir.y += (Math.random() - 0.5) * SPREAD;
      aimDir.z += (Math.random() - 0.5) * SPREAD;
      aimDir.normalize();
      raycaster.set(camera.position, aimDir);

      const targets = worldMeshes.slice();
      for (const [, a] of avatars) if (a.group.visible) targets.push(...a.meshes);
      const hits = raycaster.intersectObjects(targets, false);
      const hit = hits[0];
      const end = hit ? hit.point : camera.position.clone().addScaledVector(aimDir, RANGE);

      tracer(camera.position.clone().addScaledVector(aimDir, 1.2), end);
      camera.rotation.x = Math.min(Math.PI / 2 * 0.95, camera.rotation.x + 0.006);

      if (!hit) return;
      impact(hit.point);
      const victim = hit.object.userData.playerId;
      if (victim) {
        hud.markHit(hit.object.userData.part === "head");
        s.socket.emit("shooter-input", { t: "hit", victim, part: hit.object.userData.part });
      }
    }

    // ----------------------------------------------------------------- input
    s.on(document, "keydown", (e) => {
      keys[e.code] = true;
      if (e.code === "KeyR") reload();
      if (locked && (e.code === "Space" || e.code.startsWith("Arrow"))) e.preventDefault();
    });
    s.on(document, "keyup", (e) => { keys[e.code] = false; });
    s.on(document, "mousemove", (e) => {
      if (!locked) return;
      camera.rotation.y -= e.movementX * LOOK_SENS;
      camera.rotation.x -= e.movementY * LOOK_SENS;
      const limit = Math.PI / 2 * 0.98;
      camera.rotation.x = Math.max(-limit, Math.min(limit, camera.rotation.x));
    });
    s.on(document, "mousedown", (e) => { if (locked && e.button === 0) firing = true; });
    s.on(document, "mouseup", () => { firing = false; });
    s.on(document, "pointerlockchange", () => {
      locked = document.pointerLockElement === renderer.domElement;
      if (!locked) { firing = false; for (const k in keys) keys[k] = false; }
      hud.setLocked(locked);
    });
    s.on(hud.lockOverlay, "click", () => renderer.domElement.requestPointerLock());
    s.on(renderer.domElement, "click", () => { if (!locked) renderer.domElement.requestPointerLock(); });
    s.on(renderer.domElement, "contextmenu", (e) => e.preventDefault());

    // -------------------------------------------------------------- network
    s.sock("shooter-init", (data) => { hud.setMap(data.map); });

    s.sock("shooter-spawn", ({ pos, hp: newHp }) => {
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
      const me = state.players.find((p) => p.id === s.socket.id);
      if (me) {
        hp = me.hp;
        if (alive && !me.alive) firing = false;
        alive = me.alive;
      }
      hud.setScores(state.players, s.socket.id);
    });

    s.sock("shooter-damaged", ({ from, hp: newHp }) => {
      hp = newHp;
      hud.flashDamage(from);
    });

    s.sock("shooter-kill", ({ killer, victim, victimId, headshot }) => {
      hud.addFeed(killer, victim, headshot);
      if (victimId === s.socket.id) deathMessage = "Fragged by " + killer;
    });

    const sendTimer = setInterval(() => {
      if (s.disposed) return;
      s.socket.emit("shooter-input", {
        t: "state",
        p: [collider.start.x, collider.start.y - PLAYER_RADIUS, collider.start.z],
        r: [camera.rotation.y, camera.rotation.x],
      });
    }, SEND_MS);
    s.intervals.push(sendTimer);

    // ------------------------------------------------------------------ loop
    const clock = new THREE.Clock();
    function animate() {
      s.raf = requestAnimationFrame(animate);
      const dt = Math.min(0.05, clock.getDelta());
      const sub = dt / SUB_STEPS;
      for (let i = 0; i < SUB_STEPS; i++) {
        applyInput(sub);
        stepPlayer(sub);
      }
      updateAvatars(dt);
      if (firing) fire();
      updateEffects();
      renderer.render(scene, camera);
      hud.update({ hp, ammo, reloading, countdown, timeLeft, alive, locked, deathMessage });
    }
    animate();
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

    const crosshair = el("position:absolute;left:50%;top:50%;width:18px;height:18px;margin:-9px 0 0 -9px;");
    crosshair.innerHTML =
      '<div style="position:absolute;left:8px;top:0;width:2px;height:6px;background:#f7c948;"></div>' +
      '<div style="position:absolute;left:8px;bottom:0;width:2px;height:6px;background:#f7c948;"></div>' +
      '<div style="position:absolute;top:8px;left:0;height:2px;width:6px;background:#f7c948;"></div>' +
      '<div style="position:absolute;top:8px;right:0;height:2px;width:6px;background:#f7c948;"></div>';

    const hitMarker = el("position:absolute;left:50%;top:50%;width:22px;height:22px;margin:-11px 0 0 -11px;opacity:0;transition:opacity 120ms;");
    hitMarker.innerHTML =
      '<div style="position:absolute;left:0;top:0;width:22px;height:2px;background:#fff;transform:rotate(45deg);transform-origin:center;"></div>' +
      '<div style="position:absolute;left:0;top:0;width:22px;height:2px;background:#fff;transform:rotate(-45deg);transform-origin:center;"></div>';

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
    const damageVignette = el("position:absolute;inset:0;box-shadow:inset 0 0 90px rgba(233,69,96,0.9);opacity:0;transition:opacity 220ms;");

    const lockOverlay = el(
      "position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:0.6rem;background:rgba(11,16,32,0.86);cursor:pointer;pointer-events:auto;text-align:center;padding:1rem;",
      '<div style="font-size:1.5rem;font-weight:900;color:#f7c948;">Click to play</div>' +
      '<div style="font-size:0.85rem;color:#c9d2e3;line-height:1.8;">' +
      '<b>WASD</b> move &nbsp;·&nbsp; <b>Space</b> jump &nbsp;·&nbsp; <b>Mouse</b> aim<br>' +
      '<b>Click</b> fire &nbsp;·&nbsp; <b>R</b> reload &nbsp;·&nbsp; <b>Esc</b> release cursor</div>'
    );

    let hitTimer = null;
    let dmgTimer = null;
    const feedItems = [];

    return {
      lockOverlay,
      setLocked(locked) { lockOverlay.style.display = locked ? "none" : "flex"; },
      setMap(name) { mapName.textContent = name || ""; },
      markHit(head) {
        hitMarker.style.opacity = "1";
        hitMarker.querySelectorAll("div").forEach((d) => { d.style.background = head ? "#f7c948" : "#fff"; });
        clearTimeout(hitTimer);
        hitTimer = setTimeout(() => { hitMarker.style.opacity = "0"; }, 130);
      },
      flashDamage() {
        damageVignette.style.opacity = "1";
        clearTimeout(dmgTimer);
        dmgTimer = setTimeout(() => { damageVignette.style.opacity = "0"; }, 220);
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
      setScores(players, myId) {
        board.innerHTML = players
          .slice()
          .sort((a, b) => b.kills - a.kills || a.deaths - b.deaths)
          .map((p) => {
            const me = p.id === myId;
            return '<div style="color:' + (me ? "#f7c948" : "#c9d2e3") + '">' +
              esc(p.name) + ' &nbsp;<b>' + p.kills + '</b> <span style="color:#8892a4">/ ' + p.deaths + '</span></div>';
          })
          .join("");
      },
      update(st) {
        hpBar.style.width = Math.max(0, st.hp) + "%";
        hpBar.style.background = st.hp > 60 ? "#4ecca3" : st.hp > 25 ? "#f7c948" : "#e94560";
        ammoEl.innerHTML = st.reloading
          ? '<span style="font-size:0.9rem;color:#f7c948">RELOADING</span>'
          : st.ammo + '<span style="font-size:0.9rem;color:#8892a4"> / 30</span>';
        const mins = Math.floor(st.timeLeft / 60);
        const secs = String(st.timeLeft % 60).padStart(2, "0");
        timer.textContent = mins + ":" + secs;

        if (st.countdown > 0) centre.textContent = String(st.countdown);
        else if (!st.alive) centre.innerHTML = '<span style="font-size:1.4rem;color:#e94560">' + esc(st.deathMessage || "Eliminated") + '<br><span style="font-size:0.9rem;color:#c9d2e3">Respawning…</span></span>';
        else centre.textContent = "";
      },
    };
  }

  function esc(str) {
    return String(str).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }
})();
