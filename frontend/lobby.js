const saved = JSON.parse(sessionStorage.getItem("room") || "null");
const myName = sessionStorage.getItem("myName");

if (!saved || !myName) {
  window.location.href = "index.html";
}

const socket = io(BACKEND_URL);

socket.on("connect", () => {
  socket.emit("rejoin-room", { code: saved.code, name: myName });
});

socket.on("room-joined", (room) => {
  sessionStorage.setItem("room", JSON.stringify(room));
  sessionStorage.setItem("myId", socket.id);
  renderRoom(room);
});

socket.on("room-updated", (room) => {
  sessionStorage.setItem("room", JSON.stringify(room));
  renderRoom(room);
});

socket.on("kicked", () => {
  sessionStorage.clear();
  window.location.href = "index.html";
});

socket.on("game-started", () => {
  window.location.href = "game.html";
});

const GAME_NAMES = { snake: "🐍 Snake" };

let gameSettings = {};

function renderGameSettings(game) {
  const container = document.getElementById("game-settings");
  container.innerHTML = "";
  gameSettings = {};

  if (game === "snake") {
    gameSettings.rounds = 1;
    container.innerHTML = `
      <div class="round-picker">
        <label class="label">Rounds</label>
        <div class="round-btns">
          ${[1,2,3,4,5].map(n =>
            `<button class="round-btn${n === 1 ? " active" : ""}" data-rounds="${n}">${n}</button>`
          ).join("")}
        </div>
      </div>`;
    container.querySelectorAll(".round-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        container.querySelectorAll(".round-btn").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        gameSettings.rounds = parseInt(btn.dataset.rounds);
      });
    });
  }
}

function renderRoom(room) {
  document.getElementById("room-code").textContent = room.code;
  document.getElementById("player-count").textContent = `${room.players.length} / ${room.maxPlayers}`;

  const gameLabel = document.getElementById("game-label");
  if (gameLabel) gameLabel.textContent = GAME_NAMES[room.game] || room.game;

  const list = document.getElementById("player-list");
  list.innerHTML = "";
  room.players.forEach((p) => {
    const li = document.createElement("li");
    li.className = "player-item";
    const isHost = p.id === room.host;
    li.textContent = p.name + (isHost ? " (host)" : "");
    if (p.id === socket.id) li.classList.add("me");
    list.appendChild(li);
  });

  const isHost = room.host === socket.id;
  document.getElementById("host-controls").classList.toggle("hidden", !isHost);
  document.getElementById("guest-msg").classList.toggle("hidden", isHost);

  if (isHost && document.getElementById("game-settings").innerHTML === "") {
    renderGameSettings(room.game);
  }

  const startBtn = document.getElementById("start-btn");
  if (isHost) {
    const canStart = room.players.length >= 1;
    startBtn.disabled = !canStart;
    startBtn.textContent = canStart ? "Start Game" : "Waiting for players...";
  }
}

document.getElementById("start-btn").addEventListener("click", () => {
  socket.emit("start-game", gameSettings);
});
