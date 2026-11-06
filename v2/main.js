/* ---- students (accounts are created by the teacher) ---- */
const CERT_TYPES = { achievement: "Achievement (test)", class: "Class", level: "Level completion", course: "Course completion", none: "No certificate" };
const testsForLevel = level => Object.entries((S.settings && S.settings.tests) || {})
  .map(([id, t]) => ({ id, ...t })).filter(t => t.title && t.level === level)
  .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));

function renderStudents() {
  const ms = [...S.admin.data.members].sort((a, b) => a.name.localeCompare(b.name));
  $("stuCount").textContent = ms.length ? `(${ms.length})` : "";
  $("studentList").innerHTML = ms.length ? `
    <table>
      <thead><tr><th>Full name</th><th>Email</th><th>Level</th><th>Test</th><th>Certificate</th><th>Access</th><th></th></tr></thead>
      <tbody>${ms.map(m => `<tr>
        <td><input type="text" data-name-uid="${esc(m.uid)}" value="${esc(m.name)}" style="min-width:170px;margin:0"></td><td>${esc(m.email)}</td>
        <td>${levelSelect("grade", `data-setlevel="${esc(m.uid)}"`, m.level || "basic")}</td>
        <td><select data-test-uid="${esc(m.uid)}" style="margin:0;min-width:150px">
          <option value="">Choose a test…</option>
          ${testsForLevel(m.level || "basic").map(t => `<option value="${esc(t.id)}" ${t.id === m.testId ? "selected" : ""}>${esc(t.title)}</option>`).join("")}
          <option value="__all__" ${m.testId === "__all__" ? "selected" : ""}>Old question bank</option>
        </select></td>
        <td><select data-cert-uid="${esc(m.uid)}" style="margin:0">${Object.keys(CERT_TYPES).map(k => `<option value="${k}" ${k === (m.certType || "achievement") ? "selected" : ""}>${CERT_TYPES[k]}</option>`).join("")}</select></td>
        <td><button class="${m.released ? "" : "secondary "}small" data-release="${esc(m.uid)}">${m.released ? "Released" : "Locked"}</button></td>
        <td><div class="row">
          <button class="secondary small" data-reset-pw="${esc(m.email)}">Send reset email</button>
          <button class="danger small" data-remove="${esc(m.uid)}">Remove access</button>
        </div></td></tr>`).join("")}</tbody>
    </table>` : "<p>No students yet. Add the first one above.</p>";
}

