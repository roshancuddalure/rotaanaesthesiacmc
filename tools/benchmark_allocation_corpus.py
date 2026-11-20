"""Current allocation corpus. Synthetic SQLite only; never opens operational DBs."""

# ruff: noqa: E402
import argparse
from collections import Counter
from contextlib import contextmanager
from datetime import date, datetime, timezone
import hashlib
import json
from pathlib import Path
import platform
import subprocess
import sys
from time import perf_counter
from uuid import UUID, uuid5, NAMESPACE_URL

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
from sqlalchemy import create_engine, event, select
from sqlalchemy.orm import Session
from app.core.config import settings
from app.db.session import Base
from app.models import (
    DutyAssignment,
    LeaveRequest,
    OtCalendar,
    Person,
    PersonPosting,
    CallCluster,
    PersonCallClusterMembership,
    RotaComputeJob,
    Unit,
    UserAccount,
)
from app.services import (
    rota_optimizer as optimizer,
    rota_compute as compute,
    rota_intelligence as intelligence,
)
from app.services.ot_calendar_store import CalendarConfiguration, canonical, revision
from app.services.rota_candidates import candidate_context
from app.services.rota_candidates import add_provisional_assignment
from app.services.scheduling_snapshot import capture
from benchmark_rota_compute import seed

MONTH = "2026-05"
CASES = ("control", "ot_zero", "ot_pressure", "dated_fixed", "saved_proposal")


class Measurements:
    def __init__(self, engine):
        self.queries, self.sql_seconds, self.started = 0, 0.0, []
        self.stages = {}
        event.listen(engine, "before_cursor_execute", self.before)
        event.listen(engine, "after_cursor_execute", self.after)

    def before(self, *args):
        self.queries += 1
        self.started.append(perf_counter())

    def after(self, *args):
        self.sql_seconds += perf_counter() - self.started.pop()

    @contextmanager
    def stage(self, name):
        began, sql, count = perf_counter(), self.sql_seconds, self.queries
        try:
            yield
        finally:
            self.stages[name] = {
                "wall_ms": round((perf_counter() - began) * 1000, 3),
                "sql_ms": round((self.sql_seconds - sql) * 1000, 3),
                "sql_queries": self.queries - count,
            }


def deterministic_id(label):
    return str(uuid5(NAMESPACE_URL, "duty-rota-synthetic-corpus-v1:" + label))


def configure(db, case, members, slot_count):
    seed(db, members, slot_count)
    # The reviewed horizon includes the prior day. Normal comparisons need
    # actual staff there; the retained v1 run documents the missing-boundary case.
    for posting in db.scalars(select(PersonPosting)):
        posting.starts_on = date(2026, 4, 1)
    people = list(db.scalars(select(Person).order_by(Person.canonical_name)))
    units = list(db.scalars(select(Unit).order_by(Unit.code)))
    all_slots = sorted(
        compute.open_slots_for_period(db, compute.monthly_setup(db, MONTH)[0].id),
        key=lambda row: row.slot_label,
    )
    if case not in {"control", "saved_proposal"}:
        group = CallCluster(
            key="corpus_ot_skill",
            name="Synthetic elective skill",
            call_level="1ST_CALL",
            active=True,
        )
        db.add(group)
        db.flush()
        for person in people[:8]:
            db.add(
                PersonCallClusterMembership(
                    person=person, cluster=group, effective_from=date(2026, 4, 1)
                )
            )
        for index, unit in enumerate(units):
            value = canonical(
                CalendarConfiguration.model_validate(
                    {
                        "reserve_mode": "included",
                        "qualification_bindings": [
                            {"skill_key": "elective", "group_keys": [group.key]}
                        ],
                        "weekly": [
                            {
                                "id": deterministic_id(f"{unit.code}:{weekday}"),
                                "unit_id": str(unit.id),
                                "area_key": "theatre",
                                "weekday": weekday,
                                "effective_from": "2026-04-01",
                                "bands": [
                                    {
                                        "key": "first",
                                        "start_minute": 480,
                                        "end_minute": 1020,
                                        "call_levels": ["1ST_CALL"],
                                        "required_skills": ["elective"]
                                        if case != "ot_zero"
                                        else [],
                                        "minimum": 2
                                        if index == 0
                                        and weekday == "THU"
                                        and case != "ot_zero"
                                        else 0,
                                        "target": 2
                                        if index == 0
                                        and weekday == "THU"
                                        and case != "ot_zero"
                                        else 0,
                                    }
                                ],
                            }
                            for weekday in (
                                "MON",
                                "TUE",
                                "WED",
                                "THU",
                                "FRI",
                                "SAT",
                                "SUN",
                            )
                        ],
                    }
                )
            )
            db.add(
                OtCalendar(
                    unit_id=unit.id, configuration=value, revision=revision(value)
                )
            )
    if case == "dated_fixed":
        db.add(
            LeaveRequest(
                person=people[0],
                starts_on=date(2026, 5, 1),
                ends_on=date(2026, 5, 10),
                status="approved",
                leave_type="ANNUAL_LEAVE",
                leave_slot="FULL_DAY",
            )
        )
        db.add(
            LeaveRequest(
                person=people[2],
                starts_on=date(2026, 5, 14),
                ends_on=date(2026, 5, 14),
                status="requested",
                leave_type="CASUAL_LEAVE",
                leave_slot="PM",
            )
        )
        posting = db.scalar(
            select(PersonPosting).where(PersonPosting.person_id == people[1].id)
        )
        posting.ends_on = date(2026, 5, 15)
        db.add(
            PersonPosting(
                person=people[1],
                unit=units[0],
                posting_type="1ST_CALL",
                starts_on=date(2026, 5, 16),
                source="unit_board",
            )
        )
        fixed = next(
            row
            for row in all_slots
            if row.duty_date == date(2026, 5, 5) and row.unit_id == units[0].id
        )
        db.add(DutyAssignment(person=people[8], duty_slot=fixed, status="assigned"))
    db.commit()
    return people, all_slots


