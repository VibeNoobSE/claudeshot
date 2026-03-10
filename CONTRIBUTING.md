# Building a New Game for Claudeshot

This guide is for someone who wants to add a new multiplayer game. You don't need to understand the full codebase — the lobby, rooms, rounds, and results screen are already built and will work automatically for your game. You just build the game itself.

The recommended approach is to use Claude Code. Open a new chat, paste this file, describe your game idea, and ask it to write the code. Then bring the output back here to integrate it.

---

## What you're building

Every game is two files:

- **`backend/games/mygame.js`** — the server-side game logic (runs the game loop, tracks state, decides when the game ends)
- **`frontend/games/mygame-client.js`** — the client-side renderer (draws the game, captures player input, sends it to the server)

Everything else — the lobby, player list, round system, scoreboard, results page — already exists and doesn't need to change.

---

## Before you write any code: design your game

Answer these questions first. Share them with Claude when asking it to build the game.

**Game loop type — pick one:**
- **Turn-based**: players take turns, nothing moves until someone acts (e.g. trivia, tic-tac-toe)
- **Real-time**: the server ticks at a fixed interval regardless of input (e.g. snake, pong)

**Win condition:**
- Last player standing?
- First to reach a score threshold?
- Best score after a time limit?

**Player input:**
- Keyboard? (arrow keys, WASD, single keypresses)
- Clicking on the screen?
- Answering a question?

**What does the screen show?**
- A canvas (for anything visual/animated)
- HTML elements (for quiz/card games)

**Scoring:**
- What earns points? How many?
- The results screen ranks players by total score across all rounds — higher is better.

---

## How the server side works

Your backend class gets three things when it's created:

```
room   — the room object: { code, players: [{ id, name }], ... }
io     — the socket.io server, use this to send messages to players
onEnd  — a callback you call when the game is over with the final scores
```

During the game you broadcast state to all players in the room like this:
```js
this.io.to(this.room.code).emit("mygame-state", { /* whatever your game needs */ });
```

When the game ends, you call:
```js
this.onEnd([
  { name: "Alice", score: 12 },
  { name: "Bob",   score:  7 },
]);
```

The round system takes it from there — it accumulates scores across rounds and sends everyone to the results page when all rounds are done.

**Required methods your class must have:**
- `start()` — begin the game
- `stop()` — clean up (called when host clicks "End Game" or between rounds)
- `setInput(socketId, data)` — called when a player sends input from their browser
- `updatePlayerId(oldId, newId)` — called automatically by the platform if a player reconnects mid-game; update any internal references from `oldId` to `newId` so the player stays in the game

---

## How the client side works

Your frontend file needs two functions:

**`initMygameClient(socket, myId, room)`** — called when the game starts. Set up your UI, listen for state from the server, set up input handling.

**`cleanupGame()`** — called between rounds and when the game ends. Remove all event listeners and socket listeners, clear any intervals. If you don't clean up properly, the next round will have duplicate listeners.

The game renders inside `#game-area` — clear it and build your UI there:
```js
const gameArea = document.getElementById("game-area");
gameArea.innerHTML = "";
```

To send player input to the server:
```js
socket.emit("mygame-input", { /* your input data */ });
```

---

## Prompting Claude to build your game

Open a new chat and start with something like:

> I'm building a multiplayer party game called [name] for a platform called Claudeshot.
>
> Here's how the platform works: [paste this file]
>
> My game works like this: [describe your game — the rules, how players win, what the screen looks like, what input players use]
>
> Please write:
> 1. `backend/games/mygame.js` — the full server-side class
> 2. `frontend/games/mygame-client.js` — the full client-side renderer

The more specific you are about the rules and visuals, the better the output.

---

## Wiring it into the platform

Once you have the two game files, these edits connect them to the rest of the app. You can do these yourself or ask Claude Code in this repo to do them.

**`backend/server.js`** — this is the most involved step. Four things to do:

1. Add at the top with the other requires:
```js
const MyGame = require("./games/mygame");
```

2. Add to `validGames` in the `create-room` handler:
```js
const validGames = ["snake", "mygame"];
```

3. Copy the entire `startSnakeRound` function, paste it below, rename it `startMygameRound`, and replace `SnakeGame` with `MyGame` and every `"snake"` string with `"mygame"`.

4. Add a branch in `start-game`, after the snake line:
```js
if (r.game === "mygame") startMygameRound(r);
```

**`frontend/game.html`** — add before `game.js`:
```html
<script src="games/mygame-client.js"></script>
```

**`frontend/game.js`** — add a branch in `initGame`:
```js
if (room.game === "mygame") initMygameClient(socket, socket.id, room);
```

**`frontend/index.html`** — add a card in the `.game-picker` div:
```html
<button class="game-card" data-game="mygame">
  <span class="game-card-icon">🎮</span>
  <span class="game-card-name">My Game</span>
</button>
```

**`frontend/lobby.js`** — optional, only if your game has lobby settings (like a difficulty picker). Add a branch in `renderGameSettings`:
```js
if (game === "mygame") {
  gameSettings.difficulty = "normal"; // example
  container.innerHTML = `<!-- your settings UI -->`;
}
```

---

## File checklist

```
backend/games/mygame.js          ← new (write this)
frontend/games/mygame-client.js  ← new (write this)
backend/server.js                ← 3 small edits
frontend/game.html               ← 1 line
frontend/game.js                 ← 1 line
frontend/index.html              ← 4 lines
frontend/lobby.js                ← optional
```

---

## Submitting your game

When your game is ready, open a pull request to get it merged into the main repo.

1. **Fork the repo** on GitHub (top-right "Fork" button on the repo page)
2. **Clone your fork** locally and open it in Claude Code
3. **Build the game** — give Claude Code this file and your game description
4. **Push to your fork**:
   ```bash
   git add -A
   git commit -m "Add [game name]"
   git push
   ```
5. **Open a PR** on GitHub — go to your fork and click "Compare & pull request"

In your PR description, include:
- What the game is and how it works
- How to win / how scoring works
- Any known issues or limitations

The repo owner will review it, and once merged they'll deploy it.

---

## Deploy (repo owners only)

```bash
./deploy.sh "Add [game name]"
```

Render will pick it up in ~1 minute.
