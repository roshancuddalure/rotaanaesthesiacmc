# Current typography, spacing and radius role mappings

Recorded 24 October 2026. This source-grounded register addresses the definition and mapping work in approved items 29, 34 and 35. It records current declarations and their role boundaries; it does not assert consistent adoption across every surface or certify computed styling, responsiveness or runtime behavior. Links use exact source-line anchors at the hashes recorded below. The application imports premium-theme.css after legacy styles, but specificity, media queries and inline declarations can still override a shared rule. Treat the mappings as declaration evidence until the applicable computed styles are measured.

## Typography roles (item 29)

The premium scale is defined at [premium-theme.css:74](../../frontend/src/premium-theme.css#L74): xs12px, sm14px, base16px, md16px, lg18px, xl22px, 2xl clamp(24px,2vw,30px), and 3xl clamp(28px,3vw,36px). The legacy values at [styles.css:56](../../frontend/src/styles.css#L56) differ and remain compatibility defaults.

| Requested role | Shared value and concrete selector | Boundary or exception |
| --- | --- | --- |
| Page title | `--text-2xl`; global `h2` at [styles.css:5087](../../frontend/src/styles.css#L5087), including the shell title `.topbar h2` | The shell uses h2, not a newly introduced h1 convention. `.topbar h2` wrapping at styles.css:6310 does not establish its computed font size on its own. |
| Panel heading | `--text-md` (16px), `.panel h3` at [styles.css:5286](../../frontend/src/styles.css#L5286); `.panel > h3` line-height1.4 at [premium-theme.css:171](../../frontend/src/premium-theme.css#L171) | Generic h3 uses lg18px at styles.css:5088; unit-card headings use md at styles.css:6017. These are distinct existing roles, not evidence that all headings have been unified. |
| Dialog heading | `--text-xl` (22px), `.mw-header h2` at [styles.css:5470](../../frontend/src/styles.css#L5470) | Short landscape override is fixed18px at premium-theme.css:545; this is an explicit exception to the normal dialog scale. |
| Field label | `--text-sm` (14px), `label` at [styles.css:226](../../frontend/src/styles.css#L226), `.form-grid label` at styles.css:483, `.member-workspace label` at premium-theme.css:302 | Editable controls separately use fixed16px in premium-theme.css:216-220; label size is not input size. |
| Body copy | `--text-base` (16px), `body` at [styles.css:161](../../frontend/src/styles.css#L161); line-height1.55 at premium-theme.css:161 | Controls inherit font by styles.css:234, with the explicit16px input override above. Individual section rules may override body inheritance. |
| Supplementary metadata/help | `--text-xs` (12px), `.field-help` at [styles.css:505](../../frontend/src/styles.css#L505), `.eyebrow` at styles.css:5089, `.unit-member-chip small` at styles.css:1451 | Some secondary descriptions deliberately use sm14px, e.g. unit-card header p at styles.css:6018. `.mw-tab-count` uses literal12px at premium-theme.css:283. Metadata must remain supplementary; this is not permission to reduce primary operational instructions. |
| Numeric emphasis | `--text-3xl`, `.metric > span` at [styles.css:906](../../frontend/src/styles.css#L906); tabular numerals at styles.css:5090 | This is metric emphasis rather than the page-title role. Missing-value metric text uses base at premium-theme.css:836. |

Adoption gaps: fixed 12/13/14/16/18px section declarations coexist with semantic tokens; selectors can use the same HTML heading level for different roles. A complete computed role inventory and consolidation remain separate implementation/review work. This document introduces no new font declarations.

## Spacing roles (item 34)

The existing four-pixel foundation is [styles.css:45](../../frontend/src/styles.css#L45): `--space-1/2/3/4/5/6/8/10/12` = 4/8/12/16/20/24/32/40/48px. Existing responsive padding expressions are recorded as expressions, not mislabeled as named role tokens.

| Requested role | Current token/declaration and source | Responsive/fixed exception |
| --- | --- | --- |
| Page gutters | `.content` uses four safe-area-aware `max(clamp(20px,2.5vw,40px),safe-area)` expressions at [premium-theme.css:163](../../frontend/src/premium-theme.css#L163); legacy `--space-8` padding remains at styles.css:385 | A later24px override appears at premium-theme.css:491; mobile<=768 uses16px inline and108px+safe-area bottom at497; <=420 uses12px inline at531. Thus the clamp is not the final gutter at every width. No dedicated gutter token currently exists. |
| Card/panel padding | `.panel` uses `clamp(16px,2vw,24px)` at [premium-theme.css:170](../../frontend/src/premium-theme.css#L170); `.member-card` and `.data-card` use `--space-3` at styles.css:3324 and3361 | Panel <=420 becomes literal16px at premium-theme.css:532. Legacy panel space5 at styles.css:968 is overridden by the later premium panel declaration where applicable. Card and panel padding are distinct existing roles. |
| Field groups | `.form-grid` gap `--space-4` at [styles.css:477](../../frontend/src/styles.css#L477); contained `.form-grid label` gap `--space-2` at483; ordinary label gap `--space-1` at226 | Premium intrinsic grid sizing at premium-theme.css:225 changes column fitting, not the shared gap. Workspace skeleton fields use space2 at premium-theme.css:250. |
| Toolbars | `.page-toolbar` gap `--space-3`, bottom margin `--space-4` at [styles.css:5992](../../frontend/src/styles.css#L5992); action cluster `.page-toolbar__actions` gap `--space-2` at6003 | Workspace footer gap is literal10px at premium-theme.css:301. It must not be described as space2. |
| Stacked/wrapped mobile actions | `.modal-form-actions` gap `--space-3`, margin-top `--space-2` at [styles.css:3530](../../frontend/src/styles.css#L3530); `.member-actions` gap `--space-2` at5882; premium shared wrap rule at229 | At <=768 `.modal-form-actions > button` gets flex1 1 140px at premium-theme.css:518: this permits wrapping rather than promising a single vertical stack. `.mw-footer` mobile inline padding12px at526 and short-landscape block padding8px at547 are fixed exceptions. |

Adoption gaps: role aliases such as a named page-gutter/card-padding/mobile-action-gap are not present. Existing values are mostly scale-aligned but literal10px footer gaps and2px card metadata spacing persist. Do not replace responsive/safe-area expressions with one global spacing value without surface-specific verification. This register establishes the mappings and exceptions, not completion of a whole-application token migration.

## Radius and compact status roles (item 35)

Premium shared values at [premium-theme.css:82](../../frontend/src/premium-theme.css#L82) are sm8px, md10px, lg16px and xl20px. `--radius-full` remains999px in [styles.css:70](../../frontend/src/styles.css#L70). These are geometric tokens; there are no dedicated `--radius-field`/`--radius-card`/`--radius-status` definitions in the inspected shared token block.

| Role | Current mapping and exact source | Exception/adoption boundary |
| --- | --- | --- |
| Ordinary field | `--radius-sm` (8px), auth/inline select rule at [styles.css:628](../../frontend/src/styles.css#L628); `.readonly-field` at497 | Canonical `.member-workspace input/select/textarea` instead explicitly use md10px at styles.css:5493. Thus the earlier design-system statement that all fields are8px is a baseline intention, not uniform adoption. |
| Compact card | `--radius-md` (10px), `.data-card` at [styles.css:3361](../../frontend/src/styles.css#L3361) | `.member-card` initially uses md at3324, while a later low-specificity premium `:where` family declaration requests lg at premium-theme.css:309. The earlier class selector has greater specificity, so declaration order alone does not prove that request wins. |
| Panel / ordinary record card | `--radius-lg` (16px), `.panel` at [styles.css:5275](../../frontend/src/styles.css#L5275), `.unit-card` at6011, low-specificity premium `.member-card/.leave-card` family request at309 | Status identity must not cause a whole card to become a pill. Mobile mapping rows reference `var(--radius-card,16px)` at premium-theme.css:746; the named alias is not established by that fallback use. |
| Major dialog | `--radius-xl` (20px), shared `:where(.member-workspace,.member-profile-dialog,.person-modal,.mobile-more-sheet)` at [premium-theme.css:264](../../frontend/src/premium-theme.css#L264) | Low-specificity `:where` is not proof of the final computed radius against legacy class selectors. <=700 canonical member-workspace deliberately becomes square/full-height at premium-theme.css:521. |
| Status chip / status badge | Existing pill token `--radius-full` (999px), `.status` at [styles.css:663](../../frontend/src/styles.css#L663); `.audit-badge` at1755; manual-review count badge at1050 | These compact textual status/count indicators are the documented pill-role exception. The mapping records their current bounded role; it does not authorize pill-shaped fields, cards or dialogs. |
| Period indicator | Existing fixed12px `.mw-period-badge` at [styles.css:4880](../../frontend/src/styles.css#L4880) | Not currently linked to a shared radius token; preserve as an explicit consolidation gap. |
| Member identity chip | Existing `--radius-full`, `.unit-member-chip` at [styles.css:1435](../../frontend/src/styles.css#L1435) | This identity/link container is not a status chip. Its pill styling is an existing exception requiring an explicit future keep/change decision; no rationale is inferred merely from its presence. |
| Navigation selection | Existing `.sidebar` navigation uses an asymmetric full-radius edge at [styles.css:349](../../frontend/src/styles.css#L349) | A navigation silhouette is separate from record/status geometry. Its presence is not evidence that every full-radius declaration has an approved rationale. |

Definition boundary: fields, compact cards, panels and dialogs have distinct mapped roles; compact status/count badges have an explicitly restricted pill role. Current source adoption still has the field8/10 split, hardcoded period badges and low-specificity card/dialog rules. Any claim that indiscriminate pills have been eliminated requires a separately reviewed inventory and rendered verification. No such completion claim is made here.

## Source snapshot and verification limit

This documentation-only pass read the declarations and their local contexts; it did not execute tests or change application source. Exact source hashes:

- `frontend/src/styles.css`: `306928f568686cfc453178f73731a797f7fe5b9f016d7128bf9cd68dc6e1fb86`
- `frontend/src/premium-theme.css`: `559041ee03d192fcc291582bd7572e8d32004e9d5428b7e57fbbea9ba9e60f83`