def workload(people, slots, choices, fixed):
    counts = Counter(str(row.person_id) for row in fixed)
    counts.update(choices.values())
    weekends = Counter(
        str(row.person_id) for row in fixed if row.duty_slot.duty_date.weekday() >= 5
    )
    weekends.update(
        person for sid, person in choices.items() if slots[sid].duty_date.weekday() >= 5
    )
    return {
        "denominator": "Every active synthetic person, including zero new duties; fixed duties included.",
        "people": len(people),
        "zero_total_duties": sum(counts[str(row.id)] == 0 for row in people),
        "minimum_total_duties": min((counts[str(row.id)] for row in people), default=0),
        "maximum_total_duties": max(counts.values(), default=0),
        "maximum_weekends": max(weekends.values(), default=0),
        "duty_histogram": dict(
            sorted(Counter(counts[str(row.id)] for row in people).items())
        ),
        "by_person": [
            {
                "member": row.canonical_name,
                "duties": counts[str(row.id)],
                "weekends": weekends[str(row.id)],
            }
            for row in people
        ],
    }


def ot_summary(proof):
    capacity = proof.get("capacity")
    return {
        "status": proof["status"],
        "code": proof.get("code"),
        "reasons": proof.get("reasons", []),
        "mandatory_required": capacity["mandatory_required"] if capacity else None,
        "mandatory_covered": capacity["mandatory_covered"] if capacity else None,
        "reserve_shortages": [
            {
                "id": row["id"],
                "minimum_shortage": row["minimum_shortage"],
                "intervals": [
                    {
                        key: value
                        for key, value in span.items()
                        if key != "matched_person_ids"
                    }
                    for span in row.get("intervals", [])
                ],
            }
            for row in capacity.get("reserves", [])
            if row["minimum_shortage"]
        ]
        if capacity
        else [],
    }


def semantic_fixture(db, context, slots):
    people = {row.id: row.canonical_name for row in db.scalars(select(Person))}
    units = {row.id: row.code for row in db.scalars(select(Unit))}
    calendars = []
    for row in db.scalars(select(OtCalendar).order_by(OtCalendar.unit_id)):
        value = json.dumps(row.configuration, sort_keys=True)
        for identity, code in units.items():
            value = value.replace(str(identity), code)
        calendars.append((units[row.unit_id], json.loads(value)))
    data = {
        "rules": context.rules.model_dump(mode="json"),
        "people": sorted(
            (row.canonical_name, row.call_level, row.active_status)
            for row in db.scalars(select(Person))
        ),
        "postings": sorted(
            (
                people[row.person_id],
                units.get(row.unit_id),
                row.posting_type,
                str(row.starts_on),
                str(row.ends_on),
            )
            for row in db.scalars(select(PersonPosting))
        ),
        "leave": sorted(
            (
                people[row.person_id],
                str(row.starts_on),
                str(row.ends_on),
                row.leave_slot,
                row.status,
            )
            for row in db.scalars(select(LeaveRequest))
        ),
        "skills": sorted(
            (
                people[row.person_id],
                row.cluster.key,
                str(row.effective_from),
                str(row.effective_to),
            )
            for row in db.scalars(select(PersonCallClusterMembership))
        ),
        "slots": sorted(
            (
                row.slot_label,
                units.get(row.unit_id),
                str(row.duty_date),
                str(row.starts_at),
                str(row.ends_at),
                row.call_level,
            )
            for row in slots
        ),
        "fixed": sorted(
            (people[row.person_id], row.duty_slot.slot_label, row.status)
            for row in db.scalars(select(DutyAssignment))
        ),
        "calendars": sorted(calendars),
    }
    return hashlib.sha256(json.dumps(data, sort_keys=True).encode()).hexdigest()


