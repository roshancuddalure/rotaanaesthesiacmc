from datetime import datetime

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.v1.auth import require_admin
from app.db.session import get_db
from app.models import (
    AdminMapping,
    DutyAssignment,
    DutySlot,
    ImportBatch,
    ImportWarning,
    Person,
    PersonDesignation,
    PersonPosting,
    RotaPeriod,
    Unit,
    UserAccount,
)
from app.services.imports import IGNORED_PERSON_VALUES, NON_PERSON_LABELS, is_valid_person_name

router = APIRouter()


class DiagnosticsSummary(BaseModel):
    generated_at: datetime
    database_counts: dict[str, int]
    mapping_status: dict[str, int]
    import_warnings: dict[str, int]
    rota_period_status: dict[str, int]
    invalid_member_names: int
    auth_accounts_by_role: dict[str, int]
    invalid_name_rules: list[str]


def scalar_count(db: Session, model: type) -> int:
    return db.scalar(select(func.count()).select_from(model)) or 0


def grouped_counts(db: Session, model: type, column_name: str) -> dict[str, int]:
    column = getattr(model, column_name)
    rows = db.execute(select(column, func.count()).group_by(column)).all()
    return {str(key): int(count) for key, count in rows}


@router.get("/diagnostics/summary")
def diagnostics_summary(
    _admin: UserAccount = Depends(require_admin),
    db: Session = Depends(get_db),
) -> DiagnosticsSummary:
    people = db.scalars(select(Person.canonical_name)).all()
    return DiagnosticsSummary(
        generated_at=datetime.utcnow(),
        database_counts={
            "people": scalar_count(db, Person),
            "person_designations": scalar_count(db, PersonDesignation),
            "units": scalar_count(db, Unit),
            "rota_periods": scalar_count(db, RotaPeriod),
            "duty_slots": scalar_count(db, DutySlot),
            "duty_assignments": scalar_count(db, DutyAssignment),
            "postings": scalar_count(db, PersonPosting),
            "import_batches": scalar_count(db, ImportBatch),
            "import_warnings": scalar_count(db, ImportWarning),
            "admin_mappings": scalar_count(db, AdminMapping),
            "user_accounts": scalar_count(db, UserAccount),
        },
        mapping_status=grouped_counts(db, AdminMapping, "status"),
        import_warnings=grouped_counts(db, ImportWarning, "severity"),
        rota_period_status=grouped_counts(db, RotaPeriod, "status"),
        invalid_member_names=sum(1 for name in people if not is_valid_person_name(name)),
        auth_accounts_by_role=grouped_counts(db, UserAccount, "role"),
        invalid_name_rules=sorted({*IGNORED_PERSON_VALUES, *NON_PERSON_LABELS}),
    )
