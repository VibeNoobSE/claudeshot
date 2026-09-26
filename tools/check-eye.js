#!/usr/bin/env node
// Referee checks for the Eye of Ark server (backend/games/eye.js).
//
// Drives EyeGame with a fake socket.io, a fake room and a hand-cranked clock:
// the game's own 20 Hz interval is cleared straight after start() and tick()
// is called by hand, so every timing rule is tested exactly.
//
//   node tools/check-eye.js

const EyeGame = require("../backend/games/eye.js");
const C = require("../frontend/games/eye-course.js");

// ---------------------------------------------------------------- harness
let NOW = 1_000_000;
const realNow = Date.now;
Date.now = () => NOW;

let passed = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) passed++;
  else failures.push(name + (detail !== undefined ? "  -> " + JSON.stringify(detail) : ""));
}

function makeGame(names, { loading = false } = {}) {
  const log = [];
  const io = { to: (to) => ({ emit: (ev, data) => log.push({ to, ev, data }) }) };
  const room = { code: "TEST", players: names.map((n, i) => ({ id: "s" + (i + 1), name: n })), settings: {} };
  let ended = null;
  const game = new EyeGame(room, io, (scores) => { ended = scores; });
  game.start();
  clearInterval(game.timer);           // we crank the clock ourselves
  // Most checks start from "everyone loaded instantly"; the loading phase has
  // its own section below.
  if (!loading) game.goAt = NOW + C.COUNTDOWN_MS;
  const g = {
    game, room, log,
    get ended() { return ended; },
    input: (sid, data) => game.setInput(sid, data),
    tick: () => game.tick(),
    lastState: () => [...log].reverse().find((e) => e.ev === "eye-state").data,
    events: (ev, to) => log.filter((e) => e.ev === ev && (to === undefined || e.to === to)),
    player: (uid) => game.playerByUid(uid),
    // Walk a player along the course centre line one metre every 100 ms.
    walk(sid, from, to, lateral = 0, up = 0) {
      const step = from <= to ? 1 : -1;
      for (let s = from; step > 0 ? s <= to : s >= to; s += step) {
        NOW += 100;
        game.setInput(sid, { t: "state", p: C.pathOffset(s, lateral, up), yaw: 0, v: [0, 0, 0], a: 0, g: 0 });
      }
    },
    // Put a player somewhere far away in one packet, after a long enough gap
    // that the lag allowance covers it.
    jumpTo(sid, pos) {
      NOW += 10000;
      game.setInput(sid, { t: "state", p: pos, yaw: 0, v: [0, 0, 0], a: 0, g: 0 });
    },
    state: (sid, pos) => game.setInput(sid, { t: "state", p: pos, yaw: 0, v: [0, 0, 0], a: 0, g: 0 }),
  };
  return g;
}

const GO = () => C.COUNTDOWN_MS;

// ================================================================ 0. loading
{
  NOW = 1_000_000;
  const T0 = NOW;
  const g = makeGame(["Ada", "Bo"], { loading: true });
  g.tick();
  let st = g.lastState();
  check("loading phase until everyone is ready", st.phase === "loading", st.phase);
  check("rt stands at the start of the intro while loading", st.rt === -C.COUNTDOWN_MS, st.rt);
  check("state shows who has loaded", st.players.every((p) => p.rd === false), st.players.map((p) => p.rd));
  g.input("s1", { t: "ready" });
  NOW = T0 + 3000; g.tick();
  st = g.lastState();
  check("one loader is not enough", st.phase === "loading" && st.players.find((p) => p.uid === "u1").rd === true, st.phase);
  g.input("s2", { t: "ready" });
  NOW = T0 + 4000; g.tick();
  st = g.lastState();
  check("countdown starts when everyone has loaded", st.phase === "countdown" && st.rt === -C.COUNTDOWN_MS, [st.phase, st.rt]);
  NOW = T0 + 4000 + C.COUNTDOWN_MS; g.tick();
  check("race starts a full intro later", g.lastState().phase === "race");
  g.game.stop();

  NOW = 2_000_000;
  const g2 = makeGame(["Ada", "Slow"], { loading: true });
  g2.input("s1", { t: "ready" });
  NOW += C.LOAD_TIMEOUT_MS - 100; g2.tick();
  check("still waiting just before the load timeout", g2.lastState().phase === "loading");
  NOW += 200; g2.tick();
  check("a slow loader can't hold the race past the timeout", g2.lastState().phase === "countdown");
  g2.game.stop();
}

