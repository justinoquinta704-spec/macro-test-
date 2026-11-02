/* ---- results ---- */
const MANUAL = q => q.type === "text" || q.type === "audio";
const hasManualAnswer = (q, a) => (q.type === "text" ? typeof a === "string" && a.trim() !== "" : !!a);

function computeRows(data) {
  const qMap = new Map(data.questions.map(q => [q.id, q]));
  const subs = new Map(data.submissions.map(s => [s.uid, s]));
  const published = new Set(data.results.map(r => r.uid));
  const gradeMap = new Map(data.grades.map(g => [g.uid, g.marks || {}]));
  const levelOf = new Map(data.members.map(m => [m.uid, m.level || "basic"]));

  return data.attempts.map(a => {
    const sub = subs.get(a.uid);
    const deadline = a.startedAt + S.settings.durationMin * 60000;
    const status = sub ? "submitted" : (Date.now() > deadline + GRACE_MS ? "expired" : "progress");
    const answers = sub ? sub.answers || {} : a.draft || {};
    const marks = gradeMap.get(a.uid) || {};
    const ids = (a.order || []).filter(id => qMap.has(id));
    let score = 0, pending = 0;
    ids.forEach(id => {
      const q = qMap.get(id);
      if (!MANUAL(q)) { if (answers[id] === q.correct) score++; return; }
      if (!hasManualAnswer(q, answers[id])) return;
      if (marks[id] !== undefined) score += marks[id]; else pending++;
    });
    const total = ids.length;
    return {
      uid: a.uid, username: a.username, level: levelOf.get(a.uid) || "basic", status, ids, answers, marks,
      score, total, pending, percentage: total ? Math.round(score / total * 100) : 0,
      warnings: a.warnings || 0,
      auto: sub ? !!sub.auto : status === "expired",
      reason: sub ? sub.reason || "" : (status === "expired" ? "time" : ""),
      startedAt: a.startedAt,
      submittedAt: sub ? sub.submittedAt : null,
      published: published.has(a.uid)
    };
  }).sort((a, b) => a.username.localeCompare(b.username));
}

const STATUS_LABEL = {
  progress: ["In progress", "warn"],
  submitted: ["Submitted", "ok"],
  expired: ["Time over, not sent", "bad"]
};
const minutesUsed = (start, end) => (end ? Math.max(1, Math.round((end - start) / 60000)) + " min" : "–");

const inFilter = lv => S.admin.filter === "all" || lv === S.admin.filter;

function renderResults() {
  const rows = S.admin.rows.filter(r => inFilter(r.level));
  const graded = rows.filter(r => r.status !== "progress" && r.total > 0);
  const pcts = graded.map(r => r.percentage);
  const avg = pcts.length ? Math.round(pcts.reduce((s, p) => s + p, 0) / pcts.length) : null;

  $("stats").innerHTML = `
    <div class="stat"><b>${rows.length}</b>Started</div>
    <div class="stat"><b>${graded.length}</b>Finished</div>
    <div class="stat"><b>${avg === null ? "–" : avg + "%"}</b>Average</div>
    <div class="stat"><b>${pcts.length ? Math.max(...pcts) + "%" : "–"}</b>Highest</div>
    <div class="stat"><b>${pcts.length ? Math.min(...pcts) + "%" : "–"}</b>Lowest</div>`;

  $("results").innerHTML = rows.length ? `
    <table>
      <thead><tr><th>Student</th><th>Level</th><th>Status</th><th>Score</th><th>%</th><th>To grade</th><th>Warnings</th><th>Time used</th><th>Published</th><th></th></tr></thead>
      <tbody>${rows.map(r => {
        const [label, cls] = STATUS_LABEL[r.status];
        const done = r.status !== "progress";
        return `<tr>
          <td>${esc(r.username)}</td>
          <td>${LEVELS[r.level]}</td>
          <td><span class="pill ${cls}">${label}</span>${r.auto && r.status === "submitted" ? " <span class='pill'>auto</span>" : ""}</td>
          <td>${done ? fmtScore(r.score) + "/" + r.total : "–"}</td>
          <td>${done ? r.percentage + "%" : "–"}</td>
          <td>${done && r.pending ? `<span class="pill warn">${r.pending}</span>` : "–"}</td>
          <td>${r.warnings}</td>
          <td>${minutesUsed(r.startedAt, r.submittedAt)}</td>
          <td>${r.published ? "Yes" : "No"}</td>
          <td><div class="row">
            <button class="secondary small" data-review="${esc(r.uid)}">Review</button>
            <button class="danger small" data-reset="${esc(r.uid)}">Allow retake</button></div></td>
        </tr>`;
      }).join("")}</tbody>
    </table>` : "<p>No student results yet.</p>";

  renderHistory();
  renderAnalysis(graded);
}

function renderHistory() {
  const h = S.admin.data.history.filter(r => inFilter(r.level || "basic")).sort((a, b) => b.archivedAt - a.archivedAt);
  $("history").innerHTML = h.length ? `
    <table>
      <thead><tr><th>Student</th><th>Level</th><th>Started</th><th>Score</th><th>%</th><th>Time used</th><th>Warnings</th></tr></thead>
      <tbody>${h.map(r => `<tr>
        <td>${esc(r.username)}</td><td>${LEVELS[r.level || "basic"]}</td><td>${esc(fmtDate(r.startedAt))}</td>
        <td>${fmtScore(r.score)}/${r.total}</td><td>${r.percentage}%</td>
        <td>${minutesUsed(r.startedAt, r.submittedAt)}</td><td>${r.warnings}</td>
      </tr>`).join("")}</tbody>
    </table>` : "<p>No previous attempts yet. When you press “Allow retake”, the old attempt is saved here.</p>";
}

function renderAnalysis(graded) {
  const qs = S.admin.data.questions.filter(q => S.admin.filter === "all" || q.level === S.admin.filter);
  if (!qs.length || !graded.length) {
    $("analysis").innerHTML = "<p>Analysis appears once students finish the test.</p>";
    return;
  }
  $("analysis").innerHTML = qs.map((q, i) => {
    const took = graded.filter(r => r.ids.includes(q.id));
    let pct = 0, note = "";
    if (MANUAL(q)) {
      const m = took.map(r => r.marks[q.id]).filter(v => v !== undefined);
      pct = m.length ? Math.round(m.reduce((s, v) => s + v, 0) / m.length * 100) : 0;
      note = `average grade ${pct}% (${m.length} graded of ${took.length})`;
    } else {
      const right = took.filter(r => r.answers[q.id] === q.correct).length;
      pct = took.length ? Math.round(right / took.length * 100) : 0;
      note = `${pct}% correct (${right} of ${took.length})`;
    }
    return `<div class="question">
      <strong>${i + 1}. ${esc(q.text)}</strong>
      <div class="bar" aria-hidden="true"><i style="width:${pct}%"></i></div>
      <small>${note}</small>
    </div>`;
  }).join("");
}
