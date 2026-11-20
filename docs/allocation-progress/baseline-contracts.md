# Allocation baseline and constraint register

Recorded: 14 November 2026. Source revision and pre-existing diff fingerprint: `baseline-source.json`.
This is current-source inspection, not a claim that every path is safe or complete.

## N01 — entry-point inventory

| Path | Source and current authority | Validation/concurrency boundary | Required OT extension |
|---|---|---|---|
| Empty unit template | `rota_template.generate_empty_template` | Locked monthly scope; sequential pressure/fairness state; conservative shuffle; forced slots visibly need review | Replace/repair dependent unit decisions using real simultaneous OT capacity |
| Reviewed CPU/GPU template | `template_compute.preview`, `advance`, `apply` | Rolled-back preview and canonical replay; revisions/context fingerprint; atomic apply | OT input in fingerprint, pressure and replay, not numeric GPU authority |
| Manual assignment | `rota_assignment.validate_assignment`, `assign_person_to_slot` | Eligibility; dated unit posting; symmetric nearby overlap/rest; staffing; monthly limits; explicit override classification | Identity-level OT feasibility in final-state check, with explicit policy for exceptions |
| Candidate/autofill | `rota_candidates.slot_candidates_with_context`, `rota_auto_fill.run_safe_auto_fill` | Shared indexed monthly context; clear eligible candidates only; normal validator; no synthesized override | Same OT context and capacity guard as manual path |
| Reviewed member scoring | `rota_compute.create_job`, `advance`, `apply_job` | Owner, quota, revision, snapshot, expiry, table locks and final validation; GPU winner canonically checked | Snapshot OT versions, invalidate stale hints, final whole-plan OT check |
| Whole-month optimizer | `rota_intelligence.advance`, `rota_optimizer.solve_month`, `validate_plan` | CPU CP-SAT with lexicographic priorities; candidate pruning; validated seed; independent safety cuts; preserved duties and next-month first day | OT reservation feasibility coupled with selected unit/person variables; joint vs iterative benchmark |
| Balance duties | `balance_duties.preview`, `apply`, `undo` | Month locks, explicit revalidation, independent `extra_duty_verify.check_month`, before images and conflict-aware undo | Add OT to specialized month-state checks, independent checker and post-move feasibility |
| Extra-duty allocation | `extra_duty.preview`, `apply`, `MonthState`, `CandidateState` | Specialized hard/overridable codes and ledger; validation under month locks | Enforce mandatory OT according to explicit exception policy; no silent import of normal-path assumptions |
| Superadmin allocation | `superadmin_allocation.options`, `strict_blocks`, `allocate`, `undo` | Separate strict blocks for leave/rest/overlap; explicit cross-level confirmation; allowed published-month changes in this specialized workflow; ledger attribution | Preserve existing authorized exception behavior and add attributable OT impact; ordinary planner must not inherit these privileges |
| Exchange approval | `rota_review.create_exchange_request`, `approve_exchange_request` | `validate_assignment` on reviewed replacement; approval workflow | Recheck OT final-state impact and context at approval, including preserved duties |
| Restore | `recycle_bin._restore_payload`, `restore` | Dependency, duplicate and integrity checks; per-item transactions. Generic restore does not itself run the allocation validator | Enumerate payloads; historical records must remain historical; prospective restore needs OT and existing safety checks where relevant |
| Leave create/edit/approval/import | `api/v1/leave.py`, `leave_approval.py`, `operational_import.py`, `leave_import.py` | Canonical requests; existing duplicate/import review and approval impact evidence | Interval accounting, auditable lifecycle, OT impact preview and explicit repair proposal |
| Posting/reference import | `operational_import.fingerprint`, `apply_batch` | Reviewed preview, canonical mappings, source trace, stale-input fingerprint and lock | Include new OT source data where relevant; changed personnel capacity invalidates dependent previews |
| Historical duty import | `historical_import`, `past_duties` and operational import services | Source-traced historical record; not a prospective permission decision | Do not retroactively reject historical facts using today's OT demand; label history coverage |
| Review/publish | `rota_review.rota_review_month`, `rota_publish.rota_publish_checklist`, `approve_rota_publish` | Normal checklist blockers; **existing** explicit superadmin publish-anyway branch records blockers, warnings and unfilled slots | OT shortages in checklist and independent report; preserve explicit override branch, never silently use it |
| Excel/report export | `rota_publish.final_rota_export`, `rota_template` exports, `rota_report_360` | Export saved assignments, conflicts, unfilled duties and publish readiness | Reconcile OT demand/capacity and explicit exceptions; no invented coverage |

