const saved    = JSON.parse(sessionStorage.getItem("room") || "null");
const myName   = sessionStorage.getItem("myName");
const gameType = sessionStorage.getItem("gameType") || "snake";

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
  initGame(room);
});

socket.on("room-updated", (room) => {
  sessionStorage.setItem("room", JSON.stringify(room));
});

socket.on("game-ended", ({ scores }) => {
  if (typeof cleanupGame === "function") cleanupGame();
  sessionStorage.setItem("scores", JSON.stringify(scores || []));
  window.location.href = "results.html";
});

socket.on("kicked", () => {
  sessionStorage.clear();
  window.location.href = "index.html";
});

function initGame(room) {
  const isHost = room.host === socket.id;
  document.getElementById("host-end-controls").classList.toggle("hidden", !isHost);

  if (gameType === "snake") {
    initSnakeClient(socket, socket.id, room);
  }
}

document.getElementById("end-btn").addEventListener("click", () => {
  socket.emit("end-game");
});
