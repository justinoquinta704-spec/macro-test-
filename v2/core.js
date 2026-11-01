/* =====================================================================
   CONFIGURATION
   ADMIN_EMAIL must match the email used in the Firestore rules.
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

const FIREBASE_VERSION = "10.12.2";
const GRACE_MS = 90 * 1000; // must match the grace period in the rules
const DEFAULTS = { durationMin: 30, maxWarnings: 2, shuffleQuestions: true, shuffleOptions: true };
const LETTERS = "ABCD";
const MAX_AUDIO_CHARS = 880000; // Firestore documents are limited to 1 MiB
const MAX_AUDIO_SEC = 120;
const TYPE_LABEL = { mcq: "Multiple choice", text: "Written", audio: "Audio" };

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
const genCode = () => Array.from({ length: 6 }, () =>
  "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[Math.floor(Math.random() * 32)]).join("");
const fmtDate = ms => (ms ? new Date(ms).toLocaleString() : "");
const fmtScore = n => (Number.isInteger(n) ? String(n) : n.toFixed(1));

function fmtClock(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0");
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
