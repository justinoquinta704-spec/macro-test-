/* =====================================================================
   AUDIO HELPERS (recording and playback, stored as data URLs)
   ===================================================================== */
function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error("Could not read the audio."));
    r.readAsDataURL(blob);
  });
}

function pickMime() {
  const types = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
  return types.find(t => window.MediaRecorder && MediaRecorder.isTypeSupported(t)) || "";
}

async function startRecording(onTick) {
  if (!navigator.mediaDevices || !window.MediaRecorder)
    throw new Error("Audio recording is not supported in this browser.");
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const mime = pickMime();
  const opts = mime ? { mimeType: mime, audioBitsPerSecond: 24000 } : { audioBitsPerSecond: 24000 };
  const rec = new MediaRecorder(stream, opts);
  const chunks = [];
  const t0 = Date.now();
  let timer = null;
  rec.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
  const done = new Promise(resolve => {
    rec.onstop = () => {
      clearInterval(timer);
      stream.getTracks().forEach(t => t.stop());
      resolve(new Blob(chunks, { type: rec.mimeType || mime || "audio/webm" }));
    };
  });
  timer = setInterval(() => {
    const s = (Date.now() - t0) / 1000;
    if (onTick) onTick(s);
    if (s >= MAX_AUDIO_SEC && rec.state !== "inactive") rec.stop();
  }, 250);
  rec.start();
  return { done, stop: () => { if (rec.state !== "inactive") rec.stop(); } };
}

/* Record button + player. onChange(dataUrl|null) is called after recording. */
function mountRecorder(box, { initial = null, removable = false, onChange } = {}) {
  let url = initial, rc = null;
  box.innerHTML =
    '<div class="row"><button type="button" class="small" data-r="rec">● Record</button>' +
    '<button type="button" class="small danger hidden" data-r="stop">■ Stop</button>' +
    (removable ? '<button type="button" class="small secondary hidden" data-r="del">Remove audio</button>' : "") +
    '<span class="muted" data-r="st"></span></div>' +
    '<audio controls class="hidden" style="width:100%;margin-top:8px"></audio>';
  const q = k => box.querySelector('[data-r="' + k + '"]');
  const au = box.querySelector("audio");
  const tog = (el, on) => { if (el) el.classList.toggle("hidden", !on); };
  const say = t => { q("st").textContent = t; };
  const sync = () => {
    tog(au, !!url);
    if (url) au.src = url; else au.removeAttribute("src");
    tog(q("del"), !!url);
  };

  q("rec").onclick = async () => {
    say("");
    try { rc = await startRecording(s => say("Recording… " + Math.floor(s) + "s")); }
    catch (e) { say(e.name === "NotAllowedError" ? "Microphone permission denied." : e.message); return; }
    tog(q("rec"), false); tog(q("stop"), true);
    rc.done.then(async blob => {
      tog(q("stop"), false); tog(q("rec"), true); rc = null;
      try {
        const data = await blobToDataURL(blob);
        if (data.length > MAX_AUDIO_CHARS) throw new Error("Recording too long. Record a shorter one.");
        url = data; sync(); say("Saving…");
        if (onChange) await onChange(url);
        say("Saved ✓");
      } catch (e) { say("Could not save: " + e.message); }
    });
  };
  q("stop").onclick = () => { if (rc) rc.stop(); };
  if (q("del")) q("del").onclick = async () => { url = null; sync(); say(""); if (onChange) await onChange(null); };

  sync();
  return { setUrl(u) { url = u; sync(); } };
}

/* A "Load audio" button that fetches the audio only when pressed. */
function mountLazyAudio(box, loader) {
  box.innerHTML = '<button type="button" class="small secondary">▶ Load audio</button>';
  box.firstChild.onclick = async () => {
    box.textContent = "Loading…";
    try {
      const u = await loader();
      if (!u) { box.textContent = "No audio found."; return; }
      box.innerHTML = '<audio controls style="width:100%"></audio>';
      box.firstChild.src = u;
    } catch (e) { box.textContent = "Could not load audio: " + e.message; }
  };
}