Permissions are applied in their corresponding `backend/app/api/v1` route modules. Router-level role checks are distinct from service constraints and must both be exercised in N47/N48. Inventory uncovered two important differences from older shorthand descriptions: superadmin operations can intentionally affect published months; generic restore is primarily integrity-based. These are test/extension targets, not reasons to claim normal-path protection everywhere.

## N03 — constraint and precedence register

Later owner-approved amendments win over earlier prose. In particular, `docs/call_level_pool_and_balance_contract.md` amends the single-level wording in `docs/limits_callevel_fairness_contract.md`. The current shared `rota_eligibility` implementation supports explicit multi-level pools.

| Constraint / authority | Input and checker | Normal generator requirement | Exception boundary / evidence target |
|---|---|---|---|
| Effective call pool and allowed/excluded groups — Rota Rules + later pool contract | Dated call history, slot stamp or rule pool, active group memberships; `rota_eligibility.eligibility` | Member belongs to required level set and allowed groups; no unrelated crossover | Explicit superadmin crossover only; pooled duty within its configured levels is not an exception; eligibility contract tests |
| Dated unit membership and active member — assignment contract | Actual posting interval and active status; `validate_assignment` | Eligible posted person, no automatically supplied override | Manual/extra-duty exception codes retain existing explicit semantics; no silent broadening |
| Approved versus pending leave — canonical leave services | Canonical leave status, date/slot overlap; `slot_leave_blocks`, `person_blockers`, specialized strict checks | Approved blockers excluded; pending warnings never auto-approved | Existing manual override classification differs from superadmin strict leave block; preserve and expose until amended |
| Overlap / 24-hour rest — confirmed decisions and current rules | Recorded/provisional nearby duties across month boundary; `validate_assignment`, optimizer incompatibility, `strict_blocks` | No new overlap or configured minimum-gap violation | No model-generated exception; published history remains facts rather than silently corrected |
| Unit/call minima — unit settings + rules | Available identity count and call-specific override; `slot_safety`, specialized month-state safety | No unsafe new assignment | Existing exception workflows remain attributable; OT extension must not double-count reserve |
| OT minimum / target — newly approved feature scope | Explicit dated recurring/exception records, time bands, allowed levels/skills; new matching guard | Mandatory reservations feasible alongside duty/rest; optional targets subordinate to approved priorities | No fabricated default demand; mandatory-vs-target and reserve semantics explicit/configured |
| Monthly counts and fairness — Limits + pool/balancing amendments | Call-level targets, effective availability, burden, group/campus caps; candidate scoring and optimizer tiers | Preserve current hard caps and pro-rata equality; campus is last under current contract | Existing extra-duty justice ledger is separate from normal equality; exceptions do not become learned policy |
| Frozen commitments and repair scope — intelligent generator | Originals, selected repair slots, locks, writable period; `without_slots`, `validate_plan`, apply | Preserve scope and protected assignments; reject stale application | Existing special published-month authority is not transferred to ordinary optimizer |
| Historical evidence / learning — intelligence implementation | Approved examples, exception exclusion, month-separated holdouts and model versions | Versioned candidate activation with held-out validation | Historical import never proves correctness; rejected/exception examples excluded; no automatic fine-tune |
| Input freshness and atomicity — reviewed compute contract | `context_hash` plus durable revisions, owner, expiry; PostgreSQL table locks | Apply only a current fully validated proposal once | Unknown HTTP outcome requires durable read; retry is not proof of rollback |

