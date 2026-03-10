const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");
const cors = require("cors");
const { createRoom, joinRoom, rejoinRoom, leaveRoom, getRooms } = require("./roomManager");
const SnakeGame = require("./games/snake");

const GAME_REGISTRY = {
  snake: { Game: SnakeGame, maxPlayers: 8 }
};

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "../frontend")));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "../frontend/index.html"));
});

// Active snake games keyed by room code
const activeGames = {};
// Round tracking keyed by room code
const activeRounds = {};

function startSnakeRound(r) {
  const round = activeRounds[r.code];
  r.gameStarted = true;
  io.to(r.code).emit("game-started", { game: "snake", round: round.current, totalRounds: round.total });

  const game = new SnakeGame(r, io, (roundScores) => {
    delete activeGames[r.code];
    r.gameStarted = false;

    // Accumulate scores
    roundScores.forEach(({ name, score }) => {
      round.totalScores[name] = (round.totalScores[name] || 0) + score;
    });

    const totalScoresSorted = Object.entries(round.totalScores)
      .map(([name, score]) => ({ name, score }))
      .sort((a, b) => b.score - a.score);

    if (round.current >= round.total) {
      delete activeRounds[r.code];
      io.to(r.code).emit("game-ended", { scores: totalScoresSorted });
    } else {
      io.to(r.code).emit("round-ended", {
        round: round.current,
        totalRounds: round.total,
        roundScores,
        totalScores: totalScoresSorted
      });
      round.current++;
      setTimeout(() => {
        if (getRooms().has(r.code)) startSnakeRound(r);
      }, 7000);
    }
  });

  activeGames[r.code] = game;
  game.start();
  console.log(`Snake round ${round.current}/${round.total} started in room ${r.code}`);
}

io.on("connection", (socket) => {
  console.log("Player connected:", socket.id);

  socket.on("create-room", ({ name, game }) => {
    if (!name || !name.trim()) {
      socket.emit("error", "Name is required.");
      return;
    }
    if (name.trim().length > 20) {
      socket.emit("error", "Name must be 20 characters or less.");
      return;
    }
    const validGames = Object.keys(GAME_REGISTRY);
    const selectedGame = validGames.includes(game) ? game : "snake";
    const maxPlayers = GAME_REGISTRY[selectedGame].maxPlayers;
    const room = createRoom(socket.id, name.trim(), selectedGame, maxPlayers);
    socket.join(room.code);
    socket.emit("room-joined", room);
    console.log(`Room ${room.code} created by ${name} (game: ${selectedGame})`);
  });

  socket.on("join-room", ({ code, name }) => {
    if (!name || !name.trim()) {
      socket.emit("error", "Name is required.");
      return;
    }
    if (name.trim().length > 20) {
      socket.emit("error", "Name must be 20 characters or less.");
      return;
    }
    if (!code || !code.trim()) {
      socket.emit("error", "Room code is required.");
      return;
    }
    const result = joinRoom(code.trim().toUpperCase(), socket.id, name.trim());
    if (result.error) {
      socket.emit("error", result.error);
      return;
    }
    socket.join(result.code);
    socket.emit("room-joined", result);
    io.to(result.code).emit("room-updated", result);
    console.log(`${name} joined room ${result.code}`);
  });

  socket.on("rejoin-room", ({ code, name }) => {
    if (!code || !name) {
      socket.emit("error", "Missing room code or name.");
      return;
    }
    const upperCode = code.toUpperCase();

    // Find old socket id before rejoin updates it
    const rooms = getRooms();
    const room = rooms.get(upperCode);
    const oldPlayer = room && room.players.find(p => p.name === name.trim());
    const oldId = oldPlayer ? oldPlayer.id : null;

    const result = rejoinRoom(upperCode, socket.id, name.trim());
    if (result.error) {
      socket.emit("kicked");
      return;
    }

    // Update snake game if active
    if (oldId && oldId !== socket.id && activeGames[upperCode]) {
      activeGames[upperCode].updatePlayerId(oldId, socket.id);
    }

    socket.join(result.code);
    socket.emit("room-joined", result);
    io.to(result.code).emit("room-updated", result);
    console.log(`${name} rejoined room ${result.code}`);
  });

  socket.on("start-game", ({ rounds } = {}) => {
    for (const [, r] of getRooms()) {
      if (r.host === socket.id) {
        const total = Math.min(5, Math.max(1, parseInt(rounds) || 1));
        activeRounds[r.code] = { current: 1, total, totalScores: {} };
        if (r.game === "snake") startSnakeRound(r);
        return;
      }
    }
  });

  socket.on("snake-input", ({ dir }) => {
    const validDirs = ["UP", "DOWN", "LEFT", "RIGHT"];
    if (!validDirs.includes(dir)) return;
    for (const [code, game] of Object.entries(activeGames)) {
      game.setInput(socket.id, dir);
    }
  });

  socket.on("end-game", () => {
    for (const [, r] of getRooms()) {
      if (r.host === socket.id) {
        if (activeGames[r.code]) {
          activeGames[r.code].stop();
          delete activeGames[r.code];
        }
        // Build final scores from whatever has been accumulated so far
        const round = activeRounds[r.code];
        const scores = round
          ? Object.entries(round.totalScores).map(([name, score]) => ({ name, score })).sort((a, b) => b.score - a.score)
          : [];
        delete activeRounds[r.code];
        r.gameStarted = false;
        io.to(r.code).emit("game-ended", { scores });
        console.log(`Game ended early in room ${r.code}`);
        return;
      }
    }
  });

  socket.on("play-again", () => {
    for (const [, r] of getRooms()) {
      if (r.host === socket.id) {
        io.to(r.code).emit("play-again");
        console.log(`Play again in room ${r.code}`);
        return;
      }
    }
  });

  socket.on("disconnect", () => {
    setTimeout(() => {
      const result = leaveRoom(socket.id);
      if (!result) return;
      if (!result.disbanded) {
        io.to(result.code).emit("room-updated", result.room);
        console.log(`Player left room ${result.code}`);
      } else {
        if (activeGames[result.code]) {
          activeGames[result.code].stop();
          delete activeGames[result.code];
        }
        delete activeRounds[result.code];
        console.log(`Room ${result.code} disbanded`);
      }
    }, 3000);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Claudeshot server running on http://localhost:${PORT}`);
});
