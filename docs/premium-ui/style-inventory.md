# Frontend style inventory

The machine-readable inventory is [style-inventory.json](style-inventory.json). It parses all three CSS files and 45 TypeScript files currently under `frontend/src`, with source hashes, line references, selector scopes, declaration values and important flags. Run from `frontend`:

```powershell
node tests/premium-style-inventory.mjs --write
node tests/premium-style-inventory.mjs --check
```

The check compares the complete regenerated source inventory with the saved artifact. It checks freshness and parsing, not rendered behavior. It uses the installed TypeScript and PostCSS tooling; no application dependency was added.

## Findings to review

| Inventory category | Count | Interpretation |
| --- | ---: | --- |
| Custom-property definitions | 308 | Includes light/dark, media scopes and later overrides |
| Distinct custom-property names | 104 | A name may have several intentional definitions |
| Color declaration candidates | 487 | Token definitions plus literal declarations |
| Non-token literal-color declarations | 239 | 215 in styles.css, 24 in premium-theme.css |
| Selector rules | 2,573 | Includes repeated and scoped rules |
| Repeated-selector groups | 149 | Review cascade and scope; repetition alone is not a defect |
| Inline style fragments in TypeScript strings | 19 | May be incomplete across template interpolation or inert markup |
| Runtime style assignments/calls | 8 | Actual AST expressions; not evidence that every expression executes |

No declaration was deleted or consolidated by this inventory. Source counts must never be presented as runtime passes, accessibility violations or dead-code findings.

## Semantic groups already present

| Purpose | Existing token family / source | Review rule |
| --- | --- | --- |
| Brand and primary interaction | `--color-primary*`, `--color-accent*`, royal navy framing | Keep primary actions distinct from scheduling severity |
| Decorative identity | `--royal-champagne`, `--royal-burgundy` | Do not repurpose gold as warning text or burgundy as an arbitrary deletion signal |
| Foreground and surfaces | `--color-text*`, `--color-bg*`, `--color-surface*` | Check actual foreground/background pair in both themes |
| Input and focus | `--color-input-border`, `--color-focus`, `--control-height` | Preserve visible focus, native platform behavior and target size |
| Interaction disabled state | `--color-disabled-*` | Disabled status still needs an understandable reason where relevant |
| Operational feedback | `--color-success-*`, `--color-warning-*`, `--color-error-*`, `--color-info-*` | Text and actual state remain authoritative; color is supplementary |
| Charts and measured quantities | Existing chart classes, tokens and generated dimensions | Preserve categories, labels, units, calculations and export content |

`premium-theme.css` supplies the active royal theme after legacy styles. The inventory also retains component-reference CSS as a separate source: its existence does not mean that the reference page is part of an operational route. Multiple `:root` definitions and repeated property names are expected across legacy foundations, theme overrides and dark-mode scopes. A safe consolidation must preserve effective cascade order and computed states.

## Inline exceptions

The eight runtime style expressions consist of the sidebar's document-scroll lock, member-row display filtering and the member dialog's visual-viewport height/top updates and cleanup. These have behavior behind them. Moving or deleting them based only on appearance could break drawer scrolling, search results or mobile dialog positioning.

String fragments include chart heights, balance-review positioning, skeleton widths and local spacing. The AST records the containing literal's starting line; an interpolation may split the attribute, so the recorded fragment is not a complete HTML attribute or a precise count of rendered elements. In particular, chart dimensions must remain data-dependent. The separate action and render tests establish behavior; this inventory cannot do so.

## Safe consolidation sequence

1. Pick a specific source declaration and inspect its complete selector, at-rule scope and later overrides.
2. Identify actual operational and reference surfaces using it, including roles and failure states.
3. Capture computed light/dark and focus/hover/disabled/error states before editing.
4. Replace a literal only when the semantic token represents the same purpose and preserves the measured state.
5. Verify geometry, contrast and the actual control outcome; retain compatibility rules until their supported context is proved redundant.
6. Regenerate this inventory and keep before/after evidence. Never infer equivalence from reduced CSS size alone.

The parser enumerates current source declarations. It does not resolve the cascade, inherited variables, JavaScript aliases of `style`, external/dependency styles, dynamically loaded third-party styles, `frontend/public` bootstrap CSS or `index.html`. CSS named colors are a targeted common-name list, not the entire CSS color grammar; color functions are identified by their start, with the full declaration retained for review. These are explicit inspection limits rather than a claim of a universal CSS analyzer.

## Overview correction verified in this batch

At 320px the existing two-column tile arrangement split **Template** across two lines inside a 127px button. The Overview stage grid now fits the available panel width with intrinsic column sizing. Buttons keep a shrinkable text track and natural height; no stage, status, handler or request changes.

`qa-overview-steps-before.json` records the original line count. `qa-overview-steps.json` records 30 layouts across three engines, light/dark themes and widths 320/390/769/1280, including six local enlarged-text layouts. Every label remains on one line without local overflow, and all four actual stage buttons reach their intended view with May 2026 preserved and heading focus restored: 120 keyboard outcomes. Thirty scoped axe checks report zero tagged violations. Local 32/28px text overrides are not proof of real browser zoom or software-keyboard behavior.

Coordinator inspection of mobile light and enlarged-text dark screenshots found the labels readable. This resolves the narrow Template defect observed in the earlier role screenshot for the tested contexts. Physical-device, native assistive-technology and fresh independent-review checks remain pending, and the full 260-item programme is incomplete.
