"""Configured monthly unit boundaries for prospective ordinary and extra duties."""

from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.models import MonthlyGenerationScope


def locked_unit_ids(db, period_id, context=None):
    cache = getattr(context, "allocation_scope_cache", None) if context is not None else None
    if cache is not None and period_id in cache:
        return cache[period_id]
    scope = db.scalar(select(MonthlyGenerationScope).where(
        MonthlyGenerationScope.rota_period_id == period_id).options(selectinload(MonthlyGenerationScope.units)))
    # Unlocking an already configured month must not grant eligibility to its
    # excluded units. Legacy periods without a configured scope retain None.
    result = (frozenset(row.unit_id for row in scope.units if row.status == "included")
              if scope and (scope.is_locked or scope.units) else None)
    if context is not None:
        if cache is None:
            cache = {}
            context.allocation_scope_cache = cache
        cache[period_id] = result
    return result
