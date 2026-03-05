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

createBtn.addEventListener("click", () => {
  clearError();
  const name = getName();
  if (!name) {
    showError("Please enter your name first.");
    return;
  }
  socket.emit("create-room", { name });
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