// ================================================================ 1. main race
{
  NOW = 1_000_000;
  const T0 = NOW;
  const g = makeGame(["Ada", "Bo", "Cy"]);

  check("uids are stable u1..u3", ["u1", "u2", "u3"].every((u) => g.player(u)), [...g.game.players.values()].map((p) => p.uid));
  const colors = new Set([...g.game.players.values()].map((p) => p.color));
  check("each player gets a distinct colour", colors.size === 3);

  NOW = T0 + 1000;
  g.tick();
  let st = g.lastState();
  check("countdown phase before GO", st.phase === "countdown", st.phase);
  check("rt is negative during the countdown", st.rt === 1000 - GO(), st.rt);
  check("timeLeft is the full round during the countdown", st.timeLeft === C.ROUND_MS / 1000, st.timeLeft);

  // state before ready is ignored
  const before = g.player("u1").pos.slice();
  g.state("s1", C.pathOffset(3, 0, 0));
  check("state before ready is ignored", JSON.stringify(g.player("u1").pos) === JSON.stringify(before));

  g.input("s1", { t: "ready" });
  g.input("s1", { t: "ready" });
  const inits = g.events("eye-init", "s1");
  check("ready answers eye-init every time", inits.length === 2, inits.length);
  check("eye-init carries uid/rt/timing/cp/players",
    inits[0] && inits[0].data.uid === "u1" && inits[0].data.cp === 0 && inits[0].data.countdownMs === C.COUNTDOWN_MS &&
    inits[0].data.roundMs === C.ROUND_MS && inits[0].data.players.length === 3 && Number.isFinite(inits[0].data.rt),
    inits[0] && inits[0].data);
  g.input("s2", { t: "ready" });
  g.input("s3", { t: "ready" });

  // bad data is rejected
  const p1 = g.player("u1");
  const keep = p1.pos.slice();
  g.state("s1", [NaN, 0, 0]);
  g.state("s1", [1, 2]);
  g.input("s1", { t: "state", p: "nope" });
  g.input("s1", null);
  g.input("nobody", { t: "state", p: [0, 0, 0] });
  check("non-finite / malformed states are rejected", JSON.stringify(p1.pos) === JSON.stringify(keep), p1.pos);

  // bump and grab refused during the countdown
  g.input("s1", { t: "bump", victim: "u2", dir: [1, 0] });
  g.input("s1", { t: "grab", victim: "u2" });
  check("no bumps during the countdown", g.events("eye-knock").length === 0);
  check("no grabs during the countdown", g.player("u1").gr === null);

  NOW = T0 + GO() + 1000;
  g.tick();
  st = g.lastState();
  check("race phase after GO", st.phase === "race", st.phase);
  check("rt counts from GO", st.rt === 1000, st.rt);

  // teleport guard
  const spawnPos = p1.pos.slice();
  NOW += 50; g.state("s1", spawnPos);       // a live client reports 20 times a second
  NOW += 50;
  g.state("s1", C.pathOffset(150, 0, 0));
  check("a 100 m jump in one packet is rejected", JSON.stringify(p1.pos) === JSON.stringify(spawnPos), p1.pos);

  // checkpoints only count on the course: walk UNDER checkpoint 1
  g.walk("s1", 11, 60);
  check("walking along the course is accepted", Math.abs(p1.s - 60) < 1, p1.s);
  g.walk("s1", 60, 90, 0, -3);
  check("walking under the course is tracked", Math.abs(p1.s - 90) < 2 && Math.abs(p1.pos[1] - (C.floorAt(90) - 3)) < 1e-6, [p1.s, p1.pos]);
  check("no checkpoint when passing below the floor", p1.cp === 0, p1.cp);
  check("no eye-cp when passing below the floor", g.events("eye-cp", "s1").length === 0);
  // walking back up to the start line is fine; then walk through it properly
  g.walk("s1", 90, 60, 0, 0);
  g.walk("s1", 60, 90, 0, 0);
  check("checkpoint 1 reached on the course", p1.cp === 1, p1.cp);
  const cps = g.events("eye-cp", "s1");
  check("eye-cp sent once with the name", cps.length === 1 && cps[0].data.cp === 1 && cps[0].data.name === "CHECKPOINT 1", cps.map((e) => e.data));

  // one checkpoint per packet: Bo leaps (with lag) straight past checkpoint 2
  g.jumpTo("s2", C.pathOffset(195, 0, 0));
  const p2 = g.player("u2");
  check("a long lagged move is accepted", Math.abs(p2.s - 195) < 1, p2.s);
  check("checkpoints advance one at a time", p2.cp === 1, p2.cp);
  NOW += 100;
  g.state("s2", C.pathOffset(195.5, 0, 0));
  check("next packet takes the next checkpoint", p2.cp === 2, p2.cp);

  // falls
  g.input("s3", { t: "fell" });
  g.input("s3", { t: "fell" });            // debounced
  NOW += 1000;
  g.input("s3", { t: "fell" });
  check("falls are counted (debounced)", g.player("u3").falls === 2, g.player("u3").falls);

  // respawn teleport to your own checkpoint spawn is allowed
  const p3 = g.player("u3");
  g.walk("s3", 0, 20);
  NOW += 100;
  g.state("s3", C.CHECKPOINTS[0].spawns[2].slice());
  check("respawn jump to own checkpoint spawn is accepted", JSON.stringify(p3.pos) === JSON.stringify(C.CHECKPOINTS[0].spawns[2]), p3.pos);
  g.walk("s3", 10, 30);

  // crown: rejected before the last checkpoint
  const crownFeet = [1.0, C.PEDESTAL_TOP, 0];
  g.jumpTo("s1", crownFeet);
  g.input("s1", { t: "crown" });
  check("crown rejected before checkpoint 3", g.events("eye-win").length === 0 && !p1.fin);

  // get Ada to checkpoint 3, then claim from too far away
  g.jumpTo("s1", C.pathOffset(240, 0, 0));
  g.walk("s1", 240, 262);
  check("Ada reaches checkpoint 3", p1.cp === 3, p1.cp);
  g.input("s1", { t: "crown" });
  check("crown rejected when too far away", g.events("eye-win").length === 0);

  // walk up to the pedestal and grab it
  g.walk("s1", 262, 318);
  NOW += 100;
  g.state("s1", crownFeet);
  g.input("s1", { t: "crown" });
  const wins = g.events("eye-win");
  check("valid crown claim broadcasts eye-win", wins.length === 1 && wins[0].to === "TEST" && wins[0].data.uid === "u1" && wins[0].data.name === "Ada", wins.map((e) => e.data));
  g.input("s2", { t: "crown" });
  check("only one crown", g.events("eye-win").length === 1);

  g.tick();
  st = g.lastState();
  check("phase is won after the crown", st.phase === "won", st.phase);
  const me = st.players.find((p) => p.uid === "u1");
  check("winner is fin and first", me.fin === true && me.place === 1, me);
  check("live places follow progress", st.players.find((p) => p.uid === "u2").place === 2 && st.players.find((p) => p.uid === "u3").place === 3,
    st.players.map((p) => [p.uid, p.place]));
  check("state carries the contract fields",
    ["uid", "name", "color", "p", "yaw", "v", "a", "g", "cp", "prog", "place", "gb", "gr", "fin", "falls"].every((k) => k in me), Object.keys(me));

  NOW += C.WIN_HOLD_MS - 100;
  g.tick();
  check("no eye-over during the win hold", g.events("eye-over").length === 0);
  NOW += 200;
  g.tick();
  const over = g.events("eye-over");
  check("eye-over after WIN_HOLD_MS", over.length === 1 && over[0].data.endsIn === C.END_SCREEN_MS);
  const table = over[0] && over[0].data.table;
  check("final table: places and points (crown = 10)", table &&
    table[0].uid === "u1" && table[0].place === 1 && table[0].points === 10 && table[0].crown === true &&
    table[1].uid === "u2" && table[1].points === 6 && table[2].uid === "u3" && table[2].points === 5 && table[2].falls === 2,
    table);
  g.tick();
  check("phase over after the finish", g.lastState().phase === "over");

  NOW += C.END_SCREEN_MS - 100;
  g.tick();
  check("onEnd waits for the end screen", g.ended === null);
  NOW += 200;
  g.tick();
  check("onEnd receives [{name, score}]", JSON.stringify(g.ended) === JSON.stringify([
    { name: "Ada", score: 10 }, { name: "Bo", score: 6 }, { name: "Cy", score: 5 }]), g.ended);
  check("game is stopped after onEnd", g.game.ended && g.game.timer === null);
  const n = g.log.length;
  g.tick();
  g.input("s1", { t: "ready" });
  check("a stopped game is silent", g.log.length === n);
}

