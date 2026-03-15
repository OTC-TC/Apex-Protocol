// ══════════════════════════════════════════════════════════════
//  APEX MIND AI — script.js
//  AI Study Planner as home screen + all original features
// ══════════════════════════════════════════════════════════════

const API_KEY_DEFAULT = "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";
const OR_APP_TITLE   = "Apex Mind AI";
const OR_HTTP_REFERER = (typeof window !== "undefined" && window.location && window.location.origin)
  ? window.location.origin : "https://localhost";

const MODELS      = ["openrouter/healer-alpha"];
const VISION_MODEL = "openrouter/healer-alpha";

// Anthropic API for Study Planner (Claude Sonnet)
const ANTHROPIC_PLANNER_MODEL = "claude-sonnet-4-20250514";

const SYSTEM_PROMPT = `You are Apex Mind AI, an intelligent study coach designed to help students learn deeply, not just get answers.

Your goals:
1. Teach concepts clearly and simply.
2. Guide students step-by-step using questions (Socratic teaching).
3. Help students practice with quizzes and problems.
4. Encourage thinking, not memorization.
5. Adapt explanations to the student's level.

Behavior rules:
1. EXPLAIN CLEARLY - Start with a simple explanation, give a real-world example, key bullet-point notes, end with a practice question.
2. SOCRATIC TUTOR MODE - When solving problems do NOT immediately give the answer. Ask guiding questions. Break into steps. Only reveal the final answer if the student asks or gets stuck.
3. QUIZ GENERATION - Generate 3-5 questions, mix MCQ and short answers. After the student answers, check and explain mistakes.
4. SIMPLIFY WHEN NEEDED - Use analogies and everyday examples.
5. SUPPORTIVE STUDY COACH - Be encouraging and motivating.
6. STRUCTURED RESPONSES - Use this format when possible:
Concept / Example / Key Points / Practice Question
Always use markdown formatting.
7. IMAGE ANALYSIS - When a student shares an image of a question, diagram, equation, or any study material, analyze it carefully and provide a thorough educational explanation.`;

// ── Storage keys ──
const SK_SESSIONS = "apexStudy_sessions";
const SK_ACTIVE   = "apexStudy_activeId";
const SK_MSG      = "apexStudy_msgs_";
const SK_TRACKER  = "apexStudy_tracker";
const SK_API_KEY  = "apexStudy_apiKey";
const SK_PLANNER  = "apexStudy_planner"; // stores today's plan
const SK_WEAKNESS = "apexStudy_weakness"; // weakness tracking data

// ── Global state ──
let activeSessionId = null, chatHistory = [], studyProgress = 0, isLoading = false;
let pillState = {nlen:"short",nlang:"English",mnum:5,mtype:"mcq",mtime:10,mdiff:"medium",fnum:5,fmode:"classic",fdiff:"medium"};
let mockQuestions = [], mockAnswers = {}, mockCorrectAnswers = {}, mockExplanations = {};
let mockTimerInt = null, mockSecsLeft = 0;
const MAX_CHAT_MESSAGES = 20;

// ── Flashcard state ──
let flashCards = [], flashIdx = 0, flashCorrect = 0, flashWrong = 0;
let flashResults = [], flashLivesLeft = 3, flashTimerInt = null, flashTimerSecs = 0;
let flashIsFlipped = false, flashMode = "classic", flashTopic = "";

// ── Image attach state ──
let attachedImageBase64 = null, attachedImageMime = null, attachedImageName = null;

// ── Planner state ──
let plannerData = {
  exam: "", subjects: [], totalMins: 0,
  plan: [], doneItems: {}, generatedDate: ""
};
let plannerSubColors = [
  {bar:"#34c98a", bg:"rgba(52,201,138,0.12)", text:"#34c98a", icon:"📗"},
  {bar:"#7b9ef8", bg:"rgba(123,158,248,0.12)", text:"#7b9ef8", icon:"📘"},
  {bar:"#e0a840", bg:"rgba(224,168,64,0.12)",  text:"#e0a840", icon:"📙"},
  {bar:"#e07a4a", bg:"rgba(224,122,74,0.12)",  text:"#e07a4a", icon:"📕"},
  {bar:"#c084fc", bg:"rgba(192,132,252,0.12)", text:"#c084fc", icon:"📓"},
  {bar:"#38bdf8", bg:"rgba(56,189,248,0.12)",  text:"#38bdf8", icon:"📒"},
  {bar:"#f472b6", bg:"rgba(244,114,182,0.12)", text:"#f472b6", icon:"📔"},
  {bar:"#a3e635", bg:"rgba(163,230,53,0.12)",  text:"#a3e635", icon:"📗"},
];
const EXAM_SUBJECT_MAP = {
  "JEE":               ["Physics","Chemistry","Maths"],
  "NEET":              ["Physics","Chemistry","Biology"],
  "Class 12 Boards":   ["Physics","Chemistry","Maths","Biology","English"],
  "UPSC":              ["History","Geography","Polity","Economics","Current Affairs"],
  "IELTS":             ["Reading","Writing","Listening","Speaking"],
  "SAT":               ["Maths","English","Reading"],
  "General Learning":  []
};

// ══════════════════════════════════════════════════════════════
//  UTILITIES
// ══════════════════════════════════════════════════════════════
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function escapeHtml(s) {
  if (typeof s !== "string") return "";
  return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}
function trimMessages(messages, max) {
  if (!Array.isArray(messages)) return [];
  if (messages.length <= max) return messages;
  const system = messages.find(m => m.role === "system");
  const nonSystem = messages.filter(m => m.role !== "system");
  const keep = Math.max(1, max - (system ? 1 : 0));
  const tail = nonSystem.slice(-keep);
  return system ? [system, ...tail] : tail;
}
function todayStr() { return new Date().toISOString().slice(0, 10); }

// ══════════════════════════════════════════════════════════════
//  STUDY TRACKER
// ══════════════════════════════════════════════════════════════
let trackerData = null, studyTimerInt = null, studyTimerSecs = 0, studyTimerRunning = false;

function getTrackerData()   { try { return JSON.parse(localStorage.getItem(SK_TRACKER)) || createDefaultTracker(); } catch { return createDefaultTracker(); } }
function saveTrackerData(d) { localStorage.setItem(SK_TRACKER, JSON.stringify(d)); }
function createDefaultTracker() {
  return { subjects:[], goals:[], sessions:[], quizzesTaken:0, mockTestsTaken:0,
           flashcardsTaken:0, notesTaken:0, totalMsgs:0, streakDays:[], createdAt:Date.now() };
}
function ensureToday() {
  const d = getTrackerData(), today = todayStr();
  if (!d.streakDays.includes(today)) { d.streakDays.push(today); saveTrackerData(d); }
}
function getStreak() {
  const d = getTrackerData();
  if (!d.streakDays.length) return 0;
  const days = [...new Set(d.streakDays)].sort();
  let streak = 0;
  const today = new Date(); today.setHours(0,0,0,0);
  for (let i = days.length - 1; i >= 0; i--) {
    const day = new Date(days[i]); day.setHours(0,0,0,0);
    const diff = Math.round((today - day) / 86400000);
    if (diff === streak) streak++; else break;
  }
  return streak;
}
function getTodayMins() { const d=getTrackerData(),today=todayStr(); return d.sessions.filter(s=>s.date===today).reduce((a,s)=>a+(s.mins||0),0); }
function getWeekMins()  { const d=getTrackerData(),now=new Date(),wa=new Date(now-7*86400000).toISOString().slice(0,10); return d.sessions.filter(s=>s.date>=wa).reduce((a,s)=>a+(s.mins||0),0); }
function logStudySession(subjectId, mins, notes) {
  const d = getTrackerData();
  d.sessions.push({ date:todayStr(), subjectId, mins, notes:notes||"" });
  if (subjectId != null) { const sub = d.subjects.find(s=>s.id===subjectId); if (sub) sub.totalMins=(sub.totalMins||0)+mins; }
  saveTrackerData(d); ensureToday();
}
function trackMock()  { const d=getTrackerData(); d.mockTestsTaken=(d.mockTestsTaken||0)+1; saveTrackerData(d); ensureToday(); }
function trackFlash() { const d=getTrackerData(); d.flashcardsTaken=(d.flashcardsTaken||0)+1; saveTrackerData(d); ensureToday(); }
function trackNotes() { const d=getTrackerData(); d.notesTaken=(d.notesTaken||0)+1; saveTrackerData(d); ensureToday(); }
function trackMsg()   { const d=getTrackerData(); d.totalMsgs=(d.totalMsgs||0)+1; saveTrackerData(d); ensureToday(); }

// ══════════════════════════════════════════════════════════════
//  PILL / MODAL HELPERS
// ══════════════════════════════════════════════════════════════
function setPill(group, val) {
  pillState[group] = val;
  document.querySelectorAll(`[id^="${group}-"]`).forEach(e => e.classList.remove("on"));
  const t = document.getElementById(group + "-" + val);
  if (t) t.classList.add("on");
}
function openModal(id)  { document.getElementById(id).classList.add("open"); }
function closeModal(id) { document.getElementById(id).classList.remove("open"); }

// ══════════════════════════════════════════════════════════════
//  STORAGE
// ══════════════════════════════════════════════════════════════
function getSessions()     { try { return JSON.parse(localStorage.getItem(SK_SESSIONS)) || []; } catch { return []; } }
function saveSessions(s)   { localStorage.setItem(SK_SESSIONS, JSON.stringify(s)); }
function getMsgs(id)       { try { return JSON.parse(localStorage.getItem(SK_MSG + id)) || []; } catch { return []; } }
function saveMsgs(id, m)   { localStorage.setItem(SK_MSG + id, JSON.stringify(m)); }
function delMsgs(id)       { localStorage.removeItem(SK_MSG + id); }
function genId()           { return Date.now().toString(36) + Math.random().toString(36).slice(2,7); }
function getActiveId()     { return localStorage.getItem(SK_ACTIVE) || null; }
function setActiveId(id)   { localStorage.setItem(SK_ACTIVE, id); }
function getApiKey()       { return localStorage.getItem(SK_API_KEY) || API_KEY_DEFAULT || ""; }
function setApiKey(k)      { localStorage.setItem(SK_API_KEY, k); }
function requireApiKey() {
  let key = getApiKey(); if (key) return key;
  const input = prompt("Enter your OpenRouter API key:");
  if (input && input.trim()) { key = input.trim(); setApiKey(key); return key; }
  throw new Error("Missing API key.");
}

// ══════════════════════════════════════════════════════════════
//  WEAKNESS DETECTION SYSTEM
// ══════════════════════════════════════════════════════════════

// Data model: { topics: { "Physics > Thermodynamics": { subject, topic, errors, attempts, lastSeen } } }
function getWeaknessData() {
  try { return JSON.parse(localStorage.getItem(SK_WEAKNESS)) || { topics: {} }; } catch { return { topics: {} }; }
}
function saveWeaknessData(d) { localStorage.setItem(SK_WEAKNESS, JSON.stringify(d)); }

