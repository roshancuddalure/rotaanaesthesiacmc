from __future__ import annotations


def normalize_call_level(value: str | None) -> str:
    if not value:
        return "Unassigned"
    normalized = value.upper().replace("-", "_").replace(" ", "_")
    if "1ST_CALL" in normalized or "1ST" in normalized:
        return "1ST_CALL"
    if "2ND_CALL" in normalized or "2ND" in normalized:
        return "2ND_CALL"
    if "3RD_CALL" in normalized or "3RD" in normalized or normalized == "DM_PDF":
        return "3RD_CALL"
    if "CO_4TH" in normalized or "CO4TH" in normalized:
        return "CO_4TH_CALL"
    if "4TH_CALL" in normalized or "4TH" in normalized:
        return "4TH_CALL"
    if "5TH_CALL" in normalized or "5TH" in normalized:
        return "5TH_CALL"
    return value


def inferred_call_levels_from_duty_type(duty_type: str | None) -> set[str]:
    if not duty_type:
        return set()
    normalized = duty_type.upper().replace("-", "_").replace(" ", "_")
    if "1ST" in normalized:
        return {"1ST_CALL"}
    if "2ND" in normalized:
        return {"2ND_CALL"}
    if "CO3RD" in normalized or "CO_3RD" in normalized or "3RD" in normalized:
        return {"3RD_CALL"}
    if "CO4TH" in normalized or "CO_4TH" in normalized:
        return {"CO_4TH_CALL"}
    if "4TH" in normalized:
        return {"4TH_CALL"}
    if "5TH" in normalized or "FIFTH" in normalized:
        return {"5TH_CALL"}
    return set()
