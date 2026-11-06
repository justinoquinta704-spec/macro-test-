/* =====================================================================
   ADMIN
   ===================================================================== */
const LEVELS = { basic: "Basic", intermediate: "Intermediate", advanced: "Advanced" };
const LEVEL_KEYS = Object.keys(LEVELS);
const levelSelect = (cls, attr, value) =>
  `<select class="${cls}" ${attr}>${LEVEL_KEYS.map(k => `<option value="${k}" ${k === value ? "selected" : ""}>${LEVELS[k]}</option>`).join("")}</select>`;

const DEFAULT_TOPICS = [
  "Present simple", "Present continuous", "Past simple", "Future", "Verbs",
  "Vocabulary", "Prepositions", "Articles", "Reading", "Listening", "Pronunciation", "Writing"
];

function adminMsg(text, ok = false) {
  const el = $("adminMsg");
  el.textContent = text;
  el.classList.toggle("ok", ok);
}

function switchTab(name) {
  document.querySelectorAll(".tabs button").forEach(b => b.classList.toggle("active", b.dataset.tab === name));
  ["questions", "students", "settings", "results"].forEach(t => show("tab-" + t, t === name));
}

/* ---- extra fields created by code: question topic + test names ---- */
function ensureTopicField() {
  if ($("qTopic")) return;
  const q = $("questionText");
  const wrap = document.createElement("div");
  wrap.innerHTML =
    `<label class="field" for="qTopic">Topic (title shown above the question)</label>` +
    `<input id="qTopic" type="text" list="topicList" maxlength="60" autocomplete="off" placeholder="e.g. Present simple, Verbs, Vocabulary">` +
    `<datalist id="topicList"></datalist>`;
  q.parentNode.insertBefore(wrap, q);
  fillTopicList();
}

function fillTopicList() {
  const list = $("topicList");
  if (!list) return;
  const used = S.admin.data ? S.admin.data.questions.map(q => (q.topic || "").trim()).filter(Boolean) : [];
  const topics = [...new Set([...used, ...DEFAULT_TOPICS])];
  list.innerHTML = topics.map(t => `<option value="${esc(t)}">`).join("");
}

function ensureNameFields() {
  if ($("setName_basic")) return;
  const btn = $("saveSettingsBtn");
  const box = document.createElement("div");
  box.innerHTML = `<h4>Test names</h4>` + LEVEL_KEYS.map(k =>
    `<label class="field" for="setName_${k}">${LEVELS[k]} test name</label>` +
    `<input id="setName_${k}" type="text" maxlength="60" placeholder="e.g. ${LEVELS[k]} Test">`).join("");
  btn.parentNode.insertBefore(box, btn);
  btn.addEventListener("click", saveNames);
}

function fillNames() {
  LEVEL_KEYS.forEach(k => {
    const el = $("setName_" + k);
    if (el) el.value = (S.settings.names && S.settings.names[k]) || "";
  });
}

async function saveNames() {
  const names = {};
  LEVEL_KEYS.forEach(k => { const el = $("setName_" + k); names[k] = el ? el.value.trim() : ""; });
  try {
    await S.store.saveSettings({ names });
    S.settings = { ...S.settings, names };
  } catch (e) { adminMsg("Could not save the test names: " + e.message); }
}

async function showAdmin() {
  show("view-admin");
  adminMsg("");
  ensureTopicField();
  ensureNameFields();
  S.admin.promptRec = mountRecorder($("promptRec"), {
    removable: true,
    onChange: url => { S.admin.promptAudio = url; }
  });
  try {
    S.settings = await S.store.getSettings();
    await S.store.saveSettings(S.settings); // makes sure the settings document exists
    fillSettingsForm();
    fillNames();
    await refreshAdmin();
    await syncQuestionCount();
  } catch (e) {
    adminMsg("Could not load data: " + e.message);
  }
  switchTab("questions");
}

