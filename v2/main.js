/* ---- students (accounts are created by the teacher) ---- */
function renderStudents() {
  const ms = [...S.admin.data.members].sort((a, b) => a.name.localeCompare(b.name));
  $("stuCount").textContent = ms.length ? `(${ms.length})` : "";
  $("studentList").innerHTML = ms.length ? `
    <table>
      <thead><tr><th>Name</th><th>Email</th><th>Level</th><th></th></tr></thead>
      <tbody>${ms.map(m => `<tr>
        <td>${esc(m.name)}</td><td>${esc(m.email)}</td>
        <td>${levelSelect("grade", `data-setlevel="${esc(m.uid)}"`, m.level || "basic")}</td>
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
    try { await S.store.setStudentLevel(uid, e.target.value); await refreshAdmin(); adminMsg("Level updated.", true); }
    catch (err) { adminMsg("Could not change the level: " + err.message); }
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

boot();
