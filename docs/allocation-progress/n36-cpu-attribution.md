# N36 CPU attribution and bounded interval experiment - 19 November 2026

Completed original cProfile driver13728exit0; sourcehashesunchanged, nofailure. Actualfixture62/62covered,0ordinaryvalidationfailures,baseline/finalOT10/10plusallreservesclear. The instrumented run has~42.25millioncalls and205.894profiledseconds; instrumentation materially alters time/searchavailabletime, so this is not a latency benchmark. Binarypstats andJSONretain evidence. Topcumulativeentries overlap and must not be added.

Observed hot paths:3162ordinaryassignmentvalidations,3162OTplacement/affectedchecks,6326OTguardchecks,126232duty_windowscalls,429976intervalunions,304172Pydanticmodelcopies and~4.58millionSQLAlchemyattributeaccesses. duty_windows63.890scumulative11.659sself; rota_rules.duty_rules_by_key dictconstruction~330963calls/12.987sself; intervalunions17.699scumulative. Guardcheck146.191scumulative includes its children. These are attribution signals, not independent component latencies or proof that alltimeisremovable.

Selected experiment: retain canonical duty_windows API but compute relevant flags withonecurrentrulelookup; bounded2048entryLRU stores only immutable intervaltuples keyedby actualstart/end/date/is24h/resthours/samedayblock/nextdayblock. No ORMobjects,people,leave,posting,authority,eligibility orreservationproofs arecached. Speculative slot/ruleedits changekeysimmediately. New/differentsnapshotcanreuseidenticalprimitiveintervalsbutnotstaffinganswers. Invalidintervalsraisebeforecacheinsertion; cachedpydanticintervalsarefrozen. Existingguardcaches/witnessrechecking/finalvalidationremain unchanged. No score weights,searchtierpriorities or safetyminima changed.

Acceptance experiment scope: directreferenceparity32flag/rest combinations, missingrulefallback, slot/rulemutation, invalidintervalnocache,frozenvalues,2048bound andexistingguard/temporal/availability/repairintegration suites. Compareunchangednormalizedfixturehashes/coverage/ordinaryvalidation/OTreserveproofs ontheexisting48member62slotOTzero/pressure/datedcorpus. Rawtimingsuncontrolledsinglehost; do notclaim production speedup or automaticGPUgate eligibility. Any safe speedup must come with safety/hashparity; retainoriginalbehaviorforrollback.

Finalevidence:86firsttests44.68s;35finalcachetests88.83s(includeslaterruleflagmutationcase);107integrations271.41s,all0failure/error/skip. Counts overlap. Nativeafterbenchmark10084exit0/complete=true3cases; semanticfixturehashes,normalizedassignments,coverage,fixedrows,workloadhistograms,unresolvedreasonsallmatchbaseline. Everyordinaryfinalvalidatorclear;before/finalOTroles+reservesfeasible. Sourcehashesunchanged. n36-interval-comparison.json recordsassertedparity;before/source manifests identifybatchscope. No transaction/schema pathchanged,so no freshPGmigration/raceclaim for this purederivedintervaloptimization. ExistingfinalvalidatorsandOTjoint/temporal/leave/template/optimizer suites exercised. N36 remainspartialandfull50scope21Doneunchanged. Rollback revertsonlyot_availability.pyintervalhelper/cache; no schema/data migration. No operationaldata/deploy/newcloud/model/policyauthority.


## Final timing and retention decision

| Case | Baseline optimizer/candidates/internalchecks seconds | After seconds |
|---|---:|---:|
| Reviewed-zeroOT |97.601|56.539|
| ThursdayOTpressure |94.035|96.844|
| Datedleave/fixed |88.938|90.256|

These areuncontrolledsinglehostruns andnotCP-SAT-onlytime. Pressure/datedareslightlyslower; no generalendtoendimprovement isestablished. AutomaticGPU20percentgateunchangedandnotclaimedmet. No numericGPUworkwaschanged. A smallpairedsame-processmicrobenchmark alternatesoldreference/cachedoperationorderacross5roundsof10000repeatedintervalcalls:medianreference2642.44ms/cached332.99ms(~7.94xforonlythisoperation),50000hits/1miss,exactintervalparity. n36-interval-micro.json/.log. Excludesstaffingproofs/DB/solver/network/browser;neverpresentit aswholeworkflowspeedup.

Retain theboundedimmutablederivedintervalcache becauseitscomponentbenefitisdemonstratedwithunchangedsemanticsandallintegration/paritygatespassed; fullworkflowbenefitremainsunprovenandfurtherbottlenecksremain. Rollbackisoneruntimehelperfile, no data/schema/authoritychange. TestsRuff/scopedwhitespacepassed. No interfaceedit/newbrowserclaimneededforpureintervalderivation. N36stillInprogressformember/template/browser/GPUcoldwarm/encoding/readback/CPUsearchmatrix. N02stillInprogresswithactualcorrectionmetricsmissing;21/50Doneunchanged.
