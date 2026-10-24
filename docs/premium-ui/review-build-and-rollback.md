# Frontend review build and recovery notes

This working tree is an active, incomplete implementation of the approved 260-item plan. The execution report, traceability ledger and individual runtime reports define what has actually been checked. A green build is not release acceptance. Physical-device checks are pending at the user's direction; manual screen-reader checks remain pending separately.

## Current effective identity review snapshot

tmp/premium-frontend-review-20261024-effective-identity.zip seals the held frontend build with distinct null, omitted and unknown effective call-level presentation and scoped long-value wrapping.
SHA-256: 0a3f0f5549b9a80128b73fdfeae220009c7045433e6501a9a6e594d92aefd933. Review only; the goal remains incomplete and deployment is unauthorized.
Packaging-time verification: docs/premium-ui/reviews/verification-packaging-20261024-effective-identity.json.
The batch passed 49 browser contexts/workflows, including 72 nested fixture/role workflows in six contexts and 36 exact mocked saves, plus 110 unit tests and a held-input build.
Evidence: reviews/effective-identity-current.json. Requirements 122/128/133 remain partial; overall 18 of 260 requirements are accepted.
This archive is not a known-good deployed rollback release. Item 259 acceptance remains bound to its named earlier profile-tabs archive and does not transfer automatically.

## Historical profile dates review snapshot

tmp/premium-frontend-review-20261024-profile-dates.zip seals the held frontend build with read-only dated call changes and date-aware posting/leave cards.
SHA-256: 169bc75f1b6950ea99a92f0c0fc88907e132e1c0cc11e4158e657374a7f9be09. Review only, incomplete; deployment remains unauthorized.
Packaging-time verification: docs/premium-ui/reviews/verification-packaging-20261024-profile-dates.json.
85 browser contexts/workflows, including six real production-build profile save/read-back cases on disposable RAM, passed;110 unit tests andheld-input build passed.
Evidence: reviews/profile-date-cards-current.json.18of260 requirements accepted;128legacytimeline andnullableheaderidentity remain partial.
This archive is not a known-good deployed rollback release. Item259acceptance remains bound to its named earlier profile-tabs archive, not automatically transferred to this archive.

## Historical profile tabs review snapshot

tmp/premium-frontend-review-20261024-profile-tabs.zip seals the held frontend build with responsive member-section overflow cues and keyboard navigation fixes.
SHA-256: cd832541f9aa94b981a03c2c35ed3bd3d7231f481ecbf4a0eb089f22e880b8e0. Review only, incomplete; deployment remains unauthorized.
Packaging-time verification: docs/premium-ui/reviews/verification-packaging-20261024-profile-tabs.json.
Six new browser contexts/12role variants,12status,6container,2short-rail and13CSVregression workflows passed;110units andheld-inputbuild passed.
Evidence: reviews/profile-tabs-complete-current.json.16of260requirements accepted.
This archive is not a known-good deployed rollback release.

## Historical member CSV guide review snapshot

`tmp/premium-frontend-review-20261024-member-csv-guide.zip` seals the held frontend build with the responsive
member CSV guide, named keyboard-scrollable sample and captioned/scoped field reference.
SHA-256: `ebd7827f918139f915e2b8e070931341b962aac153884a164291b4ad91e56d20`. Review only, incomplete; no deployment authorization.
Packaging-time verification: `reviews/verification-packaging-20261024-member-csv-guide.json`.
Results:13guidecontexts,24mockregressioncontexts,36exactdownloads within6contexts,
and6realRAMequivalencepairs (12browserruns/108importscenarios).
Details: `reviews/member-csv-guide-current.json`.11of260requirements remain accepted.
No known-good deployed rollback artifact is established by this seal.

## Historical comparison regions review snapshot

`tmp/premium-frontend-review-20261024-comparison-regions.zip` seals the held frontend build with named
comparison regions, scroll guidance, retained mobile generation grids and admin preview semantics.
SHA-256: `dc80d45e478c65d30e96ea2eac519b508b2fa0c39a63ec2e77f53e4b26543f27`. Review only, incomplete; no deployment authorization.
Packaging-time verification: `reviews/verification-packaging-20261024-comparison-regions.json`.
Bounded56context/workflow results: `reviews/comparison-regions-current.json`.
Item101 classification is accepted as a documentary deliverable;11of260requirements accepted.
No known-good deployed rollback artifact is established by this seal.

