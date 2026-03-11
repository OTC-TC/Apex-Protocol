const API_KEY_DEFAULT = "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";
const OR_APP_TITLE = "Apex Study AI";
const OR_HTTP_REFERER = (typeof window !== "undefined" && window.location && window.location.origin)
  ? window.location.origin
  : "https://localhost";

// Model fallback chain — tries each in order on 500/502/503/529 errors
const MODELS = [
  "openai/gpt-oss-120b:free",

];

const SYSTEM_PROMPT = `You are Apex Study AI, an intelligent study coach designed to help students learn deeply, not just get answers.

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
Always use markdown formatting.`;

// Storage keys
const SK_SESSIONS="apexStudy_sessions",SK_ACTIVE="apexStudy_activeId",SK_MSG="apexStudy_msgs_";
const SK_TRACKER="apexStudy_tracker";
const SK_API_KEY="apexStudy_apiKey";
let activeSessionId=null,chatHistory=[],studyProgress=0,isLoading=false;
let pillState={qtype:"mixed",qnum:3,mnum:5,mtype:"mcq",mtime:10,mdiff:"medium"};
let mockQuestions=[],mockAnswers={},mockCorrectAnswers={},mockExplanations={};
let mockTimerInt=null,mockSecsLeft=0;
const MAX_CHAT_MESSAGES=20;

function sleep(ms){return new Promise(r=>setTimeout(r,ms));}
function trimMessages(messages,max){
  if(!Array.isArray(messages))return[];
  if(messages.length<=max)return messages;
  const system=messages.find(m=>m.role==="system");
  const nonSystem=messages.filter(m=>m.role!=="system");
  const keep=Math.max(1,max-(system?1:0));
  const tail=nonSystem.slice(-keep);
  return system?[system,...tail]:tail;
}

// Study tracker state
let trackerData=null,studyTimerInt=null,studyTimerSecs=0,studyTimerRunning=false;

function getTrackerData(){
  try{return JSON.parse(localStorage.getItem(SK_TRACKER))||createDefaultTracker();}
  catch{return createDefaultTracker();}
}
function saveTrackerData(d){localStorage.setItem(SK_TRACKER,JSON.stringify(d));}
function createDefaultTracker(){
  return{subjects:[],goals:[],sessions:[],quizzesTaken:0,mockTestsTaken:0,totalMsgs:0,streakDays:[],createdAt:Date.now()};
}
function ensureToday(){
  const d=getTrackerData(),today=todayStr();
  if(!d.streakDays.includes(today)){d.streakDays.push(today);saveTrackerData(d);}
}
function todayStr(){return new Date().toISOString().slice(0,10);}
function getStreak(){
  const d=getTrackerData();if(!d.streakDays.length)return 0;
  const days=[...new Set(d.streakDays)].sort();let streak=0;
  const today=new Date();today.setHours(0,0,0,0);
  for(let i=days.length-1;i>=0;i--){
    const day=new Date(days[i]);day.setHours(0,0,0,0);
    const diff=Math.round((today-day)/86400000);
    if(diff===streak)streak++;else break;
  }
  return streak;
}
function getTodayMins(){
  const d=getTrackerData(),today=todayStr();
  return d.sessions.filter(s=>s.date===today).reduce((a,s)=>a+(s.mins||0),0);
}
function getWeekMins(){
  const d=getTrackerData(),now=new Date();
  const weekAgo=new Date(now-7*86400000).toISOString().slice(0,10);
  return d.sessions.filter(s=>s.date>=weekAgo).reduce((a,s)=>a+(s.mins||0),0);
}
function logStudySession(subjectId,mins,notes){
  const d=getTrackerData();
  d.sessions.push({date:todayStr(),subjectId,mins,notes:notes||""});
  if(subjectId!=null){const sub=d.subjects.find(s=>s.id===subjectId);if(sub)sub.totalMins=(sub.totalMins||0)+mins;}
  saveTrackerData(d);ensureToday();
}
function trackQuiz(){const d=getTrackerData();d.quizzesTaken=(d.quizzesTaken||0)+1;saveTrackerData(d);ensureToday();}
function trackMock(){const d=getTrackerData();d.mockTestsTaken=(d.mockTestsTaken||0)+1;saveTrackerData(d);ensureToday();}
function trackMsg(){const d=getTrackerData();d.totalMsgs=(d.totalMsgs||0)+1;saveTrackerData(d);ensureToday();}

// Pills
function setPill(group,val){
  pillState[group]=val;
  document.querySelectorAll(`[id^="${group}-"]`).forEach(e=>e.classList.remove("on"));
  const t=document.getElementById(group+"-"+val);if(t)t.classList.add("on");
}

// Modals
function openModal(id){document.getElementById(id).classList.add("open");}
function closeModal(id){document.getElementById(id).classList.remove("open");}

// Storage helpers
function getSessions(){try{return JSON.parse(localStorage.getItem(SK_SESSIONS))||[];}catch{return[];}}
function saveSessions(s){localStorage.setItem(SK_SESSIONS,JSON.stringify(s));}
function getMsgs(id){try{return JSON.parse(localStorage.getItem(SK_MSG+id))||[];}catch{return[];}}
function saveMsgs(id,m){localStorage.setItem(SK_MSG+id,JSON.stringify(m));}
function delMsgs(id){localStorage.removeItem(SK_MSG+id);}
function genId(){return Date.now().toString(36)+Math.random().toString(36).slice(2,7);}
function getActiveId(){return localStorage.getItem(SK_ACTIVE)||null;}
function setActiveId(id){localStorage.setItem(SK_ACTIVE,id);}
function getApiKey(){return localStorage.getItem(SK_API_KEY)||API_KEY_DEFAULT||"";}
function setApiKey(k){localStorage.setItem(SK_API_KEY,k);}
function requireApiKey(){
  let key=getApiKey();
  if(key)return key;
  const input=prompt("Enter your OpenRouter API key:");
  if(input&&input.trim()){
    key=input.trim();
    setApiKey(key);
    return key;
  }
  throw new Error("Missing API key. Please add a valid OpenRouter key.");
}