async function refreshAdmin() {
  S.admin.data = await S.store.loadAdminData();
  S.admin.rows = computeRows(S.admin.data);
  renderQuestionList();
  renderStudents();
  renderResults();
  fillTopicList();
}

/* ---- questions ---- */
function showTypeFields() { show("mcqFields", $("qType").value === "mcq"); }

function resetQuestionForm() {
  S.admin.editingId = null;
  S.admin.promptAudio = undefined;
  ["questionText", "optionA", "optionB", "optionC", "optionD"].forEach(id => { $(id).value = ""; });
  if ($("qTopic")) $("qTopic").value = "";
  $("qType").value = "mcq";
  $("correct").value = "0";
  $("promptFile").value = "";
  S.admin.promptRec.setUrl(null);
  $("formTitle").textContent = "Add a question";
  $("saveQuestionBtn").textContent = "Add question";
  show("cancelEditBtn", false);
  showTypeFields();
}

async function editQuestion(id) {
  const q = S.admin.data.questions.find(x => x.id === id);
  if (!q) return;
  S.admin.editingId = id;
  S.admin.promptAudio = undefined;
  $("qType").value = q.type || "mcq";
  $("qLevel").value = q.level || "basic";
  if ($("qTopic")) $("qTopic").value = q.topic || "";
  $("questionText").value = q.text;
  ["optionA", "optionB", "optionC", "optionD"].forEach((el, i) => { $(el).value = (q.options || [])[i] || ""; });
  $("correct").value = String(q.correct || 0);
  $("promptFile").value = "";
  S.admin.promptRec.setUrl(null);
  $("formTitle").textContent = "Edit question";
  $("saveQuestionBtn").textContent = "Save changes";
  show("cancelEditBtn");
  showTypeFields();
  window.scrollTo({ top: 0, behavior: "smooth" });
  if (q.hasAudio) {
    try { S.admin.promptRec.setUrl(await S.store.getQuestionAudio(id)); } catch { /* ignore */ }
  }
}

async function pickPromptFile() {
  const f = $("promptFile").files[0];
  if (!f) return;
  if (f.size > 700 * 1024) {
    adminMsg("That file is too large (max 700 KB). Record it here instead, or use a shorter file.");
    $("promptFile").value = "";
    return;
  }
  try {
    const url = await blobToDataURL(f);
    S.admin.promptAudio = url;
    S.admin.promptRec.setUrl(url);
    adminMsg("Audio file added. Press Add question to save.", true);
  } catch (e) { adminMsg(e.message); }
}

async function confirmIfStarted(action) {
  if (!S.admin.data.attempts.length) return true;
  return ask({
    title: "Students already started",
    body: `${action} changes how existing answers are graded. Continue?`,
    ok: "Continue", cancel: "Cancel"
  });
}

async function saveQuestionForm() {
  const type = $("qType").value;
  const level = $("qLevel").value;
  const topic = $("qTopic") ? $("qTopic").value.trim() : "";
  const text = $("questionText").value.trim();
  const options = type === "mcq" ? ["optionA", "optionB", "optionC", "optionD"].map(id => $(id).value.trim()) : [];
  const correct = Number($("correct").value);

  if (!text) { adminMsg("Write the question."); return; }
  if (type === "mcq") {
    if (options.some(o => !o)) { adminMsg("Complete all four options."); return; }
    if (new Set(options.map(o => o.toLowerCase())).size < 4) { adminMsg("The four options must be different."); return; }
  }

  const editing = S.admin.editingId;
  if (editing && !(await confirmIfStarted("Editing this question"))) return;

  const existing = S.admin.data.questions.find(q => q.id === editing);
  const audio = S.admin.promptAudio;
  const hasAudio = audio === undefined ? !!(existing && existing.hasAudio) : !!audio;
  $("saveQuestionBtn").disabled = true;
  try {
    await S.store.saveQuestion({
      id: editing || newId(), type, level, topic, text, options, hasAudio,
      ...(type === "mcq" ? { correct } : {}),
      createdAt: existing ? existing.createdAt : Date.now()
    }, audio);
    resetQuestionForm();
    await refreshAdmin();
    await syncQuestionCount();
    adminMsg(editing ? "Question updated." : "Question added.", true);
  } catch (e) {
    adminMsg("Could not save the question: " + e.message);
  } finally {
    $("saveQuestionBtn").disabled = false;
  }
}

