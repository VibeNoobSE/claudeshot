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
  initGame(room);
});

socket.on("room-updated", (room) => {
  sessionStorage.setItem("room", JSON.stringify(room));
});

socket.on("game-ended", ({ scores }) => {
  sessionStorage.setItem("scores", JSON.stringify(scores || []));
  window.location.href = "results.html";
});

socket.on("kicked", () => {
  sessionStorage.clear();
  window.location.href = "index.html";
});

function initGame(room) {
  const isHost = room.host === socket.id;

  document.getElementById("game-area").innerHTML = `
    <p style="font-size:1.2rem; font-weight:700; color:#f7c948; margin-bottom:0.5rem;">
      Game in progress!
    </p>
    <p class="waiting-msg">Games will appear here.</p>
  `;

  document.getElementById("host-end-controls").classList.toggle("hidden", !isHost);
}

document.getElementById("end-btn").addEventListener("click", () => {
  socket.emit("end-game");
});
