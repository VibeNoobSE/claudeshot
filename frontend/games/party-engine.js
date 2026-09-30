// Claudeshot party engine - the shared client for the Fall Guys-style rounds.
//
// Owns everything the party games have in common: the session and its
// cleanup, three.js, renderer, lights, lava, 16:9 layout and fullscreen, the
// loading screen and team, the ready handshake, the race clock, 3-2-1-GO, the
// rules card and controls strip, keyboard / gamepad / optional mouse-look,
// capsule physics (floors, moving boxes you can ride, knock-back colliders,
// optional static meshes via an Octree), dive and bump, Bookis/Norli beans for
// everyone with labels and smoothing, the follow camera with auto-follow,
// spectating when you're out, the HUD, the end board and the sounds.
//
// The matching server is backend/games/party-base.js (PartyGame).
//
// ---------------------------------------------------------------------------
// HOW TO BUILD A GAME ON THIS
//
//   const game = PARTY_ENGINE.define({
//     key: "mygame",                          // socket events: mygame-input / -init / -state / -knock / -out / -over
//     title: "MY GAME",                       // loading screen title
//     rules: "DO THE THING · DON'T FALL",     // rules card at the start
//     rulesSub: "Last one standing wins",
//     rulesFile: "mygame-rules.js",           // optional shared rules script (next to this file)
//     rulesGlobal: "MYGAME_RULES",            //   ... and the global it defines -> ctx.rules
//     player: { radius: 0.45, height: 1.75 },
//     countdownMs: 3000, roundMs: 150000, lavaY: -12,
//     build(ctx) { ... add meshes to ctx.scene ... },     // once, after three.js has loaded
//     groundAt(ctx, x, z, rt, fromY, toY) { return 0; },  // walkable top under (x, z), or null. The feet
//                                                          //  land if they crossed it this step; return
//                                                          //  { y, snap: true } to also catch feet a little below
//     isOut(ctx, pos, rt) { return pos.y < -3; },         // am I out? (client side; the server checks it)
//   });
//   window.initMygameClient = game.init;
//   window.cleanupMygameClient = game.cleanup;
//
// Optional spec fields / hooks (ctx is described below):
//   world: { background, fog:[near, far], lava: true, hemi: [sky, ground, intensity], sun: [color, intensity, x, y, z] }
//   camera: { fov, dist, base, pitch, minPitch, maxPitch, look, autoFollow }
//   feel: { gravity, jumpSpeed, runSpeed, diveSpeed, ... }       (see FEEL below)
//   spawnYaw                        facing at spawn (default: the server's spawnYaw)
//   colliders(ctx, rt)              moving things, recomputed every frame:
//       { type: "box", min:[x,y,z], max:[x,y,z], vel:[vx, vz] }        solid, shoves you, you can ride its top
//       { type: "capsule", id, a:[x,y,z], b:[x,y,z], r, knock, up, flash, knockVel(pos) }
//       { type: "sphere",  id, c:[x,y,z], r, knock, up, flash, knockVel(pos) }
//         capsule/sphere push you out and launch you (once per id per cooldown).
//   onGround(ctx, contact, rt)      called while standing on a groundAt() contact
//   constrain(ctx, pos, prev, vel, rt)   last say on the position each substep (walls, posts...)
//   onHit(ctx, collider)            after a capsule/sphere launched you
//   update(ctx, dt, rt)             every frame, for the game's own visuals
//   introCamera(ctx, now, rt)       during loading/countdown: { pos:[..], look:[..] } or null
//   cameraClamp(ctx, camPos, look, focus)  adjust the camera (e.g. stay under a ceiling)
//   onInit(ctx, data) / onState(ctx, st)   extra message fields
//   on: { "tiles": (ctx, data) => {} }     extra socket events (key-prefixed)
//   endCell(row) / endTitle(table, myUid)  end board text
//   hudExtras(ctx, st)              every frame, to update HUD elements the game added
//
// ctx (passed to every hook):
//   THREE, scene, camera, renderer, rules, spec, hud, player (live, mutable),
//   seed, phase, snapshot (latest players list), beans (uid -> remote bean),
//   rt(), now(), send(data) -> emits key-input, sfx(name, opts), addStatic(mesh),
//   makeLabel(text, color), makeBean(opts), state (scratch space for the game), session.
//   player: { pos, vel, faceYaw, onFloor, stun, diving, out, spawned, uid, name, color, team }
//
// Sounds: calls window.PARTY_AUDIO (if loaded) for jump, land, dive, bump,
// knock, step, tick, go, out, win, lose, cheer and pop. Games call ctx.sfx()
// for their own. M toggles mute.
// ---------------------------------------------------------------------------

