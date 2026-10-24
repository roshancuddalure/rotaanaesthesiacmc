# Premium frontend upgrade plan — 21 October 2026

Status: approved for frontend-only implementation; goal active. Progress and verification are recorded in `docs/premium-ui/execution-status.md`. The user explicitly selected emulation and requested physical-device checks remain pending. Backend behavior and production data are outside the implementation scope.

## Intended result and scope

Create a calm, polished duty-management application for desktop, tablet and phone. The premium character should come from proportion, readable information, purposeful shapes and consistent interaction. Use royal navy, violet and restrained champagne accents with generous neutral surfaces. Preserve recognizable success, warning and danger semantics. Every visible action must produce a specified result, explain why it is unavailable, or report a recoverable error.

This is a frontend implementation plan. Existing APIs, permission rules, rota eligibility, calculations, database schemas, generation engines and export content remain authoritative. Changes can cover HTML, CSS, TypeScript, frontend modules, build configuration and test fixtures. A UI control must not imply a capability that the current API cannot provide. Hosting cache headers and old-asset retention are deployment dependencies to inspect and document; changing backend infrastructure is outside this approval. No framework replacement is proposed.

## Inspection findings and evidence limits

The inspected application uses TypeScript and Vite, shared UI helpers, a large delegated-interaction main module, separate workflow modules, Playwright and axe. At inspection, main.ts had approximately 9,670 lines and styles.css approximately 6,844; these counts can change because other work is ongoing. Multiple root-token blocks and later style generations coexist. Most ordinary tables inherit a 720px minimum width unless a sufficiently specific component rule overrides it. Shell and workspace breakpoints differ around 700–768px.

There are already useful safeguards: render tickets against stale page rendering, data-change invalidation, readable API-error helpers, responsive workspaces, native dialogs, visualViewport handling, focus styling, reduced-motion rules, import review, compute recovery and tests. These should be consolidated and extended, not discarded. Historical UX reports document successful prior checks; they are evidence of earlier snapshots, not certification of the present working tree.

Concrete review targets include legacy backdrop dialogs beside native dialog implementations, hard-coded workspace colors, global five-second toast removal, focusable help spans using title text, and mixed status/brand colors. The inspected request helper supplies no general request deadline and does not distinguish every abort/network/response-decoding case. No application handler for Vite preload failures was found in the inspected frontend. The planning audit used source and stored screenshots; no new exhaustive live-browser or button-outcome certification is claimed here.

Five specialist perspectives participate: visual design, responsive geometry, accessibility, frontend reliability and interaction testing. Every numbered item requires all five perspectives during implementation review. Review coverage does not mean approval or implementation has already occurred.

## Proposed visual language

Use royal navy #171D38 for navigation, violet #493A8F for primary actions, champagne #B99046 for small decorative accents and burgundy #8C2846 sparingly. Light canvas starts at #F6F5F9, primary text at #20233A and secondary text at #596176. The dark counterpart starts at #111522 with #1A2032 surfaces and #EEF0F8 text. These are proposed token seeds, not pre-certified combinations: measure contrast for each actual foreground/background/state pairing.

Use a four-pixel spacing foundation; approximately 8px field corners, 12–16px cards and 20px major dialogs, adjusted by content. Reserve pills for statuses and compact selectors. Body copy should normally be 15–16px, dense data at least 14px where practicable, with stable local system-font fallbacks. Use tabular numbers, consistent line heights and restrained shadows. Avoid gold body text, ornamental gradients behind data, excessive rounded pills, hover-only controls and animation that delays work.

## Delivery methodology

Establish reproducible fixtures and an action inventory before styling. Build a component/state reference, migrate shared foundations, and then move through complete workflows in dependency order. Each item records its screen, affected component, current evidence, expected behavior, request or navigation contract, loading/error/empty/stale states, responsive rules and verification result. Capture before/after screenshots with identical data, fonts, theme and viewport.

Every button receives an outcome contract: actor and role, prerequisites, target record/month, expected UI transition, expected request where applicable, visible success evidence, persisted read-back where meaningful, duplicate protection, cancellation behavior and failure recovery. A click or HTTP 200 alone does not pass. Sort buttons must change order; filters must change results; save buttons must preserve the right values after reopening; downloads must contain the expected artifact; cancellation must avoid unintended mutation. Disabled controls need a discoverable reason.

Use existing test tooling first. Prefer size container queries for reusable panel layouts, Grid/Flexbox for composition, logical properties for resilient spacing, native semantic controls and progressive enhancement. Keep fallbacks for unsupported CSS or optional browser APIs. Avoid large speculative rewrites; extract shared behavior while preserving observable workflow behavior.

