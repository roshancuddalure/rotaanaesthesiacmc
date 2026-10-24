# Bounded reference focus and state outcomes

Run `node tests/premium-reference-focus-states.browser.mjs` from `frontend`, with
the existing development server on loopback5197. The test makes no API requests.

The16 contexts are Chromium/Firefox, light/dark,320/1280 pixels and forced-colors
inactive/active. Each checks the four reference action variants (primary,
secondary, quiet, destructive), disabled and busy samples, and the ready/recovery
tabs. Actual sequential Tab and Shift+Tab navigation is used. Firefox's native
focus stop on a scrollable tab rail is recorded explicitly.

For each focused variant and tab, assertions check focus-visible, an outline at
least2px wide, center hit-testing, viewport bounds and clipping ancestors. The
disabled controls are skipped by Tab and native programmatic activation produces
no local outcome. Enabled keyboard activation reports its expected local result.
Manual arrow navigation preserves selection until Space, and selected/unselected
tabs retain a computed distinction, including the forced-colors underline cue.

Five declared reference/imported UI/theme files are hashed before and after.
This is component evidence, not all operational controls or a complete build hold.
Computed styles do not prove pixel contrast. Native Windows high contrast, native
assistive technology, physical devices, zoom and other engines remain outside
this test. The screenshots are bounded captures, not whole-application visual
acceptance. The initial test omitted the existing underline selection cue and
Firefox native scroll-rail stop; correcting those test assumptions required no
application change.
