# Foundation review and proposed next batch

Read-only specialist review on 28 October 2026. No application, backend, ledger or acceptance changes. This is a bounded proposal, not whole-item acceptance.

## Actual contrast evidence

`foundation-state-probe-current.json` records 168 Chromium samples: actual canonical member profile Save/name/close/selected tab, and the actual isolated component reference primary/secondary/quiet/destructive controls and inputs. Light/dark at 320/1280; default, native pointer hover/down, keyboard focus and disabled states where relevant. Source hashes cover every source TS/CSS input and the probe test has its own hash. Click activation is temporarily suppressed during pointer-pressed measurement: this verifies style, not an operational action outcome.

No measured enabled normal-text pair failed 4.5:1. Dark primary default is 4.78:1; hover 6.31:1. Actual name field boundary is 3.05:1 light/3.64:1 dark; focused field outline 7.50:1 light/8.70:1 dark. Disabled controls are explicitly exempt from text threshold. Ancestor RGBA stacks and gradient/opacity uncertainty flags are retained; no universal background assumption. Selected-tab light border alone is 2.73:1, but its existing three-pixel contrasting text underline already indicates selection. Dark hovered primary background boundary alone is 2.68:1, but contrasting button text identifies that control. Neither lower boundary figure alone establishes an applicable essential non-text failure. Do not recolor shared tokens on that basis.

This does not accept 24/27/28 globally: other operational controls, statuses, charts and contexts remain outside this probe, and Firefox/WebKit were not run here.

## Item 37: classification before migration

`tmp/foundation-close-proposal/classification-and-preservation.json` classifies 76 source occurrences of an explicit graphical candidate set and literal SVG markup, retaining source line/context and distinguishing comments from renderable literals. Meaningful comparison/mapping arrows and accessible sort direction suffixes remain text. Decorative check/star/status glyphs have their adjacent or visually hidden status meaning identified separately. This explicitly bounded set does not claim to enumerate arbitrary user text or dependency assets.

The scratch patch replaces 16 named close-button glyphs in ten source files with the existing local `decorativeIcon("close")`. Attributes, accessible labels, handler selectors and control types stay byte-identical. All assigned `on*` callback and `addEventListener` AST nodes compare byte-identically in the scratch before/after files. Imports are the only additional source statements. No patch was applied. Regenerate against the latest held snapshot before applying; do not copy historical whole-file proposals over subsequent work.

Runtime gate for that batch: enumerate all 16 controls, open each actual dialog using its native launcher with locally fulfilled reads, verify the original accessible button name, the helper's hidden/focusable attributes and two-unit stroke, and check icon alignment without changing the existing 44-pixel target. Native keyboard activation must close the intended dialog and return focus to its actual launcher. Refused-discard and pending-save controls must preserve their existing lifecycle; reuse their current meaningful tests. Assert no unexpected requests or mutations. Three engines, 320/1280 and light/dark; reduced height and enlarged text on representative long-heading dialogs. A shared helper gallery alone cannot prove those 16 placements.

Decorative status/star/check glyphs in superadmin, progress steps, publish checklist and compute progress require a separate measured migration or documented purposeful exception. Preflight's visible `Ready`/`Needs Review` status text is retained; do not remove or hide meaningful status to normalize an icon. Existing local icon tests cover the helper gallery and shell; they do not certify every operational placement.

## Item 38: meaningful font/resource failure check

Inspected body stack is `Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`; local SVGs have no icon-font dependency. Existing icon tests observe zero remote requests; they do not actually force optional-resource failure or unavailable primary font.

Use the unchanged application stack and inject a test-only `@font-face` for the primary `Inter` family whose source request is deliberately aborted. Record that request failure, settled `document.fonts.ready`, the original computed stack and a rendered text-width/line-box check; do not substitute a different application font stack and then claim it is the deployed fallback. Abort all optional external font/icon requests, recording that an absence of such application requests is an absence, not a tested remote dependency. Local SVG paths must remain visible and adjacent text/accessibility names intact. Exercise actual menu open/close, one profile edit/cancel and the reference's local action outcome. Check 320/1280, light/dark, all engines, enlarged text, document overflow and 44-pixel targets. Intercept all API traffic locally and assert exact expected reads, with no real persisted write.

## Item 39: complete imperative and CSS motion matrix

Five inspected guarded imperative smooth-scroll callsites need native route coverage:

1. `main.ts` `scrollUnitAssignmentIntoView`: actual unit validation reveal (historical unit-motion suite covers this branch).
2. `limits.ts` `focusSetting`: actual validation/problem link reveals and focuses the affected setting.
3. `limits.ts` `[data-toc]` click: actual section shortcut scrolls and focuses its heading.
4. `rota-rules.ts` `goToDuty`, guard branch: actual guard problem reveals and focuses the guard field.
5. `rota-rules.ts` `goToDuty`, duty branch: actual problem link resets incompatible filter, expands the correct group/duty and focuses the requested field.

For each: drive the actual control using native pointer/keyboard; wrap `Element.prototype.scrollIntoView` only to record options and delegate unchanged to the original. Compare reduce=`auto` against no-preference=`smooth`, then verify the intended target is visible/focused and unrelated drafts/month/filter semantics remain correct. Three engines and 320/1280. Do not directly call internal functions as a substitute for route behavior.

Inventory CSS animation/transition selectors, pseudo-elements, and keyframes. The global reduced-motion declarations disable them with `!important`; source presence alone is insufficient. Hold actual loading states via delayed local reads (profile skeleton, spinner, import/compute pending, notification, dialog entry, unit highlight). Inspect computed animation names/durations/iterations and transitions on each applicable element/pseudo-element, and verify text/busy state remains visible when motion is removed. Release each read and assert the intended ready/recovery outcome. Record selector contexts that cannot be rendered rather than silently excluding them. Verify normal-motion 120/200/300-ms shared tokens and separately document justified literals/continuous loading. No API payload or timing-based mutation behavior changes are authorized.

## Remaining 21–28 and 30–60 priorities

The token authority and role-mapping documents accurately disclose intentional legacy compatibility and adoption gaps. Do not delete legacy declarations solely to reduce repeated selector counts (21). Extend actual state/semantic context coverage (22–28) before consolidating; category counts are source discovery only. Text casing/elevation historical probes cover selected guide/account/profile/More contexts, not every typography/shadow declaration (30–33/36). Documented spacing/radius roles (34/35) are already separate accepted deliverables; adoption is still broader implementation work.

For layout 41–60, prioritize an explicit component/container fallback matrix: profile rail, compute methods, date/summary and alias rows. Existing `@supports(container-type)` and intrinsic/media fallback rules need tests with actual absent container-query support, not only small viewports (45/46). Then enumerate every 700–768 breakpoint with below/at/above geometry, keyboard access and draft preservation (47). Use long unbroken identity/error text and actual final review rows for 44/49/52/56/58; page overflow alone cannot certify close-button hit testing, essential text visibility, sticky clearance or final action access. Preserve one primary editor DOM and its drafts across those transitions. Dynamic viewport/safe-area/keyboard emulation must retain their explicit physical-device limitation (50/51/54/59). Comparison overflow inventories alone do not prove scrolling affordances and keyboard usability (53/60).

Recommended sequence: finish current import scope batch; regenerate close-only proposal; run its bounded runtime matrix; finish font and motion tests; then take the container-query fallback/breakpoint batch. Keep the full 260-item objective open throughout.
