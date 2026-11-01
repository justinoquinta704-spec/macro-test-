function isAnswered(q) {
  const a = S.answers[q.id];
  if (q.type === "text") return typeof a === "string" && a.trim() !== "";
  return a !== undefined && a !== null;
}
const answeredCount = () => S.questions.filter(isAnswered).length;
function updateProgress() {
  $("progress").textContent = `${answeredCount()} / ${S.questions.length} answered`;
}

function questionBody(q) {
  const id = esc(q.id);
  if (q.type === "text")
    return `<textarea data-t="${id}" rows="4" maxlength="2000" placeholder="Type your answer here">${esc(S.answers[q.id] || "")}</textarea>`;
  if (q.type === "audio") return `<div class="arec" data-rec="${id}"></div>`;
  return S.attempt.perms[q.id].map((orig, pos) => `
    <label class="option">
      <input type="radio" name="q_${id}" value="${orig}" data-q="${id}" ${S.answers[q.id] === orig ? "checked" : ""}>
      <span>${LETTERS[pos]}. ${esc(q.options[orig])}</span>
    </label>`).join("");
}

function renderTest() {
  $("questionsArea").innerHTML = S.questions.map((q, i) => `
    <div class="question">
      <strong>${i + 1}. ${esc(q.text)}</strong>
      ${q.hasAudio ? `<div data-qa="${esc(q.id)}" style="margin:8px 0"></div>` : ""}
      ${questionBody(q)}
    </div>`).join("");

  S.questions.forEach(q => {
    if (q.hasAudio) {
      const box = document.querySelector(`[data-qa="${q.id}"]`);
      if (box) mountLazyAudio(box, () => S.store.getQuestionAudio(q.id));
    }
    if (q.type === "audio") {
      const box = document.querySelector(`[data-rec="${q.id}"]`);
      if (!box) return;
      const rec = mountRecorder(box, {
        onChange: async url => {
          await S.store.saveAnswerAudio(S.session.uid, q.id, url);
          saveAnswer(q.id, true);
        }
      });
      if (S.answers[q.id] === true)
        S.store.getAnswerAudio(S.session.uid, q.id).then(u => { if (u) rec.setUrl(u); }).catch(() => {});
    }
  });
  updateProgress();
}

function saveAnswer(id, value) {
  if (!S.active) return;
  S.answers[id] = value;
  updateProgress();
  clearTimeout(S.saveTimer);
  S.saveTimer = setTimeout(flushDraft, 800);
}
function flushDraft() {
  clearTimeout(S.saveTimer);
  if (S.attempt) S.store.patchAttempt(S.session.uid, { draft: S.answers });
}

function tick() {
  const left = S.deadline - Date.now();
  $("timer").textContent = fmtClock(left);
  $("timerBar").classList.toggle("low", left <= 5 * 60000);
  if (left <= 0) { clearInterval(S.timer); submitTest(true, "time"); }
}
function startTimer() {
  clearInterval(S.timer);
  tick();
  S.timer = setInterval(tick, 1000);
}

async function submitTest(auto = false, reason = "") {
  if (!S.active || S.submitting) return;

  if (!auto) {
    const missing = S.questions.length - answeredCount();
    const ok = await ask({
      title: "Submit the test?",
      body: missing
        ? `You have ${missing} unanswered question(s). Submit anyway? You cannot change your answers afterwards.`
        : "You cannot change your answers after submitting.",
      ok: "Submit", cancel: "Keep working"
    });
    if (!ok || !S.active || S.submitting) return;
  } else {
    closeModal(false);
  }

  S.submitting = true;
  clearInterval(S.timer);
  clearTimeout(S.saveTimer);
  $("submitBtn").disabled = true;

  try {
    await S.store.submit(S.session.uid, {
      username: S.session.username, answers: S.answers, auto, reason
    });
    S.active = false;
    renderWaiting({ auto, reason, submittedAt: Date.now() });
  } catch (e) {
    if (reason === "time") {
      // Past the grace period: the saved draft is graded by the teacher.
      S.active = false;
      flushDraft();
      renderWaiting({ auto: true, reason: "time", submittedAt: Date.now() });
    } else {
      $("testMessage").textContent = "Could not submit: " + e.message + " Check your connection and try again.";
      startTimer();
    }
  } finally {
    S.submitting = false;
    $("submitBtn").disabled = false;
  }
}

function renderWaiting(sub) {
  studentBlocks({ result: true });
  $("resultTitle").textContent = "Test submitted";
  $("resultContent").innerHTML = `
    <div class="result">
      <p>Your answers were received${sub.submittedAt ? " on " + esc(fmtDate(sub.submittedAt)) : ""}.</p>
      ${sub.auto ? `<p>The test was submitted automatically because ${esc(REASONS[sub.reason] || "of an interruption")}.</p>` : ""}
      <p>Your score will appear here when the teacher publishes the results.</p>
    </div>
    <p><button id="checkResultBtn">Check for results</button></p>`;
  $("checkResultBtn").onclick = showStudent;
}

function renderResult(r) {
  studentBlocks({ result: true });
  $("resultTitle").textContent = "Test result";
  $("resultContent").innerHTML = `
    <div class="result">
      <div class="big-score">${esc(r.percentage)}%</div>
      <p>${esc(fmtScore(r.score))} out of ${esc(r.total)} points.</p>
      ${r.auto ? `<p class="muted">Submitted automatically because ${esc(REASONS[r.reason] || "of an interruption")}.</p>` : ""}
      ${r.date ? `<p class="muted">Published on ${esc(fmtDate(r.date))}</p>` : ""}
    </div>`;
}

/* Warn when the student leaves the page during the test. */
document.addEventListener("visibilitychange", async () => {
  if (!S.active) return;
  if (document.visibilityState === "hidden") {
    S.hiddenAt = Date.now();
    flushDraft();
    return;
  }
  if (!S.hiddenAt) return;
  S.hiddenAt = 0;

  if (Date.now() >= S.deadline) { submitTest(true, "time"); return; }

  S.warnings++;
  S.store.patchAttempt(S.session.uid, { warnings: S.warnings });

  if (S.warnings > S.settings.maxWarnings) {
    await submitTest(true, "left");
    await ask({ title: "Test submitted", body: "You left the page too many times, so your test was submitted automatically." });
    return;
  }
  const remaining = S.settings.maxWarnings - S.warnings;
  await ask({
    title: `Warning ${S.warnings} of ${S.settings.maxWarnings}`,
    body: "You left the test page. " + (remaining > 0
      ? `If you leave ${remaining} more time(s), the test will be submitted automatically.`
      : "If you leave again, the test will be submitted automatically."),
    ok: "Back to the test"
  });
});

window.addEventListener("beforeunload", e => {
  if (S.active) { flushDraft(); e.preventDefault(); e.returnValue = ""; }
});
