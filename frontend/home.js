const socket = io(BACKEND_URL);

const nameInput = document.getElementById("name-input");
const codeInput = document.getElementById("code-input");
const createBtn = document.getElementById("create-btn");
const joinBtn = document.getElementById("join-btn");
const errorMsg = document.getElementById("error-msg");

function showError(msg) {
  errorMsg.textContent = msg;
  errorMsg.classList.remove("hidden");
}

function clearError() {
  errorMsg.textContent = "";
  errorMsg.classList.add("hidden");
}

function getName() {
  return nameInput.value.trim();
}

let selectedGame = "snake";

document.querySelectorAll(".game-card:not(:disabled)").forEach(card => {
  card.addEventListener("click", () => {
    document.querySelectorAll(".game-card").forEach(c => c.classList.remove("active"));
    card.classList.add("active");
    selectedGame = card.dataset.game;
  });
});

// Discover more games toggle
const discoverBtn = document.getElementById("discover-btn");
const discoverText = document.getElementById("discover-text");
const moreGames = document.getElementById("more-games");
let discoverOpen = false;
discoverBtn.addEventListener("click", () => {
  discoverOpen = !discoverOpen;
  moreGames.classList.toggle("hidden", !discoverOpen);
  discoverBtn.classList.toggle("open", discoverOpen);
  discoverText.textContent = discoverOpen ? "Hide extra games" : "Discover more games";
});

createBtn.addEventListener("click", () => {
  clearError();
  const name = getName();
  if (!name) {
    showError("Please enter your name first.");
    return;
  }
  socket.emit("create-room", { name, game: selectedGame });
});

joinBtn.addEventListener("click", () => {
  clearError();
  const name = getName();
  const code = codeInput.value.trim().toUpperCase();
  if (!name) {
    showError("Please enter your name first.");
    return;
  }
  if (!code) {
    showError("Please enter a room code.");
    return;
  }
  socket.emit("join-room", { code, name });
});

socket.on("room-joined", (room) => {
  sessionStorage.setItem("room", JSON.stringify(room));
  sessionStorage.setItem("myId", socket.id);
  sessionStorage.setItem("myName", getName());
  window.location.href = "lobby.html";
});

socket.on("error", (msg) => {
  showError(msg);
});