// Sessions
function createSession(label){
  const id=genId(),s={id,label:label||"New Session",createdAt:Date.now(),updatedAt:Date.now()};
  const sessions=getSessions();sessions.unshift(s);saveSessions(sessions);
  saveMsgs(id,[{role:"system",content:SYSTEM_PROMPT}]);return s;
}
function updateLabel(id,label){
  const sessions=getSessions(),s=sessions.find(x=>x.id===id);
  if(s){s.label=label;s.updatedAt=Date.now();saveSessions(sessions);}
}
function updateTime(id){
  const sessions=getSessions(),s=sessions.find(x=>x.id===id);
  if(s){s.updatedAt=Date.now();saveSessions(sessions);}
}
function loadSession(id){
  activeSessionId=id;setActiveId(id);
  chatHistory=getMsgs(id);
  if(!chatHistory.length||chatHistory[0].role!=="system"){
    chatHistory.unshift({role:"system",content:SYSTEM_PROMPT});saveMsgs(id,chatHistory);
  }
  const s=getSessions().find(x=>x.id===id);
  document.getElementById("chatLabel").textContent=s?s.label.toLowerCase():"session";
  renderChat();renderHistoryList();closeSidebar();
}

// Init
window.onload=function(){
  trackerData=getTrackerData();ensureToday();
  const savedId=getActiveId(),sessions=getSessions();
  if(savedId&&sessions.find(s=>s.id===savedId))loadSession(savedId);
  else if(sessions.length)loadSession(sessions[0].id);
  else{const s=createSession("New Session");loadSession(s.id);}
  document.getElementById("userInput").addEventListener("keydown",e=>{
    if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();askAI();}
  });
  document.getElementById("quizTopic").addEventListener("keydown",e=>{if(e.key==="Enter")startQuiz();});
  document.getElementById("mockTopic").addEventListener("keydown",e=>{if(e.key==="Enter")startMockTest();});
  ["quizModal","mockModal","trackerModal"].forEach(id=>{
    document.getElementById(id).addEventListener("click",function(e){if(e.target===this)closeModal(id);});
  });
  document.getElementById("userInput").focus();
};

// New / Clear
function newChat(){
  const s=createSession("New Session");studyProgress=0;
  document.getElementById("progressFill").style.width="0%";
  loadSession(s.id);document.getElementById("userInput").focus();
}
function clearCurrentChat(){
  if(!activeSessionId)return;
  chatHistory=[{role:"system",content:SYSTEM_PROMPT}];
  saveMsgs(activeSessionId,chatHistory);updateLabel(activeSessionId,"New Session");
  document.getElementById("chatLabel").textContent="new session";
  studyProgress=0;document.getElementById("progressFill").style.width="0%";
  renderChat();renderHistoryList();
}
function deleteSession(id,e){
  e.stopPropagation();
  let sessions=getSessions().filter(s=>s.id!==id);saveSessions(sessions);delMsgs(id);
  if(activeSessionId===id){
    if(sessions.length)loadSession(sessions[0].id);
    else{const s=createSession("New Session");loadSession(s.id);}
  }else renderHistoryList();
}

// Sidebar
function toggleSidebar(){
  const sb=document.getElementById("sidebar"),ov=document.getElementById("overlay");
  if(sb.classList.contains("open")){closeSidebar();}
  else{renderHistoryList();sb.classList.add("open");ov.classList.add("visible");}
}
function closeSidebar(){
  document.getElementById("sidebar").classList.remove("open");
  document.getElementById("overlay").classList.remove("visible");
}

// Render history
function renderHistoryList(){
  const list=document.getElementById("historyList"),sessions=getSessions();
  if(!sessions.length){list.innerHTML=`<div class="history-empty">No sessions yet.<br>Start studying!</div>`;return;}
  const groups={};
  sessions.forEach(s=>{
    const d=new Date(s.updatedAt),today=new Date(),yest=new Date();yest.setDate(today.getDate()-1);
    const lbl=d.toDateString()===today.toDateString()?"Today":d.toDateString()===yest.toDateString()?"Yesterday":d.toLocaleDateString(undefined,{month:"short",day:"numeric"});
    if(!groups[lbl])groups[lbl]=[];groups[lbl].push(s);
  });
  let html="";
  for(const[dateLabel,items]of Object.entries(groups)){
    html+=`<div class="history-date-group">${dateLabel}</div>`;
    items.forEach(s=>{
      const active=s.id===activeSessionId?"active":"";
      html+=`<div class="history-item ${active}" onclick="loadSession('${s.id}')">
        <div class="history-item-text">${escapeHtml(s.label)}</div>
        <button class="history-item-del" onclick="deleteSession('${s.id}',event)">x</button>
      </div>`;
    });
  }
  list.innerHTML=html;
}

