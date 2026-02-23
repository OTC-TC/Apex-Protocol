// ⚠️ NEVER expose API keys in frontend in production
const API_KEY = "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";
const MODEL = "arcee-ai/trinity-large-preview:free";

let chatHistory = [
  {
    role: "system",
    content:
      "You are Apex Mind. You are intelligent, sharp, confident and tactical. Keep responses clear and powerful."
  }
];

let possession = 0;
let isLoading = false;

const chatBox = document.getElementById("chatBox");
const inputField = document.getElementById("userInput");

/* =============================
   ENTER SUPPORT
============================= */
inputField.addEventListener("keydown", function (e) {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    askAI();
  }
});

/* =============================
   ADD MESSAGE (CLICK TO COPY)
============================= */
function addMessage(text, role) {
  const messageDiv = document.createElement("div");
  messageDiv.classList.add("message", role);

  const textDiv = document.createElement("div");
  textDiv.classList.add("msg-text");

  if (role === "bot") {
    textDiv.innerHTML = marked.parse(text);
  } else {
    textDiv.textContent = text;
  }

  const time = document.createElement("div");
  time.classList.add("time");
  time.innerText = new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit"
  });

  messageDiv.appendChild(textDiv);
  messageDiv.appendChild(time);

  // ✅ CLICK ANY MESSAGE TO COPY
  messageDiv.style.cursor = "pointer";
  messageDiv.addEventListener("click", () => {
    copyText(text);
  });

  chatBox.appendChild(messageDiv);
  smoothScroll();
}

/* =============================
   COPY SYSTEM
============================= */
function copyText(text) {
  navigator.clipboard.writeText(text).then(() => {
    showCopyFeedback();
  });
}

function showCopyFeedback() {
  const existing = document.getElementById("copy-popup");
  if (existing) existing.remove();

  const popup = document.createElement("div");
  popup.id = "copy-popup";
  popup.innerText = "Copied ✓";

  popup.style.position = "fixed";
  popup.style.bottom = "25px";
  popup.style.right = "25px";
  popup.style.background = "#111";
  popup.style.color = "#fff";
  popup.style.padding = "8px 14px";
  popup.style.borderRadius = "8px";
  popup.style.fontSize = "13px";
  popup.style.zIndex = "9999";

  document.body.appendChild(popup);

  setTimeout(() => popup.remove(), 1000);
}

/* =============================
   SCROLL
============================= */
function smoothScroll() {
  chatBox.scrollTop = chatBox.scrollHeight;
}

/* =============================
   POSSESSION BAR
============================= */
function updatePossession() {
  possession = Math.min(100, possession + 3);
  const fill = document.querySelector(".possession-fill");
  if (fill) fill.style.width = possession + "%";
}

/* =============================
   TYPING INDICATOR
============================= */
function showTyping() {
  const typingDiv = document.createElement("div");
  typingDiv.classList.add("message", "bot");
  typingDiv.id = "typing";

  const textDiv = document.createElement("div");
  textDiv.classList.add("msg-text");
  textDiv.innerText = "Apex Mind is thinking...";

  typingDiv.appendChild(textDiv);
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
  if (isLoading) return;

  const userMessage = inputField.value.trim();
  if (!userMessage) return;

  isLoading = true;

  addMessage(userMessage, "user");

  chatHistory.push({
    role: "user",
    content: userMessage
  });

  inputField.value = "";
  inputField.focus();

  updatePossession();
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
          messages: chatHistory,
          temperature: 0.7
        })
      }
    );

    if (!response.ok) throw new Error("API Error");

    const data = await response.json();
    removeTyping();

    const aiText =
      data?.choices?.[0]?.message?.content ||
      "Unexpected response.";

    typeEffect(aiText);

    chatHistory.push({
      role: "assistant",
      content: aiText
    });

    saveChat();
  } catch (error) {
    removeTyping();
    addMessage("⚠️ Connection issue. Try again.", "bot");
    console.error(error);
  }

  isLoading = false;
}

/* =============================
   TYPING EFFECT
============================= */
function typeEffect(text) {
  const messageDiv = document.createElement("div");
  messageDiv.classList.add("message", "bot");

  const textDiv = document.createElement("div");
  textDiv.classList.add("msg-text");

  messageDiv.appendChild(textDiv);
  chatBox.appendChild(messageDiv);
  smoothScroll();

  let index = 0;

  const interval = setInterval(() => {
    textDiv.textContent += text[index];
    index++;
    smoothScroll();

    if (index >= text.length) {
      clearInterval(interval);

      textDiv.innerHTML = marked.parse(text);

      const time = document.createElement("div");
      time.classList.add("time");
      time.innerText = new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit"
      });

      messageDiv.appendChild(time);

      // ✅ CLICK TO COPY
      messageDiv.style.cursor = "pointer";
      messageDiv.addEventListener("click", () => {
        copyText(text);
      });

      saveChat();
    }
  }, 15);
}

/* =============================
   SAVE & LOAD CHAT
============================= */
function saveChat() {
  localStorage.setItem("apexMindChat", JSON.stringify(chatHistory));
}

function loadChat() {
  const saved = localStorage.getItem("apexMindChat");
  if (!saved) return;

  chatHistory = JSON.parse(saved);
  chatBox.innerHTML = "";

  chatHistory.forEach(msg => {
    if (msg.role !== "system") {
      addMessage(
        msg.content,
        msg.role === "user" ? "user" : "bot"
      );
    }
  });
}

window.onload = function () {
  loadChat();
  inputField.focus();
};

/* =============================
   CLEAR CHAT
============================= */
function clearChat() {
  chatBox.innerHTML = "";
  chatHistory = [
    {
      role: "system",
      content:
        "You are Apex Mind. You are intelligent, sharp, confident and tactical."
    }
  ];
  localStorage.removeItem("apexMindChat");

  possession = 0;
  const fill = document.querySelector(".possession-fill");
  if (fill) fill.style.width = "0%";
}

/* =============================
   EXPORT CHAT
============================= */
function exportChat() {
  let text = "";

  chatHistory.forEach(msg => {
    if (msg.role !== "system") {
      text += `${msg.role.toUpperCase()}: ${msg.content}\n\n`;
    }
  });

  const blob = new Blob([text], { type: "text/plain" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "apex-mind-chat.txt";
  a.click();
}
