# N22 person/month/year leave statistics

Status: Done against original N22 acceptance; 18/50 complete. Final reconciliation below supersedes earlier backend-only checkpoints.

## Current backend contract

`member_leave_statistics.statistics` reuses canonical `leave_accounting.interval_coverage` and `leave_semantics` bands/union. It accepts one person's canonical records, an explicit year, optional month and hospital-local as-of datetime. Report years1-9998 avoid end-boundary overflow; month1-12; at most2000 overlapping records and100000 overlapping record-dates before interval expansion; oversized reports receive an explicit error, never partial totals. Report queries retrieve the person’s actual overlapping records, not the recent30-row profile subset. The existing authenticated workspace router exposes `GET /admin/member-workspace/{person_id}/leave-statistics?year=2026&month=11&as_of=2026-11-14T12:00:00`. Omitted as-of uses facility-local current time; offset-aware input is rejected explicitly to avoid silent clock conversion.

- Whole-period approved and pending each report interval union, elapsed and future partitions, exact/known clock hours, touched calendar dates and unresolved source IDs. Approved and pending remain separate; duplicates do not multiply time. In-progress date is one when known coverage touches both elapsed/future on that date; unknown current sessions return null precise count with known count separate.
- These are current-state recorded statuses, not proof of attendance or what approval was known at a historical as-of time. As-of clipping is explicit. Future approved absence is not labeled leave already taken. Calendar dates touched by partial bands are not entitlement days; elapsed/future date counts can share today's date and must not be added as full dates.
- Status record counts and type breakdowns retain canonical source meaning. Different types can overlap; overall union is authoritative and type-hour totals cannot be summed. A cross-month request appears in each overlapping month; monthly request counts do not sum to unique annual requests. Month views clip stored intervals while retaining canonical record IDs.
- No authoritative individual work calendar is inferred from weekdays. Working days and entitlement balance remain null with definitions; weekends/holidays are included in the explicitly labeled calendar basis. Historical coverage and verified attendance remain false even when no records match. Deleted or absent historical records are not reconstructed as attendance.
- Endpoint uses the existing normalization input namespace and a no-autoflush read for coherent participating application writes. Existing signed-in workspace read authority remains; no approval/mutation authority added. It returns no private notes/raw names. UI must visibly preserve these definitions and unavailable states.

## Fresh evidence

`n22-statistics-first.xml`:24passed5.87s initial statistics/reporting/attribution. `n22-statistics-final.xml`:46passed8.10s after in-progress unknown precision refinement and independent hour oracle. Zero failures/errors/skips; suites overlap. Oracle checks every AM/PM/NIGHT/FULL_DAY combination at five as-of hour boundaries, with duplicated source references; expected occupied hours are enumerated independently. Fixed examples cover elapsed84/future60hours for approved union144hours, type totals156hours versus union144, exact midnight,14-hourNIGHT, leapFebruary48hours/March24, unknownfuture not corrupting knownelapsed/othermonths, unknowntoday precision, and actualAPI31records372hours beyondrecentprofilecap. Existing profile/activity/history/reporting/attribution tests pass alongside. Ruff and scoped whitespace pass.

## Remaining work

Mount person/month/year controls and charts/statistics in the existing profile Leave section, with visible clock/as-of/counting basis/unknown coverage and status/type/month breakdown. Test actual canonical responses on desktop/mobile/keyboard, stale month/member/as-of reads, partial/malformed errors and retry. Add larger-record/time-budget and transfer/reconciliation API cases where needed before final acceptance; existing unit/call attribution remains separately tested under N20. N23 entitlement separation and N24 impact/repair remain separate original tasks. No schema/frontend/model/cloud/clinical-policy/deployment change in this backend batch.

Rollback: remove additive statistics endpoint/service without migration; canonical leave and audit records remain unchanged. Do not revert unrelated workspace/profile changes.

Final bounded report verification: n22-statistics-bounded-final.xml47passed8.62s0fail/error/skip after adding record/date-work guards. Tests assert both limits reject without partial output. Suites overlap; n22-statistics-source.json final hashes/results and n22-before.json initial scope. No runtime edits after final47pass. No implementation/test worker at checkpoint; N22 remains In progress.


