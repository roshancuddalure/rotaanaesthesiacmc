"""Deterministic reservation witness checks, independent of CP variables/objectives."""

from datetime import datetime


def qualifies(person, requirement, start, end):
    if any(block.starts_at < end and block.ends_at > start for block in person.blocked):
        return False
    if person.windowed:
        spans = [(span.starts_at, span.ends_at) for span in person.windows
                 if span.unit_id == requirement.unit_id and span.call_level in requirement.call_levels
                 and all(skill in span.skills for skill in requirement.required_skills)]
    else:
        if requirement.unit_id not in person.unit_ids or person.call_level not in requirement.call_levels \
                or not all(skill in person.skills for skill in requirement.required_skills):
            return False
        spans = [(span.starts_at, span.ends_at) for span in person.available]
    cursor = start
    for left, right in sorted(spans):
        if right <= cursor:
            continue
        if left > cursor:
            return False
        cursor = right
        if cursor >= end:
            return True
    return False


def verify_witness(requirements, people, reserves, report):
    failures, bookings = [], {}
    roster = {str(person.id): person for person in people}
    required = {row.id: row for row in requirements}
    reserve_map = {row.id: row for row in reserves}
    seen = set()

    def record(identities, requirement, start, end, kind, mode=None):
        if len(set(identities)) != len(identities):
            failures.append("A witness repeats a person within one staffing count")
        for identity in identities:
            person = roster.get(identity)
            if person is None or not qualifies(person, requirement, start, end):
                failures.append("Witness includes an unknown or unavailable/ineligible person")
                continue
            bookings.setdefault(identity, []).append((start, end, requirement.unit_id, kind, mode))

    for row in report.get("requirements", []):
        requirement = required.get(row.get("id"))
        if requirement is None or requirement.id in seen:
            failures.append("Unknown or repeated OT requirement")
            continue
        seen.add(requirement.id)
        matched = row.get("matched_person_ids", [])
        if row.get("unit_id") != str(requirement.unit_id) or row.get("minimum") != requirement.minimum \
                or row.get("target") != requirement.target:
            failures.append("OT metadata differs from the input")
        if len(matched) > requirement.target or row.get("minimum_shortage") != max(0, requirement.minimum - len(matched)):
            failures.append("OT count/shortage does not match its witness")
        if row.get("target_shortage") != max(0, requirement.target - len(matched)):
            failures.append("OT target shortage does not match its witness")
        record(matched, requirement, requirement.starts_at, requirement.ends_at, "ot")
    if seen != set(required):
        failures.append("OT witness omitted a requirement")
    seen = set()
    for row in report.get("reserves", []):
        reserve = reserve_map.get(row.get("id"))
        if reserve is None or reserve.id in seen:
            failures.append("Unknown or repeated reserve")
            continue
        seen.add(reserve.id)
        if row.get("unit_id") != str(reserve.unit_id) or row.get("mode") != reserve.mode \
                or row.get("minimum") != reserve.minimum:
            failures.append("Reserve metadata differs from the input")
        cursor, worst = reserve.starts_at, 0
        for span in row.get("intervals", []):
            try:
                start, end = datetime.fromisoformat(span["starts_at"]), datetime.fromisoformat(span["ends_at"])
            except (KeyError, ValueError, TypeError):
                failures.append("Invalid reserve interval")
                continue
            if start != cursor or end <= start or end > reserve.ends_at:
                failures.append("Reserve witness has a gap, overlap or out-of-range interval")
            cursor = end
            matched = span.get("matched_person_ids", [])
            if len(matched) > reserve.minimum:
                failures.append("Reserve witness exceeds its count")
            worst = max(worst, max(0, reserve.minimum - len(matched)))
            record(matched, reserve, start, end, "reserve", reserve.mode)
        if cursor != reserve.ends_at or row.get("minimum_shortage") != worst:
            failures.append("Incomplete reserve interval/shortage evidence")
    if seen != set(reserve_map):
        failures.append("Reserve witness omitted a constraint")
    for rows in bookings.values():
        ordered = sorted(rows)
        for index, left in enumerate(ordered):
            for right in ordered[index + 1:]:
                if right[0] >= left[1]:
                    break
                if left[2] != right[2] or (left[3] == right[3] == "ot") \
                        or (left[3] != right[3] and "additional" in (left[4], right[4])):
                    failures.append("One person was reused in incompatible simultaneous reservations")
    # These checks concern feasibility, not optimization/target optimality.
    if report.get("mandatory_required") != sum(row.minimum for row in requirements):
        failures.append("Reported mandatory demand differs from input")
    actual_coverage = sum(min(required[row["id"]].minimum, len(row.get("matched_person_ids", [])))
                          for row in report.get("requirements", []) if row.get("id") in required)
    if report.get("mandatory_covered") != actual_coverage:
        failures.append("Reported coverage differs from the witness")
    if report.get("target_covered") != sum(len(row.get("matched_person_ids", []))
                                          for row in report.get("requirements", [])):
        failures.append("Reported target coverage differs from the witness")
    if report.get("status") == "feasible" and (actual_coverage < sum(row.minimum for row in requirements)
            or any(row.get("minimum_shortage", 0) for row in report.get("reserves", []))):
        failures.append("Feasibility was claimed despite a mandatory shortage")
    return failures
