#!/usr/bin/env node
// Referee checks for the Hex-A-Gone server (backend/games/hexagone.js).
// Fake socket.io, fake room, hand-cranked clock - same approach as check-eye.js.
//
//   node tools/check-hexagone.js

const HexagoneGame = require("../backend/games/hexagone.js");
const R = require("../frontend/games/hexagone-rules.js");

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
  const room = { code: "HEX", players: names.map((n, i) => ({ id: "s" + (i + 1), name: n })), settings: {} };
  let ended = null;
  const game = new HexagoneGame(room, io, (scores) => { ended = scores; });
  game.start();
  clearInterval(game.timer);             // we crank the clock ourselves
  return {
    game, room, log,
    get ended() { return ended; },
    input: (sid, data) => game.setInput(sid, data),
    tick: () => game.tick(),
    lastState: () => [...log].reverse().find((e) => e.ev === "hexagone-state").data,
    events: (ev, to) => log.filter((e) => e.ev === ev && (to === undefined || e.to === to)),
    player: (uid) => game.playerByUid(uid),
    // report a position; small hops so the teleport guard is happy
    at: (sid, pos) => { NOW += 50; game.setInput(sid, { t: "state", p: pos, yaw: 0, v: [0, 0, 0], a: 0 }); },
    readyAll(sids) { for (const s of sids) game.setInput(s, { t: "ready" }); },
  };
}

// Walk a player straight down from where they are to a target height in 1 m steps.
function dropTo(g, sid, y) {
  const p = g.game.players.get(sid);
  for (let yy = p.pos[1] - 1; yy >= y; yy -= 1) g.at(sid, [p.pos[0], yy, p.pos[2]]);
  g.at(sid, [p.pos[0], y, p.pos[2]]);
}

// ================================================================ 0. rules
{
  const perLayer = 3 * R.GRID_R * (R.GRID_R + 1) + 1;
  check("three floors of hex tiles", R.tiles.length === perLayer * R.LAYERS.length, R.tiles.length);
  const t = R.tiles.find((x) => x.layer === 0 && x.q === 2 && x.r === -1);
  const [cq, cr] = R.cellAt(t.x, t.z);
  check("cellAt finds a tile's own cell", cq === 2 && cr === -1, [cq, cr]);
  const on = R.standingOn(t.x, 0, t.z);
  check("standing on a tile centre touches just that tile", on.length === 1 && on[0] === t.id, on);
  const edge = R.standingOn(t.x + R.INNER, 0, t.z);
  check("standing on an edge touches both tiles", edge.length === 2, edge);
  check("no tiles far below a floor", R.standingOn(t.x, -4, t.z).length === 0);
  const s0 = R.spawn(0, 4), s1 = R.spawn(1, 4);
  check("spawns sit on the top floor, apart", s0.pos[1] > 0 && Math.hypot(s0.pos[0] - s1.pos[0], s0.pos[2] - s1.pos[2]) > 5);
}

