"""Bounded OT demand reference, deliberately separate from staffing feasibility."""

from datetime import datetime, timezone
import json

from fastapi import HTTPException

from app.services.assistant_sources import digest
from app.services.ot_calendar_store import resolved


def ot_demand_reference(db, unit_id, day):
    result = resolved(db, unit_id, day)
    requirements = result["requirements"]
    if len(requirements) > 64:
        raise HTTPException(422, {"code": "assistant_ot_reference_too_large", "message": "Selected day exceeds the bounded assistant reference. Use the OT calendar directly; no truncated demand is certified."})
    # Area labels, source-reference text, skill names and history notes are not
    # needed for a count/time reference and may contain administrator free text.
    bands = [{
        "band_index": index,
        "starts_at": row.starts_at.isoformat(), "ends_at": row.ends_at.isoformat(),
        "call_levels": sorted(row.call_levels), "minimum": row.minimum,
        "target": row.target, "required_skill_count": len(row.required_skills),
    } for index, row in enumerate(requirements)]
    content = {
        "unit_id": str(unit_id), "day": day.isoformat(),
        "calendar_status": result["status"],
        "demand_known": result["configured"] is True,
        "reserve_mode": result.get("reserve_mode"),
        "bands": bands,
        "closed_area_count": len(result.get("closed_areas", ())),
        "missing_area_count": len(result.get("missing_areas", ())),
    }
    return {
        "reference_contract": "ot-demand-v1", "content": content,
        "source": {"kind": "resolved_unit_ot_calendar", "calendar_revision": result["revision"], "content_version": digest(content)},
        "retrieved_at": datetime.now(timezone.utc).isoformat(),
        "scope": "Selected unit/day demand only; separate bands cannot be summed as simultaneous or unique people. Targets are distinct from mandatory minima.",
        "not_included": ["staff_identities", "personal_availability", "leave_details", "qualification_bindings", "skill_identifiers", "reserve_minimum_counts", "assignment_validity"],
        "interpretation": "Unknown or partial demand is not zero. A known zero-demand day is not proof that staff are free; duty/rest/reserve constraints still require canonical validation.",
    }


def with_ot_reference(context, reference):
    """Explicit selected-unit/day advisory input; reject oversize, never truncate."""
    if len(reference["content"]["bands"]) > 12:
        raise HTTPException(422, "Selected OT day exceeds the local model context bound; use the calendar inspector.")
    demand = {"content": reference["content"],
              "calendar_revision": reference["source"]["calendar_revision"]}
    result = {**context, "source_contract": 2, "ot_demand": demand,
              "sources": [*context["sources"], {"source": "selected_unit_ot_demand", "content_version": digest(demand)}],
              "not_included": [item for item in context["not_included"] if item != "unit_ot_demand"]}
    if len(json.dumps(result, ensure_ascii=True)) > 12000:
        raise HTTPException(422, "Selected reference exceeds the local assistant context bound; no data was truncated.")
    return result
