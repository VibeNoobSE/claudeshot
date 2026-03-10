// Typing Race client — parallel singleplayer with live progress
let _typingCleanup = [];

function initTypingClient(socket, myId, room) {
  const gameArea = document.getElementById("game-area");
  gameArea.innerHTML = "";

  const container = document.createElement("div");
  container.style.cssText = "max-width:700px;margin:0 auto;font-family:monospace;";
  gameArea.appendChild(container);

  const timerEl = document.createElement("div");
  timerEl.style.cssText = "text-align:center;font-size:14px;color:#888;margin-bottom:8px;";
  container.appendChild(timerEl);

  const wordDisplay = document.createElement("div");
  wordDisplay.style.cssText = "text-align:center;font-size:36px;color:#fff;margin:16px 0;min-height:50px;letter-spacing:4px;";
  container.appendChild(wordDisplay);

  const inputDisplay = document.createElement("div");
  inputDisplay.style.cssText = "text-align:center;font-size:36px;color:#4ecca3;margin-bottom:16px;min-height:50px;letter-spacing:4px;";
  container.appendChild(inputDisplay);

  const progressArea = document.createElement("div");
  progressArea.style.cssText = "display:flex;flex-direction:column;gap:8px;margin-top:16px;";
  container.appendChild(progressArea);

  let words = [];
  let myWordIdx = 0;
  let typed = "";

  function onCountdown({ count }) {
    wordDisplay.textContent = count > 0 ? count : "GET READY...";
    wordDisplay.style.color = "#f7c948";
    inputDisplay.textContent = "";
  }

  function onStart({ words: w }) {
    words = w;
    myWordIdx = 0;
    typed = "";
    wordDisplay.style.color = "#fff";
    wordDisplay.textContent = words[0] || "";
    inputDisplay.textContent = "";
  }

  function onState({ players, elapsed }) {
    timerEl.textContent = elapsed + "s elapsed";

    progressArea.innerHTML = players
      .sort((a, b) => b.wordsCompleted - a.wordsCompleted)
      .map(p => {
        const isMe = p.id === myId;
        const barColor = isMe ? "#f7c948" : "#5dade2";
        const done = p.finishTime !== null;
        return `
          <div style="display:flex;align-items:center;gap:10px;">
            <span style="min-width:80px;color:${isMe ? "#f7c948" : "#ccc"};font-weight:${isMe ? "bold" : "normal"};font-size:13px;">${p.name}</span>
            <div style="flex:1;height:20px;background:#1a1a2e;border-radius:4px;overflow:hidden;border:1px solid #2a3a5e;">
              <div style="width:${p.progress}%;height:100%;background:${barColor};transition:width 0.2s;"></div>
            </div>
            <span style="min-width:50px;font-size:12px;color:${done ? "#4ecca3" : "#888"};">${done ? "DONE!" : p.wordsCompleted + "/" + p.totalWords}</span>
          </div>`;
      }).join("");
  }

  function onKeyDown(e) {
    if (myWordIdx >= words.length) return;
    if (e.key.length === 1 && e.key.match(/[a-z]/i)) {
      typed += e.key.toLowerCase();
      inputDisplay.textContent = typed;
      inputDisplay.style.color = "#4ecca3";
      socket.emit("typing-input", { type: "typed", text: typed });

      const target = words[myWordIdx];
      if (typed === target) {
        // Word complete
        socket.emit("typing-input", { type: "word-complete", word: typed });
        myWordIdx++;
        typed = "";
        inputDisplay.textContent = "";
        if (myWordIdx < words.length) {
          wordDisplay.textContent = words[myWordIdx];
        } else {
          wordDisplay.textContent = "FINISHED!";
          wordDisplay.style.color = "#4ecca3";
        }
      } else if (!target.startsWith(typed)) {
        // Mistake
        socket.emit("typing-input", { type: "mistake" });
        typed = "";
        inputDisplay.textContent = "✗";
        inputDisplay.style.color = "#e94560";
        setTimeout(() => { inputDisplay.textContent = ""; inputDisplay.style.color = "#4ecca3"; }, 200);
      }
    }
    if (e.key === "Backspace") {
      typed = typed.slice(0, -1);
      inputDisplay.textContent = typed;
      socket.emit("typing-input", { type: "typed", text: typed });
    }
  }

  document.addEventListener("keydown", onKeyDown);
  socket.on("typing-countdown", onCountdown);
  socket.on("typing-start", onStart);
  socket.on("typing-state", onState);

  _typingCleanup = [
    () => document.removeEventListener("keydown", onKeyDown),
    () => socket.off("typing-countdown", onCountdown),
    () => socket.off("typing-start", onStart),
    () => socket.off("typing-state", onState),
  ];
}

function cleanupTypingClient() {
  _typingCleanup.forEach(fn => fn());
  _typingCleanup = [];
}
