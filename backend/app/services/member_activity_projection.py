"""Public profile projection; durable audit payloads retain their original data."""

from app.services.leave_history import snapshot


def profile_activity_details(action, details):
    if not action.startswith("leave_"):
        return details
    if not isinstance(details, dict):
        return {}
    projected = {}
    for key in ("before", "after"):
        if key in details:
            projected[key] = snapshot(details[key])
    for key in ("record_id", "batch_id", "parent_leave_id", "month", "reason", "starts_on", "ends_on"):
        value = details.get(key)
        if isinstance(value, str):
            projected[key] = value
    source = details.get("source")
    if isinstance(source, dict):
        projected["source"] = {key: source[key] for key in ("sheet", "row")
                               if isinstance(source.get(key), (str, int))}
    return projected
