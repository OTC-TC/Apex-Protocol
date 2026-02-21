const API_KEY = "AIzaSyC9IMwq-OGvqJJ81L3b-Y0n3rhyxD6fx0E"; // NEVER expose in production
let chatHistory = [];

document.getElementById("userInput")
  .addEventListener("keypress", function(e) {
    if (e.key === "Enter") {
      askAI();
    }
  });

function addMessage(text, className) {
  const chatBox = document.getElementById("chatBox");
  const messageDiv = document.createElement("div");
  messageDiv.classList.add("message", className);
  messageDiv.innerText = text;
  chatBox.appendChild(messageDiv);
  chatBox.scrollTop = chatBox.scrollHeight;
}

async function askAI() {
  const inputField = document.getElementById("userInput");
  const userMessage = inputField.value.trim();

  if (!userMessage) return;

  addMessage(userMessage, "user");
  inputField.value = "";

  addMessage("Thinking...", "ai");

  chatHistory.push({
    role: "user",
    parts: [{ text: userMessage }]
  });

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${API_KEY}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          contents: chatHistory
        })
      }
    );

    const data = await response.json();
    const aiText = data.candidates[0].content.parts[0].text;

    document.querySelector(".ai:last-child").remove();
    addMessage(aiText, "ai");

    chatHistory.push({
      role: "model",
      parts: [{ text: aiText }]
    });

  } catch (error) {
    document.querySelector(".ai:last-child").remove();
    addMessage("Error occurred. Try again.", "ai");
  }
}