"""Serialize final scheduling inputs and refresh clean ORM state under that lock."""

from sqlalchemy import inspect, text

from app.core.config import settings
from app.db.session import Base


INPUT_TABLES = (
    "persons", "person_aliases", "person_designations", "member_call_level_changes",
    "person_call_changes", "units", "unit_call_minimums", "admin_mappings",
    "reference_values", "person_postings", "leave_requests", "duty_slots",
    "duty_assignments", "rule_versions", "rule_settings", "call_clusters",
    "person_call_cluster_memberships", "rota_periods", "monthly_generation_scopes",
    "monthly_generation_scope_units",
    "rota_learning_versions",
    "unit_fallbacks", "extra_duty_records", "extra_duty_batches",
)


def lock_inputs(db):
    """Serialize scheduling evidence and reload clean cached inputs for every mode.

    Do not expire_all: pending caller attributes/relationships must be preserved.
    Primary identities stay stable; all other clean mapped input attributes,
    including loaded collections, expire so later reads see the locked database.
    This never flushes, commits or rolls back the caller's transaction.
    """
    names = (*INPUT_TABLES, "ot_calendars") if settings.ot_calendar_enabled else INPUT_TABLES
    tables = sorted(name for name in names if name in Base.metadata.tables)
    with db.no_autoflush:
        bind = db.get_bind()
        if bind.dialect.name == "postgresql":
            schema = bind.get_execution_options().get("schema_translate_map", {}).get(None)
            quote = bind.dialect.identifier_preparer.quote
            prefix = quote(schema) + "." if schema else ""
            db.execute(text("LOCK TABLE " + ", ".join(prefix + quote(name) for name in tables)
                            + " IN SHARE ROW EXCLUSIVE MODE"))
        # Bootstrap helpers must not commit away a transaction that acquired
        # input locks, even after a rolled-back preview savepoint. This marker
        # controls commit ownership only; it is never proof a lock is held.
        db.connection()
        db.info["scheduling_input_transaction"] = db.get_transaction()
        for instance in tuple(db.identity_map.values()):
            state = inspect(instance)
            if not state.persistent or state.deleted or state.mapper.local_table.name not in tables:
                continue
            identities = {state.mapper.get_property_by_column(column).key for column in state.mapper.primary_key}
            clean = [attribute.key for attribute in state.mapper.attrs
                     if attribute.key not in identities and not state.attrs[attribute.key].history.has_changes()]
            if clean:
                db.expire(instance, clean)


def finish_bootstrap(db):
    """Preserve scheduling transaction ownership during first-use rule creation."""
    transaction = db.info.get("scheduling_input_transaction")
    if transaction is not None and transaction is db.get_transaction() and transaction.is_active:
        db.flush()
    else:
        db.commit()
