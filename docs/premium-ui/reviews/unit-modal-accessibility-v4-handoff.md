# Unit modal accessibility: current scratch review packet

The applied app remains at the monthly-unit checkpoint: 40 accepted whole requirements. The source helper below is **not applied**. `unit-modal-accessibility-v4-preview-execution.json` binds the candidate, tests, logs and exact scopes. Earlier V1–V3 prototypes and failures are preserved. Root is the latest author/operator; no independent V4 endorsement is implied.

The current preview is http://127.0.0.1:5215. The applied app is on5197, the read-only dashboard on5199 and the disposable read-only RAM fixture on8031. Obsolete previews created for this batch were stopped after their tests were terminal. No production connection or operational write is needed for review.

## Applied changes already verified

`unit-monthly-v3-integrated-execution.json` records 36 applied browser workflows, 114 unit tests and a held build. Monthly active leave records are distinguished from duty-date availability; unavailable totals are distinct from zero. Counts, forms, API calls and business handlers are retained. Unit title contrast, neutral record chips and 44px header targets are repaired. `unit-monthly-v3-prior40-applicability.json` explicitly retains the prior40 acceptances. The current static review archive is identified by `../review-build-current.json`.

## Candidate and preservation proof

Read `tmp/unit-modal-accessibility-v4/unit-modal-accessibility.ts` and `tmp/unit-modal-accessibility-v4/main.ts` relative to the repository root. Main differs from the current applied source by one helper import and one binding next to `bindLeaveCalendarFocus`. Reversing them exactly restores the existing file. The helper preserves the nested `view-root` modal mount because existing delegated submit, unit navigation, profile and record controls depend on that mount.

The helper makes sibling background branches inert without making the modal's ancestor app inert. It retains prior inert flags and restores them on modal removal, replacement and shell abort. Keyboard focus enters the modal, Tab cycles and Escape calls the existing close function. The original outside opener survives cached unit navigation; fresh corresponding controls are resolved after root rerender. Native dialogs and body overlays own their own keyboard lifecycle.

Native workspaces can outlive replaced unit DOM. The candidate observes direct body dialog additions, listens to their close and defers a guarded recovery microtask until native close handlers finish. It focuses only when a connected unit remains, no higher overlay owns focus and the active element is BODY. A newer deliberate destination wins. Abort disconnects both observers and removes signal-bound listeners.

WebKit pointer activation can blur a button after pointerdown. A narrowly scoped capture click focuses existing unit profile/record opener buttons before their original delegated handlers record the opener. It neither prevents the click nor changes its payload. Event targets may be SVG descendants: `Element.closest` is used in these pointer/click paths.

## Current actual evidence

Thirty actual-app contexts pass:18 keyboard/controller cases across three engines and normal phone/desktop, root font200% and short-height light/dark profiles; six actual mouse/touch native-record plus profile503 cases; six actual mouse/touch loaded-profile, native tab switch and exact-opener-return cases. Six controlled lifecycle contexts additionally assert inert restoration, rerender recovery, native ownership, newer intent and abort cleanup. Controlled fixtures are not substituted for app-controller proof.

The earlier V1 lifecycle probe recorded all six native-rerender cases falling to BODY. V2 closed that gap, while its pointer probe found WebKit returned to the wrong nested opener. V3's pointerdown attempt still failed. V4 capture click passes all six actual mouse/touch cases. V2's test variable also shadowed viewport metadata with a Playwright Locator; original artifacts are retained in `tmp/unit-modal-accessibility-v2-harness-metadata`, and V3/V4 use `profileDialog` with actual viewport profile objects. A first successful-profile test-generation shell command failed before creating a file; the later file-based generator and terminal success are the current evidence. None of those harness/prototype results is an applied-app regression claim.

## Next independent review wave

1. Source and lifecycle reviewer: inspect the whole helper, the two-line main delta and actual shell/native owners. Challenge late close, rapid reopen, existing inert flags, body overlay stacking, account/view teardown and newer focus. Identify concrete defects; do not infer correctness from passing counters.
2. Runtime reviewer: independently exercise the actual controller, native profile/record return and adverse lifecycle cases. Reuse the loopback preview and RAM/GET fixtures. Reject operational writes or fulfill them only inside explicit local fixtures. Inspect selected unit/month, input drafts, actual target and exact focus destination. Preserve existing dirty/pending refusal semantics.
3. Parallel icon reviewer: inspect `tmp/icon037-remaining-proposal-v3`, regenerated against the applied monthly-unit baseline. All45 exact presentation records replay and9-file TypeScript/API/control/serialization proofs pass; runtime gates are still pending. Do not copy its full main/theme over a later accessibility integration. Rebase exact substitutions if that applies first.

These are queued review assignments, not claims that agents are running. More than ten specialists have participated in prior waves; at most three subagents can work alongside root. Latest specialist attempts reached an account usage limit reporting09:09 IST. Resume an available existing specialist after that time; do not repeatedly retry before it or mark the whole frontend goal blocked.

Only after reviewing/fixing the candidate: apply with current-source hash guards, repeat integrated controller/lifecycle checks, run relevant units and held build, revalidate all affected prior acceptance bindings explicitly and seal a new review archive. Do not accept the whole260 or145147 from this bounded repair. Physical devices and native assistive-technology checks remain pending.
