# Intelligent rota generation

The approved seven-stage plan adds whole-month optimization, reviewed repair,
teaching examples, versioned preference learning and an optional local assistant.
Assignments still require explicit review and independent server validation.

## Rules and default policy

- Existing effective postings, call levels, groups, approved/pending leave, duty
  timing, rest requirements, monthly limits and unit/call staffing minima remain
  authoritative. The generator never supplies an override reason for itself.
- Existing assignments remain fixed unless their slot is explicitly selected for
  repair. Locked unfilled duties remain visibly uncovered.
- Priorities are required coverage, total coverage, minimum changes in repair,
  weekend/night/holiday burden, availability-adjusted monthly workload, then
  spacing/history and preferences. Preferences mode moves personal preferences
  immediately after coverage. Hard safety checks always take precedence.
- Fairness uses compatible candidate opportunities. Missing historical coverage
  is neutral. The previously configured six-month historical policy is retained;
  the proposed three-month default does not overwrite existing configuration.
- No holiday dates are invented. Administrators maintain a reviewed calendar;
  absent dates produce an explicit "not evaluated" warning. Night-containing
  duties use the existing 24-hour flag and stored evening/overnight timing.
- Unit `minimum_free_people` and call-specific minima override the generic
  staffing fallback. The legacy global elective-rest flag is not a substitute
  for the existing duty-specific blocking rules. No clinical or legal standard
  is inferred from the optimization defaults.

## Implementation and acceptance map

| Stage | Implementation | Verification |
|---|---|---|
| Audit/baseline | Existing validators, policy precedence, historical coverage and cached greedy engine mapped above; disposable monthly comparison | `tools/benchmark_rota_intelligence.py` and benchmark JSON |
| Whole-month search | OR-Tools CP-SAT, independent safety cuts, scarcity-aware validated warm start, objective time sharing, exact lower-bound proofs | Global scarcity, concentration, spacing, limit and benchmark regressions |
| Fairness/repair | Balanced/preferences/repair modes; explicit repair scope and locks; up to three distinct alternatives with retained coverage | Reviewed replacement, locked duties, original-history preservation and concurrent double apply |
| Review | Responsive Plan/Review/Teaching/Assistant/Learning workspace, before/after repairs, burden comparison, reasons and evidence export | Desktop/390/320 browser workflows and actual main-template entry |
| Teaching | Frozen rules/availability without leave reasons or private comments; accept/prefer/exception; approval/exclusion; reviewed historical references | Applied-draft snapshot, historical idempotency/context gate and exception exclusion |
| Local assistant | Paired loopback companion, exact origin, session opt-in, bounded structured suggestions, numeric grounding check and regular-planning recovery | Synthetic model comparison, actual browser inference, unauthorized-origin and unavailable-model checks |
| Learning | Bounded pairwise ranking, duplicate-case suppression, versioned candidates, held-out evaluation, administrator activation and rollback | Ranking fit, split isolation, unchanged operational data, stale evaluation, source approval and concurrent activation checks |

## Optimization safety and result meaning

Planning writes proposal metadata only. Validation checks the complete proposal,
including its effects on preserved duties and staffing on the next month's first
day. Existing conflicts are reported; new choices cannot introduce additional
conflicts in preserved duties. Apply repeats these checks under PostgreSQL input
table locks before saving assignments, cancellations and attributed audit entries
in one transaction. Repeated apply returns the prior result. Published months
cannot be modified by this workflow.

A validated warm start prevents an unfinished search from replacing an equally
covered, balanced draft with a concentrated incumbent. Independent objective
lower bounds can prove an incumbent optimal without exploring interchangeable
member permutations. Otherwise, each objective receives part of the remaining
search budget. Reports distinguish proven optimality, a feasible incumbent,
time-limited search and the absence of a distinct alternative. Optimality is
relative to the configured model and candidate set; it does not imply every duty
was coverable or that unconfigured preferences were considered.

The default search budget is 30 seconds, with 60/120-second options. Input loading,
model construction and independent validation contribute additional wall time.
The old reviewed scoring/GPU workflow remains available separately as a fallback.
The solver runs on the backend CPU; the optional language assistant uses the
computer running its companion. The existing browser WGSL scoring pilot remains
independent of model inference.

