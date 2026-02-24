// ─────────────────────────────────────────────
//  CONFIG
// ─────────────────────────────────────────────
const API_KEY = "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";
const MODEL   = "arcee-ai/trinity-large-preview:free";
const SYSTEM_PROMPT = "You are Apex Mind. You are intelligent, sharp, confident and tactical. Keep responses clear and powerful.";

// ─────────────────────────────────────────────
//  STORAGE KEYS
// ─────────────────────────────────────────────
const STORAGE_SESSIONS_KEY  = "apexMind_sessions";   // JSON array of session metadata
const STORAGE_ACTIVE_KEY    = "apexMind_activeId";   // string: current session id
const STORAGE_MSG_PREFIX    = "apexMind_msgs_";       // + sessionId → JSON array of messages

// ─────────────────────────────────────────────
//  STATE
// ─────────────────────────────────────────────
let activeSessionId = null;
let chatHistory     = [];          // [{role,content}] (includes system msg)
let possession      = 0;
let isLoading       = false;

// ─────────────────────────────────────────────
//  STORAGE HELPERS
// ─────────────────────────────────────────────
function getSessions() {
  try { return JSON.parse(localStorage.getItem(STORAGE_SESSIONS_KEY)) || []; }
  catch { return []; }
}

function saveSessions(sessions) {
  localStorage.setItem(STORAGE_SESSIONS_KEY, JSON.stringify(sessions));
}

function getSessionMessages(id) {
  try { return JSON.parse(localStorage.getItem(STORAGE_MSG_PREFIX + id)) || []; }
  catch { return []; }
}

function saveSessionMessages(id, messages) {
  localStorage.setItem(STORAGE_MSG_PREFIX + id, JSON.stringify(messages));
}

function deleteSessionMessages(id) {
  localStorage.removeItem(STORAGE_MSG_PREFIX + id);
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function getActiveId() {
  return localStorage.getItem(STORAGE_ACTIVE_KEY) || null;
}

function setActiveId(id) {
  localStorage.setItem(STORAGE_ACTIVE_KEY, id);
}

// ─────────────────────────────────────────────
//  SESSION MANAGEMENT
// ─────────────────────────────────────────────
function createSession(label) {
  const id = generateId();
  const session = { id, label: label || "New Chat", createdAt: Date.now(), updatedAt: Date.now() };
  const sessions = getSessions();
  sessions.unshift(session);
  saveSessions(sessions);
  saveSessionMessages(id, [{ role: "system", content: SYSTEM_PROMPT }]);
  return session;
}

function updateSessionLabel(id, label) {
  const sessions = getSessions();
  const s = sessions.find(s => s.id === id);
  if (s) { s.label = label; s.updatedAt = Date.now(); saveSessions(sessions); }
}

function updateSessionTime(id) {
  const sessions = getSessions();
  const s = sessions.find(s => s.id === id);
  if (s) { s.updatedAt = Date.now(); saveSessions(sessions); }
}

function loadSession(id) {
  activeSessionId = id;
  setActiveId(id);
  chatHistory = getSessionMessages(id);
  if (!chatHistory.length || chatHistory[0].role !== "system") {
    chatHistory.unshift({ role: "system", content: SYSTEM_PROMPT });
    saveSessionMessages(id, chatHistory);
  }

  const sessions = getSessions();
  const s = sessions.find(s => s.id === id);
  document.getElementById("chatLabel").textContent = s ? s.label.toLowerCase() : "session";

  renderChat();
  renderHistoryList();
  closeSidebar();
}

// ─────────────────────────────────────────────
//  INIT
// ─────────────────────────────────────────────
window.onload = function () {
  let savedId = getActiveId();
  const sessions = getSessions();

  if (savedId && sessions.find(s => s.id === savedId)) {
    loadSession(savedId);
  } else if (sessions.length) {
    loadSession(sessions[0].id);
  } else {
    const s = createSession("New Chat");
    loadSession(s.id);
  }

  document.getElementById("userInput").addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); askAI(); }
  });
  document.getElementById("userInput").focus();
};

// ─────────────────────────────────────────────
//  NEW CHAT
// ─────────────────────────────────────────────
function newChat() {
  const s = createSession("New Chat");
  possession = 0;
  document.getElementById("possessionFill").style.width = "0%";
  loadSession(s.id);
  document.getElementById("userInput").focus();
}