// ================================================================ 2. timeout finish
{
  NOW = 5_000_000;
  const T0 = NOW;
  const g = makeGame(["A", "B", "C", "D"]);
  ["s1", "s2", "s3", "s4"].forEach((sid) => g.input(sid, { t: "ready" }));
  NOW = T0 + GO() + 10;
  g.walk("s1", 5, 40);
  g.walk("s2", 5, 100);
  g.walk("s3", 5, 60);
  g.walk("s4", 5, 120);
  // D leaves the room: drops out of live places but keeps a row in the table
  g.room.players = g.room.players.filter((rp) => rp.id !== "s4");
  g.tick();
  const st = g.lastState();
  check("a player who left is not in the live state", !st.players.some((p) => p.uid === "u4"), st.players.map((p) => p.uid));
  check("live places exclude the leaver", st.players.find((p) => p.uid === "u2").place === 1);

  NOW = T0 + GO() + C.ROUND_MS - 50;
  g.tick();
  check("no finish before ROUND_MS", g.events("eye-over").length === 0);
  NOW = T0 + GO() + C.ROUND_MS;
  g.tick();
  const table = g.events("eye-over")[0] && g.events("eye-over")[0].data.table;
  check("timeout finish ranks by progress, 8 points without the crown", table &&
    table.map((r) => r.uid).join() === "u2,u3,u1,u4" &&
    table.map((r) => r.points).join() === "8,6,5,4" && table[0].crown === false,
    table && table.map((r) => [r.uid, r.points]));
  NOW += C.END_SCREEN_MS;
  g.tick();
  check("timeout game hands back to the platform", Array.isArray(g.ended) && g.ended.length === 4 && g.ended[3].name === "D", g.ended);
}

