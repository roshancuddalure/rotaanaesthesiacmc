"""Immutable server-side scheduling evidence; import review keeps its own fingerprint."""

from dataclasses import dataclass
import hashlib
import json

from sqlalchemy import select

from app.core.config import settings
from app.db.session import Base
from app.services.scheduling_inputs import INPUT_TABLES


VERSION = 5
# Keep creation timestamps: dated-call ties and holiday-setting precedence use
# them. Updated timestamps below are audit-only, not precedence-bearing fields.
OMIT = {
    "person_designations": {"notes"},
    "member_call_level_changes": {"notes"},
    "person_call_changes": {"reason", "actor_id"},
    "units": {"notes"},
    "unit_call_minimums": {"updated_at"},
    "admin_mappings": {"notes", "updated_at"},
    "reference_values": {"updated_at", "version"},
    "person_postings": {"notes"},
    "leave_requests": {"notes", "raw_person_name", "updated_at"},
    "duty_slots": {"notes", "template_reason"},
    "duty_assignments": {"override_reason"},
    "rule_versions": {"description"},
    "rule_settings": {"description"},
    "call_clusters": {"description", "updated_at"},
    "person_call_cluster_memberships": {"notes"},
    "monthly_generation_scopes": {"lock_reason", "updated_at"},
    "monthly_generation_scope_units": {"notes"},
    "ot_calendars": {"updated_at"},
    "extra_duty_records": {"reason", "void_reason", "voided_at", "justice"},
}
SET_KEYS = frozenset({"allowed_call_levels", "allowed_group_keys", "excluded_group_keys",
                      "call_levels", "required_skills", "group_keys"})


def canonical_value(value, key=None):
    if isinstance(value, dict):
        return {k: canonical_value(v, k) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        items = [canonical_value(v) for v in value]
        return sorted(items) if key in SET_KEYS and all(isinstance(v, str) for v in items) else items
    return value


def project_row(name, row):
    if name == "rota_learning_versions":
        return {"id": row["id"], "weights": canonical_value(row["data"].get("weights"))}
    if name == "extra_duty_batches":
        return {**{k: row[k] for k in ("id", "rota_period_id", "month", "status", "created_at")},
                "mode": (row["summary"] or {}).get("mode")}
    projected = {k: canonical_value(v, k) for k, v in row.items() if k not in OMIT.get(name, ())}
    if name == "rule_settings":
        from app.services.rota_rules import PHASE_ONE_SETTING_KEY
        if row["key"] == PHASE_ONE_SETTING_KEY and isinstance(projected.get("value"), dict):
            projected["value"] = {k: v for k, v in projected["value"].items() if k != "notes"}
    if name == "duty_assignments":
        projected["has_override"] = bool(row["override_reason"])
    if name == "duty_slots":
        from app.services.rota_template import FORCED_ALLOCATION_REASON_PREFIX
        projected["forced_allocation"] = str(row["template_reason"] or "").startswith(FORCED_ALLOCATION_REASON_PREFIX)
    return projected


@dataclass(frozen=True)
class SchedulingSnapshot:
    version: int
    canonical_json: str
    digest: str


def capture(db):
    """Freeze SQL values without exposing or retaining mutable ORM/JSON objects.

    Apply callers acquire lock_inputs first. This reader never initializes rules,
    flushes pending changes or claims standalone multi-statement isolation.
    """
    from app.services.allocation_objectives import OPTIMIZER_OBJECTIVE_REVISION

    names = (*INPUT_TABLES, "ot_calendars") if settings.ot_calendar_enabled else INPUT_TABLES
    state = {"snapshot_version": VERSION, "ot_calendar_enabled": settings.ot_calendar_enabled,
             "engine_revisions": {"optimizer_objective": OPTIMIZER_OBJECTIVE_REVISION}, "tables": {}}
    with db.no_autoflush:
        for name in sorted(names):
            table = Base.metadata.tables[name]
            query = select(table).order_by(table.c.id)
            if name == "rota_learning_versions":
                query = query.where(table.c.status == "active")
            state["tables"][name] = [project_row(name, row) for row in db.execute(query).mappings()]
    serialized = json.dumps(state, sort_keys=True, default=str, separators=(",", ":"))
    return SchedulingSnapshot(VERSION, serialized, hashlib.sha256(serialized.encode()).hexdigest())