// ================================================================ 1. main flow
{
  NOW = 1_000_000;
  const T0 = NOW;
  const g = makeGame(["Ada", "Bo", "Cy"]);
  g.tick();
  check("loading until everyone is ready", g.lastState().phase === "loading");
  check("uids are stable", ["u1", "u2", "u3"].every((u) => g.player(u)));

  // state before ready is ignored
  const before = g.player("u1").pos.slice();
  g.at("s1", [1, 0, 1]);
  check("state before ready is ignored", JSON.stringify(g.player("u1").pos) === JSON.stringify(before));

  g.input("s1", { t: "team", team: "norli" });
  g.input("s1", { t: "team", team: "evil" });
  check("team is validated", g.player("u1").team === "norli");

  g.readyAll(["s1", "s2", "s3"]);
  const init = g.events("hexagone-init", "s1")[0];
  check("ready answers init with uid, spawn and tiles", init && init.data.uid === "u1" && init.data.spawn && Array.isArray(init.data.tiles), init && init.data);

  NOW = T0 + 1000; g.tick();
  let st = g.lastState();
  check("countdown once everyone has loaded", st.phase === "countdown" && st.rt === -R.COUNTDOWN_MS, [st.phase, st.rt]);
  check("state carries team and ready", st.players.find((p) => p.uid === "u1").tm === "norli" && st.players.every((p) => p.rd));

  // standing during the countdown drops nothing
  g.at("s1", g.player("u1").pos.slice());
  check("no tiles fall during the countdown", g.game.fallAt.size === 0);

  NOW = T0 + 1000 + R.COUNTDOWN_MS; g.tick();
  check("play after the countdown", g.lastState().phase === "play");

  // standing on a tile schedules it FALL_DELAY later, once
  const t = R.tiles.find((x) => x.layer === 0 && x.q === 0 && x.r === 0);
  g.at("s1", [t.x, 0, t.z]);
  const at = g.game.fallAt.get(t.id);
  check("a touched tile is scheduled to fall", Number.isFinite(at));
  check("it falls FALL_DELAY_MS after the touch", Math.abs(at - (g.game.rt() + R.FALL_DELAY_MS)) <= 60, [at, g.game.rt()]);
  g.at("s1", [t.x, 0, t.z]);
  check("touching again does not reschedule", g.game.fallAt.get(t.id) === at);
  g.tick();
  const tilesEv = g.events("hexagone-tiles").pop();
  check("new falls are broadcast", tilesEv && tilesEv.data.add.some(([id]) => id === t.id));

  // a fallen tile can't be scheduled again, and a late init gets the list
  NOW += R.FALL_DELAY_MS + 100;
  check("the tile is down after its fall time", !g.game.isUp(t.id, g.game.rt()));
  g.input("s1", { t: "ready" });
  const init2 = g.events("hexagone-init", "s1").pop();
  check("a late init carries the fallen tiles", init2.data.tiles.some(([id]) => id === t.id));

  // falling: a false claim is refused, a real one counts
  g.input("s2", { t: "fell" });
  check("a fell claim from someone standing is refused", !g.player("u2").out);
  dropTo(g, "s2", R.OUT_Y - 1);
  g.input("s2", { t: "fell" });
  check("a fell claim below the floors eliminates", g.player("u2").out);
  check("everyone hears about the elimination", g.events("hexagone-out").some((e) => e.data.uid === "u2"));

  // positions from an eliminated player are ignored
  const outPos = g.player("u2").pos.slice();
  g.at("s2", [0, 0, 0]);
  check("an eliminated player stops moving", JSON.stringify(g.player("u2").pos) === JSON.stringify(outPos));

  // the server spots someone below the kill height on its own
  NOW += 1000;
  dropTo(g, "s3", R.KILL_Y - 1);
  check("the server eliminates below the kill height", g.player("u3").out);

  g.tick();
  const over = g.events("hexagone-over").pop();
  check("last one standing ends the round", over && g.game.phase() === "over");
  const table = over && over.data.table;
  check("the survivor is first with 10 points", table && table[0].uid === "u1" && table[0].points === 10, table);
  check("the later faller ranks above the earlier", table && table[1].uid === "u3" && table[2].uid === "u2", table);
  check("points follow places", table && table[1].points === 6 && table[2].points === 5, table);

  NOW += R.END_SCREEN_MS + 10; g.tick();
  check("the platform gets scores after the end screen", g.ended && g.ended.length === 3 && g.ended[0].name === "Ada" && g.ended[0].score === 10, g.ended);
  check("the game stops itself", g.game.ended && g.game.timer === null);
}

// ================================================================ 2. solo
{
  NOW = 2_000_000;
  const g = makeGame(["Solo"]);
  g.readyAll(["s1"]);
  g.tick();
  NOW += R.COUNTDOWN_MS + 10; g.tick();
  check("solo play starts", g.lastState().phase === "play");
  NOW += 20000; g.tick();
  check("solo keeps going while you stand", g.lastState().phase === "play");
  dropTo(g, "s1", R.KILL_Y - 1);
  g.tick();
  check("solo ends when you fall", g.game.phase() === "over");
}

