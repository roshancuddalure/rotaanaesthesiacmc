# Allocation goal resume procedure

When working on or resuming the user-approved November 2026 allocation goal:

1. Read `Plan/to do/November26_allocation_action_tracker.md` and the latest execution log. Preserve the full 50-item scope and existing unrelated work.
2. At the beginning of **every resumed work session**, run `tools/show_allocation_progress.ps1`. This starts or reuses the dedicated loopback graphical dashboard and opens its browser window, as explicitly requested by the user. Do not substitute a terminal progress display. Inspect the live service identity before reusing it; do not restart an unrelated service on that port.
3. Keep `docs/allocation-progress/state.json`, task statuses, and evidence/log entries current as work advances. Distinguish completed/verified tasks from work merely started. Record actual test outcomes and unresolved limitations. Estimates must state their basis and uncertainty; show calibration instead of a fabricated finish time.
4. Implement and test approved work autonomously in dependency order. Approval for the 50-item plan was received on 14 November 2026 in this thread. Do not request the same implementation approval again. Domain-policy amendments, new cloud data routing and production deployment require the separate authority recorded in the tracker.
5. On a handoff, record live process/session handles and the next concrete action. Revalidate them on resume. A dashboard process being alive does not prove implementation is running.

This file adds a resume rule for this goal; it does not authorize unrelated work or change the application's domain rules.