// Render chat
function renderChat(){
  const box=document.getElementById("chatBox");
  const msgs=chatHistory.filter(m=>m.role!=="system");
  if(!msgs.length){
    box.innerHTML=`<div class="welcome-screen">
      <div class="welcome-badge">📚</div>
      <div class="welcome-title">Your Personal Study Coach</div>
      <div class="welcome-sub">Ask me to explain any concept, quiz you on a topic, or walk you through problems step by step.</div>
      <div class="welcome-chips">
        <div class="chip" onclick="sendHint('What is the difference between mitosis and meiosis?')">🔬 Biology</div>
        <div class="chip" onclick="sendHint('Explain Newton\\'s laws of motion with examples')">⚙️ Physics</div>
        <div class="chip" onclick="sendHint('Teach me how to solve quadratic equations')">📐 Maths</div>
        <div class="chip" onclick="sendHint('Summarize the causes of World War I')">📜 History</div>
        <div class="chip" onclick="sendHint('What is supply and demand?')">📈 Economics</div>
        <div class="chip" onclick="sendHint('Explain figurative language with examples')">✍️ English</div>
      </div>
    </div>`;
    return;
  }
  box.innerHTML="";
  msgs.forEach(msg=>addMessage(msg.content,msg.role==="user"?"user":"bot",false));
  box.scrollTop=box.scrollHeight;
}

// Add message
function addMessage(text,role,animate=true){
  const box=document.getElementById("chatBox");
  const w=box.querySelector(".welcome-screen");if(w)w.remove();
  const wrap=document.createElement("div");wrap.classList.add("message",role);
  if(!animate)wrap.style.animation="none";
  const td=document.createElement("div");td.classList.add("msg-text");
  if(role==="bot")td.innerHTML=marked.parse(text);else td.textContent=text;
  const meta=document.createElement("div");meta.classList.add("msg-meta");
  const cb=document.createElement("button");cb.classList.add("copy-btn");cb.textContent="copy";cb.onclick=()=>copyText(text);
  const te=document.createElement("div");te.classList.add("time");te.textContent=new Date().toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"});
  meta.appendChild(cb);meta.appendChild(te);wrap.appendChild(td);wrap.appendChild(meta);
  box.appendChild(wrap);box.scrollTop=box.scrollHeight;return wrap;
}
function copyText(text){
  navigator.clipboard.writeText(text).then(()=>{
    const t=document.getElementById("copy-toast");t.classList.add("show");setTimeout(()=>t.classList.remove("show"),1400);
  });
}
function updateProgress(){studyProgress=Math.min(100,studyProgress+4);document.getElementById("progressFill").style.width=studyProgress+"%";}
function showTyping(){
  const box=document.getElementById("chatBox");
  const wrap=document.createElement("div");wrap.classList.add("typing-wrap");wrap.id="typing-indicator";
  wrap.innerHTML=`<div class="typing-bubble"><div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div></div>`;
  box.appendChild(wrap);box.scrollTop=box.scrollHeight;
}
function removeTyping(){const el=document.getElementById("typing-indicator");if(el)el.remove();}
function typeEffect(text){
  const box=document.getElementById("chatBox");
  const wrap=document.createElement("div");wrap.classList.add("message","bot");
  const td=document.createElement("div");td.classList.add("msg-text");
  wrap.appendChild(td);box.appendChild(wrap);
  let i=0;
  const iv=setInterval(()=>{
    td.textContent+=text[i++];box.scrollTop=box.scrollHeight;
    if(i>=text.length){
      clearInterval(iv);td.innerHTML=marked.parse(text);
      const meta=document.createElement("div");meta.classList.add("msg-meta");
      const cb=document.createElement("button");cb.classList.add("copy-btn");cb.textContent="copy";cb.onclick=()=>copyText(text);
      const te=document.createElement("div");te.classList.add("time");te.textContent=new Date().toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"});
      meta.appendChild(cb);meta.appendChild(te);wrap.appendChild(meta);box.scrollTop=box.scrollHeight;
    }
  },10);
}
function formatApiError(err){
  const msg=(err&&err.message)?err.message:"Connection issue. Check your API key or try again.";
  if(/401|unauthorized|invalid api key|api key|key/i.test(msg)){
    localStorage.removeItem(SK_API_KEY);
    return "Warning: API key issue. Please re-enter your OpenRouter key and try again.";
  }
  return "Warning: "+msg;
}




// ─── OPENROUTER API ─────────────────────────────────────────
// Tries models in sequence on retryable errors (500/502/503/529)
async function callOpenRouter(payload, modelIndex, attempt) {
  if(modelIndex === undefined) modelIndex = 0;
  if(attempt === undefined) attempt = 0;
  var model = MODELS[Math.min(modelIndex, MODELS.length - 1)];

  var apiKey = requireApiKey();
  var res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": "Bearer " + apiKey,
      "Content-Type": "application/json",
      "HTTP-Referer": OR_HTTP_REFERER,
      "X-Title": OR_APP_TITLE
    },
    body: JSON.stringify(Object.assign({}, payload, { model: model }))
  });

  var data = null;
  try { data = await res.json(); } catch(e) {}

  if (!res.ok) {
    var errMsg = (data && data.error && data.error.message)
      || (data && data.message)
      || ("API Error " + res.status);
    var retryable = [429, 500, 502, 503, 529];
    if (retryable.indexOf(res.status) !== -1) {
      if (attempt < 2) {
        await sleep(250 * Math.pow(2, attempt));
        return callOpenRouter(payload, modelIndex, attempt + 1);
      }
      if (modelIndex < MODELS.length - 1) {
        console.warn("Model " + model + " failed (" + res.status + "), trying next fallback...");
        return callOpenRouter(payload, modelIndex + 1, 0);
      }
    }
    throw new Error(errMsg);
  }

  // Handle reasoning models that put response in reasoning_details instead of content
  var choice = data && data.choices && data.choices[0];
  if (choice && (!choice.message.content || choice.message.content === "")) {
    var details = (choice.message.reasoning_details) || [];
    var extracted = details.filter(function(b){return b.type==="text";}).map(function(b){return b.text;}).join("\n").trim();
    data.choices[0].message.content = extracted || "I wasn't able to generate a response. Please try again.";
  }

  return data;
}

