# Real canonical profile action outcomes

The test runs the current production app in Chromium, Firefox and WebKit at
320×568 and1280×800. Requests go to existing API services on the dedicated RAM-only
equivalence server. Each context restores the same seed first. It never accesses
the configured working database and must not run alongside other port8032 tests.

Each context verifies:

- Rename, base default call, aliases and future designation/call-level changes
  survive an independent GET and profile reopening after a full page reload.
- Removing an unsaved alias, designation row or dated-call row affects that draft;
  the final save contains only the intended rows.
- A committed success response is deliberately held before delivery. The pending
  Save button stays disabled and another real Enter sends no second mutation.
- Future designation is not shown as current; the future dated call does not
  replace the current base default before its effective date.
- Two actual external saves make the open draft stale. The real server returns409.
  “Use latest version” changes only local editor state; “Keep my draft for review”
  retains the draft and updates its revision without automatically saving it.
  A later explicit Save uses that current revision and succeeds.
- Fresh reads preserve the exact linked posting and leave records. Activity grows
  only for four successful operations (two UI saves and two external test saves),
  while the two refused UI saves produce no profile-update activity.

The UI PUT status sequence is exactly200,409,409,200 per context. Responses are
forwarded unchanged; only the first successful response is delayed to test pending
activation. This is not a simulated persistence response. The role is the fixture's
computer-admin principal; production authentication/permissions are not certified.

This covers selected action variants, not every member control. It does not test
deleting existing saved timeline rows, every membership state, every CSV/merge/
clipboard/history path, all conflict merge semantics, native AT or physical devices.
Keeping a draft is an explicit overwrite review, not automatic field merging.

## Reproduce

Start `tools/frontend_equivalence_server.py` on8032 and the current production
preview on5198. The existing build must match the intended source snapshot.
From current `frontend`:

```powershell
node tests/premium-profile-persistence.browser.mjs
```

`PROFILE_PERSISTENCE_QUICK=1` is one desktop pair for diagnosis and cannot substitute
for the six-context matrix. Failure screenshots from preliminary selector mistakes
are retained as diagnostic history, not passing evidence. The full test selects
the visible responsive member control and uses its existing field data attributes.

See `../contracts/member-profile-persistence-current.json` for exact source action
IDs, context and remaining variants. That register does not change the static
inventory's runtime count or certify complete historical contracts.

The same workflow can also run at actual Chromium browser zoom:

```powershell
$env:PROFILE_BROWSER_ZOOM='1'
node tests/premium-profile-persistence.browser.mjs
Remove-Item Env:PROFILE_BROWSER_ZOOM
```

This mode uses four fresh disposable browser profiles: light/dark at200%/400%.
The test-only extension calls `chrome.tabs.setZoom/getZoom`; assertions verify
the actual zoom,640×450/320×225 effective viewport, DPR2/4, CSSzoom1 and visual
scale1. Source/build and extension files are held. Results go separately to
`../qa-profile-persistence-zoom/report.json`; the normal six-context report is
preserved. The full save/reload/conflict workflow runs at each zoom setting.
Focus is scripted and activation uses real keyboard input; this does not prove
unaided sequential keyboard navigation, native AT or reliable native-dialog
screenshot rendering. Only Chromium supports this test's extension setup.
