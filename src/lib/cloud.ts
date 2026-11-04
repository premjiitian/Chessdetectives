// Optional "Sign in with Google" + progress sync across devices (Firebase).
//
// It switches itself on only when public/firebase-config.json exists
// (see SETUP-SIGN-IN.md). Without it the app works exactly as before and
// everything stays in this browser.

import type { Progress, XpEntry } from './training';

export interface CloudUser {
  uid: string;
  name: string;
  email: string;
  photo?: string;
}

export interface CloudData {
  username?: string; // chess.com username
  timeClasses?: string[];
  progress?: Progress;
  updatedAt?: number;
}

type FB = {
  auth: import('firebase/auth').Auth;
  db: import('firebase/firestore').Firestore;
  authMod: typeof import('firebase/auth');
  fsMod: typeof import('firebase/firestore');
};

let configPromise: Promise<Record<string, string> | null> | null = null;
let fbPromise: Promise<FB | null> | null = null;

/** The Firebase web config, or null when sign-in is not set up. */
export function cloudConfig(): Promise<Record<string, string> | null> {
  configPromise ??= fetch(`${import.meta.env.BASE_URL}firebase-config.json`, { cache: 'no-store' })
    .then((r) => (r.ok ? r.json() : null))
    .then((c) => (c && c.apiKey && c.projectId && !String(c.apiKey).includes('PASTE') ? c : null))
    .catch(() => null);
  return configPromise;
}

function firebase(): Promise<FB | null> {
  fbPromise ??= (async () => {
    const cfg = await cloudConfig();
    if (!cfg) return null;
    const [{ initializeApp }, authMod, fsMod] = await Promise.all([import('firebase/app'), import('firebase/auth'), import('firebase/firestore')]);
    const fapp = initializeApp(cfg);
    const auth = authMod.getAuth(fapp);
    await authMod.setPersistence(auth, authMod.browserLocalPersistence).catch(() => {});
    return { auth, db: fsMod.getFirestore(fapp), authMod, fsMod };
  })();
  return fbPromise;
}

const toUser = (u: import('firebase/auth').User): CloudUser => ({ uid: u.uid, name: u.displayName ?? u.email ?? 'Player', email: u.email ?? '', photo: u.photoURL ?? undefined });

/** Calls back with the signed-in user (or null) now and whenever it changes. */
export async function watchUser(cb: (u: CloudUser | null) => void): Promise<void> {
  const fb = await firebase();
  if (!fb) return cb(null);
  fb.authMod.onAuthStateChanged(fb.auth, (u) => cb(u ? toUser(u) : null));
}

/** Opens Google sign-in (popup; falls back to a full-page redirect where popups are blocked). */
export async function signIn(): Promise<CloudUser | null> {
  const fb = await firebase();
  if (!fb) throw new Error('Sign-in is not set up yet.');
  const provider = new fb.authMod.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  try {
    return toUser((await fb.authMod.signInWithPopup(fb.auth, provider)).user);
  } catch (e) {
    const code = (e as { code?: string }).code ?? '';
    if (code === 'auth/popup-blocked' || code === 'auth/operation-not-supported-in-this-environment') {
      await fb.authMod.signInWithRedirect(fb.auth, provider);
      return null;
    }
    if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return null;
    throw e;
  }
}

export async function signOut() {
  const fb = await firebase();
  if (fb) await fb.authMod.signOut(fb.auth);
}

export async function pull(uid: string): Promise<CloudData | null> {
  const fb = await firebase();
  if (!fb) return null;
  const snap = await fb.fsMod.getDoc(fb.fsMod.doc(fb.db, 'users', uid));
  return snap.exists() ? (snap.data() as CloudData) : null;
}

export async function push(uid: string, data: CloudData): Promise<void> {
  const fb = await firebase();
  if (!fb) return;
  // Firestore rejects `undefined`; JSON round-trip drops those fields.
  const clean = JSON.parse(JSON.stringify({ ...data, updatedAt: Date.now() }));
  await fb.fsMod.setDoc(fb.fsMod.doc(fb.db, 'users', uid), clean, { merge: true });
}

/**
 * Combines progress from two devices without losing anything:
 * the best of each number, every solved case, every badge, the full XP log.
 */
export function mergeProgress(a: Progress, b: Progress | undefined): Progress {
  if (!b) return a;
  const later = (a.lastDay ?? '') >= (b.lastDay ?? '') ? a : b;
  const daily: Record<string, number> = { ...b.daily };
  for (const [d, n] of Object.entries(a.daily)) daily[d] = Math.max(n, daily[d] ?? 0);
  const themes = { ...b.themes };
  for (const [k, t] of Object.entries(a.themes)) {
    const o = themes[k as keyof typeof themes];
    themes[k as keyof typeof themes] = o && t ? { attempts: Math.max(o.attempts, t.attempts), clean: Math.max(o.clean, t.clean) } : (t ?? o);
  }
  const cards = { ...b.cards };
  for (const [id, c] of Object.entries(a.cards)) {
    const o = cards[id];
    cards[id] = !o || (c.lastSeen ?? 0) >= (o.lastSeen ?? 0) ? c : o;
  }
  const seen = new Set<string>();
  const log: XpEntry[] = [...(b.log ?? []), ...(a.log ?? [])]
    .filter((e) => {
      const k = `${e.t}|${e.id}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((x, y) => x.t - y.t)
    .slice(-500);
  // XP: whichever device knows more, plus anything earned only in the other's log.
  const logXp = log.reduce((s, e) => s + e.xp + e.bonus, 0);
  return {
    ...later,
    username: a.username || b.username,
    xp: Math.max(a.xp, b.xp, logXp),
    streak: later.streak,
    lastDay: later.lastDay,
    bestStreak: Math.max(a.bestStreak, b.bestStreak),
    daily,
    themes,
    cards,
    badges: [...new Set([...(a.badges ?? []), ...(b.badges ?? [])])],
    chapters: [...new Set([...(a.chapters ?? []), ...(b.chapters ?? [])])].sort((x, y) => x - y),
    log,
  };
}