## Teaching and learning

Examples link canonical member/slot IDs and preserve the original decision,
preferred candidate features, rule snapshot, availability snapshot and source
context hash. Feedback recorded after applying a draft retains its generation
inputs. One-time exceptions are never retrieved as reusable lessons or used for
weight fitting. Historical imports start unverified and require explicit review
of original policy/availability before approval. They are not assumed correct.

The ranking learner fits three bounded weights from approved pairwise comparisons
of burden, rest and historical features. Duplicate feedback does not inflate the
sample count. Acceptance-only examples provide context but are not fabricated
negative comparisons. A candidate requires at least six distinct approved cases
and two or three held-out draft months absent from its training months before
evaluation. It cannot worsen coverage/fairness under the evaluation priorities or
introduce safety violations. Activation requires administrator approval, unchanged
evaluation inputs and still-approved training examples. Prior versions remain
auditable and can be restored explicitly.

This is a preference-ranking learner plus retrieval, not fine-tuning of the
language model. No departmental language-model adapter is claimed or silently
trained. That remains an evidence-based later step if approved examples show a
gap that retrieval and ranking do not address. Held-out non-regression is not a
claim of fewer manual corrections on real departmental months.

## Local model setup

Ollama was already installed. The tested smaller model is `qwen2.5:1.5b` (Q4_K_M),
stored outside Git at `D:\CodexModels\DutyRota`. The comparison also exercised the
existing `gemma3:4b`; the smaller model passed the selected interpretation cases
and used substantially less device memory. Runtime evidence identifies CUDA on
the NVIDIA GTX 1650, with all 29 layers of the smaller model offloaded.

From the repository on the computer providing the GPU:

```powershell
.\tools\start-local-rota-assistant.ps1 -WebsiteOrigin https://YOUR-WEBSITE-ORIGIN
```

The launcher selects the prepared D: directory when present; otherwise it uses
the user's local application data directory. `-ModelDirectory` selects another
drive. First-time setup elsewhere can explicitly add `-PrepareModel`; preparation
checks free space before downloading. The companion can start an isolated Ollama
runtime on loopback port 11436 with cloud inference disabled, without changing
the user's existing Ollama configuration. It binds its paired API to 127.0.0.1:11435.

Open Rota Template → **Intelligent generator** → **Assistant**, opt in and enter
the temporary pairing token printed by the launcher. Allow the website's
local-network/loopback permission if the browser requests it. Pairing is restricted
to the exact website origin; the website's login token is never sent to Ollama.
The assistant receives selected rule facts and anonymized approved example
features, not the roster, member UUIDs, leave reasons or profile comments.

Suggestions remain unverified proposals. Numeric grounding rejects/retries
unsupported numerical claims; it is not a proof of general model accuracy.
Using a suggested mode cannot change safety rules, assign members, approve
exceptions or publish a rota. Local-runtime, permission, parsing or inference
failure leaves the regular reviewed generator available. There is no automatic
cloud fallback.

## Verification commands and evidence

```powershell
backend\.venv\Scripts\python.exe tools/test_compute_postgres.py --full
backend\.venv\Scripts\python.exe tools/benchmark_rota_intelligence.py
backend\.venv\Scripts\python.exe tools/benchmark_local_rota_models.py
cd frontend
npm test
npm run build
npm run test:intelligence
npm run test:compute
npm run test:normalization
npm run test:members
```

Browser integration tests use the disposable loopback API in
`tools/compute_smoke_server.py`, never the configured database. Local inference
verification supplies `ASSISTANT_TEST_TOKEN` for that test companion; this token
must not be committed. PostgreSQL tests create/drop their own isolated database
and schemas and check upgrade/downgrade preservation. Operational schema upgrade
adds only the two teaching/learning tables (`20261019_0022`).

Machine-readable results are under `docs/benchmarks/rota_intelligence*.json` and
`rota_local_models.json`. `rota_local_models_initial.json` retains initial model
responses that exposed unsupported claims; those are investigation evidence,
not the final acceptance result. The final verification artifact records actual
test counts, build/migration checks and operational-data preservation.