def run_case(case, members, slot_count, seconds):
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    measured = Measurements(engine)
    flags = {
        name: getattr(settings, name)
        for name in (
            "ot_calendar_enabled",
            "rota_compute_enabled",
            "rota_intelligence_enabled",
        )
    }
    settings.ot_calendar_enabled = case not in {"control", "saved_proposal"}
    settings.rota_compute_enabled = settings.rota_intelligence_enabled = True
    report = {
        "case": case,
        "ot_enabled": settings.ot_calendar_enabled,
        "status": "running",
        "stages": measured.stages,
    }
    try:
        with Session(engine) as db:
            with measured.stage("fixture_setup"):
                people, all_slots = configure(db, case, members, slot_count)
            fixed = list(db.scalars(select(DutyAssignment)))
            fixed_before = [
                (str(row.id), str(row.person_id), str(row.duty_slot_id), row.status)
                for row in fixed
            ]
            slots = {
                str(row.id): row
                for row in all_slots
                if not compute.active_slot_assignments(row)
            }
            with measured.stage("context"):
                context = candidate_context(db, MONTH)
            report["context_timings_at_load"] = dict(context.timings)
            report["semantic_fixture_digest"] = semantic_fixture(db, context, all_slots)
            with measured.stage("baseline_joint_ot_evidence"):
                report["ot_before"] = (
                    ot_summary(
                        context.ot_guard.check(context.assignments, context.rules)
                    )
                    if context.ot_guard
                    else {"status": "disabled"}
                )
            if case == "saved_proposal":
                user = UserAccount(
                    username="corpus-admin",
                    display_name="Synthetic corpus operator",
                    role="computer_admin",
                    password_hash="synthetic",
                )
                db.add(user)
                db.commit()
                with measured.stage("proposal_start"):
                    saved = intelligence.start(
                        db,
                        MONTH,
                        user,
                        {
                            "mode": "balanced",
                            "engine": "server",
                            "seconds": seconds,
                            "repair_slots": [],
                            "locked_slots": [],
                            "preferences": [],
                        },
                    )
                    job_id = UUID(saved["id"])
                with measured.stage("proposal_generate"):
                    job = db.get(RotaComputeJob, job_id)
                    intelligence.advance(db, job, job.revision)
                db.expire_all()
                with measured.stage("proposal_reload_validate"):
                    job = compute.owned_job(db, job_id, user)
                    validation = compute.apply_job(
                        db, job, job.revision, user, dry_run=True
                    )
                    assert validation["validated"]
                result = job.state["intelligence"]["alternatives"][
                    job.state["intelligence"]["selected"]
                ]
                report["saved_proposal"] = {
                    "reloaded": True,
                    "dry_run_validated": True,
                    "status": job.status,
                    "revision": job.revision,
                    "context_digest": job.context_hash,
                    "applied": False,
                    "correction_count": None,
                    "correction_basis": "No administrator corrections supplied; zero corrections is not inferred.",
                }
            else:
                with measured.stage(
                    "optimize_including_candidates_and_internal_checks"
                ):
                    result = optimizer.solve_month(
                        db,
                        context,
                        slots,
                        seconds=seconds,
                        holiday_dates={"2026-05-01"},
                    )
            with measured.stage("independent_final_validation"):
                failures = optimizer.validate_plan(
                    db, context, slots, result["choices"]
                )
                assert not failures, failures
                assert db.query(DutyAssignment).count() == len(fixed)
                assert [
                    (str(row.id), str(row.person_id), str(row.duty_slot_id), row.status)
                    for row in db.scalars(select(DutyAssignment))
                ] == fixed_before
            with measured.stage("final_joint_ot_evidence"):
                if context.ot_guard is None:
                    report["ot_final"] = {"status": "disabled", "capacity": None}
                else:
                    final = optimizer.without_slots(context, [])
                    for sid, person_id in result["choices"].items():
                        add_provisional_assignment(final, slots[sid], UUID(person_id))
                    proof = context.ot_guard.check(final.assignments, context.rules)
                    report["ot_final"] = ot_summary(proof)
                    if report["ot_before"]["status"] == "feasible":
                        assert proof["status"] == "feasible", report["ot_final"]
            report["context_timings_after_direct_optimizer"] = (
                dict(context.timings) if case != "saved_proposal" else None
            )
            report.update(
                status=result["status"],
                assigned=len(result["choices"]),
                preserved_assignments=len(fixed),
                uncovered=len(slots) - len(result["choices"]),
                validation_failures=len(failures),
                objectives=result["objectives"],
                warnings=result["warnings"],
                cuts=result["cuts"],
                workload=workload(people, slots, result["choices"], fixed),
                snapshot_digest=capture(db).digest,
                normalized_choices=sorted(
                    (slots[sid].slot_label, context.people[UUID(person)].canonical_name)
                    for sid, person in result["choices"].items()
                ),
                uncovered_details=[
                    {
                        "slot": slot.slot_label,
                        "date": str(slot.duty_date),
                        "eligible_candidates": len(
                            result.get("candidates", {}).get(sid, {})
                        ),
                        "rejection_codes": dict(
                            Counter(
                                issue.get("code", "unknown")
                                for row in result.get("rejected", {}).get(sid, [])
                                for issue in row["issues"]
                            )
                        ),
                    }
                    for sid, slot in slots.items()
                    if sid not in result["choices"]
                ],
            )
            report["resource_limits"] = {
                "search_seconds": seconds,
                "total_request_deadline": False,
                "memory_bytes": None,
                "memory_basis": "Not measured; no invented value.",
            }
    finally:
        for name, value in flags.items():
            setattr(settings, name, value)
        engine.dispose()
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--case", action="append", choices=CASES)
    parser.add_argument("--members", type=int, default=48)
    parser.add_argument("--slots", type=int, default=62)
    parser.add_argument("--seconds", type=int, default=30)
    args = parser.parse_args()
    if (
        not 10 <= args.members <= 150
        or not 10 <= args.slots <= 62
        or not 1 <= args.seconds <= 120
    ):
        parser.error("Use10-150members,10-62slots,1-120searchseconds")
    if args.output.exists():
        parser.error("Use a fresh output path; historical evidence is retained")
    cases = args.case or list(CASES)
    sources = [
        "tools/benchmark_allocation_corpus.py",
        "tools/benchmark_rota_compute.py",
        *[
            str(path.relative_to(ROOT)).replace("\\", "/")
            for path in (ROOT / "backend/app/services").glob("*.py")
        ],
    ]
    hashes = {
        name: hashlib.sha256((ROOT / name).read_bytes()).hexdigest() for name in sources
    }
    report = {
        "version": 2,
        "recorded_at": datetime.now(timezone.utc).isoformat(),
        "fixture": "Synthetic fixed specification; not departmental data or pilot acceptance.",
        "base_head": subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=ROOT,
            capture_output=True,
            text=True,
            check=True,
        ).stdout.strip(),
        "source_sha256": hashes,
        "python": platform.python_version(),
        "platform": platform.platform(),
        "settings": {
            "members": args.members,
            "slots": args.slots,
            "seconds": args.seconds,
            "cases": cases,
        },
        "measurement_basis": "Stage wall times include SQL; nested/internal timings are not additive. CPU only. Single uncontrolled host run.",
        "runs": [],
        "complete": False,
    }

    def checkpoint():
        temporary = args.output.with_suffix(".tmp")
        temporary.write_text(
            json.dumps(report, indent=2, default=str) + "\n", encoding="utf-8"
        )
        temporary.replace(args.output)

    checkpoint()
    for case in cases:
        print(f"Starting {case}", flush=True)
        try:
            report["runs"].append(
                run_case(case, args.members, args.slots, args.seconds)
            )
        except Exception as exc:
            report["runs"].append({"case": case, "status": "failed", "error": str(exc)})
            checkpoint()
            raise
        checkpoint()
        print(f"Finished {case}: {report['runs'][-1]['status']}", flush=True)
    assert all(
        hashlib.sha256((ROOT / name).read_bytes()).hexdigest() == digest
        for name, digest in hashes.items()
    ), "Source changed during measurement"
    report["complete"] = True
    checkpoint()


if __name__ == "__main__":
    main()
