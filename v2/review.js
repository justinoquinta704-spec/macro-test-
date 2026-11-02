/* ---- review and manual grading ---- */
function markSelect(qid, value) {
  const opts = [["", "Not graded"], ["0", "0 – wrong"], ["0.5", "0.5 – partial"], ["1", "1 – correct"]];
  return `<select class="grade" data-mark="${esc(qid)}">${opts.map(([v, l]) =>
    `<option value="${v}" ${String(value ?? "") === v ? "selected" : ""}>${l}</option>`).join("")}</select>`;
}

function reviewAnswer(q, a, uid) {
  if (q.type === "text")
    return hasManualAnswer(q, a) ? `<div class="answer">${esc(a)}</div>` : "<p class='muted'>No answer.</p>";
  if (q.type === "audio")
    return a ? `<div data-aa="${esc(q.id)}"></div>` : "<p class='muted'>No recording.</p>";
  if (a === undefined || a === null) return "<p class='muted'>No answer.</p>";
  const ok = a === q.correct;
  return `<p>Student chose: <b>${esc(LETTERS[a] + ". " + (q.options[a] || ""))}</b> ` +
    `<span class="pill ${ok ? "ok" : "bad"}">${ok ? "correct" : "wrong"}</span></p>`;
}

function openReview(uid) {
  const row = S.admin.rows.find(r => r.uid === uid);
  if (!row) return;
  const qMap = new Map(S.admin.data.questions.map(q => [q.id, q]));
  const panel = $("reviewPanel");
  panel.innerHTML = `
    <h3>Review: ${esc(row.username)}</h3>
    ${row.ids.map((id, i) => {
      const q = qMap.get(id), a = row.answers[id];
      return `<div class="question">
        <strong>${i + 1}. ${esc(q.text)}</strong>
        ${q.hasAudio ? `<div data-qa="${esc(id)}" style="margin:8px 0"></div>` : ""}
        ${reviewAnswer(q, a, uid)}
        ${MANUAL(q) && hasManualAnswer(q, a) ? markSelect(id, row.marks[id]) : ""}
      </div>`;
    }).join("")}
    <div class="row">
      <button id="saveMarksBtn">Save grades</button>
      <button id="closeReviewBtn" class="secondary">Close</button>
    </div>`;
  show("reviewPanel");
  row.ids.forEach(id => {
    const q = qMap.get(id);
    const qa = panel.querySelector(`[data-qa="${id}"]`);
    if (qa) mountLazyAudio(qa, () => S.store.getQuestionAudio(id));
    const aa = panel.querySelector(`[data-aa="${id}"]`);
    if (aa) mountLazyAudio(aa, () => S.store.getAnswerAudio(uid, id));
  });
  $("closeReviewBtn").onclick = () => show("reviewPanel", false);
  $("saveMarksBtn").onclick = async () => {
    const marks = {};
    panel.querySelectorAll("[data-mark]").forEach(s => { if (s.value !== "") marks[s.dataset.mark] = Number(s.value); });
    try {
      await S.store.saveGrades(uid, marks);
      show("reviewPanel", false);
      await refreshAdmin();
      adminMsg("Grades saved. Press “Grade and publish results” to show scores to students.", true);
    } catch (e) { adminMsg("Could not save grades: " + e.message); }
  };
  panel.scrollIntoView({ behavior: "smooth" });
}

/* ---- publish, retake, export ---- */
async function publishResults() {
  const rows = S.admin.rows.filter(r => r.status !== "progress" && r.total > 0);
  if (!rows.length) { await ask({ title: "Nothing to publish", body: "No student has finished the test yet." }); return; }
  const pending = rows.reduce((s, r) => s + r.pending, 0);
  const ok = await ask({
    title: "Publish results?",
    body: `${rows.length} student(s) will see their score.` +
      (pending ? `\n\n${pending} written or audio answer(s) are not graded yet and count as 0.` : ""),
    ok: "Grade and publish", cancel: "Cancel"
  });
  if (!ok) return;
  try {
    await S.store.publishResults(rows.map(r => ({
      uid: r.uid, username: r.username, score: r.score, total: r.total,
      percentage: r.percentage, auto: r.auto, reason: r.reason || "", date: Date.now()
    })));
    await refreshAdmin();
    adminMsg("Results published.", true);
  } catch (e) { adminMsg("Could not publish: " + e.message); }
}

async function resetStudent(uid) {
  const row = S.admin.rows.find(r => r.uid === uid);
  if (!row) return;
  const ok = await ask({
    title: "Allow a retake?",
    body: `${row.username}'s current attempt is saved in “Previous attempts”, and then they can take the test again. Their recorded answers are removed to free space.`,
    ok: "Allow retake", cancel: "Cancel"
  });
  if (!ok) return;
  try {
    await S.store.resetStudent(uid, {
      username: row.username, level: row.level, score: row.score, total: row.total, percentage: row.percentage,
      warnings: row.warnings, auto: row.auto, reason: row.reason || "", status: row.status,
      startedAt: row.startedAt, submittedAt: row.submittedAt || null
    }, row.ids);
    show("reviewPanel", false);
    await refreshAdmin();
    adminMsg("Attempt saved in the history. The student can retake the test.", true);
  } catch (e) { adminMsg("Could not allow the retake: " + e.message); }
}

function exportCSV() {
  const safe = v => {
    let s = String(v ?? "");
    if (/^[=+\-@]/.test(s)) s = "'" + s;
    return '"' + s.replace(/"/g, '""') + '"';
  };
  const head = ["Student", "Level", "Attempt", "Status", "Score", "Total", "Percentage", "Still to grade", "Warnings", "Auto-submitted", "Started", "Submitted"];
  const current = S.admin.rows.map(r => [
    r.username, LEVELS[r.level], "Current", STATUS_LABEL[r.status][0], fmtScore(r.score), r.total, r.percentage, r.pending,
    r.warnings, r.auto ? "yes" : "no", fmtDate(r.startedAt), fmtDate(r.submittedAt)
  ]);
  const old = [...S.admin.data.history].sort((a, b) => a.archivedAt - b.archivedAt).map(r => [
    r.username, LEVELS[r.level || "basic"], "Previous", STATUS_LABEL[r.status] ? STATUS_LABEL[r.status][0] : r.status, fmtScore(r.score), r.total,
    r.percentage, "", r.warnings, r.auto ? "yes" : "no", fmtDate(r.startedAt), fmtDate(r.submittedAt)
  ]);
  const csv = [head, ...current, ...old].map(l => l.map(safe).join(",")).join("\r\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" }));
  a.download = "macro-results.csv";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
