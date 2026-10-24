# Frontend component acceptance specification

This is the review contract for requirements 16, 27, 28, 40 and 202. It specifies expected behavior; it does not certify every operational instance. The isolated `/component-reference.html` page demonstrates local samples. Actual member, leave, import, generation and administration controls require their own outcome evidence.

## Foundation

`frontend/src/premium-theme.css`, imported after legacy styles, supplies semantic light/dark overrides. Use `--color-primary` for primary action identity, `--color-sidebar` for navy framing, and champagne for restrained decoration. Use success, warning, error and information tokens with explicit words for operational meaning. A destructive action must remain distinguishable from brand decoration.

Use the existing spacing scale: 4, 8, 12, 16, 20, 24, 32, 40 and 48 pixels. Control minimum height is 44 pixels. Editable text is at least 16 pixels. Field, compact card, panel and dialog radii use the existing 8/10/16/20 pixel tokens. Long labels and translated or user-supplied values may increase height. Avoid fixed content heights that truncate records or warnings.

Keep table comparison inside a named keyboard-accessible horizontal scroll region when necessary. Keep navigation, captions, error messages and pagination outside that overflow where practical. Page-level horizontal scrolling is a failure. Dialog bodies scroll independently while their title, close control and actions remain reachable at short viewport heights.

## State contract

| State | Visible and semantic outcome | Required interaction check |
| --- | --- | --- |
| Default | Readable label, existing purpose and clear control boundary | Pointer and keyboard invoke the same existing action and context. |
| Hover | Existing semantic color changes without moving content | Pointer does not reveal essential information unavailable to keyboard/touch. |
| Focus | Visible outline with adequate separation from its surface | Tab order follows reading order; focus is not hidden behind sticky regions. |
| Selected | Text plus existing selected/checked/current state | Tabs expose their selected panel; a selection change produces meaningful content. |
| Disabled | Reason is visible or programmatically associated where prerequisites are unclear | Unavailable action sends no request; enabling follows the existing prerequisites. |
| Busy | Operation-specific pending text and an accessible busy/status signal | Repeated activation sends one mutation; unrelated navigation is governed by existing draft protection. |
| Error | Plain explanation, retained safe draft/context and appropriate next action | Validation associates errors with fields; retry follows the original operation's semantics. Confirmed writes are never automatically replayed. |
| Success | Truthful result tied to the confirmed operation | Fresh read-back is checked when supported. Download handoff is not described as a confirmed operating-system save. |

Native states remain native: use `disabled`, `checked`, `required`, `aria-invalid`, `aria-selected` and `aria-busy` where appropriate. Do not substitute a CSS class for unavailable keyboard behavior. Do not mark a field invalid after its corrected value has successfully passed validation. A status announcement must not steal focus from a newer deliberate action.

## Variants

| Component | Required variants and recovery |
| --- | --- |
| Actions | Primary, secondary, quiet, destructive, icon with accessible name; all applicable states above. |
| Fields | Text, selection, date, multiline, checkbox; empty, populated, required, invalid, disabled and correction. Native date input behavior remains browser-owned. |
| Tabs and rails | Selected/unselected, keyboard movement, tab order, selected panel, wrapping or local overflow at narrow widths. |
| Tables and lists | Loading, empty, populated, long values, multiple pages, filtered-empty and failed refresh with truthful freshness. Preserve scope and current selection when supported. |
| Dialogs | Initial focus, confirmation prerequisite, busy close policy, Escape/Close, dirty refusal, retry, focus restoration and obsolete-response isolation. |
| Feedback | Information, success, warning and error text; persistent actionable errors; dismiss controls; reduced motion; no duplicate announcements. |

## Verification matrix

Review both light and dark themes. Test 320×568, 390×844, 844×390, 1024×768 and 1280×720 plus relevant breakpoint edges. Use Chromium, Firefox and WebKit for meaningful interaction differences. Measure actual rendered foreground/background combinations, including hover, selected, disabled, errors and focus: normal text at least 4.5:1; large text and applicable essential non-text boundaries at least 3:1. Disabled controls retain readable explanatory text even where contrast exemptions apply.

Check reduced motion and forced colors separately. Do not rely on screenshots alone for focus, accessible names, tab selection, disabled behavior, error associations or request counts. Capture screenshots with settled fonts/data and record the exact theme, viewport, source hashes and fixture. Assert outcomes using normal pointer/keyboard activation. Synthetic duplicate, print and unload checks must be labeled as such.

An item can be signed off only for its documented scope after visual, responsive, accessibility, reliability and interaction reviews. Aggregate screen coverage is not every-state coverage. Physical-device checks remain pending at the user's direction; browser emulation does not certify native keyboards, rotation, physical printing, password managers or native screen readers.
