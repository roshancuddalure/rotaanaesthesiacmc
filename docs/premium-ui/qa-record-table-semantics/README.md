# Member, leave and posting table semantics

The three record tables reference their existing visible heading IDs using
`aria-labelledby`. This gives each table its own accessible name without changing
visible text, spacing, handlers, filters, request payloads or saved data. A named
surrounding section alone did not name the table itself. This is an accessibility
improvement; it is not a claim that every unnamed table is a WCAG failure.

From `frontend`, run `node tests/premium-record-table-semantics.browser.mjs` with
the dedicated disposable RAM API on8032 and development server on5197.
`MEMBER_TEST_URL=http://127.0.0.1:5198` selects the production preview. Run alone
against8032; the suite resets its seed before checking real read-only routes.

Chromium, Firefox and WebKit each check members, leave and units at320,700,701,
767,768,769 and1280 pixels:63 route contexts per environment. Assertions cover
unique heading references, actual accessible table names at desktop widths,
explicit column scopes, the768px table/card transition, one visible responsive
member-profile control and meaningful leave data. The unit grouping board
intentionally remains available on both layouts, alongside the complete desktop
posting list. These are different views, not duplicate mobile fallback markup.
Browser writes are rejected; member/leave/posting snapshots must stay unchanged.

The source hold covers the three declared main/style files only. This is not
every table, all role/empty/error states, native screen-reader verification,
physical devices or whole-application WCAG certification. The source inventory
still lists60 literal table openings as unclassified; the three bounded runtime
surfaces do not automatically certify the others.
