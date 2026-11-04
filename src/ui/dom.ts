// Small helpers so views can be written as HTML strings safely.

export function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** Very small markdown: **bold** only, everything else escaped. */
export function md(s: string): string {
  return esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
}

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
}

export function $(root: ParentNode, sel: string): HTMLElement {
  const e = root.querySelector(sel);
  if (!e) throw new Error(`missing ${sel}`);
  return e as HTMLElement;
}

export function timeAgo(sec: number): string {
  const d = Date.now() / 1000 - sec;
  if (d < 3600) return `${Math.max(1, Math.round(d / 60))} min ago`;
  if (d < 86400) return `${Math.round(d / 3600)} h ago`;
  if (d < 86400 * 30) return `${Math.round(d / 86400)} days ago`;
  return new Date(sec * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function toast(html: string, kind: 'info' | 'win' | 'warn' = 'info', ms = 3500) {
  let host = document.getElementById('toasts');
  if (!host) {
    host = el('div');
    host.id = 'toasts';
    document.body.append(host);
  }
  const t = el('div', `toast ${kind}`, html);
  host.append(t);
  setTimeout(() => t.classList.add('out'), ms);
  setTimeout(() => t.remove(), ms + 400);
}

export function confetti() {
  const host = el('div', 'confetti');
  const colors = ['#4F7FE8', '#F5B83D', '#3CC48A', '#EE6A6A', '#A779E9'];
  for (let i = 0; i < 60; i++) {
    const p = el('i');
    p.style.left = Math.random() * 100 + 'vw';
    p.style.background = colors[i % colors.length];
    p.style.animationDelay = Math.random() * 0.4 + 's';
    p.style.transform = `rotate(${Math.random() * 360}deg)`;
    host.append(p);
  }
  document.body.append(host);
  setTimeout(() => host.remove(), 2600);
}
