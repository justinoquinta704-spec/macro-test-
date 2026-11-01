/* =====================================================================
   ADMIN
   ===================================================================== */
function adminMsg(text, ok = false) {
  const el = $("adminMsg");
  el.textContent = text;
  el.classList.toggle("ok", ok);
}

function switchTab(name) {
  document.querySelectorAll(".tabs button").forEach(b => b.classList.toggle("active", b.dataset.tab === name));
  ["questions", "settings", "results"].forEach(t => show("tab-" + t, t === name));
}

async function showAdmin() {
  show("view-admin");
  adminMsg("");
  try {
    S.settings = await S.store.getSettings();
    await S.store.saveSettings(S.settings); // makes sure the settings document exists
    fillSettingsForm();
    await refreshAdmin();
  } catch (e) {
    adminMsg("Could not load data: " + e.message);
  }
  switchTab("questions");
}

async function refreshAdmin() {
  S.admin.data = await S.store.loadAdminData();
  S.admin.rows = computeRows(S.admin.data);
  renderQuestionList();
  renderResults();
}

/* ---- questions ---- */
function resetQuestionForm() {
  S.admin.editingId = null;
  ["questionText", "optionA", "optionB", "optionC", "optionD"].forEach(id => { $(id).value = ""; });
  $("correct").value = "0";
  $("formTitle").textContent = "Add a question";
  $("saveQuestionBtn").textContent = "Add question";
  show("cancelEditBtn", false);
}

function editQuestion(id) {
  const q = S.admin.data.questions.find(x => x.id === id);
  if (!q) return;
  S.admin.editingId = id;
  $("questionText").value = q.text;
  ["optionA", "optionB", "optionC", "optionD"].forEach((el, i) => { $(el).value = q.options[i]; });
  $("correct").value = String(q.correct);
  $("formTitle").textContent = "Edit question";
  $("saveQuestionBtn").textContent = "Save changes";
  show("cancelEditBtn");
  $("questionText").focus();
  window.scrollTo({ top: 0, behavior: "smooth" });
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
  const text = $("questionText").value.trim();
  const options = ["optionA", "optionB", "optionC", "optionD"].map(id => $(id).value.trim());
  const correct = Number($("correct").value);

  if (!text || options.some(o => !o)) { adminMsg("Complete the question and all four options."); return; }
  if (new Set(options.map(o => o.toLowerCase())).size < 4) { adminMsg("The four options must be different."); return; }

  const editing = S.admin.editingId;
  if (editing && !(await confirmIfStarted("Editing this question"))) return;

  const existing = S.admin.data.questions.find(q => q.id === editing);
  $("saveQuestionBtn").disabled = true;
  try {
    await S.store.saveQuestion({
      id: editing || newId(), text, options, correct,
      createdAt: existing ? existing.createdAt : Date.now()
    });
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
  const n = S.admin.data.questions.length;
  if (n !== S.settings.questionCount) {
    S.settings.questionCount = n;
    await S.store.saveSettings({ questionCount: n });
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

function renderQuestionList() {
  const qs = S.admin.data.questions;
  $("qCount").textContent = qs.length ? `(${qs.length})` : "";
  $("questionList").innerHTML = qs.length ? qs.map((q, i) => `
    <div class="question">
      <strong>${i + 1}. ${esc(q.text)}</strong>
      <p>${q.options.map((o, j) =>
        `${LETTERS[j]}: ${esc(o)}${j === q.correct ? " <span class='pill ok'>correct</span>" : ""}`
      ).join("<br>")}</p>
      <div class="row">
        <button class="secondary small" data-edit="${esc(q.id)}">Edit</button>
        <button class="danger small" data-delete="${esc(q.id)}">Delete</button>
      </div>
    </div>`).join("") : "<p>No questions yet. Add the first one above.</p>";
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
