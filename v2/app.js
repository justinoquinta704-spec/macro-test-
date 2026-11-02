/* =====================================================================
   APP STATE
   ===================================================================== */
const S = {
  store: null, session: null,
  settings: { ...DEFAULTS, counts: {} },
  // student test
  attempt: null, questions: [], answers: {}, warnings: 0,
  active: false, submitting: false, deadline: 0, hiddenAt: 0,
  timer: null, saveTimer: null,
  // admin
  admin: { data: null, rows: [], editingId: null, promptAudio: undefined, promptRec: null, filter: "all" }
};

const REASONS = { time: "the time limit ended", left: "you left the page too many times", "": "" };
const EMAIL_RE = /^\S+@\S+\.\S+$/;

/* =====================================================================
   LOGIN / SESSION
   ===================================================================== */
async function forgotPassword() {
  const email = $("email").value.trim(), msg = $("loginMsg");
  msg.classList.remove("ok");
  if (!EMAIL_RE.test(email)) { msg.textContent = "Type your email above first."; return; }
  try {
    await S.store.resetPassword(email);
    msg.classList.add("ok");
    msg.textContent = "If this email has an account, a reset link was sent. Check your inbox and spam folder.";
  } catch (e) { msg.textContent = e.message; }
}

async function login() {
  const role = $("role").value;
  const email = $("email").value.trim();
  const pw = $("password").value;
  const msg = $("loginMsg");
  msg.classList.remove("ok");
  msg.textContent = "";

  if (!email || !pw) { msg.textContent = "Fill in all fields."; return; }
  if (!EMAIL_RE.test(email)) { msg.textContent = "Enter a valid email address."; return; }

  $("loginBtn").disabled = true;
  try {
    const session = role === "admin" ? await S.store.loginAdmin(email, pw)
      : await S.store.loginStudent({ email, password: pw });
    $("password").value = "";
    await route(session);
  } catch (e) {
    msg.textContent = e.message;
  } finally {
    $("loginBtn").disabled = false;
  }
}

async function route(session) {
  S.session = session;
  ["view-login", "view-admin", "view-student"].forEach(id => show(id, false));
  if (!session) show("view-login");
  else if (session.role === "admin") await showAdmin();
  else await showStudent();
}

async function logout() {
  if (S.active) {
    const ok = await ask({
      title: "Leave the test?",
      body: "The timer keeps running. You can sign in again and continue until the time is over.",
      ok: "Log out", cancel: "Stay"
    });
    if (!ok) return;
    flushDraft();
  }
  S.active = false;
  clearInterval(S.timer);
  await S.store.logout();
  location.reload();
}

/* =====================================================================
   STUDENT
   ===================================================================== */
function studentBlocks({ intro = false, test = false, result = false }) {
  show("studentIntro", intro);
  show("testArea", test);
  show("studentResult", result);
}

async function showStudent() {
  show("view-student");
  $("studentWelcome").textContent = "Welcome, " + S.session.username + "! (" + LEVELS[S.session.level] + " level)";
  $("studentStatus").textContent = "";
  studentBlocks({ intro: true });
  show("startBtn", false); show("resumeBtn", false);
  $("introBody").innerHTML = "<p class='muted'>Loading…</p>";

  try {
    const uid = S.session.uid;
    S.settings = await S.store.getSettings();
    const [attempt, sub, result] = await Promise.all([
      S.store.getAttempt(uid), S.store.getSubmission(uid), S.store.getResult(uid)
    ]);

    if (result) return renderResult(result);
    if (sub) return renderWaiting(sub);

    if (attempt) {
      S.attempt = attempt;
      const deadline = attempt.startedAt + S.settings.durationMin * 60000;
      if (Date.now() > deadline) return finishExpired(attempt);
      $("introBody").innerHTML = "<p>You have a test in progress. The timer is still running.</p>";
      show("resumeBtn");
      return;
    }

    $("introBody").innerHTML = `
      <p>Prepare yourself before starting the test.</p>
      <ul>
        <li>Time limit: <b>${esc(S.settings.durationMin)} minutes</b>. The timer starts when you press Start and keeps running if you close the page.</li>
        <li>Stay on this page. Switching tabs or apps gives a warning; after ${esc(S.settings.maxWarnings)} warning(s) the test is submitted automatically.</li>
        <li>Some questions need a written or a recorded answer. Allow the microphone when asked.</li>
        <li>You can take the test only once.</li>
      </ul>`;
    show("startBtn");
  } catch (e) {
    $("introBody").innerHTML = "";
    $("studentStatus").textContent = "Could not load your data: " + e.message;
  }
}

async function finishExpired(attempt) {
  try {
    await S.store.submit(S.session.uid, {
      username: S.session.username, answers: attempt.draft || {}, auto: true, reason: "time"
    });
  } catch { /* already submitted, or the grace period passed: the teacher grades the saved draft */ }
  renderWaiting({ auto: true, reason: "time", submittedAt: attempt.startedAt + S.settings.durationMin * 60000 });
}

async function startTest() {
  if (!(S.settings.counts && S.settings.counts[S.session.level])) {
    await ask({ title: "No questions yet", body: "The teacher has not added questions yet. Try again later." });
    return;
  }
  const ok = await ask({
    title: "Start the test?",
    body: `You will have ${S.settings.durationMin} minutes. The timer starts now.\n\nLeaving this page more than ${S.settings.maxWarnings} time(s) submits the test automatically.`,
    ok: "Start", cancel: "Not yet"
  });
  if (!ok) return;

  show("startBtn", false);
  try {
    S.attempt = await S.store.startAttempt(S.session.uid, S.session.username);
    await beginTest();
  } catch (e) {
    show("startBtn");
    $("studentStatus").textContent = "Could not start the test: " + e.message;
  }
}

async function beginTest() {
  try {
    const qs = await S.store.getQuestions({ withKeys: false, level: S.session.level });
    const byId = new Map(qs.map(q => [q.id, q]));
    let a = S.attempt;

    if (!a.order?.length) {
      const ids = S.settings.shuffleQuestions ? shuffle(qs.map(q => q.id)) : qs.map(q => q.id);
      const perms = {};
      ids.forEach(id => { perms[id] = S.settings.shuffleOptions ? shuffle([0, 1, 2, 3]) : [0, 1, 2, 3]; });
      a = { ...a, order: ids, perms };
      await S.store.patchAttempt(a.uid, { order: ids, perms });
      S.attempt = a;
    }

    S.questions = a.order.filter(id => byId.has(id)).map(id => byId.get(id));
    if (!S.questions.length) throw new Error("No questions available.");

    S.answers = { ...(a.draft || {}) };
    S.warnings = a.warnings || 0;
    S.deadline = a.startedAt + S.settings.durationMin * 60000;
    S.active = true;
    S.submitting = false;

    studentBlocks({ test: true });
    $("testMessage").textContent = "";
    renderTest();
    startTimer();
  } catch (e) {
    studentBlocks({ intro: true });
    show("resumeBtn");
    $("studentStatus").textContent = "Could not load the test: " + e.message;
  }
}
