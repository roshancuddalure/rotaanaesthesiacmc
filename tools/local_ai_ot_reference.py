"""Strict bounded OT demand projection; supplied hashes are not authentication."""

from datetime import date, datetime, timedelta
import re
from uuid import UUID

LEVELS = {"1ST_CALL", "2ND_CALL", "3RD_CALL", "4TH_CALL", "CO_4TH_CALL", "5TH_CALL"}


def count(value, maximum=2147483647):
    return type(value) is int and 0 <= value <= maximum


def selected_ot_reference(value, month):
    if not isinstance(value, dict) or set(value) != {"content", "calendar_revision"}:
        raise ValueError("Unsupported selected OT reference")
    revision = value["calendar_revision"]
    if not isinstance(revision, str) or not re.fullmatch(r"[a-f0-9]{64}", revision):
        raise ValueError("Invalid OT calendar revision")
    content = value["content"]
    fields = {"unit_id", "day", "calendar_status", "demand_known", "reserve_mode", "bands", "closed_area_count", "missing_area_count"}
    if not isinstance(content, dict) or set(content) != fields:
        raise ValueError("Unsupported OT demand fields")
    if not isinstance(content["unit_id"], str) or str(UUID(content["unit_id"])) != content["unit_id"]:
        raise ValueError("Invalid OT unit identity")
    day = date.fromisoformat(content["day"])
    if day.isoformat() != content["day"] or day.strftime("%Y-%m") != month:
        raise ValueError("OT date does not match the reference month")
    status = content["calendar_status"]
    if not isinstance(status, str) or status not in {"configured", "partially_configured", "not_evaluated"}:
        raise ValueError("Invalid OT calendar status")
    if type(content["demand_known"]) is not bool or content["demand_known"] != (status == "configured"):
        raise ValueError("Unknown OT demand cannot be labeled complete")
    mode = content["reserve_mode"]
    if mode is not None and (not isinstance(mode, str) or mode not in {"included", "additional"}):
        raise ValueError("Invalid reserve interpretation")
    if not all(count(content[key]) for key in ("closed_area_count", "missing_area_count")):
        raise ValueError("Invalid OT area counts")
    bands = content["bands"]
    if not isinstance(bands, list) or len(bands) > 12:
        raise ValueError("Selected OT demand exceeds the bounded model context")
    for index, band in enumerate(bands):
        if not isinstance(band, dict) or set(band) != {"band_index", "starts_at", "ends_at", "call_levels", "minimum", "target", "required_skill_count"}:
            raise ValueError("Unsupported OT band fields")
        if type(band["band_index"]) is not int or band["band_index"] != index:
            raise ValueError("Invalid OT band sequence")
        for key in ("starts_at", "ends_at"):
            if not isinstance(band[key], str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}", band[key]):
                raise ValueError("Unsupported OT interval")
        start, end = datetime.fromisoformat(band["starts_at"]), datetime.fromisoformat(band["ends_at"])
        if start.date() != day or not timedelta(0) < end-start <= timedelta(hours=48):
            raise ValueError("OT interval is outside the selected day scope")
        levels = band["call_levels"]
        if not isinstance(levels, list) or not 1 <= len(levels) <= 6 or not all(isinstance(level, str) and level in LEVELS for level in levels) or len(set(levels)) != len(levels):
            raise ValueError("Unsupported OT call pool")
        if not count(band["minimum"], 128) or not count(band["target"], 128) or band["target"] < band["minimum"] or not count(band["required_skill_count"], 64):
            raise ValueError("Invalid OT demand counts")
    # Round-trip only the recognized typed data; caller verifies its exact digest.
    return {"content": dict(content), "calendar_revision": revision}