// Ask AI
async function askAI(){
  if(isLoading)return;
  const input=document.getElementById("userInput"),userMessage=input.value.trim();
  if(!userMessage)return;
  isLoading=true;document.getElementById("sendBtn").disabled=true;
  addMessage(userMessage,"user");chatHistory.push({role:"user",content:userMessage});
  input.value="";input.focus();
  const s=getSessions().find(x=>x.id===activeSessionId);
  if(s&&(s.label==="New Session"||s.label==="New Chat")){
    const label=userMessage.slice(0,42)+(userMessage.length>42?"...":"");
    updateLabel(activeSessionId,label);document.getElementById("chatLabel").textContent=label.toLowerCase();
  }
  updateProgress();showTyping();trackMsg();
  try{
    const data=await callOpenRouter({messages:trimMessages(chatHistory,MAX_CHAT_MESSAGES),temperature:0.7});
    removeTyping();
    const aiText=(data&&data.choices&&data.choices[0]&&data.choices[0].message&&data.choices[0].message.content)||"Unexpected response.";
    typeEffect(aiText);chatHistory.push({role:"assistant",content:aiText});
    saveMsgs(activeSessionId,chatHistory);updateTime(activeSessionId);
  }catch(err){
    removeTyping();
    addMessage(formatApiError(err),"bot");
    console.error(err);
  }
  isLoading=false;document.getElementById("sendBtn").disabled=false;
}
function sendHint(text){document.getElementById("userInput").value=text;askAI();}
function exportChat(){
  let text="APEX STUDY AI - SESSION EXPORT\n"+"=".repeat(40)+"\n\n";
  chatHistory.forEach(msg=>{
    if(msg.role!=="system")text+=(msg.role==="user"?"YOU":"APEX STUDY AI")+":\n"+msg.content+"\n\n"+"-".repeat(30)+"\n\n";
  });
  const blob=new Blob([text],{type:"text/plain"}),a=document.createElement("a");
  a.href=URL.createObjectURL(blob);a.download="apex-study-session.txt";a.click();
}

// Quick quiz
function startQuiz(){
  const topic=document.getElementById("quizTopic").value.trim();
  if(!topic){document.getElementById("quizTopic").focus();return;}
  const tl={mixed:"mixed (MCQ and short answer)",mcq:"multiple choice",short:"short answer",truefalse:"true/false"}[pillState.qtype];
  const prompt=`Please generate a ${pillState.qnum}-question ${tl} quiz on: "${topic}". Number each question clearly (Q1, Q2...). For MCQ provide 4 options labeled A-D. Don't give the answers yet - wait for my responses.`;
  closeModal("quizModal");document.getElementById("quizTopic").value="";
  document.getElementById("userInput").value=prompt;trackQuiz();askAI();
}

// Mock test
async function startMockTest(){
  const topic=document.getElementById("mockTopic").value.trim();
  if(!topic){document.getElementById("mockTopic").focus();return;}
  closeModal("mockModal");
  const{mnum,mtype,mtime,mdiff}=pillState;
  const typeDesc=mtype==="mcq"?"MCQ only (4 options labeled A, B, C, D)":"a mix of MCQ (4 options labeled A, B, C, D) and short answer questions";

  document.getElementById("mockScreen").classList.add("active");
  document.getElementById("mockTestTitle").textContent="📋 "+topic;
  document.getElementById("mockTimer").textContent=formatTime(mtime*60);
  document.getElementById("mockBody").innerHTML=`
    <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding:70px 20px;gap:16px">
      <div style="width:46px;height:46px;border:3px solid #e8e2d6;border-top-color:#c9942a;border-radius:50%;animation:spin .8s linear infinite"></div>
      <div style="font-family:'DM Mono',monospace;font-size:13px;color:#7a6a50">Generating ${mnum} ${mdiff} questions on <strong style="color:#1c1812">${escapeHtml(topic)}</strong>...</div>
      <div style="font-size:12px;color:rgba(28,24,18,0.4)">This may take a few seconds</div>
    </div>
    <style>@keyframes spin{to{transform:rotate(360deg)}}</style>`;

  const prompt=`Generate exactly ${mnum} questions for a ${mdiff}-difficulty mock test on: "${topic}".
Question type: ${typeDesc}.
YOU MUST respond with ONLY a valid JSON array. No text before or after. No markdown. No explanation.
Use this exact format:
[
  {
    "num": 1,
    "question": "Full question text?",
    "type": "mcq",
    "options": ["First option", "Second option", "Third option", "Fourth option"],
    "answer": "A",
    "explanation": "Short explanation why A is correct."
  },
  {
    "num": 2,
    "question": "Short answer question?",
    "type": "short",
    "options": [],
    "answer": "The expected answer",
    "explanation": "Brief explanation."
  }
]
STRICT RULES:
- MCQ: type="mcq", exactly 4 options, answer must be the letter "A","B","C", or "D"
- Short answer: type="short", options=[], answer is a concise expected answer string
- Generate exactly ${mnum} questions total
- Difficulty level: ${mdiff}
- Topic: ${topic}
- Output ONLY the JSON array, nothing else`;

  try{
    const data=await callOpenRouter({
      temperature:0.3,
      messages:[
        {role:"system",content:"You are a JSON generator. You output only valid JSON arrays with no extra text, no markdown code fences, no explanation. Only the raw JSON array."},
        {role:"user",content:prompt}
      ]
    });
    let raw=(data&&data.choices&&data.choices[0]&&data.choices[0].message&&data.choices[0].message.content)||"";
    raw=raw.replace(/```json|```/g,"").trim();
    const si=raw.indexOf("["),ei=raw.lastIndexOf("]");
    if(si!==-1&&ei!==-1)raw=raw.slice(si,ei+1);
    mockQuestions=JSON.parse(raw);
    if(!Array.isArray(mockQuestions)||mockQuestions.length===0)throw new Error("Empty array");
  }catch(err){
    document.getElementById("mockScreen").classList.remove("active");
    addMessage(formatApiError(err),"bot");
    console.error(err);return;
  }

  mockAnswers={};mockCorrectAnswers={};mockExplanations={};
  mockQuestions.forEach(q=>{
    mockCorrectAnswers[q.num]=q.answer;
    mockExplanations[q.num]=q.explanation||"";
  });

  renderMockBody();
  trackMock();

  mockSecsLeft=mtime*60;updateMockTimer();clearInterval(mockTimerInt);
  mockTimerInt=setInterval(()=>{
    mockSecsLeft--;updateMockTimer();
    const answered=Object.keys(mockAnswers).length;
    document.getElementById("mockProgFill").style.width=Math.round((answered/mockQuestions.length)*100)+"%";
    if(mockSecsLeft<=0){clearInterval(mockTimerInt);submitMockTest();}
  },1000);
}

