#!/usr/bin/env node
// Referee checks for the Jump Showdown prototype (backend/games/showdown.js)
// and its shared rules (frontend/games/showdown-rules.js).
//
// Drives the game with a fake socket.io, a fake room and a hand-cranked clock.
//   node tools/check-showdown.js

const ShowdownGame = require("../backend/games/showdown.js");
const R = require("../frontend/games/showdown-rules.js");

let NOW = 1_000_000;
const realNow = Date.now;
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
  const game = new ShowdownGame(room, io, (scores) => { ended = scores; });
  game.start();
  clearInterval(game.timer);           // we crank the clock ourselves
  return {
    game, room, log,
    get ended() { return ended; },
    input: (sid, data) => game.setInput(sid, data),
    tick: () => game.tick(),
    lastState: () => [...log].reverse().find((e) => e.ev === "showdown-state").data,
    events: (ev, to) => log.filter((e) => e.ev === ev && (to === undefined || e.to === to)),
    player: (uid) => game.playerByUid(uid),
    state: (sid, p) => game.setInput(sid, { t: "state", p, yaw: 0, v: [0, 0, 0], a: 0 }),
    readyAll() { names.forEach((_, i) => game.setInput("s" + (i + 1), { t: "ready" })); },
    // load, count down, and arrive at rt (ms after GO)
    goTo(rt) {
      this.readyAll();
      this.tick();                                   // everyone loaded: goAt = now + countdown
      NOW = this.game.goAt + rt;
      this.tick();
    },
  };
}

// ================================================================ rules
{
  const a = R.create(1234), b = R.create(1234), c = R.create(99);
  check("same seed, same bars", [0, 5000, 33333, 90000].every((t) =>
    a.barPose(0, t).angle === b.barPose(0, t).angle && a.barPose(1, t).angle === b.barPose(1, t).angle));
  check("different seed, different drop order", a.order.join() !== c.order.join() || a.barPose(0, 60000).angle !== c.barPose(0, 60000).angle);
  check("bars stand still in the countdown", a.barPose(0, -2000).angle === a.barPose(0, -100).angle);
  // no jumps: consecutive 20 ms samples never move more than a max-speed step
  let worst = 0;
  for (let t = 0; t < R.ROUND_MS; t += 20) {
    for (const i of [0, 1]) worst = Math.max(worst, Math.abs(a.barPose(i, t + 20).angle - a.barPose(i, t).angle));
  }
  check("bar motion is continuous", worst < 2.0 * 0.02 * 1.05, worst);
  check("bars speed up", Math.abs(a.barPose(0, 100000).omega) > Math.abs(a.barPose(0, 5000).omega) || a.bars[0].flips.length > 0);
  const lowR = R.BARS[0], highR = R.BARS[1];
  check("low bar top is jumpable (< 0.8 m)", lowR.height + lowR.radius < 0.8);
  check("high bar clears a standing bean", highR.height - highR.radius > R.PLAYER.height + 0.1);
  check("all 8 segments at the start", a.aliveSegments(0) === 8);
  check("segments start dropping at 40 s", a.aliveSegments(39999) === 8 && a.aliveSegments(40000) === 7);
  check("two segments left at the end", a.aliveSegments(R.ROUND_MS) === 2);
  const i0 = a.order[0];
  const warn = a.segmentState(i0, 40000 - 1500);
  check("a segment warns before it drops", warn.alive && warn.warn > 0.4 && warn.warn < 0.6, warn);
  const mid = (i0 + 0.5) * R.SEG_ANGLE;
  const px = Math.cos(mid) * 6, pz = Math.sin(mid) * 6;
  check("floor under a live segment", a.floorAt(px, pz, 30000));
  check("no floor after it drops", !a.floorAt(px, pz, 41000));
  check("no floor past the rim or in the post", !a.floorAt(13, 0, 0) && !a.floorAt(0.5, 0, 0));
  const sp = a.spawns(8);
  check("8 spawns, all on the platform", sp.length === 8 && sp.every((s) => a.floorAt(s.p[0], s.p[2], 0)));
}