## Stepwise action plan: 260 short upgrades

### Phase 1 — Baseline, action inventory and acceptance contracts

1. Inventory every frontend screen, modal, drawer, menu, rail, embedded report and role-dependent entry point before redesign.
2. Record the current source snapshot and concurrent changes so unrelated work remains intact throughout implementation.
3. Catalogue every button, link, submit control, tab and clickable card with a stable action identifier.
4. Record each action's role, selected month, target record and prerequisites in one searchable interaction register.
5. Define observable success outcomes for each action, including navigation, changed results, saved values or downloaded artifacts.
6. Identify controls that only appear functional, recording confirmed no-op behavior separately from untested or permission-blocked states.
7. Map every available action to its existing handler and API contract without inventing unsupported backend capabilities.
8. Capture baseline screenshots with settled fixtures/fonts, reduced animation and defined scroll positions across populated, empty and failed-request states.
9. Inventory existing design tokens, hard-coded colors, duplicate selectors and inline layout exceptions before consolidating styles.
10. Classify reusable surfaces into pages, panels, record cards, tables, editors, dialogs and contextual overlays.
11. Establish representative fixtures containing long names, missing values, large counts, mixed statuses and boundary dates.
12. Document current permission-dependent visibility for admins, department heads, board members and signed-out users.
13. Identify protected workflow invariants, including selected-month continuity, assignment preservation, reviewed imports and explicit publishing.
14. Record current bundle sizes, render timings, layout shifts and long tasks on documented test hardware.
15. Establish a defect register that separates verified bugs, design improvements, historical findings and open investigation questions.
16. Define accessible component states before implementation: default, hover, focus, selected, disabled, busy, error and success.
17. Map every existing browser suite to the screens, states and actions it actually verifies.
18. Define objective pass conditions and supporting evidence for every numbered upgrade before marking it complete.
19. Prioritize broken actions, inaccessible controls, hidden content and lost drafts ahead of purely decorative refinements.
20. Freeze the approved visual direction and workflow contracts before broad styling begins, documenting later scope changes explicitly.

### Phase 2 — Royal identity, typography and design tokens

21. Consolidate competing token definitions into one documented semantic system while preserving intentional component-specific variations.
22. Introduce a shared semantic-color map separating brand identity, interaction feedback, scheduling status, chart categories and destructive actions.
23. Apply royal navy consistently to navigation and workspace framing without darkening every content container.
24. Use violet for primary actions and active selection, with measured hover, pressed and focus variants.
25. Reserve champagne accents for identity details and separators, keeping warning indicators visually distinct from decoration.
26. Retain burgundy as a controlled accent and preserve unmistakable danger styling for destructive operations.
27. Define complete light and dark mappings for surfaces, borders, input fields, overlays and disabled states.
28. Measure actual state/theme pairings: 4.5:1 normal text, 3:1 large text and applicable essential non-text graphics.
29. Establish a clear typography scale for page titles, panel headings, field labels, body text and metadata.
30. Increase sustained-reading text where cramped typography currently makes operational guidance difficult to scan comfortably.
31. Use tabular numerals for workload totals, dates, percentages, capacity, runtime and comparison columns.
32. Standardize line heights and paragraph widths so explanations remain readable inside both wide panels and narrow dialogs.
33. Replace decorative uppercase paragraphs with sentence case while retaining short, purposeful section labels where useful.
34. Define consistent spacing tokens for page gutters, card padding, field groups, toolbars and stacked mobile actions.
35. Establish distinct radius tokens for fields, cards, dialogs and status chips instead of indiscriminate pill shapes.
36. Limit elevation to a small documented hierarchy separating ordinary panels, menus and blocking dialogs.
37. Standardize one icon family, optical sizing, stroke weight and alignment with adjacent text and controls.
38. Provide reliable local font and icon fallbacks so blocked resources cannot erase labels or alter control usability.
39. Define restrained motion durations and a reduced-motion alternative for every nonessential transition or loading treatment.
40. Create a component reference specifying control heights, icon sizes, radii, spacing and every interaction state in both themes.

### Phase 3 — Responsive geometry, containers and shape composition

