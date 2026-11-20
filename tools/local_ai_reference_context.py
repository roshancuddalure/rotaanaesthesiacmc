"""Minimized companion reference boundary; hashes identify content, not authority."""

import hashlib
import json
import math
import re
from local_ai_ot_reference import selected_ot_reference

LIMITS = {"max_24hr_per_month", "max_weekend_24hr_per_month", "max_same_group_per_month", "max_same_campus_per_month"}
NUMBERS = {
    "limits": LIMITS,
    "rest": {"minimum_gap_after_24hr_hours"},
    "staffing": {"minimum_available_count", "warning_unavailable_percent", "hard_block_unavailable_percent"},
}
BOOLEANS = {"limits": set(), "rest": {"post_24hr_blocks_next_day_elective"}, "staffing": {"small_unit_uses_absolute_minimum"}}
SCORES = {"status", "same_day_type", "burden", "weekend", "rest", "staffing", "fairness", "validation"}
MISSING = ["member_identity", "personal_availability", "leave_reasons", "profile_comments", "unit_ot_demand", "assignment_validity"]


def content_version(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()).hexdigest()


def prepare_reference(raw):
    value = json.loads(raw) if raw else {}
    if not isinstance(value, dict):
        raise ValueError("Reference context must be an object")
    versioned = "source_contract" in value
    if versioned and (type(value["source_contract"]) is not int or value["source_contract"] not in (1, 2)):
        raise ValueError("Unknown reference contract; reload current sources")
    original = value.get("constraints", {})
    if not isinstance(original, dict):
        raise ValueError("Malformed constraint reference")
    constraints = {}
    for section, keys in NUMBERS.items():
        original_section = original.get(section, {})
        if not isinstance(original_section, dict):
            raise ValueError("Malformed constraint section")
        clean = {}
        for key in keys:
            if key not in original_section:
                continue
            number = original_section[key]
            if number is None and section == "limits":
                clean[key] = None
            elif type(number) is int and 0 <= number <= 1_000_000:
                if key == "minimum_gap_after_24hr_hours" and number > 168:
                    raise ValueError("Unsupported rest range")
                if key.endswith("unavailable_percent") and number > 100:
                    raise ValueError("Unsupported percentage")
                clean[key] = number
            else:
                raise ValueError("Reference values must preserve integer type and range")
        for key in BOOLEANS[section]:
            if key in original_section:
                if type(original_section[key]) is not bool:
                    raise ValueError("Reference flag must be boolean")
                clean[key] = original_section[key]
        if versioned and set(original_section) != set(clean):
            raise ValueError("Unknown constraint fields in versioned reference")
        if section in original:
            constraints[section] = clean
    if versioned and set(original) != set(constraints):
        raise ValueError("Unknown constraint sections in versioned reference")
    examples = []
    original_examples = value.get("examples", [])
    if not isinstance(original_examples, list) or len(original_examples) > 5:
        raise ValueError("Reference teaching features exceed the supported scope")
    for example in original_examples:
        if not isinstance(example, dict) or example.get("kind") not in ("accept", "prefer") or example.get("reason") not in ("burden", "spacing", "history", "coverage", "preference", "other"):
            if versioned:
                raise ValueError("Unsupported versioned teaching feature")
            continue
        clean = {"kind": example["kind"], "reason": example["reason"], "weekend": example.get("weekend")}
        if clean["weekend"] is not None and type(clean["weekend"]) is not bool:
            raise ValueError("Teaching weekend flag must be boolean or unknown")
        for key in ("proposed_score_components", "preferred_score_components"):
            features = example.get(key) or {}
            if not isinstance(features, dict):
                raise ValueError("Teaching features must be numeric components")
            clean[key] = {k: n for k, n in features.items() if k in SCORES and type(n) in (int, float) and abs(n) <= 1_000_000 and math.isfinite(n)}
        if versioned and clean != example:
            raise ValueError("Unrecognized data in versioned teaching features")
        examples.append(clean)
    result = {"constraints": constraints, "examples": examples, "not_included": MISSING}
    if versioned:
        month = value.get("month")
        if not isinstance(month, str) or not re.fullmatch(r"\d{4}-(?:0[1-9]|1[0-2])", month):
            raise ValueError("Invalid reference month")
        sources = value.get("sources")
        has_ot = value["source_contract"] == 2
        if not isinstance(sources, list) or len(sources) != (3 if has_ot else 2):
            raise ValueError("Incomplete source references")
        expected = {"current_rule_constraints": content_version(constraints), "approved_teaching_features": content_version(examples)}
        if has_ot:
            try:
                demand = selected_ot_reference(value.get("ot_demand"), month)
            except (TypeError, AttributeError, OverflowError) as exc:
                raise ValueError("Malformed selected OT reference") from exc
            expected["selected_unit_ot_demand"] = content_version(demand)
            result["ot_demand"] = demand
            result["not_included"] = [item for item in MISSING if item != "unit_ot_demand"]
            result["ot_interpretation"] = "Selected unit/day demand definitions only. Unknown or partial is not zero; targets are not minima. Never sum bands as unique or simultaneous people. Availability, qualifications, reserve minima and assignment safety require canonical validation."
        actual = {}
        for source in sources:
            if not isinstance(source, dict) or set(source) != {"source", "content_version"} or not isinstance(source["source"], str) or source["source"] in actual:
                raise ValueError("Invalid or duplicate reference source")
            actual[source["source"]] = source["content_version"]
        if actual != expected:
            raise ValueError("Reference content versions do not match supplied facts")
        result.update(source_contract=value["source_contract"], month=month, sources=sources)
    else:
        result["source_scope"] = "Legacy unversioned minimized context; no current source or freshness claim"
    return json.dumps(result, sort_keys=True, allow_nan=False)


def require_available_facts(instruction, *, selected_ot=False):
    lookup = re.search(r"\b(?:what|which|how many|tell me|show me|give me)\b", instruction, re.I)
    if not lookup:
        return
    if re.search(r"\b(?:ot|operating theatre|operating room)\b", instruction, re.I):
        if selected_ot:
            raise ValueError("The selected OT reference contains demand definitions only. This companion suggests planning modes; inspect the recorded calendar for factual counts. It cannot establish availability or assignment safety.")
        raise ValueError("This assistant reference does not include unit OT demand. Check the unit OT calendar and specify the date and unit; regular planning remains available.")
    if re.search(r"\b(?:medical|diagnosis|private|reason)\b", instruction, re.I) and re.search(r"\bleave\b", instruction, re.I):
        raise ValueError("Private leave reasons are not included in this assistant reference. Use authorized leave records; no medical or attendance inference is available.")
    if re.search(r"\b(?:available|availability|eligible|eligibility)\b", instruction, re.I) and re.search(r"\b(?:person|people|member|members|doctor|doctors|who)\b", instruction, re.I):
        raise ValueError("Personal availability is not included in this assistant reference. Check current candidates and dated leave/postings in regular planning.")
