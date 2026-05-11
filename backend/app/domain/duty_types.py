from pydantic import BaseModel


class DutyType(BaseModel):
    key: str
    label: str
    group: str
    counts_in_main_24hr: bool = False
    is_24hr: bool = False
    is_separate: bool = False


MAIN_24HR_KEYS = {
    "MAIN_1ST_24HR",
    "MAIN_1ST_CO_24HR",
    "MAIN_2ND_24HR",
    "MAIN_3RD_24HR",
    "MAIN_4TH_24HR",
    "MAIN_CO3RD_24HR",
    "MAIN_CO4TH_24HR",
    "CB_1ST_24HR",
    "CB_3RD_24HR",
    "CB_4TH_24HR",
    "CB_CO3RD_24HR",
    "CB_CO4TH_24HR",
    "CAESAR_B_24HR",
    "RC_1ST_A_24HR",
    "RC_1ST_B_24HR",
    "RC_2ND_24HR",
    "RC_3RD_24HR",
    "RC_4TH_24HR",
    "RC_CO3RD_24HR",
    "RC_CO4TH_24HR",
    "SCHELL_24HR",
    "FLOATING_24HR",
}


def duty_type(key: str, label: str, group: str, is_24hr: bool = False) -> DutyType:
    return DutyType(
        key=key,
        label=label,
        group=group,
        is_24hr=is_24hr,
        counts_in_main_24hr=key in MAIN_24HR_KEYS,
        is_separate=key not in MAIN_24HR_KEYS,
    )


DUTY_TYPES: tuple[DutyType, ...] = (
    duty_type("MAIN_1ST_24HR", "Main 1st Call", "main", True),
    duty_type("MAIN_1ST_CO_24HR", "Main Co-1st Call", "main", True),
    duty_type("MAIN_2ND_24HR", "Main 2nd Call", "main", True),
    duty_type("MAIN_3RD_24HR", "Main 3rd Call", "main", True),
    duty_type("MAIN_4TH_24HR", "Main 4th Call", "main", True),
    duty_type("MAIN_CO3RD_24HR", "Main Co-3rd Call", "main", True),
    duty_type("MAIN_CO4TH_24HR", "Main Co-4th Call", "main", True),
    duty_type("CB_1ST_24HR", "CB 1st Call", "cb", True),
    duty_type("CB_3RD_24HR", "CB 3rd Call", "cb", True),
    duty_type("CB_4TH_24HR", "CB 4th Call", "cb", True),
    duty_type("CB_CO3RD_24HR", "CB Co-3rd Call", "cb", True),
    duty_type("CB_CO4TH_24HR", "CB Co-4th Call", "cb", True),
    duty_type("CB_CO_12HR", "CB Co-Call 12hr", "cb"),
    duty_type("CB_PAEDS", "CB Paeds", "cb"),
    duty_type("CAESAR_A_12HR", "Caesar A", "caesar"),
    duty_type("CAESAR_B_24HR", "Caesar B", "caesar", True),
    duty_type("RC_1ST_A_24HR", "RC 1st Call A", "rc", True),
    duty_type("RC_1ST_B_24HR", "RC 1st Call B", "rc", True),
    duty_type("RC_2ND_24HR", "RC 2nd Call", "rc", True),
    duty_type("RC_3RD_24HR", "RC 3rd Call", "rc", True),
    duty_type("RC_4TH_24HR", "RC 4th Call", "rc", True),
    duty_type("RC_CO3RD_24HR", "RC Co-3rd Call", "rc", True),
    duty_type("RC_CO4TH_24HR", "RC Co-4th Call", "rc", True),
    duty_type("RC_12HR", "RC 12hr", "rc"),
    duty_type("RC_CO_12HR", "RC Co-Call 12hr", "rc"),
    duty_type("SCHELL_24HR", "Schell Call", "schell", True),
    duty_type("FLOATING_24HR", "Floating Consultant", "floating", True),
    duty_type("FIFTH_CALL", "5th Call", "fifth_call", True),
    duty_type("CART", "CART", "cart", True),
    duty_type("PAC", "PAC", "pac"),
    duty_type("MAIN_SHIFT", "Main Shift", "shift"),
    duty_type("RC_SHIFT", "RC Shift", "shift"),
    duty_type("PB_SHIFT", "PB Shift", "shift"),
    duty_type("SHIFT", "Shift (Legacy)", "shift"),
    duty_type("CHAD", "CHAD", "chad"),
    duty_type("RUHSA", "RUHSA", "ruhsa"),
    duty_type("PAEDS_CALL", "Paeds Call", "paeds"),
    duty_type("NEURO_DEPT", "Neuro Department", "neuro"),
)
