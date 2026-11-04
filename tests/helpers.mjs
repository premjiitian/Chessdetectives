// Shared helpers for the browser tests.

/**
 * Waits until the puzzle trainer's state matches `pred` (e.g. the board is
 * ready). Polls with page.evaluate, which awaits the hook's Promise — passing
 * a Promise-returning function to waitForFunction is unreliable.
 * Resolves to the state, or null after `ms`.
 */
export async function waitStep(page, pred, ms = 60000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const s = await page.evaluate(() => window.__cdStep?.()).catch(() => null);
    if (s && pred(s)) return s;
    await page.waitForTimeout(150);
  }
  return null;
}
