// Claudeshot Block Party — walls slide across the platform; find the gap, jump
// the low blocks, don't get shoved into the lava. (Client side, prototype.)
//
// Built on the party engine (party-engine.js), which does the physics, camera,
// controls, beans, HUD, sounds and networking. This file is only what makes
// Block Party Block Party: the platform, and walls that are pure functions of
// (seed, rt) in blockparty-rules.js.

(function () {
  "use strict";

  // Light Bookis theme: the walls are sliding bookshelves, the gaps are
  // missing shelf, the low blocks are stacks of books lying flat, and every
  // 7th wall is a pink Bookis shelf with a "//" doorway. Visuals only - the
  // colliders come from blockparty-rules.js exactly as before.
  const WOOD = "#6b3f22", WOOD_DARK = "#4a2a15", BOOKIS_PINK = "#dc2359";
  const SPINES = ["#dc2359", "#1d1d24", "#f3e9d2", "#2d8f8a", "#ffd23f", "#8f5cff", "#233a7a", "#ff7a2f", "#3fa34d", "#b0243f"];

  function rng(seed) {
    let a = seed | 0;
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // A face of a 2 m x 3.2 m shelf: frame, four shelves, rows of book spines.
  function shelfCanvas(frame, back, seed) {
    const W = 160, H = 256, cv = document.createElement("canvas");
    cv.width = W; cv.height = H;
    const g = cv.getContext("2d"), r = rng(seed);
    g.fillStyle = back; g.fillRect(0, 0, W, H);
    const edge = 10, rows = 4, rowH = (H - edge * 2) / rows;
    for (let row = 0; row < rows; row++) {
      const base = edge + (row + 1) * rowH - 6;
      let x = edge + 2;
      while (x < W - edge - 6) {
        const w = 7 + Math.floor(r() * 9), h = rowH * (0.62 + r() * 0.3);
        if (r() < 0.07) { x += w; continue; }                  // the odd missing book
        g.fillStyle = SPINES[Math.floor(r() * SPINES.length)];
        g.fillRect(x, base - h, w - 1, h);
        g.fillStyle = "rgba(255,255,255,0.35)";                 // little title bands
        g.fillRect(x + 1, base - h * 0.78, w - 3, 2);
        g.fillRect(x + 1, base - h * 0.3, w - 3, 2);
        x += w;
      }
      g.fillStyle = frame; g.fillRect(0, base, W, 6);            // the shelf board
    }
    g.fillStyle = frame;
    g.fillRect(0, 0, W, edge); g.fillRect(0, H - edge, W, edge);
    g.fillRect(0, 0, edge, H); g.fillRect(W - edge, 0, edge, H);
    g.fillStyle = "rgba(0,0,0,0.25)"; g.fillRect(edge, edge, W - edge * 2, 3);
    return cv;
  }

  // Warm library floorboards.
  function floorCanvas() {
    const cv = document.createElement("canvas");
    cv.width = cv.height = 256;
    const g = cv.getContext("2d"), r = rng(11);
    const tones = ["#b9814a", "#a86f3d", "#c48f57", "#9c6534"];
    const plankH = 32;
    for (let y = 0; y < 256; y += plankH) {
      let x = -Math.floor(r() * 120);
      while (x < 256) {
        const len = 90 + Math.floor(r() * 90);
        g.fillStyle = tones[Math.floor(r() * tones.length)];
        g.fillRect(x, y, len, plankH);
        g.fillStyle = "rgba(60,30,10,0.55)";
        g.fillRect(x, y, 2, plankH);
        x += len;
      }
      g.fillStyle = "rgba(60,30,10,0.6)";
      g.fillRect(0, y, 256, 2);
    }
    return cv;
  }

  // The Bookis "//" mark on a pink sign, for the doorway of the Bookis wall.
  function bookisSignCanvas() {
    const cv = document.createElement("canvas");
    cv.width = 512; cv.height = 128;
    const g = cv.getContext("2d");
    g.fillStyle = BOOKIS_PINK; g.fillRect(0, 0, 512, 128);
    g.fillStyle = "#fff";
    g.save(); g.translate(150, 64);                              // the two slanted bars
    for (const dx of [0, 34]) {
      g.save(); g.translate(dx, 0); g.rotate(0.28);
      g.fillRect(-9, -44, 18, 88);
      g.restore();
    }
    g.restore();
    g.font = "900 64px Nunito, sans-serif";
    g.textBaseline = "middle";
    g.fillText("bookis", 215, 66);
    return cv;
  }

  const game = window.PARTY_ENGINE.define({
    key: "blockparty",
    title: "BLOCK PARTY",
    rules: "FIND THE GAP · JUMP THE LOW WALLS · DON'T GET PUSHED OFF",
    rulesSub: "Last one standing wins",
    rulesFile: "blockparty-rules.js",
    rulesGlobal: "BLOCKPARTY_RULES",
    debugGlobal: "__bp",
    player: { radius: 0.45, height: 1.75 },
    countdownMs: 3000,
    roundMs: 150000,
    lavaY: -12,
    spawnYaw: Math.PI,                                   // facing the tower (-z), where the walls come from
    feel: { diveAirHop: 4.5 },
    world: { background: "#3a1420", fog: [40, 110] },

    build(ctx) {
      const { THREE, scene, rules: R } = ctx;

      const tex = (cv, repeat) => {
        const t = new THREE.CanvasTexture(cv);
        t.colorSpace = THREE.SRGBColorSpace;
        t.anisotropy = 4;
        if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat, repeat); }
        return t;
      };

      // the platform: warm library floorboards with a dark wood rim
      const rim = new THREE.MeshLambertMaterial({ color: WOOD_DARK });
      const platform = new THREE.Mesh(new THREE.BoxGeometry(R.HALF * 2, 1, R.HALF * 2), [
        rim, rim, new THREE.MeshLambertMaterial({ map: tex(floorCanvas(), 4) }), rim, rim, rim,
      ]);
      platform.position.y = -0.5;
      scene.add(platform);
      const pillar = new THREE.Mesh(new THREE.CylinderGeometry(3, 4, -R.LAVA_Y, 16), new THREE.MeshLambertMaterial({ color: 0x3a2a33 }));
      pillar.position.y = R.LAVA_Y / 2 - 0.5;
      scene.add(pillar);

      // theme nod: the tower and its eye, where the walls come from
      const tower = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 5, 46, 12), new THREE.MeshLambertMaterial({ color: 0x15101a }));
      tower.position.set(0, R.LAVA_Y + 23, -40);
      scene.add(tower);
      const eye = new THREE.Mesh(new THREE.SphereGeometry(2.6, 24, 16), new THREE.MeshBasicMaterial({ color: 0xff8a1a }));
      eye.position.set(0, R.LAVA_Y + 49, -40);
      eye.scale.set(0.7, 1.3, 0.4);
      scene.add(eye);
      const pupil = new THREE.Mesh(new THREE.BoxGeometry(0.35, 3.6, 0.3), new THREE.MeshBasicMaterial({ color: 0x1a0505 }));
      pupil.position.set(0, R.LAVA_Y + 49, -38.9);
      scene.add(pupil);

      // edge warnings: a red strip along the side a wall is about to come from
      const warnMat = new THREE.MeshBasicMaterial({ color: 0xff2a2a, transparent: true, opacity: 0, depthWrite: false });
      const warnStrips = new Map();                        // "axis,sign" -> mesh
      for (const [axis, sign] of [[0, 1], [0, -1], [1, 1], [1, -1]]) {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(axis === 0 ? 1.2 : R.HALF * 2, axis === 0 ? R.HALF * 2 : 1.2), warnMat.clone());
        m.rotation.x = -Math.PI / 2;
        // a wall travelling +x enters from the -x side
        if (axis === 0) m.position.set(-sign * (R.HALF - 0.6), 0.02, 0);
        else m.position.set(0, 0.02, -sign * (R.HALF - 0.6));
        scene.add(m);
        warnStrips.set(axis + "," + sign, m);
      }

      // Wall cells. Every cell is the same size (CELL across, THICK deep), so
      // each look is one fixed geometry, built with its thin side along local z
      // and turned 90 degrees for walls that travel along x.
      const CELL = (R.HALF * 2) / 8, THICK = 1, FULL_H = 3.2, LOW_H = 0.7;
      const wood = new THREE.MeshLambertMaterial({ color: WOOD });
      const shelfGeo = new THREE.BoxGeometry(CELL, FULL_H, THICK);
      const faces = (face) => [wood, wood, wood, wood, face, face];
      const shelfLooks = [1, 2, 3].map((seed) =>
        faces(new THREE.MeshLambertMaterial({ map: tex(shelfCanvas(WOOD, "#2a170c", seed)) })));
      const bookisLooks = [4, 5].map((seed) =>
        faces(new THREE.MeshLambertMaterial({ map: tex(shelfCanvas(BOOKIS_PINK, "#3a0d1c", seed)) })));

      // a waist-high stack of three chunky books lying flat, merged into one mesh
      const stackGeo = (() => {
        const r = rng(21), parts = [], cream = new THREE.Color("#f3e9d2");
        const bookH = LOW_H / 3;
        for (let b = 0; b < 3; b++) {
          const cover = new THREE.Color(SPINES[Math.floor(r() * SPINES.length)]);
          const w = CELL * (0.86 + r() * 0.12), d = THICK * (0.84 + r() * 0.14);
          const ox = (r() - 0.5) * 0.12, oz = (r() - 0.5) * 0.08, y0 = b * bookH;
          const add = (gw, gh, gd, x, y, z, color) => {
            const geo = new THREE.BoxGeometry(gw, gh, gd).toNonIndexed();
            geo.translate(x, y, z);
            const cols = new Float32Array(geo.attributes.position.count * 3);
            for (let i = 0; i < cols.length; i += 3) { cols[i] = color.r; cols[i + 1] = color.g; cols[i + 2] = color.b; }
            geo.setAttribute("color", new THREE.BufferAttribute(cols, 3));
            parts.push(geo);
          };
          const cov = bookH * 0.16;
          add(w, cov, d, ox, y0 + cov / 2, oz, cover);                          // bottom cover
          add(w, cov, d, ox, y0 + bookH - cov / 2, oz, cover);                  // top cover
          add(w - 0.08, bookH - cov * 2, d - 0.06, ox + 0.03, y0 + bookH / 2, oz, cream);   // pages
          add(0.07, bookH, d, ox - w / 2 + 0.035, y0 + bookH / 2, oz, cover);   // spine
        }
        // merge by hand: every part is non-indexed with the same attributes
        const merged = new THREE.BufferGeometry();
        for (const name of ["position", "normal", "color"]) {
          const total = parts.reduce((n, g) => n + g.attributes[name].array.length, 0);
          const arr = new Float32Array(total);
          let at = 0;
          for (const g of parts) { arr.set(g.attributes[name].array, at); at += g.attributes[name].array.length; }
          merged.setAttribute(name, new THREE.BufferAttribute(arr, 3));
        }
        parts.forEach((g) => g.dispose());
        return merged;
      })();
      const stackMat = new THREE.MeshLambertMaterial({ vertexColors: true });

      const pools = { shelf: [], stack: [] };
      function take(kind, i) {
        const pool = pools[kind];
        while (pool.length <= i) {
          const m = kind === "shelf" ? new THREE.Mesh(shelfGeo, shelfLooks[0]) : new THREE.Mesh(stackGeo, stackMat);
          scene.add(m);
          pool.push(m);
        }
        return pool[i];
      }

      // the Bookis sign that hangs over the doorway of every 7th wall (visual only)
      const signs = [];
      const signMat = new THREE.MeshLambertMaterial({ map: tex(bookisSignCanvas()) });
      const signSide = new THREE.MeshLambertMaterial({ color: BOOKIS_PINK });
      function sign(i) {
        while (signs.length <= i) {
          const m = new THREE.Mesh(new THREE.BoxGeometry(CELL * 2 + 0.6, 0.9, THICK + 0.1),
            [signSide, signSide, signSide, signSide, signMat, signMat]);
          scene.add(m);
          signs.push(m);
        }
        return signs[i];
      }

      Object.assign(ctx.state, {
        eye, warnStrips, take, pools, sign, signs, shelfLooks, bookisLooks, CELL,
        walls: [], warnedWave: -1, slidWave: -1, thudWave: -1,
      });
    },

    // the platform top, forgiving by 0.6 m (you can scramble back up the edge)
    groundAt(ctx, x, z, rt, fromY, toY) {
      const R = ctx.rules;
      if (R.onPlatform(x, z, 0.45 * 0.35) && toY <= 0 && toY > -0.6) return { y: 0, snap: true };
      return null;
    },

    colliders(ctx, rt) {
      const walls = ctx.rules.wallsAt(ctx.seed, rt);
      ctx.state.walls = walls;
      const out = [];
      for (const w of walls) for (const b of w.boxes) out.push({ type: "box", min: b.min, max: b.max, vel: w.vel });
      return out;
    },

    isOut(ctx, pos) { return ctx.rules.isOut(pos.x, pos.y, pos.z); },

    update(ctx, dt, rt) {
      const R = ctx.rules, S = ctx.state;
      if (!S.pools) return;
      S.eye.rotation.y = Math.sin(ctx.now() / 1000 * 0.7) * 0.4;
      let nShelf = 0, nStack = 0, nSign = 0;
      const warn = new Set();
      for (const w of S.walls) {
        const bookis = w.wave.kind === "ark";
        const turn = w.wave.dir[0] === 0 ? Math.PI / 2 : 0;         // thin side along the travel
        for (const b of w.boxes) {
          const m = b.low ? S.take("stack", nStack++) : S.take("shelf", nShelf++);
          m.visible = true;
          if (!b.low) {
            const looks = bookis ? S.bookisLooks : S.shelfLooks;
            m.material = looks[(b.cell + w.wave.i) % looks.length];
          }
          m.rotation.y = turn;
          m.position.set((b.min[0] + b.max[0]) / 2, b.low ? b.min[1] : (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2);
        }
        if (bookis) {
          // hang the "//" sign over the doorway (the run of gap cells)
          const gaps = w.wave.cells.map((c, i) => (c === "G" ? i : -1)).filter((i) => i >= 0);
          if (gaps.length) {
            const mid = -R.HALF + ((gaps[0] + gaps[gaps.length - 1]) / 2 + 0.5) * S.CELL;
            const m = S.sign(nSign++);
            m.visible = true;
            m.rotation.y = turn;
            if (w.wave.dir[0] === 0) m.position.set(w.offset, 3.2 + 0.45, mid);
            else m.position.set(mid, 3.2 + 0.45, w.offset);
          }
        }
        // still off the platform and heading in: light up the edge it will cross
        const [axis, sign] = w.wave.dir;
        if (w.offset * sign < -R.HALF + 0.5) warn.add(axis + "," + sign);
        // a heavy slide as each wall rolls onto the platform
        if (w.wave.i > S.slidWave && w.offset * sign > -R.HALF - 0.5) {
          S.slidWave = w.wave.i;
          ctx.sfx("slide", { volume: 0.7 });
        }
        // and a soft thud as it clears the far edge
        if (w.wave.i > S.thudWave && w.offset * sign > R.HALF + 0.5) {
          S.thudWave = w.wave.i;
          const at = axis === 0 ? { x: w.offset, y: 1.6, z: 0 } : { x: 0, y: 1.6, z: w.offset };
          ctx.sfx("thud", { volume: 0.35, at });
        }
      }
      for (let i = nShelf; i < S.pools.shelf.length; i++) S.pools.shelf[i].visible = false;
      for (let i = nStack; i < S.pools.stack.length; i++) S.pools.stack[i].visible = false;
      for (let i = nSign; i < S.signs.length; i++) S.signs[i].visible = false;
      // upcoming wall that hasn't appeared yet: warn a second early
      if (ctx.seed !== null && rt > 0) {
        let i = 0;
        while (R.waveStart(i) < rt) i++;
        const next = R.wave(ctx.seed, i);
        if (next.t0 - rt < 1000) {
          warn.add(next.dir[0] + "," + next.dir[1]);
          if (S.warnedWave < i && ctx.phase === "play") { S.warnedWave = i; ctx.sfx("warn", { volume: 0.5 }); }
        }
      }
      const pulse = 0.35 + 0.3 * Math.sin(ctx.now() / 90);
      for (const [key, m] of S.warnStrips) m.material.opacity = warn.has(key) ? pulse : 0;
    },
  });

  window.initBlockpartyClient = game.init;
  window.cleanupBlockpartyClient = game.cleanup;
})();