41. Establish supported viewport and input-mode ranges before assigning breakpoints to individual components or entire pages.
42. Replace disconnected page-width rules with a shell grid supporting wide boards and comfortably bounded reading panels.
43. Use fluid gutters with minimum and maximum limits so layouts breathe without wasting space on smaller screens.
44. Give shrinking Grid and Flexbox children explicit minimum-size rules to prevent long content expanding entire pages.
45. Introduce size container queries where panels change width independently of the browser window or navigation state.
46. Keep functional media-query or intrinsic-layout fallbacks for components when container-query support is unavailable.
47. Resolve the 700–768px transition band deliberately, testing every breakpoint immediately below, at and above its threshold.
48. Make comfortable density the default; permit documented compact variants for comparison data rather than cramped editors and guidance.
49. Replace arbitrary fixed heights with content-driven sizing except where a bounded scrolling region is genuinely necessary.
50. Use dynamic viewport sizing for full-height mobile surfaces, retaining a stable fallback for older browser behavior.
51. Add safe-area insets to bottom navigation, sticky actions, drawer edges and full-screen mobile dialogs.
52. Reserve clearance for actual sticky dimensions, proving the final review row and validation errors scroll fully above wrapped controls.
53. Define a single primary scroll container for each screen or dialog, allowing nested scrolling only when explicitly justified.
54. Ensure focused fields remain visible when software keyboards, browser chrome or orientation changes reduce usable screen height.
55. Reflow toolbar groups by task importance so primary actions remain reachable before optional filters and report tools.
56. Wrap long names, error messages and translated-style labels without displacing close buttons, badges or action menus.
57. Replace unnecessary nested borders with spacing and tonal surface changes that make parent-child relationships immediately clear.
58. Preserve mixed-card alignment without truncating essential names, date ranges or warnings; allow discoverable truncation only for secondary metadata.
59. Support browser zoom and increased text size without hiding actions, truncating essential information or forcing page-level sideways scrolling.
60. Add deliberate local scrolling affordances only to comparison regions whose information cannot meaningfully reflow into cards.

### Phase 4 — Navigation, application shell and desktop/mobile continuity

61. Refine desktop navigation into clear workflow and administrative groups, keeping frequent operational tasks easy to locate.
62. Standardize expanded, compact and mobile drawer states with predictable widths, labels and active-state treatment.
63. Keep the selected month prominent and consistent wherever month-scoped leave, units, generation, review or publishing is shown.
64. Present connection and save status truthfully, avoiding decorative green indicators without corresponding evidence of current availability.
65. Align page title, month controls and account actions so the header remains balanced when text wraps.
66. Make mobile primary navigation comfortable for touch and protect it from device safe areas and browser controls.
67. Organize the mobile More surface into scan-friendly groups with clear current location and a reachable close action.
68. Prevent account menus, mobile navigation, contextual menus and modal overlays from competing for focus or stacking unpredictably.
69. Restore focus to the correct opener after closing drawers or menus, including after responsive layout changes.
70. Clear obsolete drawer overlays, body scroll locks and inert state when resizing, preserving normal desktop pointer and keyboard access.
71. Add destination focus and accessible route announcements without disrupting deliberate in-page user focus or data entry.
72. Preserve relevant filters, selected tabs and scroll position when returning from a record or profile detail view.
73. Provide frontend navigation history where appropriate so Back returns meaningfully without losing unsaved operational context.
74. Preserve or safely reject deep links using existing frontend routing capabilities, avoiding unsupported server-route assumptions.
75. Make unsaved-change handling consistent across navigation, month switches, modal dismissal and browser unload boundaries.
76. Clearly explain role-limited navigation while retaining server permissions as the authority for every protected action.
77. Provide a useful not-found or unavailable-section state with a safe route back to accessible workflows.
78. Give help and user-guide links contextual destinations rather than sending every question to one generic page.
79. Refine login and recovery while supporting password managers, autofill and paste, preserving appropriate autocomplete and accessible authentication behavior.
80. Test navigation with rapid switching, slow responses and repeated month changes to confirm the final destination remains authoritative.

### Phase 5 — Shared controls, feedback and form behavior

