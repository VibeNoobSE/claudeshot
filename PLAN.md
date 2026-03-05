# Claudeshot — Build Plan
> Longshot by Claude. A weekly party game site for co-workers.
> Stack: Node.js + Express + Socket.io (backend) | HTML + CSS + JS (frontend)
> Hosting: Render (backend) + Netlify (frontend)
> Rule: Each task leaves the project in a working state. One task at a time.

---

## Task 1 — Project scaffold ✅
## Task 2 — Room system (backend) ✅
## Task 3 — Home page (frontend) ✅
## Task 4 — Lobby page (frontend) ✅
## Task 5 — Game shell (frontend + backend) ✅
## Task 6 — Results screen ✅
## Task 7 — Visual styling ✅
## Task 8 — Hosting setup ✅

---

## GAME: Multiplayer Snake

> Up to 8 players. Each controls a snake. Random apples appear — most are good (grow snake), some are bad (instant death). Bad apples look almost identical to good ones but with a subtle color difference. Last snake alive wins.
> All game logic runs server-side. Canvas rendered client-side.
> Files: `frontend/games/snake.html`, `frontend/games/snake.js`, `backend/games/snake.js`

---

### Snake Task 1 — Game loop & canvas (single player, local only)
Build a working single-player snake game in isolation — no multiplayer yet.
- `frontend/games/snake.html` — standalone page with a canvas
- `frontend/games/snake.js` — local game loop, keyboard controls, snake movement on a grid
- Grid: 40×40 cells. Canvas sized to fit desktop.
- Snake starts at 3 cells, moves at a fixed tick rate
- One good apple spawns at a time — eating it grows the snake
- Hitting a wall or yourself ends the game
- No bad apples yet, no multiplayer, no server
**Done when:** You can open snake.html in a browser and play a working solo snake game.

---

### Snake Task 2 — Apple types
Add bad apples to the solo game.
- Good apple: bright red (`#e63946`)
- Bad apple: very slightly darker/more muted red (`#c1121f`) — easy to miss under pressure
- Bad apple spawns randomly alongside good apple (roughly 1 bad per 3 good)
- Eating a bad apple ends the game immediately
- Both apple types look like the same shape — only color differs
**Done when:** Solo game has both apple types working correctly.

---

### Snake Task 3 — Server-side game logic
Move the game loop to the server. Client sends inputs, server runs the simulation.
- `backend/games/snake.js` — authoritative game loop
  - Manages snake positions, movement, collision detection
  - Spawns apples (good and bad)
  - Broadcasts full game state to all players every tick
- Server tick rate: 150ms
- Socket.io events: `snake-input` (client→server), `snake-state` (server→client)
- No frontend changes yet — verify via console logs
**Done when:** Server runs the snake loop and logs state every tick.

---

### Snake Task 4 — Multiplayer rendering
Connect the frontend to the server game loop.
- Update `frontend/games/snake.js` to receive `snake-state` and render all snakes
- Each player's snake gets a unique color
- Dead snakes are shown as faded/grey
- Player's own snake is slightly brighter than others
- Keyboard input sends `snake-input` to server
- Canvas shows all snakes, all apples, grid background
**Done when:** Two browser tabs can join the same room and see each other's snakes moving in real time.

---

### Snake Task 5 — Win condition & integration
Wire the game into the existing Claudeshot platform.
- Server detects last snake alive → emits `game-ended` with scores (survival time or placement)
- Host starts snake via existing `start-game` event — server routes it to the snake module
- On death, player sees their snake fade out but stays watching
- Game ends when 1 player remains (or all die simultaneously → no winner)
- Results screen shows final placement (1st, 2nd, etc.)
**Done when:** Full flow works — lobby → snake game → results → play again.

---

### Snake Task 6 — Polish & deploy
Final touches and push live.
- Add a countdown (3-2-1-GO!) before snakes start moving
- Show player names above their snakes
- Show a live "snakes remaining" counter
- Deploy to Render via git push
**Done when:** Game is live at claudeshot.onrender.com and playable end-to-end.

---

## Session recovery
If a session ends mid-task, start the next session with:
> "We are building Claudeshot. Resume from Snake Task [N]. The project is at /Users/jobbjonsson/Code/Claudeshot. Read PLAN.md first."
