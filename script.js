const API_KEY = "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";
const MODEL   = "arcee-ai/trinity-large-preview:free";
const SYSTEM_PROMPT = `You are Apex Study AI, an intelligent study coach designed to help students learn deeply, not just get answers.

Your goals:
1. Teach concepts clearly and simply.
2. Guide students step-by-step using questions (Socratic teaching).
3. Help students practice with quizzes and problems.
4. Encourage thinking, not memorization.
5. Adapt explanations to the student's level.

Behavior rules:
1. EXPLAIN CLEARLY — Start with a simple explanation, give a real-world example, key bullet-point notes, end with a practice question.
2. SOCRATIC TUTOR MODE — When solving problems do NOT immediately give the answer. Ask guiding questions. Break into steps. Only reveal the final answer if the student asks or gets stuck.
3. QUIZ GENERATION — Generate 3–5 questions, mix MCQ and short answers. After the student answers, check and explain mistakes.
4. SIMPLIFY WHEN NEEDED — Use analogies and everyday examples.
5. SUPPORTIVE STUDY COACH — Be encouraging and motivating.
6. STRUCTURED RESPONSES — Use this format when possible:
📘 Concept · 🧠 Example · 📌 Key Points · ❓ Practice Question
Always use markdown formatting.`;

// ─── STORAGE ────────────────────────────
const SK_SESSIONS="apexStudy_sessions",SK_ACTIVE="apexStudy_activeId",SK_MSG="apexStudy_msgs_";
let activeSessionId=null,chatHistory=[],studyProgress=0,isLoading=false;
let pillState={qtype:"mixed",qnum:3,mnum:5,mtype:"mcq",mtime:10,mdiff:"medium"};
let mockQuestions=[],mockAnswers={},mockCorrectAnswers={},mockExplanations={};
let mockTimerInt=null,mockSecsLeft=0;

// ─── PILLS ──────────────────────────────
function setPill(group,val){
  pillState[group]=val;
  document.querySelectorAll(`[id^="${group}-"]`).forEach(e=>e.classList.remove("on"));
  const t=document.getElementById(group+"-"+val);if(t)t.classList.add("on");
}

// ─── MODALS ─────────────────────────────
function openModal(id){document.getElementById(id).classList.add("open")}
function closeModal(id){document.getElementById(id).classList.remove("open")}

// ─── STORAGE HELPERS ────────────────────
function getSessions(){try{return JSON.parse(localStorage.getItem(SK_SESSIONS))||[];}catch{return[];}}
function saveSessions(s){localStorage.setItem(SK_SESSIONS,JSON.stringify(s))}
function getMsgs(id){try{return JSON.parse(localStorage.getItem(SK_MSG+id))||[];}catch{return[];}}
function saveMsgs(id,m){localStorage.setItem(SK_MSG+id,JSON.stringify(m))}
function delMsgs(id){localStorage.removeItem(SK_MSG+id)}
function genId(){return Date.now().toString(36)+Math.random().toString(36).slice(2,7)}
function getActiveId(){return localStorage.getItem(SK_ACTIVE)||null}
function setActiveId(id){localStorage.setItem(SK_ACTIVE,id)}

// ─── SESSIONS ───────────────────────────
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

// ─── INIT ───────────────────────────────
window.onload=function(){
  const savedId=getActiveId(),sessions=getSessions();
  if(savedId&&sessions.find(s=>s.id===savedId))loadSession(savedId);
  else if(sessions.length)loadSession(sessions[0].id);
  else{const s=createSession("New Session");loadSession(s.id);}

  document.getElementById("userInput").addEventListener("keydown",e=>{
    if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();askAI();}
  });
  document.getElementById("quizTopic").addEventListener("keydown",e=>{if(e.key==="Enter")startQuiz();});
  document.getElementById("mockTopic").addEventListener("keydown",e=>{if(e.key==="Enter")startMockTest();});
  ["quizModal","mockModal"].forEach(id=>{
    document.getElementById(id).addEventListener("click",function(e){if(e.target===this)closeModal(id);});
  });
  document.getElementById("userInput").focus();
};

// ─── NEW / CLEAR ────────────────────────
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

// ─── SIDEBAR ────────────────────────────
function toggleSidebar(){
  const sb=document.getElementById("sidebar"),ov=document.getElementById("overlay");
  if(sb.classList.contains("open")){closeSidebar();}
  else{renderHistoryList();sb.classList.add("open");ov.classList.add("visible");}
}
function closeSidebar(){
  document.getElementById("sidebar").classList.remove("open");
  document.getElementById("overlay").classList.remove("visible");
}