// Extract subject+topic from a question text and subject hint
function inferSubjectTopic(questionText, subjectHint) {
  // subjectHint comes from the mock test topic or flashcard topic
  const text = (questionText || "").toLowerCase();
  // Subject detection
  const subjectKeywords = {
    "Physics": ["velocity","acceleration","force","newton","energy","momentum","wave","thermodynamics","heat","optics","electric","magnetic","current","resistance","quantum","nucleus","atom","pressure","fluid","motion","torque","rotation"],
    "Chemistry": ["organic","reaction","bond","molecule","element","periodic","acid","base","pH","equilibrium","oxidation","reduction","polymer","hydrocarbon","alkane","alkene","benzene","electron","orbital","entropy","enthalpy"],
    "Biology": ["cell","mitosis","meiosis","dna","rna","protein","enzyme","photosynthesis","respiration","evolution","genetics","ecosystem","organism","membrane","chromosome","hormone","nervous","digestion","circulation"],
    "Maths": ["equation","derivative","integral","matrix","vector","probability","statistics","function","graph","angle","triangle","circle","polynomial","logarithm","series","sequence","limit","calculus"],
    "History": ["war","empire","revolution","treaty","dynasty","independence","civilization","colonial","battle","parliament","king","queen","republic","constitution","movement"],
    "Geography": ["climate","river","mountain","continent","ocean","population","migration","urbanization","agriculture","soil","weather","latitude","longitude","ecosystem","rainfall"],
    "Economics": ["supply","demand","gdp","inflation","market","trade","investment","fiscal","monetary","unemployment","price","cost","revenue","profit","capital","labour"],
  };
  let detectedSubject = subjectHint || "General";
  for (const [subject, keywords] of Object.entries(subjectKeywords)) {
    if (keywords.some(kw => text.includes(kw))) { detectedSubject = subject; break; }
  }

  // Topic detection within subject
  const topicMap = {
    "Physics": {
      "Thermodynamics": ["thermodynamics","heat","temperature","entropy","enthalpy","calorimetry","carnot","specific heat","thermal"],
      "Mechanics": ["force","newton","motion","velocity","acceleration","momentum","work","energy","power","collision"],
      "Optics": ["light","reflection","refraction","lens","mirror","prism","wavelength","diffraction","interference"],
      "Electricity": ["current","voltage","resistance","ohm","circuit","capacitor","inductor","electric field","charge"],
      "Magnetism": ["magnetic","flux","induction","faraday","ampere","solenoid","electromagnet"],
      "Rotational Motion": ["torque","angular","rotation","moment of inertia","centripetal","circular"],
      "Waves": ["wave","frequency","amplitude","sound","oscillation","resonance","doppler"],
      "Modern Physics": ["quantum","photon","atom","nucleus","radioactive","fission","fusion","photoelectric"],
    },
    "Chemistry": {
      "Organic Chemistry": ["organic","hydrocarbon","alkane","alkene","alkyne","benzene","ester","aldehyde","ketone","alcohol","carboxylic"],
      "Chemical Bonding": ["bond","ionic","covalent","metallic","hybridization","molecular","van der waals","hydrogen bond"],
      "Thermochemistry": ["enthalpy","entropy","gibbs","hess","calorimetry","exothermic","endothermic","heat of reaction"],
      "Electrochemistry": ["electrode","electrolysis","galvanic","cell potential","faraday","oxidation","reduction","redox"],
      "Equilibrium": ["equilibrium","kc","kp","le chatelier","dissociation","ionization","ph","buffer"],
      "Periodic Table": ["periodic","element","group","period","atomic number","valence","electronegativity","ionization energy"],
      "Coordination Chemistry": ["coordination","ligand","chelate","complex","d-block","transition metal","isomerism"],
    },
    "Biology": {
      "Cell Biology": ["cell","membrane","organelle","mitochondria","ribosome","nucleus","golgi","endoplasmic"],
      "Genetics": ["gene","dna","rna","chromosome","allele","dominant","recessive","mutation","heredity","mendel"],
      "Cell Division": ["mitosis","meiosis","prophase","metaphase","anaphase","telophase","cytokinesis","spindle"],
      "Photosynthesis": ["photosynthesis","chlorophyll","chloroplast","light reaction","calvin cycle","carbon fixation"],
      "Respiration": ["respiration","atp","glycolysis","krebs cycle","oxidative phosphorylation","fermentation"],
      "Evolution": ["evolution","natural selection","darwin","mutation","adaptation","fossil","speciation","fitness"],
      "Human Physiology": ["digestion","circulation","nervous","endocrine","immune","excretion","respiration","reproduction"],
    },
    "Maths": {
      "Calculus": ["derivative","integral","limit","differentiation","integration","continuity","maxima","minima","rate of change"],
      "Algebra": ["equation","polynomial","quadratic","linear","matrix","determinant","logarithm","exponential","inequality"],
      "Trigonometry": ["sine","cosine","tangent","angle","triangle","identity","inverse trig","radian","degree"],
      "Probability": ["probability","statistics","random variable","distribution","mean","variance","combination","permutation"],
      "Coordinate Geometry": ["coordinate","slope","line","circle","parabola","ellipse","hyperbola","distance formula"],
      "Vectors": ["vector","scalar","dot product","cross product","magnitude","direction","unit vector"],
    },
  };

  let detectedTopic = "General Concepts";
  const topicsForSubject = topicMap[detectedSubject];
  if (topicsForSubject) {
    for (const [topic, keywords] of Object.entries(topicsForSubject)) {
      if (keywords.some(kw => text.includes(kw))) { detectedTopic = topic; break; }
    }
  }

  return { subject: detectedSubject, topic: detectedTopic };
}

// Called when a mock test question is answered wrong
function trackWeaknessMock(question, subjectHint) {
  const { subject, topic } = inferSubjectTopic(question, subjectHint);
  const key = subject + " > " + topic;
  const d = getWeaknessData();
  if (!d.topics[key]) d.topics[key] = { subject, topic, errors: 0, attempts: 0, lastSeen: Date.now(), sources: [] };
  d.topics[key].errors++;
  d.topics[key].attempts++;
  d.topics[key].lastSeen = Date.now();
  if (!d.topics[key].sources.includes("mock")) d.topics[key].sources.push("mock");
  saveWeaknessData(d);
  updateWeaknessBadge();
}

// Called when mock test question is answered correctly
function trackStrengthMock(question, subjectHint) {
  const { subject, topic } = inferSubjectTopic(question, subjectHint);
  const key = subject + " > " + topic;
  const d = getWeaknessData();
  if (!d.topics[key]) d.topics[key] = { subject, topic, errors: 0, attempts: 0, lastSeen: Date.now(), sources: [] };
  d.topics[key].attempts++;
  d.topics[key].lastSeen = Date.now();
  saveWeaknessData(d);
}

// Called when flashcard is missed
function trackWeaknessFlash(cardFront, subjectHint) {
  const { subject, topic } = inferSubjectTopic(cardFront, subjectHint);
  const key = subject + " > " + topic;
  const d = getWeaknessData();
  if (!d.topics[key]) d.topics[key] = { subject, topic, errors: 0, attempts: 0, lastSeen: Date.now(), sources: [] };
  d.topics[key].errors++;
  d.topics[key].attempts++;
  d.topics[key].lastSeen = Date.now();
  if (!d.topics[key].sources.includes("flashcard")) d.topics[key].sources.push("flashcard");
  saveWeaknessData(d);
  updateWeaknessBadge();
}

// Called when user asks about a topic in chat (tracks confusion signals)
function trackWeaknessChat(messageText) {
  const confusionWords = ["don't understand","confused","explain","what is","how does","why is","help me","struggling","stuck","difficult","hard","not sure","i don't know"];
  const isStruggling = confusionWords.some(w => messageText.toLowerCase().includes(w));
  if (!isStruggling) return;
  const { subject, topic } = inferSubjectTopic(messageText, null);
  if (subject === "General") return; // not specific enough
  const key = subject + " > " + topic;
  const d = getWeaknessData();
  if (!d.topics[key]) d.topics[key] = { subject, topic, errors: 0, attempts: 0, lastSeen: Date.now(), sources: [] };
  d.topics[key].errors += 0.5; // chat confusion counts as half-weight
  d.topics[key].attempts++;
  d.topics[key].lastSeen = Date.now();
  if (!d.topics[key].sources.includes("chat")) d.topics[key].sources.push("chat");
  saveWeaknessData(d);
  updateWeaknessBadge();
}

// Get ranked list of weak areas (error rate > 30% or error count >= 2)
function getWeakAreas() {
  const d = getWeaknessData();
  return Object.entries(d.topics)
    .map(([key, t]) => ({
      key, subject: t.subject, topic: t.topic,
      errorRate: t.attempts > 0 ? t.errors / t.attempts : 0,
      errors: t.errors, attempts: t.attempts,
      lastSeen: t.lastSeen, sources: t.sources || []
    }))
    .filter(t => t.errors >= 1 && t.errorRate >= 0.25)
    .sort((a, b) => (b.errorRate * b.errors) - (a.errorRate * a.errors));
}

function updateWeaknessBadge() {
  const weak = getWeakAreas();
  const btn = document.getElementById("weaknessBtnHdr");
  if (!btn) return;
  let badge = btn.querySelector(".weakness-badge-dot");
  if (weak.length > 0) {
    if (!badge) {
      badge = document.createElement("span");
      badge.className = "weakness-badge-dot";
      btn.appendChild(badge);
    }
    badge.textContent = weak.length > 9 ? "9+" : weak.length;
  } else {
    if (badge) badge.remove();
  }
}

// Open Weakness Modal
function openWeaknessModal() {
  openModal("weaknessModal");
  renderWeaknessModal();
}

function renderWeaknessModal() {
  const weak = getWeakAreas();
  const container = document.getElementById("weaknessModalBody");
  if (!container) return;

  if (weak.length === 0) {
    container.innerHTML = `
      <div class="weakness-empty">
        <div class="weakness-empty-icon">🎉</div>
        <div class="weakness-empty-title">No weak areas detected yet!</div>
        <div class="weakness-empty-sub">Take mock tests, use flashcards, and ask questions.<br>Your weak spots will appear here so you can fix them.</div>
        <div class="weakness-sources">
          <div class="ws-item">⏱️ Mock tests track wrong answers</div>
          <div class="ws-item">⚡ Flashcards track missed cards</div>
          <div class="ws-item">💬 Chat tracks questions about confusing topics</div>
        </div>
      </div>`;
    return;
  }

  // Group by subject
  const bySubject = {};
  weak.forEach(w => {
    if (!bySubject[w.subject]) bySubject[w.subject] = [];
    bySubject[w.subject].push(w);
  });

  const subjectColors = {
    "Physics":   { color:"#7b9ef8", bg:"rgba(123,158,248,0.1)",  icon:"⚛️" },
    "Chemistry": { color:"#34c98a", bg:"rgba(52,201,138,0.1)",   icon:"🧪" },
    "Biology":   { color:"#4ade80", bg:"rgba(74,222,128,0.1)",   icon:"🧬" },
    "Maths":     { color:"#e0a840", bg:"rgba(224,168,64,0.1)",   icon:"📐" },
    "History":   { color:"#e07a4a", bg:"rgba(224,122,74,0.1)",   icon:"📜" },
    "Geography": { color:"#38bdf8", bg:"rgba(56,189,248,0.1)",   icon:"🌍" },
    "Economics": { color:"#c084fc", bg:"rgba(192,132,252,0.1)",  icon:"📈" },
    "English":   { color:"#f472b6", bg:"rgba(244,114,182,0.1)",  icon:"✍️" },
    "General":   { color:"#888",    bg:"rgba(136,136,136,0.1)",  icon:"📚" },
  };

  let html = `<div class="weakness-header-row">
    <div class="weakness-count-badge">${weak.length} weak area${weak.length > 1 ? "s" : ""} found</div>
    <button class="weakness-clear-btn" onclick="clearWeaknessData()">Reset data</button>
  </div>`;

  for (const [subject, topics] of Object.entries(bySubject)) {
    const sc = subjectColors[subject] || subjectColors["General"];
    html += `<div class="weakness-subject-group">
      <div class="weakness-subject-head" style="color:${sc.color}">
        <span>${sc.icon}</span> ${subject}
      </div>`;
    topics.forEach(t => {
      const pct = Math.round(t.errorRate * 100);
      const level = pct >= 70 ? "critical" : pct >= 50 ? "high" : "medium";
      const sourceIcons = t.sources.map(s => s === "mock" ? "⏱️" : s === "flashcard" ? "⚡" : "💬").join(" ");
      html += `<div class="weakness-topic-card wl-${level}">
        <div class="wtc-left">
          <div class="wtc-icon">❌</div>
          <div class="wtc-info">
            <div class="wtc-name">${escapeHtml(t.topic)}</div>
            <div class="wtc-meta">${t.errors % 1 === 0 ? Math.round(t.errors) : Math.round(t.errors)} error${t.errors >= 2 ? "s" : ""} · ${pct}% miss rate ${sourceIcons}</div>
          </div>
        </div>
        <div class="wtc-actions">
          <button class="wta-btn wta-practice" onclick="weaknessPractice('${escapeHtml(subject)}','${escapeHtml(t.topic)}')">Practice</button>
          <button class="wta-btn wta-flash" onclick="weaknessFlash('${escapeHtml(subject)}','${escapeHtml(t.topic)}')">Flashcards</button>
          <button class="wta-btn wta-revise" onclick="weaknessRevise('${escapeHtml(subject)}','${escapeHtml(t.topic)}')">Revise</button>
        </div>
      </div>`;
    });
    html += `</div>`;
  }

  // AI Analysis button
  html += `<button class="weakness-ai-btn" onclick="weaknessAIAnalysis()">🤖 Get Full AI Analysis of My Weak Areas</button>`;

  container.innerHTML = html;
}

function clearWeaknessData() {
  if (!confirm("Reset all weakness data?")) return;
  localStorage.removeItem(SK_WEAKNESS);
  renderWeaknessModal();
}

