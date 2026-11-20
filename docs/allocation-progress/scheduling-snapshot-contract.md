# Scheduling snapshot version 3

This is N04 implementation evidence, not completion of N04 or the 50-item plan.
The reviewed scheduling hash now uses `scheduling_snapshot.capture`. Operational
import review retains its separate full-row fingerprint and its existing contract.
Older scheduling proposals need regeneration when this format is deployed; no
deployment is performed by this work.

`SchedulingSnapshot` is frozen and contains only a version, canonical JSON string
and SHA-256 digest. It holds no mutable ORM or nested JSON references. Capture
reads saved SQL columns under `no_autoflush`; pending caller edits are preserved
and are not silently committed or certified. The payload is server-side evidence,
not a new browser/GPU/assistant data route.

The input table set covers people/aliases/designations, effective calls/postings,
units/call minima, mappings/references, approved/pending leave, duties/assignments,
rule versions/settings, dated groups, periods/scope/locks, active learned weights,
unit fallback order, extra-duty ledger records and the batch mode used by balance
eligibility. Enabled OT adds saved calendar configuration and revisions. The apply
lock set uses the same table names, including the fallback and ledger additions.

The field projection excludes selected private notes, leave raw-name copies,
call-change reasons/actors, rule/group descriptions and audit update timestamps.
It represents assignment overrides by presence and template forced allocation by
the canonical reason-prefix classification, preserving decision-relevant flags
without retaining the reason text. Ledger reason/justice audit payloads and batch
before-images/operator names are excluded; ledger identities, dates, status,
overridden codes and batch mode remain. Full audit records stay in their canonical
tables and existing conflict-aware undo checks.

Creation timestamps remain: dated-call ties and latest holiday-setting selection
use them as precedence. Object key order is canonical. Only explicitly recognized
call/group/skill pool lists of strings are sorted; duty-rule and fallback ordering
are preserved. The projection does not assume every list or timestamp is unordered
or irrelevant. Other source/reference fields remain conservatively included.

Balance and extra-duty apply validate the signature first, rebuild the plan under
the input lock, and compare both decision identity and the token's signed snapshot
identity. Matching decisions alone do not authorize a stale preview. Existing
already-applied batch lookup precedes this comparison so a legitimate retry reads
the original durable result without applying again.

Evidence:

- `test_scheduling_snapshot.py`: private-note/import separation, thirteen input
  mutation scenarios, frozen detached evidence/no flush, call-pool no-op and
  precedence-bearing duty order. Fallback/ledger parents are established before
  the baseline so the tested relationship/record is what changes the hash.
- `n04-projection-regression.xml`: 191 passing checks across snapshots, learned
  versions, reviewed compute/intelligence, OT template, extra duty and balance.
- `n04-projection-postgres.xml`: 32 passing real checks including OT and learned
  preference/apply races plus existing concurrency suites. Runner cleanup passed.
- `n04-specialized-token-before.xml`: two reproduced stale-token acceptances when
  decision hashes matched but the signed scheduling context had changed. Inspect
  `n04-projection-final.xml` then passed 177 checks after both context comparisons,
  including actual specialized apply and idempotency regressions.

## Coherent reviewed preview acquisition

`rota_compute.prepare_planning_inputs` initializes rule/group defaults before
acquiring the existing global/month namespaces and scheduling input lock. It then
rechecks the draft period. Ordinary, intelligent and template creation call it
before loading their planning evidence. Creation defaults, clean cached ORM values,
rule DTOs, scope and context hash therefore share that transaction's locked input
view. Clean-state expiration and bootstrap commit ownership now apply with either
OT flag setting; OT calendar tables remain conditional on that flag. Pending edits
and new relationship rows are preserved.

Member, intelligent and template planning steps acquire the input lock before
checking freshness and reloading context. Template hypothetical generation acquires
its lock before its savepoint, so rolling back the preview does not release the
root lock. A bootstrap ownership marker is still not proof that an unrelated
savepoint rollback retained a lock; callers acquire the actual lock explicitly.

Before-fix PostgreSQL evidence reproduced member creation certifying old zero-duty
counts with a new duty hash, and intelligent creation mixing earlier input evidence
with later baseline counts (`n04-acquisition-before-tests.xml`, 13 passed/2 failed).
Afterward, `n04-acquisition-postgres.xml` passed 34 checks including actual waiting
writers and both creator modes. `n04-acquisition-final.xml` passed 75 checks,
including all three creation paths refusing publication changes at the lock boundary
and clean/pending/bootstrap preservation with OT enabled and disabled.

Input writes can wait while a bounded planning step holds this lock. This reuses
the existing serialization mechanism; N26 must measure contention and latency along
with allocation quality before any performance/rollout claim. It does not establish
global unit-allocation optimality or authorize operational deployment.

Remaining N04 requirements include complete change/no-op coverage (including
pending/dated edge cases), privacy review of nested rule/reference configuration
and consumer reconciliation against the original acceptance row. Do not mark N04
or N14 complete from this module or these passing subsets.