// ─────────────────────────────────────────────
//  CLEAR CURRENT CHAT
// ─────────────────────────────────────────────
function clearCurrentChat() {
  if (!activeSessionId) return;
  chatHistory = [{ role: "system", content: SYSTEM_PROMPT }];
  saveSessionMessages(activeSessionId, chatHistory);
  updateSessionLabel(activeSessionId, "New Chat");
  document.getElementById("chatLabel").textContent = "new chat";
  possession = 0;
  document.getElementById("possessionFill").style.width = "0%";
  document.getElementById("chatBox").innerHTML = "";
  renderHistoryList();
}

// ─────────────────────────────────────────────
//  DELETE SESSION
// ─────────────────────────────────────────────
function deleteSession(id, e) {
  e.stopPropagation();
  let sessions = getSessions();
  sessions = sessions.filter(s => s.id !== id);
  saveSessions(sessions);
  deleteSessionMessages(id);

  if (activeSessionId === id) {
    if (sessions.length) {
      loadSession(sessions[0].id);
    } else {
      const s = createSession("New Chat");
      loadSession(s.id);
    }
  } else {
    renderHistoryList();
  }
}

// ─────────────────────────────────────────────
//  SIDEBAR
// ─────────────────────────────────────────────
function toggleSidebar() {
  const sidebar = document.getElementById("sidebar");
  const overlay = document.getElementById("overlay");
  const isOpen = sidebar.classList.contains("open");
  if (isOpen) { closeSidebar(); } else { renderHistoryList(); sidebar.classList.add("open"); overlay.classList.add("visible"); }
}
function closeSidebar() {
  document.getElementById("sidebar").classList.remove("open");
  document.getElementById("overlay").classList.remove("visible");
}

// ─────────────────────────────────────────────
//  RENDER HISTORY LIST
// ─────────────────────────────────────────────
function renderHistoryList() {
  const list = document.getElementById("historyList");
  const sessions = getSessions();

  if (!sessions.length) {
    list.innerHTML = `<div class="history-empty">No conversations yet.<br>Start a new chat!</div>`;
    return;
  }

  // Group by date
  const groups = {};
  sessions.forEach(s => {
    const d = new Date(s.updatedAt);
    const today = new Date();
    const yesterday = new Date(); yesterday.setDate(today.getDate() - 1);
    let label;
    if (d.toDateString() === today.toDateString()) label = "Today";
    else if (d.toDateString() === yesterday.toDateString()) label = "Yesterday";
    else label = d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    if (!groups[label]) groups[label] = [];
    groups[label].push(s);
  });

  let html = "";
  for (const [dateLabel, items] of Object.entries(groups)) {
    html += `<div class="history-date-group">${dateLabel}</div>`;
    items.forEach(s => {
      const active = s.id === activeSessionId ? "active" : "";
      html += `
        <div class="history-item ${active}" onclick="loadSession('${s.id}')">
          <div class="history-item-text">${escapeHtml(s.label)}</div>
          <button class="history-item-del" onclick="deleteSession('${s.id}', event)" title="Delete">✕</button>
        </div>`;
    });
  }

  list.innerHTML = html;
}

// ─────────────────────────────────────────────
//  RENDER CHAT (load messages into DOM)
// ─────────────────────────────────────────────
function renderChat() {
  const box = document.getElementById("chatBox");
  box.innerHTML = "";
  chatHistory.forEach(msg => {
    if (msg.role !== "system") addMessage(msg.content, msg.role === "user" ? "user" : "bot", false);
  });
  box.scrollTop = box.scrollHeight;
}

// ─────────────────────────────────────────────
//  ADD MESSAGE
// ─────────────────────────────────────────────
function addMessage(text, role, animate = true) {
  const box = document.getElementById("chatBox");

  const wrap = document.createElement("div");
  wrap.classList.add("message", role);
  if (!animate) wrap.style.animation = "none";

  const textDiv = document.createElement("div");
  textDiv.classList.add("msg-text");
  if (role === "bot") {
    textDiv.innerHTML = marked.parse(text);
  } else {
    textDiv.textContent = text;
  }

  const meta = document.createElement("div");
  meta.classList.add("msg-meta");

  const copyBtn = document.createElement("button");
  copyBtn.classList.add("copy-btn");
  copyBtn.textContent = "copy";
  copyBtn.onclick = () => copyText(text);

  const timeEl = document.createElement("div");
  timeEl.classList.add("time");
  timeEl.textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  meta.appendChild(copyBtn);
  meta.appendChild(timeEl);
  wrap.appendChild(textDiv);
  wrap.appendChild(meta);
  box.appendChild(wrap);
  box.scrollTop = box.scrollHeight;
  return wrap;
}

// ─────────────────────────────────────────────
//  COPY
// ─────────────────────────────────────────────
function copyText(text) {
  navigator.clipboard.writeText(text).then(() => {
    const toast = document.getElementById("copy-toast");
    toast.classList.add("show");
    setTimeout(() => toast.classList.remove("show"), 1400);
  });
}

