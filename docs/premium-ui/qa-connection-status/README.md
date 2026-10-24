# Connection status and startup ownership

The before probe reproduced lost draft focus after delayed startup health and
old-session startup replacing the new session view. The previous status was
hidden on small screens and described connection continuously after one check.

Current Server details shows explicit last-check state and manual existing health
GET, with checking, checked, unconfirmed, offline and five-minute stale states.
Network events never trigger health polling. Late requests cannot update disposed
UI; startup belongs to its shell/account/view. Pre-auth Check starts disabled.

36 development plus36 production contexts cover three engines,320/1280,
light/dark and status/session replacement/startup failure variants. Tests assert
exact completed health request phases, draft/focus preservation, repeated native
Enter, error/retry, offline/online uncertainty, simulated freshness, dismissal,
real loaded Overview recovery and scoped tagged axe in status variants only.
All sign-in requests are synthetic and intercepted; no mutations forwarded.
30 header regressions and8 shell workflows separately passed;104 unit tests and
held build passed. No whole-app WCAG, physical, native AT or timeout certification.

Run node tests/premium-connection-status.browser.mjs from frontend. RAM8032 and
dev5197 are defaults; MEMBER_TEST_URL selects preview5198 (see script).
Run environments sequentially: the script writes report.json. Preserve each raw
report before another run. A sequential dev recapture corrected shared-output
overwrite; it is not counted twice. Retained failed/intermediate artifacts are
historical, including the diagnosed WebKit contrast and account-menu overflow.
