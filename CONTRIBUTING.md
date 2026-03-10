# Adding a New Game to Claudeshot

Each game is two files: a backend class that runs the game loop, and a frontend client that renders it. The lobby, rounds, scoring, and results page are all game-agnostic — you don't touch them.

---

## Step 1 — Backend: `backend/games/mygame.js`

Create a class with this interface:

```js
class MyGame {
  constructor(room, io, onEnd) {
    this.room  = room;  // { code, players: [{ id, name }], ... }
    this.io    = io;    // socket.io server instance
    this.onEnd = onEnd; // call this when the game is over: onEnd([{ name, score }, ...])
    this.interval = null;
  }

  start() {
    // Set up and begin the game loop
    this.interval = setInterval(() => this.gameTick(), 100);
  }

  stop() {
    // Clean up — always called before onEnd, and by the host "End Game" button
    clearInterval(this.interval);
  }

  updatePlayerId(oldId, newId) {
    // Called if a player reconnects mid-game — update any reference to oldId → newId
  }

  setInput(socketId, data) {
    // Called when a player emits a game-specific input event from the frontend
    // data is whatever the client sent
  }

  gameTick() {
    // Your game logic here
    // Broadcast state to players:
    this.io.to(this.room.code).emit("mygame-state", { /* ... */ });
    // When the game is over, call:
    // this.endGame();
  }

  endGame() {
    this.stop();
    const scores = this.room.players.map(p => ({ name: p.name, score: 0 }));
    // Populate scores — array of { name: string, score: number }
    // Higher score = better rank on the results page
    this.onEnd(scores);
  }
}

module.exports = MyGame;
```

**Notes:**
- `room.players` is an array of `{ id, name }` — `id` is the socket ID
- Emit any events you want to the room using `this.io.to(this.room.code).emit(...)`
- `onEnd` must be called exactly once with `[{ name, score }]` — the round system accumulates these automatically across rounds

---

## Step 2 — Frontend: `frontend/games/mygame-client.js`

Create a file with two functions:

```js
function initMygameClient(socket, myId, room) {
  // Set up the game UI inside #game-area
  const gameArea = document.getElementById("game-area");
  gameArea.innerHTML = "";

  // Listen for state from the server
  socket.on("mygame-state", (state) => {
    // Render state
  });

  // Send input to the server
  window.addEventListener("keydown", myKeyHandler);
  // socket.emit("mygame-input", { ... });
}

function cleanupGame() {
  // Remove event listeners, clear intervals, etc.
  // This is called automatically between rounds and on game end
  window.removeEventListener("keydown", myKeyHandler);
  socket.off("mygame-state");
}
```

**Notes:**
- Always render into `#game-area` — clear it first with `gameArea.innerHTML = ""`
- `cleanupGame` is called by `game.js` between rounds — make sure it fully resets state
- Use `socket.off("mygame-state")` in cleanup to avoid duplicate listeners on round 2+

---

## Step 3 — Wire it up (4 changes)

### `backend/server.js`

Add the require at the top:
```js
const MyGame = require("./games/mygame");
```

Add your game to `validGames` in the `create-room` handler:
```js
const validGames = ["snake", "mygame"];
```

Add a branch in `start-game`:
```js
if (r.game === "snake")  startSnakeRound(r);
if (r.game === "mygame") startMygameRound(r);
```

Copy `startSnakeRound` and rename it `startMygameRound`, replacing `SnakeGame` with `MyGame` and `"snake"` with `"mygame"` in the emit.

### `frontend/game.html`

Add a script tag before `game.js`:
```html
<script src="games/mygame-client.js"></script>
```

### `frontend/game.js`

Add a branch in `initGame`:
```js
if (room.game === "snake")  initSnakeClient(socket, socket.id, room);
if (room.game === "mygame") initMygameClient(socket, socket.id, room);
```

### `frontend/index.html`

Add a game card in the `.game-picker` div:
```html
<button class="game-card" data-game="mygame">
  <span class="game-card-icon">🎮</span>
  <span class="game-card-name">My Game</span>
</button>
```

### `frontend/lobby.js` (optional)

If your game has lobby settings (like round count for snake), add a branch in `renderGameSettings`:
```js
if (game === "mygame") {
  gameSettings.myOption = "default";
  container.innerHTML = `<!-- your settings HTML -->`;
}
```

`gameSettings` is sent as-is with `start-game`, and received in `server.js` as the first argument to `start-game`.

---

## File checklist

```
backend/games/mygame.js          ← new
frontend/games/mygame-client.js  ← new
backend/server.js                ← 3 edits
frontend/game.html               ← 1 edit
frontend/game.js                 ← 1 edit
frontend/index.html              ← 1 edit
frontend/lobby.js                ← 1 edit (optional, if lobby settings needed)
```

---

## Deploying

```bash
./deploy.sh "Add mygame"
```

Render will pick it up in ~1 minute.