// ================================================================ 3. bumps
{
  NOW = 9_000_000;
  const T0 = NOW;
  const g = makeGame(["A", "B", "C"]);
  ["s1", "s2", "s3"].forEach((sid) => g.input(sid, { t: "ready" }));
  NOW = T0 + GO() + 10;
  const a = C.pathOffset(15, 0, 0);
  NOW += 100; g.state("s1", a);
  NOW += 100; g.state("s2", C.pathOffset(16.5, 0, 0));
  NOW += 100; g.state("s3", C.pathOffset(15, 6, 0));      // 6 m away: out of reach

  g.input("s1", { t: "bump", victim: "u2", dir: [3, 4] });
  let knocks = g.events("eye-knock", "s2");
  check("bump in range sends eye-knock to the victim", knocks.length === 1, knocks.length);
  check("knock velocity = unit(dir)*9 + up 5", knocks[0] && JSON.stringify(knocks[0].data.v) === JSON.stringify([5.4, 5, 7.2]) && knocks[0].data.by === "A", knocks[0] && knocks[0].data);
  g.input("s1", { t: "bump", victim: "u2", dir: [1, 0] });
  check("bump cooldown", g.events("eye-knock", "s2").length === 1);
  NOW += 801;
  g.input("s1", { t: "bump", victim: "u2", dir: [1, 0] });
  check("bump allowed after 800 ms", g.events("eye-knock", "s2").length === 2);
  NOW += 801;
  g.input("s1", { t: "bump", victim: "u3", dir: [1, 0] });
  check("bump out of range rejected", g.events("eye-knock", "s3").length === 0);
  g.input("s1", { t: "bump", victim: "u1", dir: [1, 0] });
  g.input("s1", { t: "bump", victim: "u9", dir: [1, 0] });
  check("self-bump and unknown uids rejected", g.events("eye-knock", "s1").length === 0);
  g.game.stop();
}