### Current objective order (N05 evidence; not a policy amendment)

`rota_optimizer.solve_month` currently orders: required coverage, total coverage, changes (when repairing), personal preference (only in preferences mode), call-level equality, weekend burden, night burden, holiday burden, workload, spacing/history, and preference (when not already prioritized). The proposed OT minimum is feasibility, not a lower-priority score that can be outweighed by coverage. N05 must retain or explicitly amend this order with worked pooled/pro-rata examples before changing it.

### N04 snapshot extension specification

Existing `rota_compute.context_hash` includes `operational_import.fingerprint` plus rule versions/settings, groups/memberships, periods and scope. `operational_import.fingerprint` includes persons, aliases, designations, dated calls, units/minima, mappings/references, postings, leave, duty slots and assignments. New OT configuration must enter the same snapshot and PostgreSQL apply lock set. Snapshot identity covers active learning version and OT configuration semantics, exception dates/time bands, area skill/pool constraints, holidays, locks and planning options. Private text must not be sent to the GPU/assistant merely because it affects a server fingerprint. Input canonicalization should ignore ordering only for genuinely unordered sets, not precedence-bearing records. N04 remains incomplete until change-by-change invalidation tests verify the extended implementation.

## Fresh baseline evidence and limitations

### N04 active preference extension (14 November 2026)

The shared scheduling context hash now has snapshot version 2 and includes every
active `RotaLearningVersion` identity and its planning `weights`, read through SQL
columns rather than cached ORM instances. Candidate/retired versions and active
review notes/evaluation timestamps are excluded from this preference projection.
Activation to a different identity invalidates a proposal even if weights match;
rollback and in-place active weight edits also invalidate it. This applies to the
shared reviewed paths, not only the benchmark identity. Existing proposals from
the previous hash format must be regenerated when this code is deployed.

The existing input-lock table set includes `rota_learning_versions`. Activation
and rollback acquire that same input lock after their learning-activation namespace
lock, then refresh the requested version and recheck the existing activation gates.
Thus assignment apply and preference writes serialize. A candidate evaluated
before a newly committed assignment needs reevaluation; rollback retains its
existing explicit authority to select a previously activated version. Neither
operation grants an allocation permission or modifies a duty itself.

This extension does not complete N04. The wider operational fingerprint remains
conservative and includes whole rows; canonical no-op behavior and private-field
projections across all inputs still need requirement-by-requirement verification.
The immutable monthly OT guard is independently bounded and input-only; it does
not by itself certify coherence of every pre-lock DTO assembled by every caller.
Preference-test fixtures supply existing reviewed version states and do not prove
training quality, held-out model acceptance or external model suitability.

- Frontend unit baseline: **124 passed, zero failures/skips**, command `npm test -- --test-reporter=tap`, 14 November 2026. Runner output captured by the tool session; concise recorded artifact: `baseline-results.json`.
- Backend focused baseline: **93 passed**, command `backend/.venv/Scripts/python.exe -m pytest backend/tests/test_rota_intelligence.py backend/tests/test_rota_eligibility_contract.py backend/tests/test_rota_assignment.py backend/tests/test_rota_safety.py backend/tests/test_leave.py backend/tests/test_leave_approval.py -q --junitxml=docs/allocation-progress/baseline-backend.xml`. Fixtures use isolated SQLite sessions, no operational database writes.
- Source review identified older benchmark/source drift; rerun benchmarks under new output paths rather than overwrite October historical evidence.
- Administrator correction rate, representative real-month acceptance and pilot sign-off have not been measured. N02/N06/N50 cannot be marked complete from these test counts.
