# Claudeshot — Build Plan
> Longshot by Claude. A weekly party game site for co-workers.
> Stack: Node.js + Express + Socket.io (backend) | HTML + CSS + JS (frontend)
> Hosting: Render (backend) + Netlify (frontend)
> Rule: Each task leaves the project in a working state. One task at a time.

---

## Task 1 — Project scaffold
Create the folder structure, package.json, and a minimal Express server that starts without errors.
- `/backend/server.js` — Express app, hello world route
- `/backend/package.json` — dependencies: express, socket.io, cors
- `/frontend/index.html` — placeholder page
**Done when:** `node backend/server.js` runs and http://localhost:3000 returns a response.

---

## Task 2 — Room system (backend)
Add room creation and joining logic on the server. No frontend yet.
- Generate a unique 6-character room code
- Track rooms in memory: `{ code, host, players[] }`
- Socket.io events: `create-room`, `join-room`, `room-updated`, `error`
**Done when:** Two browser tabs can connect and one can create a room, the other can join it (verified via browser console).

---

## Task 3 — Home page (frontend)
Build the landing page where players enter their name and create or join a room.
- Input: player name
- Two buttons: "Create Room" and "Join Room" (with code input)
- Connects to backend via Socket.io
- On success: redirects to lobby
**Done when:** A player can type a name, create a room, and be redirected to lobby.html.

---

## Task 4 — Lobby page (frontend)
Waiting room shown after joining. Displays all connected players.
- Shows room code prominently so others can join
- Lists all players as they join in real time
- Host sees a "Start Game" button (disabled until 2+ players)
- Non-host sees "Waiting for host..."
**Done when:** Two browser tabs in the same room both show the player list updating live.

---

## Task 5 — Game shell (frontend + backend)
A blank game container that games will plug into later.
- Backend emits `game-started` event with a game type
- Frontend loads game.html and shows a placeholder "Game starts here"
- Host can end the game and return everyone to lobby
**Done when:** Host clicks Start, all players land on game.html, host can return to lobby.

---

## Task 6 — Results screen
End-of-game screen shown to all players.
- Displays a simple scoreboard (name + score)
- "Play Again" button returns to lobby
- Scores live only in memory — gone when the game ends (by design)
**Done when:** After a game ends, all players see the results screen with a working "Play Again" button.

---

## Task 7 — Visual styling
Apply the fun & colorful design across all pages.
- Color palette, fonts, button styles, card layouts
- Responsive enough for desktop (primary target)
- Consistent look across home, lobby, game, results pages
**Done when:** All pages look cohesive and polished.

---

## Task 8 — Hosting setup
Deploy the site so it's accessible from anywhere.
- Deploy backend to Render (free tier)
- Deploy frontend to Netlify (free tier)
- Connect frontend to the live backend URL
**Done when:** The site works end-to-end on a real URL, not just localhost.

---

## Games (separate plan)
Games are added after Task 8. Each game is self-contained and plugs into the game shell from Task 5.

---

## Session recovery
If a session ends mid-task, start the next session with:
> "We are building Claudeshot. Resume from Task [N]. The project is at /Users/jobbjonsson/Code/Claudeshot. Read PLAN.md first."
