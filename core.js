/* =====================================================================
   CONFIGURATION
   - Leave FIREBASE_CONFIG as null to run in demo mode (data stays in this
     browser only). Paste your Firebase web config to go online.
   - ADMIN_EMAIL must match the email used in firestore.rules.
   ===================================================================== */
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyDuRlsZ_W0go3KwcA74cMN0VthnYxmHEYs",
  authDomain: "school-of-communicators.firebaseapp.com",
  projectId: "school-of-communicators",
  storageBucket: "school-of-communicators.firebasestorage.app",
  messagingSenderId: "601098815550",
  appId: "1:601098815550:web:b8c0f6a59a9835e6e4a96f"
};
const ADMIN_EMAIL = "justinoquinta704@gmail.com";
const DEMO_ADMIN = { email: "admin@demo", password: "demo123" };

const FIREBASE_VERSION = "10.12.2";
const GRACE_MS = 90 * 1000; // must match the grace period in firestore.rules
const DEFAULTS = { durationMin: 30, maxWarnings: 2, shuffleQuestions: true, shuffleOptions: true };
const LETTERS = "ABCD";

/* =====================================================================
   HELPERS
   ===================================================================== */
const $ = id => document.getElementById(id);
const show = (id, on = true) => $(id).classList.toggle("hidden", !on);

const esc = v => String(v ?? "").replace(/[&<>"']/g, c => (
  { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
));

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const newId = () => "q" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const fmtDate = ms => (ms ? new Date(ms).toLocaleString() : "");

function fmtClock(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0");
}

async function hashPassword(pw) {
  if (globalThis.crypto?.subtle) {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("macro:" + pw));
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
  }
  return "plain:" + pw;
}

/* Modal dialog that returns a promise (true = OK, false = cancel). */
let pendingModal = null;
function closeModal(result = false) {
  show("modal", false);
  if (pendingModal) { pendingModal(result); pendingModal = null; }
}
function ask({ title, body, ok = "OK", cancel = null }) {
  closeModal(false);
  return new Promise(resolve => {
    $("modalTitle").textContent = title;
    $("modalBody").textContent = body;
    $("modalOk").textContent = ok;
    $("modalCancel").textContent = cancel || "Cancel";
    show("modalCancel", !!cancel);
    show("modal");
    pendingModal = resolve;
    $("modalOk").focus();
  });
}
$("modalOk").onclick = () => closeModal(true);
$("modalCancel").onclick = () => closeModal(false);

/* =====================================================================
   STORAGE: DEMO MODE (localStorage, this browser only)
   ===================================================================== */
function createDemoStore() {
  const KEY = "macro_demo_db_v2", SKEY = "macro_demo_session_v2";
  const empty = () => ({
    users: {}, settings: { ...DEFAULTS, questionCount: 0 },
    questions: [], keys: {}, attempts: {}, submissions: {}, results: {}
  });
  const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || empty(); } catch { return empty(); } };
  const save = db => localStorage.setItem(KEY, JSON.stringify(db));
  const setSession = s => { sessionStorage.setItem(SKEY, JSON.stringify(s)); return s; };

  return {
    mode: "demo",
    async init() { try { return JSON.parse(sessionStorage.getItem(SKEY)); } catch { return null; } },

    async loginStudent(username, password) {
      const db = load(), id = "u_" + username.toLowerCase(), h = await hashPassword(password);
      if (password.length < 6) throw new Error("Password must have at least 6 characters.");
      if (!db.users[id]) { db.users[id] = { username, hash: h }; save(db); }
      else if (db.users[id].hash !== h) throw new Error("Incorrect password.");
      return setSession({ uid: id, username, role: "student" });
    },
    async loginAdmin(email, password) {
      if (email !== DEMO_ADMIN.email || password !== DEMO_ADMIN.password)
        throw new Error("Incorrect administrator credentials.");
      return setSession({ uid: "admin", username: "Administrator", role: "admin" });
    },
    async logout() { sessionStorage.removeItem(SKEY); },

    async getSettings() { return { ...DEFAULTS, questionCount: 0, ...load().settings }; },
    async saveSettings(s) { const db = load(); db.settings = { ...db.settings, ...s }; save(db); },

    async getQuestions({ withKeys }) {
      const db = load();
      return db.questions.map(q => (withKeys ? { ...q, correct: db.keys[q.id] } : { ...q }));
    },
    async saveQuestion(q) {
      const db = load(), { correct, ...pub } = q;
      const i = db.questions.findIndex(x => x.id === q.id);
      if (i >= 0) db.questions[i] = pub; else db.questions.push(pub);
      db.keys[q.id] = correct;
      save(db);
    },
    async deleteQuestion(id) {
      const db = load();
      db.questions = db.questions.filter(q => q.id !== id);
      delete db.keys[id];
      save(db);
    },

    async getAttempt(uid) { return load().attempts[uid] || null; },
    async startAttempt(uid, username) {
      const db = load();
      if (db.attempts[uid]) throw new Error("You already started this test.");
      db.attempts[uid] = { uid, username, startedAt: Date.now(), order: [], perms: {}, draft: {}, warnings: 0 };
      save(db);
      return db.attempts[uid];
    },
    async patchAttempt(uid, patch) {
      const db = load();
      if (db.submissions[uid] || !db.attempts[uid]) return;
      Object.assign(db.attempts[uid], patch);
      save(db);
    },
    async submit(uid, sub) {
      const db = load();
      if (db.submissions[uid]) throw new Error("This test was already submitted.");
      const a = db.attempts[uid];
      const limit = a.startedAt + (db.settings.durationMin || DEFAULTS.durationMin) * 60000 + GRACE_MS;
      if (Date.now() > limit) throw new Error("Time is over.");
      db.submissions[uid] = { uid, ...sub, submittedAt: Date.now() };
      save(db);
    },
    async getSubmission(uid) { return load().submissions[uid] || null; },
    async getResult(uid) { return load().results[uid] || null; },

    async loadAdminData() {
      const db = load();
      return {
        questions: await this.getQuestions({ withKeys: true }),
        attempts: Object.values(db.attempts),
        submissions: Object.values(db.submissions),
        results: Object.values(db.results)
      };
    },
    async publishResults(list) { const db = load(); list.forEach(r => { db.results[r.uid] = r; }); save(db); },
    async resetStudent(uid) {
      const db = load();
      delete db.attempts[uid]; delete db.submissions[uid]; delete db.results[uid];
      save(db);
    }
  };
}
