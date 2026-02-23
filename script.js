// ⚠️ DO NOT expose API keys in frontend in production
const API_KEY = "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";
const MODEL = "stepfun/step-3.5-flash:free";

let chatHistory = [];
let possession = 0;

const chatBox = document.getElementById("chatBox");
const inputField = document.getElementById("userInput");

/* =============================
   ENTER + SHIFT SUPPORT
============================= */
inputField.addEventListener("keydown", function (e) {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    askAI();
  }
});

/* =============================
   ADD MESSAGE
============================= */
function addMessage(text, className) {
  const messageDiv = document.createElement("div");
  messageDiv.classList.add("message", className);

  const time = new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit"
  });

  messageDiv.innerHTML = `
    <div>${text}</div>
    <div class="time">${time}</div>
  `;

  chatBox.appendChild(messageDiv);

  smoothScroll();
  saveChat();
}

/* =============================
   SMOOTH SCROLL
============================= */
function smoothScroll() {
  chatBox.scrollTo({
    top: chatBox.scrollHeight,
    behavior: "smooth"
  });
}

/* =============================
   POSSESSION METER
============================= */
function updatePossession() {
  possession = Math.min(100, possession + 4);
  document.querySelector(".possession-fill").style.width =
    possession + "%";
}

/* =============================
   TYPING INDICATOR
============================= */
function showTyping() {
  const typingDiv = document.createElement("div");
  typingDiv.classList.add("message", "bot");
  typingDiv.id = "typing";
  typingDiv.innerHTML = `<div>Building play...</div>`;
  chatBox.appendChild(typingDiv);
  smoothScroll();
}

function removeTyping() {
  const typing = document.getElementById("typing");
  if (typing) typing.remove();
}

/* =============================
   ASK AI
============================= */
async function askAI() {
  const userMessage = inputField.value.trim();
  if (!userMessage) return;

  addMessage(userMessage, "user");
  inputField.value = "";

  updatePossession();

  chatHistory.push({
    role: "user",
    content: userMessage
  });

  showTyping();

  try {
    const response = await fetch(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: MODEL,
          messages: chatHistory
        })
      }
    );

    const data = await response.json();

    removeTyping();

    if (!data.choices) {
      addMessage("Tactical error. Try again.", "bot");
      return;
    }

    const aiText = data.choices[0].message.content;

    addMessage(aiText, "bot");

    chatHistory.push({
      role: "assistant",
      content: aiText
    });

  } catch (error) {
    removeTyping();
    addMessage("Connection lost. Regain control.", "bot");
    console.error(error);
  }
}

/* =============================
   LOCAL STORAGE
============================= */
function saveChat() {
  localStorage.setItem("barcaChat", chatBox.innerHTML);
}

function loadChat() {
  const saved = localStorage.getItem("barcaChat");
  if (saved) chatBox.innerHTML = saved;
}

window.onload = loadChat;

/* =============================
   CLEAR CHAT
============================= */
function clearChat() {
  chatBox.innerHTML = "";
  chatHistory = [];
  localStorage.removeItem("barcaChat");
}

/* =============================
   RELOAD
============================= */
function reloadChat() {
  location.reload();
}





