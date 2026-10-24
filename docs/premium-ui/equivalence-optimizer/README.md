# Server optimizer equivalence

The full report compares 24 original/current pairs: Chromium, Firefox and WebKit
at 320/1280 pixels, with four identical synthetic seed cases:

- Fresh: two eligible first-call duties and one second-call duty with no candidate.
- Preserve: one saved first-call assignment is explicitly locked and must survive.
- Repair: one saved assignment is blocked by approved leave; only that selected
  assignment may be replaced, with its prior record retained in history.
- Preferences: a reviewed preference is added for a posted member and duty.

Each run uses the real exported optimizer workspace and existing API services,
the server engine, and native test-only Vite proxy. It generates a proposal,
checks that nothing was saved, searches a distinct alternative, selects it,
downloads evidence, explicitly reviews and applies, and validates/reverses.
Completion callbacks occur once per apply and reversal. Active assignments after
reversal must match the original semantic records exactly; duty fields stay fixed.

Comparisons include complete decisions, workload burden, objective values/proof
flags and alternative reports apart from their elapsed times. Raw downloaded
JSON retains all fields. The selected-field comparison excludes generated job
identity/context/timing metadata, and request paths map job IDs only from observed
responses. Request bodies and statuses are exact, including selected alternative
index, revisions, locks, repair scope and preference. Saved state uses semantic
record fields while generated primary keys/creation timestamps remain outside scope.

All baseline source files must match the retained manifest. Original/current
frontend and backend app sources must remain stable during execution. No application
or backend source changes, production operations or hardware GPU claims are made.
SQLite RAM requests are serialized; production concurrency, all fixtures/roles,
teaching/learning/assistant controls and other failures need separate acceptance.
This report does not certify the whole 260-item programme.

The selected-field comparator also omits `error`, `fallback_reason`, `frame`,
`metrics`, `result`, `template`, and intelligence `version`, `options`,
`learning_version`, `weights`, `input_snapshot`, `originals`, and
`alternative_notice`. These fields are not certified by pairwise equality.
The repair fixture has one existing assignment: the selected target. Preservation
of a separate existing, unselected assignment requires another fixture. Source
holds in this suite cover frontend `src` and backend `app`; public assets,
configuration, dependencies and fixture tools are outside that hash boundary.

## Reproduce

Use the dedicated RAM server and native proxy setup in
[the import instructions](../equivalence-import/README.md), with the retained
manifest-verified snapshot and installed frontend/backend test dependencies.
Do not run another suite against port 8032 or edit source concurrently.
From current `frontend`:

```powershell
node tests/premium-optimizer-equivalence.browser.mjs
```

`EQUIVALENCE_QUICK=1` runs one desktop engine and four cases for diagnosis; it
cannot substitute for the full matrix. Preliminary failure screenshots are
diagnostic history, not passing evidence.

## Repair scope with an unrelated saved assignment

`OPTIMIZER_REPAIR_UNSELECTED=1` runs a separate six-pair browser/width matrix
and writes `../equivalence-optimizer-unselected/report.json`. Each original/current
run restores the repair seed, then uses the existing manual-assignment API to
save Safe Member on May4. Only the blocked May2 duty is selected for repair.
Assertions preserve the exact unrelated saved assignment, compare selected
proposal to applied assignments, retain the cancelled target's history, and
restore both original assignments on reversal. The May4 slot identifier in
captured setup requests maps only from its observed fixture state. No fixture
server, backend or scheduling code changes are needed.

```powershell
$env:OPTIMIZER_REPAIR_UNSELECTED='1'
node tests/premium-optimizer-equivalence.browser.mjs
Remove-Item Env:OPTIMIZER_REPAIR_UNSELECTED
```

Run alone against8032. This covers one explicitly unselected existing assignment
and one selected repair target; it does not certify every repair or concurrency
case. The original four-variant report remains separate.