// ================================================================ 4. grabs
{
  NOW = 13_000_000;
  const T0 = NOW;
  const g = makeGame(["A", "B", "C"]);
  ["s1", "s2", "s3"].forEach((sid) => g.input(sid, { t: "ready" }));
  NOW = T0 + GO() + 10;
  NOW += 100; g.state("s1", C.pathOffset(15, 0, 0));
  NOW += 100; g.state("s2", C.pathOffset(16.5, 0, 0));
  NOW += 100; g.state("s3", C.pathOffset(16.5, 1.5, 0));
  const A = g.player("u1"), B = g.player("u2"), Cc = g.player("u3");

  g.input("s1", { t: "grab", victim: "u2" });
  check("grab in range links grabber and victim", A.gr === "u2" && B.gb === "u1");
  g.tick();
  let st = g.lastState();
  check("grab shows in state", st.players.find((p) => p.uid === "u1").gr === "u2" && st.players.find((p) => p.uid === "u2").gb === "u1");
  g.input("s3", { t: "grab", victim: "u2" });
  check("an already-grabbed victim can't be grabbed again", Cc.gr === null && B.gb === "u1");

  NOW += 1599; g.tick();
  check("grab holds until 1.6 s", A.gr === "u2");
  check("state shows the hold time left", g.lastState().players.find((p) => p.uid === "u1").gt > 0);
  NOW += 2; g.tick();
  check("grab auto-releases after 1.6 s", A.gr === null && B.gb === null);

  g.input("s1", { t: "grab", victim: "u2" });
  check("grabber cooldown after a release", A.gr === null);
  g.input("s3", { t: "grab", victim: "u2" });
  check("victim immune for 1.2 s after a release", Cc.gr === null);
  NOW += 1201;
  g.input("s3", { t: "grab", victim: "u2" });
  check("victim grabbable after immunity", Cc.gr === "u2" && B.gb === "u3");
  g.input("s3", { t: "release" });
  check("manual release", Cc.gr === null && B.gb === null);

  NOW += 1700;
  g.input("s1", { t: "grab", victim: "u2" });
  check("grabber can grab again after its cooldown", A.gr === "u2");
  NOW += 100; g.state("s2", C.pathOffset(21, 0, 0));
  g.tick();
  check("dragged more than 4 m apart releases", A.gr === null && B.gb === null);

  NOW += 100; g.state("s3", C.pathOffset(40, 0, 0));
  NOW += 1900;
  g.input("s1", { t: "grab", victim: "u3" });
  check("grab out of range rejected", A.gr === null);

  // ---- updatePlayerId keeps everything keyed by uid working
  g.game.updatePlayerId("s1", "s1b");
  check("updatePlayerId re-keys the player", g.game.players.get("s1b") && g.game.players.get("s1b").uid === "u1" && !g.game.players.has("s1"));
  g.room.players.find((rp) => rp.id === "s1").id = "s1b";     // what rejoinRoom does
  const posBefore = A.pos.slice();
  NOW += 100; g.state("s1b", C.pathOffset(16, 0, 0));
  check("the new page must send ready first", JSON.stringify(A.pos) === JSON.stringify(posBefore));
  g.input("s1b", { t: "ready" });
  const init = g.events("eye-init", "s1b");
  check("eye-init goes to the new socket with the same uid", init.length === 1 && init[0].data.uid === "u1");
  NOW += 100; g.state("s1b", C.pathOffset(16, 0, 0));
  check("states from the new socket are accepted", Math.abs(A.s - 16) < 1, A.s);
  g.state("s1", C.pathOffset(18, 0, 0));
  check("the old socket id is ignored", Math.abs(A.s - 16) < 1);
  NOW += 100; g.state("s2", C.pathOffset(16.8, 0, 0));
  NOW += 1900;
  g.input("s1b", { t: "grab", victim: "u2" });
  check("uid-keyed rules still work after a reconnect", A.gr === "u2" && B.gb === "u1");
  g.game.stop();
}