// ================================================================ 3. time cap
{
  NOW = 3_000_000;
  const g = makeGame(["A", "B"]);
  g.readyAll(["s1", "s2"]);
  g.tick();
  NOW += R.COUNTDOWN_MS + 10; g.tick();
  // B has dropped to the second floor, A is still on top
  const p2 = g.player("u2");
  dropTo(g, "s2", R.LAYERS[1].y);
  NOW = g.game.goAt + R.ROUND_MS + 10; g.tick();
  const over = g.events("hexagone-over").pop();
  check("the time cap ends the round", !!over);
  check("at the cap, the higher floor ranks first", over && over.data.table[0].uid === "u1", over && over.data.table);
  void p2;
}

// ================================================================ 4. load timeout, leavers, bumps
{
  NOW = 4_000_000;
  const g = makeGame(["A", "Slow", "C"]);
  g.readyAll(["s1", "s3"]);
  NOW += R.LOAD_TIMEOUT_MS - 100; g.tick();
  check("waits for a slow loader", g.lastState().phase === "loading");
  NOW += 200; g.tick();
  check("a slow loader can't hold the round past the timeout", g.lastState().phase === "countdown");
  NOW += R.COUNTDOWN_MS; g.tick();

  // bump: in range knocks, out of range doesn't, cooldown applies
  const a = g.player("u1"), c = g.player("u3");
  a.pos = [0, 0, 0]; c.pos = [1, 0, 0];
  g.input("s1", { t: "bump", victim: "u3", dir: [1, 0] });
  const knock = g.events("hexagone-knock", "s3");
  check("a bump in range knocks the victim", knock.length === 1 && knock[0].data.v[0] === 9 && knock[0].data.v[1] === 5, knock);
  g.input("s1", { t: "bump", victim: "u3", dir: [1, 0] });
  check("bump cooldown", g.events("hexagone-knock", "s3").length === 1);
  NOW += 900;
  c.pos = [10, 0, 0];
  g.input("s1", { t: "bump", victim: "u3", dir: [1, 0] });
  check("no bump out of range", g.events("hexagone-knock", "s3").length === 1);

  // someone leaves: with two present it continues; when one is left it ends
  g.room.players = g.room.players.filter((rp) => rp.id !== "s2");
  g.tick();
  check("a leaver doesn't end a round with two still up", g.lastState().phase === "play");
  dropTo(g, "s3", R.KILL_Y - 1);
  g.tick();
  const over = g.events("hexagone-over").pop();
  check("round ends when one is left", !!over);
  check("the leaver is ranked last", over && over.data.table[over.data.table.length - 1].uid === "u2", over && over.data.table);

  // reconnect keeps the player by uid
  NOW = 5_000_000;
  const g2 = makeGame(["A", "B"]);
  g2.game.updatePlayerId("s1", "s9");
  g2.room.players[0].id = "s9";
  g2.input("s9", { t: "ready" });
  const init = g2.events("hexagone-init", "s9")[0];
  check("a reconnected player keeps their uid", init && init.data.uid === "u1");
  g2.game.stop();
}

// ================================================================ 5. standing on air
{
  NOW = 6_000_000;
  const g = makeGame(["Frozen", "B"]);
  g.readyAll(["s1", "s2"]);
  g.tick();
  NOW += R.COUNTDOWN_MS + 10; g.tick();
  // a tab left in the background keeps reporting its spawn spot while the
  // tile under it falls away
  const spot = g.player("u1").pos.slice();
  g.at("s1", spot);
  NOW += R.FALL_DELAY_MS + 100;
  g.at("s1", spot);
  check("standing on air briefly is forgiven (lag)", !g.player("u1").out);
  for (let i = 0; i < 30; i++) g.at("s1", spot);   // 1.5 s more on nothing
  check("standing on air too long means you fell through", g.player("u1").out);
  // someone running across live tiles is never flagged
  const b = g.player("u2");
  const tiles = R.tiles.filter((t) => t.layer === 0 && t.r === 3).sort((a, c) => a.q - c.q);
  for (const t of tiles) { g.at("s2", [t.x, 0, t.z]); g.at("s2", [t.x, 0, t.z]); }
  check("running over fresh tiles is fine", !b.out);
  g.game.stop();
}

// ================================================================ report
if (failures.length) {
  for (const f of failures) console.log("  x " + f);
  console.log(`FAIL  ${failures.length} of ${passed + failures.length} Hex-A-Gone checks failed`);
  process.exit(1);
}
console.log(`PASS  all ${passed} Hex-A-Gone referee checks passed`);