// ================================================================ loading and countdown
{
  NOW = 1_000_000;
  const T0 = NOW;
  const g = makeGame(["Ada", "Bo"]);
  g.tick();
  let st = g.lastState();
  check("loading until everyone is ready", st.phase === "loading" && st.rt === -R.COUNTDOWN_MS, [st.phase, st.rt]);
  check("uids u1, u2 and distinct colours", g.player("u1") && g.player("u2") && g.player("u1").color !== g.player("u2").color);

  const before = g.player("u1").pos.slice();
  g.state("s1", [3, 0, 3]);
  check("state before ready is ignored", JSON.stringify(g.player("u1").pos) === JSON.stringify(before));

  g.input("s1", { t: "team", team: "norli" });
  g.input("s1", { t: "ready" });
  g.input("s1", { t: "ready" });
  const inits = g.events("showdown-init", "s1");
  check("ready answers init every time", inits.length === 2);
  check("init carries uid, seed, spawn and players", inits[0].data.uid === "u1" && Number.isFinite(inits[0].data.seed) &&
    inits[0].data.spawn && inits[0].data.players.length === 2);
  check("team is stored", g.player("u1").team === "norli");
  g.input("s1", { t: "team", team: "hacker" });
  check("bad team is ignored", g.player("u1").team === "norli");

  NOW = T0 + 2000; g.tick();
  check("one loader is not enough", g.lastState().phase === "loading");
  g.input("s2", { t: "ready" });
  NOW = T0 + 3000; g.tick();
  st = g.lastState();
  check("countdown when everyone has loaded", st.phase === "countdown" && st.rt === -R.COUNTDOWN_MS, [st.phase, st.rt]);
  NOW = T0 + 3000 + R.COUNTDOWN_MS; g.tick();
  check("play after the countdown", g.lastState().phase === "play" && g.lastState().rt === 0);

  // fell during the countdown is ignored
  g.game.stop();
  NOW = 5_000_000;
  const g2 = makeGame(["Ada", "Slow"]);
  g2.input("s1", { t: "ready" });
  NOW += R.LOAD_TIMEOUT_MS + 10; g2.tick();
  check("a slow loader can't hold the round past the timeout", g2.lastState().phase === "countdown");
  g2.state("s1", [0, -8, 0]);
  g2.input("s1", { t: "fell" });
  check("no eliminations during the countdown", !g2.player("u1").out);
  g2.game.stop();
}

// ================================================================ eliminations, ranking, points
{
  NOW = 10_000_000;
  const g = makeGame(["Ada", "Bo", "Cy"]);
  g.goTo(5000);
  // Ada claims a fall while standing on the platform: refused
  g.state("s1", [5, 0, 0]);
  g.input("s1", { t: "fell" });
  check("a fall while standing on the floor is refused", !g.player("u1").out);
  // Ada really falls
  NOW += 1000;
  g.state("s1", [13.5, -2, 0]);
  g.input("s1", { t: "fell" });
  check("a real fall eliminates", g.player("u1").out && g.player("u1").outAt === 6000, g.player("u1").outAt);
  const outs = g.events("showdown-out");
  check("elimination is announced with players left", outs.length === 1 && outs[0].data.left === 2 && outs[0].data.name === "Ada");
  g.state("s1", [0, 0, 0]);
  check("out players' states are ignored", g.player("u1").pos[1] === -2);
  g.tick();
  check("state shows who is out and players left", g.lastState().left === 2 && g.lastState().players.find((p) => p.uid === "u1").out);

  // Bo is auto-eliminated by reporting a position deep in the lava
  NOW += 4000;
  g.state("s2", [2, -7, 2]);
  check("a position in the lava is out even without a claim", g.player("u2").out);
  g.tick();
  check("round ends when one is left", g.lastState().phase === "over" || g.events("showdown-over").length === 1);
  const over = g.events("showdown-over")[0];
  const table = over && over.data.table;
  check("winner is the last one standing", table && table[0].name === "Cy" && table[0].place === 1 && table[0].points === 10, table);
  check("then by elimination time", table && table[1].name === "Bo" && table[1].points === 6 && table[2].name === "Ada" && table[2].points === 5, table);
  check("survival times recorded", table && table[2].survivedMs === 6000 && table[1].survivedMs === 10000, table);
  NOW += R.END_SCREEN_MS - 100; g.tick();
  check("board holds before handing back", g.ended === null);
  NOW += 200; g.tick();
  check("hands back to the platform with scores",
    g.ended && g.ended.length === 3 && g.ended[0].name === "Cy" && g.ended[0].score === 10, g.ended);
  check("stops ticking after hand-back", g.game.timer === null && g.game.ended);
}

