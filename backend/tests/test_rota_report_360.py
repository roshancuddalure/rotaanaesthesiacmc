"""360° audit report (app/services/rota_report_360.py; docs/extra_duty_contract.md section 6)."""

from __future__ import annotations

import json
import math
import re
import sys
import time as _time
import types
from datetime import date, datetime, time, timedelta
from io import BytesIO

import openpyxl
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app import models  # noqa: F401
from app.db.session import Base
from app.models import (
    DutyAssignment,
    DutySlot,
    ExtraDutyBatch,
    ExtraDutyRecord,
    Person,
    PersonPosting,
    RotaAutoFillRun,
    RotaPeriod,
    RotaPublishApproval,
    RotaTemplateGenerationRun,
    RuleSetting,
    RuleVersion,
    Unit,
    UserAccount,
)
from app.services import rota_report_360 as report
from app.services.leave import month_bounds

MONTH = "2026-05"

# (unit code, unit name, campus, [(duty_type, call level, start hour, hours, is_24hr)])
UNIT_PLAN = [
    ("UNIT_I", "Unit I", "MAIN", [("MAIN_1ST_24HR", "1ST_CALL", 8, 24, True), ("MAIN_2ND_24HR", "2ND_CALL", 8, 24, True),
                                  ("MAIN_3RD_24HR", "3RD_CALL", 8, 24, True)]),
    ("UNIT_II", "Unit II", "MAIN", [("CB_1ST_24HR", "1ST_CALL", 8, 24, True), ("CB_CO_12HR", "2ND_CALL", 20, 12, False),
                                    ("CB_3RD_24HR", "3RD_CALL", 8, 24, True)]),
    ("UNIT_III", "Unit III", "RANIPET", [("RC_1ST_A_24HR", "1ST_CALL", 8, 24, True), ("RC_12HR", "3RD_CALL", 8, 12, False),
                                         ("RC_CO_12HR", "2ND_CALL", 19, 12, False)]),
]
FIRST_NAMES = ["Anitha", "Bharath", "Chitra", "Deepak", "Elango", "Farah", "Gokul", "Harini", "Imran", "Jaya", "Karthik", "Lakshmi",
               "Manoj", "Nandini", "Omkar", "Priya", "Rahul", "Sangeetha", "Tarun", "Uma", "Vijay", "Wasim", "Yamini", "Zubair",
               "Arjun", "Bhavya", "Charan", "Divya", "Eshwar", "Fathima"]


