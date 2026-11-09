# Shared semantic-color register — 9 November 2026

This is the source-grounded definition deliverable for approved item22. It maps the five requested purposes: brand identity, interaction feedback, scheduling status, chart categories and destructive actions. It records implemented mappings and explicit exceptions/nonconformances; it does not certify rendered contrast, consolidate CSS, change scheduling rules or accept any requirement. The companion JSON freezes inspected sources, token declarations and source anchors for independent review.

## Authority and interpretation

`frontend/src/main.ts` imports `styles.css` then `premium-theme.css` (lines51–52); `component-reference.ts` imports these in the same order followed by its isolated reference CSS (lines2–4). `premium-theme.css` is the documented royal semantic-value authority. Its root light declarations and dark media overrides supply the active royal values; older `styles.css` declarations remain compatibility defaults. A repeated name, literal or selector is not by itself a runtime defect. Specificity, inheritance, media scope and import order still apply.

Colors communicate presentation purposes, never permission, eligibility, approval or saved success by themselves. Existing server data and source classification remain authoritative. Text, names, numbers, selected-state attributes and non-color cues carry meaning. A color reused across purposes must have an explicit component mapping below; such reuse does not make brand violet mean operational approval, gold mean warning, or burgundy mean deletion.

## 1. Brand identity

| Named purpose | Implemented source mapping | Meaning and restrictions |
|---|---|---|
| Royal navigation/workspace frame | `--color-sidebar`, `--color-sidebar-depth`, `--dialog-header-bg`; `.sidebar` in premium-theme.css:181, native workspace header rules:274–277 | Navy frames navigation/dialog identity. Ordinary panels use surface tokens; darkness does not indicate unavailable or dangerous content. |
| Primary interaction identity | `--color-primary`, `--color-primary-dark`, `--color-primary-light`; `--color-accent` aliases primary, `--color-accent-hover` aliases primary-dark | Violet identifies primary interaction and selection, not scheduling success. See interaction-specific mappings below. |
| Decorative champagne | `--royal-champagne: #b99046`; `.brand-mark` border, premium-theme.css:182; `.brand` separator uses equivalent alpha literal at:183 | Identity detail/separator only in the intended palette. No operational state is inferred from these decorative borders. Other usages are classified below, not silently approved. |
| Controlled burgundy accent | `--royal-burgundy: #8c2846`; `.superadmin-person.is-cross-level` and selected variant, styles.css:7250–7251 | Current cross-level roster accent accompanies explicit cross-level text/icon. Not the shared destructive-action token. Operational accent exception is documented below. |
| Readable content hierarchy | `--color-bg*`, `--color-surface*`, `--color-text*`, `--color-border*`; premium-theme.css root/dark scopes | Canvas, panel, raised/muted surfaces and ordinary text are neutral infrastructure. They do not encode readiness, clinical severity or approval. |

The companion JSON contains exact current light/dark token declarations rather than a second manually maintained palette. Dark inheritance is explicit: a light-scope token without a dark override continues to apply; this does not assert that every inherited pairing is accessible.

## 2. Interaction feedback

| Named purpose | Implemented selector/token mapping | Text/shape/state semantics |
|---|---|---|
| Primary default | `.primary`, styles.css:5142; accent fill/border and `--color-accent-contrast` text | Actual button/link name describes the action. Violet alone does not mean saved or approved. |
| Primary hover/focus | `.primary:hover:not(:disabled):not([aria-disabled="true"]), .primary:focus-visible`, styles.css:5149; accent-hover | Darker violet is an interaction state; existing outline remains a separate keyboard indicator. |
| Primary pressed | `.primary:active:not(:disabled)`, premium-theme.css:215; primary-dark | Temporary activation feedback; not a persistent operational result. |
| Keyboard focus | `--color-focus`, `--focus-ring`; workspace outline override styles.css:5491; header/sidebar white outline override:6302 | Outline/offset identify focus independently of selected state. Specific dark-header and forced-colors overrides are contextual exceptions. |
| Active profile selection | `.mw-rail button[aria-selected='true']`, premium-theme.css:286–295; primary-light/link/input-border | `aria-selected` plus persistent underline for non-compute member workspaces supplies non-color selection. Compute rail is intentionally excluded from that underline rule. |
| Active mobile navigation | `.mobile-bottom-nav button.active`, premium-theme.css:506; primary-light/link | Active class and button name describe navigation; not workflow completion. |
| Other active selections | `.analysis-tab-btn.active`, styles.css:4339; sidebar-hover/inverse; `.rr-tile[aria-pressed="true"]`, styles.css:6468; info-text border/inset | These are existing contextual selection exceptions, not error/success semantics. Their attributes and labels remain authoritative. Violet convergence is unfinished under item24. |
| Disabled/busy | styles.css:5194–5211; disabled-bg/text/border, disabled or aria-disabled/aria-busy attributes | Unavailable state is distinct from branded fill. Reason/help text is component-owned; no claim that every disabled control already has an explanation. |
| Success/warning/error/information feedback | `.ds-badge--success/--warning/--danger/--info`, styles.css:5346–5349; matching semantic bg/text/border families | `ui.ts:102` escapes and renders the caller's explicit label. Feedback tone reflects the calling component's known outcome; color never confirms a write independently. |
| Neutral/unknown feedback | base `.ds-badge, .status`, styles.css:5329–5343; surface-muted/text-secondary/border | Neutral means the component's explicitly stated neutral/inactive/missing state, not success. `.ds-badge--neutral` inherits the base mapping. |
| Invalid field | premium-theme.css:221–223; error border and inset | Field invalid semantics/error text provide meaning; do not introduce business validation through CSS. |

