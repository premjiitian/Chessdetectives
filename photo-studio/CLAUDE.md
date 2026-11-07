# Private Photo Studio — guide for Claude (and humans)

On-device auto photo editor (web/PWA for iPhone, iPad, laptop). Photos never leave the device.

## Commands
`npm run dev` · `npm run build` · `npm test` · `npx tsc --noEmit` ·
`npm run loop`: every check + scorecard + screenshots in `scripts/out/`.

## Loop rules
1. State the goal and how we'll know it's done before changing code.
2. Add a check that fails without the fix (unit test, `tests/browser.mjs`, or a screenshot you look at).
3. One change → `npm run loop` → read the scorecard **and look at the screenshots**.
4. Fix root causes. Never weaken a check to get green. If a test is wrong, say why and fix the test.
5. Commit message: found → fixed → measured.
6. Ask the owner about taste, cost, privacy, or anything that would upload a photo.

## Quality bar
- All loop steps ✅. Auto repairs ≥ 40 % of each known camera mistake. Good photo changes < 4 %.
- Privacy: zero requests leave the origin (CSP `connect-src 'self'` + browser check).
- Explanations are truthful and plain. Auto can't see faces, so it must never claim to.
- 0 axe WCAG 2.1 AA issues, light and dark. No sideways scroll at 360 px. Save visible without scrolling on phones.

## Map
`src/lib/develop.ts` pixel pipeline (Lightroom Basic-panel order) · `src/lib/auto.ts` auto settings + reasons ·
`src/lib/looks.ts` presets · `src/lib/exif.ts` keep date/camera, wipe GPS · `src/lib/quality.ts` test photos + metrics ·
`src/main.ts` UI · `src/worker.ts` heavy work off the main thread · `tests/` unit + `browser.mjs`.