function formatTime(secs){
  const m=Math.floor(secs/60),s=secs%60;
  return String(m).padStart(2,"0")+":"+String(s).padStart(2,"0");
}
function updateMockTimer(){
  const el=document.getElementById("mockTimer");
  el.textContent=formatTime(mockSecsLeft);
  if(mockSecsLeft<=60)el.classList.add("warn");else el.classList.remove("warn");
}

function renderMockBody(){
  const total=mockQuestions.length;
  document.getElementById("mockBody").innerHTML=mockQuestions.map((q,idx)=>{
    const letters=["A","B","C","D"];
    const answered=mockAnswers[q.num]!==undefined;
    if(q.type==="mcq"){
      const opts=(q.options||[]).map((opt,oi)=>{
        const letter=letters[oi]||String(oi+1);
        const sel=mockAnswers[q.num]===letter?"selected":"";
        return `<div class="mock-opt ${sel}" onclick="selectMCQ(${q.num},'${letter}',this)">
          <div class="mock-opt-letter">${letter}</div>
          <span>${escapeHtml(opt)}</span>
        </div>`;
      }).join("");
      return `<div class="mock-q-card${answered?" answered":""}" id="mqc-${q.num}">
        <div class="mock-q-num">Question ${idx+1} of ${total} &nbsp;·&nbsp; Multiple Choice</div>
        <div class="mock-q-text">${escapeHtml(q.question)}</div>
        <div class="mock-options">${opts}</div>
      </div>`;
    }else{
      const val=escapeHtml(mockAnswers[q.num]||"");
      return `<div class="mock-q-card${answered?" answered":""}" id="mqc-${q.num}">
        <div class="mock-q-num">Question ${idx+1} of ${total} &nbsp;·&nbsp; Short Answer</div>
        <div class="mock-q-text">${escapeHtml(q.question)}</div>
        <textarea class="mock-short-input" placeholder="Write your answer here..." oninput="saveShort(${q.num},this.value)">${val}</textarea>
      </div>`;
    }
  }).join("");
}

function selectMCQ(qNum,letter,el){
  mockAnswers[qNum]=letter;
  const card=document.getElementById("mqc-"+qNum);
  if(card){
    card.querySelectorAll(".mock-opt").forEach(o=>o.classList.remove("selected"));
    el.classList.add("selected");card.classList.add("answered");
  }
  updateMockProgress();
}
function saveShort(qNum,val){
  if(val.trim()){mockAnswers[qNum]=val.trim();const c=document.getElementById("mqc-"+qNum);if(c)c.classList.add("answered");}
  else{delete mockAnswers[qNum];const c=document.getElementById("mqc-"+qNum);if(c)c.classList.remove("answered");}
  updateMockProgress();
}
function updateMockProgress(){
  const ans=Object.keys(mockAnswers).length;
  document.getElementById("mockProgFill").style.width=Math.round((ans/mockQuestions.length)*100)+"%";
}
function confirmSubmit(){
  const ans=Object.keys(mockAnswers).length,total=mockQuestions.length;
  if(ans<total){if(!confirm(`You have answered ${ans} of ${total} questions. Submit anyway?`))return;}
  submitMockTest();
}

