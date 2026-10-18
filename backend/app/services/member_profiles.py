from datetime import date, datetime, timedelta, timezone
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session, object_session

from app.models import Person, PersonCallChange

CALL_LEVELS = {"1ST_CALL", "2ND_CALL", "3RD_CALL", "CO_4TH_CALL", "4TH_CALL", "5TH_CALL"}


def local_today():
    return datetime.now(timezone(timedelta(hours=5, minutes=30))).date()


def call_level_on(person: Person, day: date | None = None):
    db = object_session(person)
    if db is None:
        return person.call_level
    day = day or local_today()
    with db.no_autoflush:
        changes = sorted(
            (change for change in person.call_changes if not change.source.startswith("merged:")),
            key=lambda change: (change.effective_from, change.created_at, str(change.id)),
        )
    # A workspace schedule may precede the first HOD event; its baseline remains
    # the stored default, rather than the level immediately before that later event.
    earlier_schedule = changes and any(c.effective_from <= changes[0].effective_from
                                       for c in person.call_level_changes)
    baseline = changes[0].from_call_level if changes and not earlier_schedule else person.call_level
    candidates = [(change.effective_from, 0, change.to_call_level) for change in changes
                  if change.effective_from <= day]
    candidates.extend((change.effective_from, 1, change.call_level)
                      for change in person.call_level_changes if change.effective_from <= day)
    return max(candidates, key=lambda item: (item[0], item[1]))[2] if candidates else baseline



def record_call_change(
    db: Session,
    person: Person,
    new_level: str | None,
    effective_from: date,
    reason: str,
    source: str = "profile",
    actor_id: UUID | None = None,
):
    # Share the normalization/import edit lock before locking the person row.
    from app.services.reference_registry import lock_namespace
    lock_namespace(db, "normalization-edit")
    db.scalar(select(Person).where(Person.id == person.id).with_for_update())
    db.expire(person, ["call_changes"])
    latest = db.scalar(
        select(PersonCallChange)
        .where(
            PersonCallChange.person_id == person.id, ~PersonCallChange.source.startswith("merged:")
        )
        .order_by(PersonCallChange.effective_from.desc(), PersonCallChange.created_at.desc())
        .limit(1)
    )
    if latest and effective_from < latest.effective_from:
        raise ValueError(
            "A later call change is already recorded. Add changes in effective-date order; review the later entry first."
        )
    previous = call_level_on(person, effective_from)
    if previous == new_level and latest:
        raise ValueError("The selected call level is already effective on this date.")
    person.call_changes.append(
        PersonCallChange(
            person_id=person.id,
            from_call_level=previous,
            to_call_level=new_level,
            effective_from=effective_from,
            reason=reason.strip(),
            source=source,
            actor_id=actor_id,
        )
    )
    db.flush()
    # Workspace schedules use this field as their unchanged baseline.
    if not person.call_level_changes:
        person.call_level = call_level_on(person, local_today())


def sync_current_call_levels(db: Session):
    for person in db.scalars(select(Person)):
        if not person.call_level_changes:
            person.call_level = call_level_on(person)
    db.flush()
