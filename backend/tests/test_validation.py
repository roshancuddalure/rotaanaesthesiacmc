from datetime import datetime, timedelta

from app.domain.validation import DutyWindow, validate_24hr_spacing


def test_24hr_spacing_blocks_close_24hr_duties() -> None:
    existing = DutyWindow(
        person_id="p1",
        duty_type="MAIN_1ST_24HR",
        starts_at=datetime(2026, 5, 1, 8),
        ends_at=datetime(2026, 5, 2, 8),
        is_24hr=True,
    )
    candidate = DutyWindow(
        person_id="p1",
        duty_type="RC_1ST_A_24HR",
        starts_at=datetime(2026, 5, 3, 7),
        ends_at=datetime(2026, 5, 4, 7),
        is_24hr=True,
    )

    issues = validate_24hr_spacing(candidate, [existing])

    assert len(issues) == 1
    assert issues[0].code == "24HR_DUTY_SPACING"


def test_24hr_spacing_allows_24_hour_gap() -> None:
    existing = DutyWindow(
        person_id="p1",
        duty_type="MAIN_1ST_24HR",
        starts_at=datetime(2026, 5, 1, 8),
        ends_at=datetime(2026, 5, 2, 8),
        is_24hr=True,
    )
    candidate = DutyWindow(
        person_id="p1",
        duty_type="RC_1ST_A_24HR",
        starts_at=existing.ends_at + timedelta(hours=24),
        ends_at=existing.ends_at + timedelta(hours=48),
        is_24hr=True,
    )

    assert validate_24hr_spacing(candidate, [existing]) == []

