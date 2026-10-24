# Frontend surface and table classification

This is a source-grounded design register for requirements 10 and 101. It records the intended treatment of existing surface families. It is not a claim that every variant, runtime route, role or dialog is accepted. The generated [table inventory](table-surface-inventory.json) lists literal table openings, including inactive code and the component reference page; discovery is kept separate from runtime reachability.

| Surface family | Existing implementation | Presentation and interaction boundary |
| --- | --- | --- |
| Application pages | `frontend/src/main.ts` (`NAV_ITEMS`, `renderShell`): 19 named navigation views, including the separately gated Limits view | One page heading and selected working month; preserve role-visible entry points and actual navigation. Page content can grow; comparison regions scroll locally. |
| Workspace panels | `frontend/src/main.ts`: Overview `.overview-month` and `.analytics-grid > .panel`, Analysis `.chart-panel`; `frontend/src/rota-compute.ts`: `.compute-readiness` diagnostic summary | Tonal surface, ordinary elevation and readable heading. A panel is not a modal and must not trap focus. |
| Member/unit record cards | `frontend/src/main.ts`: `.member-card` in `renderMemberCards`, `.unit-card` in `renderUnitAssignmentsByUnit`, and special-posting `.special-unit-card` | Identity, textual status and primary record action remain visible. Long values wrap. Mobile cards represent records rather than synthesizing new data. |
| Record editors | `member-workspace.ts`, `record-workspace.ts`, `reference-workspace.ts` | Preserve drafts, revision tokens, native form validation and server refusal. Use an editor content scroller and existing explicit save boundary. |
| Native workspace dialogs | Compute, import, profile, normalization and approval modules | Existing modal ownership, Escape/close safeguards, focus restoration and acknowledgement gates remain authoritative. Scrollable comparison content is a justified nested region. |
| Legacy contextual overlays | `main.ts` review actions, rota day and unit-management overlays | Existing overlay stack manages focus and Escape. Review navigation carries exact returned ID/month when supported. It must explain unavailable destinations. |
| Context menus and drawers | Account actions, mobile More, sidebar and row menus | Compact elevated surface; preserve accessible names and role restrictions. Drawer navigation is separate from a blocking record editor. |
| Inline disclosure | Compute guidance, group remainders, staffing remainders and optional reports | Use native details/summary semantics and visible expansion text. Do not introduce a partial ARIA grid or an extra save boundary. |
| Feedback/recovery | `ui-feedback.ts`, `workspace-load-state.ts`, `frontend-bootstrap.js` | Distinguish live result summaries from errors and confirmed saves. A deadline ends local waiting; it does not prove server cancellation or rollback. |
| Reference/demo surface | `component-reference.ts` | Local component examples and fixture actions. They cannot certify operational routes merely by looking similar. |

## Source reconciliation - 24 October 2026

The current `NAV_ITEMS` declaration in `frontend/src/main.ts` contains 19 destinations: ten Workflow entries and nine Admin Tools entries, of which Limits has the separate existing superadmin gate. This corrects the previous register count of 18; it does not assert that all destinations are visible to one account.

The new header Server control belongs to the existing inline-disclosure/contextual-overlay family, rather than a new page or modal family. `frontend/src/main.ts` (`renderShell`, `#connection-checker`) emits native `details`/`summary` and the Check server button; `frontend/src/connection-status.ts` (`bindConnectionStatus`) owns its result, freshness and dismissal behavior. `frontend/src/premium-theme.css` (`.connection-checker`, `.connection-checker-panel`) presents the open content as a viewport-constrained floating panel. Opening it does not create a form save boundary or a focus trap; the manual read uses the existing health-check boundary. This is source classification, not independent runtime acceptance of those behaviors.

## Table families and intended mobile treatment

| Table family / source contexts | Classification | Mobile strategy and invariant |
| --- | --- | --- |
| Analysis workload metrics, weekend/duty breakdowns, chart data, Limits targets/spreads and Balance duties | Comparison grid | Keep column relationships and numeric alignment; provide a named, keyboard-focusable region only when it overflows. Optional record cards cannot replace the comparative evidence. |
| Analysis posting periods and promotion timelines | Record list | Existing mobile cards retain identity and complete periods. Desktop rows and mobile cards must represent the same returned records. |
| Mapping editor and CSV column mapping | Structured editor | Preserve one set of form controls, drafts and handlers across breakpoints. Mobile field labels must remain explicit. Mapping columns are not assignment decisions. |
| Members, leave, unit postings, accounts, eligibility membership | Record list with actions | Keep identity, status and relevant row action discoverable without hover. Existing card/reflow or contained scrolling is chosen per editor; selection and permissions remain unchanged. |
| Unit-day safety, allocation statistics, call-wise fairness and workload comparison | Comparison grid | Keep returned dates, counts, rule/status labels and ordering. Staffing tables use local horizontal scrolling; large returned collections need explicit remainder access. |
| Rota review items, exchange requests and latest generation decisions | Reviewable record list | Preserve the exact selected slot/request/batch and review action. Compact layouts must not hide eligibility, reasons or server-reported warnings. |
| Compute/intelligent proposals and extra-duty decisions | Reviewable record list containing comparative evidence | Preserve reasons, returned choices and unresolved/forced indicators. Apply remains behind the existing explicit review acknowledgement and revision validation. |
| Monthly leave approval | Reviewable record list | Full cross-month ranges, affected duties and independent acknowledgements stay visible. Scrolling does not imply approval. |
| Past-duty coverage | Comparison grid | Retain month/category coverage relationships and genuine missing values. |
| Past-duty/import history and workflow audit history | Record list / before-after detail | Preserve batch identity, source information and full audit timestamps. Expanding details must not replay imports. |
| Recorded past-duty selection | Selectable record list | Selection explicitly covers shown rows; the whole-month action is separate. Mixed checkbox state, selected IDs and month reset remain unchanged. |
| Admin delete/import previews | Reviewable record list | Preserve target names, changes, reasons, scope and original confirmation contract. Truncation must be explicit and does not certify access to omitted records. |
| Inactive `renderManualReview` table literals | Inactive source, runtime unverified | No call site was found in current source. Do not infer a visible defect or add a route merely to exercise old markup. |

The 58 openings are **candidates**, not 58 distinct user-facing tables. Functions can emit multiple instances, some tables are nested in optional disclosures, and some are currently inactive. Per-instance classification, large-data checks, all-role reachability and independent review remain open. Existing fixture reports and the current family/matrix runs should be linked to the applicable family without turning shared evidence into whole-item completion.
