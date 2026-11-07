/* Student dashboard: skills, score by test and history of tests. */
const wordFor = p => (p >= 75 ? "Strong" : p >= 50 ? "Good" : "Needs practice");
const shortDate = ms => (ms ? new Date(ms).toLocaleDateString() : "");

function skillBars(entries) {
  return Object.keys(SKILLS).map(k => {
    let sc = 0, tot = 0;
    entries.forEach(e => { const s = e.skills && e.skills[k]; if (s) { sc += s.score; tot += s.total; } });
    const pct = tot ? Math.round(sc / tot * 100) : null;
    return `<div style="margin:12px 0">
      <div class="row" style="justify-content:space-between"><b>${SKILLS[k]}</b>
        <span>${pct === null ? "–" : pct + "% · " + wordFor(pct)}</span></div>
      <div class="bar"><i style="width:${pct || 0}%"></i></div></div>`;
  }).join("");
}

function scoreChart(entries) {
  return `<div style="display:flex;gap:10px;align-items:flex-end;height:150px;overflow-x:auto;padding-top:20px">${
    entries.map(e => `<div style="flex:0 0 52px;text-align:center">
      <div style="font-size:12px"><b>${e.pct}%</b></div>
      <div style="height:${Math.max(4, e.pct)}px;background:var(--navy-700);border-radius:4px 4px 0 0"></div>
      <div class="muted" style="font-size:11px">${esc(shortDate(e.when))}</div></div>`).join("")}</div>`;
}

function testList(entries) {
  return [...entries].reverse().map((e, i) => `
    <div class="question">
      <div class="row" style="justify-content:space-between">
        <b>Test ${entries.length - i}${e.topic ? " · " + esc(e.topic) : ""} · ${esc(shortDate(e.when))}</b>
        <span><b>${e.pct}%</b> ${typeof e.passed === "boolean"
          ? `<span class="pill ${e.passed ? "ok" : "bad"}">${e.passed ? "Passed" : "Not passed"}</span>` : ""}</span>
      </div>
      ${e.skills ? `<p class="muted" style="margin:8px 0 0">${Object.keys(SKILLS).map(k => {
        const s = e.skills[k];
        return SKILLS[k] + " " + (s && s.total ? Math.round(s.score / s.total * 100) + "%" : "–");
      }).join(" · ")}</p>` : ""}
    </div>`).join("");
}

async function loadEntries() {
  const uid = S.session.uid;
  const [result, hist] = await Promise.all([S.store.getResult(uid), S.store.getMyHistory(uid)]);
  const entries = hist.filter(r => r.published === true).map(r => ({
    when: r.submittedAt || r.startedAt, pct: r.percentage, passed: r.passed, skills: r.skills,
    topic: r.topic, certType: r.certType, level: r.level
  }));
  if (result) entries.push({
    when: result.date, pct: result.percentage, passed: result.passed, skills: result.skills,
    topic: result.topic, certType: result.certType, level: result.level
  });
  entries.sort((a, b) => a.when - b.when);
  return entries;
}

async function renderDashboard() {
  const box = $("dashboard");
  try {
    const entries = await loadEntries();
    if (!entries.length) { show("dashboard", false); return; }
    box.innerHTML = `
      <h2>Your progress</h2>
      <h3>Your skills</h3>${skillBars(entries)}
      <h3>Score by test</h3>${scoreChart(entries)}
      <h3>Your tests</h3>${testList(entries)}`;
    show("dashboard");
  } catch (e) { show("dashboard", false); }
}

const baseShowStudent = showStudent;
showStudent = async function () {
  await baseShowStudent();
  renderDashboard();
};
