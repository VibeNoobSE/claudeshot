// Typing Race — parallel singleplayer
// Everyone types words simultaneously, see each other's progress live

const WORDS = [
  "code", "debug", "deploy", "sprint", "merge", "commit", "push", "branch",
  "review", "build", "test", "ship", "stack", "queue", "array", "async",
  "server", "client", "socket", "render", "parse", "fetch", "route", "token",
  "login", "admin", "cloud", "docker", "react", "query", "index", "cache",
];
const WORDS_TO_TYPE = 12;
const TICK_MS = 200;

class TypingGame {
  constructor(room, io, onEnd) {
    this.room = room;
    this.io = io;
    this.onEnd = onEnd;
    this.players = {};
    this.interval = null;
    this.startTime = null;
    this.finished = false;
  }

  start() {
    // Give each player the same word list
    const wordList = [];
    const shuffled = [...WORDS].sort(() => Math.random() - 0.5);
    for (let i = 0; i < WORDS_TO_TYPE; i++) {
      wordList.push(shuffled[i % shuffled.length]);
    }

    this.room.players.forEach(p => {
      this.players[p.id] = {
        name: p.name,
        wordsCompleted: 0,
        currentTyped: "",
        finishTime: null,
        mistakes: 0,
      };
    });

    this.wordList = wordList;

    // Countdown
    let countdown = 3;
    const cdInterval = setInterval(() => {
      this.io.to(this.room.code).emit("typing-countdown", { count: countdown });
      countdown--;
      if (countdown < 0) {
        clearInterval(cdInterval);
        this.startTime = Date.now();
        this.io.to(this.room.code).emit("typing-start", { words: this.wordList });
        this.interval = setInterval(() => this.tick(), TICK_MS);
      }
    }, 1000);
  }

  tick() {
    const elapsed = Date.now() - this.startTime;
    const playerList = Object.entries(this.players).map(([id, p]) => ({
      id,
      name: p.name,
      wordsCompleted: p.wordsCompleted,
      totalWords: WORDS_TO_TYPE,
      currentTyped: p.currentTyped,
      finishTime: p.finishTime,
      progress: Math.round((p.wordsCompleted / WORDS_TO_TYPE) * 100),
    }));

    this.io.to(this.room.code).emit("typing-state", {
      players: playerList,
      elapsed: Math.round(elapsed / 1000),
    });

    // Check if everyone finished or 60s timeout
    const allDone = Object.values(this.players).every(p => p.finishTime !== null);
    if (allDone || elapsed > 60000) {
      this.endGame();
    }
  }

  endGame() {
    if (this.finished) return;
    this.finished = true;
    this.stop();
    const scores = Object.values(this.players).map(p => ({
      name: p.name,
      // Score: words completed * 100 - time penalty - mistakes
      score: Math.max(0,
        p.wordsCompleted * 100 -
        (p.finishTime ? Math.round(p.finishTime / 100) : 500) -
        p.mistakes * 10
      ),
    }));
    this.onEnd(scores);
  }

  stop() {
    if (this.interval) clearInterval(this.interval);
    this.interval = null;
  }

  setInput(socketId, data) {
    const p = this.players[socketId];
    if (!p || p.finishTime !== null) return;

    if (data.type === "typed") {
      p.currentTyped = data.text || "";
    } else if (data.type === "word-complete") {
      const expected = this.wordList[p.wordsCompleted];
      if (data.word === expected) {
        p.wordsCompleted++;
        p.currentTyped = "";
        if (p.wordsCompleted >= WORDS_TO_TYPE) {
          p.finishTime = Date.now() - this.startTime;
        }
      }
    } else if (data.type === "mistake") {
      p.mistakes++;
    }
  }

  updatePlayerId(oldId, newId) {
    if (this.players[oldId]) {
      this.players[newId] = this.players[oldId];
      delete this.players[oldId];
    }
  }
}

module.exports = TypingGame;