## Historical rules save refresh review snapshot

`tmp/premium-frontend-review-20261024-rules-save-refresh.zip` seals the held build with draft-bound rules save refresh
and review ownership guards.
SHA-256: `d5772b7d9ab75cdcb54edeee38e6e94feee7046e540abcab307d8d13ac848f44`. This is review only and incomplete; deployment
is unauthorized. Packaging-time verification is preserved in
`reviews/verification-packaging-20261024-rules-save-refresh.json`.
Bounded 18-context (48 save-refresh scenarios within6) and20-contract-check results are in `reviews/rules-save-refresh-current.json`.
No known-good deployed rollback artifact is established by this seal.

## Historical rules conflict review snapshot

`tmp/premium-frontend-review-20261024-rules-conflict.zip` seals the held build with draft-bound rules conflict
and review ownership guards.
SHA-256: `a949bff245801679a319f09efbbffb84c55d12c9d956f8dd218a6c7cf158c67a`. This is review only and incomplete; deployment
is unauthorized. Packaging-time verification is preserved in
`reviews/verification-packaging-20261024-rules-conflict.json`.
Bounded 12-context (54 conflict subscenarios within6) and20-contract-check results are in `reviews/rules-conflict-recovery-current.json`.
No known-good deployed rollback artifact is established by this seal.

## Historical rules validation review snapshot

`tmp/premium-frontend-review-20261024-rules-validation.zip` seals the held build with draft-bound rules validation
and review ownership guards.
SHA-256: `a18a0f6008391ad428daa214ce9789a3358a8237b454a11fa80a5efc4bb54433`. This is review only and incomplete; deployment
is unauthorized. Packaging-time verification is preserved in
`reviews/verification-packaging-20261024-rules-validation.json`.
Bounded 159-context/workflow and 20-contract-check results are in `reviews/rules-validation-lifetime-current.json`.
No known-good deployed rollback artifact is established by this seal.

## Historical diagnostics privacy review snapshot

`tmp/premium-frontend-review-20261024-diagnostics-privacy.zip` seals the held build with shareable diagnostics
and clipboard ownership/recovery guards.
SHA-256: `1587038e4aba024728b9df0e3459bd0c4f1324a51e2ae1c7b5fb740fc812124d`. This is review only and incomplete; deployment
is unauthorized. Packaging-time verification is preserved in
`reviews/verification-packaging-20261024-diagnostics-privacy.json`.
Bounded 32-context/workflow results are in `reviews/diagnostics-privacy-current.json`.
No known-good deployed rollback artifact is established by this seal.

## Historical Leave cancellation review snapshot

`tmp/premium-frontend-review-20261024-leave-cancel.zip` seals the held build with main Leave
cancellation identity and late-response UI ownership guards.
SHA-256: `289a43e1724cff872c51bf87e26db69a4c34d67873cefdd32614d9156cd5ebab`. This is review only and incomplete; deployment
is unauthorized. Packaging-time verification is preserved in
`reviews/verification-packaging-20261024-leave-cancel.json`.
Bounded30-context results are in `reviews/leave-cancel-identity-current.json`.
No known-good deployed rollback artifact is established by this seal.

## Historical connection-status review snapshot

`tmp/premium-frontend-review-20261024-connection-status.zip` seals the held connection-status build.
SHA-256: `57cafca1cbc0cddc226dac9203176d7eec8f5d6212295a7de37ffbbe8da7c989`. Review only and incomplete; deployment is unauthorized.
Packaging-time verification is preserved in
`reviews/verification-packaging-20261024-connection-status.json`.
Bounded tests are recorded in `reviews/connection-status-current.json`.
No deployed rollback artifact is established.

## Historical initial-profile recovery snapshot

`tmp/premium-frontend-review-20261024-profile-initial.zip` seals the held build
with explicit canonical-profile initial Close and retry recovery.
SHA-256: `8aba97f91237927eaf9205a260b5aa0b35ae53433ae8dc7cad43c355bedeb5f4`. It remains `review_only_incomplete`; deployment authorization
is false. Packaging-time verification is preserved in
`reviews/verification-packaging-20261024-profile-initial.json`.
Current recovery/save regression evidence is in
`reviews/profile-initial-recovery-current.json`; the separate acceptance-definition
review records all260 objective criteria without certifying their outcomes.
No known-good deployed rollback artifact is established by this seal.

