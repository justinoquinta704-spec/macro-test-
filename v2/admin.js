/* =====================================================================
   ADMIN
   ===================================================================== */
const LEVELS = { basic: "Basic", intermediate: "Intermediate", advanced: "Advanced" };
const LEVEL_KEYS = Object.keys(LEVELS);
const levelSelect = (cls, attr, value) =>
  `<select class="${cls}" ${attr}>${LEVEL_KEYS.map(k => `<option value="${k}" ${k === value ? "selected" : ""}>${LEVELS[k]}</option>`).join("")}</select>`;

function adminMsg(text, ok = false) {
  const el = $("adminMsg");
  el.textContent = text;
  el.classList.toggle("ok", ok);
}

function switchTab(name) {
  document.querySelectorAll(".tabs button").forEach(b => b.classList.toggle("active", b.dataset.tab === name));
  ["questions", "students", "settings", "results"].forEach(t => show("tab-" + t, t === name));
}

/* ---- tests: a test = title + level + its own questions ---- */
const testsList = () => Object.entries((S.settings && S.settings.tests) || {})
  .map(([id, t]) => ({ id, ...t })).filter(t => t && t.title)
  .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));

const newDraft = () => ({ id: null, title: "", level: "basic", createdAt: null, questions: [], origIds: [] });

function ensureBuilder() {
  if ($("tTitle")) return;
  const head = document.createElement("div");
  head.innerHTML =
    `<h3>Create a test</h3>` +
    `<label class="field" for="tTitle">Test title (topic)</label>` +
    `<input id="tTitle" type="text" maxlength="80" autocomplete="off" placeholder="e.g. Verb to be">` +
    `<label class="field" for="tLevel">Level (only students of this level can take it)</label>` +
    levelSelect("", 'id="tLevel"', "basic") +
    `<div id="draftBox"></div><hr>`;
  $("formTitle").parentNode.insertBefore(head, $("formTitle"));

  $("qLevel").style.display = "none";
  const lab = document.querySelector('label[for="qLevel"]');
  if (lab) lab.style.display = "none";

  const row = $("saveQuestionBtn").parentNode;
  const box = document.createElement("div");
  box.innerHTML =
    `<div class="row" style="margin-top:14px"><button id="saveTestBtn">Save test</button>` +
    `<button id="clearTestBtn" class="secondary">Start over</button></div>` +
    `<p class="muted">Questions are only saved when you press Save test.</p>`;
  row.parentNode.insertBefore(box, row.nextSibling);

  $("saveTestBtn").onclick = saveTest;
  $("clearTestBtn").onclick = clearDraft;
  $("draftBox").addEventListener("click", draftClick);
  $("questionList").addEventListener("click", testsClick);
  $("tLevel").onchange = () => { S.admin.draft.level = $("tLevel").value; };
  $("tTitle").oninput = () => { S.admin.draft.title = $("tTitle").value; };
  const h = $("qCount").parentNode;
  if (h.firstChild) h.firstChild.nodeValue = "Your tests ";
}

function renderDraft() {
  const d = S.admin.draft;
  $("tTitle").value = d.title;
  $("tLevel").value = d.level;
  $("draftBox").innerHTML = `<h4>Questions in this test (${d.questions.length})</h4>` +
    (d.questions.length ? d.questions.map((q, i) => `
      <div class="question">
        <strong>${i + 1}. ${esc(q.text)}</strong>
        <span class="pill">${TYPE_LABEL[q.type || "mcq"]}</span>${q.hasAudio ? ' <span class="pill">has audio</span>' : ""}
        ${q.type === "mcq" ? `<p>${q.options.map((o, j) =>
          `${LETTERS[j]}: ${esc(o)}${j === q.correct ? " <span class='pill ok'>correct</span>" : ""}`).join("<br>")}</p>` : ""}
        <div class="row" style="margin-top:8px">
          <button class="secondary small" data-dedit="${i}">Edit</button>
          <button class="danger small" data-ddel="${i}">Remove</button>
        </div>
      </div>`).join("") : "<p class='muted'>No questions yet. Add the first one below.</p>");
}

function draftClick(e) {
  const b = e.target.closest("button");
  if (!b) return;
  if (b.dataset.ddel !== undefined) {
    S.admin.draft.questions.splice(Number(b.dataset.ddel), 1);
    resetQuestionForm();
    renderDraft();
  }
  if (b.dataset.dedit !== undefined) editDraftQuestion(Number(b.dataset.dedit));
}

function clearDraft() {
  S.admin.draft = newDraft();
  resetQuestionForm();
  renderDraft();
}

/* ---- the question form adds questions to the test being built ---- */
function showTypeFields() { show("mcqFields", $("qType").value === "mcq"); }

