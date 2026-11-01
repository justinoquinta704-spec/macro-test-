/* ---- results ---- */
function computeRows(data) {
  const qMap = new Map(data.questions.map(q => [q.id, q]));
  const subs = new Map(data.submissions.map(s => [s.uid, s]));
  const published = new Map(data.results.map(r => [r.uid, r]));

  return data.attempts.map(a => {
    const sub = subs.get(a.uid);
    const deadline = a.startedAt + S.settings.durationMin * 60000;
    const status = sub ? "submitted" : (Date.now() > deadline + GRACE_MS ? "expired" : "progress");
    const answers = sub ? sub.answers || {} : a.draft || {};
    const ids = (a.order || []).filter(id => qMap.has(id));
    let score = 0;
    ids.forEach(id => { if (answers[id] === qMap.get(id).correct) score++; });
    const total = ids.length;
    return {
      uid: a.uid, username: a.username, status, ids, answers,
      score, total, percentage: total ? Math.round(score / total * 100) : 0,
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

function renderResults() {
  const rows = S.admin.rows;
  const graded = rows.filter(r => r.status !== "progress" && r.total > 0);
  const avg = graded.length ? Math.round(graded.reduce((s, r) => s + r.percentage, 0) / graded.length) : null;
  const pcts = graded.map(r => r.percentage);

  $("stats").innerHTML = `
    <div class="stat"><b>${rows.length}</b>Started</div>
    <div class="stat"><b>${graded.length}</b>Finished</div>
    <div class="stat"><b>${avg === null ? "–" : avg + "%"}</b>Average</div>
    <div class="stat"><b>${pcts.length ? Math.max(...pcts) + "%" : "–"}</b>Highest</div>
    <div class="stat"><b>${pcts.length ? Math.min(...pcts) + "%" : "–"}</b>Lowest</div>`;

  $("results").innerHTML = rows.length ? `
    <table>
      <thead><tr><th>Student</th><th>Status</th><th>Score</th><th>%</th><th>Warnings</th><th>Time used</th><th>Published</th><th></th></tr></thead>
      <tbody>${rows.map(r => {
        const [label, cls] = STATUS_LABEL[r.status];
        const used = r.submittedAt ? Math.max(1, Math.round((r.submittedAt - r.startedAt) / 60000)) + " min" : "–";
        return `<tr>
          <td>${esc(r.username)}</td>
          <td><span class="pill ${cls}">${label}</span>${r.auto && r.status === "submitted" ? " <span class='pill'>auto</span>" : ""}</td>
          <td>${r.status === "progress" ? "–" : r.score + "/" + r.total}</td>
          <td>${r.status === "progress" ? "–" : r.percentage + "%"}</td>
          <td>${r.warnings}</td>
          <td>${used}</td>
          <td>${r.published ? "Yes" : "No"}</td>
          <td><button class="danger small" data-reset="${esc(r.uid)}">Allow retake</button></td>
        </tr>`;
      }).join("")}</tbody>
    </table>` : "<p>No student results yet.</p>";

  renderAnalysis(graded);
}

function renderAnalysis(graded) {
  const qs = S.admin.data.questions;
  if (!qs.length || !graded.length) {
    $("analysis").innerHTML = "<p>Analysis appears once students finish the test.</p>";
    return;
  }
  $("analysis").innerHTML = qs.map((q, i) => {
    const took = graded.filter(r => r.ids.includes(q.id));
    const right = took.filter(r => r.answers[q.id] === q.correct).length;
    const pct = took.length ? Math.round(right / took.length * 100) : 0;
    return `<div class="question">
      <strong>${i + 1}. ${esc(q.text)}</strong>
      <div class="bar" aria-hidden="true"><i style="width:${pct}%"></i></div>
      <small>${pct}% correct (${right} of ${took.length})</small>
    </div>`;
  }).join("");
}

async function publishResults() {
  const rows = S.admin.rows.filter(r => r.status !== "progress" && r.total > 0);
  if (!rows.length) { await ask({ title: "Nothing to publish", body: "No student has finished the test yet." }); return; }
  const ok = await ask({
    title: "Publish results?",
    body: `${rows.length} student(s) will see their score. Students still in progress are not included.`,
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
  const ok = await ask({
    title: "Allow a retake?",
    body: `This deletes ${row ? row.username + "'s" : "the student's"} attempt, answers and result so the test can be taken again.`,
    ok: "Allow retake", cancel: "Cancel"
  });
  if (!ok) return;
  try { await S.store.resetStudent(uid); await refreshAdmin(); adminMsg("Attempt cleared.", true); }
  catch (e) { adminMsg("Could not clear the attempt: " + e.message); }
}

function exportCSV() {
  const safe = v => {
    let s = String(v ?? "");
    if (/^[=+\-@]/.test(s)) s = "'" + s;
    return '"' + s.replace(/"/g, '""') + '"';
  };
  const head = ["Student", "Status", "Score", "Total", "Percentage", "Warnings", "Auto-submitted", "Started", "Submitted"];
  const lines = S.admin.rows.map(r => [
    r.username, STATUS_LABEL[r.status][0], r.score, r.total, r.percentage, r.warnings,
    r.auto ? "yes" : "no", fmtDate(r.startedAt), fmtDate(r.submittedAt)
  ]);
  const csv = [head, ...lines].map(l => l.map(safe).join(",")).join("\r\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" }));
  a.download = "macro-results.csv";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/* =====================================================================
   EVENTS + BOOT
   ===================================================================== */
function bindEvents() {
  $("loginBtn").onclick = login;
  $("password").addEventListener("keydown", e => { if (e.key === "Enter") login(); });
  $("username").addEventListener("keydown", e => { if (e.key === "Enter") $("password").focus(); });

  $("role").onchange = () => {
    const admin = $("role").value === "admin";
    $("usernameLabel").textContent = admin ? "Email" : "Username";
    $("loginHint").classList.toggle("hidden", admin);
    $("username").value = "";
  };

  document.querySelectorAll("[data-action=logout]").forEach(b => { b.onclick = logout; });
  document.querySelectorAll(".tabs button").forEach(b => { b.onclick = () => switchTab(b.dataset.tab); });

  $("startBtn").onclick = startTest;
  $("resumeBtn").onclick = () => { show("resumeBtn", false); beginTest(); };
  $("submitBtn").onclick = () => submitTest(false);
  $("questionsArea").addEventListener("change", e => {
    if (e.target.matches("input[type=radio]")) saveAnswer(e.target.dataset.q, Number(e.target.value));
  });

  $("saveQuestionBtn").onclick = saveQuestionForm;
  $("cancelEditBtn").onclick = resetQuestionForm;
  $("questionList").addEventListener("click", e => {
    const t = e.target.closest("button");
    if (!t) return;
    if (t.dataset.edit) editQuestion(t.dataset.edit);
    if (t.dataset.delete) removeQuestion(t.dataset.delete);
  });

  $("saveSettingsBtn").onclick = saveSettingsForm;
  $("refreshBtn").onclick = async () => {
    try { await refreshAdmin(); adminMsg("Updated.", true); } catch (e) { adminMsg(e.message); }
  };
  $("publishBtn").onclick = publishResults;
  $("exportBtn").onclick = exportCSV;
  $("results").addEventListener("click", e => {
    const t = e.target.closest("button[data-reset]");
    if (t) resetStudent(t.dataset.reset);
  });
}

async function boot() {
  bindEvents();
  try {
    S.store = FIREBASE_CONFIG ? await createFirebaseStore(FIREBASE_CONFIG) : createDemoStore();
  } catch (e) {
    show("view-login");
    $("loginBtn").disabled = true;
    $("loginMsg").textContent = "Could not connect to the server: " + e.message;
    return;
  }

  if (S.store.mode === "demo") {
    $("banner").textContent =
      `Demo mode: data stays in this browser only. Administrator access: ${DEMO_ADMIN.email} / ${DEMO_ADMIN.password}. See README to go online.`;
    show("banner");
  }

  try { await route(await S.store.init()); }
  catch (e) { await route(null); $("loginMsg").textContent = e.message; }
}

boot();