81. Standardize primary, secondary, tertiary and destructive button variants with consistent sizing, icons and interaction states.
82. Ensure every visible button either performs its specified action or exposes a clear explanation when unavailable.
83. Give icon-only buttons meaningful accessible names and optional tooltips that work with keyboard focus and touch.
84. Use native button/link semantics and prohibit nested interactive cards or controls, keeping each action's target unambiguous.
85. Keep ordinary actions visually distinct from destructive or irreversible operations, especially inside compact menus and sticky footers.
86. Register delegated handlers once, guard in-flight mutations against repeated activation and prevent duplicate submissions after reauthentication.
87. Restore original button text and availability after failures without leaving the interface permanently disabled or deceptively successful.
88. Standardize fields, selects, checkboxes, radios and date inputs without removing useful native platform behavior.
89. Keep labels persistently visible, provide format guidance and associate validation messages with their specific form fields.
90. Validate predictable client-side errors early while preserving server validation as the final source of operational truth.
91. Move focus to actionable validation summaries when appropriate, and link each summary entry to its affected field.
92. Preserve entered values after validation, network or permission errors unless sensitive information requires deliberate clearing.
93. Distinguish confirmed saved state, unsaved edits, pending requests and uncertain mutation outcomes throughout all editors.
94. Replace transient-only critical feedback with persistent inline notices that remain until resolved or explicitly dismissed.
95. Add named toast dismissal, restrained announcements and duplicate suppression; pause noncritical expiry on hover/focus and retain consequential feedback inline.
96. Replace title-only help spans with semantic help controls exposing readable guidance through keyboard and touch interaction.
97. Standardize loading skeleton dimensions to reduce layout shifts when summaries, cards and form content arrive.
98. Provide useful empty states explaining what is missing, why it matters and which available action resolves it.
99. Separate destructive confirmation from routine acknowledgement, clearly naming the target record, month and expected consequence.
100. Verify form cancellation, Escape and outside-click rules preserve drafts and never accidentally trigger submit or destructive actions.

### Phase 6 — Tables, cards, filters and analytics presentation

101. Classify each existing table as a comparison grid or record list before choosing its mobile representation.
102. Remove blanket wide-table assumptions from record lists that can retain full meaning through responsive labeled cards.
103. Keep genuine comparison tables locally scrollable with discoverable horizontal-scroll cues and keyboard-accessible regions.
104. Preserve captions and header relationships; expose exactly one accessible interactive representation when desktop tables and mobile cards coexist.
105. Keep essential identity, status and actions visible without requiring hover or reaching a distant off-screen column.
106. Standardize row selection, mixed checkbox state, select-all scope and announced counts across filtered and paginated record sets.
107. Clearly distinguish selecting visible rows, all filtered rows and all monthly records before any bulk action.
108. Expose sort direction visually and through aria-sort, verifying records actually reorder according to the selected header.
109. Debounce search appropriately, preserve input focus and distinguish no results from an unloaded or failed dataset.
110. Make active filters visible as removable summaries with a reliable reset action and meaningful result count.
111. Consolidate dense mobile filters into an expandable panel while keeping applied-filter count visible in the main toolbar.
112. Preserve filtering, sorting and pagination when opening details or recovering from an unrelated optional report failure.
113. Align dates, numbers and units consistently, avoiding mixed formats that complicate scanning or workload comparisons.
114. Differentiate row hover, selection, keyboard focus and warning states using more than subtle background color changes.
115. Introduce pagination or measured virtualization only where representative datasets demonstrate a real rendering or navigation problem.
116. Provide accessible nonvirtualized summaries or navigation where virtualization would otherwise hide content from assistive technology.
117. Simplify metric tiles into consistent value, label, context and optional comparison layouts with honest missing-data treatment.
118. Use chart palettes and legends that remain understandable in dark mode, grayscale and common color-vision differences.
119. Provide readable table or text equivalents for charts and ensure drill-down controls expose their destination and result.
120. Preserve analysis calculations and export values while improving presentation, readability and actionable links to underlying records.

### Phase 7 — Member profiles, editing rails and member imports

121. Consolidate profile entry points into a coherent visual experience while preserving currently available role-specific actions.
122. Make member identity, designation, effective call level and active status clear before secondary history or administrative metadata.
123. Preserve desktop rails and mobile tabs, automatically revealing the active tab without stealing focus and providing discoverable scroll cues.
124. Standardize tab labels, counts and ordering across overview, postings, leave, duties, history and administrative sections.
125. Preserve tablist/tab/tabpanel relationships, roving focus and orientation-aware navigation while keeping ordinary page navigation available.
126. Keep the identity header compact while allowing full names and designations to wrap without overlapping close controls.
127. Surface unsaved changes and validation errors on their relevant tabs so hidden form problems remain discoverable.
128. Present dated promotions and call-level changes as a readable timeline with clear scheduled-versus-effective distinctions.
129. Reflow posting and leave histories into date-aware mobile cards while keeping edit actions adjacent to the affected record.
130. Separate member-facing information from administrator metadata through hierarchy and progressive disclosure rather than hidden essential context.
131. Standardize add, edit, save and cancel patterns across profile sections so users do not relearn each editor.
132. Keep workload summaries compact and readable, linking to actual duties using existing supported detail or report views.
133. Show missing designation, unknown history and unassigned values honestly instead of presenting misleading zeroes or placeholder identities.
134. Make aliases and member-matching choices understandable, with explicit selection results and clear differences between existing and new people.
135. Give CSV upload, column mapping, row review and apply stages consistent progress indicators and recovery affordances.
136. Preserve selected files and mappings after recoverable errors where browser permissions and current API semantics allow it.
137. Highlight unresolved, duplicate and invalid import rows without letting decorative badges overwhelm the information needed to correct them.
138. Explain import modes and scope before apply, using current server preview results rather than frontend assumptions.
139. Keep import preview and apply actions reachable on phones while ensuring sticky footers cannot obscure final review rows.
140. Verify member saves, CSV apply, rejection downloads and history reopening through actual results and persisted read-back.