// ================================================================ 4b. struggle + teams
{
  NOW = 17_000_000;
  const T0 = NOW;
  const g = makeGame(["A", "B"]);
  ["s1", "s2"].forEach((sid) => g.input(sid, { t: "ready" }));
  const A = g.player("u1"), B = g.player("u2");

  check("everyone starts as Bookis", A.team === "bookis" && B.team === "bookis");
  g.input("s2", { t: "team", team: "norli" });
  g.input("s1", { t: "team", team: "sauron" });
  check("team picks are validated", B.team === "norli" && A.team === "bookis");
  g.tick();
  check("team shows in state", g.lastState().players.find((p) => p.uid === "u2").tm === "norli");
  g.input("s2", { t: "ready" });
  const init = g.events("eye-init", "s2").pop().data;
  check("team shows in eye-init", init.players.find((p) => p.uid === "u2").tm === "norli");

  NOW = T0 + GO() + 10;
  NOW += 100; g.state("s1", C.pathOffset(15, 0, 0));
  NOW += 100; g.state("s2", C.pathOffset(16.5, 0, 0));
  g.input("s2", { t: "struggle" });
  check("struggling while free does nothing", B.struggles === 0);
  g.input("s1", { t: "grab", victim: "u2" });
  check("grab reach includes 1.2 m slack", A.gr === "u2");
  for (let i = 0; i < 4; i++) { NOW += 100; g.input("s2", { t: "struggle" }); }
  check("four presses don't break the hold", A.gr === "u2" && B.gb === "u1");
  g.tick();
  check("struggle count shows in state", g.lastState().players.find((p) => p.uid === "u2").st === 4);
  NOW += 20; g.input("s2", { t: "struggle" });
  check("presses under 60 ms apart don't count", A.gr === "u2");
  NOW += 100; g.input("s2", { t: "struggle" });
  check("the fifth press breaks free", A.gr === null && B.gb === null);
  check("breaking free gives the grabber the cooldown", A.grabReadyAt === NOW + 1800);
  NOW += 1700;
  g.input("s1", { t: "grab", victim: "u2" });
  check("grabber still cooling down at 1.7 s", A.gr === null);
  NOW += 101;
  g.input("s1", { t: "grab", victim: "u2" });
  check("grabber can grab again after 1.8 s, struggles reset", A.gr === "u2" && B.struggles === 0, [A.gr, B.struggles]);
  g.game.stop();
}

// ================================================================ 5. timers
{
  Date.now = realNow;
  const log = [];
  const io = { to: () => ({ emit: (ev, d) => log.push([ev, d]) }) };
  const game = new EyeGame({ code: "T", players: [{ id: "x", name: "X" }], settings: {} }, io, () => {});
  game.start();
  check("start() runs a 20 Hz tick", game.timer !== null);
  game.stop();
  check("stop() clears the tick", game.timer === null && game.ended === true);
}

// ================================================================ summary
Date.now = realNow;
if (failures.length) {
  console.log("FAIL  " + failures.length + " of " + (passed + failures.length) + " checks failed:");
  for (const f of failures) console.log("  x " + f);
  process.exitCode = 1;
} else {
  console.log("PASS  all " + passed + " Eye of Ark referee checks passed");
}
