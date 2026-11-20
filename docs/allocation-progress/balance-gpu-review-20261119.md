# Balancing, WebGPU and formatted Excel in Review

User priority requested 19 November 2026. This is an implementation and isolated-test report, not a certification of an operational November rota or completion of the original 50-item plan.

## Changes

- Fixed GPU initialization timing: adapter discovery and device/kernel self-tests now have 60 seconds; individual scoring operations retain their 15-second limit. Existing CPU fallback, result parity checks, permissions and Automatic's advantage gate remain in place. The new unit check verifies these separate bounded lifetimes.
- Added revision-bound `GET /rota-compute/jobs/{id}/review.xlsx?revision=...`. It uses job ownership, current scheduling locks, context freshness and the independent Apply validator in read-only mode. It exports the selected proposal with preserved commitments, uncovered slots, all eligible zero-load members, workload totals, optimization evidence and the existing formatted Eagle Eye matrix. Official non-template commitments use the existing canonical workload selection; unrelated draft/history-analysis records do not become operational duties.
- Added `GET /rota-publish/review-export?month=...`, reusing the full final workbook renderer before publication. Every sheet is marked as a draft. The approved final-export endpoint still requires publication and the matching approval fingerprint.
- Added Excel buttons to the generator Review tab (selected proposal before Apply, current saved rota after Apply) and the main Rota Review page. Existing authenticated spreadsheet validation, session checks, loading/error handling and safe filenames are reused.

## Evidence

- `balance-review-acceptance-final.xml`: 9 passed. Exact small integer oracles prove 8 duties / 4 equally eligible people = 2 each, both from empty and with two fixed duties on one person. A six-duty scenario leaves the fully absent member unassigned and gives each of the other three people two duties. Complete final-plan validation passes; the optimizer saves nothing. Workbook checks cover no DML, selected alternative/revision, stale inputs, ownership/authentication, formula-like names, fixed official non-template commitments and the unchanged final-publication gate.
- `review-excel-regression.xml`: earlier 20 passed, including the existing publish suite and whole-month alternatives. These overlap other suites. Existing openpyxl warnings concern unsupported spreadsheet extensions in its reader.
- `balance-review-frontend-final.log`: 140 passed, no failures/skips/cancellations. `balance-review-build-final.log`: TypeScript/Vite build passed, with existing bundle size and mixed import warnings.
- `balance-review-browser.json`: real NVIDIA Turing hardware (GTX 1650 identified separately by browser diagnostics), exact shader/CPU parity for 1, 63, 64, 65, 513 and 10,000 rows. All member/template/optimizer kernel self-tests passed. The actual intelligent allocation job selected `local_gpu` and recorded **2 server-verified GPU scoring frames**. The month-wide CP-SAT search still runs on the CPU.
- The same browser report verifies proposal Excel before Apply, no assignment mutation during download, explicit stale-export recovery, saved draft download after Apply, the main Rota Review download, and 1440/390/320 layouts without page overflow or page errors. Downloaded anonymous fixtures and screenshots are in `review-workbooks/`; they are not operational duty rotas.
- `gpu-current-probe.json`: real adapter discovery took 13.087s in bundled Chromium and 17.887s in installed Chrome. An initial application self-test took 35.149s; this explains why the previous 15-second deadline incorrectly rejected usable hardware. Subsequent final self-test took 6.641s. These are observed local timings, not a performance guarantee or proof that GPU speeds up total allocation.

## Limits and retained scope

The first 93-test baseline had 92 passes and one timing-sensitive failure: a 3-second whole-month test returned feasible instead of proven optimal. The same test passed in the later 20-test run. Initial new-workbook test failures were fixture assertions (Unfilled row, duplicate no-store header, owner 403) and a non-operational manual-slot fixture; each was corrected without relaxing application policy. These outcomes are retained here and in available earlier artifacts; the final acceptance XML supersedes its earlier failed run.

Equal raw counts cannot always be feasible with leave, dated call levels, OT reservations, rest, locks and fixed duties. Existing approved fairness priorities remain unchanged. A time-limited result must not be called a proven optimum. The exact oracles and existing real-shaped fairness simulation provide bounded evidence, not universal perfection or departmental acceptance.

N35/N36/N39/N41 are In progress for this user-priority subset; their full original acceptance criteria and dependencies remain outstanding. N02/N24 remain In progress, 19/50 Done unchanged. No operational data migration, publication, upload, deployment, policy amendment, cloud routing or model installation occurred.

Final broad regression `balance-gpu-review-regression-final.xml`: **116 passed in 455.68 seconds**, zero failures/errors/skips, four existing openpyxl reader warnings. This includes the existing whole-month, compute, balance, 150-member fairness and publication suites and the nine new acceptance cases; counts overlap the focused runs above. The original three-second optimum test passed in this run.

All task-owned test/UI workers are stopped. The dedicated graphical dashboard remains available on loopback port 5201, identity `duty-rota-allocation-progress-v1`, PID 28376 at handoff. Full process details and the next original-plan action are recorded in the tracker and continuation file.