function submitMockTest(){
  clearInterval(mockTimerInt);
  document.getElementById("mockScreen").classList.remove("active");
  const timeTaken=pillState.mtime*60-mockSecsLeft;
  logStudySession(null,Math.round(timeTaken/60)||1,"Mock test");

  const mcqQs=mockQuestions.filter(q=>q.type==="mcq");
  const shortQs=mockQuestions.filter(q=>q.type==="short");
  let correct=0,wrong=0,skipped=0;

  mcqQs.forEach(q=>{
    const a=mockAnswers[q.num];
    if(!a)skipped++;
    else if(a.toUpperCase()===(mockCorrectAnswers[q.num]||"").toUpperCase())correct++;
    else wrong++;
  });
  shortQs.forEach(q=>{if(!mockAnswers[q.num])skipped++;});

  const mcqTotal=mcqQs.length;
  const pct=mcqTotal>0?Math.round((correct/mcqTotal)*100):null;
  const circleClass=pct===null?"ok":pct>=70?"great":pct>=40?"ok":"poor";
  const gradeLabel=pct===null?"Check your short answers below":pct>=80?"Excellent work! 🎉":pct>=60?"Good effort! Keep it up! 📈":pct>=40?"Nice try! Keep practising! 💪":"Keep going — you'll get there! 🌱";

  document.getElementById("scoreBanner").innerHTML=`
    <div class="score-circle ${circleClass}">${pct!==null?pct+"%":"📝"}</div>
    <div class="score-label">${gradeLabel}</div>
    <div class="score-sub" style="margin-top:4px">Completed in ${formatTime(timeTaken)} &nbsp;·&nbsp; ${mockQuestions.length} questions total</div>
    <div class="score-stats">
      ${mcqTotal>0?`<div class="stat-pill correct">✓ ${correct} correct</div><div class="stat-pill wrong">✗ ${wrong} wrong</div>`:""}
      <div class="stat-pill skip">— ${skipped} skipped</div>
      ${shortQs.length>0?`<div class="stat-pill review">📝 ${shortQs.length} short answer${shortQs.length>1?"s":""} to review</div>`:""}
    </div>`;

  document.getElementById("resultsBody").innerHTML=mockQuestions.map((q,idx)=>{
    const letters=["A","B","C","D"];
    const userAns=mockAnswers[q.num];
    let statusClass,status,userBadgeClass;
    if(q.type==="mcq"){
      if(!userAns){status="—";statusClass="s";userBadgeClass="skipped";}
      else if(userAns.toUpperCase()===(mockCorrectAnswers[q.num]||"").toUpperCase()){status="✓";statusClass="c";userBadgeClass="correct";}
      else{status="✗";statusClass="w";userBadgeClass="wrong";}
    }else{status="📝";statusClass="r";userBadgeClass="review";}

    function mcqText(letter){
      if(!letter)return"Not answered";
      const li=letters.indexOf(letter.toUpperCase());
      const optText=li>=0&&q.options?q.options[li]:"";
      return letter.toUpperCase()+(optText?": "+optText:"");
    }
    const userDisplay=q.type==="mcq"?mcqText(userAns):(userAns||"Not answered");
    const correctDisplay=q.type==="mcq"?mcqText(mockCorrectAnswers[q.num]):mockCorrectAnswers[q.num]||"";

    return `<div class="result-card" id="rcard-${q.num}">
      <div class="result-card-head" onclick="toggleCard(${q.num})">
        <div class="result-status-dot ${statusClass}">${status}</div>
        <div class="result-q-info">
          <div class="result-q-num">Q${idx+1} &nbsp;·&nbsp; ${q.type==="mcq"?"Multiple Choice":"Short Answer"}</div>
          <div class="result-q-text">${escapeHtml(q.question)}</div>
        </div>
        <div class="result-chevron">▼</div>
      </div>
      <div class="result-detail">
        <div class="result-detail-inner">
          <div class="detail-block">
            <div class="dl">Your Answer</div>
            <span class="ans-badge ${userBadgeClass}">${escapeHtml(userDisplay)}</span>
          </div>
          ${q.type==="mcq"?`<div class="detail-block"><div class="dl">Correct Answer</div><span class="ans-badge correct-ans">${escapeHtml(correctDisplay)}</span></div>`:""}
          ${q.type==="short"?`<div class="detail-block"><div class="dl">Expected Answer</div><span class="ans-badge correct-ans">${escapeHtml(correctDisplay)}</span></div>`:""}
          ${mockExplanations[q.num]?`<div class="detail-block"><div class="dl">Explanation</div><div class="explain-text">${escapeHtml(mockExplanations[q.num])}</div></div>`:""}
        </div>
      </div>
    </div>`;
  }).join("");

  document.getElementById("resultsScreen").classList.add("active");
}

function toggleCard(num){const c=document.getElementById("rcard-"+num);if(c)c.classList.toggle("expanded");}
function closeResults(){
  document.getElementById("resultsScreen").classList.remove("active");
  mockQuestions=[];mockAnswers={};
}

// Study tracker
function openTracker(){
  closeModal("quizModal");closeModal("mockModal");
  renderTrackerOverview();
  openModal("trackerModal");
}

let trackerTab="overview";
function switchTrackerTab(tab){
  trackerTab=tab;
  document.querySelectorAll(".tracker-tab").forEach(t=>t.classList.remove("active"));
  const el=document.getElementById("ttab-"+tab);if(el)el.classList.add("active");
  document.querySelectorAll(".tracker-panel").forEach(p=>p.style.display="none");
  const panel=document.getElementById("tpanel-"+tab);if(panel)panel.style.display="block";
  if(tab==="overview")renderTrackerOverview();
  if(tab==="subjects")renderSubjectsPanel();
  if(tab==="goals")renderGoalsPanel();
  if(tab==="log")renderLogPanel();
}

