# Canonical profile initial recovery

The before probe found no visible Close while the first profile GET was pending
and no Retry after an initial failure. The profile now uses existing shared
loading/failure helpers. Retry closes the unavailable dialog,reopens the same
member with the same context and preserves the existing async return behavior.
Both initial success and failure require a connected,open owning dialog.

Final24development+24production contexts cover Chromium/Firefox/WebKit,
320/1280,light/dark and actual Members/Leave entry controls. Each case observes
six same-member initial GETs: pending dismissal,503,held503retry,real recovery,
another503 and retry dismissed before held success. Native repeated Enter sends
no extra retry. Identity,entry tab,opener focus,unchanged members,scope-tagged axe
and Close geometry/center-hit are checked. Close activation itself is keyboard.

The initial strict geometry logs are retained. Diagnostic repeat captured
43.99999809265137px in Firefox for44px computed min-height. The test allows
0.01CSSpx rounding but still requires44px computed minima and center-hit.
No application CSS was reduced. Root inspected the320dark loading/error images.

Run node tests/premium-profile-initial-recovery.browser.mjs from frontend with
RAM8032; MEMBER_TEST_URL defaults5197,use http://127.0.0.1:5198 for production.
Run alone against8032. Six declared source files and the test hash are held.
Real-save regression is separately recorded in qa-profile-persistence/report.json;
it performs actual disposable RAM writes,unlike this initial-recovery suite.
No production mutations,native AT,physical touch or all-role acceptance claimed.