## Historical inline-selection review snapshot

`tmp/premium-frontend-review-20261024-inline-selection.zip` seals the held build
with CSV inline selection ownership and candidate keyboard-focus recovery.
SHA-256: `520daf5e5f74d736bf04dedc5db34f7b3edb56682d95daf6e36edc078afc176e`. It remains `review_only_incomplete`; deployment authorization
is false. Packaging-time verification is preserved in
`reviews/verification-packaging-20261024-inline-selection.json`.
Current bounded evidence and limitations are in
`reviews/inline-member-selection-lifetime-current.json`. No known-good deployed
rollback artifact or complete programme acceptance is established by this seal.

## Historical member-conflict review snapshot

`tmp/premium-frontend-review-20261024-member-conflicts.zip` seals the held build
with view-relevant duplicate confirmation and guarded focused-draft restoration.
SHA-256: `407c721289587f5b30193d19acaf94a3aae5ab090a06aadb27c485893b45ed8d`. It remains `review_only_incomplete`; deployment authorization
is false. Packaging-time verification is preserved in
`reviews/verification-packaging-20261024-member-conflicts.json`.
Current scoped checks and limitations are in
`reviews/member-create-conflicts-current.json`. This seal does not establish a
known-good deployed rollback artifact or complete programme acceptance.

## Historical pending-member review snapshot

`tmp/premium-frontend-review-20261024-member-pending.zip` seals the held build with
the frontend pending-operation guard. SHA-256: `816cab1192cd7f720c19b5d9f111fd43c5efcdb9099e31ccc92a59c5acb0535f`.
It remains `review_only_incomplete`; deployment authorization is false.
Packaging-time verification is preserved in
`reviews/verification-packaging-20261024-member-pending.json`.
Current bounded results and remaining checks are in
`reviews/member-create-pending-current.json`. This archive is a local review
artifact; no known-good deployed rollback artifact is established by this seal.

## Historical member-creation review snapshot

`tmp/premium-frontend-review-20261024-member-create.zip` seals the latest held build.
SHA-256: `a172baec13bc9d10ce159865c1ca3b5973f83416f14dac2615227f602d5a3903`. It includes the native mobile creation disclosure
with full-width fields and private in-memory draft retention. Acceptance remains
`review_only_incomplete`; deployment authorization is false. Packaging evidence
is preserved in `reviews/verification-packaging-20261024-member-create.json`.
Current outcomes and limitations are in `reviews/member-create-disclosure-current.json`.

## Historical mobile-filter snapshot

`tmp/premium-frontend-review-20261024-mobile-filters.zip` seals the latest held build.
SHA-256: `76a14e30aa838cfef9a08b5cc5257b349682155158bcd405524d392d5cd8c6b6`. Optional member filters start compact on mobile and
retain explicit operator choices. The archive remains `review_only_incomplete`;
deployment authorization is false. Packaging evidence is preserved in
`reviews/verification-packaging-20261024-mobile-filters.json`. Current test scope
and limitations are in `reviews/mobile-member-filter-hierarchy-current.json`.

## Historical table-name snapshot

`tmp/premium-frontend-review-20261024-table-names.zip` seals the latest held build.
SHA-256: `b17aa4ab8b0accb3ba232e81852b9988e20ef1b068cc4343a2049e5408b2cafc`. It includes the three record-table heading references
and the existing Excel recovery improvements. Acceptance remains incomplete and
deployment authorization is false. Packaging evidence is preserved separately in
`reviews/verification-packaging-20261024-table-names.json`. Current test scope and
remaining limitations are in `reviews/record-table-names-current.json`.

## Historical Excel-deadline snapshot

`tmp/premium-frontend-review-20261024-excel-deadline.zip` seals the latest held build.
SHA-256: `73671134c8104661518d86fc930c08bb43a9b9a6c32ff15221a1cdf336edb3ee`. Its Excel reads have bounded recovery. It remains
`review_only_incomplete`; deployment authorization is false. Packaging evidence is
retained in `reviews/verification-packaging-20261024-excel-deadline.json`. The
current Excel deadline review records the tests and limits; broader historical
reports have not become fresh checks through packaging.