function weaknessPractice(subject, topic) {
  closeModal("weaknessModal");
  const msg = `I'm weak at ${subject} — ${topic}. Give me 5 targeted practice questions on this topic, starting from basics and building up. After I attempt each one, tell me if I'm right and explain the concept.`;
  fillInput(msg); askAI();
}

function weaknessFlash(subject, topic) {
  closeModal("weaknessModal");
  document.getElementById("flashTopic").value = `${subject} - ${topic}`;
  setPill("fnum", 8); setPill("fdiff", "medium");
  openModal("flashModal");
}

function weaknessRevise(subject, topic) {
  closeModal("weaknessModal");
  const msg = `I keep getting ${subject} — ${topic} wrong. Please give me a quick but thorough revision of this topic: key concepts, common exam traps, and a memory trick to remember the important parts.`;
  fillInput(msg); askAI();
}

async function weaknessAIAnalysis() {
  const weak = getWeakAreas();
  if (!weak.length) return;
  closeModal("weaknessModal");
  const summary = weak.slice(0, 8).map(w => `${w.subject} — ${w.topic} (${Math.round(w.errorRate*100)}% miss rate, ${Math.round(w.errors)} errors)`).join("\n");
  const msg = `Here are my weak areas based on my study data:\n${summary}\n\nPlease analyse these patterns, tell me which weak area I should focus on first and why, and give me a 3-step improvement plan for my biggest weakness.`;
  fillInput(msg); askAI();
}
function loadPlannerData() {
  try {
    const saved = JSON.parse(localStorage.getItem(SK_PLANNER));
    if (saved && saved.generatedDate === todayStr()) {
      plannerData = saved;
      return true; // has today's plan
    }
  } catch(e) {}
  return false;
}
function savePlannerData() {
  plannerData.generatedDate = todayStr();
  localStorage.setItem(SK_PLANNER, JSON.stringify(plannerData));
}

// ══════════════════════════════════════════════════════════════
//  SESSION MANAGEMENT
// ══════════════════════════════════════════════════════════════
function createSession(label) {
  const id = genId();
  const s = { id, label: label || "New Session", createdAt: Date.now(), updatedAt: Date.now() };
  const sessions = getSessions(); sessions.unshift(s); saveSessions(sessions);
  saveMsgs(id, [{ role:"system", content:SYSTEM_PROMPT }]);
  return s;
}
function updateLabel(id, label) {
  const sessions = getSessions(), s = sessions.find(x => x.id === id);
  if (s) { s.label = label; s.updatedAt = Date.now(); saveSessions(sessions); }
}
function updateTime(id) {
  const sessions = getSessions(), s = sessions.find(x => x.id === id);
  if (s) { s.updatedAt = Date.now(); saveSessions(sessions); }
}
function loadSession(id) {
  activeSessionId = id; setActiveId(id);
  chatHistory = getMsgs(id);
  if (!chatHistory.length || chatHistory[0].role !== "system") {
    chatHistory.unshift({ role:"system", content:SYSTEM_PROMPT });
    saveMsgs(id, chatHistory);
  }
  const s = getSessions().find(x => x.id === id);
  document.getElementById("chatLabel").textContent = s ? s.label.toLowerCase() : "session";
  renderChat(); renderHistoryList(); closeSidebar();
}

// ══════════════════════════════════════════════════════════════
//  INIT
// ══════════════════════════════════════════════════════════════
window.onload = function() {
  trackerData = getTrackerData(); ensureToday();
  updateWeaknessBadge();
  const savedId = getActiveId(), sessions = getSessions();
  if (savedId && sessions.find(s => s.id === savedId)) loadSession(savedId);
  else if (sessions.length) loadSession(sessions[0].id);
  else { const s = createSession("New Session"); loadSession(s.id); }

  document.getElementById("userInput").addEventListener("keydown", e => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); askAI(); }
  });
  document.getElementById("notesTopic").addEventListener("keydown", e => { if (e.key === "Enter") startNotes(); });
  document.getElementById("mockTopic").addEventListener("keydown",  e => { if (e.key === "Enter") startMockTest(); });
  document.getElementById("flashTopic").addEventListener("keydown", e => { if (e.key === "Enter") startFlashBlitz(); });

  ["notesModal","mockModal","trackerModal","flashModal","plannerModal","weaknessModal"].forEach(id => {
    document.getElementById(id).addEventListener("click", function(e) { if (e.target === this) closeModal(id); });
  });

  const imgInput = document.getElementById("imageFileInput");
  if (imgInput) {
    imgInput.addEventListener("change", function(e) {
      const file = e.target.files[0]; if (file) handleImageAttach(file); imgInput.value = "";
    });
  }
  document.addEventListener("paste", function(e) {
    const items = e.clipboardData && e.clipboardData.items; if (!items) return;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith("image/")) { const file = items[i].getAsFile(); if (file) handleImageAttach(file); break; }
    }
  });
  document.getElementById("userInput").focus();
};

// ══════════════════════════════════════════════════════════════
//  SIDEBAR / HISTORY
// ══════════════════════════════════════════════════════════════
function newChat() {
  const s = createSession("New Session"); studyProgress = 0;
  document.getElementById("progressFill").style.width = "0%";
  loadSession(s.id); document.getElementById("userInput").focus();
}
function clearCurrentChat() {
  if (!activeSessionId) return;
  chatHistory = [{ role:"system", content:SYSTEM_PROMPT }];
  saveMsgs(activeSessionId, chatHistory);
  updateLabel(activeSessionId, "New Session");
  document.getElementById("chatLabel").textContent = "new session";
  studyProgress = 0; document.getElementById("progressFill").style.width = "0%";
  clearImageAttachment(); renderChat(); renderHistoryList();
}
function deleteSession(id, e) {
  e.stopPropagation();
  let sessions = getSessions().filter(s => s.id !== id); saveSessions(sessions); delMsgs(id);
  if (activeSessionId === id) {
    if (sessions.length) loadSession(sessions[0].id);
    else { const s = createSession("New Session"); loadSession(s.id); }
  } else renderHistoryList();
}
function toggleSidebar() {
  const sb = document.getElementById("sidebar"), ov = document.getElementById("overlay");
  if (sb.classList.contains("open")) { closeSidebar(); }
  else { renderHistoryList(); sb.classList.add("open"); ov.classList.add("visible"); }
}
function closeSidebar() {
  document.getElementById("sidebar").classList.remove("open");
  document.getElementById("overlay").classList.remove("visible");
}
function renderHistoryList() {
  const list = document.getElementById("historyList"), sessions = getSessions();
  if (!sessions.length) { list.innerHTML = `<div class="history-empty">No sessions yet.<br>Start studying!</div>`; return; }
  const groups = {};
  sessions.forEach(s => {
    const d = new Date(s.updatedAt), today = new Date(), yest = new Date();
    yest.setDate(today.getDate() - 1);
    const lbl = d.toDateString() === today.toDateString() ? "Today"
      : d.toDateString() === yest.toDateString() ? "Yesterday"
      : d.toLocaleDateString(undefined, {month:"short",day:"numeric"});
    if (!groups[lbl]) groups[lbl] = []; groups[lbl].push(s);
  });
  let html = "";
  for (const [dateLabel, items] of Object.entries(groups)) {
    html += `<div class="history-date-group">${dateLabel}</div>`;
    items.forEach(s => {
      const active = s.id === activeSessionId ? "active" : "";
      html += `<div class="history-item ${active}" onclick="loadSession('${s.id}')">
        <div class="history-item-text">${escapeHtml(s.label)}</div>
        <button class="history-item-del" onclick="deleteSession('${s.id}',event)">x</button>
      </div>`;
    });
  }
  list.innerHTML = html;
}

// ══════════════════════════════════════════════════════════════
//  RENDER CHAT — Welcome screen by default
// ══════════════════════════════════════════════════════════════
function renderChat() {
  const box = document.getElementById("chatBox");
  const msgs = chatHistory.filter(m => m.role !== "system");
  if (!msgs.length) {
    renderWelcomeScreen(box);
    return;
  }
  box.innerHTML = '<div class="chat-messages" id="chatMessages"></div>';
  msgs.forEach(msg => {
    if (msg.role === "user") {
      if (Array.isArray(msg.content)) {
        const imgPart  = msg.content.find(p => p.type === "image_url");
        const textPart = msg.content.find(p => p.type === "text");
        addMessageWithImage(textPart ? textPart.text : "", imgPart ? imgPart.image_url.url : null, "user", false);
      } else { addMessage(msg.content, "user", false); }
    } else { addMessage(msg.content, "bot", false); }
  });
  box.scrollTop = box.scrollHeight;
}

function renderWelcomeScreen(box) {
  const now = new Date();
  const h = now.getHours();
  const greeting = h < 5 ? "Burning the midnight oil? 🌙" : h < 12 ? "Good morning ☀️" : h < 17 ? "Good afternoon 👋" : "Good evening 🌆";
  const streak = getStreak();
  const d = getTrackerData();
  const todayMins = getTodayMins();
  const weakCount = getWeakAreas().length;

  box.innerHTML = `<div class="home-screen">
    <div class="home-hero">
      <div class="home-hero-glow"></div>
      <div class="home-hero-inner">
        <div class="home-logo-wrap">
          <img src="Icon.png" alt="Apex Mind" class="home-logo-img">
        </div>
        <div class="home-greeting">${greeting}</div>
        <h1 class="home-title">What are we studying today?</h1>
        <p class="home-sub">Your AI coach — explains, quizzes, solves, and adapts to you.</p>
      </div>
    </div>
    <div class="home-stats-row">
      <div class="home-stat-card hs-streak">
        <div class="hsc-icon">🔥</div>
        <div class="hsc-val">${Math.max(1, streak)}</div>
        <div class="hsc-label">Day streak</div>
      </div>
      <div class="home-stat-card hs-time">
        <div class="hsc-icon">⏱️</div>
        <div class="hsc-val">${todayMins}</div>
        <div class="hsc-label">Min today</div>
      </div>
      <div class="home-stat-card hs-tests">
        <div class="hsc-icon">🧪</div>
        <div class="hsc-val">${d.mockTestsTaken || 0}</div>
        <div class="hsc-label">Tests done</div>
      </div>
      <div class="home-stat-card hs-weak ${weakCount > 0 ? "has-weak" : ""}" onclick="openWeaknessModal()" style="cursor:pointer">
        <div class="hsc-icon">🎯</div>
        <div class="hsc-val">${weakCount}</div>
        <div class="hsc-label">Weak areas</div>
      </div>
    </div>
    <div class="home-section-label">Start learning</div>
    <div class="home-prompts-grid">
      <div class="home-prompt-card hpc-blue" onclick="fillInput('Explain Newton\'s laws of motion with real-world examples')">
        <div class="hpc-icon">⚛️</div>
        <div class="hpc-text">Explain a concept</div>
        <div class="hpc-sub">Step-by-step with examples</div>
      </div>
      <div class="home-prompt-card hpc-purple" onclick="fillInput('Quiz me on photosynthesis with 5 questions')">
        <div class="hpc-icon">📝</div>
        <div class="hpc-text">Quiz me</div>
        <div class="hpc-sub">Test your knowledge</div>
      </div>
      <div class="home-prompt-card hpc-gold" onclick="fillInput('Help me solve: 2x² + 5x - 3 = 0 step by step')">
        <div class="hpc-icon">🔢</div>
        <div class="hpc-text">Solve a problem</div>
        <div class="hpc-sub">Guided walkthrough</div>
      </div>
      <div class="home-prompt-card hpc-teal" onclick="fillInput('Summarize the key causes of World War I')">
        <div class="hpc-icon">📜</div>
        <div class="hpc-text">Summarise notes</div>
        <div class="hpc-sub">Quick revision</div>
      </div>
    </div>
    <div class="home-section-label">Tools</div>
    <div class="home-tools-row">
      <div class="home-tool" onclick="openModal('mockModal')">
        <span class="ht-icon">⏱️</span><span class="ht-label">Mock Test</span>
      </div>
      <div class="home-tool" onclick="openModal('flashModal')">
        <span class="ht-icon">⚡</span><span class="ht-label">Flashcards</span>
      </div>
      <div class="home-tool" onclick="openModal('notesModal')">
        <span class="ht-icon">📒</span><span class="ht-label">Notes</span>
      </div>
      <div class="home-tool" onclick="showPlannerHome()">
        <span class="ht-icon">🗓️</span><span class="ht-label">Planner</span>
      </div>
      <div class="home-tool" onclick="openTracker()">
        <span class="ht-icon">📊</span><span class="ht-label">Tracker</span>
      </div>
      <div class="home-tool ${weakCount > 0 ? "ht-alert" : ""}" onclick="openWeaknessModal()">
        <span class="ht-icon">🎯</span><span class="ht-label">Weak Areas</span>
      </div>
    </div>
    <div class="home-image-hint" onclick="document.getElementById('imageFileInput').click()">
      <span class="hih-icon">📸</span>
      <div class="hih-text">
        <div class="hih-title">Photo a question</div>
        <div class="hih-sub">Attach any image and ask about it</div>
      </div>
      <span class="hih-arrow">→</span>
    </div>
  </div>`;
}

