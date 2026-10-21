"""Guarded entry point for voiding extra-duty ledger records (docs/extra_duty_contract.md §2).

Callers that clear, delete, replace or revert assignments call ``void_extra_duty_records``
inside their own transaction (no commit here). The real work is
``app.services.extra_duty.void_records_for_assignments``; it is imported lazily so a missing
or broken extra-duty module never breaks the caller's main operation (it is logged instead).
"""

from __future__ import annotations

import logging
from collections.abc import Iterable
from uuid import UUID

logger = logging.getLogger(__name__)


def void_extra_duty_records(db, assignment_ids: Iterable[UUID | str], reason: str) -> int:
    ids = [UUID(str(item)) for item in assignment_ids if item is not None]
    if not ids:
        return 0
    try:
        from app.services.extra_duty import void_records_for_assignments
    except Exception:  # pragma: no cover - only while the service module is missing
        logger.exception("Extra-duty ledger voiding unavailable; %d assignment(s) not checked", len(ids))
        return 0
    return void_records_for_assignments(db, ids, reason)