## Historical Excel-guard snapshot

`tmp/premium-frontend-review-20261024-excel-guard.zip` seals the current held build.
SHA-256: `cdad3a9561190f3d079e73d23d9869d0caefa153621fb37f193bedf93d262361`. It includes the frontend Excel transport guard, remains
`review_only_incomplete` and grants no deployment authorization. The packaging-time
verification document is retained as `reviews/verification-packaging-20261024-excel-guard.json`;
later evidence updates do not alter that snapshot. The linked Excel validation
review defines the current checks and explicitly historical broader reports.

## Historical post-zoom snapshot

The post-zoom review archive is `tmp/premium-frontend-review-20261023-post-zoom.zip`.
Its separately verified SHA-256 is
`bbb93a3902ed98e201c426bf9ee817e5c198f5320b7da6caf1415e5f1c9643f7`.
It seals the exact existing successful held-build assets without rebuilding them;
the manifest links the source/build snapshot and records the environment-provenance
limit. It contains 15 verified payload files plus its manifest, with no backend,
database, source tree, environment files, logs or screenshots. It is explicitly
`review_only_incomplete`, with deployment authorization false.

The manifest's external `verification-current.json` reference is historical:
that document has changed since packaging and its current hash differs. The
original referenced verification snapshot is not embedded in the ZIP. Later
evidence updates do not invalidate the sealed asset hashes, but the mutable
document must not be presented as the exact packaging-time verification snapshot.

```powershell
.\backend\.venv\Scripts\python.exe tools/package_frontend_review.py --verify tmp/premium-frontend-review-20261023-post-zoom.zip
```

To seal another already-reviewed build, use a new filename and require an exact
successful build report match:

```powershell
.\backend\.venv\Scripts\python.exe tools/package_frontend_review.py --output tmp/new-frontend-review.zip --from-reviewed-build docs/premium-ui/reviews/frontend-build-snapshot-current.json
```

The option refuses changed source inputs, missing/extra/changed assets, a failed
build or a build whose inputs changed. It retains the existing asset allowlist,
reparse-path checks, dependency checks and refusal to overwrite an archive. It
does not certify build environment values, live host configuration, API
compatibility with an unknown deployed release, or complete requirement acceptance.
The seven snapshot-gate tests exercise the refusal conditions.

## Historical sealed snapshot

The 22 October review archive is `tmp/premium-frontend-review-20261022-v2.zip`. Its independently checked SHA-256 is `28e52f21fd1d4aac21db97cb8897e30434790d51b6e960afdfaaa7799a63ad89`. It contains 15 payload files: the static frontend build and a review notice, plus an entry manifest. It includes the complete current frontend, including concurrent work. It contains no backend, database, source tree, environment files, operational logs or QA screenshots.

```powershell
.\backend\.venv\Scripts\python.exe tools/package_frontend_review.py --verify tmp/premium-frontend-review-20261022-v2.zip
```

Compare the archive hash to the separately retained value above. Internal hashes detect accidental damage; someone able to rewrite both payload and manifest can create another internally consistent archive. This verifier is not a signature or an authenticity guarantee.

The manifest records source and dependency-lock hashes, and the hash of the evidence reference at packaging time. Evidence is external to the ZIP, so later documentation updates do not change the sealed artifact or imply those later checks were packaged. The current unresolved requirement list is `acceptance-audit-current.json`; its counts describe evidence disposition, not implemented-feature percentages. This archive is an incomplete review build, not deployment approval or a known-good previous release.

For another snapshot, use a new filename under `tmp`. The packager builds from unchanged fingerprinted inputs, checks an explicit asset allowlist and local entry/chunk dependencies, rejects reparse paths, and refuses to overwrite existing archives. Inspect any rejected new asset before expanding its allowlist. Tests and evidence must identify the particular archive hash they reviewed.

## Concrete rollback disposition

No independently accepted previous deployed frontend artifact has been established in this workspace. A live rollback cannot therefore be certified here. Before a separately authorized deployment, retain the exact currently deployed frontend artifact, its complete asset manifest, hosting/cache configuration and API compatibility evidence. A rollback restores those exact frontend assets through the host's existing atomic release process, then verifies sign-in, navigation, downloads and stale-tab recovery against that release. It does not restore a database, run a migration or change backend configuration.

