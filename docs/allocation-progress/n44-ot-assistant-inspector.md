# Recorded OT facts in Assistant review

Administrators can now open the Assistant tab, choose an OT reference unit and
a date in the working month, and refresh recorded demand from the existing
admin-only source endpoint. The section works without assistant opt-in, pairing
or a model. It reads canonical facts directly; it does not ask a model to
reinterpret minimum counts, infer staff availability, select a planning mode,
apply assignments or change policy.

The result labels complete versus unknown/partial demand, shows each numbered
band's interval, explicit call pool, mandatory minimum, separate target and skill
count, and reports closed/missing areas and reserve mode. Calendar/content
versions and retrieval time are available in source details. Missing skill
identifiers, qualification bindings and reserve counts remain explicit limits.
Bands cannot be summed as unique/simultaneous people; known zero demand is not
proof that anyone is available.

Changing the unit/date clears the previous result. Refresh clears old facts
before fetching and shows the current returned version. Replies must match the
captured selected unit/date and supported typed contract; changed/closed workspaces
cannot display late responses. Controls are not offered to non-admin users, and
the backend independently enforces its existing role/feature boundary. Permission
or source errors leave regular planning available. Refresh is a point-in-time read,
not a subscription or an operational-data lock.

The model path stays separate: OT reference data is never appended to its context
or sent over loopback. The companion's absent-OT factual-query guidance remains
in force. This is an intentionally deterministic facts view in the assistant
workflow, not a model-grounded numerical answer or an expansion of local/cloud
data routing. The wider N44 grounding/unknown-fact and N42 evaluation work remains.

## Verification

- `assistant-ot-reference.test.mjs` checks exact selected scope, canonical
  CO_4TH_CALL pool support, known/unknown/partial shape, numeric/flag types,
  time ordering, targets/minima, bounded bands and malformed source versions.
- First build rejected `replaceAll` for the project's ES2020 target; changed to
  compatible replacement. The initial helper-test harness defaulted to an older
  target and skipped iterator validation. It now uses the app's ES2020 target;
  final frontend unit suite152pass, no failures/skips.
- Actual component browser tests at1440/390/320 use intercepted APIs and potential
  model requests. Exact facts, unknown/partial states, clearing on selection,
  changed revision on refresh, wrong-scope refusal, permission errors, late-close
  ignoring and hidden non-admin controls pass. Zero API writes/model requests,
  page errors/overflow and serious/critical Axe findings in the OT section.
- Initial table layout passed overflow assertions but failed screenshot review:
  caption collapsed into a narrow column. Replaced it with labeled band cards;
  repeated screenshot inspection and responsive tests confirm readable labels
  and separate minima/targets. The final source uses plain “to” between times.

Browser evidence is `n44-ot-inspector-browser-final.json`; early reports/failure
logs remain separate. No full live-model, production-data, new backend policy or
native GPU claim is made. The existing source endpoint's26 backend checks are
prior evidence; this UI batch does not count them as fresh. Final build, source
hash checkpoint and final screenshot determine UI acceptance.

Final acceptance:152 frontend tests passed (`n44-ot-inspector-tests-final.log`,
87138exit0); TypeScript/Vite build31.56s passed
(`n44-ot-inspector-production-final.log`,85919exit0), with existing bundle/mixed
import warnings. Browser21802exit0 ran both the finished OT inspector and the
existing assistant reference/race regression, each at1440/390/320. The final
390px card screenshot was inspected after replacing the separator with plain to.
`n44-ot-inspector-source.json` hashes were independently verified unchanged;
scoped whitespace passed. Task-owned Vite34470 stopped after all gates.

Rollback removes the OT inspector/helper and restores the prior Assistant tab;
no schema or stored-data rollback is needed. The read-only source endpoint can
remain independently available to authorized administrators. This subset does
not complete N44 or the original50-item allocation goal.