function genPassword() {
  const chars = "abcdefghjkmnpqrstuvwxyz23456789";
  return Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

async function addStudent() {
  const name = $("stuName").value.trim();
  const email = $("stuEmail").value.trim();
  const password = $("stuPass").value;
  if (name.length < 2) { adminMsg("Enter the student's full name."); return; }
  if (!EMAIL_RE.test(email)) { adminMsg("Enter a valid email address."); return; }
  if (password.length < 6) { adminMsg("The password needs at least 6 characters."); return; }
  $("addStudentBtn").disabled = true;
  try {
    await S.store.createStudent({ name, email, password, level: $("stuLevel").value });
    ["stuName", "stuEmail", "stuPass"].forEach(id => { $(id).value = ""; });
    await refreshAdmin();
    adminMsg(`${name} was added. Give them the email and the password.`, true);
  } catch (e) {
    adminMsg("Could not add the student: " + e.message);
  } finally {
    $("addStudentBtn").disabled = false;
  }
}

async function removeStudent(uid) {
  const m = S.admin.data.members.find(x => x.uid === uid);
  const ok = await ask({
    title: "Remove access?",
    body: `${m ? m.name : "This student"} will no longer be able to sign in. Their results stay in your lists.`,
    ok: "Remove", cancel: "Cancel"
  });
  if (!ok) return;
  try { await S.store.removeStudent(uid); await refreshAdmin(); adminMsg("Access removed.", true); }
  catch (e) { adminMsg("Could not remove: " + e.message); }
}

async function sendReset(email) {
  try { await S.store.resetPassword(email); adminMsg("Reset email sent to " + email + ".", true); }
  catch (e) { adminMsg("Could not send the email: " + e.message); }
}

/* =====================================================================
   EVENTS + BOOT
   ===================================================================== */
function bindEvents() {
  $("loginBtn").onclick = login;
  $("password").addEventListener("keydown", e => { if (e.key === "Enter") login(); });
  $("email").addEventListener("keydown", e => { if (e.key === "Enter") $("password").focus(); });
  $("forgotBtn").onclick = forgotPassword;
  $("role").onchange = () => { show("studentLinks", $("role").value !== "admin"); $("email").value = ""; };

  document.querySelectorAll("[data-action=logout]").forEach(b => { b.onclick = logout; });
  document.querySelectorAll(".tabs button").forEach(b => { b.onclick = () => switchTab(b.dataset.tab); });

  $("startBtn").onclick = startTest;
  $("resumeBtn").onclick = () => { show("resumeBtn", false); beginTest(); };
  $("submitBtn").onclick = () => submitTest(false);
  $("questionsArea").addEventListener("change", e => {
    if (e.target.matches("input[type=radio]")) saveAnswer(e.target.dataset.q, Number(e.target.value));
  });
  $("questionsArea").addEventListener("input", e => {
    if (e.target.dataset.t) saveAnswer(e.target.dataset.t, e.target.value);
  });

  $("qType").onchange = showTypeFields;
  $("promptFile").onchange = pickPromptFile;
  $("saveQuestionBtn").onclick = saveQuestionForm;
  $("cancelEditBtn").onclick = resetQuestionForm;
  $("questionList").addEventListener("click", e => {
    const t = e.target.closest("button");
    if (!t) return;
    if (t.dataset.edit) editQuestion(t.dataset.edit);
    if (t.dataset.delete) removeQuestion(t.dataset.delete);
  });

  $("addStudentBtn").onclick = addStudent;
  $("genPassBtn").onclick = () => { $("stuPass").value = genPassword(); };
  $("studentList").addEventListener("change", async e => {
    const uid = e.target.dataset.setlevel;
    if (!uid) return;
    try {
      await S.store.updateMember(uid, { level: e.target.value, testId: "", topic: "", released: false });
      await refreshAdmin();
      adminMsg("Level updated. Choose a test for this student and release it again.", true);
    } catch (err) { adminMsg("Could not change the level: " + err.message); }
  });
  $("lvlFilter").onchange = () => { S.admin.filter = $("lvlFilter").value; renderResults(); };
  $("studentList").addEventListener("click", e => {
    const t = e.target.closest("button");
    if (!t) return;
    if (t.dataset.remove) removeStudent(t.dataset.remove);
    if (t.dataset.resetPw) sendReset(t.dataset.resetPw);
  });

  $("saveSettingsBtn").onclick = saveSettingsForm;
  $("refreshBtn").onclick = async () => {
    try { await refreshAdmin(); adminMsg("Updated.", true); } catch (e) { adminMsg(e.message); }
  };
  $("publishBtn").onclick = publishResults;
  $("exportBtn").onclick = exportCSV;
  $("results").addEventListener("click", e => {
    const t = e.target.closest("button");
    if (!t) return;
    if (t.dataset.reset) resetStudent(t.dataset.reset);
    if (t.dataset.review) openReview(t.dataset.review);
  });
}

async function boot() {
  bindEvents();
  try {
    S.store = await createFirebaseStore(FIREBASE_CONFIG);
  } catch (e) {
    show("view-login");
    $("loginBtn").disabled = true;
    $("loginMsg").textContent = "Could not connect to the server: " + e.message;
    return;
  }
  try { await route(await S.store.init()); }
  catch (e) { await route(null); $("loginMsg").textContent = e.message; }
}

/* release / lock a student's test (a test must be chosen first) */
$("studentList").addEventListener("click", async e => {
  const b = e.target.closest("button");
  if (!b || !b.dataset.release) return;
  const uid = b.dataset.release;
  const m = S.admin.data.members.find(x => x.uid === uid);
  if (m && !m.released && !m.testId) { adminMsg("Choose a test for this student first."); return; }
  try {
    await S.store.setStudentRelease(uid, !(m && m.released));
    await refreshAdmin();
    adminMsg(m && m.released ? "Test locked." : "Test released.", true);
  } catch (err) { adminMsg("Could not change: " + err.message); }
});

/* edit a student's full name, test and certificate type */
$("studentList").addEventListener("change", async e => {
  const t = e.target;
  try {
    if (t.dataset.nameUid) {
      const name = t.value.trim();
      if (name.length < 2) { adminMsg("Enter the student's full name."); return; }
      await S.store.setStudentName(t.dataset.nameUid, name);
      await refreshAdmin(); adminMsg("Name updated.", true);
    } else if (t.dataset.testUid) {
      const test = ((S.settings && S.settings.tests) || {})[t.value];
      await S.store.updateMember(t.dataset.testUid, { testId: t.value, topic: test ? test.title : "" });
      await refreshAdmin(); adminMsg("Test chosen. Press Locked to release it.", true);
    } else if (t.dataset.certUid) {
      await S.store.updateMember(t.dataset.certUid, { certType: t.value });
      await refreshAdmin(); adminMsg("Certificate type saved.", true);
    }
  } catch (err) { adminMsg("Could not save: " + err.message); }
});

boot();