### Phase 8 — Leave, units, calendars and normalized record tools

141. Refine the leave toolbar around add, import and monthly approval, keeping secondary management tools visually subordinate.
142. Preserve individual leave approval while making monthly pending counts, review scope and affected-duty acknowledgements clear.
143. Present full date ranges for cross-month leave so monthly approval cannot appear narrower than its actual effect.
144. Offer useful phone day/list navigation alongside the month calendar without changing leave counts or blocking semantics.
145. Use clear textual status cues for approved, pending, imported-review, cancelled and rejected leave in every representation.
146. Give calendars keyboard behavior matching their actual semantics; never add grid roles without the complete interaction pattern.
147. Distinguish unavailable members from merely pending leave warnings using the existing returned status and safety information.
148. Reflow leave-pressure summaries into readable unit and call-level groups without duplicating every explanatory paragraph.
149. Improve unit-board hierarchy so campus, unit identity, staffing groups and dated assignments remain easy to scan.
150. Keep create-unit and add-member actions visible at the relevant unit context, preserving existing normalized reference workflows.
151. Present dated unit membership changes without visually implying that a future posting is already effective today.
152. Standardize unit filters, expansion states and per-unit counts across desktop boards and mobile stacked cards.
153. Make staffing warnings actionable through existing editors while keeping the authoritative rule and affected date visible.
154. Improve long unit-member lists through measured pagination or expansion without concealing missing staffing or leave conflicts.
155. Align normalized reference pickers and inline creation dialogs with the same label, validation and save conventions.
156. Preserve clear distinction between adding a reference value, assigning a person and editing an existing dated record.
157. Keep imported record corrections attached to their original preview row, with visible completion and unresolved-state indicators.
158. Standardize cancellation and deletion confirmations so removing a record never resembles merely closing its editor.
159. Refresh dependent leave and unit views after confirmed mutations without discarding unrelated unsaved edits or chosen filters.
160. Verify all record-level and monthly actions against their actual selected-month and selected-unit context on desktop and mobile.

### Phase 9 — Rota setup, generation, compute, review and publishing

161. Present setup, template allocation, member assignment, review and publishing as clear operational stages with truthful readiness cues.
162. Keep selected month, unit scope and draft/published status visible throughout generation and review without excessive header height.
163. Explain disabled generation prerequisites beside the action instead of requiring users to discover them in another screen.
164. Maintain essential generation actions while optional reports load or fail, preserving the existing nonblocking foundation.
165. Give template proposals a balanced review layout showing units, dates, forced choices and unresolved work before apply.
166. Make quick Autoassign and whole-month planning distinct choices, with concise explanations of preservation and repair behavior.
167. Surface current engine, requested preference, measured readiness and fallback reason without implying GPU acceleration guarantees.
168. Simplify compute diagnostics into a clear summary with expandable technical evidence, preserving meaningful hardware and benchmark details.
169. Present generation progress as queued, working, review-ready or failed according to actual returned states, avoiding invented percentages.
170. Preserve resume, cancel and server-fallback controls during recoverable GPU or network interruption using existing job capabilities.
171. Keep review confirmation, unresolved counts and primary apply actions visible without covering final proposed decisions on phones.
172. Display hard blockers, warnings and accepted exceptions through distinct text, icon and grouping treatments with actionable explanations.
173. Make assignment alternatives and workload comparisons easier to compare without obscuring server-provided eligibility or objective evidence.
174. Preserve locks, selected repair scope and member preferences across responsive reflow and recoverable frontend errors.
175. Give long rota grids a usable narrow-screen day/list alternative while retaining deliberate comparison scrolling where needed.
176. Integrate extra-duty proposals, verification, undo and audit reports into the shared review visual language without altering calculations.
177. Keep reviewed reversal actions clearly scoped to their applied generation or batch, exposing conflicts and unavailable-state explanations.
178. Make publishing visually distinct from saving a draft, with accurate consequences, prerequisites and existing server confirmation behavior.
179. Improve export menus and download feedback, verifying filenames, formats and actual nonempty artifacts before reporting success.
180. Verify complete setup-to-export journeys and confirm equivalent API payloads, outcomes and export content after presentation changes.

