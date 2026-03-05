const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");
const cors = require("cors");
const { createRoom, joinRoom, rejoinRoom, leaveRoom, getRooms } = require("./roomManager");
const SnakeGame = require("./games/snake");

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

io.on("connection", (socket) => {
  console.log("Player connected:", socket.id);

  socket.on("create-room", ({ name }) => {
    if (!name || !name.trim()) {
      socket.emit("error", "Name is required.");
      return;
    }
    const room = createRoom(socket.id, name.trim());
    socket.join(room.code);
    socket.emit("room-joined", room);
    console.log(`Room ${room.code} created by ${name}`);
  });

  socket.on("join-room", ({ code, name }) => {
    if (!name || !name.trim()) {
      socket.emit("error", "Name is required.");
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

  socket.on("start-game", () => {
    for (const [, r] of getRooms()) {
      if (r.host === socket.id) {
        r.gameStarted = true;
        io.to(r.code).emit("game-started", { game: "snake" });

        const game = new SnakeGame(r, io, (scores) => {
          delete activeGames[r.code];
          r.gameStarted = false;
          io.to(r.code).emit("game-ended", { scores });
        });
        activeGames[r.code] = game;
        game.start();

        console.log(`Snake game started in room ${r.code}`);
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

  socket.on("end-game", ({ scores } = {}) => {
    for (const [, r] of getRooms()) {
      if (r.host === socket.id) {
        if (activeGames[r.code]) {
          activeGames[r.code].stop();
          delete activeGames[r.code];
        }
        r.gameStarted = false;
        io.to(r.code).emit("game-ended", { scores: scores || [] });
        console.log(`Game ended in room ${r.code}`);
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
        console.log(`Room ${result.code} disbanded`);
      }
    }, 3000);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Claudeshot server running on http://localhost:${PORT}`);
});