// ══════════════════════════════════════════════════════════════
//  AI STUDY PLANNER — MODAL (button-triggered only)
// ══════════════════════════════════════════════════════════════
function showPlannerHome() {
  openModal("plannerModal");
  renderPlannerModalContent();
}

function renderPlannerModalContent() {
  const box = document.getElementById("plannerModalBody");
  if (!box) return;
  renderPlannerHome(box);
}

function renderPlannerHome(box) {
  const hasSavedPlan = loadPlannerData();
  const now = new Date();
  const days = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const dayLabel = days[now.getDay()] + ", " + now.getDate() + " " + months[now.getMonth()];
  const h = now.getHours();
  const greeting = h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
  const streak = getStreak();

  // Build exam pills
  const exams = Object.keys(EXAM_SUBJECT_MAP);
  const examPillsHTML = exams.map(ex =>
    `<div class="p-pill${plannerData.exam===ex?" pe":""}" onclick="plannerSelectExam('${ex}')">${ex}</div>`
  ).join("");

  // Build subject pills from existing selection
  const subPillsHTML = plannerData.subjects.map((sub,i) =>
    `<div class="p-pill ps" onclick="plannerRemoveSub(${i})">${escapeHtml(sub)} ✕</div>`
  ).join("");

  const timePills = [
    {label:"1 hr",mins:60},{label:"1.5 hr",mins:90},{label:"2 hr",mins:120},
    {label:"3 hr",mins:180},{label:"4 hr",mins:240},{label:"5+ hr",mins:300}
  ];
  const timePillsHTML = timePills.map(t =>
    `<div class="p-pill${plannerData.totalMins===t.mins?" pt":""}" onclick="plannerSelectTime(${t.mins})">${t.label}</div>`
  ).join("");

  const ready = plannerData.exam && plannerData.subjects.length > 0 && plannerData.totalMins > 0;

  box.innerHTML = `
<div class="planner-home">
  <div class="planner-inner">

    <!-- Greeting -->
    <div class="planner-greeting-row">
      <div>
        <div class="planner-day">${dayLabel}</div>
        <div class="planner-title">${greeting}, <span>let's study</span> 🎯</div>
      </div>
      <div class="streak-pill">🔥 ${Math.max(1,streak)} day streak</div>
    </div>

    <!-- Setup Card -->
    <div class="planner-setup">
      <div class="planner-setup-head">
        <div class="psh-icon">🗓️</div>
        <div>
          <div class="psh-title">Today's Study Plan</div>
          <div class="psh-sub">Personalised by AI · Regenerates daily</div>
        </div>
      </div>
      <div class="planner-setup-body">

        <div>
          <div class="p-field-label">Exam / Goal</div>
          <div class="p-pill-row" id="plannerExamPills">${examPillsHTML}</div>
        </div>

        <div>
          <div class="p-field-label">Subjects to Study Today</div>
          <div class="p-pill-row" id="plannerSubPills">${subPillsHTML}</div>
          <div class="custom-sub-row">
            <input class="p-mini-input" id="plannerSubInput" placeholder="Add a subject…"
              onkeydown="if(event.key==='Enter')plannerAddCustomSub()"/>
            <button class="p-mini-add" onclick="plannerAddCustomSub()">+ Add</button>
          </div>
        </div>

        <div>
          <div class="p-field-label">Available Study Time Today</div>
          <div class="p-pill-row" id="plannerTimePills">${timePillsHTML}</div>
        </div>

        <button class="planner-gen-btn" id="plannerGenBtn"
          onclick="plannerGenerate()" ${ready ? "" : "disabled"}>
          ✨ ${hasSavedPlan && plannerData.plan.length ? "Regenerate Plan" : "Generate Today's Plan"}
        </button>
      </div>
    </div>

    <!-- Plan output -->
    <div id="plannerOutput"></div>

    <!-- Quick actions (shown after plan generated) -->
    <div id="plannerActions" style="display:none"></div>

  </div>
</div>`;

  // If we have a saved plan for today, render it immediately
  if (hasSavedPlan && plannerData.plan.length > 0) {
    renderPlanOutput();
    renderPlannerActions();
    document.getElementById("plannerActions").style.display = "block";
  }

  box.scrollTop = 0;
}

function plannerSelectExam(exam) {
  plannerData.exam = exam;
  if (plannerData.subjects.length === 0) {
    plannerData.subjects = (EXAM_SUBJECT_MAP[exam] || []).slice();
  }
  savePlannerData();
  const box = document.getElementById("plannerModalBody");
  if (box) renderPlannerHome(box);
}

function plannerSelectTime(mins) {
  plannerData.totalMins = mins;
  savePlannerData();
  const box = document.getElementById("plannerModalBody");
  if (box) renderPlannerHome(box);
}

function plannerAddCustomSub() {
  const input = document.getElementById("plannerSubInput");
  const val = (input ? input.value.trim() : "");
  if (!val) return;
  if (!plannerData.subjects.includes(val)) {
    plannerData.subjects.push(val);
    savePlannerData();
  }
  const box = document.getElementById("plannerModalBody");
  if (box) renderPlannerHome(box);
}

function plannerRemoveSub(idx) {
  plannerData.subjects.splice(idx, 1);
  savePlannerData();
  const box = document.getElementById("plannerModalBody");
  if (box) renderPlannerHome(box);
}

async function plannerGenerate() {
  const btn = document.getElementById("plannerGenBtn");
  if (btn) { btn.disabled = true; btn.textContent = "Generating…"; }

  const output = document.getElementById("plannerOutput");
  output.innerHTML = `<div class="plan-output">
    <div class="plan-sessions" style="padding-top:18px">
      <div class="planner-thinking">
        <div class="pt-dot"></div><div class="pt-dot"></div><div class="pt-dot"></div>
      </div>
      <div style="font-size:12px;color:var(--ink-muted);font-family:'DM Mono',monospace;margin-left:4px">
        Building your ${plannerData.exam} plan for today…
      </div>
    </div>
  </div>`;

  const totalMins = plannerData.totalMins;
  const subs = plannerData.subjects;
  const minsPerSub = Math.floor(totalMins / Math.max(subs.length, 1));

  const prompt = `Generate a focused study schedule for today.

Exam: ${plannerData.exam}
Subjects: ${subs.join(", ")}
Total time available: ${totalMins} minutes (roughly ${minsPerSub} min per subject)

Respond ONLY with a valid JSON array. No markdown code fences. No text before or after. Each object:
{"subject":"Physics","topic":"Rotational Motion — Torque & Angular Momentum","minutes":30,"tip":"Focus on the right-hand rule and solve 3 practice problems."}

Rules:
- Make topics SPECIFIC and ACTIONABLE for ${plannerData.exam} exam preparation.
- Distribute time proportionally across subjects.
- Total minutes should sum to approximately ${totalMins}.
- Include a practical study tip for each session.
- Output ONLY the JSON array.`;

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: ANTHROPIC_PLANNER_MODEL,
        max_tokens: 1000,
        system: "You are a study plan generator. Output ONLY valid JSON arrays. No markdown, no explanation, no code fences.",
        messages: [{ role:"user", content:prompt }]
      })
    });
    const data = await response.json();
    let raw = (data.content && data.content[0] && data.content[0].text) || "";
    raw = raw.replace(/```json|```/g,"").trim();
    const si = raw.indexOf("["), ei = raw.lastIndexOf("]");
    if (si !== -1 && ei !== -1) raw = raw.slice(si, ei+1);
    plannerData.plan = JSON.parse(raw);
    if (!Array.isArray(plannerData.plan) || plannerData.plan.length === 0) throw new Error("empty");
  } catch(e) {
    // Fallback: generate a sensible default plan
    plannerData.plan = subs.map((sub, i) => ({
      subject: sub,
      topic: getDefaultTopic(sub, plannerData.exam),
      minutes: minsPerSub,
      tip: "Review key concepts, then attempt practice problems."
    }));
  }

  plannerData.doneItems = {};
  savePlannerData();
  renderPlanOutput();
  renderPlannerActions();
  document.getElementById("plannerActions").style.display = "block";
}

function getDefaultTopic(sub, exam) {
  const defaults = {
    Physics:    "Mechanics — Laws of Motion & Energy",
    Chemistry:  "Chemical Bonding & Molecular Structure",
    Maths:      "Calculus — Differentiation & Integration",
    Biology:    "Cell Biology — Structure & Functions",
    English:    "Reading Comprehension & Grammar",
    History:    "Modern India — Key Events & Movements",
    Geography:  "Physical Geography — Climate & Landforms",
    Polity:     "Indian Constitution — Fundamental Rights",
    Economics:  "Macro Economics — GDP & National Income",
    Reading:    "Skimming, Scanning & Inference Skills",
    Writing:    "Task 2 — Essay Structure & Coherence",
    Listening:  "Identifying Key Information in Recordings",
    Speaking:   "Fluency, Vocabulary & Pronunciation",
  };
  return defaults[sub] || "Core Concepts & Practice Problems";
}

function renderPlanOutput() {
  const output = document.getElementById("plannerOutput");
  if (!output) return;
  const plan = plannerData.plan;
  const total = plan.reduce((a,b) => a + (b.minutes||0), 0);
  const done  = Object.values(plannerData.doneItems).filter(Boolean).length;
  const pct   = plan.length > 0 ? Math.round((done / plan.length) * 100) : 0;

  let sessionsHTML = plan.map((item, i) => {
    const cIdx  = i % plannerSubColors.length;
    const c     = plannerSubColors[cIdx];
    const isDone = !!plannerData.doneItems[i];
    return `<div class="plan-session${isDone?" done":""}" id="planSession${i}" onclick="plannerToggleDone(${i})">
      <div class="ps-bar" style="background:${c.bar}"></div>
      <div class="ps-icon" style="background:${c.bg}">${c.icon}</div>
      <div class="ps-info">
        <div class="ps-subject" style="color:${c.text}">${escapeHtml(item.subject)}</div>
        <div class="ps-name">${escapeHtml(item.topic || "Core Topics")}</div>
        ${item.tip ? `<div class="ps-tip">${escapeHtml(item.tip)}</div>` : ""}
      </div>
      <div class="ps-right">
        <div class="ps-mins" style="background:${c.bg};color:${c.text}">${item.minutes} min</div>
        <div class="ps-check">${isDone ? "✓" : ""}</div>
      </div>
    </div>`;
  }).join("");

  output.innerHTML = `
<div class="plan-output">
  <div class="plan-output-head">
    <div class="poh-left">
      <div class="poh-title">📅 Today's Plan</div>
      <div class="poh-meta">${escapeHtml(plannerData.exam)} · ${formatPlanMins(total)} total</div>
    </div>
    <div class="poh-badge"><div class="poh-dot"></div>Ready</div>
  </div>
  <div class="plan-sessions">${sessionsHTML}</div>
</div>
<div class="plan-progress">
  <div class="pp-label">Progress</div>
  <div class="pp-bar"><div class="pp-fill" id="planProgressBar" style="width:${pct}%"></div></div>
  <div class="pp-pct" id="planProgressPct">${pct}%</div>
</div>
<div class="planner-regen-row" style="margin-top:4px">
  <button class="planner-regen-btn" onclick="plannerGenerate()">↺ Regenerate plan</button>
</div>`;
}

function plannerToggleDone(idx) {
  plannerData.doneItems[idx] = !plannerData.doneItems[idx];
  savePlannerData();
  // Update just the session block and progress
  const block = document.getElementById("planSession" + idx);
  if (block) {
    const check = block.querySelector(".ps-check");
    if (plannerData.doneItems[idx]) {
      block.classList.add("done");
      if (check) check.textContent = "✓";
    } else {
      block.classList.remove("done");
      if (check) check.textContent = "";
    }
  }
  const done = Object.values(plannerData.doneItems).filter(Boolean).length;
  const pct  = plannerData.plan.length > 0 ? Math.round((done / plannerData.plan.length) * 100) : 0;
  const bar  = document.getElementById("planProgressBar");
  const pctEl = document.getElementById("planProgressPct");
  if (bar) bar.style.width = pct + "%";
  if (pctEl) pctEl.textContent = pct + "%";
}

