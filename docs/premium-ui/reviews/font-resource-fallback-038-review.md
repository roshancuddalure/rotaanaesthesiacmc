# Item 38: focused font-resource failure evidence

This specialist batch adds a browser test and evidence only. Application, API, backend, database and acceptance files are unchanged. It does not automatically accept item 38.

The original requirement is: “Provide reliable local font and icon fallbacks so blocked resources cannot erase labels or alter control usability.” The two original pass conditions cover local stacks/assets and blocked-resource usability. The report at `font-resource-fallback-current.json` is authoritative for the executed matrix, failures, source hashes and the exact test hash.

## Classified source observations

The source scan covered `frontend/src`, `frontend/index.html` and `frontend/component-reference.html`. No application `@font-face`, CSS `@import`, WOFF/TTF/OTF URL, Google Fonts, Font Awesome or Material Icons reference was found in that bounded scan. This is a source observation; it does not manufacture a deployed remote dependency to test.

| Applicable source | Classification and fallback |
| --- | --- |
| `frontend/src/styles.css:165` | Main body: `Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`. The test leaves this deployed family stack intact. |
| `frontend/src/styles.css:500` | Readonly identification field: `var(--font-mono, ui-monospace, monospace)`; local generic fallback. |
| `frontend/src/styles.css:3581` | Person metric numerals: `Georgia, "Times New Roman", serif`; local serif fallback. This separate metric surface was classified, not rendered in this focused test. |
| `frontend/src/styles.css:3608` | Person day numerals: the same local serif stack; same explicit runtime limitation. |
| `frontend/src/styles.css:6327` | Raw member-match spelling: local monospace stack; classified, not a full import route certification. |
| `frontend/src/styles.css:6362` | Archive confirmation phrase: local monospace stack; classified, not an archive interaction certification. |
| `frontend/src/decorative-icons.ts` | Eight inline SVG path families with `currentColor`, hidden decorative semantics and adjacent control names. No icon font or network asset. Actual shell menu SVGs are checked during native open/close; this test does not claim every SVG placement. |
| Actual canonical profile close | Existing text close glyph retains its original accessible control name and native close outcome during the forced primary-font failure. No icon migration is included. |

## Failure and interaction method

`frontend/tests/premium-font-resource-fallback.browser.mjs` runs Chromium, Firefox and WebKit sequentially. The intended matrix is 24 contexts: two themes × two widths (320/1280) × two root font-size settings × three engines. Each context exercises the actual application guide/shell, canonical profile module through a native launcher, and actual component reference. Read the terminal report to distinguish intended from completed contexts.

A test-only `@font-face` declares the otherwise optional primary family, Inter, with a deliberately aborted external URL. Each document performs a real font load, records its rejected result and request failure, and waits for `document.fonts.ready`. The declared Inter FontFace must be in error state and its actual load must reject. `document.fonts.check` is retained as a diagnostic: this local WebKit returned true despite the rejected load, so that flag alone is not treated as font availability evidence. Canvas text widths and actual inline rendered widths must agree with the same deployed stack after omitting only unavailable Inter. A positive line box, unchanged deployed computed stack and no page overflow are required. No application font stack is replaced to produce this result.

The test aborts every external request and separately records synthetic versus application resources. Zero application external resources means none were encountered, not that a production external resource was successfully failed. It asserts the exact five expected GET paths and refuses mutations. Fixture forwarding is loopback-only to the disposable RAM fixture. The profile has locally fulfilled reads. It exercises menu opening/closing with native keyboard input on mobile, account menu on desktop, edits and explicitly confirms cancellation of a canonical profile draft, closes the profile, and verifies a reference action's local completion message. Original member name, readonly state, month and zero page errors are asserted.

Control geometry records actual width, height, font size, accessible/visible text and center hit testing. Existing mobile menu controls measure 40 × 44 pixels and are reported as a separate target-size finding. This does not establish font-failure damage: those controls remain named, hit-testable and operational. It also does not satisfy a separate 44 × 44 design goal. Profile and reference measurements remain individually inspectable in the report.

## Limits for independent review

The enlarged setting changes the root font size to 200%. Actual root, body and control font sizes are recorded: fixed-pixel typography can remain unchanged, so this must not be called universal 200% text enlargement. There is no physical-device, software-keyboard, native assistive-technology or operating-system font-installation certification.

These three surfaces and the source classification improve the missing blocked-font evidence. They do not establish every control, every icon placement, every font declaration or a whole-application outage state. No item-38 acceptance ledger change is made by this specialist.
