// Claudeshot Hex-A-Gone — last one standing on falling hex tiles (client side, prototype).
//
// Built on the party engine (party-engine.js), which does the physics, camera,
// controls, beans, HUD, sounds and networking. This file is only what makes
// Hex-A-Gone Hex-A-Gone: three floors of hex tiles that fall a moment after
// anyone stands on them.
//
// The tiles are one-way floors (groundAt): you can jump up through a hole but
// never fall through a tile that's still up. The server decides when each tile
// falls and tells everyone the exact time; this client also predicts its own
// touches so a tile reacts the instant you step on it.

(function () {
  "use strict";

  const TILE_DROP_MS = 1600;          // a fallen tile tumbles this long, then it's gone
  // Bookis palette, top floor to bottom, each tile with a thin black rim
  const FLOOR_COLORS = [0xdc2359, 0xf28bb0, 0xfff4e6];
  const RIM_COLOR = 0x1a0a12;
  const SOUND_NEAR = 16;              // metres: tile sounds further away than this are skipped

  const game = window.PARTY_ENGINE.define({
    key: "hexagone",
    title: "HEX-A-GONE",
    rules: "EVERY TILE YOU TOUCH FALLS · KEEP MOVING",
    rulesSub: "Drop through the floors · last one standing wins",
    rulesFile: "hexagone-rules.js",
    rulesGlobal: "HEX_RULES",
    debugGlobal: "__hex",
    player: { radius: 0.45, height: 1.75 },
    countdownMs: 3000,
    roundMs: 180000,
    lavaY: -34,                                          // HEX_RULES.LAVA_Y
    feel: { subSteps: 5 },
    // floors are 9 m apart: a close camera that fits under the floor above
    camera: { dist: 8.5, base: 1.6, pitch: 0.42 },
    world: { background: "#2b0d1e", fog: [45, 150], hemi: [0xffe6f2, 0x3a1020, 1.25], sun: [0xffffff, 1.5, 20, 40, 12] },

    build(ctx) {
      const { THREE, scene, rules: R } = ctx;

      // a nod to the Dark Tower: a dark column in the distance with a burning
      // eye, and a pink Bookis "//" on its face
      const tower = new THREE.Mesh(new THREE.CylinderGeometry(3.5, 7, 64, 10), new THREE.MeshLambertMaterial({ color: 0x1a1016 }));
      tower.position.set(0, R.LAVA_Y + 32, -52);
      scene.add(tower);
      const eye = new THREE.Mesh(new THREE.SphereGeometry(3.2, 20, 14), new THREE.MeshBasicMaterial({ color: 0xff7a1a }));
      eye.scale.set(0.75, 1.25, 0.75);
      eye.position.set(0, R.LAVA_Y + 68, -52);
      scene.add(eye);
      const pupil = new THREE.Mesh(new THREE.BoxGeometry(0.7, 5, 0.4), new THREE.MeshBasicMaterial({ color: 0x1a0505 }));
      pupil.position.set(0, eye.position.y, eye.position.z + 2.3);
      scene.add(pupil);
      const markMat = new THREE.MeshBasicMaterial({ color: 0xdc2359 });
      for (const [dx, h] of [[-1.1, 3.4], [0.9, 4.6]]) {
        const bar = new THREE.Mesh(new THREE.BoxGeometry(1.1, h, 0.3), markMat);
        bar.position.set(dx, R.LAVA_Y + 50 + (h - 4.6) / 2, -52 + 4.6);
        bar.rotation.z = -0.18;                            // the mark leans like the logo
        scene.add(bar);
      }

      // One pair of InstancedMeshes per floor: a black rim hex and a coloured
      // top a touch smaller and higher, so every tile has a thin dark edge.
      // Only tiles that are shaking or falling are touched each frame.
      const rimGeo = new THREE.CylinderGeometry(R.HEX_SIZE * 0.97, R.HEX_SIZE * 0.97, R.TILE_THICK, 6);
      rimGeo.translate(0, -R.TILE_THICK / 2 - 0.01, 0);    // origin at the top face
      const topGeo = new THREE.CylinderGeometry(R.HEX_SIZE * 0.9, R.HEX_SIZE * 0.9, R.TILE_THICK, 6);
      topGeo.translate(0, -R.TILE_THICK / 2, 0);
      const rimMat = new THREE.MeshLambertMaterial({ color: RIM_COLOR });
      const layers = R.LAYERS.map((L, li) => {
        const ids = R.tiles.filter((t) => t.layer === li).map((t) => t.id);
        const rim = new THREE.InstancedMesh(rimGeo, rimMat, ids.length);
        const top = new THREE.InstancedMesh(topGeo, new THREE.MeshLambertMaterial({ color: 0xffffff }), ids.length);
        const base = new THREE.Color(FLOOR_COLORS[li] !== undefined ? FLOOR_COLORS[li] : L.color);
        const colors = ids.map((id, i) => {
          const t = R.tiles[id];
          const c = base.clone().offsetHSL(0, 0, ((t.q * 7 + t.r * 13) % 5 - 2) * 0.02);
          top.setColorAt(i, c);
          return c;
        });
        scene.add(rim, top);
        return { rim, top, ids, colors };
      });
      const slot = new Map();                              // tile id -> [layer, instance]
      layers.forEach((L, li) => L.ids.forEach((id, i) => slot.set(id, [li, i])));

      const m4 = new THREE.Matrix4(), q4 = new THREE.Quaternion(), v3 = new THREE.Vector3();
      const one = new THREE.Vector3(1, 1, 1), zero = new THREE.Vector3(0, 0, 0);
      const white = new THREE.Color(0xffffff), tmpColor = new THREE.Color();
      function placeTile(id, dx, dy, dz, rot, shown) {
        const [li, i] = slot.get(id);
        const t = R.tiles[id];
        q4.setFromAxisAngle(v3.set(1, 0, 0.4).normalize(), rot);
        m4.compose(v3.set(t.x + dx, t.y + dy, t.z + dz), q4, shown ? one : zero);
        for (const mesh of [layers[li].rim, layers[li].top]) { mesh.setMatrixAt(i, m4); mesh.instanceMatrix.needsUpdate = true; }
      }
      function tintTile(id, flash) {
        const [li, i] = slot.get(id);
        tmpColor.copy(layers[li].colors[i]).lerp(white, flash);
        layers[li].top.setColorAt(i, tmpColor);
        layers[li].top.instanceColor.needsUpdate = true;
      }
      for (const t of R.tiles) placeTile(t.id, 0, 0, 0, 0, true);

      Object.assign(ctx.state, {
        eye, placeTile, tintTile,
        serverFall: new Map(),                             // tile id -> rt it drops (authoritative)
        localFall: new Map(),                              // my own predicted touches
        gone: new Set(),                                   // finished falling
        dropped: new Set(),                                // started dropping (for the "fall" sound)
        warned: new Set(),
        floor: 0,                                          // the floor I last stood on
        lastCrackAt: 0, lastFallSfxAt: 0, lastWarnAt: 0,
      });
    },

    // Land on the floor the feet crossed this step, if a tile there is still up.
    groundAt(ctx, x, z, rt, fromY, toY) {
      const R = ctx.rules, S = ctx.state;
      if (!S.serverFall) return null;
      for (let li = 0; li < R.LAYERS.length; li++) {
        const top = R.LAYERS[li].y;
        if (fromY < top - 0.02 || toY > top + 0.02) continue;
        const under = R.tilesUnder(li, x, z).filter((id) => isUp(S, id, rt));
        if (under.length) return { y: top, data: { layer: li, tiles: under } };
      }
      return null;
    },

    onGround(ctx, contact, rt) {
      const S = ctx.state, R = ctx.rules;
      const { layer, tiles } = contact.data;
      // landed on a lower floor after falling through a hole
      if (layer > S.floor) ctx.sfx("thud", { volume: 0.8 });
      S.floor = layer;
      if (rt < 0 || ctx.phase !== "play") return;
      for (const id of tiles) {
        // predict the fall of what we stand on; the server's time replaces it
        if (!S.serverFall.has(id) && !S.localFall.has(id)) {
          S.localFall.set(id, rt + R.FALL_DELAY_MS);
          crack(ctx, id);
        }
        // about to go from under my feet: a small, subtle alarm
        const left = fallTime(S, id) - rt;
        if (left < 200 && !S.warned.has(id) && ctx.now() - S.lastWarnAt > 400) {
          S.warned.add(id);
          S.lastWarnAt = ctx.now();
          ctx.sfx("warn", { volume: 0.15, pitch: 1.3 });
        }
      }
    },

    onInit(ctx, data) {
      const S = ctx.state;
      if (!S.serverFall) return;
      for (const [id, at] of data.tiles || []) { S.serverFall.set(id, at); S.localFall.delete(id); }
    },

    on: {
      tiles(ctx, { add }) {
        const S = ctx.state;
        if (!S.serverFall) return;
        for (const [id, at] of add || []) {
          const known = S.serverFall.has(id) || S.localFall.has(id);
          S.serverFall.set(id, at);
          S.localFall.delete(id);
          if (!known) crack(ctx, id);
        }
      },
    },

    isOut(ctx, pos) { return pos.y < ctx.rules.KILL_Y; },

    // Between floors, stay under the floor above: otherwise the view fills
    // with the underside of the tiles you just dropped through.
    cameraClamp(ctx, camPos, look, focus) {
      const R = ctx.rules;
      let ceiling = Infinity;
      for (const L of R.LAYERS) if (L.y > focus.y + 0.6) ceiling = Math.min(ceiling, L.y - R.TILE_THICK - 0.5);
      if (camPos.y > ceiling) camPos.y = ceiling;
      look.y = focus.y + Math.min(1.4, Math.max(0.4, ceiling - focus.y - 1.5));
    },

    update(ctx, dt, rt) {
      const S = ctx.state;
      if (!S.serverFall) return;
      S.eye.rotation.y = Math.sin(ctx.now() / 1000 * 0.6) * 0.4;
      const ids = new Set([...S.serverFall.keys(), ...S.localFall.keys()]);
      for (const id of ids) {
        if (S.gone.has(id)) continue;
        const at = fallTime(S, id);
        if (rt < at) {
          // warning: flash, sink a little, shiver
          const u = Math.max(0, Math.min(1, 1 - (at - rt) / ctx.rules.FALL_DELAY_MS));
          const wob = Math.sin(rt / 22) * 0.05 * u;
          S.placeTile(id, wob, -0.18 * u, -wob, 0, true);
          S.tintTile(id, 0.35 + 0.35 * Math.sin(rt / 40));
        } else if (rt < at + TILE_DROP_MS) {
          if (!S.dropped.has(id)) {
            S.dropped.add(id);
            // quiet, and not a wall of sound when many drop together
            if (ctx.now() - S.lastFallSfxAt > 90 && near(ctx, id)) {
              S.lastFallSfxAt = ctx.now();
              ctx.sfx("fall", { volume: 0.22, pitch: 0.9 + Math.random() * 0.3, at: tilePos(ctx, id) });
            }
          }
          const t = (rt - at) / 1000;
          S.placeTile(id, 0, -0.18 - 14 * t * t, 0, t * 1.4, true);
          S.tintTile(id, 0.2);
        } else {
          S.placeTile(id, 0, 0, 0, 0, false);
          S.gone.add(id);
        }
      }
    },
  });

  function fallTime(S, id) {
    return S.serverFall.has(id) ? S.serverFall.get(id) : S.localFall.get(id);
  }
  function isUp(S, id, rt) {
    const at = fallTime(S, id);
    return at === undefined || rt < at;
  }
  function tilePos(ctx, id) {
    const t = ctx.rules.tiles[id];
    return { x: t.x, y: t.y, z: t.z };
  }
  function near(ctx, id) {
    const t = ctx.rules.tiles[id], c = ctx.camera.position;
    return Math.hypot(t.x - c.x, t.y - c.y, t.z - c.z) < SOUND_NEAR;
  }
  // a soft crack as a tile starts to go, spatial and throttled
  function crack(ctx, id) {
    const S = ctx.state;
    if (ctx.now() - S.lastCrackAt < 60 || !near(ctx, id)) return;
    S.lastCrackAt = ctx.now();
    ctx.sfx("crack", { volume: 0.3, pitch: 0.85 + Math.random() * 0.4, at: tilePos(ctx, id) });
  }

  window.initHexagoneClient = game.init;
  window.cleanupHexagoneClient = game.cleanup;
})();