function renderPlannerActions() {
  const actEl = document.getElementById("plannerActions");
  if (!actEl || !plannerData.plan.length) return;
  const topicList = plannerData.plan.map(p => p.subject + " — " + p.topic).join(", ");
  const chips = [
    { icon:"📝", label:"Quiz me on today's topics",   msg:`Quiz me on: ${topicList}` },
    { icon:"📒", label:"Make notes for today",         msg:`Generate revision notes for: ${topicList}` },
    { icon:"💡", label:"Explain my first topic",       msg:`Explain clearly: ${plannerData.plan[0]?.subject} — ${plannerData.plan[0]?.topic}` },
    { icon:"⏱️", label:"Start a mock test",            msg:`Create a mock test on: ${plannerData.plan.map(p=>p.topic).join(", ")}` },
  ];
  actEl.innerHTML = `
    <div class="planner-actions-label">Jump into learning</div>
    <div class="planner-cta-row">
      ${chips.map(c => `
        <div class="planner-cta-chip" onclick="plannerSendAction('${c.msg.replace(/'/g,"\\'")}')">
          <span class="ci">${c.icon}</span>
          <span class="cl">${c.label}</span>
        </div>`).join("")}
    </div>`;
}

function plannerSendAction(msg) {
  closeModal("plannerModal");
  fillInput(msg);
  askAI();
}

function formatPlanMins(m) {
  if (m < 60) return m + " min";
  const h = Math.floor(m/60), rem = m % 60;
  return h + "h" + (rem ? " " + rem + "m" : "");
}

// ══════════════════════════════════════════════════════════════
//  IMAGE ATTACH
// ══════════════════════════════════════════════════════════════
function handleImageAttach(file) {
  if (!file.type.startsWith("image/")) { alert("Please attach an image file."); return; }
  if (file.size > 5*1024*1024) { alert("Image must be under 5MB."); return; }
  const reader = new FileReader();
  reader.onload = function(e) {
    const dataUrl = e.target.result;
    attachedImageBase64 = dataUrl.split(",")[1];
    attachedImageMime   = file.type;
    attachedImageName   = file.name;
    showImagePreview(dataUrl, file.name);
  };
  reader.readAsDataURL(file);
}
function showImagePreview(dataUrl, name) {
  const existing = document.getElementById("imagePreviewBar"); if (existing) existing.remove();
  const bar = document.createElement("div");
  bar.id = "imagePreviewBar"; bar.className = "image-preview-bar";
  bar.innerHTML = `
    <div class="img-preview-thumb-wrap">
      <img src="${dataUrl}" alt="Attached" class="img-preview-thumb" onclick="openImageFullPreview('${dataUrl}')">
    </div>
    <div class="img-preview-info">
      <div class="img-preview-name">${escapeHtml(name)}</div>
      <div class="img-preview-hint">Ask any question about this image</div>
    </div>
    <button class="img-preview-remove" onclick="clearImageAttachment()" title="Remove image">✕</button>`;
  const inputArea = document.querySelector(".input-area");
  const inputRow  = document.querySelector(".input-row");
  inputArea.insertBefore(bar, inputRow);
  document.getElementById("userInput").placeholder = "Ask a question about this image…";
  document.getElementById("userInput").focus();
  const btn = document.getElementById("imgAttachBtn"); if (btn) btn.classList.add("has-image");
}
function clearImageAttachment() {
  attachedImageBase64 = null; attachedImageMime = null; attachedImageName = null;
  const bar = document.getElementById("imagePreviewBar"); if (bar) bar.remove();
  document.getElementById("userInput").placeholder = "Ask anything — explain, quiz me, help me understand…";
  const btn = document.getElementById("imgAttachBtn"); if (btn) btn.classList.remove("has-image");
  closeImageFullPreview();
}
function openImageFullPreview(src) {
  const overlay = document.getElementById("imgFullOverlay");
  if (overlay) { document.getElementById("imgFullImg").src = src; overlay.classList.add("open"); }
}
function closeImageFullPreview() {
  const overlay = document.getElementById("imgFullOverlay"); if (overlay) overlay.classList.remove("open");
}

// ══════════════════════════════════════════════════════════════
//  CHAT MESSAGES
// ══════════════════════════════════════════════════════════════
function addMessageWithImage(text, imgSrc, role, animate=true) {
  const box = document.getElementById("chatBox");
  // If home screen showing, replace with messages wrapper
  if (box.querySelector(".home-screen") || box.querySelector(".welcome-screen")) {
    box.innerHTML = '<div class="chat-messages" id="chatMessages"></div>';
  }
  const container = document.getElementById("chatMessages") || box;
  const wrap = document.createElement("div"); wrap.classList.add("message", role, "has-image-msg");
  if (!animate) wrap.style.animation = "none";
  let html = "";
  if (imgSrc) {
    html += `<div class="msg-image-wrap"><img src="${imgSrc}" class="msg-image" alt="Question image" onclick="openImageFullPreview('${imgSrc}')"><div class="msg-image-label">📸 Image attached</div></div>`;
  }
  if (text) html += `<div class="msg-text">${escapeHtml(text)}</div>`;
  const td = document.createElement("div"); td.innerHTML = html;
  const meta = document.createElement("div"); meta.classList.add("msg-meta");
  const cb = document.createElement("button"); cb.classList.add("copy-btn"); cb.textContent = "copy"; cb.onclick = () => copyText(text);
  const te = document.createElement("div"); te.classList.add("time"); te.textContent = new Date().toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"});
  meta.appendChild(cb); meta.appendChild(te);
  wrap.appendChild(td); wrap.appendChild(meta);
  container.appendChild(wrap); box.scrollTop = box.scrollHeight;
  return wrap;
}
function addMessage(text, role, animate=true) {
  const box = document.getElementById("chatBox");
  // If home screen showing, replace with messages wrapper
  if (box.querySelector(".home-screen") || box.querySelector(".welcome-screen")) {
    box.innerHTML = '<div class="chat-messages" id="chatMessages"></div>';
  }
  const container = document.getElementById("chatMessages") || box;
  const wrap = document.createElement("div"); wrap.classList.add("message", role);
  if (!animate) wrap.style.animation = "none";
  const td = document.createElement("div"); td.classList.add("msg-text");
  if (role === "bot") td.innerHTML = marked.parse(text); else td.textContent = text;
  const meta = document.createElement("div"); meta.classList.add("msg-meta");
  const cb = document.createElement("button"); cb.classList.add("copy-btn"); cb.textContent = "copy"; cb.onclick = () => copyText(text);
  const te = document.createElement("div"); te.classList.add("time"); te.textContent = new Date().toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"});
  meta.appendChild(cb); meta.appendChild(te);
  wrap.appendChild(td); wrap.appendChild(meta);
  container.appendChild(wrap); box.scrollTop = box.scrollHeight;
  return wrap;
}
function copyText(text) {
  navigator.clipboard.writeText(text).then(() => {
    const t = document.getElementById("copy-toast"); t.classList.add("show"); setTimeout(() => t.classList.remove("show"), 1400);
  });
}
function updateProgress() { studyProgress = Math.min(100, studyProgress + 4); document.getElementById("progressFill").style.width = studyProgress + "%"; }
function showTyping() {
  const box = document.getElementById("chatBox");
  const container = document.getElementById("chatMessages") || box;
  const wrap = document.createElement("div"); wrap.classList.add("typing-wrap"); wrap.id = "typing-indicator";
  wrap.innerHTML = `<div class="typing-bubble"><div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div></div>`;
  container.appendChild(wrap); box.scrollTop = box.scrollHeight;
}
function removeTyping() { const el = document.getElementById("typing-indicator"); if (el) el.remove(); }
function typeEffect(text) {
  const box = document.getElementById("chatBox");
  if (box.querySelector(".home-screen") || box.querySelector(".welcome-screen")) {
    box.innerHTML = '<div class="chat-messages" id="chatMessages"></div>';
  }
  const container = document.getElementById("chatMessages") || box;
  const wrap = document.createElement("div"); wrap.classList.add("message","bot");
  const td = document.createElement("div"); td.classList.add("msg-text");
  wrap.appendChild(td); container.appendChild(wrap);
  let i = 0;
  const iv = setInterval(() => {
    td.textContent += text[i++]; box.scrollTop = box.scrollHeight;
    if (i >= text.length) {
      clearInterval(iv); td.innerHTML = marked.parse(text);
      const meta = document.createElement("div"); meta.classList.add("msg-meta");
      const cb = document.createElement("button"); cb.classList.add("copy-btn"); cb.textContent = "copy"; cb.onclick = () => copyText(text);
      const te = document.createElement("div"); te.classList.add("time"); te.textContent = new Date().toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"});
      meta.appendChild(cb); meta.appendChild(te); wrap.appendChild(meta); box.scrollTop = box.scrollHeight;
    }
  }, 10);
}
function formatApiError(err) {
  const msg = (err && err.message) ? err.message : "Connection issue. Check your API key or try again.";
  if (/401|unauthorized|invalid api key|api key|key/i.test(msg)) { localStorage.removeItem(SK_API_KEY); return "Warning: API key issue. Please re-enter your OpenRouter key and try again."; }
  return "Warning: " + msg;
}

// ══════════════════════════════════════════════════════════════
//  OPENROUTER API
// ══════════════════════════════════════════════════════════════
async function callOpenRouter(payload, modelIndex, attempt) {
  if (modelIndex === undefined) modelIndex = 0; if (attempt === undefined) attempt = 0;
  const model = payload._model || MODELS[Math.min(modelIndex, MODELS.length-1)];
  delete payload._model;
  const apiKey = requireApiKey();
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method:"POST",
    headers:{"Authorization":"Bearer "+apiKey,"Content-Type":"application/json","HTTP-Referer":OR_HTTP_REFERER,"X-Title":OR_APP_TITLE},
    body:JSON.stringify(Object.assign({},payload,{model}))
  });
  let data = null; try { data = await res.json(); } catch(e) {}
  if (!res.ok) {
    const errMsg = (data&&data.error&&data.error.message)||(data&&data.message)||("API Error "+res.status);
    if ([429,500,502,503,529].includes(res.status)) {
      if (attempt < 2) { await sleep(250*Math.pow(2,attempt)); return callOpenRouter(Object.assign({},payload,{_model:model}),modelIndex,attempt+1); }
      if (modelIndex < MODELS.length-1) { return callOpenRouter(Object.assign({},payload,{_model:model}),modelIndex+1,0); }
    }
    throw new Error(errMsg);
  }
  const choice = data && data.choices && data.choices[0];
  if (choice && (!choice.message.content || choice.message.content === "")) {
    const details = (choice.message.reasoning_details) || [];
    const extracted = details.filter(b=>b.type==="text").map(b=>b.text).join("\n").trim();
    data.choices[0].message.content = extracted || "I wasn't able to generate a response. Please try again.";
  }
  return data;
}

// ══════════════════════════════════════════════════════════════
//  FILL INPUT / SEND PROMPT
// ══════════════════════════════════════════════════════════════
function fillInput(text) {
  const inp = document.getElementById("userInput");
  inp.value = text; inp.focus(); inp.setSelectionRange(text.length, text.length);
}
// Global sendPrompt for widget compatibility
window.sendPrompt = function(text) { fillInput(text); askAI(); };

