# Unit-list print state: source concern requiring runtime verification

During the read-only review of concurrent frontend changes, `unit-member-lists.ts`
now contains pagination plus `prepareUnitMemberPrint`. This note is a static
finding, not a reproduced application defect or an acceptance decision.

`listBody(key, items, true)` sets `page` to zero and writes it into the shared
`pages` map. The print preparation function calls it, then its returned cleanup
restores saved DOM nodes without restoring the map. If this export is connected
to printing, a list initially on page 3 can restore its page-3 controls while the
next click calculates from internal page zero. This needs a focused test before
accepting print/page-state continuity.

Also verify that the application actually calls this preparation before print:
pagination must not silently restrict the existing printed member list to only
the visible page. The inspected main import at the start of this review did not
include the preparation export; concurrent edits may still be in progress.

Verify a later page, print preparation, complete matching printed rows, cleanup,
retained live nodes/focus and then Next/Previous. Check cancellation and repeated
print as well. If reproduced, preserve both the original per-list page state and
DOM on cleanup without changing export contents or API/data semantics. Preserve
concurrent edits and bind the test to a stable current source snapshot.

Follow-up source clarification: `unit-board-filters.ts` imports the preparation
helper and invokes it from its existing print lifecycle, then calls its cleanup
after printing. The integration exists outside `main.ts`. Do not add duplicate
print hooks. The outstanding concern is the helper's internal page-map mutation
and cleanup continuity on that active path; reproduce it before changing code.
