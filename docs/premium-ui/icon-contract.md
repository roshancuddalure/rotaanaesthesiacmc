# Local decorative icon contract

`frontend/src/decorative-icons.ts` owns the existing SVG family used by the application shell, rules editor and Limits page. The eight glyphs are close, menu, star, warning, lock, check, chevron and search. Each uses a 24 × 24 view box, two-unit rounded strokes, no fill and `currentColor`. Paths are local constants; there are no font glyphs, remote images or icon-library requests for these icons.

The helper always emits `aria-hidden="true"` and `focusable="false"`. Meaning remains in adjacent text or the enclosing control's accessible name. It must not be used to replace meaningful text with an unnamed icon-only button. Caller-supplied CSS classes are escaped before insertion.

Existing sizing and state classes remain authoritative: shell menu/close boxes keep their existing 24/20-pixel geometry; rules and Limits icons keep their 16-pixel boxes, with smaller rule tags as already styled. Checked chips and expanded chevrons retain their existing visibility and rotation classes. The Limits identity star now uses the same SVG treatment rather than depending on a font glyph.

The source migration covers all SVG literals previously authored directly in `main.ts`, `rota-rules.ts` and `limits.ts`. It is not an exhaustive acceptance claim for every Unicode character used as a textual arrow, close label, status symbol or user-provided value elsewhere. Those cases require contextual classification; replacing visible text indiscriminately would change accessible names.

Verification combines a twelve-context Chromium/Firefox/WebKit light/dark 320/1280 icon gallery and actual mobile shell open/close/focus checks with the existing Limits, rules and shell workflow suites. Gallery checks prove the shared helper's geometry and decorative semantics, not every operational placement. Physical devices and native assistive-technology walkthroughs remain pending.