Keep old hashed assets available for already-open tabs according to the verified host policy. If the host cannot switch complete releases atomically, document and test its actual replacement procedure before release approval. Never use the task-start source snapshot or a broad Git reset as a rollback: hashes do not establish ownership of shared-file changes. An isolated reverse patch still requires hunk-by-hunk review against concurrent work and appropriate frontend regression checks. That source rollback artifact remains pending.

## Review locally

Run commands from the repository root in PowerShell. Existing installed dependencies and the backend virtual environment are used.

```powershell
npm --prefix frontend test
npm --prefix frontend run build
node frontend/tests/premium-action-inventory.mjs --check
```

The isolated fixture server uses in-memory SQLite, not the configured department database:

```powershell
.\backend\.venv\Scripts\python.exe tools/generation_smoke_server.py --port 8031
```

In a separate terminal start the frontend if the owned review server is not already running:

```powershell
npm --prefix frontend run dev -- --port 5197 --strictPort
```

The review suites route requests to disposable fixtures or intercept them entirely. Examples below run from `frontend` and use their documented default review origins. Read the suite's header and environment variables before changing an origin. Do not redirect these mutation tests to the operational database.

```powershell
node tests/premium-member-filters.browser.mjs
node tests/premium-mappings.browser.mjs
node tests/premium-accounts.browser.mjs
node tests/premium-session.browser.mjs
node tests/premium-shell.browser.mjs
```

The production fixture serves `frontend/dist` and provides disposable backend fixtures:

```powershell
.\backend\.venv\Scripts\python.exe tools/generation_smoke_server.py --production --port 8032
```

Run production generation/reset tests sequentially on that dedicated fixture. The broad read-only review uses port 8031, so production fixture resets cannot change its data. Save source changes before starting a final audit and hold application source steady: Vite development reloads can invalidate an in-progress navigation result. Investigate a failure before rerunning; do not interpret a new timestamp as fixing a defect.

## Packaging and hosting disposition

The root Dockerfile already copies `frontend/public` before building. The standalone `frontend/Dockerfile` now copies `public` too; without that copy its image would omit the recovery bootstrap and downloadable templates. The current local build contains `dist/frontend-bootstrap.js` and `dist/templates/department-members.csv`. A source contract checks both Docker copy paths. Docker is unavailable in this environment, so no container-image build or container-runtime pass is claimed.

The inspected combined application mounts its frontend using `StaticFiles` in `backend/app/main.py`. The repository inspection did not establish an explicit HTML cache-revalidation policy, immutable hashed-asset policy or retained-assets window for previous releases. These are hosting acceptance dependencies. No backend or infrastructure configuration was changed for this UI task. The Vite preview worker/CSP checks verify the local reviewed build, not live hosting or a CDN's headers.

Before an independently authorized deployment, verify the actual host's HTML revalidation, hashed asset handling, previous-release asset retention, CSP and worker isolation. Preserve the controlled update prompt: it must not reload or replay a mutation automatically. Keep the build identity visible in expandable support details. A working old-tab recovery flow requires evidence against the actual serving policy as well as the local missing-chunk test.

## Review and rollback boundaries

The repository contains concurrent backend, rules and extra-duty work. Do not restore entire shared files or run a blanket reset to roll back the premium UI. In particular, `main.ts`, `styles.css`, `services/api.ts` and the extra-duty modules can contain changes from different tasks.

The task-start source snapshot is recorded in `tmp/premium-ui-baseline-path.txt`. It is comparison evidence, not a safe whole-worktree restore target. Inspect the selected UI diff, current file hashes and concurrent changes, then prepare a reverse patch containing only the reviewed UI edits. Apply it locally, resolve shared-file overlaps explicitly and rerun the affected frontend checks before proposing a release rollback. Preserve the existing API payloads, permissions, scheduling calculations, database semantics and export contents.

No deployment, push, production database operation or backend modification is authorized by these review instructions. The UI task has made no backend edits; `backend-boundary.json` separately records concurrent changes since the baseline. Keep unresolved acceptance items visible in the execution report and do not mark the persistent goal complete until the approved item-specific acceptance is proven.
