# Numeric proposal grounding: reproduced defect and correction contract

`tools/audit_ai_numeric_guard.py` sends canned model replies through the actual
companion endpoint, with the model transport mocked. It performs no inference,
database access, policy activation or network requests. This isolates the guard
from model quality.

`n42-numeric-guard-before.json` is complete/source-unchanged and records **four
unexpected acceptances**:

| Request | Incorrect proposal accepted with HTTP200 |
| --- | --- |
| `max_24hr_per_month -1` | Positive1: minus sign lost |
| Maximum2.5 weekend duties per month | Integer2: fraction truncated |
| Maximum2 or5, user has not decided |2: uncertainty resolved without authority |
| Maximum2 weekend24-hour duties per month | Generic monthly24-hour maximum2: weekend scope lost |

The valid control requests8 twenty-four-hour duties and proposes8, distinguishing
count from duration. These are failures of the existing numerical guard even
when JSON matches the schema. No returned suggestion was applied as a policy.

The live Gemma development run independently reproduced the first defect:
`negative_limit` returned positive1, HTTP200, `grounding_check=passed`, with the
original negative request quoted as evidence. Quoting source text is insufficient
when its signed value or scope has been altered.

## Correction

`tools/local_ai_numeric_policy.py` extracts only explicit supported integer
settings, preserving scope. Negative/fractional values, conflicting alternatives,
negation, competing values, repeated settings and unsupported scope require
clarification. Clear combined requests use separate clauses. Zero is a valid
count; the existing rest-gap upper bound remains168. This is conservative intent
parsing for review proposals; it defines no new departmental policy.

After parser extraction, the companion must require the complete exact set of
proposed key/value pairs, rejecting omitted, duplicate or invented settings.
Existing authentication, local transport, bounded retries, source evidence,
mandatory review and no-apply behavior must remain intact.

Parser verification: first run19passed/2failed because sentence-final periods
were rejected after explicit setting values. Corrected21passed4.82s; expanded
negation/competing-value checks **26passed1.41s**. Evidence files preserve all
three runs. Ruff passed. New integration cases are prepared to verify real
endpoint behavior after the live baseline finishes. Do not claim the companion
guard fixed until integration, after-audit and regression checks pass.

The 24-case baseline retained the original companion until its terminal result
and final source-hash verification. Integration happened only afterward.
No model-selection, clinical-policy, cloud-routing or deployment approval follows
from this correction.

## Verified correction

The companion now requires an exact complete match between extracted supported
settings and model proposals, including value and scope, before attaching source
evidence and returning a reviewed suggestion. It rejects duplicates and missing
settings. Existing local-only transport, two-attempt limit, authentication,
mandatory review and no-apply behavior remain intact.

`n42-numeric-guard-final.xml`: **57 passed in19.69s**; session9442 exited0.
This includes16 endpoint cases,26 parser cases, the existing companion tests and
evaluation scorer checks. Counts overlap earlier runs. Valid monthly/weekend/
group/campus/rest/zero/combined proposals pass; invalid proposals require two
bounded attempts then return the existing grounded-rejection error.

`n42-numeric-guard-after.json`: session6132 exited0, complete/source-unchanged;
all four incorrect canned replies return502, the valid8-count control returns200,
and unexpected acceptances fell from4 to0 **on these five probes**. This is guard
evidence, not improved live-model accuracy. Ruff/scoped whitespace passed;
`n42-numeric-guard-source.json` records final implementation/evaluation hashes.

The parser is deliberately conservative; unsupported phrasing falls back to
reviewed manual planning. It does not resolve every natural-language ambiguity
or certify all explanation claims. No schema, domain safety minimum, objective,
assignment, published rota or application model choice changed. Rollback removes
the parser import/call from the companion and retains evidence; no data migration
is needed. Further Qwen/live-model and human semantic evaluation remains N42 work.