// ─── RENDER HISTORY ─────────────────────
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
        <button class="history-item-del" onclick="deleteSession('${s.id}',event)">×</button>
      </div>`;
    });
  }
  list.innerHTML=html;
}

// ─── RENDER CHAT ────────────────────────
function renderChat(){
  const box=document.getElementById("chatBox");
  const msgs=chatHistory.filter(m=>m.role!=="system");
  if(!msgs.length){
    box.innerHTML=`<div class="welcome-screen">
      <div class="welcome-badge">📚</div>
      <div class="welcome-title">Your Personal Study Coach</div>
      <div class="welcome-sub">Ask me to explain any concept, quiz you on a topic, or walk you through problems step by step. I'm here to help you truly understand — not just memorize.</div>
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

// ─── ADD MESSAGE ────────────────────────
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

// ─── ASK AI ─────────────────────────────
async function askAI(){
  if(isLoading)return;
  const input=document.getElementById("userInput"),userMessage=input.value.trim();
  if(!userMessage)return;
  isLoading=true;document.getElementById("sendBtn").disabled=true;
  addMessage(userMessage,"user");chatHistory.push({role:"user",content:userMessage});
  input.value="";input.focus();
  const s=getSessions().find(x=>x.id===activeSessionId);
  if(s&&(s.label==="New Session"||s.label==="New Chat")){
    const label=userMessage.slice(0,42)+(userMessage.length>42?"…":"");
    updateLabel(activeSessionId,label);document.getElementById("chatLabel").textContent=label.toLowerCase();
  }
  updateProgress();showTyping();
  try{
    const res=await fetch("https://openrouter.ai/api/v1/chat/completions",{
      method:"POST",headers:{Authorization:`Bearer ${API_KEY}`,"Content-Type":"application/json"},
      body:JSON.stringify({model:MODEL,messages:chatHistory,temperature:0.7})
    });
    if(!res.ok)throw new Error("API Error "+res.status);
    const data=await res.json();removeTyping();
    const aiText=data?.choices?.[0]?.message?.content||"Unexpected response.";
    typeEffect(aiText);chatHistory.push({role:"assistant",content:aiText});
    saveMsgs(activeSessionId,chatHistory);updateTime(activeSessionId);
  }catch(err){removeTyping();addMessage("⚠️ Connection issue. Check your API key or try again.","bot");console.error(err);}
  isLoading=false;document.getElementById("sendBtn").disabled=false;
}
function sendHint(text){document.getElementById("userInput").value=text;askAI();}
function exportChat(){
  let text="APEX STUDY AI — SESSION EXPORT\n"+"═".repeat(40)+"\n\n";
  chatHistory.forEach(msg=>{
    if(msg.role!=="system")text+=(msg.role==="user"?"YOU":"APEX STUDY AI")+":\n"+msg.content+"\n\n"+"─".repeat(30)+"\n\n";
  });
  const blob=new Blob([text],{type:"text/plain"}),a=document.createElement("a");
  a.href=URL.createObjectURL(blob);a.download="apex-study-session.txt";a.click();
}

// ─── QUICK QUIZ ─────────────────────────
function startQuiz(){
  const topic=document.getElementById("quizTopic").value.trim();
  if(!topic){document.getElementById("quizTopic").focus();return;}
  const tl={mixed:"mixed (MCQ and short answer)",mcq:"multiple choice",short:"short answer",truefalse:"true/false"}[pillState.qtype];
  const prompt=`Please generate a ${pillState.qnum}-question ${tl} quiz on: "${topic}". Number each question clearly (Q1, Q2…). For MCQ provide 4 options labeled A–D. Don't give the answers yet — wait for my responses.`;
  closeModal("quizModal");document.getElementById("quizTopic").value="";
  document.getElementById("userInput").value=prompt;askAI();
}

