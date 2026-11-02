/* Pass mark: the teacher sets the minimum percentage; students see Passed / Not passed. */
const passMarkOf = () => (typeof S.settings.passMark === "number" ? S.settings.passMark : 50);

const baseFillSettingsForm = fillSettingsForm;
fillSettingsForm = function () {
  baseFillSettingsForm();
  $("setPass").value = passMarkOf();
};

const baseSaveSettingsForm = saveSettingsForm;
saveSettingsForm = async function () {
  const pass = Math.round(Number($("setPass").value));
  if (!(pass >= 1 && pass <= 100)) { adminMsg("Pass mark must be between 1 and 100."); return; }
  try {
    await S.store.saveSettings({ passMark: pass });
    S.settings.passMark = pass;
  } catch (e) { adminMsg("Could not save settings: " + e.message); return; }
  await baseSaveSettingsForm();
};

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
      uid: r.uid, username: r.username, score: r.score, total: r.total,
      percentage: r.percentage, passed: r.percentage >= pm, passMark: pm,
      auto: r.auto, reason: r.reason || "", date: Date.now()
    })));
    await refreshAdmin();
    adminMsg("Results published.", true);
  } catch (e) { adminMsg("Could not publish: " + e.message); }
};

renderResult = function (r) {
  studentBlocks({ result: true });
  $("resultTitle").textContent = "Test result";
  const verdict = typeof r.passed === "boolean"
    ? `<p><span class="pill ${r.passed ? "ok" : "bad"}" style="font-size:18px;padding:5px 14px">${r.passed ? "Passed" : "Not passed"}</span></p>` +
      `<p class="muted">Pass mark: ${esc(r.passMark)}%</p>`
    : "";
  $("resultContent").innerHTML = `
    <div class="result">
      <div class="big-score">${esc(r.percentage)}%</div>
      ${verdict}
      <p>${esc(fmtScore(r.score))} out of ${esc(r.total)} points.</p>
      ${r.auto ? `<p class="muted">Submitted automatically because ${esc(REASONS[r.reason] || "of an interruption")}.</p>` : ""}
      ${r.date ? `<p class="muted">Published on ${esc(fmtDate(r.date))}</p>` : ""}
    </div>`;
};
