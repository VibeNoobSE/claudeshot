const socket = io(BACKEND_URL, { transports: ["websocket"] });

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


// ---- invite links --------------------------------------------------------
// index.html?room=ABCD&game=shooter pre-fills the code and picks the game, so a
// shared link drops someone straight into the right room.
function selectGame(game) {
  const card = document.querySelector('.game-card[data-game="' + game + '"]');
  if (!card) return null;
  document.querySelectorAll(".game-card").forEach(c => c.classList.remove("active"));
  card.classList.add("active");
  selectedGame = game;
  return card;
}

const params = new URLSearchParams(window.location.search);
const invitedCode = (params.get("room") || params.get("code") || "").trim().toUpperCase();
const invitedGame = (params.get("game") || "").trim().toLowerCase();
const invitedCard = invitedGame ? selectGame(invitedGame) : null;

// remember the player's name between visits so an invite is one click
const rememberedName = localStorage.getItem("myName");
if (rememberedName) nameInput.value = rememberedName;

if (invitedCode) {
  codeInput.value = invitedCode;
  const banner = document.getElementById("invite-banner");
  if (banner) {
    const gameName = invitedCard
      ? invitedCard.querySelector(".game-card-name").textContent
      : null;
    banner.textContent = "You're invited to room " + invitedCode +
      (gameName ? " \u00b7 " + gameName : "");
    banner.classList.remove("hidden");
  }
  (rememberedName ? joinBtn : nameInput).focus();
}

// Enter submits, which is what people expect when a code is already filled in
nameInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") (codeInput.value.trim() ? joinBtn : createBtn).click();
});
codeInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") joinBtn.click();
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
  localStorage.setItem("myName", getName());
  window.location.href = "lobby.html";
});

socket.on("error", (msg) => {
  showError(msg);
});
