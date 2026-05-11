# Call Cluster Eligibility Plan

## Source Idea

The rota board needs a way to split a call level into smaller admin-defined groups when only some people inside that call level can do a specific duty.

Examples:

- Not every 3rd call member can do Schell Call.
- Not every 3rd call member can do Shift duties.
- A duty should be able to say: eligible call level is 3rd call, but only this subgroup inside 3rd call is allowed.

This should be configurable by admins and should affect template safety checks, candidate suggestions, manual assignment validation, safe auto-fill, review, and export reporting.

## Decision

Add an optional eligibility layer called **Call Clusters**.

A call cluster is a named subgroup inside a normal call level.

Examples:

- `3rd Call - Schell Eligible`
- `3rd Call - Shift Eligible`
- `4th Call - RC Eligible`
- `5th Call - CART Eligible`

Normal call levels remain the main staffing category. Clusters are used only where needed. If a duty has no cluster restriction, the current call-level eligibility behavior remains unchanged.

## Recommended Rules

1. A cluster belongs to one primary call level.
2. A member can belong to more than one cluster.
3. Cluster membership should be effective-dated so the admin can change it over time without losing history.
4. A duty can allow:
   - whole call levels,
   - specific clusters inside those call levels,
   - or both.
5. If a duty has cluster restrictions, a member must match the call level and at least one allowed cluster.
6. If a member has the correct call level but not the required cluster, they should be shown as **Blocked** for that duty.
7. Manual override should still be possible, but the reason must mention that the member is outside the required cluster.
8. Safe auto-fill must never use a person outside the required cluster.

## Data Model

### `call_clusters`

Stores admin-defined subgroups.

Fields:

- `id`
- `key`
- `name`
- `call_level`
- `description`
- `active`
- `created_at`
- `updated_at`

Notes:

- `key` should be stable and unique, for example `third_call_schell`.
- Duty rules should store cluster keys rather than database IDs, so rule JSON remains readable and portable.

### `person_call_cluster_memberships`

Stores which people belong to which clusters.

Fields:

- `id`
- `person_id`
- `cluster_id`
- `effective_from`
- `effective_to`
- `source`
- `notes`
- `created_at`

Notes:

- `effective_from` and `effective_to` let the rota board change future eligibility without corrupting previous months.
- A person may have multiple active cluster memberships.

## Admin Interface

Add a new collapsible section in the admin area, preferably inside **Rota Rules** or as a new **Call Clusters** admin screen.

### Cluster Management

Admin can:

1. Create a cluster.
2. Choose the parent call level.
3. Add a clear name and description.
4. Activate or deactivate the cluster.
5. See member count per cluster.

### Member Assignment

Admin can:

1. Open a cluster.
2. Search department members.
3. Add or remove members.
4. See each member's current call level and unit.
5. Add optional notes.
6. Set effective dates if the cluster assignment should start or stop later.

### Duty Eligibility

In the **Rota Rules** duty table, add:

1. Allowed call levels.
2. Allowed call clusters.
3. Optional excluded call clusters.
4. A compact display that shows restrictions without making the table too wide.

Recommended UX:

- Keep the existing duty table compact.
- Use a per-duty expandable row or popup to edit advanced eligibility.
- Show a summary such as:
  - `3rd Call`
  - `3rd Call / Schell Eligible only`
  - `3rd + 4th Call / RC Eligible`

## Backend Workflow

### Rule Loading

Extend `DutyRule` with:

- `allowed_cluster_keys: list[str]`
- `excluded_cluster_keys: list[str]`

Existing `allowed_call_levels` remains.

Backward compatibility:

- Existing saved rules with no cluster fields should validate successfully.
- Existing duties with only `allowed_call_levels` should behave exactly as before.

### Safety Engine

Update `MemberContext` so it carries active cluster keys for the member on the slot date.

Eligibility sequence:

1. Get people assigned to the slot unit on that date.
2. Check call level eligibility.
3. If the duty rule has allowed clusters:
   - require at least one matching active cluster.
4. If the duty rule has excluded clusters:
   - block members in those clusters.
5. Then apply leave, same-day duty, rest, and count-limit checks as usual.

Blocked reason examples:

- `Member is 3rd Call but is not in the Schell Eligible cluster.`
- `Member belongs to a cluster excluded for this duty.`

### Candidate Engine

Candidate suggestions should inherit the safety result.

Candidate cards should show:

- call level,
- matching cluster badge if relevant,
- blocked reason when the cluster is missing.

### Manual Assignment

Manual assignment should validate cluster eligibility.

Behavior:

- Matching cluster: allow normally.
- Missing cluster: block unless override is supplied.
- Override must be recorded in the assignment and review dashboard.