### Phase 10 — Administrative screens, supporting workflows and documentation

181. Refine rules editing into clearly grouped sections with consistent headings, summaries, unsaved markers and sticky-save behavior.
182. Keep effective dates, rule versions and validation results visually distinct so configuration history cannot be mistaken for current policy.
183. Improve eligibility-group search and membership presentation without changing group normalization, dates or eligibility semantics.
184. Standardize reference mappings with readable source-to-target relationships and clear reviewed, unresolved and inactive indicators.
185. Make past-duty import steps consistent with operational CSV workflows while retaining their distinct historical-data explanations.
186. Present import history and rejection reports with reliable filtering, readable timestamps and working download controls.
187. Give login-account management clear role descriptions and pending/error feedback without implying frontend visibility enforces authorization.
188. Distinguish account activation, role changes and password-related actions through explicit labels and appropriately scoped confirmations.
189. Improve diagnostics readability with a short service summary and expandable technical information that avoids unnecessary personal data.
190. Make unavailable diagnostics recoverable without turning unrelated operational screens into error pages or blank placeholders.
191. Refine recycle-bin cards and tables so record type, deletion context, restore scope and conflicts are immediately understandable.
192. Verify restore and permanent-delete controls independently, keeping their consequences and supported backend capabilities clearly separated.
193. Provide coherent help guidance for common tasks, linked directly from the section where users encounter difficulty.
194. Update in-app documentation and screenshots only after the corresponding approved interface is implemented and verified.
195. Keep developer-only implementation details out of operational guidance unless users need them to make an informed choice.
196. Standardize date, time, month and numeric formatting while preserving explicit timezone context for recorded audit events.
197. Ensure admin-only menus remain absent for unauthorized roles and handle server refusals without confusing fake success states.
198. Support long labels and unavailable optional data consistently across settings, reports, history and account surfaces.
199. Review print and printable-report presentation separately, retaining meaningful content while removing interactive navigation chrome.
200. Verify every administrative action using disposable authorized fixtures and document actions requiring APIs beyond the approved frontend scope.

### Phase 11 — Accessibility, keyboard, touch and assistive feedback

201. Target WCAG 2.2 AA through component checks and complete workflow review, retaining the application's existing accessible foundations.
202. Measure ordinary text contrast, meaningful graphical contrast and focus visibility for every theme and interactive state.
203. Keep statuses understandable without color by combining text, grouping, icons and explicit explanatory labels.
204. Preserve the skip link and semantic landmarks, ensuring route changes expose an understandable heading and focused destination.
205. Use a documented heading hierarchy within pages, dialogs and nested panels without decorative heading-level jumps.
206. Consolidate legacy overlay dialogs into an accessible shared lifecycle with correct initial focus, containment and restoration.
207. Ensure only the top active overlay handles Escape, preventing unrelated dialogs or drafts from closing simultaneously.
208. Keep focus visible and unobscured beneath sticky headers, bottom navigation, action footers and software keyboards.
209. Preserve native keyboard behaviors for buttons, fields, menus, tabs, selects and date controls rather than intercepting keys unnecessarily.
210. Make row menus and help popovers usable without hover, with predictable opening, closing and focus return behavior.
211. Prefer 44px touch controls; enforce WCAG AA 24-by-24 CSS-pixel minimum targets or valid exceptions with verified spacing.
212. Associate labels, hints, required states and error descriptions, apply aria-invalid accurately and announce validation outcomes without excessive interruption.
213. Keep loading and success announcements concise, avoiding repeated whole-page announcements during polling or background invalidation.
214. Support 200% zoom, 400% reflow scenarios and enlarged text without losing core tasks or essential information.
215. Respect reduced-motion preferences and ensure no essential understanding depends on animation, shimmer or timed transitions.
216. Test forced-colors and high-contrast modes, preserving control boundaries, selection states and visible keyboard focus.
217. Make comparison scrolling, tab rails and embedded reports keyboard reachable and clearly named when separate regions are necessary.
218. Record NVDA/Chrome and VoiceOver/Safari walkthroughs for key workflows, identifying unavailable real-device checks as dependencies rather than passes.
219. Confirm touch-screen and keyboard task parity, documenting unavoidable native-platform differences rather than disguising missing actions.
220. Resolve or explicitly assess all applicable WCAG A/AA failures; combine automated findings with manual verification rather than relying on severity alone.

