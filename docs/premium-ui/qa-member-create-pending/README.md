# Pending member creation

The pre-change Chromium320 probe observed two POST attempts from native repeated
Enter while an intercepted refusal was held. Both were intercepted: no database
write occurred. This is evidence of duplicate requests, not duplicate saved rows.

The frontend now owns one pending creation operation across form rebuilds. Its
submit action is disabled and shows Creating; the status names the submitted
member and explains that subsequently typed changes remain unsaved. A failed
request restores the action and draft for explicit retry. Route changes and
sign-out protect the current UI from stale completion; they do not cancel or
roll back a server mutation.

Run `node tests/premium-member-create-pending.browser.mjs` from frontend with
the disposable RAM fixture on8032. Default UI server5197; use MEMBER_TEST_URL
http://127.0.0.1:5198 for the production preview. Run alone against8032 because
each context resets synthetic records. Both reports cover three engines,
320/1280 widths and navigation/sign-out variants:12 contexts each. The test
asserts actual DOM replacement before repeat activation,503 refusal, explicit
real200 retry, exact unchanged request body, independent GET and late-response
boundaries. A response held after commit tests UI lifetime, not cancellation.

The guard is per page/session; cross-tab/reload idempotency is not provided.
Native AT, physical devices, all roles and near-duplicate variants are pending.
See reviews/member-create-pending-current.json for exact hashes and limitations.