### Safe Auto-Fill

Safe auto-fill should only use candidates that are:

- correct unit,
- correct call level,
- correct cluster if required,
- clear of leave/rest/same-day blockers,
- not requiring override.

### Publish And Export

Final export should include cluster metadata where useful:

- Final Rota sheet: member cluster badges if the duty had cluster restrictions.
- Review Items sheet: missing-cluster blockers.
- Duty Counts sheet: optional cluster-wise counts for restricted duties.
- Audit sheet: duty rule snapshot including allowed clusters.

## Frontend Workflow

### Department Members

Show cluster badges under each member, especially for admins.

Example:

- `3rd Call`
- badges: `Schell Eligible`, `Shift Eligible`

### Unit Management

In monthly unit cards, show clusters beside member names. This helps the rota board understand why some people are suggested for special duties and others are not.

### Rota Rules

Duty eligibility should become a flexible admin control:

- call-level selector,
- cluster selector filtered by selected call levels,
- compact summary in the main table,
- expanded editor for advanced settings.

### Rota Template Calendar

Inside the day popup:

- slot detail should show required clusters when a duty has restrictions,
- suggested member cards should show matching clusters,
- blocked members should show missing-cluster explanations.

## API Plan

Add endpoints:

- `GET /api/v1/admin/call-clusters`
- `POST /api/v1/admin/call-clusters`
- `PUT /api/v1/admin/call-clusters/{cluster_id}`
- `GET /api/v1/admin/call-clusters/{cluster_id}/members`
- `PUT /api/v1/admin/call-clusters/{cluster_id}/members`

Extend existing:

- `GET /api/v1/admin/rota-rules/phase-one`
- `PUT /api/v1/admin/rota-rules/phase-one`
- `GET /api/v1/members`
- `GET /api/v1/unit-management/month`
- `GET /api/v1/rota-safety/month`
- `GET /api/v1/rota-candidates/month`

## Test Plan

Backend tests:

1. Existing duty eligibility still works when no clusters are configured.
2. Admin can create and update a cluster.
3. Admin can assign members to a cluster.
4. Safety engine includes a member when the cluster matches.
5. Safety engine blocks a member when the call level matches but the required cluster is missing.
6. Candidate engine ranks only eligible cluster members as safe.
7. Manual assignment requires override for a missing cluster.
8. Safe auto-fill never assigns a missing-cluster candidate.
9. Effective dates are respected.
10. Export includes cluster restriction information.

Frontend checks:

1. Cluster admin screen is compact and searchable.
2. Duty eligibility editor does not make the Rota Rules table too wide.
3. Rota Template calendar day popup explains cluster restrictions clearly.
4. Mobile layout keeps cluster badges readable.

## Implementation Phases

### Phase 12A: Schema And Backend Foundation

- Add `CallCluster` model.
- Add `PersonCallClusterMembership` model.
- Add Alembic migration.
- Add cluster service functions.
- Add admin cluster API.
- Add backend tests for CRUD and membership dates.

### Phase 12B: Admin Cluster UI

- Add admin-facing Call Clusters panel.
- Create/edit/deactivate clusters.
- Add/remove members.
- Show cluster badges in Department Members and Unit Management.

### Phase 12C: Duty Rule Eligibility UI

- Extend `DutyRule` schema with cluster fields.
- Add allowed cluster editor in Rota Rules.
- Keep the duty table compact with expandable advanced settings.
- Preserve old rule JSON automatically.

### Phase 12D: Generator Integration

- Update safety engine to apply cluster eligibility.
- Update candidate suggestions and manual assignment validation.
- Update safe auto-fill to respect cluster restrictions.
- Add clear user-facing reasons for missing cluster eligibility.

### Phase 12E: Review, Export, And QA

- Add cluster restriction details to review dashboard.
- Add cluster metadata to final Excel export.
- Run full backend tests, frontend build, and a real-data workflow test.

## Open Questions For Approval

1. Should cluster membership be permanent/effective-dated, or should it be configured separately for every rota month?
2. Can one person belong to multiple clusters inside the same call level?
3. Should missing cluster eligibility be a hard block by default, or a warning that always requires board review?
4. Should clusters be restricted to one call level, or can a cluster include mixed call levels?
5. Which initial clusters should we seed first, for example `Schell Eligible`, `Shift Eligible`, `CART Eligible`, `PAC Eligible`?

## Recommended Approval Choice

Recommended design:

- effective-dated cluster membership,
- multiple clusters per person allowed,
- clusters belong to one call level,
- missing required cluster is a hard block unless manually overridden,
- no default cluster restrictions for existing duties until the admin configures them.

This gives flexibility without breaking the current rota generator behavior.