## 3. Scheduling and operational status

These are concrete current component mappings, not new approval rules or status transitions.

| Operational purpose/state | Current source mapping | Independent meaning/cue |
|---|---|---|
| Leave approved | `main.ts:4100–4102` → `badge(...,'success')` → shared success family | `leaveStatusLabel`, main.ts:3770–3780, prints Approved. |
| Leave requested/imported pending review | Same classifier → warning family | Labels Requested / Imported, Pending Review. Tone does not grant approval. |
| Leave rejected/cancelled | Exact values `rejected` / `cancelled` → neutral family | Explicit Rejected / Cancelled labels; cancellation is historical status, not a new destructive button. The alternate label alias `canceled` is normalized to Cancelled text but currently falls through to warning tone; recorded as nonconformance below. |
| Leave pressure normal/watch/high | `.leave-calendar .leave-pressure-normal/--watch/--high`, styles.css:6144–6148; respectively info border, warning bg/border, error bg/danger border | Calendar dates, reported counts and pressure details supply context. Count fills use separate solid warning/error colors; these need actual-pair contrast verification. Pressure is not an approval status. |
| Workflow done/blocked/pending/unknown | `main.ts:687–707` classifies existing publish/readiness data; labels Done / Needs action / Not started / Open to check | No new readiness policy defined here. Latest data/freshness context governs presentation; unknown/stale is not shown as freshly complete. |
| Workflow sidebar state | `.nav-step[data-state="done"]`, styles.css:5598–5599 uses fixed green; blocked:5600–5601 fixed amber; pending:5602 hollow outlined state dot; unknown uses base neutral | Number, stage name and workflow state text supplement colored dots. Fixed dark-frame colors are an explicit component exception to shared semantic tokens. |
| Workflow Overview state | `.overview-step[data-state="done"]`, styles.css:6237 uses success-bg/text; blocked:6238–6239 warning border/bg/text | Same operational state labels; palette adapted to light/dark content surfaces. |
| Workflow freshness | `.workflow-freshness` and `.nav-workflow > .workflow-freshness`, premium-theme.css:1073–1074 | Secondary text on content versus inverse-muted on navy. Actual “Last known”/checking/unavailable wording carries meaning; no gold decoration substitutes for stale-data disclosure. |
| Member active/archived/other | `main.ts:3516–3518`; active success, archived warning, otherwise neutral | Existing active-status name is printed. Archived warning is attention for selection/eligibility context, not a destructive action. |
| Unit setup issues | `main.ts:4476–4500`; error→danger / warning→warning badges | Error/Warning words and counts; do not change issue severity or configured thresholds. Monthly leave record totals remain record coverage, not an invented availability assessment. |
| Rota review alert/warning/good | `.rr-tile.is-alert/.is-warn/.is-good`, styles.css:6472–6476 | Danger/warning edge+text or success edge accompanies named metric and numeric value. Selection border/aria-pressed is separate from severity. |
| Manual review | `.manual-review-panel`, styles.css:1034–1068; manual-review bg/border/badge-bg/badge-text | Explicit review summary/badge text; intentionally warning-related rather than champagne decoration. |
| Roster command/audit context | `.roster-command`, styles.css:1729–1732; roster-command bg/border; `.audit-chip-row > span`, styles.css:1772–1775; audit-chip bg/border | Context grouping only. Green-tinted framing is not proof that a command succeeded or an audit was completed. |
| Import member match | `ui.ts:241–254`; matched+name success, not_found neutral, conflict danger, other states warning | Matched / Several members fit / Member not active / No such member / Needs your choice; identity text and pending choice text distinguish review from confirmed selection. |
| Extra duty fallback/active/void | `.extra-duty-badge--fallback/--active/--void`, styles.css:6772–6774 | Warning/success/neutral families; actual badge words carry state, not whether a scheduling mutation is permissible. |
| Balance review ok/warn/cross/swap/extra | styles.css:7370–7373,7457 | ok success; warn/cross warning; swap info; extra primary outline with ordinary text. Extra is a workload category, not approval or readiness. |
| Limits hard/soft/guide | `.limits-badge--hard/--soft/--guide`, styles.css:7066–7068 | Danger/warning/info families with explicit hard-limit / can-exceed / guide language. Colors cannot alter the limit policy. |

