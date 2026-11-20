"""Immutable OT-demand contracts and deterministic weekly/date resolution.

These are planning inputs, not operational assignments. Times are explicit hospital
local wall times, matching existing duty storage. Missing configuration is unknown;
only an explicit closure or zero-count band means reviewed zero demand.
"""

from datetime import date, datetime, time, timedelta
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

WEEKDAYS = ("MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN")
CallLevel = Literal["1ST_CALL", "2ND_CALL", "3RD_CALL", "4TH_CALL", "CO_4TH_CALL", "5TH_CALL"]
Weekday = Literal["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"]


def explicit_calendar_date(value):
    if value is None or type(value) is date:
        return value
    if isinstance(value, str) and len(value) == 10:
        try:
            if date.fromisoformat(value).isoformat() == value:
                return value
        except ValueError:
            pass
    raise ValueError("Use an explicit YYYY-MM-DD calendar date; timestamps are not calendar dates")


class ImmutableInput(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid", strict=True)


class OtBand(ImmutableInput):
    """One staffing role within an area; different roles may overlap in time."""

    key: str = Field(min_length=1, max_length=80, pattern=r"^[a-zA-Z0-9_-]+$")
    start_minute: int = Field(ge=0, lt=1440)
    end_minute: int = Field(gt=0, le=2880)
    call_levels: tuple[CallLevel, ...] = Field(min_length=1, max_length=6, strict=False)
    minimum: int = Field(ge=0, le=128)
    target: int = Field(ge=0, le=128)
    required_skills: tuple[str, ...] = Field(default=(), max_length=64, strict=False)

    @model_validator(mode="after")
    def validate_band(self):
        if not 0 < self.end_minute - self.start_minute <= 1440:
            raise ValueError("OT band must last between one minute and 24 hours")
        if self.target < self.minimum:
            raise ValueError("OT target cannot be below the mandatory minimum")
        if len(set(self.call_levels)) != len(self.call_levels):
            raise ValueError("Call-level pool must contain distinct levels")
        if len(set(self.required_skills)) != len(self.required_skills) or any(
            not skill.strip() or len(skill) > 80 for skill in self.required_skills
        ):
            raise ValueError("Skills must be distinct nonempty keys up to 80 characters")
        return self


def validate_bands(bands):
    if len({band.key for band in bands}) != len(bands):
        raise ValueError("Each area's staffing role key must be unique")


class WeeklyOtDemand(ImmutableInput):
    id: UUID = Field(strict=False)
    unit_id: UUID = Field(strict=False)
    area_key: str = Field(min_length=1, max_length=80, pattern=r"^[a-zA-Z0-9_-]+$")
    weekday: Weekday
    effective_from: date = Field(strict=False)
    effective_to: date | None = Field(default=None, strict=False)
    bands: tuple[OtBand, ...] = Field(min_length=1, max_length=64, strict=False)
    source_reference: str = Field(default="admin", min_length=1, max_length=255)

    @field_validator("effective_from", "effective_to", mode="before")
    @classmethod
    def explicit_dates(cls, value):
        return explicit_calendar_date(value)

    @model_validator(mode="after")
    def validate_record(self):
        if self.effective_to and self.effective_to < self.effective_from:
            raise ValueError("Effective end precedes effective start")
        validate_bands(self.bands)
        return self


class OtDateException(ImmutableInput):
    id: UUID = Field(strict=False)
    unit_id: UUID = Field(strict=False)
    area_key: str = Field(min_length=1, max_length=80, pattern=r"^[a-zA-Z0-9_-]+$")
    day: date = Field(strict=False)
    closed: bool = False
    bands: tuple[OtBand, ...] = Field(default=(), max_length=64, strict=False)
    source_reference: str = Field(default="admin", min_length=1, max_length=255)

    @field_validator("day", mode="before")
    @classmethod
    def explicit_day(cls, value):
        return explicit_calendar_date(value)

    @model_validator(mode="after")
    def validate_exception(self):
        if self.closed == bool(self.bands):
            raise ValueError("An exception must either close the area or provide replacement bands")
        validate_bands(self.bands)
        return self


class OtRequirement(ImmutableInput):
    id: str
    unit_id: UUID
    area_key: str
    band_key: str
    starts_at: datetime
    ends_at: datetime
    call_levels: tuple[CallLevel, ...]
    required_skills: tuple[str, ...] = ()
    minimum: int = Field(ge=0, le=128)
    target: int = Field(ge=0, le=128)
    source_reference: str = "admin"

    @model_validator(mode="after")
    def validate_requirement(self):
        if self.starts_at.tzinfo or self.ends_at.tzinfo:
            raise ValueError("Use hospital-local wall times consistently with duty storage")
        if not timedelta(0) < self.ends_at - self.starts_at <= timedelta(days=1):
            raise ValueError("OT requirement must last between one minute and 24 hours")
        if self.target < self.minimum or not self.call_levels:
            raise ValueError("OT target must cover its minimum and have an explicit call pool")
        return self


def validate_calendar(weekly, exceptions):
    if len(weekly) > 10000 or len(exceptions) > 10000:
        raise ValueError("OT calendar exceeds supported record count")
    ids = [row.id for row in (*weekly, *exceptions)]
    if len(set(ids)) != len(ids):
        raise ValueError("OT records must have distinct identifiers")
    seen = set()
    for row in exceptions:
        key = (row.unit_id, row.area_key, row.day)
        if key in seen:
            raise ValueError("Conflicting date exceptions for the same unit/area/day")
        seen.add(key)
    groups = {}
    for row in weekly:
        groups.setdefault((row.unit_id, row.area_key, row.weekday), []).append(row)
    for rows in groups.values():
        ordered = sorted(rows, key=lambda row: row.effective_from)
        for previous, current in zip(ordered, ordered[1:]):
            if (previous.effective_to or date.max) >= current.effective_from:
                raise ValueError("Overlapping weekly definitions for the same unit/area/weekday")


def resolve_day(weekly, exceptions, *, day: date, unit_id: UUID):
    """A dated area exception replaces all recurring bands for that area/day.

    No automatic holiday closure is inferred. Administrators record a dated closure
    or replacement explicitly. Return unknown when this unit/day has no definition.
    """
    validate_calendar(weekly, exceptions)
    recurring = {
        row.area_key: row
        for row in weekly
        if row.unit_id == unit_id and row.weekday == WEEKDAYS[day.weekday()]
        and row.effective_from <= day <= (row.effective_to or date.max)
    }
    dated = {row.area_key: row for row in exceptions if row.unit_id == unit_id and row.day == day}
    areas = sorted(recurring.keys() | dated.keys())
    expected_areas = {row.area_key for row in weekly if row.unit_id == unit_id
                      and row.effective_from <= day <= (row.effective_to or date.max)} | dated.keys()
    missing_areas = sorted(expected_areas - set(areas))
    requirements = []
    closed_areas = []
    for area in areas:
        row = dated.get(area) or recurring[area]
        if isinstance(row, OtDateException) and row.closed:
            closed_areas.append(area)
            continue
        for band in row.bands:
            midnight = datetime.combine(day, time.min)
            requirements.append(OtRequirement(
                id=f"{row.id}:{day}:{band.key}", unit_id=unit_id, area_key=area,
                band_key=band.key, starts_at=midnight + timedelta(minutes=band.start_minute),
                ends_at=midnight + timedelta(minutes=band.end_minute),
                call_levels=band.call_levels, required_skills=band.required_skills,
                minimum=band.minimum, target=band.target, source_reference=row.source_reference,
            ))
    return {
        "day": day, "unit_id": unit_id, "configured": bool(areas) and not missing_areas,
        "status": "partially_configured" if areas and missing_areas else "configured" if areas else "not_evaluated",
        "requirements": tuple(sorted(requirements, key=lambda row: (row.starts_at, row.area_key, row.band_key))),
        "closed_areas": tuple(closed_areas), "missing_areas": tuple(missing_areas),
    }
