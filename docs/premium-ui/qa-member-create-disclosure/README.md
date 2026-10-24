# Mobile member creation disclosure

On first Members use at768px or below, **Add member** opens a native disclosure.
The name field and submit control use the full available width. The open header
reads **Hide member form**; hiding it retains the unsaved name and shows a Draft
marker. Search, Import CSV and More stay available. Desktop creation starts
expanded, and a focused disclosure remains visible while resizing to desktop.

The name stays in memory across filters and route changes. Successful creation
clears the submitted name; a different draft entered during that request stays
available. Sign-out clears private draft state. Nothing is autosaved or stored
persistently. A full reload clears the draft; this component does not add a
browser-unload guard. Existing duplicate checks and creation API bodies remain
unchanged.

Run `node tests/premium-member-create-disclosure.browser.mjs` from `frontend`
with the dedicated RAM fixture on8032 and development server on5197. Set
`MEMBER_TEST_URL=http://127.0.0.1:5198` for production. Run alone against8032:
each context resets synthetic data and creates one actual disposable member.

Each environment covers Chromium/Firefox/WebKit at320,390,768,769 and1280.
Checks include native keyboard disclosure/submit,44px minimum target geometry,
enlarged and spaced text, resize focus, scoped tagged axe checks, draft retention,
an injected503 with explicit retry, unchanged real API success, independent GET,
existing member/leave/posting preservation and sign-out clearing. A real success
is held after server commit while filtering rebuilds the form; both submitted-name
clearing and preservation of a different new draft are asserted. No automatic
replay is allowed by the tested refusal/retry sequence.

The source hold covers four declared main/style/API files; the production build
is separately recorded. These are fixture computer-admin and keyboard checks,
not every duplicate/conflict/pending-repeat/role state, actual touch devices,
native AT, general performance or whole-app WCAG certification. The first member
still sits below the initial320px phone viewport.

Current pending-guard follow-up: `report.json` is the15-case development regression on the new guard. The named development/production disclosure reports retain the earlier snapshot. Current pending-specific12+12 reports live in `../qa-member-create-pending/`; pending repeat activation is covered there within its declared scope.
