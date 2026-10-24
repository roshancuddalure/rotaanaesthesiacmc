# Royal frontend design system

This document describes the integrated presentation layer. It does not replace backend permissions, scheduling rules or API contracts.

## Source of presentation values

`frontend/src/premium-theme.css` loads after `styles.css` and owns the royal semantic values. Legacy section rules remain as compatibility defaults during migration. Do not remove them blindly: a section may depend on geometry or semantic variables not yet migrated. Any future consolidation must demonstrate equivalent computed styling and workflow behavior before deleting an older declaration.

## Color and state roles

| Role | Light | Dark |
|---|---|---|
| Primary action | #493a8f | #7863c5 |
| Primary hover | #382b72 | #6550b0 |
| Workspace canvas | #f6f5f9 | #111522 |
| Main surface | #ffffff | #1b2033 |
| Raised surface | #ffffff | #262c43 |
| Main text | #20243b | #f0edf8 |
| Secondary text | #4f536a | #cdc8dd |
| Muted text | #656980 | #aba5be |
| Focus | #5942ac | #c4b4ff |
| Decorative champagne | #b99046 | inherited decorative identity |

Success, warning, danger, information and manual-review colors use distinct semantic token families. Champagne does not indicate a clinical warning. Numeric status values and eligibility decisions are unchanged. Forty-eight computed text/surface pairings were measured in the browser during the design integration; all met 4.5:1, minimum 4.78:1. This is evidence for the measured combinations, not a claim about every possible arbitrary background.

## Geometry and typography

- Four-pixel spacing foundation, inherited from existing shared spacing tokens.
- Body and ordinary fields: 16px; secondary data labels: 14px; supplementary metadata: 12px.
- Fields: 8px radius; medium controls: 10px; panels: 16px; major dialogs: 20px.
- Ordinary operational action height: at least 44px. Contextual desktop help can use 24px with a larger touch presentation.
- Tabular numerals for dates, metrics, capacity, workload and diagnostics.
- Comfortable density is the default. Dense comparisons retain explicit local scrolling rather than clipping information.
- Grid/Flex children receive shrink-safe sizing. Toolbars wrap by task hierarchy; long names and errors wrap naturally.

## Component state contract

| Component | States to inspect | Required behavior |
|---|---|---|
| Button | default, hover, focus, disabled, busy, destructive | Clear target; one activation outcome; no duplicate mutation |
| Field | empty, filled, required, invalid, disabled | Persistent label; preserved value; actionable error |
| Record card/table | populated, empty, filtered, stale, failed | Readable labels, correct actions, explicit context |
| Dialog | loading, ready, invalid, saving, failure, closing | Focus containment/return; footer clearance; no late resurrection |
| Profile rail | active, focused, error/draft, narrow | Selected tab visible; correct keyboard model |
| Notice | success, warning, persistent error, recovery | Safe text; deliberate dismissal; no hidden critical state |
| Generation review | queued, working, review-ready, failed/applied | Server state is authoritative; reviewed apply remains separate |

## Mobile and accessibility rules

Use intrinsic layouts, safe-area insets and dynamic viewport sizing with fallbacks. Native dialogs retain visualViewport adjustment. Long comparison tables remain named local scroll regions; document-level horizontal scrolling is a failure. Sticky controls must leave the last content row and focused field visible. Reduced motion disables decorative motion, while forced colors preserves explicit borders and focus. Legacy notifications no longer run a CSS fade-out that could hide persistent errors independently of their JavaScript lifecycle.

## Verification boundaries

Before screenshots and comparisons, settle fixtures and fonts, choose a defined scroll position and reduce animation. Visual review cannot certify action correctness. The action inventory and traceability ledger separately record source discovery, runtime outcomes and pending dependencies. Android/iPhone keyboard behavior and NVDA/VoiceOver are not certified by desktop screenshots or Playwright emulation.
