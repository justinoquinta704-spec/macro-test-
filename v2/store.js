/* =====================================================================
   STORAGE: Firebase Auth + Firestore
   ===================================================================== */
async function createFirebaseStore(cfg) {
  const base = `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/`;
  const [{ initializeApp }, A, F] = await Promise.all([
    import(base + "firebase-app.js"),
    import(base + "firebase-auth.js"),
    import(base + "firebase-firestore.js")
  ]);
  const app = initializeApp(cfg), auth = A.getAuth(app), db = F.getFirestore(app);

  const ref = (...p) => F.doc(db, ...p);
  const ms = v => (v && typeof v.toMillis === "function" ? v.toMillis() : v);
  const normAttempt = d => ({ ...d, startedAt: ms(d.startedAt) });
  const normSub = d => ({ ...d, submittedAt: ms(d.submittedAt) });
  const all = async (name, level) => {
    const c = F.collection(db, name);
    const snap = await F.getDocs(level ? F.query(c, F.where("level", "==", level)) : c);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  };
  const one = async (...p) => { const s = await F.getDoc(ref(...p)); return s.exists() ? s.data() : null; };

  const MSG = {
    "auth/weak-password": "Password must have at least 6 characters.",
    "auth/network-request-failed": "Network error. Check your connection and try again.",
    "auth/too-many-requests": "Too many attempts. Wait a few minutes and try again.",
    "auth/invalid-credential": "Incorrect email or password.",
    "auth/user-not-found": "Incorrect email or password.",
    "auth/wrong-password": "Incorrect email or password.",
    "auth/invalid-email": "Enter a valid email address.",
    "auth/email-already-in-use": "This email already has an account. Use Sign in.",
    "permission-denied": "Permission denied by the database rules."
  };
  const friendly = e => new Error(MSG[e.code] || e.message);

  async function sessionOf(u) {
    if (u.email === ADMIN_EMAIL) return { uid: u.uid, email: u.email, username: "Teacher", role: "admin" };
    const m = await one("members", u.uid);
    return m ? { uid: u.uid, email: u.email, username: m.name, level: m.level || "basic", released: m.released === true, topic: m.topic || "", role: "student" } : null;
  }

  return {
    mode: "online",
    init: () => new Promise(res => {
      const off = A.onAuthStateChanged(auth, async u => { off(); res(u ? await sessionOf(u) : null); });
    }),

    /* The teacher creates student accounts. A second app instance is used so the
       teacher stays signed in. */
    async createStudent({ name, email, password, level }) {
      let sec;
      try { sec = initializeApp(cfg, "secondary"); } catch { sec = null; }
      const secAuth = A.getAuth(sec || app);
      let uid;
      try { uid = (await A.createUserWithEmailAndPassword(secAuth, email, password)).user.uid; }
      catch (e) {
        if (e.code !== "auth/email-already-in-use") throw friendly(e);
        try { uid = (await A.signInWithEmailAndPassword(secAuth, email, password)).user.uid; }
        catch { throw new Error("This email already has an account with a different password. Use the same password, or send a reset email."); }
      }
      try { await A.signOut(secAuth); } catch { /* ignore */ }
      await F.setDoc(ref("members", uid), { uid, name, email, level, createdAt: F.serverTimestamp() });
      return uid;
    },
    setStudentLevel: (uid, level) => F.updateDoc(ref("members", uid), { level }),
    setStudentRelease: (uid, released) => F.updateDoc(ref("members", uid), { released }),
    setStudentName: (uid, name) => F.updateDoc(ref("members", uid), { name }),
    updateMember: (uid, patch) => F.updateDoc(ref("members", uid), patch),
    removeStudent: uid => F.deleteDoc(ref("members", uid)),
    async loginStudent({ email, password }) {
      let user;
      try { user = (await A.signInWithEmailAndPassword(auth, email, password)).user; }
      catch (e) { throw friendly(e); }
      const s = await sessionOf(user);
      if (!s) { await A.signOut(auth); throw new Error("This account has no access. Ask your teacher to add you."); }
      return s;
    },
    async loginAdmin(email, password) {
      let user;
      try { user = (await A.signInWithEmailAndPassword(auth, email, password)).user; }
      catch (e) { throw new Error(e.code === "auth/invalid-credential" ? "Incorrect administrator credentials." : friendly(e).message); }
      if (user.email !== ADMIN_EMAIL) {
        await A.signOut(auth);
        throw new Error("This account is not an administrator.");
      }
      return sessionOf(user);
    },
    async resetPassword(email) {
      try { await A.sendPasswordResetEmail(auth, email); } catch (e) { throw friendly(e); }
    },
    logout: () => A.signOut(auth),

    async getSettings() {
      try { return { ...DEFAULTS, counts: {}, ...((await one("settings", "test")) || {}) }; }
      catch { return { ...DEFAULTS, counts: {} }; }
    },
    saveSettings: s => F.setDoc(ref("settings", "test"), s, { merge: true }),

    async getQuestions({ withKeys, level }) {
      const qs = await all("questions", level);
      const keys = {};
      if (withKeys) (await all("keys")).forEach(k => { keys[k.id] = k.correct; });
      qs.sort((a, b) => a.createdAt - b.createdAt);
      return qs.map(q => (withKeys ? { ...q, correct: keys[q.id] } : q));
    },
    /* audio: undefined = keep, null = remove, string = new audio */
    async saveQuestion(q, audio) {
      const { id, correct, ...pub } = q;
      const b = F.writeBatch(db);
      b.set(ref("questions", id), pub);
      if (q.type === "mcq") b.set(ref("keys", id), { correct }); else b.delete(ref("keys", id));
      if (typeof audio === "string") b.set(ref("qaudio", id), { data: audio });
      else if (audio === null) b.delete(ref("qaudio", id));
      await b.commit();
    },
    async deleteQuestion(id) {
      const b = F.writeBatch(db);
      ["questions", "keys", "qaudio"].forEach(c => b.delete(ref(c, id)));
      await b.commit();
    },
    async getQuestionAudio(id) { const d = await one("qaudio", id); return d ? d.data : null; },

    async getAttempt(uid) { const d = await one("attempts", uid); return d ? normAttempt(d) : null; },
    async startAttempt(uid, username) {
      await F.setDoc(ref("attempts", uid), {
        uid, username, startedAt: F.serverTimestamp(), order: [], perms: {}, draft: {}, warnings: 0
      });
      return this.getAttempt(uid);
    },
    async patchAttempt(uid, patch) {
      try { await F.updateDoc(ref("attempts", uid), patch); }
      catch (e) { console.warn("Could not save progress:", e.code || e.message); }
    },
    saveAnswerAudio: (uid, qid, data) => F.setDoc(ref("answers_audio", uid + "_" + qid), { uid, qid, data }),
    async getAnswerAudio(uid, qid) { const d = await one("answers_audio", uid + "_" + qid); return d ? d.data : null; },

    async submit(uid, sub) {
      try { await F.setDoc(ref("submissions", uid), { uid, ...sub, submittedAt: F.serverTimestamp() }); }
      catch (e) { throw e.code === "permission-denied" ? new Error("Time is over or the test was already submitted.") : friendly(e); }
    },
    async getSubmission(uid) { const d = await one("submissions", uid); return d ? normSub(d) : null; },
    getResult: uid => one("results", uid),

    async loadAdminData() {
      const [questions, attempts, submissions, results, grades, history, members] = await Promise.all([
        this.getQuestions({ withKeys: true }), all("attempts"), all("submissions"),
        all("results"), all("grades"), all("history"), all("members")
      ]);
      return { questions, attempts: attempts.map(normAttempt), submissions: submissions.map(normSub), results, grades, history, members };
    },
    saveGrades: (uid, marks) => F.setDoc(ref("grades", uid), { uid, marks }),
    async publishResults(list) {
      /* the topic, certificate type and level chosen for each student are saved inside the result */
      const meta = {};
      for (const r of list) {
        const m = await one("members", r.uid);
        meta[r.uid] = m ? { topic: m.topic || "", certType: m.certType || "achievement", level: m.level || "basic" } : {};
      }
      for (let i = 0; i < list.length; i += 400) {
        const b = F.writeBatch(db);
        list.slice(i, i + 400).forEach(r => b.set(ref("results", r.uid), { ...r, ...meta[r.uid] }));
        await b.commit();
      }
    },
    /* Archives everything (summary, answers, recordings) and clears the attempt so the student
       can retake. Nothing is deleted before the copies are saved. */
    async archiveAttempt(uid, hid, record, detail, qids) {
      const audios = [];
      for (const qid of qids) {
        const d = await one("answers_audio", uid + "_" + qid);
        if (d) audios.push([qid, d.data]);
      }
      for (const [qid, data] of audios) await F.setDoc(ref("history_audio", hid + "_" + qid), { hid, uid, qid, data });
      const res = await one("results", uid);
      const extra = res ? { topic: res.topic || "", certType: res.certType || "achievement", level: res.level || record.level || "basic" } : {};
      const b = F.writeBatch(db);
      b.set(ref("history", hid), { ...record, ...extra, uid, archivedAt: Date.now() });
      b.set(ref("history_detail", hid), { uid, ...detail });
      ["attempts", "submissions", "results", "grades"].forEach(c => b.delete(ref(c, uid)));
      audios.forEach(([qid]) => b.delete(ref("answers_audio", uid + "_" + qid)));
      await b.commit();
    },
    async getMyHistory(uid) {
      const snap = await F.getDocs(F.query(F.collection(db, "history"), F.where("uid", "==", uid)));
      return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    },
    getHistoryDetail: hid => one("history_detail", hid),
    async getHistoryAudio(hid, qid) { const d = await one("history_audio", hid + "_" + qid); return d ? d.data : null; }
  };
}
