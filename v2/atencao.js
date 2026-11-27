/* atencao.js: attention check (is the student looking at the screen?)
   Runs on the student's phone. No video or photo leaves the phone: only "looking / not looking" is sent. */
(function () {
  const MP = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
  const MODEL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
  const YAW = 30, PITCH = 32, GAZE = 0.55;
  const EYE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3.2" fill="currentColor"/></svg>';
  const el = id => document.getElementById(id);
  const esc2 = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  const st = document.createElement('style');
  st.textContent =
    '#attBox{position:absolute;top:10px;z-index:4;display:flex;gap:8px;align-items:center;background:rgba(15,23,42,.82);border-radius:999px;padding:6px 10px}' +
    '#attBox.hide{display:none}' +
    '.eye{display:inline-flex;align-items:center;gap:3px;color:#94a3b8;font-size:12px;font-weight:700}' +
    '.eye.g{color:#22c55e}.eye svg{width:22px;height:22px}' +
    '#attConsent{position:fixed;inset:0;background:#071d3df2;z-index:70;display:none;align-items:center;justify-content:center;padding:16px;font-family:system-ui,sans-serif}' +
    '#attConsent .b{background:#fff;color:#1a2238;border-radius:16px;padding:18px;max-width:420px}' +
    '#attConsent h2{margin:0 0 8px;color:#0b2a5b;font-size:20px}#attConsent ul{padding-left:18px;margin:8px 0}' +
    '#attConsent button{border:0;border-radius:10px;padding:11px 16px;font-size:15px;margin-right:8px}' +
    '#camv{position:fixed;left:0;top:0;width:2px;height:2px;opacity:0;pointer-events:none}';
  document.head.appendChild(st);

  const consent = () => { try { return localStorage.getItem('attConsent'); } catch (e) { return null; } };
  const setConsent = v => { try { localStorage.setItem('attConsent', v); } catch (e) {} };

  /* ============ STUDENT SIDE ============ */
  const A = { on: false, starting: false, lm: null, stream: null, timer: 0, hist: [], last: null, lastSent: 0, failedAt: 0, asked: false };

  function send(v, off) {
    if (typeof user === 'undefined' || !user) return;
    A.lastSent = Date.now();
    db.collection('alunos').doc(user.uid).set({ look: { v: !!v, t: Date.now(), off: !!off } }, { merge: true }).catch(() => {});
  }

  async function loadLm() {
    if (A.lm) return A.lm;
    const mod = await import(MP + '/vision_bundle.mjs');
    const fs = await mod.FilesetResolver.forVisionTasks(MP + '/wasm');
    const mk = d => mod.FaceLandmarker.createFromOptions(fs, {
      baseOptions: { modelAssetPath: MODEL, delegate: d }, runningMode: 'VIDEO', numFaces: 1,
      outputFaceBlendshapes: true, outputFacialTransformationMatrixes: true
    });
    try { A.lm = await mk('GPU'); } catch (e) { A.lm = await mk('CPU'); }
    return A.lm;
  }

  function judge(res) {
    if (!res || !res.faceLandmarks || !res.faceLandmarks.length) return false;
    const bs = {};
    ((res.faceBlendshapes && res.faceBlendshapes[0] && res.faceBlendshapes[0].categories) || []).forEach(c => { bs[c.categoryName] = c.score; });
    const m = res.facialTransformationMatrixes && res.facialTransformationMatrixes[0] && res.facialTransformationMatrixes[0].data;
    if (m) {
      const x = m[8], y = m[9], z = m[10];
      const yaw = Math.atan2(Math.abs(x), Math.abs(z)) * 180 / Math.PI;
      const pitch = Math.atan2(Math.abs(y), Math.hypot(x, z)) * 180 / Math.PI;
      if (yaw > YAW || pitch > PITCH) return false;
    }
    const g = n => bs[n] || 0;
    const right = (g('eyeLookInLeft') + g('eyeLookOutRight')) / 2;
    const left = (g('eyeLookOutLeft') + g('eyeLookInRight')) / 2;
    const up = (g('eyeLookUpLeft') + g('eyeLookUpRight')) / 2;
    const blink = (g('eyeBlinkLeft') + g('eyeBlinkRight')) / 2;
    if (Math.max(left, right) > GAZE || up > 0.6 || blink > 0.7) return false;
    return true;
  }

  function tick() {
    const v = el('camv');
    if (!A.on || !A.lm || !v || v.readyState < 2) return;
    let res;
    try { res = A.lm.detectForVideo(v, performance.now()); } catch (e) { return; }
    A.hist.push(judge(res) ? 1 : 0);
    if (A.hist.length > 8) A.hist.shift();
    if (A.hist.length < 4) return;
    const looking = A.hist.reduce((a, b) => a + b, 0) >= 5;
    if (looking !== A.last || Date.now() - A.lastSent > 6000) { A.last = looking; send(looking, false); }
  }

  async function start() {
    A.starting = true;
    try {
      A.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 320 }, height: { ideal: 240 }, frameRate: { ideal: 15 } }, audio: false });
    } catch (e) {
      A.starting = false; setConsent('no'); send(false, true);
      toast('Camera not allowed. Your teacher will not see the attention icon.'); return;
    }
    try {
      let v = el('camv');
      if (!v) { v = document.createElement('video'); v.id = 'camv'; v.setAttribute('playsinline', ''); v.muted = true; document.body.appendChild(v); }
      v.srcObject = A.stream; await v.play();
      await loadLm();
    } catch (e) {
      A.starting = false; A.failedAt = Date.now(); halt();
      toast('The attention check could not start on this phone.'); return;
    }
    A.on = true; A.starting = false; A.hist = []; A.last = null;
    A.timer = setInterval(tick, 250);
  }
  function halt() {
    clearInterval(A.timer); A.timer = 0;
    if (A.stream) { A.stream.getTracks().forEach(t => t.stop()); A.stream = null; }
    const v = el('camv'); if (v) v.srcObject = null;
  }
  function stop() {
    const was = A.on;
    halt(); A.on = false; A.starting = false; A.last = null; A.hist = [];
    if (was) send(false, true);
  }

  function askConsent() {
    if (!el('attConsent')) {
      const d = document.createElement('div'); d.id = 'attConsent';
      d.innerHTML = '<div class="b"><h2>Attention check</h2><p>During calls, your phone camera checks whether you are looking at the screen.</p>' +
        '<ul><li>No video or photo is recorded, saved or sent.</li><li>Your teacher only sees if you are looking at the screen or not.</li><li>You can turn it off at any time in the menu.</li></ul>' +
        '<button id="attYes" style="background:#143d78;color:#fff">Allow</button><button id="attNo" style="background:#e8f0fe;color:#0b2a5b">No thanks</button></div>';
      document.body.appendChild(d);
      el('attYes').onclick = () => { setConsent('yes'); d.style.display = 'none'; A.asked = false; };
      el('attNo').onclick = () => { setConsent('no'); d.style.display = 'none'; A.asked = false; };
    }
    A.asked = true; el('attConsent').style.display = 'flex';
  }

  function drawerSection() {
    const dr = el('drawer');
    if (!dr || el('attSec')) return;
    const s = document.createElement('div'); s.id = 'attSec';
    s.innerHTML = '<h3>Attention check</h3><p class="note" id="attTxt"></p><div class="row"><button class="s" id="attBtn"></button></div>';
    dr.appendChild(s);
    el('attBtn').onclick = () => {
      if (A.on || consent() === 'yes') { setConsent('no'); stop(); } else askConsent();
    };
  }
  function tag() {
    const cb = el('callbar');
    if (!cb) return;
    let t = el('attTag');
    if (!t) { t = document.createElement('span'); t.id = 'attTag'; t.style.cssText = 'font-size:12px;opacity:.8'; t.textContent = 'Attention check on'; cb.insertBefore(t, cb.firstChild.nextSibling); }
    t.style.display = A.on ? '' : 'none';
  }

  function studentLoop() {
    if (typeof pc === 'undefined') return;
    drawerSection(); tag();
    if (el('attTxt')) {
      const c = consent();
      el('attTxt').textContent = A.on ? 'On: your camera checks, on your phone only, whether you are looking at the screen.' : (c === 'yes' ? 'Ready: it starts automatically during calls.' : 'Off.');
      el('attBtn').textContent = (A.on || c === 'yes') ? 'Turn off' : 'Turn on';
    }
    const inCall = !!pc;
    if (inCall && !A.on && !A.starting && Date.now() - A.failedAt > 30000) {
      const c = consent();
      if (c === 'yes') start();
      else if (c !== 'no' && !A.asked) askConsent();
    }
    if (!inCall && (A.on || A.starting)) stop();
  }

  /* ============ TEACHER SIDE ============ */
  const looks = new Map();
  let first = true, tStarted = false;

  function renderEyes() {
    let box = el('attBox');
    const stage = el('stage');
    if (!stage) return;
    if (!box) { box = document.createElement('div'); box.id = 'attBox'; box.className = 'hide'; stage.appendChild(box); box.onclick = e => { const s = e.target.closest('.eye'); if (s) toast(s.title); }; }
    if (!roomId) { box.classList.add('hide'); return; }
    const uids = room.group ? (room.members || []) : (room.dm ? [room.dm] : []);
    const now = Date.now();
    const rows = uids.map(uid => {
      const s = (typeof students !== 'undefined' ? students : []).find(x => x.uid === uid) || {};
      const lk = looks.get(uid);
      const fresh = !!lk && !lk.off && now - lk.recv < 15000;
      const offRecent = !!lk && lk.off && lk.recv && now - lk.recv < 600000;
      return { name: s.name || s.email || '?', fresh, offRecent, on: fresh && lk.v };
    });
    box.innerHTML = rows.map(r =>
      '<span class="eye' + (r.on ? ' g' : '') + '" title="' + esc2(r.name) + ': ' + (r.on ? 'looking at the screen' : (r.fresh ? 'not looking' : 'camera off')) + '">' +
      EYE + (uids.length > 1 ? '<b>' + esc2((r.name || '?')[0].toUpperCase()) + '</b>' : '') + '</span>').join('');
    box.classList.toggle('hide', !rows.some(r => r.fresh || r.offRecent));
    /* place it right next to the topic */
    const t = el('topic'), sr = stage.getBoundingClientRect();
    if (t && !t.classList.contains('hide')) { const r = t.getBoundingClientRect(); box.style.left = (r.right - sr.left + 6) + 'px'; box.style.transform = 'none'; }
    else { box.style.left = '50%'; box.style.transform = 'translateX(-50%)'; }
  }

  function startTeacher() {
    tStarted = true;
    db.collection('alunos').onSnapshot(s => {
      const now = Date.now();
      s.docs.forEach(d => {
        const lk = d.data().look; if (!lk) return;
        const p = looks.get(d.id);
        if (!p) looks.set(d.id, { t: lk.t, v: !!lk.v, off: !!lk.off, recv: first ? 0 : now });
        else if (p.t !== lk.t) { p.t = lk.t; p.v = !!lk.v; p.off = !!lk.off; p.recv = now; }
      });
      first = false; renderEyes();
    });
    setInterval(renderEyes, 1500);
  }

  /* ============ START ============ */
  setInterval(() => {
    if (typeof user === 'undefined' || !user || typeof isT === 'undefined') return;
    if (isT) { if (!tStarted) startTeacher(); }
    else studentLoop();
  }, 1000);
})();
