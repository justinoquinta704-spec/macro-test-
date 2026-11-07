/* =====================================================================
   FINANCE: payments + receipts, and the register of issued certificates
   Used by the teacher panel (index.html) and by the student pages.
   ===================================================================== */
const NAVY = "#0b2a5b", BLUE = "#143d78", GREY = "#5b6785";
const SERIF = 'Georgia, "Times New Roman", "Noto Serif", serif';
const SANS = 'system-ui, "Segoe UI", Roboto, Arial, sans-serif';
const SIGNER = "Justino João Quinta";
const CERT_LABEL = { achievement: "Achievement", class: "Class", level: "Level completion", course: "Course completion" };

/* ---- database access (same Firebase app as the rest of the platform) ---- */
let _fb = null;
async function fb() {
  if (_fb) return _fb;
  const base = `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/`;
  const [A, F] = await Promise.all([import(base + "firebase-app.js"), import(base + "firebase-firestore.js")]);
  _fb = { F, db: F.getFirestore(A.getApp()) };
  return _fb;
}
async function listDocs(col, uid) {
  const { F, db } = await fb();
  const c = F.collection(db, col);
  const snap = await F.getDocs(uid ? F.query(c, F.where("uid", "==", uid)) : c);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}
async function getDocData(col, id) {
  const { F, db } = await fb();
  const s = await F.getDoc(F.doc(db, col, id));
  return s.exists() ? { id: s.id, ...s.data() } : null;
}
async function delDoc(col, id) {
  const { F, db } = await fb();
  await F.deleteDoc(F.doc(db, col, id));
}

