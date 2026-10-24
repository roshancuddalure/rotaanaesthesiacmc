# Browser suite assertion map

`index.json` discovers every top-level `frontend/tests/*.mjs` script, including
scripts outside the `.browser.mjs` naming convention. Discovery does not mean
assertions have been inspected. Unmapped suites remain explicitly pending.

Reviewed slices identify actual screens, entry controls, context/state variants,
observable outcomes, assertion line anchors, evidence classes and raw report/log
paths. Script hashes bind each mapping to the inspected test. Evidence still has
its own original source/build scope; mapping an old report does not refresh it.
Intercepted writes and synthetic read-back must never be described as real
backend persistence. Geometry and tagged axe are distinct from physical-device
or native screen-reader checks.

Run `python tools/verify_frontend_suite_map.py --write-index` after reviewing
discovery/mapping changes, then run without the flag to verify freshness. This
checks duplicate entries, script hashes, required mapping fields, local evidence
paths and line ranges. It does not understand assertion semantics, execute tests
or certify item17. Complete item17 requires reviewed mappings for every browser
suite, including historical/superseded scopes and exclusions.