function renderTrackerOverview(){
  const d=getTrackerData();
  const streak=getStreak(),todayMins=getTodayMins(),weekMins=getWeekMins();
  const days=[];
  for(let i=6;i>=0;i--){
    const dt=new Date();dt.setDate(dt.getDate()-i);
    const str=dt.toISOString().slice(0,10);
    const dayMins=d.sessions.filter(s=>s.date===str).reduce((a,s)=>a+(s.mins||0),0);
    days.push({label:dt.toLocaleDateString(undefined,{weekday:"short"}),mins:dayMins,date:str});
  }
  const maxMins=Math.max(...days.map(x=>x.mins),1);
  const todayFmt=todayStr();
  const chartBars=days.map(day=>{
    const h=Math.max(4,Math.round((day.mins/maxMins)*80));
    const isToday=day.date===todayFmt;
    return `<div class="chart-col">
      <div class="chart-bar-wrap">
        <div class="chart-bar ${isToday?"today":""}" style="height:${h}px" title="${day.mins} min"></div>
      </div>
      <div class="chart-day ${isToday?"chart-day-today":""}">${day.label}</div>
    </div>`;
  }).join("");

  document.getElementById("tpanel-overview").innerHTML=`
    <div class="tracker-stats-grid">
      <div class="t-stat-card streak"><div class="t-stat-icon">🔥</div><div class="t-stat-val">${streak}</div><div class="t-stat-label">Day Streak</div></div>
      <div class="t-stat-card"><div class="t-stat-icon">⏱️</div><div class="t-stat-val">${todayMins}</div><div class="t-stat-label">Mins Today</div></div>
      <div class="t-stat-card"><div class="t-stat-icon">📅</div><div class="t-stat-val">${weekMins}</div><div class="t-stat-label">Mins This Week</div></div>
      <div class="t-stat-card"><div class="t-stat-icon">📝</div><div class="t-stat-val">${d.quizzesTaken||0}</div><div class="t-stat-label">Quizzes Taken</div></div>
      <div class="t-stat-card"><div class="t-stat-icon">🧪</div><div class="t-stat-val">${d.mockTestsTaken||0}</div><div class="t-stat-label">Mock Tests</div></div>
      <div class="t-stat-card"><div class="t-stat-icon">💬</div><div class="t-stat-val">${d.totalMsgs||0}</div><div class="t-stat-label">Questions Asked</div></div>
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
        <button class="timer-btn ${studyTimerRunning?"pause":"start"}" onclick="toggleStudyTimer()" id="timerPlayBtn">
          ${studyTimerRunning?"⏸ Pause":"▶ Start"}
        </button>
        <button class="timer-btn reset" onclick="resetStudyTimer()">↺ Reset</button>
        <button class="timer-btn log" onclick="logTimerSession()">✓ Log Session</button>
      </div>
    </div>`;
}

