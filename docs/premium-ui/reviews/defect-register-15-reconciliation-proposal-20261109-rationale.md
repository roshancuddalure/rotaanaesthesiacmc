# Original 15: isolated reconciliation proposal

This is documentation groundwork, not acceptance or a replacement for the shared defect register. The proposal preserves all 88 original entries and their original fields inside `original_entry`; the generation script asserts exact JSON-content equality and unique IDs. The base register digest is frozen in the proposal. No application, shared register, acceptance ledger or browser execution changed.

The proposed normalization makes owner, recorded status, applicability snapshot and next disposition explicit for every record. It preserves 59 existing owner values and marks 29 absent owners **unassigned**. A reviewer is provenance, not evidence of assigned ownership. It preserves 77 existing next-verification statements and adds 11 proposed documentation follow-ups where none existed. These proposed follow-ups are neither completed verification nor operational assignments.

Computed classification totals are 48 verified bugs, 5 design improvements, 19 historical findings and 16 investigations. The inspected base already contained these corrected totals. Older shortlist observations about a stale 43-bug summary describe the earlier inspection; they are not a claim about this frozen proposal base.

All 130 unique directly linked evidence files exist at inspection. Seven unique paths have bytes differing from the entry's recorded digest:

- `docs/premium-ui/qa-match-identity-long.json`
- `docs/premium-ui/qa-match-identity.json`
- `docs/premium-ui/qa-profile-designation-header.json`
- `docs/premium-ui/qa-profile-effective-identity.json`
- `docs/premium-ui/qa-profile-section-markers.json`
- `docs/premium-ui/qa-profile-tabs-complete.json`
- `docs/premium-ui/qa-workbook-choice-lifetime.json`

These differences are evidence-binding investigations. They do not establish tampering, failing software or invalid tests. The proposal preserves both the original recorded digest and current inspected digest. The original historical evidence must be recovered or the later report's relationship adjudicated explicitly; the new bytes cannot silently replace it.

Literal frontend digest claims were extracted from directly linked JSON reports for 86 entries. This is an inventory statistic, not 86 validated application snapshots. In particular, `FE-SPECIALIST-019` and `FE-SPECIALIST-020` have only frontend test-source digest claims, so **84 entries have an application/public/config source digest claim**. Two further entries have no directly extracted frontend digest claims: `FE-SPECIALIST-002` and `FE-IMPORT-FIELDSET-WIDTH-001`. All four need explicit application-snapshot investigation. Indirect linked evidence may resolve them, but this extraction has not asserted that outcome.

Even the 84 entries with application source claims require semantic adjudication. JSON locations preserve whether a digest appeared in before/after/candidate/integrated sections. Extraction does not certify that the claimed snapshot reproduces the original finding, proves an applied fix, remains applicable to current source, or passes the whole requirement. Every proposed row retains current applicability as unassessed.

The original historical classifications remain intact. A historically reproduced bug can remain classified as a verified bug while its present applicability is unknown. A source-only concern stays an investigation. A bounded fix remains bounded; no broader backend, scheduling, permission, persistence or export claim follows.

Before any original 15 acceptance, the coordinator must resolve ownership dispositions, adjudicate the required snapshots and changed bindings, and reconcile stale candidate wording against later bounded resolution records. A second reviewer should inspect both exact acceptance conditions. These checks should avoid turning documentation normalization into a requirement that every historical bug be reimplemented or reproduced again; nevertheless, unknown fields must remain explicit rather than being certified by generic default text.

Artifacts:

- `defect-register-15-reconciliation-proposal-20261109.json`: complete isolated proposal, 88 preserved entries, evidence checks and literal snapshot claims.
- `defect-register-15-reconciliation-proposal-20261109-stats.json`: proposal digest and computed totals.
- `tmp/prepare_defect15_reconciliation_20261109.py`: generation procedure; refuses overwrite and checks the shared source did not change during preparation.