// ══════════════════════════════════════════════════════════════
//  MAIN ASK AI
// ══════════════════════════════════════════════════════════════
async function askAI() {
  if (isLoading) return;
  const input = document.getElementById("userInput");
  let userMessage = input.value.trim();
  if (attachedImageBase64 && !userMessage) userMessage = "Please explain this image and help me understand it.";
  if (!userMessage && !attachedImageBase64) return;

  isLoading = true; document.getElementById("sendBtn").disabled = true;

  const hasImage  = !!attachedImageBase64;
  const imgBase64 = attachedImageBase64;
  const imgMime   = attachedImageMime;
  const imgDataUrl = hasImage ? `data:${imgMime};base64,${imgBase64}` : null;

  if (hasImage) addMessageWithImage(userMessage, imgDataUrl, "user", true);
  else          addMessage(userMessage, "user");

  let msgContent;
  if (hasImage) {
    msgContent = [
      { type:"text", text:userMessage || "Please explain this image." },
      { type:"image_url", image_url:{ url:`data:${imgMime};base64,${imgBase64}` } }
    ];
  } else { msgContent = userMessage; }

  chatHistory.push({ role:"user", content:msgContent });

  const s = getSessions().find(x => x.id === activeSessionId);
  if (s && (s.label === "New Session" || s.label === "New Chat")) {
    const label = (hasImage?"[Image] ":"") + userMessage.slice(0,42) + (userMessage.length>42?"...":"");
    updateLabel(activeSessionId, label);
    document.getElementById("chatLabel").textContent = label.toLowerCase();
  }

  input.value = "";
  clearImageAttachment();
  updateProgress(); showTyping(); trackMsg();
  // Track chat-based weakness signals
  if (!hasImage) trackWeaknessChat(userMessage);

  try {
    const modelOverride = hasImage ? VISION_MODEL : undefined;
    let msgsToSend = trimMessages(chatHistory, MAX_CHAT_MESSAGES);
    const apiMessages = msgsToSend.map(m => {
      if (m.role === "system") return m;
      if (Array.isArray(m.content)) {
        if (hasImage || modelOverride) return { role:m.role, content:m.content };
        const textOnly = m.content.filter(p=>p.type==="text").map(p=>p.text).join(" ");
        return { role:m.role, content:textOnly };
      }
      return m;
    });
    const payload = { messages:apiMessages, temperature:0.7, _model:modelOverride };
    const data = await callOpenRouter(payload);
    removeTyping();
    const aiText = (data&&data.choices&&data.choices[0]&&data.choices[0].message&&data.choices[0].message.content) || "Unexpected response.";
    typeEffect(aiText);
    chatHistory.push({ role:"assistant", content:aiText });
    saveMsgs(activeSessionId, chatHistory); updateTime(activeSessionId);
  } catch(err) { removeTyping(); addMessage(formatApiError(err), "bot"); console.error(err); }
  isLoading = false; document.getElementById("sendBtn").disabled = false;
}

function exportChat() {
  let text = "APEX STUDY AI - SESSION EXPORT\n" + "=".repeat(40) + "\n\n";
  chatHistory.forEach(msg => {
    if (msg.role !== "system") {
      const roleLabel = msg.role === "user" ? "YOU" : "APEX STUDY AI";
      let content = msg.content;
      if (Array.isArray(content)) {
        const textPart = content.find(p=>p.type==="text");
        const hasImg   = content.find(p=>p.type==="image_url");
        content = (hasImg?"[Image attached] ":"") + (textPart?textPart.text:"");
      }
      text += roleLabel + ":\n" + content + "\n\n" + "-".repeat(30) + "\n\n";
    }
  });
  const blob = new Blob([text],{type:"text/plain"}), a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = "apex-study-session.txt"; a.click();
}

// ══════════════════════════════════════════════════════════════
//  NOTES GENERATOR
// ══════════════════════════════════════════════════════════════
function setCustomLang() {
  document.querySelectorAll('[id^="nlang-"]').forEach(e => e.classList.remove("on"));
  document.getElementById("nlang-Other").classList.add("on");
  const wrap = document.getElementById("customLangWrap");
  wrap.style.display = "block";
  document.getElementById("customLangInput").focus();
}
function startNotes() {
  const topic = document.getElementById("notesTopic").value.trim();
  if (!topic) { document.getElementById("notesTopic").focus(); return; }
  let lang = pillState.nlang;
  if (lang === "Other" || !lang) {
    const custom = (document.getElementById("customLangInput").value || "").trim();
    lang = custom || "English";
  }
  const length = pillState.nlen === "long" ? "long and detailed" : "short and concise";
  const prompt = `Please generate ${length} study notes on the topic: "${topic}". Write the notes in ${lang}. Use clear headings, bullet points, key terms highlighted, and end with a quick summary box. Make the notes easy to revise from.`;
  closeModal("notesModal");
  document.getElementById("notesTopic").value = "";
  document.getElementById("customLangInput").value = "";
  document.getElementById("customLangWrap").style.display = "none";
  setPill("nlang","English");
  document.getElementById("userInput").value = prompt;
  trackNotes(); askAI();
}

// ══════════════════════════════════════════════════════════════
//  MOCK TEST
// ══════════════════════════════════════════════════════════════
async function startMockTest() {
  const topic = document.getElementById("mockTopic").value.trim();
  if (!topic) { document.getElementById("mockTopic").focus(); return; }
  closeModal("mockModal");
  const {mnum,mtype,mtime,mdiff} = pillState;
  const typeDesc = mtype === "mcq" ? "MCQ only (4 options labeled A, B, C, D)" : "a mix of MCQ (4 options labeled A, B, C, D) and short answer questions";
  document.getElementById("mockScreen").classList.add("active");
  document.getElementById("mockTestTitle").textContent = "📋 " + topic;
  document.getElementById("mockTimer").textContent = formatTime(mtime*60);
  document.getElementById("mockBody").innerHTML = `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding:70px 20px;gap:16px"><div style="width:46px;height:46px;border:3px solid rgba(255,255,255,0.1);border-top-color:#c9942a;border-radius:50%;animation:spin .8s linear infinite"></div><div style="font-family:'DM Mono',monospace;font-size:13px;color:var(--ink-muted)">Generating ${mnum} ${mdiff} questions on <strong style="color:var(--ink)">${escapeHtml(topic)}</strong>...</div></div><style>@keyframes spin{to{transform:rotate(360deg)}}</style>`;
  const prompt = `Generate exactly ${mnum} questions for a ${mdiff}-difficulty mock test on: "${topic}". Question type: ${typeDesc}. YOU MUST respond with ONLY a valid JSON array. No text before or after. No markdown. No explanation. Use this exact format: [{"num":1,"question":"Full question?","type":"mcq","options":["A","B","C","D"],"answer":"A","explanation":"Why A is correct."},{"num":2,"question":"Short answer question?","type":"short","options":[],"answer":"Expected answer","explanation":"Brief explanation."}] STRICT RULES: MCQ: type="mcq", exactly 4 options, answer must be letter "A","B","C", or "D". Short answer: type="short", options=[], answer is a concise string. Generate exactly ${mnum} questions total. Difficulty: ${mdiff}. Topic: ${topic}. Output ONLY the JSON array.`;
  try {
    const data = await callOpenRouter({temperature:0.3,messages:[{role:"system",content:"You are a JSON generator. Output only valid JSON arrays with no extra text."},{role:"user",content:prompt}]});
    let raw = (data&&data.choices&&data.choices[0]&&data.choices[0].message&&data.choices[0].message.content)||"";
    raw = raw.replace(/```json|```/g,"").trim();
    const si=raw.indexOf("["),ei=raw.lastIndexOf("]");
    if(si!==-1&&ei!==-1) raw=raw.slice(si,ei+1);
    mockQuestions = JSON.parse(raw);
    if(!Array.isArray(mockQuestions)||mockQuestions.length===0) throw new Error("Empty array");
  } catch(err) { document.getElementById("mockScreen").classList.remove("active"); addMessage(formatApiError(err),"bot"); console.error(err); return; }
  mockAnswers={}; mockCorrectAnswers={}; mockExplanations={};
  mockQuestions.forEach(q => { mockCorrectAnswers[q.num]=q.answer; mockExplanations[q.num]=q.explanation||""; });
  renderMockBody(); trackMock();
  mockSecsLeft = mtime*60; updateMockTimer(); clearInterval(mockTimerInt);
  mockTimerInt = setInterval(() => {
    mockSecsLeft--; updateMockTimer();
    const answered = Object.keys(mockAnswers).length;
    document.getElementById("mockProgFill").style.width = Math.round((answered/mockQuestions.length)*100)+"%";
    if(mockSecsLeft<=0){clearInterval(mockTimerInt);submitMockTest();}
  },1000);
}
function formatTime(secs) { const m=Math.floor(secs/60),s=secs%60; return String(m).padStart(2,"0")+":"+String(s).padStart(2,"0"); }
function updateMockTimer() { const el=document.getElementById("mockTimer"); el.textContent=formatTime(mockSecsLeft); if(mockSecsLeft<=60)el.classList.add("warn"); else el.classList.remove("warn"); }
function renderMockBody() {
  const total = mockQuestions.length;
  document.getElementById("mockBody").innerHTML = mockQuestions.map((q,idx) => {
    const letters=["A","B","C","D"]; const answered=mockAnswers[q.num]!==undefined;
    if(q.type==="mcq"){
      const opts=(q.options||[]).map((opt,oi)=>{const letter=letters[oi]||String(oi+1);const sel=mockAnswers[q.num]===letter?"selected":"";return `<div class="mock-opt ${sel}" onclick="selectMCQ(${q.num},'${letter}',this)"><div class="mock-opt-letter">${letter}</div><span>${escapeHtml(opt)}</span></div>`;}).join("");
      return `<div class="mock-q-card${answered?" answered":""}" id="mqc-${q.num}"><div class="mock-q-num">Question ${idx+1} of ${total} &nbsp;·&nbsp; Multiple Choice</div><div class="mock-q-text">${escapeHtml(q.question)}</div><div class="mock-options">${opts}</div></div>`;
    } else {
      const val=escapeHtml(mockAnswers[q.num]||"");
      return `<div class="mock-q-card${answered?" answered":""}" id="mqc-${q.num}"><div class="mock-q-num">Question ${idx+1} of ${total} &nbsp;·&nbsp; Short Answer</div><div class="mock-q-text">${escapeHtml(q.question)}</div><textarea class="mock-short-input" placeholder="Write your answer here..." oninput="saveShort(${q.num},this.value)">${val}</textarea></div>`;
    }
  }).join("");
}
function selectMCQ(qNum,letter,el) {
  mockAnswers[qNum]=letter;
  const card=document.getElementById("mqc-"+qNum);
  if(card){card.querySelectorAll(".mock-opt").forEach(o=>o.classList.remove("selected"));el.classList.add("selected");card.classList.add("answered");}
  updateMockProgress();
}
function saveShort(qNum,val) {
  if(val.trim()){mockAnswers[qNum]=val.trim();const c=document.getElementById("mqc-"+qNum);if(c)c.classList.add("answered");}
  else{delete mockAnswers[qNum];const c=document.getElementById("mqc-"+qNum);if(c)c.classList.remove("answered");}
  updateMockProgress();
}
function updateMockProgress() { const ans=Object.keys(mockAnswers).length; document.getElementById("mockProgFill").style.width=Math.round((ans/mockQuestions.length)*100)+"%"; }
function confirmSubmit() { const ans=Object.keys(mockAnswers).length,total=mockQuestions.length;if(ans<total){if(!confirm(`You have answered ${ans} of ${total} questions. Submit anyway?`))return;}submitMockTest(); }
function submitMockTest() {
  clearInterval(mockTimerInt); document.getElementById("mockScreen").classList.remove("active");
  const timeTaken=pillState.mtime*60-mockSecsLeft; logStudySession(null,Math.round(timeTaken/60)||1,"Mock test");
  const mcqQs=mockQuestions.filter(q=>q.type==="mcq"),shortQs=mockQuestions.filter(q=>q.type==="short");
  let correct=0,wrong=0,skipped=0;
  // Track weakness for every MCQ
  const mockSubjectHint = document.getElementById("mockTestTitle").textContent.replace("📋 ","").trim();
  mcqQs.forEach(q=>{
    const a=mockAnswers[q.num];
    if(!a){skipped++;}
    else if(a.toUpperCase()===(mockCorrectAnswers[q.num]||"").toUpperCase()){
      correct++;
      trackStrengthMock(q.question, mockSubjectHint);
    }else{
      wrong++;
      trackWeaknessMock(q.question, mockSubjectHint);
    }
  });
  shortQs.forEach(q=>{if(!mockAnswers[q.num])skipped++;});
  const mcqTotal=mcqQs.length,pct=mcqTotal>0?Math.round((correct/mcqTotal)*100):null;
  const circleClass=pct===null?"ok":pct>=70?"great":pct>=40?"ok":"poor";
  const gradeLabel=pct===null?"Check your short answers below":pct>=80?"Excellent work! 🎉":pct>=60?"Good effort! Keep it up! 📈":pct>=40?"Nice try! Keep practising! 💪":"Keep going — you'll get there! 🌱";
  document.getElementById("scoreBanner").innerHTML=`<div class="score-circle ${circleClass}">${pct!==null?pct+"%":"📝"}</div><div class="score-label">${gradeLabel}</div><div class="score-sub" style="margin-top:4px">Completed in ${formatTime(timeTaken)} &nbsp;·&nbsp; ${mockQuestions.length} questions total</div><div class="score-stats">${mcqTotal>0?`<div class="stat-pill correct">✓ ${correct} correct</div><div class="stat-pill wrong">✗ ${wrong} wrong</div>`:""}<div class="stat-pill skip">— ${skipped} skipped</div>${shortQs.length>0?`<div class="stat-pill review">📝 ${shortQs.length} short answer${shortQs.length>1?"s":""} to review</div>`:""}</div>`;
  document.getElementById("resultsBody").innerHTML=mockQuestions.map((q,idx)=>{
    const letters=["A","B","C","D"],userAns=mockAnswers[q.num];
    let statusClass,status,userBadgeClass;
    if(q.type==="mcq"){if(!userAns){status="—";statusClass="s";userBadgeClass="skipped";}else if(userAns.toUpperCase()===(mockCorrectAnswers[q.num]||"").toUpperCase()){status="✓";statusClass="c";userBadgeClass="correct";}else{status="✗";statusClass="w";userBadgeClass="wrong";}}else{status="📝";statusClass="r";userBadgeClass="review";}
    function mcqText(letter){if(!letter)return"Not answered";const li=letters.indexOf(letter.toUpperCase());const optText=li>=0&&q.options?q.options[li]:"";return letter.toUpperCase()+(optText?": "+optText:"");}
    const userDisplay=q.type==="mcq"?mcqText(userAns):(userAns||"Not answered"),correctDisplay=q.type==="mcq"?mcqText(mockCorrectAnswers[q.num]):mockCorrectAnswers[q.num]||"";
    return `<div class="result-card" id="rcard-${q.num}"><div class="result-card-head" onclick="toggleCard(${q.num})"><div class="result-status-dot ${statusClass}">${status}</div><div class="result-q-info"><div class="result-q-num">Q${idx+1} &nbsp;·&nbsp; ${q.type==="mcq"?"Multiple Choice":"Short Answer"}</div><div class="result-q-text">${escapeHtml(q.question)}</div></div><div class="result-chevron">▼</div></div><div class="result-detail"><div class="result-detail-inner"><div class="detail-block"><div class="dl">Your Answer</div><span class="ans-badge ${userBadgeClass}">${escapeHtml(userDisplay)}</span></div>${q.type==="mcq"?`<div class="detail-block"><div class="dl">Correct Answer</div><span class="ans-badge correct-ans">${escapeHtml(correctDisplay)}</span></div>`:""}<div class="detail-block"><div class="dl">Expected Answer</div><span class="ans-badge correct-ans">${escapeHtml(correctDisplay)}</span></div>${mockExplanations[q.num]?`<div class="detail-block"><div class="dl">Explanation</div><div class="explain-text">${escapeHtml(mockExplanations[q.num])}</div></div>`:""}</div></div></div>`;
  }).join("");
  document.getElementById("resultsScreen").classList.add("active");
}
function toggleCard(num) { const c=document.getElementById("rcard-"+num); if(c)c.classList.toggle("expanded"); }
function closeResults() { document.getElementById("resultsScreen").classList.remove("active"); mockQuestions=[]; mockAnswers={}; }

