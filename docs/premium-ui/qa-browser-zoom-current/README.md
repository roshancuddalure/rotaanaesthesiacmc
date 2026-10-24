# Actual browser zoom and short profile editors

The test sets Chromium tab zoom using `chrome.tabs.setZoom`, then independently
checks `getZoom`, effective CSS viewport, devicePixelRatio, CSS zoom=1 and visual
viewport scale=1. At a 1280×900 browser viewport, 200% yields 640×450 CSS pixels
and 400% yields 320×225. This is browser page zoom, not injected CSS enlargement.

The six zoom/theme contexts cover seven production routes and a profile task:
42 route checks plus six unsaved-editor workflows. The editor task types text,
checks field and Save center-point hit targets, preserves the draft across tabs
and declined close, explicitly discards and verifies opener focus. No mutation is
sent. Sources and production assets must remain fixed during execution.

The pre-fix report in `../qa-browser-zoom-before/report.json` records the profile
body collapsing to 32px (padding only) at 400%. The CSS fix applies below a 360px
viewport height and lets the entire native profile dialog scroll, keeping its
form and footer in normal flow. The after report measures a 590.39px natural
content region inside the bounded 225px dialog, with the edited field and Save
reachable and unobscured. Other profile behavior and API contracts are unchanged.

The helper extension is loaded only in a new temporary test profile and is not
shipped in the app or installed in a user's browser. It has tab metadata access,
no content scripts and no network logic. The script checks the exact loopback
test-tab URL before setting zoom and removes the temporary profile after closing.

Headless captures of the zoomed native dialog are blank in this environment,
including an attempted direct capture. Those PNGs are retained as diagnostics and
are not visual sign-off. Real keyboard input, zoom metrics, bounds and hit tests
are recorded independently. `short-viewport-dark-profile.png` is a separately
reviewed 320×225 CSS viewport capture, not an actual-zoom screenshot.

## Reproduce

Build with `tools/verify_frontend_build_snapshot.py`, start the production preview
at loopback5198 and `tools/frontend_visual_fixture_server.py` at8033 as described
in [the page audit](../qa-responsive-current-20261023/README.md). From `frontend`:

```powershell
node tests/premium-browser-zoom.browser.mjs
```

Requires bundled Playwright Chromium with extension support. `ZOOM_PROBE=1` runs
one diagnostic400% case and writes the separate before folder; do not use it to
overwrite retained before evidence. The normal run writes this current folder.

This verifies one small synthetic superadmin fixture in Chromium. It does not
certify every workflow, other browsers' native zoom, screen readers, physical
devices or all260 requirements. Cross-engine short-viewport reflow and normal
header regressions have separate reports.

Method references: [Playwright extensions](https://playwright.dev/docs/chrome-extensions)
and [Chrome Tabs zoom API](https://developer.chrome.com/docs/extensions/reference/api/tabs#method-setZoom).
