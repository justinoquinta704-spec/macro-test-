/* =====================================================================
   STORAGE: ONLINE MODE (Firebase Auth + Firestore)
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
  const studentEmail = u => u.toLowerCase() + "@students.macrotest.app";
  const sessionOf = u => ({
    uid: u.uid,
    username: u.email.split("@")[0],
    role: u.email === ADMIN_EMAIL ? "admin" : "student"
  });
  const all = async name => (await F.getDocs(F.collection(db, name))).docs.map(d => ({ id: d.id, ...d.data() }));

  const MSG = {
    "auth/weak-password": "Password must have at least 6 characters.",
    "auth/network-request-failed": "Network error. Check your connection and try again.",
    "auth/too-many-requests": "Too many attempts. Wait a few minutes and try again.",
    "auth/invalid-credential": "Incorrect credentials.",
    "permission-denied": "Permission denied by the database rules."
  };
  const friendly = e => new Error(MSG[e.code] || e.message);

  return {
    mode: "online",
    init: () => new Promise(res => {
      const off = A.onAuthStateChanged(auth, u => { off(); res(u ? sessionOf(u) : null); });
    }),

    async loginStudent(username, password) {
      const email = studentEmail(username);
      try {
        return sessionOf((await A.signInWithEmailAndPassword(auth, email, password)).user);
      } catch (e) {
        if (!["auth/user-not-found", "auth/invalid-credential"].includes(e.code)) throw friendly(e);
        try {
          return sessionOf((await A.createUserWithEmailAndPassword(auth, email, password)).user);
        } catch (e2) {
          if (e2.code === "auth/email-already-in-use") throw new Error("Incorrect password.");
          throw friendly(e2);
        }
      }
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
    logout: () => A.signOut(auth),

    async getSettings() {
      try {
        const s = await F.getDoc(ref("settings", "test"));
        return { ...DEFAULTS, questionCount: 0, ...(s.exists() ? s.data() : {}) };
      } catch { return { ...DEFAULTS, questionCount: 0 }; }
    },
    saveSettings: s => F.setDoc(ref("settings", "test"), s, { merge: true }),

    async getQuestions({ withKeys }) {
      const qs = await all("questions");
      const keys = {};
      if (withKeys) (await all("keys")).forEach(k => { keys[k.id] = k.correct; });
      qs.sort((a, b) => a.createdAt - b.createdAt);
      return qs.map(q => (withKeys ? { ...q, correct: keys[q.id] } : q));
    },
    async saveQuestion(q) {
      const { id, correct, ...pub } = q;
      const b = F.writeBatch(db);
      b.set(ref("questions", id), pub);
      b.set(ref("keys", id), { correct });
      await b.commit();
    },
    async deleteQuestion(id) {
      const b = F.writeBatch(db);
      b.delete(ref("questions", id));
      b.delete(ref("keys", id));
      await b.commit();
    },

    async getAttempt(uid) {
      const s = await F.getDoc(ref("attempts", uid));
      return s.exists() ? normAttempt(s.data()) : null;
    },
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
    async submit(uid, sub) {
      try { await F.setDoc(ref("submissions", uid), { uid, ...sub, submittedAt: F.serverTimestamp() }); }
      catch (e) { throw e.code === "permission-denied" ? new Error("Time is over or the test was already submitted.") : friendly(e); }
    },
    async getSubmission(uid) {
      const s = await F.getDoc(ref("submissions", uid));
      return s.exists() ? normSub(s.data()) : null;
    },
    async getResult(uid) {
      const s = await F.getDoc(ref("results", uid));
      return s.exists() ? s.data() : null;
    },

    async loadAdminData() {
      const [questions, attempts, submissions, results] = await Promise.all([
        this.getQuestions({ withKeys: true }), all("attempts"), all("submissions"), all("results")
      ]);
      return { questions, attempts: attempts.map(normAttempt), submissions: submissions.map(normSub), results };
    },
    async publishResults(list) {
      for (let i = 0; i < list.length; i += 400) {
        const b = F.writeBatch(db);
        list.slice(i, i + 400).forEach(r => b.set(ref("results", r.uid), r));
        await b.commit();
      }
    },
    async resetStudent(uid) {
      const b = F.writeBatch(db);
      ["attempts", "submissions", "results"].forEach(c => b.delete(ref(c, uid)));
      await b.commit();
    }
  };
}
