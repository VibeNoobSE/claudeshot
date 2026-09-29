#!/usr/bin/env node
// Referee checks for Block Party (backend/games/blockparty.js) and its wall rules.
// Fake socket.io, fake room, hand-cranked clock.
//
//   node tools/check-blockparty.js

const Game = require("../backend/games/blockparty.js");
const R = require("../frontend/games/blockparty-rules.js");

let NOW = 1_000_000;
Date.now = () => NOW;

let passed = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) passed++;
  else failures.push(name + (detail !== undefined ? "  -> " + JSON.stringify(detail) : ""));
}

function makeGame(names) {
  const log = [];
  const io = { to: (to) => ({ emit: (ev, data) => log.push({ to, ev, data }) }) };
  const room = { code: "TEST", players: names.map((n, i) => ({ id: "s" + (i + 1), name: n })), settings: {} };
  let ended = null;
  const game = new Game(room, io, (scores) => { ended = scores; });
  game.start();
  clearInterval(game.timer);
  return {
    game, room, log,
    get ended() { return ended; },
    input: (sid, data) => game.setInput(sid, data),
    tick: () => game.tick(),
    last: (ev) => [...log].reverse().find((e) => e.ev === ev),
    events: (ev, to) => log.filter((e) => e.ev === ev && (to === undefined || e.to === to)),
    player: (uid) => game.playerByUid(uid),
    state: (sid, pos) => game.setInput(sid, { t: "state", p: pos, yaw: 0, v: [0, 0, 0], a: 0 }),
    // walk in small steps so the teleport guard is happy
    moveTo(sid, to) {
      const p = game.players.get(sid);
      const from = p.pos.slice();
      const steps = 20;
      for (let k = 1; k <= steps; k++) {
        NOW += 50;
        game.setInput(sid, { t: "state", p: from.map((c, i) => c + (to[i] - c) * k / steps), yaw: 0, v: [0, 0, 0], a: 0 });
      }
    },
  };
}

function readyAll(g, sids) { for (const s of sids) g.input(s, { t: "ready" }); }

// ================================================================ rules
{
  let noWay = 0, badSpeed = 0;
  for (let seed = 1; seed <= 40; seed++) {
    for (let i = 0; i < 80; i++) {
      const w = R.wave(seed, i);
      if (!w.cells.some((c) => c !== "F")) noWay++;
      if (!(w.speed > 0 && w.speed <= 7)) badSpeed++;
    }
  }
  check("every wall has a gap or a low block", noWay === 0, noWay);
  check("wall speeds ramp within 0..7 m/s", badSpeed === 0 && R.speedOf(0) < R.speedOf(20));
  check("waves come closer together over time", R.gapBefore(1) > R.gapBefore(20) && R.gapBefore(50) >= 1500);
  check("walls are deterministic for a seed", JSON.stringify(R.wave(9, 12)) === JSON.stringify(R.wave(9, 12)));
  check("different seeds give different walls",
    [...Array(10).keys()].some((i) => R.wave(1, i).cells.join("") !== R.wave(2, i).cells.join("")));
  check("no walls before the first wave", R.wallsAt(5, R.FIRST_WAVE_MS - 1).length === 0);
  const first = R.wallsAt(5, R.FIRST_WAVE_MS + 10);
  check("the first wall enters from off the platform", first.length === 1 && Math.abs(first[0].offset) > R.HALF, first[0] && first[0].offset);
  const w0 = R.wave(5, 0);
  const mid = R.wallsAt(5, w0.t0 + R.travelMs(w0) / 2).find((w) => w.wave.i === 0);
  check("a wall crosses the middle halfway through its trip", mid && Math.abs(mid.offset) < 0.2, mid && mid.offset);
  check("full cells block, low cells are jumpable",
    first[0].boxes.every((b) => (b.low ? b.max[1] <= 0.8 : b.max[1] >= 3)));
  check("isOut: lava and off-edge, not the middle", R.isOut(0, -5, 0) && R.isOut(9.5, -1, 0) && !R.isOut(0, 0, 0) && !R.isOut(7.9, -0.3, 0));
  let maxOn = 0;
  for (let t = 0; t < R.ROUND_MS; t += 250) maxOn = Math.max(maxOn, R.wallsAt(3, t).length);
  check("never more than 3 walls on the platform at once", maxOn <= 3, maxOn);
}