(function () {
  "use strict";

  const FEEL = {
    gravity: 30,
    jumpSpeed: 10,
    runSpeed: 7.5,
    groundRate: 16,
    airRate: 5,
    stunRate: 1.6,
    subSteps: 4,
    coyoteMs: 110,
    jumpBufferMs: 130,
    diveSpeed: 11,
    diveHop: 4.5,
    diveAirHop: 1.5,
    diveSlideMs: 420,
    diveCooldownMs: 850,
    stunS: 0.6,
    hitCooldownS: 0.7,
    sendMs: 50,
  };
  const CAMERA = {
    fov: 60,
    dist: 12.5,                // ~11 m back and ~7.5 m up at the default pitch
    base: 1.5,                 // height above the focus before the pitch adds its share
    pitch: 0.5,
    minPitch: 0.15,
    maxPitch: 1.2,
    look: 1,                   // look this far above the feet
    keyOrbit: 2.2,
    keyTilt: 1.2,
    padOrbit: 2.6,
    padTilt: 1.4,
    lookSens: 0.0026,
    autoFollow: true,
    autoIdleMs: 1000,
    autoMax: 2.6,              // rad/s at most while auto-following
  };
  const TEAMS = ["bookis", "norli"];
  const FONT = "'Titan One', Nunito, sans-serif";
  const OUTLINE = "-webkit-text-stroke:2px #2b0f3a;paint-order:stroke fill;text-shadow:0 4px 0 #2b0f3a,0 6px 14px rgba(0,0,0,0.5);";
  const PAD_DEAD = 0.18;

  const SCRIPT_SRC = document.currentScript && document.currentScript.src;
  const here = (path) => { try { return new URL(path, SCRIPT_SRC).href; } catch (e) { return "games/" + path; } };

  // ---------------------------------------------------------------- audio
  function sfx(name, opts) {
    try { const a = window.PARTY_AUDIO; if (a && typeof a.play === "function") a.play(name, opts); } catch (e) { /* silent */ }
  }
  function audio(fn) {
    try { const a = window.PARTY_AUDIO; if (a) return fn(a); } catch (e) { /* silent */ }
    return undefined;
  }

  // ---------------------------------------------------------------- define
  function define(spec) {
    let session = null;
    return {
      init(socket) {
        if (session) session.dispose();
        session = createSession();
        boot(session, socket, spec).catch((err) => {
          console.error("[" + spec.key + "] failed to start", err);
          const area = document.getElementById("game-area");
          if (area) area.innerHTML = '<p class="waiting-msg">Could not load the 3D engine. Check your connection and refresh.</p>';
        });
      },
      cleanup() {
        if (session) session.dispose();
        session = null;
      },
    };
  }

  function createSession() {
    const s = {
      disposed: false, raf: 0, intervals: [], timeouts: [], domListeners: [], socketEvents: [], cleanups: [],
      renderer: null, socket: null,
    };
    s.on = (target, type, fn, opts) => { target.addEventListener(type, fn, opts); s.domListeners.push([target, type, fn, opts]); };
    s.sock = (event, fn) => { s.socket.on(event, fn); s.socketEvents.push([event, fn]); };
    s.dispose = () => {
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

  // The rules file is shared with the server; load it if the page didn't.
  function loadRules(spec) {
    if (!spec.rulesGlobal) return Promise.resolve(null);
    if (window[spec.rulesGlobal]) return Promise.resolve(window[spec.rulesGlobal]);
    return new Promise((resolve, reject) => {
      const tag = document.createElement("script");
      tag.src = here(spec.rulesFile);
      tag.onload = () => resolve(window[spec.rulesGlobal]);
      tag.onerror = reject;
      document.head.appendChild(tag);
    });
  }

  function spawnOf(data) {
    const sp = data && data.spawn;
    if (!sp) return null;
    if (Array.isArray(sp)) return { pos: sp, yaw: data.spawnYaw };
    return { pos: sp.pos || sp.p, yaw: sp.yaw !== undefined ? sp.yaw : data.spawnYaw };
  }

  // ======================================================================
  async function boot(s, socket, spec) {
    s.socket = socket;
    const KEY = spec.key;
    const F = Object.assign({}, FEEL, spec.feel || {});
    const C = Object.assign({}, CAMERA, spec.camera || {});
    const W = Object.assign({ background: "#3a1420", fog: [40, 110], lava: true,
      hemi: [0xfff0f6, 0x5a2230, 1.3], sun: [0xfff2dc, 1.6, 10, 25, 14] }, spec.world || {});
    const DEBUG = window.PARTY_DEBUG || window[KEY.toUpperCase() + "_DEBUG"] || {};
    const LAVA_Y = spec.lavaY !== undefined ? spec.lavaY : -12;
    const COUNTDOWN_MS = spec.countdownMs || 3000;
    const ROUND_MS = spec.roundMs || 150000;
    const input = (data) => s.socket.emit(KEY + "-input", data);

    // ---------------------------------------------------------------- page
    const fontLink = document.createElement("link");
    fontLink.rel = "stylesheet";
    fontLink.href = "https://fonts.googleapis.com/css2?family=Titan+One&display=swap";
    document.head.appendChild(fontLink);
    const pageStyle = document.createElement("style");
    pageStyle.textContent = [
      "body.party-active .container{max-width:99vw !important;width:99vw !important;padding:0.4rem !important;}",
      "body.party-active .page-center{padding:0 !important;}",
      "body.party-active .game-area-card{padding:0.4rem !important;max-width:none !important;}",
      "body.party-active .logo,body.party-active .tagline{display:none !important;}",
      "body.party-active #game-area{width:100%;}",
      "@keyframes partyPop{0%{transform:scale(0.6);opacity:0}60%{transform:scale(1.06);opacity:1}100%{transform:scale(1);opacity:1}}",
      "@keyframes partyCount{0%{transform:scale(2.2);opacity:0}40%{transform:scale(0.92);opacity:1}100%{transform:scale(1);opacity:1}}",
    ].join("\n");
    document.head.appendChild(pageStyle);
    document.body.classList.add("party-active");
    s.cleanups.push(() => { document.body.classList.remove("party-active"); pageStyle.remove(); fontLink.remove(); });

    const area = document.getElementById("game-area");
    area.innerHTML = "";
    const wrap = document.createElement("div");
    wrap.style.cssText = "position:relative;width:100%;margin:0 auto;border-radius:10px;overflow:hidden;background:#1a0a14;";
    area.appendChild(wrap);
    const hud = buildHud(wrap, spec, ROUND_MS);
    s.cleanups.push(() => hud.stopTimers());
    hud.loading("Loading…");

    const [rules, THREE] = await Promise.all([loadRules(spec), import("three")]);
    if (s.disposed) return;

    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.domElement.style.cssText = "display:block;width:100%;height:auto;";
    wrap.insertBefore(renderer.domElement, wrap.firstChild);
    s.renderer = renderer;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(W.background);
    if (W.fog) scene.fog = new THREE.Fog(W.background, W.fog[0], W.fog[1]);
    const camera = new THREE.PerspectiveCamera(C.fov, 16 / 9, 0.1, 500);

    function resize() {
      const fs = !!document.fullscreenElement;
      let w, h;
      if (fs) { w = innerWidth; h = innerHeight; } else {
        const availW = Math.max(320, wrap.clientWidth || innerWidth - 24);
        const availH = Math.max(320, innerHeight - 110);
        w = availW; h = Math.round(w * 9 / 16);
        if (h > availH) { h = availH; w = Math.round(h * 16 / 9); }
      }
      renderer.setSize(w, h, false);
      renderer.domElement.style.width = w + "px";
      renderer.domElement.style.height = h + "px";
      wrap.style.width = fs ? "" : w + "px";
      wrap.style.height = fs ? "" : h + "px";
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
    resize();
    s.on(window, "resize", resize);
    s.on(document, "fullscreenchange", () => setTimeout(resize, 60));

    // baseline world: light, sun, lava
    if (W.hemi) scene.add(new THREE.HemisphereLight(W.hemi[0], W.hemi[1], W.hemi[2]));
    if (W.sun) {
      const sun = new THREE.DirectionalLight(W.sun[0], W.sun[1]);
      sun.position.set(W.sun[2], W.sun[3], W.sun[4]);
      scene.add(sun);
    }
    if (W.lava) {
      const lava = new THREE.Mesh(new THREE.PlaneGeometry(500, 500), new THREE.MeshBasicMaterial({ color: 0xff5a14 }));
      lava.rotation.x = -Math.PI / 2;
      lava.position.y = LAVA_Y;
      scene.add(lava);
    }

    // ---------------------------------------------------------------- beans
    const makeBean = (opts) => {
      if (window.EYE_ART && typeof window.EYE_ART.buildBean === "function") {
        try { return window.EYE_ART.buildBean(THREE, opts); } catch (e) { console.warn("[" + KEY + "] bean failed", e); }
      }
      const R0 = (spec.player && spec.player.radius) || 0.45, H0 = (spec.player && spec.player.height) || 1.75;
      const group = new THREE.Group();
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(R0, H0 - 2 * R0, 6, 12), new THREE.MeshLambertMaterial({ color: opts.color }));
      body.position.y = H0 / 2;
      group.add(body);
      return { group, update() {}, dispose() { body.geometry.dispose(); body.material.dispose(); } };
    };
    function makeLabel(name, color) {
      const cv = document.createElement("canvas");
      cv.width = 320; cv.height = 72;
      const ctx2 = cv.getContext("2d");
      ctx2.font = "900 40px Nunito, sans-serif";
      ctx2.textAlign = "center"; ctx2.textBaseline = "middle";
      ctx2.lineWidth = 9; ctx2.strokeStyle = "rgba(30,8,40,0.95)";
      ctx2.strokeText(name, 160, 38);
      ctx2.fillStyle = color;
      ctx2.fillText(name, 160, 38);
      const tex = new THREE.CanvasTexture(cv);
      tex.colorSpace = THREE.SRGBColorSpace;
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
      sprite.scale.set(2.6, 0.58, 1);
      sprite.renderOrder = 10;
      return sprite;
    }

    const RAD = (spec.player && spec.player.radius) || 0.45;
    const H = (spec.player && spec.player.height) || 1.75;
    let myTeam = "bookis";
    try { if (TEAMS.includes(localStorage.getItem("eyeTeam"))) myTeam = localStorage.getItem("eyeTeam"); } catch (e) { /* default */ }

    // ---------------------------------------------------------------- the player
    const player = {
      pos: new THREE.Vector3(0, 0.05, 0),                // feet
      vel: new THREE.Vector3(),
      faceYaw: 0,
      onFloor: true,
      stun: 0,
      diving: false,
      out: false,
      spawned: false,
      uid: null,
      name: "",
      color: "#ff4fa0",
      team: myTeam,
    };
    const pos = player.pos, vel = player.vel;
    let lastFloorAt = 0, jumpAskedAt = -1e9;
    let diveAt = 0, diveLandedAt = 0, lastDiveAt = -1e9, bumpedThisDive = new Set();
    let camYaw = 0, camPitch = C.pitch, lastCamInput = -1e9;
    let spectating = null;
    let seed = null, phase = "loading", timeLeft = Math.round(ROUND_MS / 1000), aliveCount = 0;
    let snapshot = [];
    let clockOffset = null;
    let matchOver = false;
    const hitCooldown = new Map();                       // collider id -> seconds left
    const keys = Object.create(null);
    let locked = false;
    const pad = { moveF: 0, moveR: 0, lookX: 0, lookY: 0, prev: [] };

    const nowMs = () => performance.now();
    const raceTime = () => (clockOffset === null ? -COUNTDOWN_MS : nowMs() - clockOffset);
    function syncClock(rt) {
      if (!Number.isFinite(rt)) return;
      const est = nowMs() - rt;
      if (clockOffset === null || Math.abs(est - clockOffset) > 500) clockOffset = est;
      else clockOffset += (est - clockOffset) * 0.08;
    }
    const canControl = () => phase === "play" && !player.out && !matchOver && player.spawned && raceTime() >= 0;

    // ---------------------------------------------------------------- static meshes (optional Octree)
    const statics = [];
    let octree = null, capsule = null;

    // ---------------------------------------------------------------- ctx
    const beans = new Map();                             // uid -> remote bean
    const ctx = {
      THREE, scene, camera, renderer, rules, spec, hud, player, beans, session: s,
      state: {},
      get seed() { return seed; },
      get phase() { return phase; },
      get snapshot() { return snapshot; },
      rt: raceTime,
      now: nowMs,
      send: input,
      sfx,
      addStatic(mesh) { statics.push(mesh); scene.add(mesh); return mesh; },
      makeLabel,
      makeBean,
    };

    if (spec.build) spec.build(ctx);
    if (s.disposed) return;
    if (statics.length) {
      const [octMod, capMod] = await Promise.all([import("three/addons/math/Octree.js"), import("three/addons/math/Capsule.js")]);
      if (s.disposed) return;
      const group = new THREE.Group();
      for (const m of statics) { m.updateMatrixWorld(true); const c = m.clone(); c.matrixAutoUpdate = false; c.matrix.copy(m.matrixWorld); group.add(c); }
      octree = new octMod.Octree().fromGraphNode(group);
      capsule = new capMod.Capsule(new THREE.Vector3(), new THREE.Vector3(), RAD);
    }

    // ---------------------------------------------------------------- beans
    function remoteBean(p) {
      let b = beans.get(p.uid);
      const team = TEAMS.includes(p.tm) ? p.tm : "bookis";
      if (b && b.team !== team) { scene.remove(b.bean.group, b.label); b.bean.dispose(); beans.delete(p.uid); b = null; }
      if (!b) {
        const bean = makeBean({ color: p.color, name: p.name, team });
        const label = makeLabel(p.name, p.color);
        scene.add(bean.group, label);
        const at = Array.isArray(p.p) ? p.p : [0, 0, 0];
        b = { uid: p.uid, bean, label, team, pos: new THREE.Vector3(...at), target: new THREE.Vector3(...at), yaw: p.yaw || 0,
          fresh: true, v: [0, 0, 0], a: 0, out: false, outSince: 0, rec: p };
        beans.set(p.uid, b);
      }
      return b;
    }
    s.cleanups.push(() => { for (const b of beans.values()) { try { b.bean.dispose(); } catch (e) { /* ignore */ } } });

    let me = null;                                       // { bean, label, team }
    function ensureMe(rec) {
      if (!rec) return;
      player.color = rec.color || player.color;
      player.name = rec.name || player.name;
      const team = TEAMS.includes(rec.tm) ? rec.tm : myTeam;
      player.team = team;
      if (me && me.team === team) return;
      if (me) { scene.remove(me.bean.group, me.label); me.bean.dispose(); }
      const bean = makeBean({ color: player.color, name: player.name, team });
      const label = makeLabel(player.name, player.color);
      scene.add(bean.group, label);
      me = { bean, label, team };
    }
    s.cleanups.push(() => { if (me) { try { me.bean.dispose(); } catch (e) { /* ignore */ } } });

    // ---------------------------------------------------------------- input
    const isDiveKey = (c) => c === "ShiftLeft" || c === "ShiftRight" || c === "ControlLeft" || c === "ControlRight" || c === "KeyK";
    s.on(document, "keydown", (e) => {
      audio((a) => a.unlock && a.unlock());
      if (e.code === "Space" || e.code.startsWith("Arrow")) e.preventDefault();
      if (e.repeat || keys[e.code]) return;
      keys[e.code] = true;
      if (e.code === "Space") jumpAskedAt = nowMs();
      if (isDiveKey(e.code)) tryDive();
      if (player.out && (e.code === "ArrowLeft" || e.code === "ArrowRight")) cycleSpectate(e.code === "ArrowRight" ? 1 : -1);
      if (e.code === "KeyM") toggleMute();
      if (e.code === "KeyF") {
        if (document.fullscreenElement) document.exitFullscreen();
        else wrap.requestFullscreen?.().catch(() => {});
      }
    });
    s.on(document, "keyup", (e) => { keys[e.code] = false; });
    s.on(window, "blur", () => { for (const k in keys) keys[k] = false; });
    s.on(renderer.domElement, "click", () => {
      audio((a) => a.unlock && a.unlock());
      if (!locked && !matchOver && !DEBUG.nolock) renderer.domElement.requestPointerLock?.();
    });
    s.on(document, "pointerlockchange", () => { locked = document.pointerLockElement === renderer.domElement; });
    s.on(document, "mousemove", (e) => {
      if (!locked) return;
      camYaw -= e.movementX * C.lookSens;
      camPitch = Math.max(C.minPitch, Math.min(C.maxPitch, camPitch + e.movementY * C.lookSens));
      if (e.movementX || e.movementY) lastCamInput = nowMs();
    });
    function toggleMute() {
      audio((a) => a.toggleMute && a.toggleMute());
      hud.setMuted(!!audio((a) => a.muted));
    }
    hud.onMute(toggleMute);
    hud.setMuted(!!audio((a) => a.muted));

    function pollPad() {
      const pads = navigator.getGamepads ? navigator.getGamepads() : [];
      let gp = null;
      for (const p of pads || []) if (p && p.connected) { gp = p; break; }
      if (!gp) { pad.moveF = pad.moveR = pad.lookX = pad.lookY = 0; return; }
      const dz = (v) => (Math.abs(v) < PAD_DEAD ? 0 : (v - Math.sign(v) * PAD_DEAD) / (1 - PAD_DEAD));
      const ax = gp.axes || [];
      pad.moveR = dz(ax[0] || 0); pad.moveF = -dz(ax[1] || 0);
      pad.lookX = dz(ax[2] || 0); pad.lookY = dz(ax[3] || 0);
      const down = (i) => !!(gp.buttons[i] && (gp.buttons[i].pressed || gp.buttons[i].value > 0.5));
      const edge = (i) => down(i) && !pad.prev[i];
      if (edge(0)) { jumpAskedAt = nowMs(); audio((a) => a.unlock && a.unlock()); }
      if (edge(1) || edge(2)) tryDive();
      if (player.out && edge(4)) cycleSpectate(-1);
      if (player.out && edge(5)) cycleSpectate(1);
      pad.prev = gp.buttons.map((b, i) => down(i));
    }

    // Camera-relative wish direction. camYaw is the way the camera looks.
    function wishDir() {
      let f = 0, r = 0;
      if (keys.KeyW) f += 1;
      if (keys.KeyS) f -= 1;
      if (keys.KeyD) r += 1;
      if (keys.KeyA) r -= 1;
      if (DEBUG.holdW) f = 1;
      f += pad.moveF; r += pad.moveR;
      if (Math.hypot(f, r) < 0.05) return null;
      const fx = Math.sin(camYaw), fz = Math.cos(camYaw);
      const x = fx * f - fz * r, z = fz * f + fx * r;
      const l = Math.hypot(x, z);
      return [x / l, z / l];
    }

    function tryDive() {
      if (!canControl() || player.diving || player.stun > 0 || nowMs() - lastDiveAt < F.diveCooldownMs) return;
      const w = wishDir();
      if (w) player.faceYaw = Math.atan2(w[0], w[1]);
      player.diving = true; diveAt = nowMs(); diveLandedAt = 0; lastDiveAt = diveAt;
      bumpedThisDive = new Set();
      vel.x = Math.sin(player.faceYaw) * F.diveSpeed;
      vel.z = Math.cos(player.faceYaw) * F.diveSpeed;
      vel.y = player.onFloor ? Math.max(vel.y, F.diveHop) : Math.max(vel.y, F.diveAirHop);
      player.onFloor = false;
      sfx("dive");
    }

    function knock(v, flash) {
      vel.set(v[0], v[1], v[2]);
      player.onFloor = false;
      player.stun = F.stunS;
      player.diving = false;
      if (flash) hud.flash(flash);
      sfx("knock");
    }

    // ---------------------------------------------------------------- physics
    let colliders = [];                                  // this frame's moving colliders
    const prev = new THREE.Vector3();
    const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3(), tmpP = new THREE.Vector3(), tmpN = new THREE.Vector3();

    // Circle (radius RAD) vs the xz rectangle of a box: push out, and if the
    // box is moving, get carried at least at its speed in its direction.
    function collideBox(b) {
      const top = b.max[1];
      if (pos.y >= top - 0.05 || pos.y + H <= b.min[1]) return;
      const wv = b.vel || [0, 0];
      const cx = Math.max(b.min[0], Math.min(pos.x, b.max[0]));
      const cz = Math.max(b.min[2], Math.min(pos.z, b.max[2]));
      let dx = pos.x - cx, dz = pos.z - cz;
      let d = Math.hypot(dx, dz);
      if (d >= RAD) return;
      // a low box and we're nearly on top: step up instead of being shoved
      if (top - pos.y < 0.3 && vel.y <= 0.5) { pos.y = top; vel.y = 0; player.onFloor = true; lastFloorAt = nowMs(); return; }
      if (d < 1e-6) {
        // centre inside the box: out along its travel (that's where it's shoving us)
        const sx = Math.sign(wv[0]), sz = Math.sign(wv[1]);
        if (sx) pos.x = sx > 0 ? b.max[0] + RAD : b.min[0] - RAD;
        else if (sz) pos.z = sz > 0 ? b.max[2] + RAD : b.min[2] - RAD;
        else {
          // static box: nearest face
          const ex = [b.min[0] - pos.x, b.max[0] - pos.x], ez = [b.min[2] - pos.z, b.max[2] - pos.z];
          const opts = [[Math.abs(ex[0]), -1, 0], [Math.abs(ex[1]), 1, 0], [Math.abs(ez[0]), 0, -1], [Math.abs(ez[1]), 0, 1]].sort((p, q) => p[0] - q[0]);
          const [, ox, oz] = opts[0];
          if (ox) pos.x = ox > 0 ? b.max[0] + RAD : b.min[0] - RAD; else pos.z = oz > 0 ? b.max[2] + RAD : b.min[2] - RAD;
          dx = ox; dz = oz; d = 1;
        }
        if (sx || sz) { dx = sx; dz = sz; d = 1; }
      } else {
        const push = RAD - d;
        pos.x += dx / d * push;
        pos.z += dz / d * push;
      }
      const nx = dx / d, nz = dz / d;
      const wn = wv[0] * nx + wv[1] * nz;
      const vn = vel.x * nx + vel.z * nz;
      if (wn > 0 && vn < wn) { vel.x += nx * (wn - vn); vel.z += nz * (wn - vn); }
      else if (vn < 0) { vel.x -= nx * vn; vel.z -= nz * vn; }
    }

    // The body is a vertical capsule; a capsule/sphere collider pushes it out
    // and, once per cooldown, launches it.
    function collideKnocker(c) {
      if (c.type === "sphere") { tmpA.set(c.c[0], c.c[1], c.c[2]); tmpB.copy(tmpA); }
      else { tmpA.set(c.a[0], c.a[1], c.a[2]); tmpB.set(c.b[0], c.b[1], c.b[2]); }
      // nearest point on the collider to the body's axis, then on the body to that
      tmpP.set(pos.x, pos.y + H / 2, pos.z);
      closestOnSegment(tmpA, tmpB, tmpP, tmpN);
      tmpP.set(pos.x, Math.max(pos.y + RAD, Math.min(pos.y + H - RAD, tmpN.y)), pos.z);
      const dx = tmpP.x - tmpN.x, dy = tmpP.y - tmpN.y, dz = tmpP.z - tmpN.z;
      const d = Math.hypot(dx, dy, dz);
      const reach = RAD + c.r;
      if (d >= reach) return;
      let nx = 0, ny = 1, nz = 0;
      if (d > 1e-6) { nx = dx / d; ny = dy / d; nz = dz / d; }
      pos.x += nx * (reach - d); pos.y += ny * (reach - d); pos.z += nz * (reach - d);
      const id = c.id || "knocker";
      if ((hitCooldown.get(id) || 0) > 0) return;
      hitCooldown.set(id, F.hitCooldownS);
      let v;
      if (typeof c.knockVel === "function") v = c.knockVel(pos);
      else {
        const hl = Math.hypot(nx, nz) || 1;
        const k = c.knock || 10;
        v = [nx / hl * k, c.up !== undefined ? c.up : 5, nz / hl * k];
      }
      knock(v, c.flash);
      if (spec.onHit) spec.onHit(ctx, c);
    }
    function closestOnSegment(a, b, p, out) {
      const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
      const len2 = abx * abx + aby * aby + abz * abz;
      const t = len2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby + (p.z - a.z) * abz) / len2)) : 0;
      return out.set(a.x + abx * t, a.y + aby * t, a.z + abz * t);
    }

    function collideStatics() {
      if (!octree) return;
      capsule.start.set(pos.x, pos.y + RAD, pos.z);
      capsule.end.set(pos.x, pos.y + H - RAD, pos.z);
      const hit = octree.capsuleIntersect(capsule);
      if (!hit) return;
      const n = hit.normal;
      if (n.y > 0.55) {
        if (vel.y <= 0) { vel.y = 0; player.onFloor = true; lastFloorAt = nowMs(); }
      } else {
        const vn = vel.x * n.x + vel.y * n.y + vel.z * n.z;
        if (vn < 0) vel.addScaledVector(n, -vn);
      }
      if (hit.depth >= 1e-10) pos.addScaledVector(n, hit.depth);
    }

    function stepPlayer(dt, rt) {
      const now = nowMs();
      const control = canControl();
      const wish = control && !player.diving ? wishDir() : null;
      player.stun = Math.max(0, player.stun - dt);
      for (const [id, t] of hitCooldown) hitCooldown.set(id, Math.max(0, t - dt));
      const wasOnFloor = player.onFloor;
      const fallSpeed = vel.y;

      if (player.diving) {
        if (player.onFloor) {
          const k = Math.exp(-2.6 * dt);
          vel.x *= k; vel.z *= k;
          if (!diveLandedAt) diveLandedAt = now;
          if (now - diveLandedAt > F.diveSlideMs) player.diving = false;
        }
        if (now - diveAt > 2500) player.diving = false;
      } else {
        const rate = player.stun > 0 ? F.stunRate : (player.onFloor ? F.groundRate : F.airRate);
        const k = 1 - Math.exp(-rate * dt);
        if (wish) {
          vel.x += (wish[0] * F.runSpeed - vel.x) * k;
          vel.z += (wish[1] * F.runSpeed - vel.z) * k;
          let d = Math.atan2(wish[0], wish[1]) - player.faceYaw;
          while (d > Math.PI) d -= Math.PI * 2;
          while (d < -Math.PI) d += Math.PI * 2;
          player.faceYaw += d * (1 - Math.exp(-14 * dt));
        } else if (player.onFloor) {
          vel.x -= vel.x * k; vel.z -= vel.z * k;
        }
      }

      // jump: buffered, with a little coyote time off edges
      if (control && !player.diving && player.stun <= 0 && now - jumpAskedAt < F.jumpBufferMs &&
          (player.onFloor || now - lastFloorAt < F.coyoteMs)) {
        vel.y = F.jumpSpeed; player.onFloor = false; jumpAskedAt = -1e9; lastFloorAt = -1e9;
        sfx("jump");
      }

      vel.y = Math.max(-40, vel.y - F.gravity * dt);
      prev.copy(pos);
      pos.addScaledVector(vel, dt);

      // floors: land on a walkable top the feet crossed this step (one-way)
      player.onFloor = false;
      if (spec.groundAt && vel.y <= 0) {
        const g = spec.groundAt(ctx, pos.x, pos.z, rt, prev.y, pos.y);
        if (g !== null && g !== undefined && g !== false) {
          const top = typeof g === "number" ? g : g.y;
          if (top >= pos.y - 0.02 && (top <= prev.y + 0.02 || (typeof g === "object" && g.snap))) {
            pos.y = top; vel.y = 0; player.onFloor = true; lastFloorAt = now;
            if (spec.onGround) spec.onGround(ctx, g, rt);
          }
        }
      }

      // moving boxes: ride their tops, get shoved by their sides
      for (const c of colliders) {
        if (c.type !== "box") continue;
        const inX = pos.x > c.min[0] - RAD * 0.5 && pos.x < c.max[0] + RAD * 0.5;
        const inZ = pos.z > c.min[2] - RAD * 0.5 && pos.z < c.max[2] + RAD * 0.5;
        if (inX && inZ && pos.y <= c.max[1] && pos.y > c.max[1] - 0.45 && vel.y <= 0) {
          pos.y = c.max[1]; vel.y = 0; player.onFloor = true; lastFloorAt = now;
          if (c.vel) { pos.x += c.vel[0] * dt; pos.z += c.vel[1] * dt; }   // carried along
          continue;
        }
        collideBox(c);
      }
      for (const c of colliders) if (c.type === "capsule" || c.type === "sphere") collideKnocker(c);
      collideStatics();
      if (spec.constrain) spec.constrain(ctx, pos, prev, vel, rt);

      // other beans: push ourselves out; a dive into one is a bump
      for (const [uid, b] of beans) {
        if (b.out || !b.bean.group.visible) continue;
        if (Math.abs(pos.y - b.pos.y) > H - 0.15) continue;
        let dx = pos.x - b.pos.x, dz = pos.z - b.pos.z;
        let d = Math.hypot(dx, dz);
        if (player.diving && d < 1.5 && !bumpedThisDive.has(uid)) {
          bumpedThisDive.add(uid);
          input({ t: "bump", victim: uid, dir: [Math.sin(player.faceYaw), Math.cos(player.faceYaw)] });
          sfx("bump");
        }
        if (d >= RAD * 2) continue;
        if (d < 1e-4) { dx = 1; dz = 0; d = 1; }
        const push = (RAD * 2 - d) * 0.6;
        pos.x += dx / d * push; pos.z += dz / d * push;
      }

      if (player.onFloor && !wasOnFloor && fallSpeed < -7) sfx("land", { volume: Math.min(1, -fallSpeed / 20) });
    }

    // ---------------------------------------------------------------- out / spectate
    function goOut(silent) {
      if (player.out) return;
      player.out = true;
      if (!silent) input({ t: "fell", p: [pos.x, pos.y, pos.z] });
      if (me) me.label.visible = false;
      sfx("out");
      cycleSpectate(0);
    }
    function aliveOthers() { return snapshot.filter((p) => !p.out && p.uid !== player.uid); }
    function cycleSpectate(step) {
      const list = aliveOthers();
      if (!list.length) { spectating = null; return; }
      const i = Math.max(0, list.findIndex((p) => p.uid === spectating));
      spectating = list[(i + step + list.length) % list.length].uid;
    }

    // ---------------------------------------------------------------- network
    s.sock(KEY + "-init", (data) => {
      const first = !player.uid;
      player.uid = data.uid;
      const ghost = beans.get(player.uid);              // never a remote bean of myself
      if (ghost) { scene.remove(ghost.bean.group, ghost.label); ghost.bean.dispose(); beans.delete(player.uid); }
      if (Number.isFinite(data.seed)) seed = data.seed;
      if (data.phase && data.phase !== "loading") syncClock(data.rt);
      ensureMe((data.players || []).find((p) => p.uid === player.uid));
      const sp = spawnOf(data);
      if (first && sp && Array.isArray(sp.pos)) {
        pos.set(sp.pos[0], sp.pos[1], sp.pos[2]); vel.set(0, 0, 0);
        const yaw = spec.spawnYaw !== undefined ? spec.spawnYaw : (sp.yaw || 0);
        player.faceYaw = yaw; camYaw = yaw;
        player.spawned = true;
      }
      if (spec.onInit) spec.onInit(ctx, data);
      if (data.out) goOut(true);
    });

    let lastPhase = phase;
    s.sock(KEY + "-state", (st) => {
      phase = st.phase || phase;
      if (phase === "loading") clockOffset = null; else syncClock(st.rt);
      if (Number.isFinite(st.seed)) seed = st.seed;
      if (Number.isFinite(st.timeLeft) && phase !== "over") timeLeft = st.timeLeft;
      if (Number.isFinite(st.alive)) aliveCount = st.alive; else if (Number.isFinite(st.left)) aliveCount = st.left;
      snapshot = st.players || [];
      const seen = new Set();
      const t = nowMs();
      // Until init says which uid is mine, any of these could be me: a bean
      // built for myself would stand at my spawn and shove me off it.
      for (const p of player.uid ? snapshot : []) {
        if (p.uid === player.uid) {
          ensureMe(p);
          if (p.out && !player.out) goOut(true);
          continue;
        }
        seen.add(p.uid);
        const b = remoteBean(p);
        if (Array.isArray(p.p)) b.target.set(p.p[0], p.p[1], p.p[2]);
        b.yaw = p.yaw || 0; b.v = p.v || [0, 0, 0]; b.a = p.a || 0; b.rec = p;
        if (p.out && !b.out) b.outSince = t;
        b.out = !!p.out;
      }
      for (const [uid, b] of beans) {
        if (seen.has(uid) || !player.uid) continue;
        scene.remove(b.bean.group, b.label); b.bean.dispose(); beans.delete(uid);
      }
      if (player.out && (!spectating || !aliveOthers().some((p) => p.uid === spectating))) cycleSpectate(0);
      if (phase !== lastPhase) { if (phase === "countdown") sfx("pop"); lastPhase = phase; }
      hud.roster(snapshot, phase);
      if (spec.onState) spec.onState(ctx, st);
    });

    s.sock(KEY + "-knock", ({ v, by }) => {
      if (player.out || !Array.isArray(v)) return;
      knock(v);
      hud.toast("BUMPED BY " + String(by || "").toUpperCase() + "!", "#ff9a2a");
    });

    s.sock(KEY + "-out", ({ uid, name, left }) => {
      if (uid === player.uid) { hud.banner("YOU'RE OUT!", "#ff6a3d", "Spectating · ← → to switch"); sfx("pop"); }
      else hud.toast(String(name).toUpperCase() + " IS OUT! · " + left + " LEFT", "#ffd23f");
    });

    s.sock(KEY + "-over", ({ table, endsIn }) => {
      matchOver = true;
      if (document.pointerLockElement) document.exitPointerLock();
      hud.endBoard(table || [], player.uid, endsIn);
      const mine = (table || []).find((r) => r.uid === player.uid);
      const solo = table && table.length === 1;
      const won = mine && (solo ? !mine.out : mine.place === 1);
      sfx(won ? "win" : "lose");
      if (won) sfx("cheer");
    });

    for (const [ev, fn] of Object.entries(spec.on || {})) s.sock(KEY + "-" + ev, (data) => fn(ctx, data));

    // The team was picked in the lobby; it goes with every ready.
    const sayReady = () => {
      input({ t: "team", team: myTeam });
      input({ t: "ready" });
    };
    const readyTimer = setInterval(() => { if (player.uid) { clearInterval(readyTimer); return; } sayReady(); }, 700);
    s.intervals.push(readyTimer);
    sayReady();

    s.intervals.push(setInterval(() => {
      if (!player.spawned || player.out || !player.uid || matchOver) return;
      input({
        t: "state",
        p: [+pos.x.toFixed(2), +pos.y.toFixed(2), +pos.z.toFixed(2)],
        yaw: +player.faceYaw.toFixed(2),
        v: [+vel.x.toFixed(2), +vel.y.toFixed(2), +vel.z.toFixed(2)],
        a: animState(),
      });
    }, F.sendMs));
    function animState() { return player.diving ? 2 : player.stun > 0 ? 3 : player.onFloor ? 0 : 1; }

    // ---------------------------------------------------------------- camera
    const camWant = new THREE.Vector3(), camLook = new THREE.Vector3(), focusPos = new THREE.Vector3();
    let camReady = false;
    function steerCamera(dt) {
      let yawIn = 0, tiltIn = 0;
      if (!player.out) {
        if (keys.ArrowLeft) yawIn += C.keyOrbit;
        if (keys.ArrowRight) yawIn -= C.keyOrbit;
      }
      if (keys.ArrowUp) tiltIn -= C.keyTilt;
      if (keys.ArrowDown) tiltIn += C.keyTilt;
      yawIn -= pad.lookX * C.padOrbit;
      tiltIn += pad.lookY * C.padTilt;
      if (yawIn || tiltIn) {
        camYaw += yawIn * dt;
        camPitch = Math.max(C.minPitch, Math.min(C.maxPitch, camPitch + tiltIn * dt));
        lastCamInput = nowMs();
        return;
      }
      if (!C.autoFollow || player.out || nowMs() - lastCamInput < C.autoIdleMs || !canControl()) return;
      // hands off the camera: ease round behind the way you're running
      const speed = Math.hypot(vel.x, vel.z);
      if (speed < 1.5 || player.diving || player.stun > 0) return;
      let diff = Math.atan2(vel.x, vel.z) - camYaw;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      if (Math.abs(diff) > 2.4) return;                  // running at the camera: leave it
      let step = diff * (1 - Math.exp(-1.8 * dt));
      step = Math.max(-C.autoMax * dt, Math.min(C.autoMax * dt, step));
      camYaw += step;
    }
    function updateCamera(dt) {
      if (spec.introCamera && (phase === "loading" || phase === "countdown")) {
        const shot = spec.introCamera(ctx, nowMs(), raceTime());
        if (shot) {
          camWant.set(shot.pos[0], shot.pos[1], shot.pos[2]);
          if (!camReady) { camera.position.copy(camWant); camReady = true; }
          camera.position.lerp(camWant, 1 - Math.exp(-2 * dt));
          camera.lookAt(shot.look[0], shot.look[1], shot.look[2]);
          return;
        }
      }
      steerCamera(dt);
      let focus = pos;
      if (player.out) {
        const b = spectating && beans.get(spectating);
        focus = b ? b.pos : focusPos.set(0, 0, 0);
      }
      const cp = Math.cos(camPitch), sp = Math.sin(camPitch);
      const baseY = Math.max(focus.y, LAVA_Y + 2);
      camWant.set(focus.x - Math.sin(camYaw) * C.dist * cp, baseY + C.base + C.dist * sp, focus.z - Math.cos(camYaw) * C.dist * cp);
      camLook.set(focus.x, baseY + C.look, focus.z);
      if (spec.cameraClamp) spec.cameraClamp(ctx, camWant, camLook, focus);
      if (!camReady) { camera.position.copy(camWant); camReady = true; }
      camera.position.lerp(camWant, 1 - Math.exp(-8 * dt));
      camera.lookAt(camLook);
    }

    // ---------------------------------------------------------------- loop
    const clock = new THREE.Clock();
    let tSec = 0, stepAcc = 0;
    const lookDir = new THREE.Vector3();
    camera.position.set(0, 12, 16);
    function animate() {
      s.raf = requestAnimationFrame(animate);
      const dt = Math.min(0.05, clock.getDelta());
      tSec += dt;
      const rt = raceTime();
      pollPad();
      colliders = spec.colliders && seed !== null && phase !== "loading" ? (spec.colliders(ctx, rt) || []) : [];

      // keep falling after going out, so you see yourself hit the lava
      if (player.spawned && (!player.out || pos.y > LAVA_Y)) {
        const sub = dt / F.subSteps;
        for (let i = 0; i < F.subSteps; i++) stepPlayer(sub, rt);
        if (!player.out && phase === "play" && rt > 0 && spec.isOut && spec.isOut(ctx, pos, rt)) goOut(false);
        if (pos.y < LAVA_Y) { pos.y = LAVA_Y - 1; vel.set(0, 0, 0); if (player.out) sfx("splash"); }
      }

      // footsteps while running on the ground
      const speed = Math.hypot(vel.x, vel.z);
      if (player.onFloor && speed > 2 && !player.out && !player.diving) {
        stepAcc += dt * speed;
        if (stepAcc > 2.1) { stepAcc = 0; sfx("step", { volume: 0.35 }); }
      } else stepAcc = 0;

      // my bean
      if (me) {
        me.bean.group.visible = pos.y > LAVA_Y + 0.3;
        me.label.visible = false;          // like Fall Guys: your own name never floats in your view
      }
      if (me && me.bean.group.visible) {
        me.bean.group.position.copy(pos);
        me.bean.group.rotation.y = player.faceYaw;
        me.label.position.set(pos.x, pos.y + H + 0.55, pos.z);
        me.bean.update(dt, {
          speed, air: !player.onFloor, vy: vel.y, dive: player.diving, grab: false, grabbed: false,
          stun: player.stun > 0 ? player.stun / F.stunS : 0, burn: 0, t: tSec,
        });
      }
      // everyone else, smoothed towards their last snapshot
      const k = 1 - Math.exp(-14 * dt);
      const tNow = nowMs();
      for (const b of beans.values()) {
        if (b.fresh) { b.pos.copy(b.target); b.fresh = false; }
        b.pos.lerp(b.target, k);
        b.bean.group.position.copy(b.pos);
        b.bean.group.rotation.y = b.yaw;
        b.bean.group.visible = b.pos.y > LAVA_Y + 0.5 && !(b.out && tNow - b.outSince > 1500);
        b.label.visible = !b.out && b.bean.group.visible;
        b.label.position.set(b.pos.x, b.pos.y + H + 0.55, b.pos.z);
        b.bean.update(dt, {
          speed: Math.hypot(b.v[0], b.v[2]), air: b.a === 1 || b.a === 2, vy: b.v[1], dive: b.a === 2,
          grab: false, grabbed: false, stun: b.a === 3 ? 0.8 : 0, burn: 0, t: tSec,
        });
      }

      if (spec.update) spec.update(ctx, dt, rt);
      updateCamera(dt);
      camera.getWorldDirection(lookDir);
      audio((a) => a.setListener && a.setListener(camera.position, Math.atan2(-lookDir.x, -lookDir.z)));
      if (!DEBUG.norender) renderer.render(scene, camera);
      const st = {
        phase, rt, timeLeft, alive: aliveCount, out: player.out,
        spectating: player.out && spectating ? (snapshot.find((p) => p.uid === spectating) || {}).name : "",
      };
      hud.update(st);
      if (spec.hudExtras) spec.hudExtras(ctx, st);
    }
    animate();
    hud.loading(null);

    // for automated testing
    const dbg = {
      get pos() { return pos.toArray(); }, get out() { return player.out; }, get phase() { return phase; },
      get rt() { return raceTime(); }, get onFloor() { return player.onFloor; }, colliders: () => colliders.length,
    };
    window.__party = dbg;
    if (spec.debugGlobal) window[spec.debugGlobal] = dbg;
    s.cleanups.push(() => { if (window.__party === dbg) delete window.__party; if (spec.debugGlobal && window[spec.debugGlobal] === dbg) delete window[spec.debugGlobal]; });
  }

  // ======================================================================
  //                                 HUD
  // ======================================================================
  function buildHud(wrap, spec, roundMs) {
    const layer = document.createElement("div");
    layer.style.cssText = "position:absolute;inset:0;pointer-events:none;font-family:Nunito,sans-serif;color:#fff;z-index:2;";
    wrap.appendChild(layer);
    const el = (css, html) => { const d = document.createElement("div"); d.style.cssText = css; if (html) d.innerHTML = html; layer.appendChild(d); return d; };
    const esc = (str) => String(str).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

    const flashEl = el("position:absolute;inset:0;opacity:0;transition:opacity 350ms;");
    const timer = el("position:absolute;top:10px;left:14px;font-family:" + FONT + ";font-size:1.9rem;" + OUTLINE);
    const aliveEl = el("position:absolute;top:10px;right:14px;font-family:" + FONT + ";font-size:1.5rem;text-align:right;" + OUTLINE);
    const muteEl = el("position:absolute;bottom:12px;right:14px;font-size:1.3rem;cursor:pointer;pointer-events:auto;opacity:0.8;" +
      "filter:drop-shadow(0 2px 3px rgba(0,0,0,0.8));", "🔊");
    muteEl.title = "Sound on/off (M)";
    const centre = el("position:absolute;left:0;right:0;top:18%;text-align:center;font-family:" + FONT + ";font-size:7rem;line-height:1;color:#ffd23f;" + OUTLINE);
    const card = el("position:absolute;left:0;right:0;top:62%;text-align:center;opacity:0;transition:opacity 300ms;");
    card.innerHTML = '<div style="display:inline-block;background:rgba(18,6,20,0.78);border:3px solid rgba(255,246,251,0.28);border-radius:18px;padding:10px 26px;">' +
      '<div style="font-family:' + FONT + ';font-size:1.7rem;color:#ffd23f;' + OUTLINE + '">' + esc(spec.rules || "") + '</div>' +
      '<div style="margin-top:4px;font-weight:900;font-size:1rem;letter-spacing:1px;' + OUTLINE + '">' + esc(spec.rulesSub || "Last one standing wins") + '</div></div>';
    const strip = el("position:absolute;left:50%;bottom:12px;transform:translateX(-50%);padding:6px 14px;border-radius:12px;" +
      "background:rgba(20,6,24,0.72);border:2px solid rgba(255,246,251,0.35);font-size:0.82rem;font-weight:800;white-space:nowrap;opacity:0;transition:opacity 400ms;",
      spec.controlsHtml || ('<b style="color:#ffd23f">WASD</b> run · <b style="color:#ffd23f">← →</b> camera · <b style="color:#ffd23f">Space</b> jump · ' +
        '<b style="color:#ffd23f">Shift/K</b> dive · <b style="color:#ffd23f">M</b> sound · <b style="color:#ffd23f">F</b> fullscreen'));
    const toastEl = el("position:absolute;left:0;right:0;top:34%;text-align:center;font-family:" + FONT + ";font-size:1.6rem;opacity:0;transition:opacity 250ms;" + OUTLINE);
    const bannerEl = el("position:absolute;left:0;right:0;top:26%;text-align:center;opacity:0;transition:opacity 300ms;");
    const specEl = el("position:absolute;left:0;right:0;bottom:48px;text-align:center;font-weight:900;font-size:1rem;opacity:0;" + OUTLINE);
    const loadEl = el("position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;" +
      "background:radial-gradient(ellipse at center,#4a1a2a,#12060c);");
    const endEl = el("position:absolute;inset:0;display:none;align-items:center;justify-content:center;background:rgba(10,3,8,0.86);pointer-events:auto;");

    let toastTimer = 0, bannerTimer = 0, endTimer = 0, flashTimer = 0, lastCount = "", cardShown = false;
    let muteHandler = null;
    muteEl.addEventListener("click", (e) => { e.stopPropagation(); if (muteHandler) muteHandler(); });

    function loadingHtml(title, roster) {
      return '<div style="font-family:' + FONT + ';font-size:3.2rem;color:#ffd23f;' + OUTLINE + '">' + esc(spec.title || spec.key.toUpperCase()) + '</div>' +
        '<div style="font-weight:900;letter-spacing:2px;' + OUTLINE + '">' + esc(title) + '</div>' + (roster || "");
    }
    const cell = spec.endCell || ((r) => (r.out ? (Number(r.survived) || 0).toFixed(1) + " s" : "STANDING"));

    return {
      layer,
      el,
      esc,
      onMute(fn) { muteHandler = fn; },
      setMuted(m) { muteEl.textContent = m ? "🔇" : "🔊"; },
      stopTimers() { clearTimeout(toastTimer); clearTimeout(bannerTimer); clearTimeout(flashTimer); clearInterval(endTimer); },
      loading(text) {
        if (text === null) return;           // the roster keeps it up until the countdown
        loadEl.style.display = "flex";
        loadEl.innerHTML = loadingHtml(text);
      },
      roster(players, phase) {
        if (phase !== "loading") { loadEl.style.display = "none"; return; }
        const ready = players.filter((p) => p.rd).length;
        loadEl.style.display = "flex";
        loadEl.innerHTML = loadingHtml("WAITING FOR PLAYERS… " + ready + " / " + players.length + " READY",
          '<div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:center;max-width:80%">' +
          players.map((p) => '<span style="padding:4px 10px;border-radius:10px;background:rgba(0,0,0,0.4);border:2px solid ' + esc(p.color) + ';font-weight:900">' +
            esc(p.name) + ' ' + (p.rd ? "✓" : "…") + '</span>').join("") + '</div>');
      },
      flash(color) {
        flashEl.style.transition = "none";
        flashEl.style.background = "radial-gradient(ellipse at center,rgba(0,0,0,0) 40%," + color + " 100%)";
        flashEl.style.opacity = "0.8";
        void flashEl.offsetWidth;
        flashEl.style.transition = "opacity 450ms";
        clearTimeout(flashTimer);
        flashTimer = setTimeout(() => { flashEl.style.opacity = "0"; }, 60);
      },
      toast(text, color) {
        toastEl.textContent = text; toastEl.style.color = color || "#fff"; toastEl.style.opacity = "1";
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => { toastEl.style.opacity = "0"; }, 1600);
      },
      banner(text, color, sub, ms) {
        bannerEl.innerHTML = '<div style="font-family:' + FONT + ';font-size:4rem;color:' + color + ';animation:partyPop 450ms both;' + OUTLINE + '">' + esc(text) + '</div>' +
          (sub ? '<div style="font-weight:900;font-size:1.1rem;' + OUTLINE + '">' + esc(sub) + '</div>' : "");
        bannerEl.style.opacity = "1";
        clearTimeout(bannerTimer);
        bannerTimer = setTimeout(() => { bannerEl.style.opacity = "0"; }, ms || 2600);
      },
      endBoard(table, myUid, endsIn) {
        const rows = (table || []).map((r) => {
          const mine = r.uid === myUid;
          return '<tr style="color:' + (mine ? "#ffd23f" : "#fff") + '"><td style="padding:4px 12px;font-family:' + FONT + '">#' + r.place + '</td>' +
            '<td style="padding:4px 12px;font-weight:900;text-align:left">' + esc(r.name) + '</td>' +
            '<td style="padding:4px 12px">' + esc(cell(r)) + '</td>' +
            '<td style="padding:4px 12px;font-weight:900">+' + r.points + '</td></tr>';
        }).join("");
        let title;
        if (spec.endTitle) title = spec.endTitle(table, myUid);
        else {
          const solo = table && table.length === 1;
          const winner = table && table[0] ? table[0].name : "";
          title = solo
            ? "YOU SURVIVED " + (table[0].out ? (Number(table[0].survived) || 0).toFixed(1) + " s" : "THE WHOLE ROUND!")
            : winner + " WINS!";
        }
        endEl.innerHTML = '<div style="text-align:center">' +
          '<div style="font-family:' + FONT + ';font-size:3rem;color:#ffd23f;' + OUTLINE + '">' + esc(title) + '</div>' +
          '<table style="margin:12px auto;border-collapse:collapse;font-size:1.05rem">' + rows + '</table>' +
          '<div class="party-endcount" style="color:#ccb;font-weight:800;letter-spacing:2px"></div></div>';
        endEl.style.display = "flex";
        let left = Math.ceil((endsIn || 6000) / 1000);
        const counter = endEl.querySelector(".party-endcount");
        const tick = () => { counter.textContent = left > 0 ? "RESULTS IN " + left + "s" : ""; left--; };
        tick();
        clearInterval(endTimer);
        endTimer = setInterval(tick, 1000);
      },
      update(st) {
        const secs = (st.phase === "play" || st.phase === "over") && st.rt >= 0 ? st.timeLeft : Math.round(roundMs / 1000);
        const t = Math.floor(secs / 60) + ":" + String(secs % 60).padStart(2, "0");
        if (timer.textContent !== t) timer.textContent = t;
        const a = st.phase === "loading" ? "" : st.alive + ' <span style="font-size:1rem">LEFT</span>';
        if (aliveEl.innerHTML !== a) aliveEl.innerHTML = a;
        let count = "";
        if (st.phase !== "loading" && st.rt < 0 && st.rt >= -3000) count = String(Math.ceil(-st.rt / 1000));
        else if (st.rt >= 0 && st.rt < 700 && st.phase === "play") count = "GO!";
        if (count !== lastCount) {
          centre.textContent = count;
          centre.style.color = count === "GO!" ? "#3fe0ff" : "#ffd23f";
          centre.style.animation = "none"; void centre.offsetWidth;
          if (count) centre.style.animation = "partyCount 650ms both";
          if (count === "GO!") sfx("go");
          else if (count) sfx("tick");
          lastCount = count;
        }
        const showRules = st.phase !== "loading" && st.rt > -3000 && st.rt < 3500;
        if (showRules && !cardShown) sfx("pop");
        cardShown = showRules;
        card.style.opacity = showRules ? "1" : "0";
        strip.style.opacity = st.phase === "play" && st.rt >= 0 && st.rt < 7000 && !st.out ? "1" : "0";
        specEl.style.opacity = st.out ? "1" : "0";
        const spec2 = st.spectating ? "SPECTATING " + String(st.spectating).toUpperCase() + " · ← → TO SWITCH" : "YOU'RE OUT";
        if (specEl.textContent !== spec2) specEl.textContent = spec2;
      },
    };
  }

  window.PARTY_ENGINE = { define, FEEL, CAMERA, sfx };
})();
