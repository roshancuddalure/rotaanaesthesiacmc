# Main Leave cancellation identity

The before run captured the old anonymous native confirmation. The current
prompt uses the exact loaded record: member, full start/end dates, category,
slot, status and record ID. Missing targets receive explicit refusal. Existing
main POST body remains {}, canonical profile cancellation remains bodyless.
No permissions, cancellation eligibility or backend behavior are changed.

12 development and 12 production contexts cover Chromium/Firefox/WebKit,
320/1280 and light/dark. Each tests three declined overlapping/cross-month targets,
503 without replay, explicit same-target retry, GET refresh/sibling preservation,
inert HTML-like identities and a synthetically missing target. Four late cases per
context hold 200/503 until actual Members navigation or sign-out. Exact response
delivery/completion is awaited before checking draft/focus/login preservation,
no stale toast and no Leave refresh. These 96 subscenarios are within 24 contexts,
not additional independently counted contexts. Every mutation is intercepted.

The first run after the patch failed because same-URL navigation preserved deliberately corrupt
DOM. Unique query URLs now force new documents. Failed logs remain historical.
Month changes, same-screen rerenders, replacement sign-in, physical devices,
native assistive technology and real persistence remain unverified here.
The existing canonical suite's six contexts separately passed.

Run `node tests/premium-leave-cancel-identity.browser.mjs` from `frontend` with
RAM fixture 8032 and development server 5197. Set
`MEMBER_TEST_URL=http://127.0.0.1:5198` to select the production preview.
Run environments sequentially and copy `report.json` before another environment.