// ================================================================ loading → countdown → play
{
  NOW = 1_000_000;
  const T0 = NOW;
  const g = makeGame(["Ada", "Bo", "Cy"]);
  check("uids are stable u1..u3", ["u1", "u2", "u3"].every((u) => g.player(u)));
  check("distinct colours", new Set([...g.game.players.values()].map((p) => p.color)).size === 3);
  g.tick();
  check("loading until everyone is ready", g.last("blockparty-state").data.phase === "loading");

  const before = g.player("u1").pos.slice();
  g.state("s1", [1, 0, 1]);
  check("state before ready is ignored", JSON.stringify(g.player("u1").pos) === JSON.stringify(before));

  g.input("s1", { t: "team", team: "norli" });
  g.input("s1", { t: "team", team: "evil" });
  readyAll(g, ["s1", "s2"]);
  const init = g.events("blockparty-init", "s1")[0];
  check("ready answers init with uid, seed and spawn", init && init.data.uid === "u1" && Number.isFinite(init.data.seed) && init.data.spawn.length === 3);
  check("team is validated", g.player("u1").team === "norli");
  NOW = T0 + 2000; g.tick();
  check("one player still loading holds the countdown", g.last("blockparty-state").data.phase === "loading");
  readyAll(g, ["s3"]);
  NOW = T0 + 2100; g.tick();
  let st = g.last("blockparty-state").data;
  check("countdown once everyone has loaded", st.phase === "countdown" && st.rt === -R.COUNTDOWN_MS, [st.phase, st.rt]);
  check("state carries team and ready", st.players.find((p) => p.uid === "u1").tm === "norli" && st.players.every((p) => p.rd));

  // no eliminations in the countdown
  g.state("s1", [0, -5, 0]);
  g.input("s1", { t: "fell" });
  check("nobody goes out during the countdown", !g.player("u1").out);
  g.state("s1", [0, 0.05, 0]);

  NOW = T0 + 2100 + R.COUNTDOWN_MS + 100; g.tick();
  st = g.last("blockparty-state").data;
  check("play after GO", st.phase === "play" && st.rt === 100, [st.phase, st.rt]);
  check("everyone alive at GO", st.alive === 3);

  // bad data
  const keep = g.player("u2").pos.slice();
  g.state("s2", [NaN, 0, 0]);
  g.input("s2", { t: "state", p: "nope" });
  g.input("s2", null);
  g.input("ghost", { t: "fell" });
  check("malformed states are rejected", JSON.stringify(g.player("u2").pos) === JSON.stringify(keep));
  NOW += 50; g.state("s2", [0, 0.05, 0]);   // a live client reports 20 times a second
  NOW += 50; g.state("s2", [40, 0, 0]);
  check("teleports are rejected", g.player("u2").pos[0] !== 40);

  // a fall from the middle of the platform doesn't count
  g.input("s2", { t: "fell" });
  check("'fell' while standing in the middle is refused", !g.player("u2").out);

  // Bo walks off the edge and falls
  NOW += 1000;
  g.moveTo("s2", [9.2, -0.2, 0]);
  g.input("s2", { t: "fell" });
  check("falling off the edge puts you out", g.player("u2").out);
  const outEv = g.last("blockparty-out");
  check("everyone hears who went out, and how many are left", outEv && outEv.data.name === "Bo" && outEv.data.left === 2, outEv && outEv.data);
  const bOutAt = g.player("u2").outAt;
  g.input("s2", { t: "fell" });
  check("going out twice is ignored", g.player("u2").outAt === bOutAt);

  // bump
  g.state("s1", [0, 0.05, 0]);
  g.moveTo("s3", [1.2, 0.05, 0]);
  g.input("s1", { t: "bump", victim: "u3", dir: [1, 0] });
  const knock = g.events("blockparty-knock", "s3");
  check("a bump in reach knocks the victim", knock.length === 1 && knock[0].data.v[0] > 8 && knock[0].data.v[1] === 5, knock[0] && knock[0].data);
  g.input("s1", { t: "bump", victim: "u3", dir: [1, 0] });
  check("bump cooldown", g.events("blockparty-knock", "s3").length === 1);
  NOW += 900;
  g.input("s1", { t: "bump", victim: "u2", dir: [1, 0] });
  check("can't bump someone who is out", g.events("blockparty-knock", "s2").length === 0);
  g.moveTo("s3", [6, 0.05, 0]);
  g.input("s1", { t: "bump", victim: "u3", dir: [1, 0] });
  check("bump out of reach is refused", g.events("blockparty-knock", "s3").length === 1);

  // Cy drives into the lava: auto-out from state even without "fell"
  NOW += 3000;
  g.moveTo("s3", [6, -4, 0]);
  check("a state in the lava puts you out even without 'fell'", g.player("u3").out);

  g.tick();
  st = g.last("blockparty-state").data;
  check("round ends when one is left", g.game.phase() === "over");
  const over = g.last("blockparty-over");
  const table = over && over.data.table;
  check("winner is the last one standing", table && table[0].name === "Ada" && table[0].points === 10, table);
  check("then by who lasted longer", table && table[1].name === "Cy" && table[1].points === 6 && table[2].name === "Bo" && table[2].points === 5, table);
  check("survival times recorded", table && table[2].survived < table[1].survived, table);
  NOW += 5900; g.tick();
  check("not handed back before the end screen", g.ended === null);
  NOW += 200; g.tick();
  check("hands back to the platform after the end screen", Array.isArray(g.ended) && g.ended[0].name === "Ada" && g.ended[0].score === 10, g.ended);
  check("stop() cleared the timer", g.game.timer === null && g.game.ended);
  const n = g.log.length;
  g.tick(); g.input("s1", { t: "state", p: [0, 0, 0] });
  check("nothing after the end", g.log.length === n);
}

