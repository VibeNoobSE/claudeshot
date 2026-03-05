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

function renderRoom(room) {
  document.getElementById("room-code").textContent = room.code;
  document.getElementById("player-count").textContent = room.players.length;

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

  const startBtn = document.getElementById("start-btn");
  if (isHost) {
    const canStart = room.players.length >= 2;
    startBtn.disabled = !canStart;
    startBtn.textContent = canStart ? "Start Game" : "Waiting for players...";
  }
}

document.getElementById("start-btn").addEventListener("click", () => {
  socket.emit("start-game");
});
