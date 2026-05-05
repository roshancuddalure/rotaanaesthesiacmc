from datetime import datetime, timedelta
from pydantic import BaseModel


class DutyWindow(BaseModel):
    person_id: str
    duty_type: str
    starts_at: datetime
    ends_at: datetime
    is_24hr: bool


class ValidationIssue(BaseModel):
    severity: str
    code: str
    message: str


def validate_24hr_spacing(candidate: DutyWindow, existing: list[DutyWindow]) -> list[ValidationIssue]:
    if not candidate.is_24hr:
        return []

    issues: list[ValidationIssue] = []
    minimum_gap = timedelta(hours=24)

    for duty in existing:
        if duty.person_id != candidate.person_id or not duty.is_24hr:
            continue

        gap_before = candidate.starts_at - duty.ends_at
        gap_after = duty.starts_at - candidate.ends_at
        has_enough_gap = gap_before >= minimum_gap or gap_after >= minimum_gap

        if not has_enough_gap:
            issues.append(
                ValidationIssue(
                    severity="error",
                    code="24HR_DUTY_SPACING",
                    message="At least 24 hours must separate two 24-hour duties.",
                )
            )

    return issues

