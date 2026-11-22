// Capa de datos. Misma interfaz para Firebase (real) y modo demo (localStorage).
import { FIREBASE_CONFIG } from './config.js';
import { newTxId, cleanTx, norm, round2, toISO, addDays } from './utils.js';

export const isDemo = !FIREBASE_CONFIG?.apiKey || FIREBASE_CONFIG.apiKey.startsWith('TU_');

export async function initStore() {
  return isDemo ? demoStore() : firebaseStore();
}

function cleanCat(c) {
  const out = {
    nombre: String(c.nombre ?? '').trim(),
    metaMensual: round2(Math.max(0, Number(c.metaMensual) || 0)),
    metaSemanal: round2(Math.max(0, Number(c.metaSemanal) || 0)),
  };
  if (!out.nombre) throw new Error('La categoría necesita nombre');
  return out;
}

// ---------------------------------------------------------------- Firebase
async function firebaseStore() {
  const V = '10.12.2';
  const base = `https://www.gstatic.com/firebasejs/${V}`;
  const [{ initializeApp }, A, F] = await Promise.all([
    import(`${base}/firebase-app.js`),
    import(`${base}/firebase-auth.js`),
    import(`${base}/firebase-firestore.js`),
  ]);
  const app = initializeApp(FIREBASE_CONFIG);
  const auth = A.getAuth(app);
  // Caché local persistente: la app abre al instante y funciona sin conexión; sincroniza sola.
  const db = F.initializeFirestore(app, {
    localCache: F.persistentLocalCache({ tabManager: F.persistentMultipleTabManager() }),
  });
  const TX = F.collection(db, 'transacciones');
  const CAT = F.collection(db, 'categorias');
  const who = () => auth.currentUser?.email || '';
  const mapDocs = (snap) => snap.docs.map((d) => ({ ...d.data(), id: d.id }));

  async function commitInChunks(ops) {
    for (let i = 0; i < ops.length; i += 400) {
      const b = F.writeBatch(db);
      ops.slice(i, i + 400).forEach((op) => op(b));
      await b.commit();
    }
  }

  return {
    onAuth(cb) {
      return A.onAuthStateChanged(auth, (u) => cb(u ? { email: u.email, name: u.displayName || u.email, photo: u.photoURL } : null));
    },
    async signIn() {
      const p = new A.GoogleAuthProvider();
      p.setCustomParameters({ prompt: 'select_account' });
      try { await A.signInWithPopup(auth, p); }
      catch (e) {
        if (['auth/popup-blocked', 'auth/operation-not-supported-in-this-environment'].includes(e.code)) await A.signInWithRedirect(auth, p);
        else if (e.code !== 'auth/popup-closed-by-user' && e.code !== 'auth/cancelled-popup-request') throw e;
      }
    },
    signOut: () => A.signOut(auth),

    watchRange(from, to, cb, onErr) {
      const q = F.query(TX, F.where('fecha', '>=', from), F.where('fecha', '<=', to));
      return F.onSnapshot(q, (s) => cb(mapDocs(s)), onErr);
    },
    watchCategories(cb, onErr) { return F.onSnapshot(CAT, (s) => cb(mapDocs(s)), onErr); },

    addTx(d) {
      const id = newTxId();
      return F.setDoc(F.doc(TX, id), { ...cleanTx(d), creadoPor: who(), creado: F.serverTimestamp(), actualizado: F.serverTimestamp() }).then(() => id);
    },
    // updateDoc falla si el documento ya no existe: nunca "revive" un movimiento borrado por la otra persona.
    updateTx(id, d) { return F.updateDoc(F.doc(TX, id), { ...cleanTx(d), editadoPor: who(), actualizado: F.serverTimestamp() }); },
    deleteTx(id) { return F.deleteDoc(F.doc(TX, id)); },

    saveCategory(c) {
      const data = cleanCat(c);
      return c.id ? F.updateDoc(F.doc(CAT, c.id), data) : F.addDoc(CAT, { ...data, orden: Date.now() });
    },
    deleteCategory(id) { return F.deleteDoc(F.doc(CAT, id)); },
    async renameCategory(oldName, newName) {
      const s = await F.getDocs(F.query(TX, F.where('categoria', '==', oldName)));
      await commitInChunks(s.docs.map((d) => (b) => b.update(d.ref, { categoria: newName })));
      return s.size;
    },

    async importTransactions(items) {
      await commitInChunks(items.map((t) => (b) => b.set(F.doc(TX, t.id || newTxId()),
        { ...cleanTx(t), creadoPor: who(), actualizado: F.serverTimestamp() }, { merge: true })));
    },
    async importCategories(items) {
      const existing = mapDocs(await F.getDocs(CAT));
      const byName = new Map(existing.map((c) => [norm(c.nombre), c]));
      await commitInChunks(items.map((c, i) => (b) => {
        const data = cleanCat(c), ex = byName.get(norm(data.nombre));
        if (ex) b.update(F.doc(CAT, ex.id), data);
        else b.set(F.doc(CAT), { ...data, orden: Date.now() + i });
      }));
    },
    async getAllTransactions() { return mapDocs(await F.getDocs(TX)); },
  };
}

