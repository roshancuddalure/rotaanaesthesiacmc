# Inline member selection lifetime

The visible app Units -> Import unitwise CSV -> Create new member -> Use this
member flow previously selected Safe Member after the name had been edited to
Spare One during a held member-list GET. before.json records that actual UI
outcome without any backend mutation. The frontend now tracks name edits
independently from name lookup generations; changed and changed-back names
invalidate pending selection,while call-level-only changes do not.

A production WebKit keyboard failure exposed a second issue: a name-blur
response replaced the focused candidate button. before-focus.json confirms
this with a controlled held resolver. Exact ID/action focus now survives
repainting; missing candidates fall back to the name input. Only the active
matching candidate branch has runtime focus coverage in this suite.

Final development and production reports contain30 contexts each: three engines,
320/1280 widths and five variants. Tests assert stale success/error suppression,
explicit retry,changed-back name,call-level-only selection,actual node replacement
and native Enter. Chosen correction,other row,file bytes/name,month and unchanged
server member records are checked. Every POST is intercepted; only GET reaches
disposable RAM8032. No create/apply/persistence/real CSV parsing claim is made.

Run node tests/premium-inline-member-selection-lifetime.browser.mjs from frontend;
MEMBER_TEST_URL defaults5197,use http://127.0.0.1:5198 for production. Run alone
against8032. The tests hold declared source files and their own script hash.
Build/package input checks are separately recorded; browser asset identity is
not independently held by this suite.

Failed development readiness log tmp/premium-inline-selection-development.log
is retained: networkidle returned before refreshed preview completion. The test
now waits for the actual response and rendered normalization feedback. Failed
intermediate production log tmp/premium-inline-selection-production.log is
retained as the keyboard-focus discovery. report-development-before-focus.json
is historical intermediate evidence,not the final app source. test-before.mjs.txt
preserves the original stale-selection probe script. Native AT,physical devices,
all roles and complete request equivalence remain outside these checks.
