const saved  = JSON.parse(sessionStorage.getItem("room") || "null");
const myName = sessionStorage.getItem("myName");

if (!saved || !myName) {
  window.location.href = "index.html";
}

const socket = io(BACKEND_URL, { transports: ["websocket"] });

socket.on("connect", () => {
  socket.emit("rejoin-room", { code: saved.code, name: myName });
});

socket.on("room-joined", (room) => {
  sessionStorage.setItem("room", JSON.stringify(room));
  sessionStorage.setItem("myId", socket.id);
  initGame(room);
});

socket.on("room-updated", (room) => {
  sessionStorage.setItem("room", JSON.stringify(room));
});

// Update round indicator and re-init for rounds 2+
socket.on("game-started", ({ game: g, round, totalRounds }) => {
  const indicator = document.getElementById("round-indicator");
  if (indicator && round) indicator.textContent = `Round ${round} / ${totalRounds}`;
  if (!round || round <= 1) return; // first round already initialized via room-joined
  document.getElementById("round-overlay").classList.add("hidden");
  const room = JSON.parse(sessionStorage.getItem("room") || "null");
  if (room) initGame(room);
});

socket.on("round-ended", ({ round, totalRounds, roundScores, totalScores }) => {
  cleanupAllGames();
  showRoundOverlay(round, totalRounds, roundScores, totalScores);
});

socket.on("game-ended", ({ scores }) => {
  cleanupAllGames();
  sessionStorage.setItem("scores", JSON.stringify(scores || []));
  window.location.href = "results.html";
});

socket.on("kicked", () => {
  sessionStorage.clear();
  window.location.href = "index.html";
});

function cleanupAllGames() {
  if (typeof cleanupGame === "function") cleanupGame();           // snake
  if (typeof cleanupHungryClient === "function") cleanupHungryClient();
}

function initGame(room) {
  cleanupAllGames();
  const isHost = room.host === socket.id;
  document.getElementById("host-end-controls").classList.toggle("hidden", !isHost);

  if (room.game === "snake")  initSnakeClient(socket, socket.id, room);
  if (room.game === "hungry") initHungryClient(socket, socket.id, room);
}

let roundOverlayTimer = null;

function showRoundOverlay(round, totalRounds, roundScores, totalScores) {
  const overlay  = document.getElementById("round-overlay");
  const title    = document.getElementById("round-overlay-title");
  const list     = document.getElementById("round-overlay-scores");
  const nextLine = document.getElementById("round-overlay-next");

  title.textContent = `Round ${round} complete`;

  list.innerHTML = "";
  totalScores.forEach((s, i) => {
    const li = document.createElement("li");
    li.style.cssText = "display:flex;justify-content:space-between;gap:1.5rem;padding:0.2rem 0;";
    li.style.color = s.name === myName ? "#f7c948" : "#e2e8f0";
    const nameSpan = document.createElement("span");
    nameSpan.textContent = `${i + 1}. ${s.name}`;
    const ptsSpan = document.createElement("span");
    ptsSpan.style.fontWeight = "800";
    ptsSpan.textContent = `${s.score} pts`;
    li.append(nameSpan, ptsSpan);
    list.appendChild(li);
  });

  if (roundOverlayTimer) clearInterval(roundOverlayTimer);
  let secs = 7;
  nextLine.textContent = `Next round in ${secs}s…`;
  roundOverlayTimer = setInterval(() => {
    secs--;
    if (secs <= 0) { clearInterval(roundOverlayTimer); roundOverlayTimer = null; nextLine.textContent = ""; }
    else nextLine.textContent = `Next round in ${secs}s…`;
  }, 1000);

  overlay.classList.remove("hidden");
}

document.getElementById("end-btn").addEventListener("click", () => {
  socket.emit("end-game");
});