// ══════════════════════════════════════════════════════════════
//  FLASHCARD BLITZ
// ══════════════════════════════════════════════════════════════
async function startFlashBlitz() {
  const topic = document.getElementById("flashTopic").value.trim();
  if (!topic) { document.getElementById("flashTopic").focus(); return; }
  closeModal("flashModal");
  const {fnum,fmode,fdiff} = pillState;
  flashTopic=topic; flashMode=fmode;
  document.getElementById("flashScreen").classList.add("active");
  document.getElementById("flashScreenTitle").textContent = "⚡ " + topic;
  document.getElementById("flashBody").innerHTML = `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;padding:40px 20px"><div style="width:46px;height:46px;border:3px solid rgba(192,132,252,0.2);border-top-color:#c084fc;border-radius:50%;animation:spin .8s linear infinite"></div><div style="font-family:'DM Mono',monospace;font-size:13px;color:var(--ink-muted)">Generating ${fnum} flashcards on <strong style="color:var(--flash)">${escapeHtml(topic)}</strong>…</div></div><style>@keyframes spin{to{transform:rotate(360deg)}}</style>`;
  document.getElementById("flashTimerDisplay").style.display = "none";
  document.getElementById("flashLives").style.display = "none";
  if(fmode==="speed"){document.getElementById("flashTimerDisplay").style.display="block";}
  if(fmode==="survival"){document.getElementById("flashLives").style.display="block";flashLivesLeft=3;updateLivesDisplay();}
  const prompt = `Generate exactly ${fnum} flashcards on the topic: "${topic}" at ${fdiff} difficulty level. YOU MUST respond with ONLY a valid JSON array. No text before or after. No markdown. Format: [{"num":1,"front":"What is photosynthesis?","back":"The process by which plants convert sunlight, water, and CO2 into glucose and oxygen."}] Generate exactly ${fnum} cards. Output ONLY the JSON array.`;
  try {
    const data = await callOpenRouter({temperature:0.4,messages:[{role:"system",content:"You are a JSON generator. Output only valid JSON arrays with no extra text, no markdown."},{role:"user",content:prompt}]});
    let raw=(data&&data.choices&&data.choices[0]&&data.choices[0].message&&data.choices[0].message.content)||"";
    raw=raw.replace(/```json|```/g,"").trim();
    const si=raw.indexOf("["),ei=raw.lastIndexOf("]");
    if(si!==-1&&ei!==-1) raw=raw.slice(si,ei+1);
    flashCards=JSON.parse(raw);
    if(!Array.isArray(flashCards)||flashCards.length===0) throw new Error("Empty array");
  } catch(err) { document.getElementById("flashScreen").classList.remove("active"); addMessage(formatApiError(err),"bot"); console.error(err); return; }
  flashIdx=0;flashCorrect=0;flashWrong=0;flashResults=[];flashIsFlipped=false;flashTimerSecs=0;
  trackFlash(); restoreFlashBody(); renderFlashCard();
  if(fmode==="speed"){ clearInterval(flashTimerInt); flashTimerInt=setInterval(()=>{flashTimerSecs++;const el=document.getElementById("flashTimerDisplay");if(el)el.textContent=flashTimerSecs+"s";},1000); }
}
function restoreFlashBody() {
  document.getElementById("flashBody").innerHTML = `
    <div class="flash-card-area">
      <div class="flash-counter" id="flashCounter">Card 1 of ${flashCards.length}</div>
      <div class="flash-card-wrap" id="flashCardWrap" onclick="flipCard()">
        <div class="flash-card" id="flashCard">
          <div class="flash-card-front" id="flashFront"></div>
          <div class="flash-card-back" id="flashBack"></div>
        </div>
      </div>
      <div class="flash-hint" id="flashHint">Tap the card to reveal the answer</div>
      <div class="flash-actions" id="flashActions" style="display:none">
        <button class="flash-btn flash-btn-wrong" onclick="rateCard(false)">✗ Didn't know</button>
        <button class="flash-btn flash-btn-correct" onclick="rateCard(true)">✓ Got it!</button>
      </div>
    </div>`;
}
function renderFlashCard() {
  if(flashIdx>=flashCards.length){endFlash();return;}
  const card=flashCards[flashIdx],total=flashCards.length;
  document.getElementById("flashCounter").textContent=`Card ${flashIdx+1} of ${total}`;
  document.getElementById("flashProgFill").style.width=Math.round((flashIdx/total)*100)+"%";
  document.getElementById("flashScoreDisplay").textContent=`${flashCorrect} ✓ · ${flashWrong} ✗`;
  flashIsFlipped=false;
  const cardEl=document.getElementById("flashCard");if(cardEl)cardEl.classList.remove("flipped");
  document.getElementById("flashActions").style.display="none";
  document.getElementById("flashHint").textContent="Tap the card to reveal the answer";
  document.getElementById("flashFront").innerHTML=`<div class="flash-card-front-label">Question</div><div class="flash-question-text">${escapeHtml(card.front)}</div><div class="flash-tap-ring">👆</div>`;
  document.getElementById("flashBack").innerHTML=`<div class="flash-card-back-label">Answer</div><div class="flash-answer-text">${escapeHtml(card.back)}</div>`;
}
function flipCard() {
  if(flashIsFlipped)return; flashIsFlipped=true;
  const cardEl=document.getElementById("flashCard");if(cardEl)cardEl.classList.add("flipped");
  document.getElementById("flashHint").textContent="How did you do?";
  document.getElementById("flashActions").style.display="flex";
}
function rateCard(correct) {
  const card=flashCards[flashIdx]; flashResults.push({card,correct});
  if(correct){flashCorrect++;}
  else{
    flashWrong++;
    // Track flashcard miss as weakness signal
    trackWeaknessFlash(card.front, flashTopic);
    if(flashMode==="survival"){
      flashLivesLeft--; updateLivesDisplay();
      const wrap=document.getElementById("flashCardWrap");
      if(wrap){wrap.classList.add("shake");setTimeout(()=>wrap.classList.remove("shake"),400);}
      if(flashLivesLeft<=0){setTimeout(()=>endFlash(),450);return;}
    }
  }
  const wrap=document.getElementById("flashCardWrap");
  if(wrap&&flashMode==="speed"){
    wrap.classList.add(correct?"slide-out-right":"slide-out-left");
    setTimeout(()=>{wrap.classList.remove("slide-out-right","slide-out-left");flashIdx++;renderFlashCard();wrap.classList.add("slide-in");setTimeout(()=>wrap.classList.remove("slide-in"),300);},280);
  } else {flashIdx++;renderFlashCard();}
}
function updateLivesDisplay() { const el=document.getElementById("flashLives");if(!el)return;el.textContent="❤️".repeat(Math.max(0,flashLivesLeft))+"🖤".repeat(Math.max(0,3-flashLivesLeft)); }
function endFlash() {
  clearInterval(flashTimerInt); document.getElementById("flashScreen").classList.remove("active");
  const total=flashCards.length,done=flashResults.length,pct=done>0?Math.round((flashCorrect/done)*100):0;
  const icon=pct>=80?"🔥":pct>=60?"⚡":pct>=40?"📚":"🌱";
  const title=pct>=80?"Blazing run! 🔥":pct>=60?"Great recall! ⚡":pct>=40?"Good progress! 📚":"Keep practising! 🌱";
  document.getElementById("flashResultsIcon").textContent=icon;
  document.getElementById("flashResultsTitle").textContent=title;
  document.getElementById("flashResultsScore").textContent=pct+"%";
  let statsHTML=`<div class="stat-pill correct">✓ ${flashCorrect} known</div><div class="stat-pill wrong">✗ ${flashWrong} missed</div><div class="stat-pill skip">${done} of ${total} cards</div>`;
  if(flashMode==="speed")statsHTML+=`<div class="stat-pill review">⏱️ ${flashTimerSecs}s</div>`;
  document.getElementById("flashResultsStats").innerHTML=statsHTML;
  const missed=flashResults.filter(r=>!r.correct);
  if(missed.length>0){
    let reviewHTML=`<div class="flash-review-header">Cards to review (${missed.length})</div>`;
    reviewHTML+=missed.map(r=>`<div class="flash-review-item"><div class="flash-review-badge w">✗</div><div><div class="flash-review-q">${escapeHtml(r.card.front)}</div><div class="flash-review-a">${escapeHtml(r.card.back)}</div></div></div>`).join("");
    document.getElementById("flashResultsReview").innerHTML=reviewHTML;
  } else { document.getElementById("flashResultsReview").innerHTML=`<div class="flash-review-header">Perfect round! No cards to review ✨</div>`; }
  document.getElementById("flashResultsScreen").classList.add("active");
}
function retryFlash() {
  document.getElementById("flashResultsScreen").classList.remove("active");
  flashCards.sort(()=>Math.random()-0.5);
  flashIdx=0;flashCorrect=0;flashWrong=0;flashResults=[];flashIsFlipped=false;flashTimerSecs=0;flashLivesLeft=3;
  document.getElementById("flashTimerDisplay").textContent="0s"; updateLivesDisplay();
  document.getElementById("flashScreen").classList.add("active"); restoreFlashBody(); renderFlashCard();
  if(flashMode==="speed"){clearInterval(flashTimerInt);flashTimerInt=setInterval(()=>{flashTimerSecs++;const el=document.getElementById("flashTimerDisplay");if(el)el.textContent=flashTimerSecs+"s";},1000);}
}
function exitFlash()        { clearInterval(flashTimerInt); document.getElementById("flashScreen").classList.remove("active"); }
function exitFlashResults() { document.getElementById("flashResultsScreen").classList.remove("active"); }