## 4. Chart categories and measured quantities

| Chart purpose/category | Current mapping | Meaning beyond color |
|---|---|---|
| Analysis Weekend | `.analysis-chart .weekend-bar, .analysis-chart-swatch.is-weekend`, premium-theme.css:717; primary fill plus diagonal light stripes | `analysis-charts.ts:31`: “Weekend · striped”. Color is a category key, not primary-action affordance or severity. |
| Analysis Weekday | `.analysis-chart .weekday-bar, .analysis-chart-swatch.is-weekday`, premium-theme.css:718; text-secondary solid fill | “Weekday · solid”. `analysis-charts.ts:21–25` plots total minus weekend for stacked entries. Preserve this existing calculation. |
| Analysis unstacked total | `analysis-charts.ts:25` renders total with weekday-bar class | With no weekend field, solid fill means the single total series, not a claim that all duties were weekdays. Table heading remains Total; no stacked legend is rendered. This is an explicit class-reuse exception. |
| Legacy/base bars | `.weekend-bar` / `.weekday-bar`, styles.css:780–785; primary / focus | Compatibility rules; the more-specific actual `.analysis-chart` rules above override them. Do not infer current analysis weekday fill from the legacy focus token alone. |
| Unit distribution relative magnitude | `.rota-distribution-track i`, styles.css:6196 uses focus token; `main.ts:6364?6383` renderRotaTemplateDistribution block emits data-dependent width, named unit and counts (width is relative to the largest count, not a percentage share of total) | Focus violet is reused as a quantitative series fill, not actual keyboard focus. Text values remain the authority. Preserve width calculation and exported values. |
| Invalid/zero/empty analysis values | `analysis-charts.ts:12–39` | Zero bars hidden; unplottable values get unavailable indication plus data-table note; empty scope has explicit text. Do not encode missing data as a success-colored zero. |
| Forced-color chart category | premium-theme.css:730–732 | Weekend uses Canvas/CanvasText stripe; weekday solid CanvasText; borders retained. This is an accessibility category exception, not a change in chart meanings. |

`analysis-charts.ts:30–43` supplies figure naming, category legend and a named data-table disclosure with Period/Total/Weekend/Weekday columns. Visual columns are aria-hidden duplicates of those values. This register documents the existing text/pattern alternatives; it does not certify every chart's runtime accessibility or 3:1 graphics contrast. No dedicated `--chart-*` tokens currently exist: chart purposes are separately named here while implementation reuses existing tokens intentionally. Future aliases must preserve category meanings, calculations and exports.

## 5. Destructive actions

| Named purpose | Implemented mapping | Required distinction |
|---|---|---|
| Shared destructive action | `.danger-button`, styles.css:5161–5175; surface/error-text/danger-border, hover/focus error-bg/error border | The action name says what will be deleted/cancelled/merged. Red is distinct from brand violet; confirmation and existing backend authorization remain unchanged. |
| Compact destructive row action | `.row-menu__list .row-menu__danger`, styles.css:5816; error-text; leave row examples main.ts:4107–4111 | Explicit “Cancel leave…” / “Delete leave…” text and menuitem semantics. A compact context does not remove destructive wording. |
| Member-workspace destructive action | `.member-workspace .danger-button`, styles.css:5490 | Surface/error-text/danger-border, deliberately different from `.member-workspace .primary`. Source authority is shared danger semantics, not burgundy brand decoration. |
| Superadmin destructive action | `.superadmin-danger-button` plus scoped variant, styles.css:6995–6998; fixed #9f1d35, darker hover #861629, white text | Existing filled destructive variant, explicitly named actions and focus ring. Contextual exception to the outlined shared danger button; not a new brand/burgundy purpose. |
| Cross-level caution icon | `.superadmin-person__cross-icon`, styles.css:7253; `.superadmin-cross__icon`, styles.css:7257; error fill/white icon | Operational caution accompanying explicit cross-level text, not itself a destructive action. Do not restyle all error-colored components as deletion affordances. |