/* ---- helpers ---- */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthIdx = ym => { const p = ym.split("-").map(Number); return p[0] * 12 + (p[1] - 1); };
const monthName = i => MONTHS[i % 12] + " " + Math.floor(i / 12);
function periodLabel(startMonth, n) {
  const a = monthIdx(startMonth), b = a + n - 1;
  return n === 1 ? monthName(a) : monthName(a) + " – " + monthName(b);
}
const fmtDay = ms => (ms ? new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "");
const fmtLong = ms => (ms ? new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }) : "");
const fmtMoney = (a, c) => Number(a).toLocaleString("en-US", { maximumFractionDigits: 2 }) + " " + c;
const safeName = s => String(s).replace(/[\\/:*?"<>|]+/g, "").trim();
function todayStr() {
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function makeCode() {
  const a = new Uint32Array(12);
  crypto.getRandomValues(a);
  const s = [...a].map(v => CODE_CHARS[v % CODE_CHARS.length]).join("");
  return s.slice(0, 4) + "-" + s.slice(4, 8) + "-" + s.slice(8);
}
async function nextNumber(kind) {
  const { F, db } = await fb();
  const r = F.doc(db, "counters", "main");
  const n = await F.runTransaction(db, async tx => {
    const s = await tx.get(r);
    const cur = (s.exists() && s.data()[kind]) || 0;
    tx.set(r, { [kind]: cur + 1 }, { merge: true });
    return cur + 1;
  });
  return (kind === "cert" ? "C-" : "R-") + new Date().getFullYear() + "-" + String(n).padStart(4, "0");
}

/* ---- issuing ---- */
async function issueCertificate(c) {
  const { F, db } = await fb();
  const r = F.doc(db, "certificados", c.uid + "_" + c.when);
  const s = await F.getDoc(r);
  if (s.exists()) {
    await F.setDoc(r, { pct: c.pct, passed: true, topic: c.topic, level: c.level, certType: c.certType, name: c.name }, { merge: true });
    return false;
  }
  await F.setDoc(r, { ...c, passed: true, number: await nextNumber("cert"), code: makeCode(), issuedAt: Date.now() });
  return true;
}
async function savePayment(p) {
  const { F, db } = await fb();
  const r = F.doc(F.collection(db, "pagamentos"));
  const number = await nextNumber("rec");
  await F.setDoc(r, { ...p, number, code: makeCode(), createdAt: Date.now() });
  return { id: r.id, number };
}

/* ---- canvas helpers shared by certificate and receipt ---- */
function kit(ctx) {
  const fitSize = (t, maxW, px, weight, style, family) => {
    let s = px;
    while (s > 30) {
      ctx.font = style + " " + weight + " " + s + "px " + family;
      if (ctx.measureText(t).width <= maxW) break;
      s -= 4;
    }
    return s;
  };
  const put = (t, x, y, px, o) => {
    o = o || {};
    ctx.font = (o.style || "normal") + " " + (o.weight || "normal") + " " + px + "px " + (o.family || SANS);
    ctx.fillStyle = o.color || NAVY; ctx.textAlign = o.align || "center"; ctx.textBaseline = "alphabetic";
    ctx.fillText(t, x, y);
  };
  const spaced = (t, x, y, px, gap, color) => {
    ctx.font = "normal 600 " + px + "px " + SANS;
    const ws = [...t].map(c => ctx.measureText(c).width);
    const total = ws.reduce((a, b) => a + b, 0) + gap * (ws.length - 1);
    let cx = x - total / 2;
    ctx.fillStyle = color; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    [...t].forEach((c, i) => { ctx.fillText(c, cx, y); cx += ws[i] + gap; });
  };
  const fitted = (t, x, y, maxW, px, weight, style, family, color, align) => {
    const s = fitSize(t, maxW, px, weight, style, family);
    put(t, x, y, s, { weight, style, family, color, align });
  };
  return { put, spaced, fitted };
}
function savePdf(cv, format, wmm, hmm, name) {
  if (!window.jspdf) { alert("The PDF tool did not load. Check your connection."); return; }
  const pdf = new window.jspdf.jsPDF({ orientation: "landscape", unit: "mm", format });
  pdf.addImage(cv.toDataURL("image/jpeg", 0.92), "JPEG", 0, 0, wmm, hmm);
  pdf.save(name + ".pdf");
}
function savePng(cv, name) {
  const a = document.createElement("a");
  a.href = cv.toDataURL("image/png"); a.download = name + ".png"; a.click();
}

/* =====================================================================
   TEACHER PANEL: Payments + Certificates tabs
   ===================================================================== */
const FIN = { pay: [], certs: [] };
const openBtn = href => `<a href="${href}" target="_blank" style="display:inline-block;padding:6px 12px;border-radius:8px;background:#143d78;color:#fff;text-decoration:none;font-size:13px">Open</a>`;

const PAY_HTML = `
<div id="tab-payments" class="hidden">
  <div class="card">
    <h3>Register a payment</h3>
    <label class="field" for="pStu">Student</label><select id="pStu"></select>
    <label class="field" for="pAmount">Amount paid</label><input id="pAmount" type="number" min="0" step="any" inputmode="decimal">
    <label class="field" for="pCur">Currency</label>
    <select id="pCur"><option value="AOA">AOA (Kz)</option><option value="USD">USD ($)</option><option value="EUR">EUR (€)</option></select>
    <label class="field" for="pMonths">Months paid</label><input id="pMonths" type="number" min="1" max="36" value="1">
    <label class="field" for="pStart">First month covered</label><input id="pStart" type="month">
    <label class="field" for="pDate">Payment date</label><input id="pDate" type="date">
    <label class="field" for="pMethod">Payment method</label>
    <select id="pMethod"><option>Cash</option><option>Bank transfer</option><option>Multicaixa Express</option><option>Unitel Money</option><option>Deposit</option><option>Other</option></select>
    <label class="field" for="pNote">Note (optional)</label><input id="pNote" type="text" maxlength="120" autocomplete="off">
    <div class="row"><button id="pSave">Save payment and issue receipt</button></div>
  </div>
  <div class="card"><h3>Payment status</h3><div id="payStatus" class="table-wrap"></div></div>
  <div class="card">
    <h3>Receipts issued <span id="recCount" class="muted"></span></h3>
    <input id="recSearch" type="text" placeholder="Search by name, number, code or method">
    <div id="recList" class="table-wrap"></div>
  </div>
</div>`;

const CERT_HTML = `
<div id="tab-certs" class="hidden">
  <div class="card">
    <h3>Certificates issued <span id="certCount" class="muted"></span></h3>
    <p class="muted">Certificates are issued when you press Grade and publish results.</p>
    <div class="row"><button id="certIssue" class="secondary">Issue missing certificates</button></div>
    <input id="certSearch" type="text" placeholder="Search by name, number, code or test">
    <div id="certList" class="table-wrap"></div>
  </div>
</div>`;

function ensureFinanceUI() {
  if ($("tab-payments")) return;
  const tabs = document.querySelector(".tabs");
  [["payments", "Payments"], ["certs", "Certificates"]].forEach(p => {
    const b = document.createElement("button");
    b.dataset.tab = p[0]; b.textContent = p[1]; b.onclick = () => switchTab(p[0]);
    tabs.appendChild(b);
  });
  const anchor = $("tab-results");
  const a = document.createElement("div"); a.innerHTML = PAY_HTML;
  const b = document.createElement("div"); b.innerHTML = CERT_HTML;
  anchor.parentNode.insertBefore(b.firstElementChild, anchor.nextSibling);
  anchor.parentNode.insertBefore(a.firstElementChild, anchor.nextSibling);

  $("pSave").onclick = savePaymentForm;
  $("recSearch").oninput = renderReceipts;
  $("certSearch").oninput = renderCerts;
  $("certIssue").onclick = async () => {
    try {
      await refreshAdmin();
      const n = await issueForPublished();
      await renderFinance();
      adminMsg(n ? n + " certificate(s) issued." : "Nothing new to issue.", true);
    } catch (e) { adminMsg("Could not issue certificates: " + (e.code || e.message)); }
  };
  $("recList").addEventListener("click", async e => {
    const x = e.target.closest("button"); if (!x || !x.dataset.recdel) return;
    if (!(await ask({ title: "Delete this receipt?", body: "This cannot be undone.", ok: "Delete", cancel: "Cancel" }))) return;
    try { await delDoc("pagamentos", x.dataset.recdel); await renderFinance(); adminMsg("Receipt deleted.", true); }
    catch (err) { adminMsg("Could not delete: " + (err.code || err.message)); }
  });
  $("certList").addEventListener("click", async e => {
    const x = e.target.closest("button"); if (!x || !x.dataset.certdel) return;
    if (!(await ask({ title: "Delete this certificate?", body: "The student will no longer see it.", ok: "Delete", cancel: "Cancel" }))) return;
    try { await delDoc("certificados", x.dataset.certdel); await renderFinance(); adminMsg("Certificate deleted.", true); }
    catch (err) { adminMsg("Could not delete: " + (err.code || err.message)); }
  });
}

function fillPayForm(keep) {
  if (!$("pStu")) return;
  const cur = $("pStu").value;
  const ms = [...S.admin.data.members].sort((a, b) => a.name.localeCompare(b.name));
  $("pStu").innerHTML = '<option value="">Choose a student…</option>' + ms.map(m => `<option value="${esc(m.uid)}">${esc(m.name)}</option>`).join("");
  if (keep && cur) $("pStu").value = cur;
  if (!$("pDate").value) { const t = todayStr(); $("pDate").value = t; $("pStart").value = t.slice(0, 7); }
}

async function savePaymentForm() {
  const uid = $("pStu").value, amount = Number($("pAmount").value), months = Math.round(Number($("pMonths").value));
  const start = $("pStart").value, date = $("pDate").value;
  if (!uid) { adminMsg("Choose a student."); return; }
  if (!(amount > 0)) { adminMsg("Enter the amount paid."); return; }
  if (!(months >= 1 && months <= 36)) { adminMsg("Months paid must be between 1 and 36."); return; }
  if (!start) { adminMsg("Choose the first month covered."); return; }
  if (!date) { adminMsg("Choose the payment date."); return; }
  const m = S.admin.data.members.find(x => x.uid === uid);
  $("pSave").disabled = true;
  try {
    const r = await savePayment({
      uid, name: m ? m.name : "", amount, currency: $("pCur").value, months, startMonth: start,
      paidOn: new Date(date + "T12:00:00").getTime(), method: $("pMethod").value, note: $("pNote").value.trim()
    });
    $("pAmount").value = ""; $("pNote").value = "";
    await renderFinance();
    adminMsg("Payment saved. Receipt " + r.number + " issued. Open it from the list below.", true);
  } catch (e) {
    adminMsg("Could not save the payment: " + (e.code || e.message));
  } finally { $("pSave").disabled = false; }
}

function renderStatus() {
  const now = new Date(), cur = now.getFullYear() * 12 + now.getMonth();
  const ms = [...S.admin.data.members].sort((a, b) => a.name.localeCompare(b.name));
  const by = {};
  FIN.pay.forEach(p => {
    const end = monthIdx(p.startMonth) + p.months - 1;
    const o = by[p.uid] || (by[p.uid] = { end: -1, last: 0 });
    if (end > o.end) o.end = end;
    if (p.paidOn > o.last) o.last = p.paidOn;
  });
  $("payStatus").innerHTML = ms.length ? `<table><thead><tr><th>Student</th><th>Paid until</th><th>Status</th><th>Last payment</th></tr></thead><tbody>${
    ms.map(m => {
      const o = by[m.uid];
      let label, cls;
      if (!o) { label = "No payments"; cls = "bad"; }
      else if (o.end >= cur) { label = "Up to date"; cls = "ok"; }
      else { const late = cur - o.end; label = "Overdue (" + late + " month" + (late > 1 ? "s" : "") + ")"; cls = "bad"; }
      return `<tr><td>${esc(m.name)}</td><td>${o ? monthName(o.end) : "–"}</td><td><span class="pill ${cls}">${label}</span></td><td>${o ? fmtDay(o.last) : "–"}</td></tr>`;
    }).join("")}</tbody></table>` : "<p>No students yet.</p>";
}

function renderReceipts() {
  const q = ($("recSearch").value || "").trim().toLowerCase();
  const list = FIN.pay.filter(p => !q || [p.name, p.number, p.code, p.method].some(v => String(v || "").toLowerCase().includes(q)))
    .sort((a, b) => b.createdAt - a.createdAt);
  $("recCount").textContent = FIN.pay.length ? "(" + FIN.pay.length + ")" : "";
  $("recList").innerHTML = list.length ? `<table><thead><tr><th>Number</th><th>Student</th><th>Amount</th><th>Period</th><th>Paid on</th><th>Method</th><th>Code</th><th></th></tr></thead><tbody>${
    list.map(p => `<tr><td>${esc(p.number)}</td><td>${esc(p.name)}</td><td>${esc(fmtMoney(p.amount, p.currency))}</td>
      <td>${esc(periodLabel(p.startMonth, p.months))}</td><td>${esc(fmtDay(p.paidOn))}</td><td>${esc(p.method)}</td><td>${esc(p.code)}</td>
      <td><div class="row">${openBtn("recibo.html?id=" + encodeURIComponent(p.id))}<button class="danger small" data-recdel="${esc(p.id)}">Delete</button></div></td></tr>`).join("")}</tbody></table>`
    : "<p>No receipts yet.</p>";
}

function renderCerts() {
  const q = ($("certSearch").value || "").trim().toLowerCase();
  const list = FIN.certs.filter(c => !q || [c.name, c.number, c.code, c.topic].some(v => String(v || "").toLowerCase().includes(q)))
    .sort((a, b) => b.when - a.when);
  $("certCount").textContent = FIN.certs.length ? "(" + FIN.certs.length + ")" : "";
  $("certList").innerHTML = list.length ? `<table><thead><tr><th>Number</th><th>Student</th><th>Type</th><th>Test</th><th>Score</th><th>Date</th><th>Code</th><th></th></tr></thead><tbody>${
    list.map(c => `<tr><td>${esc(c.number)}</td><td>${esc(c.name)}</td><td>${esc(CERT_LABEL[c.certType] || c.certType)}</td>
      <td>${esc(c.topic || "")}</td><td>${esc(c.pct)}%</td><td>${esc(fmtDay(c.when))}</td><td>${esc(c.code)}</td>
      <td><div class="row">${openBtn("certificado.html?id=" + encodeURIComponent(c.id))}<button class="danger small" data-certdel="${esc(c.id)}">Delete</button></div></td></tr>`).join("")}</tbody></table>`
    : "<p>No certificates issued yet.</p>";
}

async function renderFinance() {
  try {
    FIN.pay = await listDocs("pagamentos");
    FIN.certs = await listDocs("certificados");
    renderStatus(); renderReceipts(); renderCerts();
  } catch (e) {
    adminMsg("Could not load payments and certificates (" + (e.code || e.message) + "). Check that the new Firestore rules were published.");
  }
}

/* issues a certificate for every published, passed result that has none yet */
async function issueForPublished() {
  const d = S.admin.data;
  if (!d) return 0;
  const names = new Map(d.members.map(m => [m.uid, m.name]));
  let n = 0;
  for (const r of d.results) {
    if (r.passed !== true) continue;
    const type = r.certType || "achievement";
    if (type === "none") continue;
    const when = r.date || r.submittedAt;
    if (!when) continue;
    const made = await issueCertificate({
      uid: r.uid, name: names.get(r.uid) || r.username || "", certType: type,
      topic: r.topic || "", level: r.level || "basic", pct: r.percentage, when
    });
    if (made) n++;
  }
  return n;
}

/* ---- hooks into the existing teacher panel (only on the main page) ---- */
if (document.getElementById("view-admin")) {
  try {
    const baseSwitch = switchTab;
    switchTab = function (name) {
      document.querySelectorAll(".tabs button").forEach(b => b.classList.toggle("active", b.dataset.tab === name));
      ["questions", "students", "settings", "results", "payments", "certs"].forEach(t => { if ($("tab-" + t)) show("tab-" + t, t === name); });
      if (name === "payments") { fillPayForm(true); renderFinance(); }
      if (name === "certs") renderFinance();
    };
  } catch (e) { console.warn("switchTab hook failed", e); }

  try {
    const baseShowAdmin = showAdmin;
    showAdmin = async function () {
      await baseShowAdmin();
      try { ensureFinanceUI(); fillPayForm(); await renderFinance(); }
      catch (e) { adminMsg("Payments could not load: " + (e.code || e.message)); }
    };
  } catch (e) { console.warn("showAdmin hook failed", e); }

  try {
    const basePublish = publishResults;
    publishResults = async function () {
      await basePublish.apply(this, arguments);
      try {
        await refreshAdmin();
        const n = await issueForPublished();
        await renderFinance();
        if (n) adminMsg(n + " certificate(s) issued.", true);
      } catch (e) { adminMsg("Could not issue certificates: " + (e.code || e.message)); }
    };
  } catch (e) { console.warn("publishResults hook failed", e); }
}