// ══════════════════════════════════════════════════════════════
//  STUDY TRACKER
// ══════════════════════════════════════════════════════════════
function openTracker() { closeModal("notesModal"); closeModal("mockModal"); renderTrackerOverview(); openModal("trackerModal"); }
let trackerTab = "overview";
function switchTrackerTab(tab) {
  trackerTab = tab;
  document.querySelectorAll(".tracker-tab").forEach(t=>t.classList.remove("active"));
  const el = document.getElementById("ttab-"+tab); if(el) el.classList.add("active");
  document.querySelectorAll(".tracker-panel").forEach(p=>p.style.display="none");
  const panel = document.getElementById("tpanel-"+tab); if(panel) panel.style.display="block";
  if(tab==="overview") renderTrackerOverview();
  if(tab==="subjects") renderSubjectsPanel();
  if(tab==="goals")    renderGoalsPanel();
  if(tab==="log")      renderLogPanel();
}
function renderTrackerOverview() {
  const d=getTrackerData();
  const streak=getStreak(),todayMins=getTodayMins(),weekMins=getWeekMins();
  const days=[];
  for(let i=6;i>=0;i--){const dt=new Date();dt.setDate(dt.getDate()-i);const str=dt.toISOString().slice(0,10);const dayMins=d.sessions.filter(s=>s.date===str).reduce((a,s)=>a+(s.mins||0),0);days.push({label:dt.toLocaleDateString(undefined,{weekday:"short"}),mins:dayMins,date:str});}
  const maxMins=Math.max(...days.map(x=>x.mins),1);const todayFmt=todayStr();
  const chartBars=days.map(day=>{const h=Math.max(4,Math.round((day.mins/maxMins)*80));const isToday=day.date===todayFmt;return `<div class="chart-col"><div class="chart-bar-wrap"><div class="chart-bar ${isToday?"today":""}" style="height:${h}px" title="${day.mins} min"></div></div><div class="chart-day ${isToday?"chart-day-today":""}">${day.label}</div></div>`;}).join("");
  document.getElementById("tpanel-overview").innerHTML=`
    <div class="tracker-stats-grid">
      <div class="t-stat-card streak"><div class="t-stat-icon">🔥</div><div class="t-stat-val">${streak}</div><div class="t-stat-label">Day Streak</div></div>
      <div class="t-stat-card"><div class="t-stat-icon">⏱️</div><div class="t-stat-val">${todayMins}</div><div class="t-stat-label">Mins Today</div></div>
      <div class="t-stat-card"><div class="t-stat-icon">📅</div><div class="t-stat-val">${weekMins}</div><div class="t-stat-label">Mins This Week</div></div>
      <div class="t-stat-card"><div class="t-stat-icon">📒</div><div class="t-stat-val">${d.notesTaken||0}</div><div class="t-stat-label">Notes Generated</div></div>
      <div class="t-stat-card"><div class="t-stat-icon">🧪</div><div class="t-stat-val">${d.mockTestsTaken||0}</div><div class="t-stat-label">Mock Tests</div></div>
      <div class="t-stat-card"><div class="t-stat-icon">⚡</div><div class="t-stat-val">${d.flashcardsTaken||0}</div><div class="t-stat-label">Flashcard Blitzes</div></div>
    </div>
    <div class="tracker-section-label">Study Time — Last 7 Days</div>
    <div class="weekly-chart">${chartBars}</div>
    <div class="tracker-section-label" style="margin-top:14px">Study Timer</div>
    <div class="study-timer-block">
      <div class="study-timer-display" id="studyTimerDisplay">${formatTimerHMS(studyTimerSecs)}</div>
      <div class="study-timer-subject">
        <select class="field-input" id="timerSubjectSel" style="flex:1;height:36px;font-size:13px;padding:6px 10px">
          <option value="">— No subject —</option>
          ${(d.subjects||[]).map(s=>`<option value="${s.id}">${escapeHtml(s.name)}</option>`).join("")}
        </select>
      </div>
      <div class="study-timer-actions">
        <button class="timer-btn ${studyTimerRunning?"pause":"start"}" onclick="toggleStudyTimer()" id="timerPlayBtn">${studyTimerRunning?"⏸ Pause":"▶ Start"}</button>
        <button class="timer-btn reset" onclick="resetStudyTimer()">↺ Reset</button>
        <button class="timer-btn log" onclick="logTimerSession()">✓ Log Session</button>
      </div>
    </div>`;
}
function formatTimerHMS(secs){const h=Math.floor(secs/3600),m=Math.floor((secs%3600)/60),s=secs%60;if(h>0)return`${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;return`${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;}
function toggleStudyTimer(){
  studyTimerRunning=!studyTimerRunning;const btn=document.getElementById("timerPlayBtn");
  if(studyTimerRunning){
    btn.textContent="⏸ Pause";btn.className="timer-btn pause";
    studyTimerInt=setInterval(()=>{studyTimerSecs++;const disp=document.getElementById("studyTimerDisplay");if(disp)disp.textContent=formatTimerHMS(studyTimerSecs);},1000);
  } else {clearInterval(studyTimerInt);if(btn){btn.textContent="▶ Start";btn.className="timer-btn start";}}
}
function resetStudyTimer(){studyTimerRunning=false;clearInterval(studyTimerInt);studyTimerSecs=0;const disp=document.getElementById("studyTimerDisplay");if(disp)disp.textContent="00:00";const btn=document.getElementById("timerPlayBtn");if(btn){btn.textContent="▶ Start";btn.className="timer-btn start";}}
function logTimerSession(){
  if(studyTimerSecs<60){alert("Study for at least 1 minute before logging!");return;}
  const mins=Math.round(studyTimerSecs/60);const sel=document.getElementById("timerSubjectSel");const subjectId=sel?sel.value||null:null;
  const notes=prompt(`Add a note for this ${mins}-minute session (optional):`)||"";
  logStudySession(subjectId||null,mins,notes);resetStudyTimer();alert(`✓ Logged ${mins} minutes!`);renderTrackerOverview();
}
function renderSubjectsPanel(){
  const d=getTrackerData();
  const subHTML=(d.subjects||[]).length===0?`<div class="tracker-empty">No subjects yet. Add one below!</div>`:(d.subjects||[]).map(sub=>{const progress=sub.targetMins>0?Math.min(100,Math.round((sub.totalMins/sub.targetMins)*100)):null;return`<div class="subject-card"><div class="subject-card-top"><div class="subject-dot" style="background:${sub.color}"></div><div class="subject-info"><div class="subject-name">${escapeHtml(sub.name)}</div><div class="subject-meta">${sub.totalMins||0} min studied${sub.targetMins?" / "+sub.targetMins+" min goal":""}</div></div><button class="subject-del" onclick="deleteSubject('${sub.id}')">x</button></div>${progress!==null?`<div class="subject-prog-wrap"><div class="subject-prog-fill" style="width:${progress}%;background:${sub.color}"></div></div><div class="subject-prog-label">${progress}% of weekly goal</div>`:""}</div>`;}).join("");
  document.getElementById("tpanel-subjects").innerHTML=`<div class="subjects-list">${subHTML}</div><div class="tracker-section-label" style="margin-top:16px">Add New Subject</div><div class="add-subject-form"><input id="newSubName" class="field-input" type="text" placeholder="Subject name (e.g. Biology)" style="flex:1"/><input id="newSubColor" type="color" value="#2a7f5f" class="color-picker" title="Pick colour"/></div><div class="add-subject-form" style="margin-top:6px"><input id="newSubTarget" class="field-input" type="number" placeholder="Weekly target (mins, optional)" style="flex:1;font-size:13px"/><button class="tracker-add-btn" onclick="addSubject()">Add Subject</button></div>`;
}
const SUBJECT_COLORS=["#2a7f5f","#c4622d","#4b6cb7","#c9942a","#7c4dcc","#d94f70","#0097a7","#558b2f"];
function addSubject(){
  const name=(document.getElementById("newSubName").value||"").trim();if(!name){document.getElementById("newSubName").focus();return;}
  const color=document.getElementById("newSubColor").value||SUBJECT_COLORS[Math.floor(Math.random()*SUBJECT_COLORS.length)];
  const target=parseInt(document.getElementById("newSubTarget").value)||0;
  const d=getTrackerData();d.subjects=d.subjects||[];d.subjects.push({id:genId(),name,color,targetMins:target,totalMins:0,createdAt:Date.now()});
  saveTrackerData(d);renderSubjectsPanel();
}
function deleteSubject(id){if(!confirm("Remove this subject?"))return;const d=getTrackerData();d.subjects=(d.subjects||[]).filter(s=>s.id!==id);saveTrackerData(d);renderSubjectsPanel();}
function renderGoalsPanel(){
  const d=getTrackerData();
  const goalsHTML=(d.goals||[]).length===0?`<div class="tracker-empty">No goals yet. Set one below!</div>`:(d.goals||[]).map(g=>{const done=g.done||false;return`<div class="goal-card ${done?"done":""}"><div class="goal-check" onclick="toggleGoal('${g.id}')">${done?"✓":""}</div><div class="goal-text ${done?"goal-done-text":""}">${escapeHtml(g.text)}</div><div class="goal-due">${g.due||""}</div><button class="subject-del" onclick="deleteGoal('${g.id}')">x</button></div>`;}).join("");
  document.getElementById("tpanel-goals").innerHTML=`<div class="goals-list">${goalsHTML}</div><div class="tracker-section-label" style="margin-top:16px">Add New Goal</div><div class="add-subject-form"><input id="newGoalText" class="field-input" type="text" placeholder="e.g. Finish Chapter 5 of Biology" style="flex:1"/></div><div class="add-subject-form" style="margin-top:6px"><input id="newGoalDue" class="field-input" type="date" style="flex:1"/><button class="tracker-add-btn" onclick="addGoal()">Add Goal</button></div><div class="goal-progress-summary"><div class="gps-text">${(d.goals||[]).filter(g=>g.done).length} / ${(d.goals||[]).length} goals completed</div><div class="gps-bar-wrap"><div class="gps-bar-fill" style="width:${(d.goals||[]).length>0?Math.round(((d.goals||[]).filter(g=>g.done).length/(d.goals||[]).length)*100):0}%"></div></div></div>`;
}
function addGoal(){
  const text=(document.getElementById("newGoalText").value||"").trim();if(!text){document.getElementById("newGoalText").focus();return;}
  const due=document.getElementById("newGoalDue").value||"";const d=getTrackerData();d.goals=d.goals||[];
  d.goals.push({id:genId(),text,due,done:false,createdAt:Date.now()});saveTrackerData(d);renderGoalsPanel();
}
function toggleGoal(id){const d=getTrackerData();const g=(d.goals||[]).find(x=>x.id===id);if(g)g.done=!g.done;saveTrackerData(d);renderGoalsPanel();}
function deleteGoal(id){const d=getTrackerData();d.goals=(d.goals||[]).filter(g=>g.id!==id);saveTrackerData(d);renderGoalsPanel();}
function renderLogPanel(){
  const d=getTrackerData();const sessions=[...(d.sessions||[])].reverse().slice(0,30);const subMap={};(d.subjects||[]).forEach(s=>subMap[s.id]=s);
  const logHTML=sessions.length===0?`<div class="tracker-empty">No sessions logged yet. Use the timer in Overview!</div>`:sessions.map(s=>{const sub=s.subjectId?subMap[s.subjectId]:null;return`<div class="log-entry"><div class="log-dot" style="background:${sub?sub.color:"var(--border2)"}"></div><div class="log-info"><div class="log-subject">${sub?escapeHtml(sub.name):"General Study"}</div><div class="log-notes">${s.notes?escapeHtml(s.notes):""}</div></div><div class="log-right"><div class="log-mins">${s.mins} min</div><div class="log-date">${s.date}</div></div></div>`;}).join("");
  document.getElementById("tpanel-log").innerHTML=`<div class="log-list">${logHTML}</div><div class="tracker-section-label" style="margin-top:16px">Log a Session Manually</div><div class="add-subject-form"><select id="manualSubSel" class="field-input" style="flex:1;height:40px;font-size:13px;padding:6px 10px"><option value="">— No subject —</option>${(d.subjects||[]).map(s=>`<option value="${s.id}">${escapeHtml(s.name)}</option>`).join("")}</select><input id="manualMins" class="field-input" type="number" min="1" placeholder="Minutes" style="width:90px"/></div><div class="add-subject-form" style="margin-top:6px"><input id="manualNotes" class="field-input" type="text" placeholder="Notes (optional)" style="flex:1"/><button class="tracker-add-btn" onclick="manualLog()">Log</button></div>`;
}
function manualLog(){const mins=parseInt(document.getElementById("manualMins").value)||0;if(mins<1){alert("Enter at least 1 minute.");return;}const subId=document.getElementById("manualSubSel").value||null;const notes=document.getElementById("manualNotes").value.trim();logStudySession(subId,mins,notes);renderLogPanel();}