// ================================================================ time cap: survivors share first
{
  NOW = 20_000_000;
  const g = makeGame(["Ada", "Bo", "Cy"]);
  g.goTo(1000);
  g.state("s3", [0, -3, 13]);
  g.input("s3", { t: "fell" });
  NOW = g.game.goAt + R.ROUND_MS;
  g.tick();
  const t = g.events("showdown-over")[0].data.table;
  check("time cap: every survivor places first with 10", t.filter((r) => r.place === 1 && r.points === 10).length === 2, t);
  check("time cap: the fallen one places third", t[2].name === "Cy" && t[2].place === 3 && t[2].points === 5, t);
}

// ================================================================ solo
{
  NOW = 30_000_000;
  const g = makeGame(["Solo"]);
  g.goTo(1000);
  g.tick();
  check("solo keeps playing while alive", g.lastState().phase === "play");
  NOW += 20000;
  g.state("s1", [0, -2, 12.8]);
  g.input("s1", { t: "fell" });
  g.tick();
  const over = g.events("showdown-over")[0];
  check("solo ends when you fall", over && over.data.table[0].survivedMs === 21000, over && over.data.table);

  NOW = 31_000_000;
  const g2 = makeGame(["Solo"]);
  g2.goTo(R.ROUND_MS);
  check("solo survives to the time cap", g2.events("showdown-over").length === 1 && g2.events("showdown-over")[0].data.table[0].points === 10);
}

// ================================================================ bumps
{
  NOW = 40_000_000;
  const g = makeGame(["Ada", "Bo"]);
  g.goTo(2000);
  g.state("s1", [5, 0, 0]);
  g.state("s2", [6, 0, 0]);
  g.input("s1", { t: "bump", victim: "u2", dir: [1, 0] });
  const k = g.events("showdown-knock", "s2");
  check("bump in range knocks the victim", k.length === 1 && Math.abs(k[0].data.v[0] - 9) < 1e-9 && k[0].data.v[1] === 5, k[0] && k[0].data);
  g.input("s1", { t: "bump", victim: "u2", dir: [1, 0] });
  check("bump cooldown", g.events("showdown-knock").length === 1);
  NOW += 900;
  g.input("s1", { t: "bump", victim: "u2", dir: [1, 0] });
  check("bump again after the cooldown", g.events("showdown-knock").length === 2);
  NOW += 900;
  g.state("s2", [10, 0, 0]);
  g.input("s1", { t: "bump", victim: "u2", dir: [1, 0] });
  check("bump out of range refused", g.events("showdown-knock").length === 2);
  NOW += 900;
  g.input("s1", { t: "bump", victim: "u1", dir: [1, 0] });
  g.input("s1", { t: "bump", victim: "u9", dir: [1, 0] });
  g.input("s1", { t: "bump", victim: "u2", dir: [NaN, 0] });
  check("self, unknown and malformed bumps refused", g.events("showdown-knock").length === 2);

  // reconnects keep the player, keyed by uid
  g.game.updatePlayerId("s2", "s2b");
  check("reconnect keeps the player", g.game.players.get("s2b") && g.game.players.get("s2b").uid === "u2" && !g.game.players.has("s2"));
  g.room.players[1].id = "s2b";
  g.input("s2b", { t: "ready" });
  g.state("s2b", [6, 0, 0]);
  NOW += 900;
  g.input("s1", { t: "bump", victim: "u2", dir: [1, 0] });
  check("uid-keyed bumps still work after a reconnect", g.events("showdown-knock", "s2b").length === 1);

  // a player who leaves the room counts as out
  g.room.players.splice(1, 1);
  g.tick();
  check("leaving mid-round ends a two-player round", g.events("showdown-over").length === 1);
  g.game.stop();
}

// ================================================================ bad input
{
  NOW = 50_000_000;
  const g = makeGame(["Ada"]);
  g.goTo(1000);
  const keep = g.player("u1").pos.slice();
  g.state("s1", [NaN, 0, 0]);
  g.state("s1", [1, 2]);
  g.input("s1", { t: "state", p: "nope" });
  g.input("s1", null);
  g.input("nobody", { t: "state", p: [0, 0, 0] });
  check("malformed states are rejected", JSON.stringify(g.player("u1").pos) === JSON.stringify(keep));
  g.game.stop();
}

Date.now = realNow;
if (failures.length) {
  for (const f of failures) console.log("  x " + f);
  console.log(`FAIL  ${failures.length} of ${passed + failures.length} Jump Showdown checks failed`);
  process.exit(1);
}
console.log(`PASS  all ${passed} Jump Showdown checks passed`);
