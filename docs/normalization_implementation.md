# Approved normalization and editing plan

Approved by the user on 18 October 2026. Scope: all 60 items proposed in chat.
Status is deliberately pending until implementation and verification provide evidence.

| Items | Deliverable | Status / evidence |
|---|---|---|
| 1–10 | Discoverable unit creation, complete form, code suggestions, campus-aware identity, searchable lifecycle management, nested creation, empty states | In progress |
| 11–20 | Shared conservative member identity, Unicode comparison, metadata, explicit resolution/alias ownership and inactive review | In progress |
| 21–30 | Profile posting CRUD, searchable/nested member creation, independent normalization, effective dates, conflicts, import modes, bidirectional membership | Pending integration |
| 31–40 | Profile leave CRUD, shared identity, approved labels/statuses, strict dates, overlaps, duty impact and cancellation semantics | Pending integration |
| 41–50 | Templates/examples, common workflow, pre-parse mapping, explanations, match states, repeated corrections, explicit reusable mappings, exclusions/reports, frozen/idempotent previews | In progress |
| 51–60 | Responsive profile sections/actions, draft/focus preservation, reference catalog/mappings, operational semantics, audit/usage and regression/browser checks | Pending integration |

## Completion gates

- Every item must have implementation evidence; existing functionality counts only after inspection.
- Backend checks must exercise wrong identities, ambiguous dates, aliases, intra-file and stored overlaps, replacement boundaries, retries, stale reviews and permissions.
- Frontend build plus desktop/mobile browser checks must cover actual reachable entry points, nested creation, retained drafts and refreshed previews.
- Validate the additive migration before applying it. Preserve historical relationships and records outside explicitly reviewed replacement scope.
- Do not report completion while any numbered requirement remains missing or unverified.