def make_session() -> Session:
    engine = create_engine("sqlite+pysqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    return Session(engine)


def _period(session: Session, month: str, status: str = "draft") -> RotaPeriod:
    starts, ends = month_bounds(month)
    period = RotaPeriod(name=report._month_label(month), starts_on=starts, ends_on=ends, status=status)
    session.add(period)
    session.flush()
    return period


def _slot(session: Session, period: RotaPeriod, unit: Unit, day: date, duty: tuple, label_suffix: str = "") -> DutySlot:
    duty_type, call_level, start_hour, hours, is_24 = duty
    starts = datetime.combine(day, time(hour=start_hour))
    slot = DutySlot(
        rota_period=period, unit=unit, duty_date=day, duty_type=duty_type, call_level=call_level,
        slot_label=f"{unit.code}:{duty_type}:{day.isoformat()}{label_suffix}", starts_at=starts,
        ends_at=starts + timedelta(hours=hours), is_24hr=is_24, source="phase4_template",
    )
    session.add(slot)
    return slot


def seed_realistic_month(session: Session, month: str = MONTH, members_per_unit: int = 8, evil_name: bool = False,
                         history_months: int = 3, open_every: int = 23, copies: int = 1) -> dict:
    """3 units, members_per_unit x 3 members, every day of the month, a few open slots, an extra-duty
    batch with a fallback and a void ledger row, holiday calendar, runs, a publish approval and history."""
    units = []
    for code, name, campus, _duties in UNIT_PLAN:
        unit = Unit(code=code, name=name, campus=campus)
        session.add(unit)
        units.append(unit)
    session.flush()
    levels = ["1ST_CALL", "1ST_CALL", "1ST_CALL", "2ND_CALL", "2ND_CALL", "3RD_CALL", "3RD_CALL", "3RD_CALL"]
    people_by_unit_level: dict[tuple, list[Person]] = {}
    people: list[Person] = []
    index = 0
    history_start = month_bounds(report._month_shift(month, -history_months))[0]
    for unit in units:
        for k in range(members_per_unit):
            name = f"Dr {FIRST_NAMES[index % len(FIRST_NAMES)]} {chr(65 + index // len(FIRST_NAMES))}{index:02d}"
            if evil_name and index == 0:
                name = '<script>alert("x")</script> Evil & Co'
            level = levels[k % len(levels)]
            person = Person(canonical_name=name, call_level=level)
            session.add(person)
            session.flush()
            session.add(PersonPosting(person=person, unit=unit, posting_type=level, starts_on=history_start, source="unit_board"))
            people_by_unit_level.setdefault((unit.code, level), []).append(person)
            people.append(person)
            index += 1
    session.flush()

    def fill_month(m: str, status: str, open_every_n: int) -> tuple[RotaPeriod, list[DutySlot], list[DutyAssignment]]:
        period = _period(session, m, status)
        starts, ends = month_bounds(m)
        slots, assignments = [], []
        counter = 0
        rotation: dict[tuple, int] = {}
        day = starts
        while day <= ends:
            for unit, (_code, _name, _campus, duties) in zip(units, UNIT_PLAN):
                for duty in [d for d in duties for _c in range(copies)]:
                    slot = _slot(session, period, unit, day, duty, f"#{counter}" if copies > 1 else "")
                    slots.append(slot)
                    counter += 1
                    if open_every_n and counter % open_every_n == 0:
                        continue
                    pool = people_by_unit_level[(unit.code, duty[1])]
                    i = rotation.get((unit.code, duty[1]), 0)
                    rotation[(unit.code, duty[1])] = i + 1
                    person = pool[i % len(pool)]
                    assignment = DutyAssignment(duty_slot=slot, person=person, status="draft", source="safe_auto_fill_draft")
                    session.add(assignment)
                    assignments.append(assignment)
            day += timedelta(days=1)
        session.flush()
        return period, slots, assignments

    for back in range(history_months, 0, -1):
        fill_month(report._month_shift(month, -back), "published", 31 + back)
    period, slots, assignments = fill_month(month, "draft", open_every)

    # Extra-duty batch: 3 active records (one with fallback unit) + 1 void.
    admin = UserAccount(username="hod", display_name="Dr HOD Admin", password_hash="x", role="admin")
    session.add(admin)
    session.flush()
    filled_ids = {a.duty_slot.id for a in assignments}
    open_slots = [s for s in slots if s.id not in filled_ids]
    batch = ExtraDutyBatch(rota_period_id=period.id, month=month, status="applied", plan_hash="a" * 64, context_hash="b" * 64,
                           rules_revision="r1", summary={"filled": 4, "fallback": 1, "ledger_records": 4, "unfilled": 0, "slots_considered": 4},
                           decisions=[], before_image=[], created_by_name="Dr HOD Admin", created_at=datetime(2026, 4, 28, 10, 30))
    undone = ExtraDutyBatch(rota_period_id=period.id, month=month, status="undone", plan_hash="c" * 64, context_hash="d" * 64,
                            summary={"filled": 1}, decisions=[], before_image=[], created_by_name="Dr HOD Admin",
                            created_at=datetime(2026, 4, 27, 9, 0), undone_at=datetime(2026, 4, 27, 9, 20), undone_by_name="Dr HOD Admin")
    session.add_all([batch, undone])
    session.flush()
    records = []
    plans = [
        (open_slots[0], None, ["unit_safety_hard_block", "monthly_24hr_limit"], "active"),
        (open_slots[1], None, ["unit_safety_review"], "active"),
        (open_slots[2], units[0], ["unit_safety_hard_block"], "active"),  # fallback: covered by Unit I
        (open_slots[3], None, ["monthly_same_group_limit"], "void"),
    ]
    for n, (slot, fallback_unit, rules, status) in enumerate(plans):
        target_unit = fallback_unit or slot.unit
        pool = people_by_unit_level.get((target_unit.code, slot.call_level)) or [p for p in people if p.call_level == slot.call_level]
        person = pool[n % len(pool)]
        home_unit_id = slot.unit_id
        if fallback_unit is not None:
            slot.unit = fallback_unit
        assignment = DutyAssignment(duty_slot=slot, person=person, status="draft" if status == "active" else "cancelled",
                                    source="extra_duty_layer", override_reason="Extra-duty layer: " + ", ".join(rules))
        session.add(assignment)
        session.flush()
        if status == "active":
            assignments.append(assignment)
        records.append(ExtraDutyRecord(
            batch_id=batch.id, person_id=person.id, assignment_id=assignment.id, slot_id=slot.id, month=month,
            duty_date=slot.duty_date, duty_type=slot.duty_type, home_unit_id=home_unit_id, assigned_unit_id=slot.unit_id,
            fallback_used=fallback_unit is not None, overridden_rules=rules,
            justice={"ledger_count": n % 2, "last_extra_date": "2026-02-11" if n % 2 else None, "month_duties": 3 + n,
                     "month_24hr": 2, "rest_hours": 48 + n * 12 if n != 1 else None},
            reason="Fewest extra duties in the last 12 months", status=status,
            void_reason="cleared by the rota board" if status == "void" else None,
            voided_at=datetime(2026, 4, 29, 8, 0) if status == "void" else None,
        ))
    session.add_all(records)
    rv = RuleVersion(name="Intelligence holiday calendar test", effective_from=date(2026, 1, 1))
    session.add(rv)
    session.add(RuleSetting(rule_version=rv, key="allocation.intelligence.holidays", value={"dates": ["2026-05-01", "2026-05-28"]}))
    session.add(RotaTemplateGenerationRun(rota_period_id=period.id, included_units=3, created_slots=len(slots), needs_review_slots=2,
                                          summary={"month": month}, created_at=datetime(2026, 4, 25, 9, 0)))
    session.add(RotaAutoFillRun(rota_period_id=period.id, total_slots=len(slots), assigned_slots=len(slots) - len(open_slots),
                                skipped_slots=len(open_slots), summary={"month": month}, created_at=datetime(2026, 4, 25, 9, 5)))
    session.add(RotaPublishApproval(rota_period_id=period.id, approved_by_user_id=admin.id, approval_note="Reviewed with the rota board",
                                    confirmed_warnings=True, summary={}, created_at=datetime(2026, 4, 30, 16, 0)))
    session.commit()
    return {"period": period, "slots": slots, "assignments": assignments, "units": units, "people": people, "records": records}


@pytest.fixture()
def seeded():
    session = make_session()
    info = seed_realistic_month(session)
    yield session, info
    session.close()


def _no_verify(monkeypatch, check_month=None):
    """Replace the independent checker module (None = import fails)."""
    if check_month is None:
        monkeypatch.setitem(sys.modules, "app.services.extra_duty_verify", None)
    else:
        module = types.ModuleType("app.services.extra_duty_verify")
        module.check_month = check_month
        monkeypatch.setitem(sys.modules, "app.services.extra_duty_verify", module)


# --------------------------------------------------------------------------- metrics


def test_gini_and_std_on_known_values():
    assert report.gini([1, 2, 3, 4]) == pytest.approx(0.25)
    assert report.gini([5, 5, 5]) == 0
    assert report.gini([0, 0]) == 0
    assert report.gini([]) == 0
    assert report.gini([0, 0, 0, 10]) == pytest.approx(0.75)
    assert report.std_dev([1, 2, 3, 4]) == pytest.approx(1.1180, abs=1e-4)
    stats = report.distribution_stats([1, 2, 3, 4])
    assert stats == {"members": 4, "total": 10, "mean": 2.5, "min": 1, "max": 4, "std": 1.12, "gini": 0.25, "spread": 3}


def test_night_definition():
    def slot(hour, is_24=False):
        return types.SimpleNamespace(is_24hr=is_24, starts_at=datetime(2026, 5, 1, hour))
    assert report.is_night(slot(20)) and report.is_night(slot(18)) and report.is_night(slot(2))
    assert not report.is_night(slot(8)) and not report.is_night(slot(17))
    assert not report.is_night(slot(20, True))


def test_totals_add_up(seeded, monkeypatch):
    session, info = seeded
    _no_verify(monkeypatch)
    data = report.build_report_data(session, MONTH, generated_by="Auditor")
    json.dumps(data)  # JSON-serialisable
    s = data["summary"]
    active = [a for a in info["assignments"] if a.status in report.ACTIVE_STATUSES]
    filled_slots = {a.duty_slot_id for a in active}
    assert s["slots"] == len(info["slots"]) == sum(d["slots"] for d in data["coverage"]["by_day"])
    assert s["filled"] == len(filled_slots) == sum(d["filled"] for d in data["coverage"]["by_day"])
    assert s["open"] == s["slots"] - s["filled"]
    assert sum(u["slots"] for u in data["coverage"]["by_unit"]) == s["slots"]
    assert sum(d["filled"] for d in data["coverage"]["by_duty"]) == s["filled"]
    assert sum(u["filled"] for u in data["units"]) == s["filled"]
    assert sum(w["total"] for w in data["workload"]) == s["duties_total"] == len(active)
    assert sum(w["hours24"] for w in data["workload"]) == s["duties_24hr"]
    assert sum(w["nights"] for w in data["workload"]) == s["night_duties"] > 0
    assert sum(w["holidays"] for w in data["workload"]) > 0  # 1 and 28 May are in the calendar
    assert s["members"] == 24 and len(data["calendar"]) == s["slots"]
    for level in data["fairness"]["by_call_level"]:
        rows = [w for w in data["workload"] if w["call_level"] == level["call_level"]]
        assert level["members"] == len(rows) and level["total"] == sum(w["total"] for w in rows)
        assert sum(w["deviation_from_mean"] for w in rows) == pytest.approx(0, abs=0.05)
    assert data["meta"]["data_fingerprint"] == report.assignment_fingerprint(
        [(str(a.duty_slot_id), str(a.person_id), a.status) for a in active])
    assert data["meta"]["published_by"] == "Dr HOD Admin" and data["meta"]["generated_by"] == "Auditor"
    assert [t["month"] for t in data["trend"]] == ["2026-02", "2026-03", "2026-04"]
    actions = [ev["action"] for ev in data["audit_trail"]]
    for expected in ("Template built", "Members auto-assigned", "Extra-duty layer applied", "Extra-duty batch undone", "Rota published"):
        assert expected in actions
    assert not data["section_errors"]
    text = report.render_html(data)
    assert "Section unavailable" not in text and "Chart unavailable" not in text


def test_extra_duties_listed_and_void_excluded_from_counts(seeded, monkeypatch):
    session, info = seeded
    _no_verify(monkeypatch)
    data = report.build_report_data(session, MONTH)
    rows = data["extra_duties"]
    assert len(rows) == 4
    assert sorted(r["status"] for r in rows) == ["active", "active", "active", "void"]
    assert data["summary"]["extra_duties"] == 3
    assert data["summary"]["extra_void"] == 1
    assert data["summary"]["fallback_duties"] == 1
    assert data["summary"]["hard_blocked_covered"] == 2
    assert sum(w["extra"] for w in data["workload"]) == 3
    assert sum(u["extra_received"] for u in data["units"]) == 3
    fallback = [r for r in rows if r["fallback_used"]][0]
    assert fallback["assigned_unit"] == "Unit I" and fallback["home_unit"] != "Unit I"
    assert [u for u in data["units"] if u["unit"] == "Unit I"][0]["fallback_received"] == 1
    assert "Unit short-staffed (hard block)" in rows[0]["overridden_labels"]
    html_text = report.render_html(data)
    assert "Void" in html_text and "cleared by the rota board" in html_text
    assert 'class="void"' in html_text
    assert "Over monthly 24-hour limit" in html_text


# --------------------------------------------------------------------------- rendering


def test_html_is_self_contained_and_escapes_names(monkeypatch):
    session = make_session()
    seed_realistic_month(session, evil_name=True)
    _no_verify(monkeypatch)
    data = report.build_report_data(session, MONTH, generated_by='<img src=x onerror="alert(1)">')
    text = report.render_html(data)
    assert text.startswith("<!doctype html>")
    assert "http://" not in text and "https://" not in text
    assert not re.search(r"<(script|link|iframe|img|object|embed)\b", text, re.I)
    assert not re.search(r"\b(src|href)\s*=\s*[\"']?(//|[a-z]+:)", text, re.I)
    assert "&lt;script&gt;" in text and "&amp; Co" in text
    assert "&lt;img src=x" in text
    assert "@media print" in text and "@page" in text and 'role="img"' in text
    assert "<caption>" in text and 'scope="col"' in text
    for _sid, title in report.SECTIONS[1:]:
        assert report.e(title) in text
    assert "Prepared by" in text and "Reviewed by" in text and "Approved by" in text


def test_xlsx_opens_with_expected_sheets(seeded, monkeypatch):
    session, _info = seeded
    _no_verify(monkeypatch)
    data = report.build_report_data(session, MONTH)
    content = report.render_xlsx(data)
    workbook = openpyxl.load_workbook(BytesIO(content))
    assert workbook.sheetnames == report.XLSX_SHEETS
    ws = workbook["Member workload"]
    assert ws.freeze_panes is not None and ws.auto_filter.ref
    headers = [c.value for c in ws[5]]
    assert headers[:4] == ["Member", "Call level", "Unit", "Total"]
    totals = [row[3] for row in ws.iter_rows(min_row=6, max_row=5 + len(data["workload"]), values_only=True)]
    assert sum(totals) == data["summary"]["duties_total"]
    assert workbook["Cover"]["B3"].value == "Duty Rota Audit Report"
    extra = workbook["Extra duties"]
    statuses = [row[8] for row in extra.iter_rows(min_row=6, max_row=9, values_only=True)]
    assert sorted(statuses) == ["active", "active", "active", "void"]


def test_formula_like_names_are_written_as_text(monkeypatch):
    session = make_session()
    info = seed_realistic_month(session)
    info["people"][0].canonical_name = '=HYPERLINK("http://evil","x")'
    session.commit()
    _no_verify(monkeypatch)
    content = report.render_xlsx(report.build_report_data(session, MONTH))
    ws = openpyxl.load_workbook(BytesIO(content))["Member workload"]
    names = [row[0] for row in ws.iter_rows(min_row=6, values_only=True)]
    assert '=HYPERLINK("http://evil","x")' in names
    cell = next(c for c in ws["A"] if c.value == '=HYPERLINK("http://evil","x")')
    assert cell.data_type == "s"


def test_empty_month_renders(monkeypatch):
    session = make_session()
    _no_verify(monkeypatch)
    data = report.build_report_data(session, "2026-07")
    json.dumps(data)
    assert data["summary"]["slots"] == 0 and data["summary"]["coverage_pct"] == 0
    assert data["workload"] == [] and data["extra_duties"] == [] and data["trend"] == []
    assert len(data["coverage"]["by_day"]) == 31
    assert data["meta"]["period_status"] == "not created"
    assert session.query(RotaPeriod).count() == 0  # the report never creates a period
    text = report.render_html(data)
    assert "no duty slots" in text.lower()
    assert "Section unavailable" not in text
    workbook = openpyxl.load_workbook(BytesIO(report.render_xlsx(data)))
    assert workbook.sheetnames == report.XLSX_SHEETS


def test_section_failure_is_isolated(seeded, monkeypatch):
    session, _info = seeded
    _no_verify(monkeypatch)

    def boom(ctx):
        raise RuntimeError("workload exploded")

    monkeypatch.setattr(report, "_build_workload", boom)
    data = report.build_report_data(session, MONTH)
    assert "workload exploded" in data["section_errors"]["workload"]
    assert data["workload"] == []
    assert data["summary"]["slots"] > 0 and data["fairness"]["by_call_level"]
    text = report.render_html(data)
    assert "Section unavailable: RuntimeError: workload exploded" in text
    assert "Coverage by unit" in text and "Extra-duty ledger" in text
    workbook = openpyxl.load_workbook(BytesIO(report.render_xlsx(data)))
    assert "Section unavailable" in str(workbook["Member workload"]["A5"].value)


def test_chart_failure_falls_back_to_table(seeded, monkeypatch):
    session, _info = seeded
    _no_verify(monkeypatch)
    data = report.build_report_data(session, MONTH)

    def broken(*_args, **_kwargs):
        raise ValueError("bad geometry")

    monkeypatch.setattr(report, "svg_unit_bars", broken)
    text = report.render_html(data)
    assert "Chart unavailable (ValueError: bad geometry)" in text
    assert "Fallback received" in text


def test_compliance_fallback_when_checker_missing(seeded, monkeypatch):
    session, _info = seeded
    _no_verify(monkeypatch)
    data = report.build_report_data(session, MONTH)
    comp = data["compliance"]
    assert comp["available"] is False and comp["all_passed"] is False
    assert comp["error"].startswith("Independent check unavailable:")
    assert any(c["source"] == "report" for c in comp["checks"])
    assert "Independent check unavailable" in report.render_html(data)


def test_compliance_fallback_when_checker_raises(seeded, monkeypatch):
    session, _info = seeded

    def raising(db, month):
        raise RuntimeError("checker crashed")

    _no_verify(monkeypatch, raising)
    data = report.build_report_data(session, MONTH)
    assert data["compliance"]["available"] is False
    assert "checker crashed" in data["compliance"]["error"]
    assert not data["section_errors"]


def test_compliance_uses_independent_checker(seeded, monkeypatch):
    session, info = seeded
    slot = info["slots"][0]
    person = info["assignments"][0].person

    def fake(db, month):
        return {
            "ok": False, "checked": 200,
            "violations": [{"slot_id": str(slot.id), "person_id": str(person.id), "code": "leave", "message": "On approved leave"}],
            "checks": [{"name": "Leave respected", "passed": False, "checked": 200, "violations": 1},
                       {"name": "Slot capacity", "passed": True, "checked": 200, "violations": []}],
        }

    _no_verify(monkeypatch, fake)
    data = report.build_report_data(session, MONTH)
    comp = data["compliance"]
    assert comp["available"] and comp["checked"] == 200 and comp["all_passed"] is False
    names = [c["name"] for c in comp["checks"]]
    assert names[:2] == ["Leave respected", "Slot capacity"]
    assert comp["checks"][1]["violations"] == 0
    assert comp["violations"][0]["person_name"] == person.canonical_name
    text = report.render_html(data)
    assert "On approved leave" in text and "1 check(s) failed" in text
    ws = openpyxl.load_workbook(BytesIO(report.render_xlsx(data)))["Compliance"]
    assert ws["A5"].value == "CHECKS FAILED"


def test_real_checker_or_fallback_never_breaks_report(seeded):
    session, _info = seeded
    data = report.build_report_data(session, MONTH)
    assert "compliance" not in data["section_errors"]
    report.render_html(data)
    report.render_xlsx(data)


def test_fingerprint_changes_with_assignments(seeded, monkeypatch):
    session, info = seeded
    _no_verify(monkeypatch)
    first = report.build_report_data(session, MONTH)["meta"]
    again = report.build_report_data(session, MONTH)["meta"]
    assert first["data_fingerprint"] == again["data_fingerprint"]
    assert first["report_fingerprint"] == again["report_fingerprint"]
    info["assignments"][5].status = "cancelled"
    session.commit()
    changed = report.build_report_data(session, MONTH)["meta"]
    assert changed["data_fingerprint"] != first["data_fingerprint"]


def test_performance_300_slots_150_members(monkeypatch):
    session = make_session()
    _no_verify(monkeypatch)
    # 150 members; 3 units x 9 duties x 2 copies x 30 days = 540 slots (plus 2 months of history).
    seed_realistic_month(session, month="2026-06", members_per_unit=50, history_months=2, open_every=17, copies=2)
    assert session.query(DutySlot).filter(DutySlot.duty_date >= date(2026, 6, 1)).count() >= 300
    started = _time.perf_counter()
    data = report.build_report_data(session, "2026-06")
    report.render_html(data)
    report.render_xlsx(data)
    elapsed = _time.perf_counter() - started
    assert data["summary"]["members"] == 150
    assert elapsed < 3.0, elapsed


# --------------------------------------------------------------------------- individual limits (fill-all contract §6)


def _save_limits(session: Session, **limits) -> None:
    from sqlalchemy import select

    from app.services.rota_rules import PHASE_ONE_SETTING_KEY, get_phase_one_rules

    _version, rules = get_phase_one_rules(session)
    for key, value in limits.items():
        setattr(rules.duty_count_limits, key, value)
    setting = session.scalar(select(RuleSetting).where(RuleSetting.key == PHASE_ONE_SETTING_KEY))
    setting.value = rules.model_dump(mode="json")
    session.commit()


def test_individual_limits_section_lists_members_over_limit(seeded, monkeypatch):
    session, _info = seeded
    _no_verify(monkeypatch)
    _save_limits(session, max_24hr_per_month=9)
    data = report.build_report_data(session, MONTH)
    assert not data["section_errors"]
    section = data["individual_limits"]
    assert section["configured"] is True
    assert section["limits"] == [{"key": "max_24hr_per_month", "label": "24-hour duties a month", "limit": 9}]
    people = section["people"]
    assert people, "the seeded month has members with more than nine 24-hour duties"
    assert [p["person_name"].lower() for p in people] == sorted(p["person_name"].lower() for p in people)
    for person in people:
        assert person["limits"] and all(item["code"] == "monthly_24hr_limit" for item in person["limits"])
        assert all(item["actual"] > item["limit"] == 9 for item in person["limits"])
        assert person["month_24hr"] > 9
    # Same answer as the publish checklist helper.
    from app.services.rota_review import individual_limit_breaches

    assert [p["person_id"] for p in people] == [p["person_id"] for p in individual_limit_breaches(session, MONTH)]

    ids = [s["id"] for s in data["sections"]]
    assert ids.index("individual_limits") == ids.index("fairness") + 1
    text = report.render_html(data)
    assert 'id="individual_limits"' in text and "Individual limits exceeded" in text
    assert report.e(people[0]["person_name"]) in text
    assert f"{len(people)} member(s) are above an individual duty limit" in text
    assert "Section unavailable" not in text
    assert "http://" not in text and "https://" not in text
    assert not re.search(r"<(script|link|iframe|img|object|embed)\b", text, re.I)

    workbook = openpyxl.load_workbook(BytesIO(report.render_xlsx(data)))
    assert workbook.sheetnames == report.XLSX_SHEETS
    assert workbook.sheetnames.index("Over limit") == workbook.sheetnames.index("Fairness") + 1
    ws = workbook["Over limit"]
    assert [c.value for c in ws[5]][:4] == ["Member", "Call level", "Unit", "Duties"]
    sheet_rows = [row for row in ws.iter_rows(min_row=6, values_only=True) if row[0]]
    assert len(sheet_rows) == sum(len(p["limits"]) for p in people)
    assert all(row[6] == "monthly_24hr_limit" and row[9] == row[7] - row[8] > 0 for row in sheet_rows)
    summary_ws = workbook["Executive summary"]
    measures = {row[0]: row[1] for row in summary_ws.iter_rows(min_row=6, values_only=True) if row[0]}
    assert measures["Members over an individual limit"] == len(people)


def test_individual_limits_none_when_within_limits_or_unset(seeded, monkeypatch):
    session, _info = seeded
    _no_verify(monkeypatch)
    before = session.query(RuleSetting).count()
    data = report.build_report_data(session, MONTH)
    assert session.query(RuleSetting).count() == before  # rules never saved: the report wrote nothing
    assert data["individual_limits"] == {"configured": False, "limits": [], "people": []}
    assert "No individual duty limits are set" in report.render_html(data)

    _save_limits(session, max_24hr_per_month=31)
    data = report.build_report_data(session, MONTH)
    assert data["individual_limits"]["configured"] is True and data["individual_limits"]["people"] == []
    text = report.render_html(data)
    assert "No member is above an individual duty limit" in text
    ws = openpyxl.load_workbook(BytesIO(report.render_xlsx(data)))["Over limit"]
    assert any("No member is above" in str(row[0]) for row in ws.iter_rows(values_only=True) if row[0])


def test_individual_limits_failure_is_isolated(seeded, monkeypatch):
    session, _info = seeded
    _no_verify(monkeypatch)

    def boom(ctx, month):
        raise RuntimeError("limits exploded")

    monkeypatch.setattr(report, "_build_individual_limits", boom)
    data = report.build_report_data(session, MONTH)
    assert "limits exploded" in data["section_errors"]["individual_limits"]
    assert data["individual_limits"] == {"configured": False, "limits": [], "people": []}
    assert data["fairness"]["by_call_level"] and data["units"]
    text = report.render_html(data)
    assert "Section unavailable: RuntimeError: limits exploded" in text
    workbook = openpyxl.load_workbook(BytesIO(report.render_xlsx(data)))
    assert "Section unavailable" in str(workbook["Over limit"]["A5"].value)


def test_ledger_labels_new_codes_and_audit_trail_shows_mode(seeded, monkeypatch):
    session, info = seeded
    _no_verify(monkeypatch)
    record = next(r for r in info["records"] if r.status == "active")
    record.overridden_rules = ["monthly_24hr_limit", "any_unit", "outside_scope_unit", "unposted_member", "unit_rule"]
    batch = session.get(ExtraDutyBatch, record.batch_id)
    batch.summary = {**batch.summary, "mode": "all_units", "cross_unit": 2, "unposted_used": 1, "over_limit_people": 3}
    session.commit()
    data = report.build_report_data(session, MONTH)
    row = next(r for r in data["extra_duties"] if r["id"] == str(record.id))
    assert row["overridden_labels"] == [
        "Over monthly 24-hour limit",
        "Covered from another unit",
        "Covered from a unit outside this month's scope",
        "Member has no posting this month",
        "Duty not allowed for this unit",
    ]
    applied = next(ev for ev in data["audit_trail"]
                   if ev["action"] == "Extra-duty layer applied" and str(batch.id)[:8] in ev["detail"])
    assert "mode all units" in applied["detail"]
    other = next(ev for ev in data["audit_trail"]
                 if ev["action"] == "Extra-duty layer applied" and str(batch.id)[:8] not in ev["detail"])
    assert "mode" not in other["detail"]  # older batch without summary.mode
    assert "2 from another unit" in applied["detail"] and "1 unposted member(s)" in applied["detail"]
    text = report.render_html(data)
    assert report.e("Covered from a unit outside this month's scope") in text
    assert "mode all units" in text


# --------------------------------------------------------------------------- superadmin actions
# docs/superadmin_override_contract.md section 2.


def _add_superadmin_allocation(session: Session, info: dict, *, post_publish: bool = False):
    period = info["period"]
    filled = {a.duty_slot_id for a in info["assignments"]}
    slot = next(s for s in info["slots"] if s.id not in filled and not any(
        a.status in {"draft", "assigned", "confirmed"} for a in s.assignments))
    person = info["people"][-1]
    assignment = DutyAssignment(duty_slot=slot, person=person, status="assigned", source="superadmin_allocation",
                                override_reason="Superadmin allocation: Emergency cover agreed")
    session.add(assignment)
    session.flush()
    batch = ExtraDutyBatch(
        rota_period_id=period.id, month=MONTH, status="applied", plan_hash="e" * 64, context_hash="f" * 64,
        summary={"mode": "superadmin_allocation", "filled": 1, "fallback": 0, "ledger_records": 1, "unfilled": 0,
                 "slots_considered": 1, "replaced": 0, "by": "Rota Chief", "reason": "Emergency cover agreed",
                 "post_publish": post_publish},
        decisions=[{"slot_id": str(slot.id), "action": "superadmin_allocation", "person_id": str(person.id),
                    "person_name": person.canonical_name, "duty_date": slot.duty_date.isoformat(),
                    "duty_type": slot.duty_type, "duty_label": "Main 1st call", "unit_name": slot.unit.name,
                    "overridden_rules": ["superadmin_allocation", "call_level_mismatch", "not_posted"],
                    "replaced": [], "post_publish": post_publish}],
        before_image=[], created_by_name="Rota Chief", created_at=datetime(2026, 5, 3, 11, 0),
    )
    session.add(batch)
    session.flush()
    record = ExtraDutyRecord(
        batch_id=batch.id, person_id=person.id, assignment_id=assignment.id, slot_id=slot.id, month=MONTH,
        duty_date=slot.duty_date, duty_type=slot.duty_type, home_unit_id=slot.unit_id, assigned_unit_id=slot.unit_id,
        fallback_used=False, overridden_rules=["superadmin_allocation", "call_level_mismatch", "not_posted"],
        justice={"ledger_count": 0}, reason="Superadmin allocation by Rota Chief: Emergency cover agreed", status="active",
    )
    session.add(record)
    session.commit()
    return slot, person, batch, record


def test_superadmin_section_lists_allocations_and_publish_override(seeded, monkeypatch):
    session, info = seeded
    _no_verify(monkeypatch)
    slot, person, batch, record = _add_superadmin_allocation(session, info, post_publish=True)
    approval = session.query(RotaPublishApproval).one()
    approval.summary = {"published_with_override": True, "override_reason": "Two units short; HOD agreed",
                        "override_by": "Rota Chief", "open_slots": 7,
                        "blockers": [{"title": "Open slots", "detail": "7 slot(s) still need assignment."}],
                        "warnings_unconfirmed": 2}
    info["period"].status = "published"
    session.commit()

    data = report.build_report_data(session, MONTH)
    assert "superadmin" not in data["section_errors"]
    assert [s["id"] for s in data["sections"]].index("superadmin") == [s["id"] for s in data["sections"]].index("extra_duties") + 1
    section = data["superadmin"]
    assert section["active_allocations"] == 1 and section["post_publish_allocations"] == 1
    row = section["allocations"][0]
    assert row["person_name"] == person.canonical_name and row["duty_date"] == slot.duty_date.isoformat()
    assert row["by"] == "Rota Chief" and row["reason"] == "Emergency cover agreed" and row["post_publish"] is True
    assert row["overridden_labels"] == ["Call level does not match the duty", "Not posted to the duty's unit"]
    assert row["status"] == "active"
    override = section["publish_overrides"][0]
    assert override["by"] == "Rota Chief" and override["open_slots"] == 7 and override["warnings_unconfirmed"] == 2
    assert data["meta"]["published_with_override"] is True
    assert data["summary"]["superadmin_allocations"] == 1
    # Ledger label and audit trail.
    ledger_row = next(r for r in data["extra_duties"] if r["id"] == str(record.id))
    assert ledger_row["overridden_labels"][0] == "Superadmin allocation"
    actions = [ev["action"] for ev in data["audit_trail"]]
    assert "Superadmin allocation" in actions and "Rota published (superadmin override)" in actions

    text = report.render_html(data)
    assert "Published with superadmin override" in text
    assert "Superadmin actions" in text and report.e("Emergency cover agreed") in text
    assert "duty slot(s) were allocated by a superadmin" in text
    workbook = openpyxl.load_workbook(BytesIO(report.render_xlsx(data)))
    assert workbook.sheetnames == report.XLSX_SHEETS
    assert workbook.sheetnames.index("Superadmin") == workbook.sheetnames.index("Extra duties") + 1
    values = [c for row_ in workbook["Superadmin"].iter_rows(values_only=True) for c in row_ if c is not None]
    assert person.canonical_name in values and "Two units short; HOD agreed" in values
    cover = [c for row_ in workbook["Cover"].iter_rows(values_only=True) for c in row_ if c is not None]
    assert any(str(c).startswith("Published with superadmin override") for c in cover)


def test_superadmin_section_empty_and_isolated(seeded, monkeypatch):
    session, _info = seeded
    _no_verify(monkeypatch)
    data = report.build_report_data(session, MONTH)
    assert data["superadmin"] == {"allocations": [], "active_allocations": 0, "post_publish_allocations": 0, "publish_overrides": []}
    assert data["meta"]["published_with_override"] is False
    text = report.render_html(data)
    assert "No superadmin allocations this month." in text and "Published with superadmin override" not in text

    monkeypatch.setattr(report, "_build_superadmin", lambda ctx: (_ for _ in ()).throw(RuntimeError("sa exploded")))
    data = report.build_report_data(session, MONTH)
    assert "superadmin" in data["section_errors"]
    assert "Section unavailable: RuntimeError: sa exploded" in report.render_html(data)
    workbook = openpyxl.load_workbook(BytesIO(report.render_xlsx(data)))
    assert "Section unavailable" in str(workbook["Superadmin"]["A5"].value)


def test_fairness_shows_call_level_targets_and_finding(seeded, monkeypatch):
    """docs/limits_callevel_fairness_contract.md 2: target, min, max, gap per call level, the
    members off target, and an executive-summary finding."""
    session, _info = seeded
    _no_verify(monkeypatch)
    data = report.build_report_data(session, MONTH, generated_by="Auditor")
    fairness = data["fairness"]
    assert fairness["targets_error"] is None and fairness["targets"]
    for level in fairness["targets"]:
        assert {"call_level", "label", "target", "min", "max", "gap", "allowed_gap", "ok", "off_target"} <= set(level)
        assert level["gap"] == level["max"] - level["min"]
        for member in level["off_target"]:
            assert member["duties"] < math.floor(level["target"]) or member["duties"] > math.ceil(level["target"])
    text = report.render_html(data)
    assert "Equal duties within a call level" in text
    uneven = [t for t in fairness["targets"] if not t["ok"]]
    if uneven:
        assert "Duty totals uneven within a call level" in text
    else:
        assert "Duty totals are within the allowed gap in every call level" in text
    workbook = openpyxl.load_workbook(BytesIO(report.render_xlsx(data)))
    values = [c for row in workbook["Fairness"].iter_rows(values_only=True) for c in row if c]
    assert "Equal duties within a call level (target = slots / members, all campuses)" in values


def test_fairness_targets_failure_is_isolated(seeded, monkeypatch):
    import app.services.fairness_targets as targets

    session, _info = seeded
    _no_verify(monkeypatch)

    def broken(*_args, **_kwargs):
        raise RuntimeError("targets exploded")

    monkeypatch.setattr(targets, "call_level_spread", broken)
    data = report.build_report_data(session, MONTH)
    assert "fairness" not in data["section_errors"] and data["fairness"]["by_call_level"]
    assert data["fairness"]["targets"] == [] and "targets exploded" in data["fairness"]["targets_error"]
    assert "Call-level targets unavailable" in report.render_html(data)


def test_superadmin_cross_level_label():
    assert report.OVERRIDE_LABELS["superadmin_cross_level"] == "Call level crossed by superadmin"


# --------------------------------------------------------------------------- balance passes on extra duties
# docs/balance_extra_duties_contract.md section 2. The fixture writes a transferred record and a
# balance batch directly (the same shapes balance_duties.py writes), so it does not depend on it.


def _pass_on_extra_duty(session: Session, info: dict):
    record = next(r for r in info["records"] if r.status == "active")
    old_person = session.get(Person, record.person_id)
    new_person = next(p for p in info["people"] if p.id != record.person_id and p.call_level == old_person.call_level)
    assignment = session.get(DutyAssignment, record.assignment_id)
    balance = ExtraDutyBatch(
        rota_period_id=info["period"].id, month=MONTH, status="applied", plan_hash="9" * 64, context_hash="8" * 64,
        summary={"mode": "balance", "moves": 1, "swaps": 0, "cross_unit": 0, "extra_moves": 1,
                 "levels_detail": [{"call_level": "1ST_CALL", "label": "1st call", "before": {"gap": 3}, "after": {"gap": 1},
                                    "ok_after": True}]},
        decisions=[{"kind": "move", "slot_id": str(record.slot_id), "assignment_id": str(record.assignment_id),
                    "duty_date": record.duty_date.isoformat(), "duty_type": record.duty_type, "duty_label": "Main 1st call",
                    "from_person_id": str(old_person.id), "from_person": old_person.canonical_name,
                    "to_person_id": str(new_person.id), "to_person": new_person.canonical_name,
                    "from_unit": "Unit I", "to_unit": "Unit I", "cross_unit": False,
                    "extra_duty": True, "ledger_from": old_person.canonical_name, "ledger_to": new_person.canonical_name,
                    "new_overridden_rules": ["rebalanced_extra_duty"]}],
        before_image=[], created_by_name="Rota Chief", created_at=datetime(2026, 5, 2, 9, 0),
    )
    session.add(balance)
    session.flush()
    old_codes = list(record.overridden_rules or [])
    record.person_id = new_person.id
    record.overridden_rules = ["rebalanced_extra_duty"]
    record.justice = {"ledger_count": 0, "month_duties": 2, "transfers": [{
        "from_person_id": str(old_person.id), "from_person_name": old_person.canonical_name,
        "to_person_id": str(new_person.id), "to_person_name": new_person.canonical_name,
        "balance_batch_id": str(balance.id), "at": "2026-10-22T09:30:00", "old_overridden_rules": old_codes}]}
    assignment.person_id = new_person.id
    assignment.source = "balance_duties"
    session.commit()
    return record, old_person, new_person, balance


def test_report_shows_extra_duties_passed_on_by_balance(seeded, monkeypatch):
    session, info = seeded
    _no_verify(monkeypatch)
    record, old_person, new_person, balance = _pass_on_extra_duty(session, info)
    data = report.build_report_data(session, MONTH)
    assert not data["section_errors"]
    assert report.OVERRIDE_LABELS["rebalanced_extra_duty"] == "Extra duty passed on by Balance duties"
    row = next(r for r in data["extra_duties"] if r["id"] == str(record.id))
    assert row["person_name"] == new_person.canonical_name
    assert row["rebalanced"] is True and row["passed_on_from"] == old_person.canonical_name
    assert row["overridden_labels"] == ["Extra duty passed on by Balance duties"]
    assert row["transfers"][0]["text"] == f"Passed on from {old_person.canonical_name} by Balance duties on 22 Oct"
    assert row["transfers"][0]["balance_batch_id"] == str(balance.id)
    others = [r for r in data["extra_duties"] if r["id"] != str(record.id)]
    assert all(r["transfers"] == [] and r["rebalanced"] is False and r["passed_on_from"] is None for r in others)
    assert data["summary"]["extra_passed_on"] == 1
    # Ledger still counts the duty once, for the new holder.
    assert data["summary"]["extra_duties"] == 3
    assert next(w for w in data["workload"] if w["person_id"] == str(new_person.id))["extra"] >= 1

    batch = next(b for b in data["fairness"]["balancing"] if b["batch_id"] == str(balance.id))
    assert batch["extra_moves"] == 1
    move = batch["moves"][0]
    assert move["extra_duty"] is True
    assert move["ledger_from"] == old_person.canonical_name and move["ledger_to"] == new_person.canonical_name
    assert move["new_overridden_labels"] == ["Extra duty passed on by Balance duties"]

    text = report.render_html(data)
    assert "Passed on from" in text
    assert report.e(f"Passed on from {old_person.canonical_name} by Balance duties on 22 Oct") in text
    assert "Extra duties passed on (ledger transfer)" in text
    assert report.e(f"Ledger credit moves from {old_person.canonical_name} to {new_person.canonical_name}") in text
    assert "1 extra duties were passed on by Balance duties to even out totals" in text

    workbook = openpyxl.load_workbook(BytesIO(report.render_xlsx(data)))
    extra = workbook["Extra duties"]
    assert extra.cell(row=5, column=15).value == "Passed on from"
    passed = [c for row_ in extra.iter_rows(min_row=6, values_only=True) for c in row_ if c and str(c).startswith("Passed on from ")]
    assert passed == [f"Passed on from {old_person.canonical_name} by Balance duties on 22 Oct"]
    fairness = [c for row_ in workbook["Fairness"].iter_rows(values_only=True) for c in row_ if c]
    assert "Ledger transfer" in fairness
    assert f"{old_person.canonical_name} -> {new_person.canonical_name}" in fairness
    assert any(str(c).startswith("1 extra duties were passed on by Balance duties") for c in fairness)
    summary = [c for row_ in workbook["Executive summary"].iter_rows(values_only=True) for c in row_ if c is not None]
    assert "Extra duties passed on by Balance duties" in summary


def test_report_without_balance_transfers_has_no_passed_on_finding(seeded, monkeypatch):
    session, _info = seeded
    _no_verify(monkeypatch)
    data = report.build_report_data(session, MONTH)
    assert data["summary"]["extra_passed_on"] == 0
    assert all(r["transfers"] == [] for r in data["extra_duties"])
    assert "were passed on by Balance duties" not in report.render_html(data)
