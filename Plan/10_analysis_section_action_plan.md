# Analysis Section Action Plan

Goal: build a clean, flexible, rule-bound, organized Analysis section with no duplicate names and only valid department members.

This plan comes before implementation. It defines the full cleanup and build path so we do not create confusion by mixing data cleaning, analytics logic, UI design, and rule decisions in one uncontrolled pass.

## A. Data Cleanliness Foundation

1. Define the trusted member source as `Plan/Data/ANAESTHESIA department doctors(namelist).xlsx`.
2. Treat `persons.canonical_name` as the only official display name in analysis.
3. Treat `person_aliases` as historical/import name variants, not display names.
4. Add an analysis preflight check that blocks official analysis if invalid names exist.
5. Add an analysis preflight check that warns if duplicate candidate groups exist.
6. Re-run trusted roster reconciliation before finalizing analysis numbers.
7. Re-run invalid member cleanup after roster reconciliation.
8. Preserve all old spellings as aliases before any merge or rename.
9. Create a data-quality summary for analysis: valid members, invalid members, duplicates, aliases, unlinked assignments.
10. Identify assignments linked to deleted/invalid/merged people and ensure they now point to canonical people.
11. Confirm that no analysis row is generated from raw spreadsheet text such as dates, units, headers, campus labels, or placeholders.
12. Add a test fixture with duplicate imported names that must collapse into one analysis row.
13. Add a test fixture with invalid spreadsheet values that must be excluded from analysis.
14. Add a test for alias resolution so imported old names still count under the canonical member.
15. Store the date/time of the last trusted roster reconciliation.

## B. Analysis Data Scope

16. Define which rota period statuses count in official analysis: `historical`, `approved`, `published`, `finalized`.
17. Exclude draft rota periods from official analysis.
18. Add a UI filter to include/exclude draft data only for preview mode.
19. Add month range filters.
20. Add single-month view.
21. Add academic-year view.
22. Add custom date range view.
23. Add department/subdepartment filter where data allows it.
24. Add unit filter.
25. Add call-level filter.
26. Add designation filter.
27. Add duty-category filter.
28. Add campus/location filter if source data supports it.
29. Show exactly which periods are included in the current analysis.
30. Show a warning if any selected month has unresolved import mappings.

## C. Duty Classification And Rule Boundaries

31. Move analysis duty bucket definitions into a structured config rather than scattered hardcoded conditions.
32. Define which duty types count as 24-hour duties.
33. Define which duty types are counted separately but excluded from 24-hour totals, such as 5th call or CART if confirmed.
34. Define weekend logic explicitly as Saturday and Sunday unless the department confirms otherwise.
35. Define weekday logic explicitly as Monday to Friday.
36. Define special categories: Main, CB, RC, Schell, Floating, 5th Call, Caesar A, Caesar B, CART, PAC, Shift, CHAD, RUHSA, Neuro.
37. Add rule metadata explaining why each duty type is counted in each bucket.
38. Add tests for every duty type to confirm correct analysis bucket assignment.
39. Add unknown-duty detection so unmapped duty labels do not silently disappear.
40. Add a dashboard warning for duties that cannot be classified.

## D. Member-Level Analysis

41. Show total 24-hour duties per person.
42. Show weekend 24-hour duties per person.
43. Show weekday 24-hour duties per person.
44. Show day-of-week breakdown per person.
45. Show monthly duty count per person.
46. Show dutywise breakdown per person.
47. Show 5th-call counts per person.
48. Show 5th-call weekend counts per person.
49. Show unit history per person.
50. Show call-level history per person.
51. Show designation history per person.
52. Show detected promotions/call-level changes per person.
53. Show active months per person.
54. Show inactive/no-duty people separately from active-duty people.
55. Add a member detail drawer/page from the analysis table.

## E. Fairness And Balance Metrics

56. Calculate average 24-hour duties per active person.
57. Calculate median 24-hour duties per active person.
58. Calculate minimum and maximum duty counts.
59. Calculate deviation from average for each person.
60. Highlight high-burden outliers.
61. Highlight low-burden outliers.
62. Calculate weekend-duty percentage per person.
63. Highlight people with excessive weekend burden.
64. Compare duty burden within same call level.
65. Compare duty burden within same designation.
66. Compare duty burden within same unit/posting group.
67. Add fairness score for each person.
68. Keep fairness score explainable, not magic.
69. Allow rule-based thresholds to be edited later.
70. Add tests for fairness calculations.

## F. Month-Level Analysis

71. Show total assignments per month.
72. Show total 24-hour duties per month.
73. Show weekend 24-hour duties per month.
74. Show number of active people per month.
75. Show duty category totals per month.
76. Show top duty-burdened people per month.
77. Show unresolved warnings per month.
78. Show member changes per month.
79. Show unit/posting distribution per month.
80. Add month-to-month comparison charts.

## G. Leave And Availability Integration

81. Design analysis fields now so leave can be added later without redesign.
82. Add placeholder metrics for leave once leave import is implemented.
83. Future metric: duties assigned while on leave.
84. Future metric: post-leave/post-duty spacing issues.
85. Future metric: unit elective availability after duties and leave.
86. Future metric: people available per unit per day.
87. Future metric: leave burden by designation/call level.
88. Future metric: duty burden adjusted for leave days.
89. Keep leave metrics separate from duty metrics until source data is reliable.
90. Add UI space for future leave/availability tab.

## H. Validation And Quality Gates