async function syncQuestionCount() {
  const counts = {};
  LEVEL_KEYS.forEach(k => { counts[k] = S.admin.data.questions.filter(q => q.level === k).length; });
  if (JSON.stringify(counts) !== JSON.stringify(S.settings.counts || {})) {
    S.settings.counts = counts;
    await S.store.saveSettings({ counts });
  }
}

async function removeQuestion(id) {
  if (!(await ask({ title: "Delete this question?", body: "This cannot be undone.", ok: "Delete", cancel: "Cancel" }))) return;
  if (!(await confirmIfStarted("Deleting this question"))) return;
  try {
    await S.store.deleteQuestion(id);
    if (S.admin.editingId === id) resetQuestionForm();
    await refreshAdmin();
    await syncQuestionCount();
    adminMsg("Question deleted.", true);
  } catch (e) { adminMsg("Could not delete: " + e.message); }
}

function questionItem(q, i) {
  return `
    <div class="question">
      <strong>${i + 1}. ${esc(q.text)}</strong>
      <span class="pill">${TYPE_LABEL[q.type || "mcq"]}</span>${q.topic ? ` <span class="pill">${esc(q.topic)}</span>` : ""}${q.hasAudio ? ' <span class="pill">has audio</span>' : ""}
      ${q.type === "mcq" || !q.type ? `<p>${q.options.map((o, j) =>
        `${LETTERS[j]}: ${esc(o)}${j === q.correct ? " <span class='pill ok'>correct</span>" : ""}`).join("<br>")}</p>` : ""}
      <div class="row" style="margin-top:8px">
        <button class="secondary small" data-edit="${esc(q.id)}">Edit</button>
        <button class="danger small" data-delete="${esc(q.id)}">Delete</button>
      </div>
    </div>`;
}

function renderQuestionList() {
  const qs = S.admin.data.questions;
  $("qCount").textContent = qs.length ? `(${qs.length})` : "";
  const groups = { ...LEVELS, none: "No level (old questions: edit or delete)" };
  $("questionList").innerHTML = qs.length ? Object.keys(groups).map(k => {
    const list = qs.filter(q => (q.level || "none") === k);
    if (k === "none" && !list.length) return "";
    return `<h4>${groups[k]} (${list.length})</h4>` +
      (list.length ? list.map(questionItem).join("") : "<p class='muted'>No questions for this level yet.</p>");
  }).join("") : "<p>No questions yet. Add the first one above.</p>";
}

/* ---- settings ---- */
function fillSettingsForm() {
  $("setDuration").value = S.settings.durationMin;
  $("setWarnings").value = S.settings.maxWarnings;
  $("setShuffleQ").checked = !!S.settings.shuffleQuestions;
  $("setShuffleO").checked = !!S.settings.shuffleOptions;
}

async function saveSettingsForm() {
  const durationMin = Math.round(Number($("setDuration").value));
  const maxWarnings = Math.round(Number($("setWarnings").value));
  if (!(durationMin >= 1 && durationMin <= 300)) { adminMsg("Time limit must be between 1 and 300 minutes."); return; }
  if (!(maxWarnings >= 0 && maxWarnings <= 10)) { adminMsg("Warnings must be between 0 and 10."); return; }
  const next = {
    durationMin, maxWarnings,
    shuffleQuestions: $("setShuffleQ").checked,
    shuffleOptions: $("setShuffleO").checked
  };
  try {
    await S.store.saveSettings(next);
    S.settings = { ...S.settings, ...next };
    adminMsg("Settings saved.", true);
  } catch (e) { adminMsg("Could not save settings: " + e.message); }
}
