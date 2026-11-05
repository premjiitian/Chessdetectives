// Running inside the iOS app (Capacitor) instead of a browser.
// The app ships all files on the device, so it works offline without the web
// "offline helper"; links to chess.com and YouTube open in an in-app browser.

/** True inside the iOS app (WKWebView with the Capacitor bridge). */
export function isNativeApp(): boolean {
  const w = window as any;
  return !!w.Capacitor?.isNativePlatform?.() || !!w.webkit?.messageHandlers?.bridge;
}

/** Opens a web page in the in-app browser (Safari view) in the app, a new tab on the web. */
export async function openExternal(url: string) {
  if (!isNativeApp()) {
    window.open(url, '_blank', 'noopener');
    return;
  }
  // Automated tests (tests/app-mode.mjs) fake the app in a browser: record, don't open.
  const seen = (window as any).__opened;
  if (Array.isArray(seen)) return void seen.push(url);
  try {
    const { Browser } = await import('@capacitor/browser');
    await Browser.open({ url });
  } catch {
    location.href = url; // Capacitor hands non-app URLs to Safari
  }
}

/**
 * In the app, every link that leaves the app (chess.com games, YouTube) opens
 * in the in-app browser instead of replacing the app's page.
 */
export function routeExternalLinks() {
  if (!isNativeApp()) return;
  document.addEventListener(
    'click',
    (e) => {
      const a = (e.target as HTMLElement | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!a || !/^https?:/i.test(a.href) || new URL(a.href).host === location.host) return;
      e.preventDefault();
      openExternal(a.href);
    },
    true,
  );
}
