from datetime import date

from app.services.imports import (
    ReconstructedMonth,
    classify_duty_label,
    reconstruct_rota_date_from_weekday,
)


def test_classifies_rc_first_call_b_from_parenthesized_label() -> None:
    assert classify_duty_label("RC 1st (B) Call (2023)") == "RC_1ST_B_24HR"


def test_classifies_first_co_call_twelve_hour_rows() -> None:
    assert classify_duty_label("CB 1st Co-Call (12hrs)") == "CB_CO_12HR"


def test_classifies_january_caesar_am_pm_rows() -> None:
    assert classify_duty_label("CB C/S AM CAL (7.30 AM-7PM)") == "CAESAR_A_12HR"
    assert classify_duty_label("Caesar Call PM (2022, SR)(AM LIST)") == "CAESAR_B_24HR"


def test_classifies_rc_third_call_with_batch_year_as_third_call() -> None:
    assert classify_duty_label("RC 3rd Call (A) (2022)") == "RC_3RD_24HR"


def test_reconstructs_corrupt_rota_dates_from_weekday_occurrence() -> None:
    month = ReconstructedMonth(year=2025, month=1, source_text="January 2025")

    assert reconstruct_rota_date_from_weekday("Friday", 0, month) == date(2025, 1, 3)
    assert reconstruct_rota_date_from_weekday("Friday", 1, month) == date(2025, 1, 10)
