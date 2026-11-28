# Layout incumbents and search allocation for mixed-call months

The preceding mixed-call experiment exposed two limits: filtering a shared 29-duty draft into one unit layout could leave only 12 duties, and short fixed-layout searches often spent their allowance on coverage before reaching fairness. The last retained repair plan covered 27 duties with very uneven member loads.

The experiment now completes each filtered starting draft inside its actual method deadline. It keeps existing choices, considers only candidates allowed by the chosen unit layout, orders additions by the existing call-level equality marginal, and admits each addition only after the complete canonical final-set check. This retains monthly quotas, duty/rest conflicts, OT reservations and exact saved-commitment checks. Neighbor searches receive the previous valid incumbent as another starting option, compared using the shared quality vector.

Starting-draft work receives at most one quarter of the time remaining after model construction. An already expired call performs no new additions. A blocking validation may overrun; the artifact records actual method elapsed time and overruns. Starting-draft size before and after completion is retained in each result.

Staged solver time is weighted toward required coverage and call-level equality, using weight four for each and one for other tiers. These weights allocate search time; the lexicographic objective precedence and values remain unchanged. When a validated incumbent covers every admitted logical candidate day, that independent upper bound can certify the fixture's mandatory and total coverage without another search. It cannot certify fairness or a missing duty whose candidate exists but whose combination may be infeasible.

The exact shared quality comparison remains the acceptance rule. If a solver result is worse than its validated starting incumbent, the incumbent is retained and inconsistent proof receipts are discarded. All accepted plans still pass canonical validation. These changes affect the isolated architecture experiment; production already has its own validated incumbent path.

The regression extends the mixed-call fixture to check that a layout-specific draft retains every applicable prior choice, gains valid duties, follows the selected units, and remains unchanged under an expired construction allowance. Existing tests also cover complete objective arithmetic, saved commitments, quota ceilings, repair plateaus and logical call targets. Test and benchmark terminal results are recorded in the tracker before being claimed as passing evidence.

This remains development on known synthetic cases. Global architecture selection, representative months and the full 50-item acceptance requirements remain open. A better draft alone does not establish maximum coverage, fairness optimality or production speed.