function resetQuestionForm() {
  S.admin.editingIdx = null;
  S.admin.promptAudio = undefined;
  ["questionText", "optionA", "optionB", "optionC", "optionD"].forEach(id => { $(id).value = ""; });
  $("qType").value = "mcq";
  $("correct").value = "0";
  $("promptFile").value = "";
  if (S.admin.promptRec) S.admin.promptRec.setUrl(null);
  $("formTitle").textContent = "Add a question to this test";
  $("saveQuestionBtn").textContent = "Add question to this test";
  show("cancelEditBtn", false);
  showTypeFields();
}

async function editDraftQuestion(i) {
  const q = S.admin.draft.questions[i];
  if (!q) return;
  S.admin.editingIdx = i;
  S.admin.promptAudio = undefined;
  $("qType").value = q.type || "mcq";
  $("questionText").value = q.text;
  ["optionA", "optionB", "optionC", "optionD"].forEach((id, k) => { $(id).value = (q.options || [])[k] || ""; });
  $("correct").value = String(q.correct || 0);
  $("promptFile").value = "";
  S.admin.promptRec.setUrl(null);
  $("formTitle").textContent = "Edit question";
  $("saveQuestionBtn").textContent = "Update question";
  show("cancelEditBtn");
  showTypeFields();
  $("formTitle").scrollIntoView({ behavior: "smooth" });
  if (q.audio) S.admin.promptRec.setUrl(q.audio);
  else if (q.hasAudio && q.id) {
    try { S.admin.promptRec.setUrl(await S.store.getQuestionAudio(q.id)); } catch { /* ignore */ }
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
    adminMsg("Audio file added. Press the button to add the question.", true);
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

/* adds (or updates) a question inside the test being built; nothing is saved to the server yet */
function saveQuestionForm() {
  const type = $("qType").value;
  const text = $("questionText").value.trim();
  const options = type === "mcq" ? ["optionA", "optionB", "optionC", "optionD"].map(id => $(id).value.trim()) : [];
  const correct = Number($("correct").value);

  if (!text) { adminMsg("Write the question."); return; }
  if (type === "mcq") {
    if (options.some(o => !o)) { adminMsg("Complete all four options."); return; }
    if (new Set(options.map(o => o.toLowerCase())).size < 4) { adminMsg("The four options must be different."); return; }
  }

  const d = S.admin.draft, idx = S.admin.editingIdx;
  const old = idx !== null && idx !== undefined ? d.questions[idx] : null;
  const sel = S.admin.promptAudio;
  let audio = old ? old.audio : undefined;
  let hasAudio = old ? !!old.hasAudio : false;
  if (sel !== undefined) { audio = sel; hasAudio = !!sel; }

  const item = {
    id: old ? old.id : newId(), type, text, options, correct, hasAudio, audio,
    createdAt: old ? old.createdAt : null
  };
  if (old) d.questions[idx] = item; else d.questions.push(item);
  resetQuestionForm();
  renderDraft();
  adminMsg(old ? "Question updated." : "Question added to the test. Press Save test when it is complete.", true);
}

async function saveTest() {
  const d = S.admin.draft;
  d.title = $("tTitle").value.trim();
  d.level = $("tLevel").value;
  if (d.title.length < 2) { adminMsg("Give the test a title."); return; }
  if (!d.questions.length) { adminMsg("Add at least one question."); return; }
  if (d.id && !(await confirmIfStarted("Editing this test"))) return;

  const id = d.id || newId();
  $("saveTestBtn").disabled = true;
  try {
    const base = Date.now();
    for (let i = 0; i < d.questions.length; i++) {
      const q = d.questions[i];
      await S.store.saveQuestion({
        id: q.id, type: q.type, level: d.level, topic: d.title, testId: id,
        text: q.text, options: q.options, hasAudio: q.hasAudio,
        ...(q.type === "mcq" ? { correct: q.correct } : {}),
        createdAt: q.createdAt || (base + i)
      }, q.audio);
    }
    const keep = new Set(d.questions.map(q => q.id));
    for (const oid of d.origIds) if (!keep.has(oid)) await S.store.deleteQuestion(oid);
    await S.store.saveTest({ id, title: d.title, level: d.level, createdAt: d.createdAt || Date.now() });
    S.settings = await S.store.getSettings();
    clearDraft();
    await refreshAdmin();
    await syncQuestionCount();
    adminMsg("Test saved.", true);
  } catch (e) {
    adminMsg("Could not save the test: " + e.message);
  } finally {
    $("saveTestBtn").disabled = false;
  }
}

async function testsClick(e) {
  const b = e.target.closest("button");
  if (!b) return;
  if (b.dataset.tedit) {
    const t = testsList().find(x => x.id === b.dataset.tedit);
    if (!t) return;
    const mine = S.admin.data.questions.filter(q => q.testId === t.id);
    S.admin.draft = {
      id: t.id, title: t.title, level: t.level, createdAt: t.createdAt, origIds: mine.map(q => q.id),
      questions: mine.map(q => ({
        id: q.id, type: q.type || "mcq", text: q.text, options: q.options || [], correct: q.correct,
        hasAudio: !!q.hasAudio, audio: undefined, createdAt: q.createdAt
      }))
    };
    resetQuestionForm();
    renderDraft();
    $("tTitle").scrollIntoView({ behavior: "smooth" });
    adminMsg('Editing "' + t.title + '". Press Save test when you finish.', true);
  }
  if (b.dataset.tdel) {
    const t = testsList().find(x => x.id === b.dataset.tdel);
    if (!t) return;
    const ok = await ask({
      title: "Delete this test?",
      body: "The test and all its questions will be deleted. Students using it will be locked.",
      ok: "Delete", cancel: "Cancel"
    });
    if (!ok) return;
    try {
      for (const q of S.admin.data.questions.filter(x => x.testId === t.id)) await S.store.deleteQuestion(q.id);
      for (const m of S.admin.data.members.filter(x => x.testId === t.id)) {
        await S.store.updateMember(m.uid, { testId: "", topic: "", released: false });
      }
      await S.store.deleteTest(t.id);
      S.settings = await S.store.getSettings();
      if (S.admin.draft.id === t.id) clearDraft();
      await refreshAdmin();
      await syncQuestionCount();
      adminMsg("Test deleted.", true);
    } catch (err) { adminMsg("Could not delete: " + err.message); }
  }
}

function editQuestion() { /* questions are edited inside their test */ }

async function removeQuestion(id) {
  if (!(await ask({ title: "Delete this question?", body: "This cannot be undone.", ok: "Delete", cancel: "Cancel" }))) return;
  try {
    await S.store.deleteQuestion(id);
    await refreshAdmin();
    await syncQuestionCount();
    adminMsg("Question deleted.", true);
  } catch (e) { adminMsg("Could not delete: " + e.message); }
}

async function syncQuestionCount() {
  const counts = {};
  LEVEL_KEYS.forEach(k => { counts[k] = S.admin.data.questions.filter(q => q.level === k).length; });
  if (JSON.stringify(counts) !== JSON.stringify(S.settings.counts || {})) {
    S.settings.counts = counts;
    await S.store.saveSettings({ counts });
  }
}

function renderQuestionList() {
  const qs = S.admin.data.questions;
  const tests = testsList();
  $("qCount").textContent = tests.length ? `(${tests.length})` : "";
  const html = tests.map(t => {
    const n = qs.filter(q => q.testId === t.id).length;
    return `<div class="question">
      <strong>${esc(t.title)}</strong> <span class="pill">${LEVELS[t.level] || esc(t.level)}</span> <span class="pill">${n} question(s)</span>
      <div class="row" style="margin-top:8px">
        <button class="secondary small" data-tedit="${esc(t.id)}">Edit</button>
        <button class="danger small" data-tdel="${esc(t.id)}">Delete</button>
      </div></div>`;
  }).join("");
  const orphans = qs.filter(q => !q.testId);
  const oldHtml = orphans.length ? `<h4>Old question bank (${orphans.length})</h4>
    <p class="muted">Questions from before tests existed. A student set to "Old question bank" gets all of them for the level.</p>` +
    orphans.map(q => `<div class="question"><strong>${esc(q.text)}</strong> <span class="pill">${LEVELS[q.level] || "No level"}</span>
      <div class="row" style="margin-top:8px"><button class="danger small" data-delete="${esc(q.id)}">Delete</button></div></div>`).join("") : "";
  $("questionList").innerHTML = (html || "<p>No tests yet. Create the first one above.</p>") + oldHtml;
}

async function showAdmin() {
  show("view-admin");
  adminMsg("");
  ensureBuilder();
  S.admin.promptRec = mountRecorder($("promptRec"), {
    removable: true,
    onChange: url => { S.admin.promptAudio = url; }
  });
  try {
    S.settings = await S.store.getSettings();
    await S.store.saveSettings(S.settings); // makes sure the settings document exists
    fillSettingsForm();
    await refreshAdmin();
    await syncQuestionCount();
  } catch (e) {
    adminMsg("Could not load data: " + e.message);
  }
  clearDraft();
  switchTab("questions");
}

async function refreshAdmin() {
  S.admin.data = await S.store.loadAdminData();
  S.admin.rows = computeRows(S.admin.data);
  renderQuestionList();
  renderStudents();
  renderResults();
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