function formatTimerHMS(secs){
  const h=Math.floor(secs/3600),m=Math.floor((secs%3600)/60),s=secs%60;
  if(h>0)return`${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
  return`${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
}

function toggleStudyTimer(){
  studyTimerRunning=!studyTimerRunning;
  const btn=document.getElementById("timerPlayBtn");
  if(studyTimerRunning){
    btn.textContent="⏸ Pause";btn.className="timer-btn pause";
    studyTimerInt=setInterval(()=>{
      studyTimerSecs++;
      const disp=document.getElementById("studyTimerDisplay");
      if(disp)disp.textContent=formatTimerHMS(studyTimerSecs);
    },1000);
  }else{
    clearInterval(studyTimerInt);
    if(btn){btn.textContent="▶ Start";btn.className="timer-btn start";}
  }
}
function resetStudyTimer(){
  studyTimerRunning=false;clearInterval(studyTimerInt);studyTimerSecs=0;
  const disp=document.getElementById("studyTimerDisplay");if(disp)disp.textContent="00:00";
  const btn=document.getElementById("timerPlayBtn");if(btn){btn.textContent="▶ Start";btn.className="timer-btn start";}
}
function logTimerSession(){
  if(studyTimerSecs<60){alert("Study for at least 1 minute before logging!");return;}
  const mins=Math.round(studyTimerSecs/60);
  const sel=document.getElementById("timerSubjectSel");
  const subjectId=sel?sel.value||null:null;
  const notes=prompt(`Add a note for this ${mins}-minute session (optional):`)||"";
  logStudySession(subjectId||null,mins,notes);
  resetStudyTimer();
  alert(`✓ Logged ${mins} minutes!`);
  renderTrackerOverview();
}

function renderSubjectsPanel(){
  const d=getTrackerData();
  const subHTML=(d.subjects||[]).length===0
    ?`<div class="tracker-empty">No subjects yet. Add one below!</div>`
    :(d.subjects||[]).map(sub=>{
      const progress=sub.targetMins>0?Math.min(100,Math.round((sub.totalMins/sub.targetMins)*100)):null;
      return`<div class="subject-card">
        <div class="subject-card-top">
          <div class="subject-dot" style="background:${sub.color}"></div>
          <div class="subject-info">
            <div class="subject-name">${escapeHtml(sub.name)}</div>
            <div class="subject-meta">${sub.totalMins||0} min studied${sub.targetMins?" / "+sub.targetMins+" min goal":""}</div>
          </div>
          <button class="subject-del" onclick="deleteSubject('${sub.id}')">x</button>
        </div>
        ${progress!==null?`<div class="subject-prog-wrap"><div class="subject-prog-fill" style="width:${progress}%;background:${sub.color}"></div></div><div class="subject-prog-label">${progress}% of weekly goal</div>`:""}
      </div>`;
    }).join("");

  document.getElementById("tpanel-subjects").innerHTML=`
    <div class="subjects-list">${subHTML}</div>
    <div class="tracker-section-label" style="margin-top:16px">Add New Subject</div>
    <div class="add-subject-form">
      <input id="newSubName" class="field-input" type="text" placeholder="Subject name (e.g. Biology)" style="flex:1"/>
      <input id="newSubColor" type="color" value="#2a7f5f" class="color-picker" title="Pick colour"/>
    </div>
    <div class="add-subject-form" style="margin-top:6px">
      <input id="newSubTarget" class="field-input" type="number" placeholder="Weekly target (mins, optional)" style="flex:1;font-size:13px"/>
      <button class="tracker-add-btn" onclick="addSubject()">Add Subject</button>
    </div>`;
}

const SUBJECT_COLORS=["#2a7f5f","#c4622d","#4b6cb7","#c9942a","#7c4dcc","#d94f70","#0097a7","#558b2f"];
function addSubject(){
  const name=(document.getElementById("newSubName").value||"").trim();
  if(!name){document.getElementById("newSubName").focus();return;}
  const color=document.getElementById("newSubColor").value||SUBJECT_COLORS[Math.floor(Math.random()*SUBJECT_COLORS.length)];
  const target=parseInt(document.getElementById("newSubTarget").value)||0;
  const d=getTrackerData();d.subjects=d.subjects||[];
  d.subjects.push({id:genId(),name,color,targetMins:target,totalMins:0,createdAt:Date.now()});
  saveTrackerData(d);renderSubjectsPanel();
}
function deleteSubject(id){
  if(!confirm("Remove this subject?"))return;
  const d=getTrackerData();d.subjects=(d.subjects||[]).filter(s=>s.id!==id);
  saveTrackerData(d);renderSubjectsPanel();
}

function renderGoalsPanel(){
  const d=getTrackerData();
  const goalsHTML=(d.goals||[]).length===0
    ?`<div class="tracker-empty">No goals yet. Set one below!</div>`
    :(d.goals||[]).map(g=>{
      const done=g.done||false;
      return`<div class="goal-card ${done?"done":""}">
        <div class="goal-check" onclick="toggleGoal('${g.id}')">${done?"✓":""}</div>
        <div class="goal-text ${done?"goal-done-text":""}">${escapeHtml(g.text)}</div>
        <div class="goal-due">${g.due||""}</div>
        <button class="subject-del" onclick="deleteGoal('${g.id}')">x</button>
      </div>`;
    }).join("");

  document.getElementById("tpanel-goals").innerHTML=`
    <div class="goals-list">${goalsHTML}</div>
    <div class="tracker-section-label" style="margin-top:16px">Add New Goal</div>
    <div class="add-subject-form">
      <input id="newGoalText" class="field-input" type="text" placeholder="e.g. Finish Chapter 5 of Biology" style="flex:1"/>
    </div>
    <div class="add-subject-form" style="margin-top:6px">
      <input id="newGoalDue" class="field-input" type="date" style="flex:1"/>
      <button class="tracker-add-btn" onclick="addGoal()">Add Goal</button>
    </div>
    <div class="goal-progress-summary">
      <div class="gps-text">${(d.goals||[]).filter(g=>g.done).length} / ${(d.goals||[]).length} goals completed</div>
      <div class="gps-bar-wrap"><div class="gps-bar-fill" style="width:${(d.goals||[]).length>0?Math.round(((d.goals||[]).filter(g=>g.done).length/(d.goals||[]).length)*100):0}%"></div></div>
    </div>`;
}
function addGoal(){
  const text=(document.getElementById("newGoalText").value||"").trim();
  if(!text){document.getElementById("newGoalText").focus();return;}
  const due=document.getElementById("newGoalDue").value||"";
  const d=getTrackerData();d.goals=d.goals||[];
  d.goals.push({id:genId(),text,due,done:false,createdAt:Date.now()});
  saveTrackerData(d);renderGoalsPanel();
}
function toggleGoal(id){
  const d=getTrackerData();const g=(d.goals||[]).find(x=>x.id===id);
  if(g)g.done=!g.done;saveTrackerData(d);renderGoalsPanel();
}
function deleteGoal(id){
  const d=getTrackerData();d.goals=(d.goals||[]).filter(g=>g.id!==id);saveTrackerData(d);renderGoalsPanel();
}

function renderLogPanel(){
  const d=getTrackerData();
  const sessions=[...(d.sessions||[])].reverse().slice(0,30);
  const subMap={};(d.subjects||[]).forEach(s=>subMap[s.id]=s);
  const logHTML=sessions.length===0
    ?`<div class="tracker-empty">No sessions logged yet. Use the timer in Overview!</div>`
    :sessions.map(s=>{
      const sub=s.subjectId?subMap[s.subjectId]:null;
      return`<div class="log-entry">
        <div class="log-dot" style="background:${sub?sub.color:"var(--border2)"}"></div>
        <div class="log-info">
          <div class="log-subject">${sub?escapeHtml(sub.name):"General Study"}</div>
          <div class="log-notes">${s.notes?escapeHtml(s.notes):""}</div>
        </div>
        <div class="log-right">
          <div class="log-mins">${s.mins} min</div>
          <div class="log-date">${s.date}</div>
        </div>
      </div>`;
    }).join("");

  document.getElementById("tpanel-log").innerHTML=`
    <div class="log-list">${logHTML}</div>
    <div class="tracker-section-label" style="margin-top:16px">Log a Session Manually</div>
    <div class="add-subject-form">
      <select id="manualSubSel" class="field-input" style="flex:1;height:40px;font-size:13px;padding:6px 10px">
        <option value="">— No subject —</option>
        ${(d.subjects||[]).map(s=>`<option value="${s.id}">${escapeHtml(s.name)}</option>`).join("")}
      </select>
      <input id="manualMins" class="field-input" type="number" min="1" placeholder="Minutes" style="width:90px"/>
    </div>
    <div class="add-subject-form" style="margin-top:6px">
      <input id="manualNotes" class="field-input" type="text" placeholder="Notes (optional)" style="flex:1"/>
      <button class="tracker-add-btn" onclick="manualLog()">Log</button>
    </div>`;
}
function manualLog(){
  const mins=parseInt(document.getElementById("manualMins").value)||0;
  if(mins<1){alert("Enter at least 1 minute.");return;}
  const subId=document.getElementById("manualSubSel").value||null;
  const notes=document.getElementById("manualNotes").value.trim();
  logStudySession(subId,mins,notes);renderLogPanel();
}

// Utils
function escapeHtml(s){
  if(typeof s!=="string")return"";
  return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}
