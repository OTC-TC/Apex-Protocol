const API_KEY = "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"; // NEVER expose in production
const MODEL = "openai/gpt-4o-mini"; // change model if needed

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

  // OpenRouter uses OpenAI-style format
  chatHistory.push({
    role: "user",
    content: userMessage
  });

  try {
    const response = await fetch(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${API_KEY}`,
          "Content-Type": "application/json",
          "HTTP-Referer": window.location.href,
          "X-Title": "Apex Protocol"
        },
        body: JSON.stringify({
          model: MODEL,
          messages: chatHistory
        })
      }
    );

    const data = await response.json();

    const aiText = data.choices[0].message.content;

    document.querySelector(".ai:last-child").remove();
    addMessage(aiText, "ai");

    chatHistory.push({
      role: "assistant",
      content: aiText
    });

  } catch (error) {
    document.querySelector(".ai:last-child").remove();
    addMessage("Error occurred. Try again.", "ai");
    console.error(error);
  }
}
