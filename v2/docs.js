/* docs.js: Google-Docs-style text on the board.
   Bold, italic, underline, colour, highlight, size, alignment, bullet and numbered lists, headings.
   Loaded by sala.html. It replaces the text functions of the board. */
(function () {
  if (typeof layoutText !== 'function' || typeof textBox !== 'function' || typeof drawEditFrame !== 'function' ||
      typeof eraseTextChars !== 'function' || typeof syncText !== 'function' || typeof startText !== 'function') {
    console.warn('docs.js: sala.html is not the expected version'); return;
  }

  const DEF = { b: 0, i: 0, u: 0, c: 0, h: 0, z: 1 };
  const HM = [1, 1.7, 1.4, 1.2];
  const SIZES = [0.7, 0.85, 1, 1.25, 1.5, 2, 2.5];
  const COLS = ['#e11d48', '#16a34a', '#2563eb'];
  const HIL = ['#fde047', '#86efac', '#f9a8d4'];
  const wc = new Map();
  let pend = null, pendAt = -1, last = '';
  const sameSt = (a, b) => a.b === b.b && a.i === b.i && a.u === b.u && a.c === b.c && a.h === b.h && a.z === b.z;
  const fontFor = (st, size, hd) => (st.i ? 'italic ' : '') + ((st.b || hd) ? '700 ' : '500 ') + size + 'px ' + FONT;

  function charW(g, font, ch) {
    const k = font + '|' + ch;
    let w = wc.get(k);
    if (w === undefined) { g.font = font; w = g.measureText(ch).width; wc.set(k, w); }
    return w;
  }

  /* per-character styles, rebuilt from the saved "runs" */
  function csOf(it) {
    const len = String(it.text || '').length;
    if (Array.isArray(it.cs)) { while (it.cs.length < len) it.cs.push(DEF); return it.cs; }
    if (it._cs && it._cs.len === len && it._cs.runs === it.runs) return it._cs.a;
    const a = [];
    (it.runs || []).forEach(r => {
      const st = { b: r.b || 0, i: r.i || 0, u: r.u || 0, c: r.c || 0, h: r.h || 0, z: r.z || 1 };
      for (let k = 0; k < r.n && a.length < len; k++) a.push(st);
    });
    while (a.length < len) a.push(DEF);
    it._cs = { a, len, runs: it.runs };
    return a;
  }

  /* paragraphs, words wrapped to the width of the text field */
  function layoutRich(it, pw, g) {
    g = g || ctx;
    const text = String(it.text || ''), base = Math.max(6, it.size * pw), cs = csOf(it), paras = it.paras || [];
    const boxW = it.w ? it.w * pw : 0;
    const lines = []; let y = 0, ps = 0, num = 0;
    text.split('\n').forEach((para, pi) => {
      const pr = paras[pi] || {}, hd = pr.hd || 0, ls = pr.l || 0, al = pr.a || 'l', hm = HM[hd] || 1;
      num = ls === 2 ? num + 1 : 0;
      const indent = ls ? base * 1.5 : 0, avail = boxW ? Math.max(base, boxW - indent) : Infinity;
      const chars = [];
      for (let k = 0; k < para.length; k++) {
        const c0 = para.charCodeAt(k);
        const len = (c0 >= 0xD800 && c0 < 0xDC00 && k + 1 < para.length) ? 2 : 1;
        const ch = para.substr(k, len), st = cs[ps + k] || DEF, size = base * hm * (st.z || 1), font = fontFor(st, size, hd);
        chars.push({ gi: ps + k, len, ch, st, size, font, w: charW(g, font, ch) });
        k += len - 1;
      }
      const segs = []; let start = 0, cur = 0, lastSp = -1;
      for (let k = 0; k < chars.length; k++) {
        if (chars[k].ch === ' ') lastSp = k;
        cur += chars[k].w;
        if (cur > avail && k > start) {
          const end = lastSp >= start ? lastSp + 1 : k;
          segs.push([start, end]); start = end; cur = 0; lastSp = -1;
          for (let q = start; q <= k; q++) { cur += chars[q].w; if (chars[q].ch === ' ') lastSp = q; }
        }
      }
      segs.push([start, chars.length]);
      segs.forEach((sg, si) => {
        const lc = chars.slice(sg[0], sg[1]);
        const size = lc.length ? Math.max(...lc.map(c => c.size)) : base * hm;
        const w = lc.reduce((a, c) => a + c.w, 0);
        let wt = w;
        for (let q = lc.length - 1; q >= 0 && lc[q].ch === ' '; q--) wt -= lc[q].w;
        const s = sg[0] < chars.length ? chars[sg[0]].gi : ps + para.length;
        const e = lc.length ? lc[lc.length - 1].gi + lc[lc.length - 1].len : s;
        lines.push({ s, e, chars: lc, w, wt, h: size * 1.25, y, indent, al, first: si === 0, ls, num, hd, size, base });
        y += size * 1.25;
      });
      ps += para.length + 1;
    });
    return { base, lines, h: y, boxW };
  }

  function lineX(L, ln) {
    const avail = L.boxW ? Math.max(0, L.boxW - ln.indent) : 0;
    let off = 0;
    if (avail) off = ln.al === 'c' ? (avail - ln.wt) / 2 : (ln.al === 'r' ? avail - ln.wt : 0);
    return ln.indent + Math.max(0, off);
  }

  textBox = function (it, x0, y0, pw, ph) {
    const L = layoutRich(it, pw);
    const w = L.boxW || Math.max(L.base * 2, ...L.lines.map(l => l.indent + l.w));
    return { x: x0 + it.x * pw, y: y0 + it.y * ph, w, h: Math.max(L.h, L.base * 1.25), L };
  };
  hitText = function (it, x, y, x0, y0, pw, ph) {
    const b = textBox(it, x0, y0, pw, ph);
    return x >= b.x - 12 && x <= b.x + b.w + 12 && y >= b.y - 12 && y <= b.y + b.h + 12;
  };
  indexAt = function (it, x, y, x0, y0, pw, ph) {
    const b = textBox(it, x0, y0, pw, ph), L = b.L;
    let ln = L.lines[0];
    L.lines.forEach(l => { if (y - b.y >= l.y) ln = l; });
    if (!ln) return 0;
    let cx = b.x + lineX(L, ln);
    for (const c of ln.chars) { if (x < cx + c.w / 2) return c.gi; cx += c.w; }
    return ln.e;
  };

  drawItem = function (it, x0, y0, pw, ph, isEdit, c) {
    const g = c || ctx, col = inkColor(it.color);
    if (it.kind === 'text') {
      const L = layoutRich(it, pw, g), tx = x0 + it.x * pw, ty = y0 + it.y * ph;
      g.textAlign = 'left'; g.textBaseline = 'alphabetic';
      L.lines.forEach(ln => {
        const lx = tx + lineX(L, ln), by = ty + ln.y + ln.size;
        if (ln.first && ln.ls) {
          g.font = '500 ' + L.base + 'px ' + FONT; g.fillStyle = col; g.textAlign = 'right';
          g.fillText(ln.ls === 1 ? '\u2022' : ln.num + '.', tx + ln.indent - L.base * 0.35, by);
          g.textAlign = 'left';
        }
        let k = 0, x = lx;
        while (k < ln.chars.length) {
          const st = ln.chars[k].st, size = ln.chars[k].size;
          let j = k, w = 0, str = '';
          while (j < ln.chars.length && sameSt(ln.chars[j].st, st) && ln.chars[j].size === size) { w += ln.chars[j].w; str += ln.chars[j].ch; j++; }
          if (st.h) { g.fillStyle = st.h; g.fillRect(x, ty + ln.y, w, ln.h); }
          g.font = ln.chars[k].font; g.fillStyle = st.c ? st.c : col; g.fillText(str, x, by);
          if (st.u) g.fillRect(x, by + size * 0.12, w, Math.max(1, size * 0.07));
          x += w; k = j;
        }
      });
      return;
    }
    const paths = it.paths || (it.pts ? [it.pts] : []);
    g.strokeStyle = col; g.lineWidth = Math.max(1, it.size * pw); g.lineCap = g.lineJoin = 'round';
    for (const p of paths) {
      if (!p || p.length < 2) continue;
      g.beginPath(); g.moveTo(x0 + p[0] * pw, y0 + p[1] * ph);
      if (p.length === 2) g.lineTo(x0 + p[0] * pw + 0.1, y0 + p[1] * ph);
      for (let i = 2; i + 1 < p.length; i += 2) g.lineTo(x0 + p[i] * pw, y0 + p[i + 1] * ph);
      g.stroke();
    }
  };

  const selA = () => Math.min(kb.selectionStart, kb.selectionEnd);
  const selB = () => Math.max(kb.selectionStart, kb.selectionEnd);

  drawEditFrame = function (x0, y0, pw, ph) {
    const e = editing, b = textBox(e, x0, y0, pw, ph), L = b.L;
    const fx = b.x - 6, fy = b.y - 4, fw = b.w + 12, fh = b.h + 8;
    const a = selA(), z = selB();
    ctx.save();
    if (z > a) {
      ctx.fillStyle = 'rgba(59,130,246,.32)';
      L.lines.forEach(ln => {
        let cx = b.x + lineX(L, ln), x1 = null, x2 = 0;
        ln.chars.forEach(c => {
          if (c.gi >= a && c.gi < z) { if (x1 === null) x1 = cx; x2 = cx + c.w; }
          cx += c.w;
        });
        if (x1 !== null) ctx.fillRect(x1, b.y + ln.y, x2 - x1, ln.h);
      });
    }
    ctx.strokeStyle = '#3b82f6'; ctx.lineWidth = 1.5; ctx.setLineDash([6, 4]); ctx.strokeRect(fx, fy, fw, fh); ctx.setLineDash([]);
    handlePos = { x: fx + fw, y: fy + fh / 2 };
    ctx.fillStyle = '#3b82f6'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(handlePos.x, handlePos.y, 9, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    if (z === a && Math.floor(Date.now() / 500) % 2 === 0) {
      const idx = clamp(a, 0, e.text.length);
      let ln = L.lines[0];
      L.lines.forEach(l => { if (l.s <= idx) ln = l; });
      let cx = b.x + lineX(L, ln);
      for (const c of ln.chars) { if (c.gi < idx) cx += c.w; }
      ctx.fillStyle = inkColor(e.color); ctx.fillRect(cx, b.y + ln.y, Math.max(2, ln.base * 0.06), ln.h);
    }
    ctx.restore();
  };

  /* the gradual eraser: only the touched letters become blank */
  eraseTextChars = function (it, x, y, x0, y0, pw, ph, r) {
    const b = textBox(it, x0, y0, pw, ph), L = b.L;
    if (x < b.x - r || x > b.x + b.w + r || y < b.y - r || y > b.y + b.h + r) return null;
    const chars = String(it.text || '').split('');
    let hit = false;
    L.lines.forEach(ln => {
      const ty = b.y + ln.y;
      if (y + r < ty || y - r > ty + ln.h) return;
      let cx = b.x + lineX(L, ln);
      ln.chars.forEach(c => {
        if (c.ch !== ' ') {
          const nx = Math.max(cx, Math.min(x, cx + c.w)), ny = Math.max(ty, Math.min(y, ty + ln.h));
          if (Math.hypot(x - nx, y - ny) <= r) { for (let q = 0; q < c.len; q++) chars[c.gi + q] = ' '; hit = true; }
        }
        cx += c.w;
      });
    });
    return hit ? chars.join('') : null;
  };

  /* ---- saving: styles go in "runs", paragraph settings in "paras" ---- */
  function toRuns(e) {
    const cs = csOf(e), len = e.text.length, out = [];
    let cur = null;
    for (let k = 0; k < len; k++) {
      const s = cs[k] || DEF;
      if (cur && sameSt(cur.s, s)) cur.n++; else { cur = { s, n: 1 }; out.push(cur); }
    }
    const runs = out.map(o => {
      const r = { n: o.n };
      if (o.s.b) r.b = 1; if (o.s.i) r.i = 1; if (o.s.u) r.u = 1;
      if (o.s.c) r.c = o.s.c; if (o.s.h) r.h = o.s.h; if (o.s.z && o.s.z !== 1) r.z = o.s.z;
      return r;
    });
    return runs.every(r => Object.keys(r).length === 1) ? [] : runs;
  }
  function toParas(e) {
    const n = e.text.split('\n').length, ps = [];
    for (let i = 0; i < n; i++) {
      const p = (e.paras || [])[i] || {}, o = {};
      if (p.a && p.a !== 'l') o.a = p.a;
      if (p.l) o.l = p.l;
      if (p.hd) o.hd = p.hd;
      ps.push(o);
    }
    return ps;
  }
  syncText = async function () {
    const e = editing; if (!e || !roomId) return;
    const ref = roomsCol().doc(roomId).collection('strokes').doc(e.id);
    try {
      if (!e.text.trim()) { if (e.created) { await ref.delete(); e.created = false; } return; }
      await ref.set({
        kind: 'text', page: e.page, color: e.color, size: e.size, x: +e.x.toFixed(4), y: +e.y.toFixed(4), w: +(e.w || 0).toFixed(4),
        text: e.text, runs: toRuns(e), paras: toParas(e), uid: e.uid, t: e.t
      });
      e.created = true;
    } catch (err) { toast('Could not save text: ' + (err.code || err.message)); }
  };

  /* ---- start / keep the styles in step with typing ---- */
  const baseStartText = startText, baseStartEdit = startEdit;
  startText = function (x, y) {
    baseStartText(x, y);
    if (editing) { editing.cs = []; editing.paras = [{}]; last = ''; pend = null; }
  };
  startEdit = function (t, idx) {
    baseStartEdit(t, idx);
    if (editing) {
      editing.cs = csOf(t).slice(0, String(t.text || '').length);
      editing.paras = (t.paras || []).map(p => ({ ...p }));
      last = editing.text || ''; pend = null;
    }
  };
  function reconcile(ot, nt) {
    const cs = editing.cs || (editing.cs = []);
    while (cs.length < ot.length) cs.push(DEF);
    cs.length = ot.length;
    let p = 0; const ml = Math.min(ot.length, nt.length);
    while (p < ml && ot[p] === nt[p]) p++;
    let so = ot.length, sn = nt.length;
    while (so > p && sn > p && ot[so - 1] === nt[sn - 1]) { so--; sn--; }
    const removed = ot.slice(p, so), inserted = nt.slice(p, sn);
    let st = { ...(cs[p - 1] || cs[p] || DEF) };
    if (pend) st = { ...st, ...pend };
    cs.splice(p, removed.length, ...Array.from({ length: inserted.length }, () => ({ ...st })));
    const paras = editing.paras || (editing.paras = [{}]);
    const pi = ot.slice(0, p).split('\n').length - 1;
    const rn = (removed.match(/\n/g) || []).length, inn = (inserted.match(/\n/g) || []).length;
    if (rn) paras.splice(pi + 1, rn);
    for (let k = 0; k < inn; k++) paras.splice(pi + 1, 0, { ...(paras[pi] || {}), hd: 0 });
    if (inserted.length) pend = null;
  }
  kb.addEventListener('input', () => {
    if (!editing) return;
    reconcile(last, kb.value); last = kb.value;
  });

  /* ---- formatting actions ---- */
  const paraAt = i => editing.text.slice(0, i).split('\n').length - 1;
  const paraProps = i => (editing.paras || [])[paraAt(i)] || {};
  function curStyle() {
    if (!editing) return DEF;
    const cs = csOf(editing), a = selA(), b = selB();
    let st = a < b ? (cs[a] || DEF) : (cs[a - 1] || cs[a] || DEF);
    if (pend && pendAt !== a) pend = null;
    if (a === b && pend) st = { ...st, ...pend };
    return st;
  }
  function bump() {
    draw();
    clearTimeout(textTimer); textTimer = setTimeout(syncText, 350);
    refreshBar();
  }
  function patchStyle(patch) {
    const a = selA(), b = selB();
    if (a === b) { pend = { ...(pend || {}), ...patch }; pendAt = a; return; }
    const cs = csOf(editing);
    for (let k = a; k < b; k++) cs[k] = { ...(cs[k] || DEF), ...patch };
  }
  function patchPara(patch) {
    const ps = editing.paras || (editing.paras = []);
    const total = editing.text.split('\n').length;
    while (ps.length < total) ps.push({});
    for (let p = paraAt(selA()); p <= paraAt(selB()); p++) ps[p] = { ...(ps[p] || {}), ...patch };
  }
  function act(a) {
    if (!editing) return;
    const st = curStyle();
    if (a === 'b') patchStyle({ b: st.b ? 0 : 1 });
    else if (a === 'i') patchStyle({ i: st.i ? 0 : 1 });
    else if (a === 'u') patchStyle({ u: st.u ? 0 : 1 });
    else if (a[0] === 'c' && a.length === 2) patchStyle({ c: a === 'c0' ? 0 : COLS[+a[1] - 1] });
    else if (a[0] === 'h' && a.length === 2) patchStyle({ h: a === 'h0' ? 0 : HIL[+a[1] - 1] });
    else if (a === 'z-' || a === 'z+') {
      let k = 0, best = 99;
      SIZES.forEach((v, q) => { const d = Math.abs(v - (st.z || 1)); if (d < best) { best = d; k = q; } });
      patchStyle({ z: SIZES[clamp(k + (a === 'z+' ? 1 : -1), 0, SIZES.length - 1)] });
    }
    else if (a === 'al' || a === 'ac' || a === 'ar') patchPara({ a: a[1] });
    else if (a === 'l1' || a === 'l2') { const want = a === 'l1' ? 1 : 2; patchPara({ l: (paraProps(selA()).l || 0) === want ? 0 : want }); }
    else if (a[0] === 'd' && a.length === 2) { const want = +a[1]; patchPara({ hd: (paraProps(selA()).hd || 0) === want ? 0 : want }); }
    else if (a === 'all') kb.setSelectionRange(0, kb.value.length);
    bump();
  }

  /* ---- the formatting bar (appears above the tools while you write text) ---- */
  const st0 = document.createElement('style');
  st0.textContent =
    '#fmtBar{position:absolute;left:10px;right:10px;bottom:66px;z-index:6;display:flex;gap:6px;align-items:center;overflow-x:auto;background:rgba(15,23,42,.93);border-radius:14px;padding:6px}' +
    '#fmtBar button{flex:none;border:0;border-radius:8px;padding:7px 10px;font-size:14px;font-weight:700;background:#243049;color:#fff;min-width:34px}' +
    '#fmtBar button.on{background:#2563eb}' +
    '#fmtBar .sw2{width:26px;height:26px;min-width:26px;border-radius:50%;padding:0;border:2px solid #fff}' +
    '#fmtBar .sep{flex:none;width:1px;height:22px;background:#475569}';
  document.head.appendChild(st0);
  const bar = document.createElement('div'); bar.id = 'fmtBar'; bar.className = 'hide';
  bar.innerHTML =
    '<button data-a="b" style="font-weight:900">B</button>' +
    '<button data-a="i" style="font-style:italic">I</button>' +
    '<button data-a="u" style="text-decoration:underline">U</button><span class="sep"></span>' +
    '<button data-a="c0" class="sw2" style="background:linear-gradient(135deg,#111827 50%,#f8fafc 50%)"></button>' +
    COLS.map((c, k) => '<button data-a="c' + (k + 1) + '" class="sw2" style="background:' + c + '"></button>').join('') + '<span class="sep"></span>' +
    '<button data-a="h0">Hl\u00d7</button>' +
    HIL.map((c, k) => '<button data-a="h' + (k + 1) + '" class="sw2" style="background:' + c + '"></button>').join('') + '<span class="sep"></span>' +
    '<button data-a="z-">A\u2212</button><button data-a="z+">A+</button><span class="sep"></span>' +
    '<button data-a="al">L</button><button data-a="ac">C</button><button data-a="ar">R</button><span class="sep"></span>' +
    '<button data-a="l1">\u2022</button><button data-a="l2">1.</button><span class="sep"></span>' +
    '<button data-a="d1">H1</button><button data-a="d2">H2</button><button data-a="d3">H3</button><button data-a="d0">P</button><span class="sep"></span>' +
    '<button data-a="all">All</button>';
  $('stage').appendChild(bar);
  ['mousedown', 'touchstart', 'pointerdown'].forEach(ev => bar.addEventListener(ev, e => { e.preventDefault(); }, { passive: false }));
  bar.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    act(b.dataset.a);
    kb.focus({ preventScroll: true });
  });
  function refreshBar() {
    const show = !!editing && mode === 'text' && canWrite();
    bar.classList.toggle('hide', !show);
    if (!show) return;
    const st = curStyle(), pp = paraProps(selA());
    bar.querySelectorAll('button').forEach(b => {
      const a = b.dataset.a; let on = false;
      if (a === 'b') on = !!st.b; else if (a === 'i') on = !!st.i; else if (a === 'u') on = !!st.u;
      else if (a === 'al') on = (pp.a || 'l') === 'l'; else if (a === 'ac') on = pp.a === 'c'; else if (a === 'ar') on = pp.a === 'r';
      else if (a === 'l1') on = pp.l === 1; else if (a === 'l2') on = pp.l === 2;
      else if (a[0] === 'd' && a.length === 2) on = (pp.hd || 0) === +a[1];
      b.classList.toggle('on', on);
    });
  }
  setInterval(refreshBar, 300);
  document.addEventListener('selectionchange', refreshBar);

  /* ---- select text: drag inside the field, or double-tap a word ---- */
  let sd = null, lastTap = { t: 0, x: 0, y: 0 };
  const stage = $('stage');
  function selectWord(idx) {
    const t = editing.text; let a = idx, b = idx;
    while (a > 0 && /\S/.test(t[a - 1])) a--;
    while (b < t.length && /\S/.test(t[b])) b++;
    kb.focus({ preventScroll: true }); kb.setSelectionRange(a, b); draw();
  }
  stage.addEventListener('pointerdown', e => {
    if (e.target !== cv || mode !== 'text' || !editing || !canWrite()) return;
    const r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    if (handlePos && Math.hypot(x - handlePos.x, y - handlePos.y) < 32) return;
    const pr = pageRect();
    if (!(editing.page === curPage && hitText(editing, x, y, pr.x0, pr.y0, pr.pw, pr.ph))) return;
    e.stopPropagation(); e.preventDefault();
    try { cv.setPointerCapture(e.pointerId); } catch (er) { /* ignore */ }
    const idx = indexAt(editing, x, y, pr.x0, pr.y0, pr.pw, pr.ph), now = Date.now();
    if (now - lastTap.t < 350 && Math.hypot(x - lastTap.x, y - lastTap.y) < 22) { selectWord(idx); sd = null; lastTap.t = 0; return; }
    lastTap = { t: now, x, y };
    kb.focus({ preventScroll: true }); kb.setSelectionRange(idx, idx);
    sd = { pid: e.pointerId, a: idx }; draw();
  }, true);
  stage.addEventListener('pointermove', e => {
    if (!sd || e.pointerId !== sd.pid || !editing) return;
    e.stopPropagation();
    const r = cv.getBoundingClientRect(), pr = pageRect();
    const idx = indexAt(editing, e.clientX - r.left, e.clientY - r.top, pr.x0, pr.y0, pr.pw, pr.ph);
    kb.setSelectionRange(Math.min(sd.a, idx), Math.max(sd.a, idx)); draw();
  }, true);
  const endSel = e => { if (sd && e.pointerId === sd.pid) { e.stopPropagation(); sd = null; } };
  stage.addEventListener('pointerup', endSel, true);
  stage.addEventListener('pointercancel', endSel, true);
})();