// ================================================================ solo, timeout, leavers, reconnect
{
  NOW = 3_000_000;
  const g = makeGame(["Solo"]);
  readyAll(g, ["s1"]);
  g.tick();
  NOW += R.COUNTDOWN_MS + 10; g.tick();
  check("solo: playing", g.game.phase() === "play");
  NOW += 20000; g.tick();
  check("solo: one player alive doesn't end the round", g.game.phase() === "play");
  g.moveTo("s1", [9.5, -1, 0]);
  g.input("s1", { t: "fell" });
  g.tick();
  check("solo: ends when you fall", g.game.phase() === "over" && g.last("blockparty-over").data.table[0].survived > 19);
  g.game.stop();

  NOW = 4_000_000;
  const t = makeGame(["A", "B"]);
  readyAll(t, ["s1", "s2"]);
  t.tick();
  NOW += R.COUNTDOWN_MS + 10; t.tick();
  NOW += R.ROUND_MS - 100; t.tick();
  check("timeout: still playing just before the cap", t.game.phase() === "play");
  NOW += 200; t.tick();
  check("timeout: over at the round cap with both standing", t.game.phase() === "over" && t.last("blockparty-over").data.table.every((r) => !r.out));
  t.game.stop();

  NOW = 5_000_000;
  const L = makeGame(["A", "B", "C"]);
  readyAll(L, ["s1", "s2", "s3"]);
  L.tick();
  NOW += R.COUNTDOWN_MS + 10; L.tick();
  L.room.players = L.room.players.filter((p) => p.id !== "s3");      // C closes the tab
  L.tick();
  check("a leaver drops out of the alive count", L.last("blockparty-state").data.alive === 2);
  // reconnect keeps the uid
  L.game.updatePlayerId("s2", "s2b");
  L.room.players = L.room.players.map((p) => (p.id === "s2" ? { ...p, id: "s2b" } : p));
  check("reconnect keeps the player", L.game.playerByUid("u2").id === "s2b");
  L.input("s2b", { t: "state", p: [0, 0, 0] });
  check("reconnected page must say ready again", L.game.playerByUid("u2").ready === false);
  L.input("s2b", { t: "ready" });
  check("ready again answers init", L.events("blockparty-init", "s2b").length === 1);
  L.game.stop();

  // load timeout
  NOW = 6_000_000;
  const S = makeGame(["Fast", "Slow"]);
  S.input("s1", { t: "ready" });
  NOW += R.LOAD_TIMEOUT_MS - 50; S.tick();
  check("waiting for a slow loader", S.game.phase() === "loading");
  NOW += 100; S.tick();
  check("a slow loader can't hold the round past the timeout", S.game.phase() === "countdown");
  S.game.stop();
}

// ---------------------------------------------------------------- report
if (failures.length) {
  for (const f of failures) console.log("  x " + f);
  console.log(`FAIL  ${failures.length} of ${passed + failures.length} Block Party checks failed`);
  process.exit(1);
}
console.log(`PASS  all ${passed} Block Party checks passed`);
