// Jump Showdown (prototype) - client.
//
// Built on the party engine (party-engine.js), which does the physics, camera,
// controls, beans, HUD, sounds and networking. This file is only what makes
// Jump Showdown Jump Showdown: a round floor of eight paper wedges around a
// stack of giant books with the Eye on top, a LOW bar (a giant pencil) to jump
// over and a HIGH bar (a Bookis bookmark) not to jump into. Bars and falling
// wedges come from showdown-rules.js as pure functions of (seed, rt).

(function () {
  "use strict";

  const BOOKIS_PINK = "#dc2359";
  const FLASH = { low: "#ffb52e", high: BOOKIS_PINK };
  const BOOK_COLORS = [0xdc2359, 0x1d1420, 0x3fe0ff, 0xffd23f, 0x8f5cff, 0xfff6fb, 0xff4fa0, 0x2a2a2a];

  // The shared rules for this round's seed (built once per seed).
  function sd(ctx) {
    const S = ctx.state;
    if (ctx.seed === null || ctx.seed === undefined) return null;
    if (!S.sd || S.sd.seed !== ctx.seed) S.sd = ctx.rules.create(ctx.seed);
    return S.sd;
  }

  function canvasTexture(THREE, w, h, draw) {
    const cv = document.createElement("canvas");
    cv.width = w; cv.height = h;
    draw(cv.getContext("2d"), w, h);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    return tex;
  }

  // shortest distance from p to the segment a-b, and the nearest point on it
  function segDist(a, b, p, out) {
    const abx = b[0] - a[0], aby = b[1] - a[1], abz = b[2] - a[2];
    const len2 = abx * abx + aby * aby + abz * abz || 1;
    const t = Math.max(0, Math.min(1, ((p.x - a[0]) * abx + (p.y - a[1]) * aby + (p.z - a[2]) * abz) / len2));
    out.x = a[0] + abx * t; out.y = a[1] + aby * t; out.z = a[2] + abz * t;
    return Math.hypot(p.x - out.x, p.y - out.y, p.z - out.z);
  }

  const game = window.PARTY_ENGINE.define({
    key: "showdown",
    title: "JUMP SHOWDOWN",
    rules: "JUMP THE PENCIL · DON'T JUMP INTO THE BOOKMARK",
    rulesSub: "Last one standing wins",
    rulesFile: "showdown-rules.js",
    rulesGlobal: "SHOWDOWN_RULES",
    debugGlobal: "__sd",
    player: { radius: 0.45, height: 1.75 },
    countdownMs: 3000,
    roundMs: 150000,
    lavaY: -9,
    // the prototype's own feel: a touch floatier in the air, longer stun
    feel: {
      groundRate: 12, airRate: 2.5, stunRate: 0.36, coyoteMs: 100, jumpBufferMs: 120,
      diveSpeed: 10, diveHop: 4.5, diveAirHop: 1.5, diveSlideMs: 380, diveCooldownMs: 850,
      stunS: 0.7, hitCooldownS: 0.35,
    },
    camera: { fov: 66, dist: 8, base: 2.6, pitch: 0.28, minPitch: -0.05, maxPitch: 1.1, look: 1.2, keyOrbit: 1.9 },
    world: { background: "#2a0f1c", fog: [38, 110], hemi: [0xffe6cc, 0x3a1020, 1.5], sun: [0xffffff, 1.5, 14, 26, 10] },

    build(ctx) {
      const { THREE, scene } = ctx;
      const RULES = ctx.rules;

      // far-off dark peaks, just for a horizon
      const peakMat = new THREE.MeshLambertMaterial({ color: 0x1a0a12 });
      for (let i = 0; i < 14; i++) {
        const a = i / 14 * Math.PI * 2;
        const h = 14 + (i * 7) % 11;
        const cone = new THREE.Mesh(new THREE.ConeGeometry(9 + (i % 3) * 3, h, 5), peakMat);
        cone.position.set(Math.cos(a) * 78, RULES.LAVA_Y + h / 2, Math.sin(a) * 78);
        scene.add(cone);
      }

      // ---- the floor: eight wedges of lined paper, a pink page edge round the rim
      const paper = canvasTexture(THREE, 256, 256, (c, w, h) => {
        c.fillStyle = "#ffffff"; c.fillRect(0, 0, w, h);
        c.fillStyle = "rgba(90,150,220,0.45)";
        for (let y = 16; y < h; y += 32) c.fillRect(0, y, w, 3);
      });
      paper.repeat.set(0.25, 0.25);                        // UVs are metres: a line every 0.5 m
      const segMeshes = [];
      for (let i = 0; i < RULES.SEGMENTS; i++) {
        const a0 = i * RULES.SEG_ANGLE + 0.012, a1 = (i + 1) * RULES.SEG_ANGLE - 0.012;
        const shape = new THREE.Shape();
        const steps = 14;
        // shape y is world -z after the rotation below, so azimuth a -> (cos a, -sin a)
        for (let k = 0; k <= steps; k++) {
          const a = a0 + (a1 - a0) * k / steps;
          const x = Math.cos(a) * RULES.ARENA_R, y = -Math.sin(a) * RULES.ARENA_R;
          if (k === 0) shape.moveTo(x, y); else shape.lineTo(x, y);
        }
        for (let k = steps; k >= 0; k--) {
          const a = a0 + (a1 - a0) * k / steps;
          shape.lineTo(Math.cos(a) * RULES.POST_R, -Math.sin(a) * RULES.POST_R);
        }
        const geo = new THREE.ExtrudeGeometry(shape, { depth: 1, bevelEnabled: false });
        geo.rotateX(-Math.PI / 2);
        geo.translate(0, -1, 0);
        const top = new THREE.MeshLambertMaterial({ map: paper, color: i % 2 ? 0xf6f0e2 : 0xffffff, emissive: 0x000000 });
        const side = new THREE.MeshLambertMaterial({ color: 0xefe4cc, emissive: 0x000000 });
        const mesh = new THREE.Mesh(geo, [top, side]);
        scene.add(mesh);
        const lipGeo = new THREE.TorusGeometry(RULES.ARENA_R, 0.12, 6, 18, a1 - a0);
        lipGeo.rotateX(Math.PI / 2);
        lipGeo.rotateY(-a0);
        mesh.add(new THREE.Mesh(lipGeo, new THREE.MeshLambertMaterial({ color: 0xff4fa0 })));
        segMeshes.push({ mesh, mats: [top, side] });
      }

      // ---- the post: a leaning stack of giant books, the Eye on top
      const pages = new THREE.MeshLambertMaterial({ color: 0xfbf3df });
      const stack = new THREE.Group();
      let y = -1;
      for (let i = 0; y < RULES.POST_H - 0.2; i++) {
        const t = 0.55 + ((i * 37) % 5) * 0.07;           // thickness
        const w = 2.3 + ((i * 13) % 3) * 0.12, d = 1.9 + ((i * 7) % 3) * 0.1;
        const cover = new THREE.MeshLambertMaterial({ color: BOOK_COLORS[i % BOOK_COLORS.length] });
        const book = new THREE.Group();
        const block = new THREE.Mesh(new THREE.BoxGeometry(w - 0.1, t - 0.1, d - 0.08), pages);
        block.position.x = 0.03;
        const boardGeo = new THREE.BoxGeometry(w, 0.06, d);
        const lower = new THREE.Mesh(boardGeo, cover);
        lower.position.y = -t / 2 + 0.03;
        const upper = new THREE.Mesh(boardGeo, cover);
        upper.position.y = t / 2 - 0.03;
        const spine = new THREE.Mesh(new THREE.BoxGeometry(0.08, t, d), cover);
        spine.position.x = -w / 2 + 0.04;
        book.add(block, lower, upper, spine);
        book.position.y = y + t / 2;
        book.rotation.y = ((i * 53) % 17) / 17 * 1.2 - 0.6;
        stack.add(book);
        y += t;
      }
      scene.add(stack);
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.95, 24, 16), new THREE.MeshBasicMaterial({ color: 0xff8a1a }));
      eye.position.y = RULES.POST_H + 0.7;
      scene.add(eye);
      const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.5, 16, 12), new THREE.MeshBasicMaterial({ color: 0x120304 }));
      pupil.scale.set(0.25, 1.4, 0.4);
      eye.add(pupil);
      const eyeLight = new THREE.PointLight(0xff7a1a, 30, 30, 2);
      eyeLight.position.copy(eye.position);
      scene.add(eyeLight);

      // ---- the LOW bar: a giant pencil, eraser at the post, point outward
      // Every part is laid along +x in its pivot, from rIn to rOut; the collider
      // is the rules file's capsule, the pencil just dresses it.
      const alongX = (geo) => { geo.rotateZ(-Math.PI / 2); return geo; };   // +y -> +x
      const low = RULES.BARS[0], high = RULES.BARS[1];
      const lowPivot = new THREE.Group();
      lowPivot.position.y = low.height;
      const pencilBody = new THREE.MeshLambertMaterial({ color: 0xffc21a, emissive: 0x000000 });
      const tipStart = low.rOut - 1.1;
      const bodyLen = tipStart - (low.rIn + 0.55);
      const body = new THREE.Mesh(alongX(new THREE.CylinderGeometry(0.3, 0.3, bodyLen, 6)), pencilBody);
      body.position.x = low.rIn + 0.55 + bodyLen / 2;
      const ferrule = new THREE.Mesh(alongX(new THREE.CylinderGeometry(0.31, 0.31, 0.3, 16)),
        new THREE.MeshLambertMaterial({ color: 0xc9ccd6 }));
      ferrule.position.x = low.rIn + 0.4;
      const eraser = new THREE.Mesh(alongX(new THREE.CylinderGeometry(0.29, 0.29, 0.3, 16)),
        new THREE.MeshLambertMaterial({ color: 0xff86b0 }));
      eraser.position.x = low.rIn + 0.1;
      const wood = new THREE.Mesh(alongX(new THREE.ConeGeometry(0.3, 1.2, 6)), new THREE.MeshLambertMaterial({ color: 0xf2c79a }));
      wood.position.x = tipStart + 0.6;
      const lead = new THREE.Mesh(alongX(new THREE.ConeGeometry(0.105, 0.4, 6)), new THREE.MeshLambertMaterial({ color: 0x2b2b2e }));
      lead.position.x = tipStart + 1.2 - 0.2;
      lowPivot.add(body, ferrule, eraser, wood, lead);
      scene.add(lowPivot);

      // ---- the HIGH bar: a pink Bookis bookmark ribbon with the "//" mark
      const mark = canvasTexture(THREE, 256, 128, (c, w, h) => {
        c.fillStyle = BOOKIS_PINK; c.fillRect(0, 0, w, h);
        c.fillStyle = "#ffffff";
        for (const x0 of [96, 140]) {                      // two slanted bars, like the logo
          c.beginPath();
          c.moveTo(x0 + 18, 22); c.lineTo(x0 + 36, 22); c.lineTo(x0 + 18, 106); c.lineTo(x0, 106);
          c.closePath(); c.fill();
        }
      });
      const hh = 0.32;
      mark.repeat.set(0.5, 1 / (hh * 2));                  // a mark every 2 m along the ribbon
      mark.offset.set(0, 0.5);
      const ribbon = new THREE.Shape();
      ribbon.moveTo(high.rIn, -hh);
      ribbon.lineTo(high.rOut + 0.3, -hh);
      ribbon.lineTo(high.rOut - 0.25, 0);                  // the swallowtail notch at the end
      ribbon.lineTo(high.rOut + 0.3, hh);
      ribbon.lineTo(high.rIn, hh);
      ribbon.closePath();
      const ribbonGeo = new THREE.ExtrudeGeometry(ribbon, { depth: 0.07, bevelEnabled: false });
      ribbonGeo.translate(0, 0, -0.035);
      const ribbonMat = new THREE.MeshLambertMaterial({ map: mark, emissive: 0x000000, side: THREE.DoubleSide });
      const highPivot = new THREE.Group();
      highPivot.position.y = high.height;
      highPivot.add(new THREE.Mesh(ribbonGeo, [ribbonMat, new THREE.MeshLambertMaterial({ color: 0xa8123f })]));
      scene.add(highPivot);

      // "FLOOR DROPPING!" warning
      const warnEl = ctx.hud.el("position:absolute;left:0;right:0;top:64px;text-align:center;font-family:'Titan One',Nunito,sans-serif;" +
        "font-size:1.4rem;color:#ff6a3d;opacity:0;-webkit-text-stroke:2px #2b0f3a;paint-order:stroke fill;text-shadow:0 4px 0 #2b0f3a;",
        "FLOOR DROPPING!");

      Object.assign(ctx.state, {
        segMeshes, eye, eyeLight, warnEl,
        bars: [{ pivot: lowPivot, mats: [pencilBody] }, { pivot: highPivot, mats: [ribbonMat] }],
        segPrev: segMeshes.map(() => ({ warn: false, alive: true })),
        flipPrev: [false, false],
        near: [99, 99], whooshAt: [0, 0],
        whirr: null, warnSoon: false,
      });
      ctx.session.cleanups.push(() => { for (const l of ctx.state.whirr || []) { try { l.stop(); } catch (e) { /* ignore */ } } });
    },

    // the floor: flat at y = 0 wherever a wedge still is
    groundAt(ctx, x, z, rt) {
      const r = sd(ctx);
      return r && r.floorAt(x, z, rt) ? 0 : null;
    },

    // the bars: capsules that sweep round, launching you along their sweep
    colliders(ctx, rt) {
      const r = sd(ctx);
      if (!r) return [];
      return ctx.rules.BARS.map((cfg, b) => {
        const pose = r.barPose(b, rt);
        return {
          type: "capsule", id: cfg.id, a: pose.a, b: pose.b, r: pose.r, flash: FLASH[cfg.id],
          knockVel(pos) {
            // launched along the bar's sweep, a little outward and up
            const a = pose.angle, sgn = pose.omega >= 0 ? 1 : -1;
            const rOut = Math.hypot(pos.x, pos.z) || 1;
            const speed = cfg.knock + Math.abs(pose.omega) * 2;
            return [-Math.sin(a) * sgn * speed + pos.x / rOut * 3, b === 0 ? 6 : 4, Math.cos(a) * sgn * speed + pos.z / rOut * 3];
          },
        };
      });
    },

    // the book stack in the middle, and never sinking sideways into the slab
    constrain(ctx, pos, prev, vel, rt) {
      const RULES = ctx.rules, R = 0.45;
      const r = Math.hypot(pos.x, pos.z);
      if (r < RULES.POST_R + R && pos.y < RULES.POST_H) {
        const k = (RULES.POST_R + R) / (r || 1);
        pos.x = (r ? pos.x : 1) * k; pos.z *= r ? k : 0;
      }
      const s = sd(ctx);
      if (s && pos.y < -0.02 && pos.y > -1.0 && s.floorAt(pos.x, pos.z, rt)) {
        const rr = Math.hypot(pos.x, pos.z);
        if (rr > RULES.ARENA_R - 1.2) {
          const k = (RULES.ARENA_R + 0.02) / rr;
          pos.x *= k; pos.z *= k;
          vel.x *= 0.2; vel.z *= 0.2;
        } else {
          pos.x = prev.x; pos.z = prev.z;
          vel.x = 0; vel.z = 0;
        }
      }
    },

    isOut(ctx, pos) { return pos.y < ctx.rules.KILL_Y; },

    // a slow orbit of the arena until GO
    introCamera(ctx, now) {
      const a = now / 4000;
      return { pos: [Math.cos(a) * 20, 9, Math.sin(a) * 20], look: [0, 1.2, 0] };
    },

    update(ctx, dt, rt) {
      const S = ctx.state, r = sd(ctx), RULES = ctx.rules;
      if (!S.segMeshes) return;
      const t = ctx.now() / 1000;
      S.eyeLight.intensity = 26 + Math.sin(t * 3) * 6;
      if (!r) return;
      const live = ctx.phase === "play" && rt > 0;

      // wedges: shake and glow red before they go, then fall away
      let warnSoon = false;
      for (let i = 0; i < S.segMeshes.length; i++) {
        const st = r.segmentState(i, rt);
        const { mesh, mats } = S.segMeshes[i];
        const prev = S.segPrev[i];
        if (st.alive) {
          const shake = st.warn > 0 ? Math.sin(rt / 30) * 0.06 * st.warn : 0;
          mesh.position.set(shake, 0, -shake);
          const glow = st.warn > 0 ? 0.6 * (0.5 + 0.5 * Math.sin(rt / 90)) : 0;
          for (const m of mats) m.emissive.setRGB(glow, 0, 0);
          mesh.visible = true;
          if (st.warn > 0) warnSoon = true;
          // it starts to shake: a warning and a crack from under that wedge
          if (st.warn > 0 && !prev.warn && live && st.warn < 0.15) {
            const mid = (i + 0.5) * RULES.SEG_ANGLE;
            ctx.sfx("warn", { volume: 0.6 });
            ctx.sfx("crack", { at: { x: Math.cos(mid) * 6, y: 0, z: Math.sin(mid) * 6 } });
          }
        } else {
          const f = st.fallMs / 1000;
          mesh.position.y = -0.5 * 25 * f * f;
          mesh.visible = mesh.position.y > RULES.LAVA_Y - 4;
          for (const m of mats) m.emissive.setRGB(0, 0, 0);
          // it goes: a page tearing out and dropping away
          if (prev.alive && live && st.fallMs < 400) { ctx.sfx("tear"); ctx.sfx("fall", { volume: 0.8 }); }
        }
        prev.warn = st.warn > 0;
        prev.alive = st.alive;
      }
      S.warnSoon = warnSoon;

      // bars: sweep round, flash before a reversal
      const me = ctx.player.pos;
      const ear = ctx.player.out ? ctx.camera.position : { x: me.x, y: me.y + 1, z: me.z };
      const near = { x: 0, y: 0, z: 0 };
      const A = window.PARTY_AUDIO;
      if (!S.whirr && A && typeof A.loop === "function" && ctx.phase !== "loading") {
        try { S.whirr = [A.loop("whirr", { volume: 0 }), A.loop("whirr", { volume: 0 })]; } catch (e) { S.whirr = []; }
      }
      RULES.BARS.forEach((cfg, b) => {
        const pose = r.barPose(b, rt);
        S.bars[b].pivot.rotation.y = -pose.angle;
        const flash = pose.flipSoon ? 0.5 + 0.5 * Math.sin(rt / 60) : 0;
        for (const m of S.bars[b].mats) m.emissive.setRGB(flash * 0.9, flash * 0.8, flash * 0.2);
        if (pose.flipSoon && !S.flipPrev[b] && live) ctx.sfx("warn", { volume: 0.35, pitch: b === 0 ? 1.15 : 0.85 });
        S.flipPrev[b] = pose.flipSoon;

        // how close the bar is to you: the whirr swells as it comes round
        const d = segDist(pose.a, pose.b, ear, near);
        const w = S.whirr && S.whirr[b];
        if (w) {
          const spin = Math.abs(pose.omega);
          const vol = ctx.phase === "over" ? 0 : Math.min(1, spin / 0.5) * (0.06 + 0.3 * Math.max(0, 1 - d / 16));
          try { w.set({ volume: vol, pitch: 0.6 + spin * 0.45 + b * 0.25 }); } catch (e) { /* ignore */ }
        }
        // a near miss: it whooshes past
        if (live && !ctx.player.out && d < 2.2 && S.near[b] >= 2.2 && d > 0.45 + pose.r + 0.05 &&
            Math.abs(pose.omega) > 0.4 && t - S.whooshAt[b] > 0.8) {
          S.whooshAt[b] = t;
          ctx.sfx("whoosh", { volume: 0.7, at: { x: near.x, y: near.y, z: near.z } });
        }
        S.near[b] = d;
      });
      S.eye.rotation.y = -(r.barPose(0, rt).angle);
    },

    hudExtras(ctx, st) {
      const S = ctx.state;
      if (!S.warnEl) return;
      const on = S.warnSoon && st.phase === "play" && !st.out;
      S.warnEl.style.opacity = on ? (0.6 + 0.4 * Math.sin(ctx.now() / 90)).toFixed(2) : "0";
    },

    endCell(r) { return r.out ? (r.survivedMs / 1000).toFixed(1) + " s" : "survived"; },

    // survivors share first place; solo says how long you lasted
    endTitle(table) {
      if (table && table.length === 1) {
        return table[0].out ? "YOU LASTED " + (table[0].survivedMs / 1000).toFixed(1) + " s" : "YOU SURVIVED!";
      }
      const winners = (table || []).filter((r) => r.place === 1).map((r) => r.name).join(" & ");
      return winners + " WINS!";
    },
  });

  window.initShowdownClient = game.init;
  window.cleanupShowdownClient = game.cleanup;
})();
