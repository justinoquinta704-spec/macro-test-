/* Features: pass mark, skills, full archive of attempts, history details. */
const SKILLS = { reading: "Reading", listening: "Listening", writing: "Writing", speaking: "Speaking" };
const skillOf = q => (q.hasAudio ? "listening" : { mcq: "reading", text: "writing", audio: "speaking" }[q.type || "mcq"]);
const passMarkOf = () => (typeof S.settings.passMark === "number" ? S.settings.passMark : 50);

function skillScores(qs, answers, marks) {
  const out = {};
  Object.keys(SKILLS).forEach(k => { out[k] = { score: 0, total: 0 }; });
  qs.forEach(q => {
    const s = out[skillOf(q)];
    s.total++;
    if (!MANUAL(q)) { if (answers[q.id] === q.correct) s.score++; }
    else if (hasManualAnswer(q, answers[q.id]) && marks[q.id] !== undefined) s.score += marks[q.id];
  });
  return out;
}

function buildItems(row, qMap) {
  return row.ids.map(id => {
    const q = qMap.get(id), a = row.answers[id];
    const item = { id, text: q.text, type: q.type || "mcq", skill: skillOf(q) };
    if (q.type === "text") item.answer = typeof a === "string" ? a : "";
    else if (q.type === "audio") item.answer = a ? "(audio recording)" : "";
    else {
      item.answer = a === undefined || a === null ? "" : LETTERS[a] + ". " + (q.options[a] || "");
      item.correct = a === q.correct;
    }
    if (MANUAL(q) && row.marks[id] !== undefined) item.mark = row.marks[id];
    return item;
  });
}

const baseComputeRows = computeRows;
computeRows = function (data) {
  const rows = baseComputeRows(data);
  const qMap = new Map(data.questions.map(q => [q.id, q]));
  rows.forEach(r => { r.skills = skillScores(r.ids.map(id => qMap.get(id)), r.answers, r.marks); });
  return rows;
};

/* ---- settings: pass mark ---- */
const baseFillSettingsForm = fillSettingsForm;
fillSettingsForm = function () { baseFillSettingsForm(); $("setPass").value = passMarkOf(); };

const baseSaveSettingsForm = saveSettingsForm;
saveSettingsForm = async function () {
  const pass = Math.round(Number($("setPass").value));
  if (!(pass >= 1 && pass <= 100)) { adminMsg("Pass mark must be between 1 and 100."); return; }
  try { await S.store.saveSettings({ passMark: pass }); S.settings.passMark = pass; }
  catch (e) { adminMsg("Could not save settings: " + e.message); return; }
  await baseSaveSettingsForm();
};

/* ---- publish: score, pass/fail and skills ---- */
publishResults = async function () {
  const rows = S.admin.rows.filter(r => r.status !== "progress" && r.total > 0);
  if (!rows.length) { await ask({ title: "Nothing to publish", body: "No student has finished the test yet." }); return; }
  const pending = rows.reduce((s, r) => s + r.pending, 0);
  const pm = passMarkOf();
  const ok = await ask({
    title: "Publish results?",
    body: `${rows.length} student(s) will see their score. Pass mark: ${pm}%.` +
      (pending ? `\n\n${pending} written or audio answer(s) are not graded yet and count as 0.` : ""),
    ok: "Grade and publish", cancel: "Cancel"
  });
  if (!ok) return;
  try {
    await S.store.publishResults(rows.map(r => ({
      uid: r.uid, username: r.username, score: r.score, total: r.total, percentage: r.percentage,
      passed: r.percentage >= pm, passMark: pm, skills: r.skills,
      auto: r.auto, reason: r.reason || "", date: Date.now()
    })));
    await refreshAdmin();
    adminMsg("Results published.", true);
  } catch (e) { adminMsg("Could not publish: " + e.message); }
};

