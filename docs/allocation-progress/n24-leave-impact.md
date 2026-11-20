# N24 leave-impact integration — work in progress

N24 remains incomplete. This document records the duty-impact integration. Subsequent proposed-leave OT comparisons are documented in [n24-ot-leave-review.md](n24-ot-leave-review.md); reviewed repair generation and complete integration acceptance remain unfinished.

## Implemented behavior

`leave_impact.affected_duties` is shared by monthly pending-leave approval and manual/profile leave review. It reports active assignments affected by either the existing duty-date/start-hour policy or actual interval intersection. These reasons stay separate: a temporal warning does not amend the established allocation policy. A previous-month duty continuing into a leave interval is included. Half-open adjacent intervals do not overlap. Cancelled assignments are excluded and repeated leave references do not multiply impacts.

Each impact identifies the slot, affected person, period, month and protection status. A draft template slot with exactly one active assignment is described as a possible reviewed repair scope. This metadata does not establish eligibility, lock clearance or feasibility. Published, non-draft and unscoped periods require authorized resolution. No assignment is changed by preview or approval.

Manual review uses a detached value object for prospective leave values. It neither inserts a speculative request nor edits the stored request during preview. Cancelled and rejected proposals do not claim to block duties. Existing acknowledgement and audit workflows remain in use.

Review tokens now include the returned duty-impact evidence. In addition to existing canonical context invalidation, changing an affected period from draft to published changes its review token. Monthly approval rejects the stale token before changing request statuses.

Work is bounded to 5,000 leave records, 371 spanned dates, 100,000 record-dates, 2,000 assignments and 200,000 assignment/leave comparisons. Oversized reviews receive an explicit validation error rather than silently truncating impact evidence.

## Verification

The initial monthly integration and existing approval/history/import regression suite passed 50 tests (`n24-duty-impact-final.xml`). Subsequent manual integration and publication-token tests require their own final evidence; the initial result does not certify those later changes. Final refined-source regression passed 54 tests in 82.54 seconds, with zero failures/errors/skips (`n24-duty-review-final.xml`). Ruff and scoped whitespace checks passed. This includes monthly/manual overnight impact, read-only proposal, cancelled/rejected exclusion, unchanged assignments, and publication-stale review checks. Source hashes are recorded in `n24-duty-source.json`.

## Remaining acceptance work

- Complete administrator presentation and end-to-end acceptance of the implemented immutable OT before/after projections for leave creation, editing, cancellation and approval, including unknown configuration and pending-leave assumptions.
- Verify OT/context invalidation under actual concurrent transaction ordering; sequential OT-calendar changes now invalidate monthly/manual review tokens.
- Connect eligible draft impacts to the existing reviewed repair workflow; preserve explicit slot locks and published periods, and revalidate the full result before application.
- Cover leave-import impacts and cross-consumer consistency without introducing another leave database.
- Exercise real PostgreSQL concurrent leave approval versus allocation/application. Sequential stale-token checks do not prove concurrency correctness.
- Verify the resulting administrator UI, including protected-impact warnings, scoped repair review, stale results, keyboard/mobile access and error recovery.

No domain-policy amendment, operational migration, deployment, cloud route or model installation is part of this batch.