// ---------------------------------------------------------------- Demo
function demoStore() {
  const K_TX = 'gp_demo_tx', K_CAT = 'gp_demo_cat';
  const load = (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } };
  let txs = load(K_TX), cats = load(K_CAT);
  if (!cats) seed();
  const txL = new Set(), catL = new Set();
  const save = () => { try { localStorage.setItem(K_TX, JSON.stringify(txs)); localStorage.setItem(K_CAT, JSON.stringify(cats)); } catch {} };
  const emit = () => { save(); txL.forEach((f) => f()); catL.forEach((f) => f()); };

  function seed() {
    let id = 0;
    const mk = (nombre, metaMensual, metaSemanal = 0) => ({ id: 'c' + (++id), nombre, metaMensual, metaSemanal, orden: id });
    cats = [mk('Súper', 6000, 1500), mk('Comida fuera', 2500, 600), mk('Transporte', 1500), mk('Servicios', 2200),
      mk('Entretenimiento', 1200, 300), mk('Salud', 800), mk('Ahorro emergencias', 3000), mk('Ahorro viaje', 2000)];
    const conceptos = { 'Súper': ['Walmart', 'Soriana', 'Mercado', 'Costco'], 'Comida fuera': ['Tacos', 'Café', 'Pizza', 'Sushi'],
      'Transporte': ['Gasolina', 'Uber', 'Metro'], 'Servicios': ['Luz', 'Internet', 'Agua', 'Celular'],
      'Entretenimiento': ['Cine', 'Netflix', 'Concierto'], 'Salud': ['Farmacia', 'Consulta'],
      'Ahorro emergencias': ['Depósito'], 'Ahorro viaje': ['Depósito'] };
    let r = 7; const rnd = () => ((r = (r * 9301 + 49297) % 233280) / 233280);
    txs = [];
    for (let d = 0; d < 120; d++) {
      const fecha = toISO(addDays(new Date(), -d));
      const n = rnd() < 0.35 ? 0 : 1 + Math.floor(rnd() * 2);
      for (let i = 0; i < n; i++) {
        const c = cats[Math.floor(rnd() * 6)];
        const cs = conceptos[c.nombre];
        txs.push({ id: newTxId(), fecha, categoria: c.nombre, concepto: cs[Math.floor(rnd() * cs.length)], cantidad: round2(50 + rnd() * c.metaMensual / 6), notas: '' });
      }
      if (fecha.endsWith('-01') || fecha.endsWith('-15')) {
        txs.push({ id: newTxId(), fecha, categoria: 'Ahorro emergencias', concepto: 'Depósito', cantidad: 1500, notas: 'Quincena' });
        txs.push({ id: newTxId(), fecha, categoria: 'Ahorro viaje', concepto: 'Depósito', cantidad: 800, notas: '' });
      }
    }
    try { localStorage.setItem(K_TX, JSON.stringify(txs)); localStorage.setItem(K_CAT, JSON.stringify(cats)); } catch {}
  }

  return {
    onAuth(cb) { setTimeout(() => cb({ email: 'demo@local', name: 'Modo demo' })); return () => {}; },
    async signIn() {}, async signOut() {},
    watchRange(from, to, cb) {
      const f = () => cb(txs.filter((t) => t.fecha >= from && t.fecha <= to).map((t) => ({ ...t })));
      txL.add(f); f(); return () => txL.delete(f);
    },
    watchCategories(cb) { const f = () => cb(cats.map((c) => ({ ...c }))); catL.add(f); f(); return () => catL.delete(f); },
    async addTx(d) { const id = newTxId(); txs.push({ ...cleanTx(d), id }); emit(); return id; },
    async updateTx(id, d) {
      const i = txs.findIndex((t) => t.id === id);
      if (i < 0) throw new Error('Ese movimiento ya no existe');
      txs[i] = { ...txs[i], ...cleanTx(d) }; emit();
    },
    async deleteTx(id) { txs = txs.filter((t) => t.id !== id); emit(); },
    async saveCategory(c) {
      const data = cleanCat(c);
      if (c.id) { const i = cats.findIndex((x) => x.id === c.id); if (i >= 0) cats[i] = { ...cats[i], ...data }; }
      else cats.push({ ...data, id: 'c' + Date.now(), orden: Date.now() });
      emit();
    },
    async deleteCategory(id) { cats = cats.filter((c) => c.id !== id); emit(); },
    async renameCategory(o, n) { let k = 0; txs.forEach((t) => { if (t.categoria === o) { t.categoria = n; k++; } }); emit(); return k; },
    async importTransactions(items) {
      items.forEach((t) => {
        const data = cleanTx(t), id = t.id || newTxId(), i = txs.findIndex((x) => x.id === id);
        if (i >= 0) txs[i] = { ...data, id }; else txs.push({ ...data, id });
      });
      emit();
    },
    async importCategories(items) {
      items.forEach((c, k) => {
        const data = cleanCat(c), ex = cats.find((x) => norm(x.nombre) === norm(data.nombre));
        if (ex) Object.assign(ex, data); else cats.push({ ...data, id: 'c' + Date.now() + k, orden: Date.now() + k });
      });
      emit();
    },
    async getAllTransactions() { return txs.map((t) => ({ ...t })); },
    resetDemo() { localStorage.removeItem(K_TX); localStorage.removeItem(K_CAT); location.reload(); },
  };
}
