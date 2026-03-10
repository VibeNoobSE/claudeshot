const saved = JSON.parse(sessionStorage.getItem("room") || "null");
const myName = sessionStorage.getItem("myName");
const scores = JSON.parse(sessionStorage.getItem("scores") || "[]");

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

  const isHost = room.host === socket.id;
  document.getElementById("host-controls").classList.toggle("hidden", !isHost);
  document.getElementById("guest-msg").classList.toggle("hidden", isHost);

  renderScoreboard(scores, room);
});

socket.on("play-again", () => {
  sessionStorage.removeItem("scores");
  window.location.href = "lobby.html";
});

socket.on("kicked", () => {
  sessionStorage.clear();
  window.location.href = "index.html";
});

function renderScoreboard(scores, room) {
  const list = document.getElementById("scoreboard");
  list.innerHTML = "";

  const sorted = [...scores].sort((a, b) => b.score - a.score);

  if (sorted.length === 0) {
    room.players.forEach((p) => {
      sorted.push({ name: p.name, score: 0 });
    });
  }

  sorted.forEach((entry, i) => {
    const li = document.createElement("li");
    li.className = "score-item" + (entry.name === myName ? " me" : "");
    const rank = document.createElement("span");
    rank.className = "score-rank";
    rank.textContent = `${i + 1}.`;
    const name = document.createElement("span");
    name.className = "score-name";
    name.textContent = entry.name;
    const pts = document.createElement("span");
    pts.className = "score-points";
    pts.textContent = `${entry.score} pts`;
    li.append(rank, name, pts);
    list.appendChild(li);
  });
}

document.getElementById("play-again-btn").addEventListener("click", () => {
  socket.emit("play-again");
});
