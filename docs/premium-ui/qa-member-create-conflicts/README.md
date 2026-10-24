# Member creation conflicts and focus continuity

The before probe confirms one stale native duplicate dialog over Overview and
focus lost to BODY while a different unsaved draft survives successful save.
Both frontend defects are now fixed. API paths, request payloads, existing
duplicate policy and explicit different-person confirmation remain unchanged.

The initial test version ran36 contexts per environment: three engines,320/1280
widths, exact duplicate, near-duplicate cancel/accept, injected403 then explicit
retry, delayed conflict after navigation and retained focused draft. The original
test is preserved as inert test-original.mjs.txt. Raw near-navigate rows contain
an overbroad exact_saved_member_readback flag; that branch actually asserts the
original member list is unchanged and409 only. consolidated.json corrects the
flag without changing raw reports or implying a save or another test execution.

The reviewer-requested extra mode adds12 contexts per environment: leaving and
returning to Members before409, and moving focus to the account button during a
held real refresh GET. It records target URL and exact test script hash.

Run node tests/premium-member-create-conflicts.browser.mjs from frontend;
MEMBER_CONFLICT_EXTRA=1 runs only extra cases. MEMBER_TEST_URL defaults5197;
use http://127.0.0.1:5198 for production. Each context resets disposable RAM8032,
so run alone against that fixture. Existing24 pending-repeat regression cases
were rerun separately on the same current application source.

The403 is injected; it proves frontend recovery, not authorization enforcement.
Real409 duplicate responses and real200 saves/read-backs use the existing RAM
API. No production database is accessed. Native AT, physical devices, all roles
and cross-tab/server idempotency remain outside these cases. Source and test
specialists reviewed bounded changes; they did not independently run the suite.