### Phase 12 — Frontend resilience, stale scripts and performance

221. Centralize consistent request-state presentation while preserving the existing API helper and supported server error details.
222. Distinguish cancellation, deadlines and server refusal; a frontend timeout or abort never proves server processing stopped or rolled back.
223. Preserve structured field errors and provide safe fallback messages for HTML error pages, invalid JSON or empty responses.
224. Prevent failed requests from clearing useful loaded content or replacing an entire working screen unnecessarily.
225. Track request/refresh generations, account, route, month and dialog lifetime so older same-screen responses cannot overwrite newer results.
226. Keep safe cached data visibly marked as stale and avoid silently presenting it as the latest saved state.
227. Preserve unsaved form values during refresh prompts and data invalidation without storing sensitive records persistently by default.
228. Bound suitable read retries, honor retry guidance and stop obsolete contexts; never blindly replay uncertain mutations.
229. Reconcile uncertain save outcomes using existing read-back or idempotency capabilities, explaining when safe reconciliation is unavailable.
230. Handle session expiration, cross-tab sign-out and permission changes centrally while retaining safe context and avoiding repeated failed mutation loops.
231. Provide minimal HTML/bootstrap recovery even when the entry script fails, with safe error text and a working Retry path.
232. Handle Vite preload errors and missing dynamic chunks with a controlled update prompt that protects unsaved work.
233. Detect repeated recovery attempts and prevent infinite reload loops, especially during prolonged outages or unavailable new assets.
234. Include a build identity in artifacts and expandable support diagnostics, keeping development identifiers out of prominent operational headings.
235. Inspect HTML revalidation, immutable hashed assets and previous-release retention as hosting dependencies without silently modifying server infrastructure.
236. Detect missing styles, failed optional modules and unavailable fonts or icons, providing readable reduced-capability presentation where feasible.
237. Reduce unnecessary broad rerenders and duplicate requests through measured, context-aware invalidation rather than indiscriminate caching.
238. Split expensive optional frontend modules where evidence supports it, resolving conflicting static/dynamic imports without changing operational contracts.
239. Remove obsolete selectors, orphan handlers and unreachable UI paths only after action-inventory and regression evidence establish safety.
240. Guard storage and versioned preferences; preserve CSP/worker isolation and redact tokens, pairing secrets and member data from diagnostics.

### Phase 13 — Complete verification, agent reviews and release readiness

241. Require outcome assertions and fail unexpected loaders/errors/requests, while explicitly distinguishing deliberately injected failures from recovery defects.
242. Test real pointer and keyboard activation for correct destination, context and focus, without forced or evaluated-click bypasses.
243. Test saves through returned values and fresh GET or reload read-back, avoiding stale client caches and production mutations.
244. Test filters, sorts, tabs and pagination against meaningful content changes and preserved state across detail-view round trips.
245. Test downloads by validating names, formats and expected content, including failure handling for blocked or empty downloads.
246. Prove repeated activation sends one mutation and dismissal sends none, using existing read-back or audit capabilities without new backend instrumentation.
247. Cover loading, empty, populated, invalid/empty responses, restricted storage, reordered requests, permission denial, offline, timeout and recovery states.
248. Test widths and heights, including 320×568, 390×844, 844×390, 1024×768 and 1280×720, plus breakpoint edges.
249. Check document overflow, local scroll regions, sticky-content occlusion and touch-target geometry alongside visual screenshot comparisons.
250. Exercise old tabs with missing UI chunks, styles and compute-worker assets, confirming draft protection, isolation and bounded recovery.
251. Run Chromium, Firefox and WebKit coverage where supported, separating emulated browser checks from actual-device verification claims.
252. Record real-device keyboard-open editing, tab switching and rotation with unsaved drafts, including device/browser details and native-control behavior.
253. Compare light, dark, reduced-motion and forced-colors states, investigating meaningful differences instead of accepting screenshots automatically.
254. Re-run existing member, leave, normalization, rules, generation, compute, import, navigation, extra-duty and recycle-bin regressions.
255. Verify workflow equivalence using the same fixtures and approved existing API contracts, confirming presentation changes preserve calculations and exports.
256. Require visual-design, responsive, accessibility, reliability and interaction-test review for every numbered item before completion sign-off.
257. Link each item to files, outcomes, screenshots and source/build snapshots; record passed, failed, blocked, untested or justified not-applicable status.
258. Run type checks, production build and integrated tests; permit no unexplained untested enabled actions in the final snapshot's ledger.
259. Prepare a concrete review build, rollback instructions and an unresolved-issue list before requesting any separate deployment approval.
260. Deliver the completed evidence pack and release summary, retaining approval gates for deployment or any proposed backend expansion.