// ─────────────────────────────────────────────
//  POSSESSION BAR
// ─────────────────────────────────────────────
function updatePossession() {
  possession = Math.min(100, possession + 3);
  document.getElementById("possessionFill").style.width = possession + "%";
}

// ─────────────────────────────────────────────
//  TYPING INDICATOR
// ─────────────────────────────────────────────
function showTyping() {
  const box = document.getElementById("chatBox");
  const div = document.createElement("div");
  div.classList.add("message", "bot");
  div.id = "typing-indicator";
  div.innerHTML = `<div class="msg-text" style="color:var(--text-muted);font-family:'Space Mono',monospace;font-size:12px;letter-spacing:1px;">thinking<span id="dots">.</span></div>`;
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;

  let d = 0;
  window._dotsInterval = setInterval(() => {
    const el = document.getElementById("dots");
    if (el) el.textContent = [".", "..", "..."][d++ % 3];
  }, 400);
}

function removeTyping() {
  clearInterval(window._dotsInterval);
  const el = document.getElementById("typing-indicator");
  if (el) el.remove();
}

// ─────────────────────────────────────────────
//  TYPE EFFECT
// ─────────────────────────────────────────────
function typeEffect(text) {
  const box = document.getElementById("chatBox");

  const wrap = document.createElement("div");
  wrap.classList.add("message", "bot");

  const textDiv = document.createElement("div");
  textDiv.classList.add("msg-text");
  wrap.appendChild(textDiv);
  box.appendChild(wrap);
  box.scrollTop = box.scrollHeight;

  let i = 0;
  const interval = setInterval(() => {
    textDiv.textContent += text[i++];
    box.scrollTop = box.scrollHeight;

    if (i >= text.length) {
      clearInterval(interval);
      textDiv.innerHTML = marked.parse(text);

      const meta = document.createElement("div");
      meta.classList.add("msg-meta");

      const copyBtn = document.createElement("button");
      copyBtn.classList.add("copy-btn");
      copyBtn.textContent = "copy";
      copyBtn.onclick = () => copyText(text);

      const timeEl = document.createElement("div");
      timeEl.classList.add("time");
      timeEl.textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

      meta.appendChild(copyBtn);
      meta.appendChild(timeEl);
      wrap.appendChild(meta);
      box.scrollTop = box.scrollHeight;
    }
  }, 14);
}

// ─────────────────────────────────────────────
//  ASK AI
// ─────────────────────────────────────────────
async function askAI() {
  if (isLoading) return;
  const input = document.getElementById("userInput");
  const userMessage = input.value.trim();
  if (!userMessage) return;

  isLoading = true;
  document.getElementById("sendBtn").disabled = true;

  addMessage(userMessage, "user");
  chatHistory.push({ role: "user", content: userMessage });
  input.value = "";
  input.focus();

  // Auto-label session from first user message
  const sessions = getSessions();
  const s = sessions.find(s => s.id === activeSessionId);
  if (s && s.label === "New Chat") {
    const label = userMessage.slice(0, 40) + (userMessage.length > 40 ? "…" : "");
    updateSessionLabel(activeSessionId, label);
    document.getElementById("chatLabel").textContent = label.toLowerCase();
  }

  updatePossession();
  showTyping();

  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: MODEL, messages: chatHistory, temperature: 0.7 })
    });

    if (!response.ok) throw new Error("API Error " + response.status);

    const data = await response.json();
    removeTyping();

    const aiText = data?.choices?.[0]?.message?.content || "Unexpected response.";
    typeEffect(aiText);

    chatHistory.push({ role: "assistant", content: aiText });
    saveSessionMessages(activeSessionId, chatHistory);
    updateSessionTime(activeSessionId);

  } catch (err) {
    removeTyping();
    addMessage("⚠️ Connection issue. Check your key or try again.", "bot");
    console.error(err);
  }

  isLoading = false;
  document.getElementById("sendBtn").disabled = false;
}

// ─────────────────────────────────────────────
//  EXPORT
// ─────────────────────────────────────────────
function exportChat() {
  let text = `APEX MIND — EXPORT\n${"─".repeat(40)}\n\n`;
  chatHistory.forEach(msg => {
    if (msg.role !== "system") text += `${msg.role.toUpperCase()}: ${msg.content}\n\n`;
  });

  const blob = new Blob([text], { type: "text/plain" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "apex-mind-chat.txt";
  a.click();
}

// ─────────────────────────────────────────────
//  UTIL
// ─────────────────────────────────────────────
function escapeHtml(s) {
  return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}