## Final interface and original N22 acceptance

| Original criterion | Authoritative current evidence |
|---|---|
| Person/month/year statistics, status/type breakdown | Existing profile Leave tab opens member-leave-statistics.ts; year/month/as-of controls call the canonical authenticated endpoint. Approved and pending timing, source status counts, type records/coverage and12annualmonthly bars are visible. No recent30-row shortcut. Actual31rowAPI372hourstest passes. |
| Reconcile numbers to source intervals | Canonical same-person union, independent all15partialcombination/hour oracle, fixedelapsed84/future60 union144; actual memorybackendUI reproduces those values and changedasof24elapsed/120future. UnknownpendingCUSTOM staysunknown, no fallbackchargedhours. |
| Calendar versus working days | Visible hospital-localclock/asof/range,calendarcountstoucheddatesincludingweekends/holidays,partialdatesnotentitlementdays. Workcalendar/balance unavailable explicit. Currentstatusprojection doesnotreconstructhistoricalapprovalorattendance. |
| Overlap, midnight, transfer and leap year | Prior47boundedbackendcases plus35acceptancecases include distincttypeoverlap/monthrecordnonadditivity,14hourNIGHT,leapFeb48/March24,exactmidnight,actualdatedunittransferdoesnotduplicatepersonabsence,identityscope/no unrelatedpersoncounts. |
| Historical coverage unavailable disclosed | Response and visibleprofilecoverage state historicalcoverageincomplete; emptyquerynotcompletehistory. Unknownsource sessions nullprecise totals withknownlowerbounds; UIrejectsmalformed/inconsistentmeasures ratherthan inventzero. |

The read-onlystatisticsdialog owns requests by sequence and member/dialog lifetime. Changing any control clears the prior totals and invalidatespendingreads. Close/parentremoval ignoreslate results; reopenedstatisticsreadsfreshcanonicaldata. Itvalidatesrequestedperson/year/month/datebounds/asofminute andmonthlysequence,pluspreciseversusknownmeasureconsistency. A mismatchedclockorpartialpayload giveserrorwithreadretry, neverdisplayingmislabeledtotals. Sources'private notes arenotreturned/rendered; onlyGETs areused.

Actualcanonicalbackendbrowser1440/390/320 passes84elapsed/60future,144annualwith12bars,unknownpending,separatebasis,formchangeinvalidation,503retry,malformedpayload,wrongeffectiveclockrejection,lateMaycannotoverwriteJune,asofchange24elapsed/120future,focusrestore,0pageerrors/overflow/seriouscriticalAxe testedstatisticsdialog. n22-statistics-browser.json usesactualbackendfixturecalculations; malformed/failure/late-responseconditionscontrolledatthetransportboundary.

Finalbackend n22-statistics-acceptance.xml35passed7.55s0fail/error/skip includesactualtransferandpermissions:rota_board_memberretains existingauthenticatedread,unknownperson404,unauthenticated401,offsetasof422. Prior47boundedpassremainscurrentbackendruntime; counts/suitesoverlapandarenotadded. FinaltestsemicolonsfixedforRuffaftergreenrun,behaviorunchanged. Frontend135tests/buildpassed(existingmixedimport/chunksizewarnings);existingworkspace10workflowspassed. Finalhash/evidence n22-ui-before.json/n22-ui-source.json; logs n22-ui-unit.log/n22-ui-build-final.log/n22-workspace-regression.log PowerShellUTF16.

No new schema, mutation/approval authority, clinical policy, cloud/modelroute, operationalmigrationorproductiondeployment. Defaultasoffacilitynowisexplicit;userreportdatesdonotconferapproval. Rollbackadditivedialog/endpointwithoutmigratingcanonicaldata;preserveunrelatedworkspaceeditsandhistoricalaudit. N23leave-taken/balanceboundaryandN24impact/repairremainseparateunfinishedtasks. N22doesnotclaimattendanceorentitlementaccuracyfrommissingpolicy/data.
