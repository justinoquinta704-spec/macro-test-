/* ring.js: incoming call screen on the home page + online heartbeat */
(function () {
  const TEACHER = 'justinoquinta704@gmail.com';
  const auth = firebase.auth(), db = firebase.firestore();
  const css = document.createElement('style');
  css.textContent = '#rg{position:fixed;inset:0;background:#071d3df2;color:#fff;z-index:99;display:none;flex-direction:column;align-items:center;justify-content:center;gap:18px;text-align:center;font-family:system-ui,sans-serif}' +
    '#rg h2{margin:0;font-size:28px}#rg .r{display:flex;gap:16px}#rg button{border:0;border-radius:12px;padding:14px 22px;font-size:17px;color:#fff}';
  document.head.appendChild(css);
  const box = document.createElement('div'); box.id = 'rg';
  box.innerHTML = '<div style="font-size:18px;opacity:.85">Incoming call</div><h2 id="rgn"></h2>' +
    '<div class="r"><button id="rgd" style="background:#b42318">Decline</button><button id="rga" style="background:#12805c">Answer</button></div>';
  document.body.appendChild(box);

  let actx = null, timer = null, cur = null;
  document.addEventListener('pointerdown', () => {
    if (!actx) { try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {} }
    if (actx && actx.state === 'suspended') actx.resume();
  });
  const beep = () => {
    if (actx) [0, 0.28].forEach((d, i) => {
      const o = actx.createOscillator(), g = actx.createGain();
      o.frequency.value = i ? 520 : 440; g.gain.value = 0.15; o.connect(g); g.connect(actx.destination);
      o.start(actx.currentTime + d); o.stop(actx.currentTime + d + 0.2);
    });
    if (navigator.vibrate) navigator.vibrate([300, 150, 300]);
  };
  const stop = () => { clearInterval(timer); timer = null; box.style.display = 'none'; cur = null; };

  document.getElementById('rga').onclick = () => {
    if (cur) location.href = 'sala.html?sala=' + encodeURIComponent(cur.roomId) + '&answer=1';
  };
  document.getElementById('rgd').onclick = () => {
    if (cur) db.collection('chamadas').doc(cur.id).update({ status: 'declined' }).catch(() => {});
    stop();
  };

  auth.onAuthStateChanged(u => {
    if (!u) return;
    const isT = (u.email || '').toLowerCase() === TEACHER;
    if (!isT) {
      const beat = () => db.collection('alunos').doc(u.uid).set({ seen: Date.now() }, { merge: true }).catch(() => {});
      beat(); setInterval(beat, 30000);
    }
    db.collection('chamadas').where('toUid', '==', isT ? 'teacher' : u.uid).where('status', '==', 'ringing').onSnapshot(s => {
      const c = s.docs.map(x => ({ id: x.id, ...x.data() })).filter(x => Date.now() - x.t < 60000).sort((a, b) => b.t - a.t)[0];
      if (!c) { stop(); return; }
      cur = c; document.getElementById('rgn').textContent = c.fromName; box.style.display = 'flex';
      if (!timer) { beep(); timer = setInterval(beep, 1600); }
    });
  });
})();