// ═══════════════════════════════════════
//  MOCK TEST
// ═══════════════════════════════════════
async function startMockTest(){
  const topic=document.getElementById("mockTopic").value.trim();
  if(!topic){document.getElementById("mockTopic").focus();return;}
  closeModal("mockModal");
  const{mnum,mtype,mtime,mdiff}=pillState;
  const typeDesc=mtype==="mcq"?"MCQ only (4 options labeled A, B, C, D)":"a mix of MCQ (4 options labeled A, B, C, D) and short answer questions";

  // Show loading
  document.getElementById("mockScreen").classList.add("active");
  document.getElementById("mockTestTitle").textContent=`📋 ${topic}`;
  document.getElementById("mockTimer").textContent=formatTime(mtime*60);
  document.getElementById("mockBody").innerHTML=`
    <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding:70px 20px;gap:16px">
      <div style="width:46px;height:46px;border:3px solid #e8e2d6;border-top-color:#c9942a;border-radius:50%;animation:spin .8s linear infinite"></div>
      <div style="font-family:'DM Mono',monospace;font-size:13px;color:#7a6a50">Generating ${mnum} ${mdiff} questions on <strong style="color:#1c1812">${escapeHtml(topic)}</strong>…</div>
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
    const res=await fetch("https://openrouter.ai/api/v1/chat/completions",{
      method:"POST",
      headers:{Authorization:`Bearer ${API_KEY}`,"Content-Type":"application/json"},
      body:JSON.stringify({model:MODEL,temperature:0.3,messages:[
        {role:"system",content:"You are a JSON generator. You output only valid JSON arrays with no extra text, no markdown code fences, no explanation. Only the raw JSON array."},
        {role:"user",content:prompt}
      ]})
    });
    const data=await res.json();
    let raw=data?.choices?.[0]?.message?.content||"";
    // Robustly extract JSON array
    raw=raw.replace(/```json|```/g,"").trim();
    const si=raw.indexOf("["),ei=raw.lastIndexOf("]");
    if(si!==-1&&ei!==-1)raw=raw.slice(si,ei+1);
    mockQuestions=JSON.parse(raw);
    if(!Array.isArray(mockQuestions)||mockQuestions.length===0)throw new Error("Empty array");
  }catch(err){
    document.getElementById("mockScreen").classList.remove("active");
    addMessage("⚠️ Could not generate mock test. The AI returned an unexpected format. Please try again.","bot");
    console.error(err);return;
  }

  // Cache correct answers & explanations
  mockAnswers={};mockCorrectAnswers={};mockExplanations={};
  mockQuestions.forEach(q=>{
    mockCorrectAnswers[q.num]=q.answer;
    mockExplanations[q.num]=q.explanation||"";
  });

  renderMockBody();

  // Start countdown timer
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
        <textarea class="mock-short-input" placeholder="Write your answer here…" oninput="saveShort(${q.num},this.value)">${val}</textarea>
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
  if(ans<total){
    if(!confirm(`You have answered ${ans} of ${total} questions. Submit anyway?`))return;
  }
  submitMockTest();
}

function submitMockTest(){
  clearInterval(mockTimerInt);
  document.getElementById("mockScreen").classList.remove("active");

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

  const timeTaken=pillState.mtime*60-mockSecsLeft;
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

  // Build per-question result cards
  document.getElementById("resultsBody").innerHTML=mockQuestions.map((q,idx)=>{
    const letters=["A","B","C","D"];
    const userAns=mockAnswers[q.num];
    let statusClass,status,userBadgeClass;

    if(q.type==="mcq"){
      if(!userAns){status="—";statusClass="s";userBadgeClass="skipped";}
      else if(userAns.toUpperCase()===(mockCorrectAnswers[q.num]||"").toUpperCase()){status="✓";statusClass="c";userBadgeClass="correct";}
      else{status="✗";statusClass="w";userBadgeClass="wrong";}
    }else{
      status="📝";statusClass="r";userBadgeClass="review";
    }

    // Build display text for MCQ answers (letter + option text)
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
          ${q.type==="mcq"?`<div class="detail-block">
            <div class="dl">Correct Answer</div>
            <span class="ans-badge correct-ans">${escapeHtml(correctDisplay)}</span>
          </div>`:""}
          ${q.type==="short"?`<div class="detail-block">
            <div class="dl">Expected Answer</div>
            <span class="ans-badge correct-ans">${escapeHtml(correctDisplay)}</span>
          </div>`:""}
          ${mockExplanations[q.num]?`<div class="detail-block">
            <div class="dl">Explanation</div>
            <div class="explain-text">${escapeHtml(mockExplanations[q.num])}</div>
          </div>`:""}
        </div>
      </div>
    </div>`;
  }).join("");

  document.getElementById("resultsScreen").classList.add("active");
}

function toggleCard(num){
  const c=document.getElementById("rcard-"+num);if(c)c.classList.toggle("expanded");
}
function closeResults(){
  document.getElementById("resultsScreen").classList.remove("active");
  mockQuestions=[];mockAnswers={};
}

// ─── UTILS ──────────────────────────────
function escapeHtml(s){
  if(typeof s!=="string")return"";
  return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}
