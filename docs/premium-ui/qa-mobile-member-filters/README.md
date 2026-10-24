# Compact initial mobile filters

The optional position/call disclosure starts closed on first Members use at
768px or below and open above768px. Its explicit native choice then stays in
memory across filter rerenders, profile visits, route round trips and resizing.
It does not persist across a full reload. Filter values and applied-count
summaries remain unchanged; collapsing a disclosure never clears a filter.

Run `node tests/premium-mobile-member-filters.browser.mjs` from `frontend` with
the dedicated RAM API on8032 and development server on5197. Use
`MEMBER_TEST_URL=http://127.0.0.1:5198` for production. Run alone against8032.
Each environment covers Chromium/Firefox/WebKit at320,390,768,769 and1280.
Meaningful read-only call/search results, counts, explicit toggles, resize,
profile and route round trips, and reset are asserted. Source holds cover the
three declared main/style files only; the held production build is separately
recorded. The existing six light/dark member-filter workflows are also retained.

At320px the measured height reduction is112–122px. The first member still sits
below the initial phone viewport; this is a bounded improvement rather than a
claim of a complete mobile roster redesign. Physical devices and native AT
remain pending. The prototype's delayed-toggle route race was corrected by
capturing the native open property before route teardown, then both complete
environment matrices were rerun.
