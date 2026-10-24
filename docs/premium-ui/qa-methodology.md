# Independent frontend QA: integrated wave 1

This evidence belongs to a bounded integration snapshot. It does not certify completion of all 260 requirements or every source-discovered control.

## Responsive navigation audit

`frontend/tests/premium-regression.browser.mjs` opens all 18 application destinations at 320, 390, 768 and 1280 CSS pixels in light and dark schemes: 144 rendered cases. Its isolated fixture is loopback port 8031. Requests remain read-only; the exact existing unsaved-rules check endpoint is the sole allowed POST because the backend source explicitly defines it as validation without saving. Every other mutation is blocked and recorded as a test failure.

Navigation uses genuine Playwright pointer activation through the visible sidebar, bottom navigation or More sheet. Off-screen translated sidebar controls are not activated. Each case requires meaningful view content and the selected navigation state, records visible action labels, checks document overflow, captures a full-page screenshot and runs axe's applicable WCAG tags. Unexpected script errors, navigation failures, document overflow and serious/critical automated findings fail the audit. Lower-impact automated findings remain in the JSON report for assessment; zero severe findings is not a declaration of full accessibility conformance.

Full-page screenshots show fixed navigation at its viewport position within a taller captured page. A local comparison-table scrollbar is distinct from document-level overflow. Screenshots are evidence for human inspection, not pixel-diff assertions against frozen baseline images.

## Recovery checks

`frontend/tests/premium-recovery.browser.mjs` checks blocked entry loading with keyboard reload, denied browser-storage access, storage quota failure with in-memory month continuity, and an injected Vite preload event after an edited field. It verifies no automatic document replacement, one recovery panel, declining reload preserves the document, and keyboard dismissal preserves input.

A separate scenario exercises the actual typed request client against fully intercepted synthetic endpoints: 401, 409, HTML 503, malformed JSON after POST, success 204, a bounded read timeout and caller cancellation. Each dispatched request is counted; failed/uncertain POSTs must not replay. No synthetic mutation reaches the fixture or another backend. This scenario is a request-client contract test, not an end-to-end mutation control test. It imports the dev module and therefore is not claimed as production-bundle verification.

The sixth scenario delays compute capabilities, verifies its immediate busy status, returns a controlled 503, then activates Try again and requires actual compute controls to appear after exactly one deliberate retry. Production mode runs the five UI scenarios and explicitly excludes the development-module transport injection.

## Evidence boundaries

- The navigation audit does not save, publish, delete, approve, import or assign operational records.
- Seeing a button and navigating to its screen does not establish that button's outcome.
- Edited search input demonstrates input preservation; it does not certify persistent draft restoration.
- Injecting `vite:preloadError` verifies the handler, not real missing deployed chunks or host cache retention.
- Chromium desktop emulation does not certify physical Android/iPhone, software keyboards, NVDA or VoiceOver.
- Cross-browser engines, role variants and production workflows require their own explicit run evidence.
- Source hash records establish the tested snapshot; later source changes need appropriately targeted reruns.

Run from `frontend`: `node tests/premium-regression.browser.mjs` and `node tests/premium-recovery.browser.mjs`. `PREMIUM_TEST_URL` selects a frontend. API targets are restricted to the isolated loopback fixture. `PREMIUM_RECOVERY_CASE` selects a recovery substring and produces a separate targeted report.

Set `PREMIUM_RECOVERY_PRODUCTION=1` with a production frontend URL to save the five-case UI subset separately as `qa-recovery-production.json`. Its preload event remains an injection; blocking the entry script uses genuine request interception.
