from datetime import date

import pytest
from sqlalchemy import select

from app.models import LeaveRequest, NormalizationEvent, Person
from tests.test_import_concurrency import postgres_client as postgres_fixture
from tests.test_rota_compute_concurrency import simultaneous


@pytest.fixture
def postgres_client():
    yield from postgres_fixture.__wrapped__()


def test_simultaneous_month_approvals_write_each_request_once(postgres_client):
    client, factory, headers = postgres_client
    with factory() as db:
        person = db.scalar(select(Person))
        db.add(LeaveRequest(person=person, leave_type="ANNUAL_LEAVE", leave_slot="FULL_DAY",
                            starts_on=date(2026, 10, 21), ends_on=date(2026, 10, 22),
                            status="requested"))
        db.commit()
    preview = client.post("/api/v1/leave/approval-preview", headers=headers,
                          json={"month": "2026-10"}).json()

    def approve():
        return client.post("/api/v1/leave/approve-month", headers=headers, json={
            "month": "2026-10", "review_token": preview["review_token"],
        })

    results = simultaneous([approve, approve])
    assert all(response.status_code == 200 for response in results)
    assert sorted(response.json()["approved_count"] for response in results) == [0, 1]
    with factory() as db:
        assert db.scalar(select(LeaveRequest)).status == "approved"
        assert db.query(NormalizationEvent).filter_by(action="leave_bulk_approved").count() == 1
