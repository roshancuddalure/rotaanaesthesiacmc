from datetime import date, datetime
from pathlib import Path

from app.services.historical_analysis_dry_run import (
    CanonicalMember,
    CanonicalNameResolver,
    manual_name_resolution,
)
from app.services.imports import ParsedRotaAssignment


def rota_assignment(person_name: str, duty_label: str, duty_type: str) -> ParsedRotaAssignment:
    duty_date = date(2025, 1, 1)
    return ParsedRotaAssignment(
        source_file=Path("Jan 2025.xlsx"),
        sheet_name="Sheet1",
        duty_date=duty_date,
        weekday_label="Wed",
        row_index=1,
        column_index=2,
        column_label="B",
        duty_label=duty_label,
        duty_type=duty_type,
        person_name=person_name,
        raw_person_name=person_name,
        starts_at=datetime(2025, 1, 1, 8),
        ends_at=datetime(2025, 1, 2, 8),
        is_24hr=True,
)


def test_saved_single_token_alias_is_ignored_when_token_is_shared() -> None:
    resolver = CanonicalNameResolver(
        [
            CanonicalMember(None, "Sujil Ebenezar Sam", None, "test"),
            CanonicalMember(None, "Sam Charles D", None, "test"),
            CanonicalMember(None, "Samuel D C", None, "test"),
        ],
        {"sam": "Sujil Ebenezar Sam"},
    )

    resolution = resolver.resolve("Sam")

    assert resolution.status != "matched"
    assert resolution.canonical_name is None


def test_saved_single_token_alias_is_used_when_token_is_unique() -> None:
    resolver = CanonicalNameResolver(
        [
            CanonicalMember(None, "Sujil Ebenezar Sam", None, "test"),
            CanonicalMember(None, "Sam Charles D", None, "test"),
        ],
        {"sujil": "Sujil Ebenezar Sam"},
    )

    resolution = resolver.resolve("Sujil")

    assert resolution.status == "matched"
    assert resolution.canonical_name == "Sujil Ebenezar Sam"


def test_jeenu_cart_resolves_to_jeenu_ann_jose() -> None:
    resolution = manual_name_resolution(rota_assignment("Jeenu", "Cart", "CART"), "2025-01")

    assert resolution is not None
    assert resolution.status == "matched"
    assert resolution.canonical_name == "Jeenu Ann Jose"


def test_joanna_is_separate_historical_person() -> None:
    resolution = manual_name_resolution(
        rota_assignment("Joanna", "Main 1st Call", "MAIN_1ST_24HR"),
        "2026-04",
    )

    assert resolution is not None
    assert resolution.status == "matched"
    assert resolution.canonical_name == "Joanna"


def test_angelin_anirudha_variant_maps_to_angelin_aniruth() -> None:
    resolution = manual_name_resolution(
        rota_assignment("Angelin Anirudha", "RC 2nd Call", "RC_2ND_24HR"),
        "2025-11",
    )

    assert resolution is not None
    assert resolution.status == "matched"
    assert resolution.canonical_name == "Angelin Aniruth"


def test_jeenu_second_call_resolves_to_jeenu_ann_jose() -> None:
    resolution = manual_name_resolution(
        rota_assignment("Jeenu", "Main 2nd Call", "MAIN_2ND_24HR"),
        "2025-04",
    )

    assert resolution is not None
    assert resolution.status == "matched"
    assert resolution.canonical_name == "Jeenu Ann Jose"


def test_first_call_priyadarshini_resolves_to_priyadharshini_s() -> None:
    resolution = manual_name_resolution(
        rota_assignment("Priyadarshini", "CB 1st Call", "CB_1ST_24HR"),
        "2025-07",
    )

    assert resolution is not None
    assert resolution.status == "matched"
    assert resolution.canonical_name == "Priyadharshini S"


def test_bare_angeline_uses_call_level_context() -> None:
    first_call = manual_name_resolution(
        rota_assignment("Angeline", "CB 1st Call", "CB_1ST_24HR"),
        "2025-04",
    )
    second_call = manual_name_resolution(
        rota_assignment("Angeline", "RC 2nd Call", "RC_2ND_24HR"),
        "2025-04",
    )
    fourth_call = manual_name_resolution(
        rota_assignment("Angeline", "RC 4th Call", "RC_4TH_24HR"),
        "2025-04",
    )

    assert first_call is not None
    assert first_call.canonical_name == "Angelin Aniruth"
    assert second_call is not None
    assert second_call.canonical_name == "Angelin Aniruth"
    assert fourth_call is not None
    assert fourth_call.canonical_name == "Angeline Mary Abraham"


def test_bare_angeline_pac_context_resolves_to_angelin_aniruth() -> None:
    resolution = manual_name_resolution(
        rota_assignment("Angeline", "Main PAC (2023)", "PAC"),
        "2025-04",
    )

    assert resolution is not None
    assert resolution.status == "matched"
    assert resolution.canonical_name == "Angelin Aniruth"


def test_bare_anisha_second_call_resolves_to_anisha_joy() -> None:
    resolution = manual_name_resolution(
        rota_assignment("Anisha", "Caesar Call PM", "CAESAR_B_24HR"),
        "2025-01",
    )

    assert resolution is not None
    assert resolution.status == "matched"
    assert resolution.canonical_name == "Anisha Joy"