## Agentic implementation sequence after approval

The five specialists independently read and reviewed all numbered items 1–260 and the surrounding methodology. Their proposed corrections have been incorporated: this records planning coverage, not completed implementation or runtime sign-off.

| Specialist perspective | Planning coverage | Implementation evidence |
|---|---|---|
| Visual design and royal design system | All 260 items | Pending approval and implementation |
| Desktop, tablet and mobile geometry | All 260 items | Pending approval and implementation |
| Accessibility and assistive interaction | All 260 items | Pending approval and implementation |
| Frontend reliability and stale-build recovery | All 260 items | Pending approval and implementation |
| Interaction outcomes and verification | All 260 items | Pending approval and implementation |

Use five continuing specialists, scheduled in waves because four total agent slots permit the coordinator and three specialists concurrently. Visual design owns token/component design; responsive design owns geometry and device behavior; accessibility owns semantics and assistive interactions; reliability owns lifecycle, request and stale-build handling; interaction testing owns the action register and outcome assertions. The coordinator owns integration, shared-file conflict resolution and final acceptance.

All 260 items carry five reviewer fields: visual, responsive, accessibility, reliability and interaction evidence. Reviewers mark pass, required change, conditional dependency or not applicable with a reason. The implementer cannot self-certify a high-risk action through screenshots alone. Reuse these five specialists rather than spawning 1,300 separate agents. Parallelize analysis and isolated modules; serialize overlapping edits to main.ts, styles.css, shared UI utilities and the request layer. Preserve concurrent rules and extra-duty work.

Wave A completes baseline contracts and the component reference. Wave B implements tokens, geometry, navigation and common controls. Wave C migrates profiles, leave, units and import workflows. Wave D migrates generation, review, publishing, extra duties and administration. Wave E completes accessibility, reliability and stale-script recovery across migrated surfaces. Wave F runs all outcome-based regression and cross-perspective reviews, fixes failures and prepares the review build. Each wave must preserve functional workflows and pass its relevant gate before the next migration expands.

## Acceptance and practical limits

Target widths include 320, 360, 390, 430, 768, 820, 1024, 1280, 1440 and 1920 CSS pixels, plus landscape and one-pixel breakpoint boundaries. Cover light/dark themes, keyboard/touch/mouse, enlarged text, reduced motion, forced colors and representative permission roles. Prefer 44px touch controls as the product target; apply WCAG requirements accurately rather than treating that product target as the universal AA minimum.

Require zero unexplained page-level horizontal overflow, no essential content hidden by sticky controls, no confirmed enabled no-op actions, no duplicate mutation from repeated activation, and a defined recovery path for every tested failure. Automated serious/critical axe findings must be zero on tested states, with manual keyboard and screen-reader checks recorded separately. Every action in the register needs evidence; unsupported or unavailable actions must be visibly explained and cannot be counted as successfully exercised.

Measure responsiveness and performance on a declared environment, targeting immediate interaction feedback, minimal layout shift and no regression in critical route or dialog completion. Do not claim universal hardware timings or real-device coverage from desktop emulation. No software can be guaranteed error-free across every browser, driver and network; completion means the approved scope passes the documented matrix and remaining limits are visible.

## Standards consulted

- WCAG 2.2: https://www.w3.org/TR/WCAG22/ — accessibility acceptance criteria and manual/automated verification boundaries.
- MDN container queries: https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Containment/Container_queries — component sizing independent of viewport dimensions.
- MDN environment variables: https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Values/env — safe-area-aware placement.
- MDN reduced motion: https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/prefers-reduced-motion — motion preference handling.
- Vite production guide: https://vite.dev/guide/build — preload-error recovery and HTML cache revalidation considerations; verify behavior against the repository's installed Vite version before implementation.

The user approved implementation of this frontend scope and phased method, with a strict requirement to preserve backend and functional contracts. Deployment and backend expansion remain outside the goal. Completion requires item-specific evidence rather than the existence of this plan or aggregate test counts.