/* ---- retake: everything is kept in the history ---- */
resetStudent = async function (uid) {
  const row = S.admin.rows.find(r => r.uid === uid);
  if (!row) return;
  const ok = await ask({
    title: "Allow a retake?",
    body: `${row.username}'s attempt is saved in “Previous attempts” with the score, the answers and the recordings. Then they can take the test again.`,
    ok: "Allow retake", cancel: "Cancel"
  });
  if (!ok) return;
  const qMap = new Map(S.admin.data.questions.map(q => [q.id, q]));
  const pm = passMarkOf();
  const record = {
    username: row.username, level: row.level, score: row.score, total: row.total, percentage: row.percentage,
    warnings: row.warnings, auto: row.auto, reason: row.reason || "", status: row.status,
    startedAt: row.startedAt, submittedAt: row.submittedAt || null,
    skills: row.skills, published: row.published, passed: row.percentage >= pm, passMark: pm
  };
  try {
    await S.store.archiveAttempt(uid, uid + "_" + Date.now(), record, { items: buildItems(row, qMap) }, row.ids);
    show("reviewPanel", false);
    await refreshAdmin();
    adminMsg("Attempt saved in the history. The student can retake the test.", true);
  } catch (e) { adminMsg("Could not allow the retake: " + e.message); }
};

/* ---- teacher: history with details ---- */
renderHistory = function () {
  const h = S.admin.data.history.filter(r => inFilter(r.level || "basic")).sort((a, b) => b.archivedAt - a.archivedAt);
  $("history").innerHTML = h.length ? `
    <table>
      <thead><tr><th>Student</th><th>Level</th><th>Started</th><th>Score</th><th>%</th><th>Time used</th><th>Warnings</th><th></th></tr></thead>
      <tbody>${h.map(r => `<tr>
        <td>${esc(r.username)}</td><td>${LEVELS[r.level || "basic"]}</td><td>${esc(fmtDate(r.startedAt))}</td>
        <td>${fmtScore(r.score)}/${r.total}</td><td>${r.percentage}%</td>
        <td>${minutesUsed(r.startedAt, r.submittedAt)}</td><td>${r.warnings}</td>
        <td><button class="secondary small" data-hist="${esc(r.id)}">Details</button></td>
      </tr>`).join("")}</tbody>
    </table>` : "<p>No previous attempts yet. When you press “Allow retake”, the old attempt is saved here.</p>";
};

async function openHistory(hid) {
  const rec = S.admin.data.history.find(r => r.id === hid);
  if (!rec) return;
  const panel = $("reviewPanel");
  panel.innerHTML = `<h3>Previous attempt: ${esc(rec.username)}</h3><p class="muted">Loading…</p>`;
  show("reviewPanel");
  panel.scrollIntoView({ behavior: "smooth" });
  let detail = null;
  try { detail = await S.store.getHistoryDetail(hid); } catch (e) { /* ignore */ }
  const items = detail && detail.items ? detail.items : [];
  panel.innerHTML = `
    <h3>Previous attempt: ${esc(rec.username)}</h3>
    <p class="muted">${esc(fmtDate(rec.startedAt))} · ${fmtScore(rec.score)}/${rec.total} · ${rec.percentage}%</p>
    ${items.length ? items.map((it, i) => `
      <div class="question">
        <strong>${i + 1}. ${esc(it.text)}</strong> <span class="pill">${SKILLS[it.skill] || ""}</span>
        ${it.type === "audio"
          ? (it.answer ? `<div data-ha="${esc(it.id)}" style="margin-top:8px"></div>` : "<p class='muted'>No recording.</p>")
          : (it.answer ? `<div class="answer">${esc(it.answer)}</div>` : "<p class='muted'>No answer.</p>")}
        ${it.correct === true ? '<span class="pill ok">correct</span>' : it.correct === false ? '<span class="pill bad">wrong</span>' : ""}
        ${it.mark !== undefined ? `<span class="pill">grade ${it.mark}</span>` : ""}
      </div>`).join("") : "<p>No details were saved for this older attempt.</p>"}
    <button id="closeHistBtn" class="secondary">Close</button>`;
  items.forEach(it => {
    const box = panel.querySelector(`[data-ha="${it.id}"]`);
    if (box) mountLazyAudio(box, () => S.store.getHistoryAudio(hid, it.id));
  });
  $("closeHistBtn").onclick = () => show("reviewPanel", false);
}
$("history").addEventListener("click", e => {
  const t = e.target.closest("button[data-hist]");
  if (t) openHistory(t.dataset.hist);
});