91. Create an `/analysis/preflight` backend endpoint.
92. Preflight should report invalid names.
93. Preflight should report duplicate candidates.
94. Preflight should report unresolved mappings.
95. Preflight should report unknown duty types.
96. Preflight should report analysis periods with no assignments.
97. Preflight should report assignments without valid duty slots.
98. Preflight should report postings without valid people.
99. Preflight should report people with suspiciously similar names.
100. Preflight should clearly say whether official analysis is safe to publish.

## I. User Interface Organization

101. Split Analysis into tabs: Overview, People, Duties, Months, Fairness, Data Quality.
102. Keep the first screen as an operational dashboard, not a marketing page.
103. Add compact filters at the top.
104. Add sticky summary metrics.
105. Add searchable/sortable people table.
106. Add duty category chart.
107. Add month trend chart.
108. Add day-of-week distribution chart.
109. Add weekend burden chart.
110. Add data-quality panel.
111. Add empty states for missing/filtered data.
112. Add loading states.
113. Add clear error messages.
114. Add “last updated” and source-period metadata.
115. Avoid showing raw JSON except in Diagnostics.

## J. Export And Reporting

116. Add export of analysis people table to Excel.
117. Add export of month summary to Excel.
118. Add export of duty category totals to Excel.
119. Add export of data-quality report to Excel.
120. Add printable analysis summary later.
121. Add offline HTML report later if needed.
122. Include source months and rule version in every export.
123. Include generated timestamp in every export.
124. Include filters used in every export.
125. Prevent export if official analysis preflight fails, unless exported as draft/diagnostic.

## K. Backend Structure

126. Refactor `analysis.py` into smaller units: scope, classifiers, aggregators, quality checks, serializers.
127. Add typed result models for analysis responses.
128. Avoid duplicated aggregation logic between dashboard and exports.
129. Cache analysis only after data is clean and invalidated correctly.
130. Keep official analysis deterministic from database state.
131. Add audit record when official analysis is generated/exported.
132. Add rule-version awareness to analysis output.
133. Add tests for each aggregation unit.
134. Add tests for filters.
135. Add tests for preflight quality gates.

## L. Frontend Structure

136. Split analysis frontend code into dedicated modules/components.
137. Move API types for analysis into a clear file if frontend grows.
138. Add reusable metric card component.
139. Add reusable chart helpers.
140. Add reusable table rendering helpers.
141. Add filter state management.
142. Add URL/query state later so analysis views can be shared.
143. Add responsive layouts for analysis tables.
144. Keep text compact and operational.
145. Do not mix Diagnostics payloads into Analysis UI.

## M. Cleanup Execution Plan Before Analysis Rebuild

146. Record current database counts.
147. Run trusted roster reconciliation.
148. Run invalid member cleanup.
149. Recompute duplicate candidates.
150. Manually inspect high-risk duplicate groups.
151. Merge obvious duplicates only.
152. Leave ambiguous names for manual review.
153. Run analysis preflight.
154. Fix any unresolved mapping or invalid-name blockers.
155. Only then rebuild and verify official analysis totals.

## N. Acceptance Criteria

156. Analysis shows no duplicate person rows for the same canonical member.
157. Analysis contains zero invalid person names.
158. Analysis lists all included months clearly.
159. Analysis excludes draft months by default.
160. Analysis duty totals are reproducible from database assignments.
161. Analysis buckets have documented rules.
162. Analysis preflight clearly states pass/fail.
163. Analysis UI can filter by month and duty category.
164. Analysis people table can be sorted by total, weekend, weekday, and duty type.
165. Backend tests cover name cleanup, duplicate collapse, duty classification, and summary totals.
166. Frontend build passes.
167. Backend tests pass.
168. The rota board can understand what each number means without reading code.

## First Implementation Slice

The first build slice should be:

1. [x] Add analysis preflight endpoint.
2. [x] Add analysis data-quality panel.
3. [x] Add canonical-name enforcement in analysis aggregation.
4. [x] Add duplicate/invalid blocker warnings.
5. [x] Add tests proving duplicate aliases collapse into one person row.
6. [x] Run trusted roster cleanup and invalid cleanup.
7. [x] Re-check local analysis counts.

## First Slice Result

Completed cleanup and preflight status:

- trusted roster entries matched: 238,
- invalid member names: 0,
- duplicate candidate groups: 0,
- people after cleanup: 1,098,
- aliases after cleanup: 849,
- designations after cleanup: 16,
- analysis periods: 17,
- analysis person rows: 1,044,
- total assignment records in analysis: 14,119,
- total counted 24-hour duties: 8,133,
- weekend counted 24-hour duties: 2,372.

Remaining blocker:

- 3 unresolved duty mappings remain and need domain confirmation:
  - `DM CO -CALL`,
  - `JUNIOR-1`,
  - `JUNIOR -2`.

Interpretation:

- The name-cleanliness requirement is now satisfied locally: no invalid names and no duplicate candidate groups.
- The Analysis preflight still says `needs_review` because duty mapping decisions are not yet fully resolved.

## Clean Reset Decision

The accumulated historical/imported data was cleared to reduce confusion.

Current clean baseline:

- Department members are seeded only from the trusted roster workbook.
- Created members: 222.
- Created position/designation rows: 222.
- Aliases: 0.
- Duplicate names: 0.
- Invalid member names: 0.
- Historical rota/import data: cleared.
- Analysis data: empty until clean duty data is imported or created again.

This is now the safer starting point for rebuilding Analysis from clean inputs.
