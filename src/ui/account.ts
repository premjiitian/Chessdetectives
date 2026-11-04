// "Sign in with Google" button and the small account chip in the header.
import { app } from '../lib/app';
import { signIn, signOut } from '../lib/cloud';
import { esc, toast } from './dom';

const G_LOGO = `<svg viewBox="0 0 48 48" width="18" height="18" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.6l6.7-6.7C35.6 2.4 30.2 0 24 0 14.6 0 6.6 5.4 2.6 13.2l7.8 6.1C12.3 13.6 17.6 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4.1 7.1-10.1 7.1-17.5z"/><path fill="#FBBC05" d="M10.4 28.7c-.5-1.4-.8-3-.8-4.7s.3-3.3.8-4.7l-7.8-6.1C.9 16.5 0 20.1 0 24s.9 7.5 2.6 10.8l7.8-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.8 2.3-8.4 2.3-6.4 0-11.7-4.1-13.6-9.8l-7.8 6.1C6.6 42.6 14.6 48 24 48z"/></svg>`;

export function googleButton(label = 'Sign in with Google'): string {
  return `<button type="button" class="gsi" data-google-signin>${G_LOGO}<span>${esc(label)}</span></button>`;
}

/** Wires every Google button inside `root`. */
export function bindGoogle(root: ParentNode) {
  root.querySelectorAll<HTMLButtonElement>('[data-google-signin]').forEach((b) => {
    if (b.dataset.bound) return;
    b.dataset.bound = '1';
    b.addEventListener('click', async () => {
      b.disabled = true;
      try {
        const u = await signIn();
        if (u) toast(`👋 Signed in as <b>${esc(u.name)}</b> — your progress is now saved to your account.`, 'win', 5000);
      } catch (e) {
        toast(`Sign-in didn't work: ${esc((e as Error).message)}`, 'warn', 6000);
      } finally {
        b.disabled = false;
      }
    });
  });
}

/** Header chip: Google button, or your photo when signed in. */
export function accountChip(): string {
  if (!app.cloudEnabled) return '';
  if (!app.user) return googleButton('Sign in');
  return `<a class="acct" href="#/progress" title="Signed in as ${esc(app.user.email)}">${
    app.user.photo ? `<img src="${esc(app.user.photo)}" alt="" referrerpolicy="no-referrer" />` : '👤'
  }<span>Saved ✓</span></a>`;
}

/** The Account box on the Progress page. */
export function accountBox(): string {
  if (!app.cloudEnabled) return '<p class="sub">Data is stored only in this browser.</p>';
  if (!app.user)
    return `<p class="sub">Sign in to keep your XP and puzzles on every device (iPad, phone, computer).</p>${googleButton()}`;
  return `<p class="sub">Signed in with Google as <b>${esc(app.user.email || app.user.name)}</b>. Your progress is saved to your account.</p>
    <button class="btn small ghost" data-google-signout>Sign out of Google</button>`;
}

export function bindSignOut(root: ParentNode, after?: () => void) {
  root.querySelector('[data-google-signout]')?.addEventListener('click', async () => {
    await signOut();
    toast('Signed out. Your progress stays on this device too.', 'info');
    after?.();
  });
}