## Exception and nonconformance disposition

“Exception” documents a current contextual mapping; it does not exempt contrast, focus, wording or later original requirements. “Nonconformance” identifies a source inconsistency or potential failure requiring separate implementation/runtime work, not a passed outcome.

| ID | Classification | Exact source/context | Disposition |
|---|---|---|---|
| E01 | Legitimate contextual mapping | Fixed dark-frame workflow green/amber at styles.css:5598–5602 | Separately mapped to readiness; do not replace with decorative champagne. Consolidation/equivalence remains item21 work. |
| E02 | Legitimate semantic reuse | Chart primary/text-secondary/focus at premium-theme.css:717–718 and styles.css:6196 | Explicit chart categories above prevent interaction/approval meaning being inferred. Dedicated aliases are a future maintainability option, not a missing category definition. |
| E03 | Legitimate shape/data alternative | Analysis stripe/solid legend and data table, analysis-charts.ts:30–43 | Preserve patterns, labels, unavailable text and numeric table. No chart contrast pass inferred. |
| E04 | Legitimate contextual action variant | Filled superadmin destructive control styles.css:6995–6998 | Same destructive purpose as outlined danger action; preserve names/confirmations. |
| E05 | Documented operational accent exception | Burgundy cross-level roster edges, styles.css:7250–7251; accompanying superadmin.ts cross-level text | Distinguish cross-level attention from deletion. Item26 must separately review whether this controlled accent is effective in both themes. |
| E06 | Accessibility adaptation | forced-colors rules premium-theme.css:609 onward and chart block:730 onward; white header/sidebar focus styles.css:6302 | System colors/contextual focus are intentional; no requirement to remain literally violet in forced colors. |
| E07 | Decorative duplicate, exemption requires context | aria-hidden success/published/cross icons, superadmin.ts:135,313,344,393,634; step dots ui.ts:146 | Adjacent explicit wording exists; cannot automatically call low-ratio icon fills an essential-graphic failure or automatically exempt every usage. Item28 must classify actual rendered context. |
| N01 | Source-purpose nonconformance against item25 | Champagne-like #e2c589 active-nav marker/focus, premium-theme.css:187,190 | Active selection/focus is interaction feedback rather than identity detail/separator. Record separately for token/interaction refinement; not approved as decorative usage by this register. |
| N02 | Potential contrast nonconformance, runtime not measured | 12px leave-watch count #1f1300 over light warning #956315, styles.css:6136,6146 | Arithmetic ratio3.5378:1 suggests a normal-text issue. Reproduce actual count/background/state, then fix under item28; do not report an executed browser failure here. |
| N03 | Unresolved actual-context contrast classification | White completed-step/success/published icons over dark success/warning, styles.css:6270,7004,7023 | Arithmetic ratios2.4444/2.0337; inspect essential versus decorative status and actual state. Source calculation alone is not runtime verification. |
| N04 | Unresolved champagne text context | `.limits-eyebrow` at styles.css:7045 and dialog context:7176 | Champagne/white arithmetic2.9409. Higher-specificity `.limits-hero__text p` overrides hero text, so do not infer all eyebrow instances fail. Inspect dialog contexts before changing. |
| N05 | Source-status tone inconsistency | main.ts:3777 labels `canceled` as Cancelled, but classifier:4101 only tests `cancelled` | Alternate spelling currently maps warning rather than neutral. Explicitly document; any normalization/status change requires separate scope review, not a CSS correction or invented backend transition. |
| N06 | Incomplete legacy consolidation | Competing root/dark definitions styles.css:5,111,5018,5049; active premium root/dark | Documented authority exists, but computed-equivalence proof and safe deletion remain incomplete under21. No blanket consolidation completion. |
| N07 | Selection palette divergence | analysis-tab-btn.active styles.css:4339; rr-tile pressed:6468 versus violet primary/profile mapping | Current named interaction exceptions are explicit; original24 violet consistency still needs contextual refinement/testing. No interaction completion inferred. |

## Independent review and evidence boundary

Item22 condition1 is satisfied by the five named source maps above if independent review confirms their accuracy/completeness. Condition2 is addressed by the explicit contextual exceptions, text/shape meanings and nonconformances: decoration must not imply operational state. Review should inspect the companion frozen hashes and anchors, verify the current values/selector scopes against source, and check that no category or exception has been misrepresented. This document alone does not change traceability status; root owns acceptance after independent review.

No browser, physical-device or native-assistive checks were run for this document. No CSS, application source, backend, API contract, permission, persisted-data semantics, scheduling calculation or export content was changed. Original21,23–28 and the overall260-item goal remain governed by their own acceptance conditions.
