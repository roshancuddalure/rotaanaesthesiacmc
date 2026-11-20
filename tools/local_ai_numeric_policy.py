"""Conservative extraction for reviewed numeric proposals, never policy activation."""

import re

KEYS = (
    "max_24hr_per_month",
    "max_weekend_24hr_per_month",
    "max_same_group_per_month",
    "max_same_campus_per_month",
    "minimum_gap_after_24hr_hours",
)
NUMBER = r"([+-]?\d+(?:\.\d+)?)"
LIMIT = re.compile(r"\b(maximum|max|at most|limit(?: of| to)?|cap(?: of| at)?)\b[^\d\n.;+-]{0,24}" + NUMBER, re.I)
MINIMUM = re.compile(r"\b(minimum|min|at least)\b[^\d\n.;+-]{0,32}" + NUMBER, re.I)


def requested_policies(instruction):
    """Accept only explicit supported settings with unambiguous integer values.

    Unsupported or ambiguous phrasing stays with administrator review; the model
    cannot resolve it by selecting a number which merely appears in the request.
    """
    text = re.sub(r"\btwenty[ -]four\b", "24", instruction, flags=re.I).lower()
    if re.search(r"\b(or|undecided|unsure)\b|not (?:yet )?decided", text):
        raise ValueError("Numeric alternatives require clarification")
    if re.search(r"\b(do not|don't|never|not proposing|not requesting)\b", text):
        raise ValueError("Negated policy instructions require clarification")
    result = {}

    def record(key, raw):
        if not re.fullmatch(r"\+?\d+", raw):
            raise ValueError("A nonnegative whole number is required")
        value = int(raw)
        if key == "minimum_gap_after_24hr_hours" and value > 168:
            raise ValueError("Rest gap exceeds the supported range")
        if key in result:
            raise ValueError("Repeated settings require clarification")
        result[key] = value

    # Independent setting clauses allow explicit combined requests without
    # letting a weekend/group qualifier change another clause's scope.
    for clause in re.split(r"[;\n]|\b(?:and|but)\b", text):
        def sole_value(raw):
            cleaned = clause
            for key in KEYS:
                cleaned = cleaned.replace(key, "")
            cleaned = re.sub(r"\b24[ -]?(?:hour|hr)s?\b", "", cleaned)
            tokens = re.findall(r"(?<!\w)[+-]?\d+(?:\.\d+)?(?!\w)", cleaned)
            if tokens != [raw]:
                raise ValueError("Competing or missing policy values require clarification")

        named = [key for key in KEYS if re.search(r"\b" + key + r"\b", clause)]
        if named:
            if len(named) != 1:
                raise ValueError("Use one explicit setting per clause")
            match = re.search(r"\b" + named[0] + r"\b\s*(?:(?:[:=]|to|of|at|as|is)\s*)?" + NUMBER + r"(?!\d|\.\d)", clause)
            if not match:
                raise ValueError("Explicit setting needs its exact value")
            sole_value(match[1])
            record(named[0], match[1])
            continue
        maximums = list(LIMIT.finditer(clause))
        minimums = list(MINIMUM.finditer(clause))
        if len(maximums) + len(minimums) > 1:
            raise ValueError("Multiple limits in one clause require clarification")
        if maximums:
            if "month" not in clause:
                raise ValueError("Monthly limit scope must be explicit")
            scopes = [scope for scope in ("weekend", "group", "campus") if re.search(r"\b" + scope + r"\b", clause)]
            if len(scopes) > 1:
                raise ValueError("Combined scopes require clarification")
            if scopes:
                key = {"weekend": "max_weekend_24hr_per_month", "group": "max_same_group_per_month", "campus": "max_same_campus_per_month"}[scopes[0]]
            elif re.search(r"\b24[ -]?(?:hour|hr)", clause):
                key = "max_24hr_per_month"
            else:
                raise ValueError("Duty type must be explicit")
            sole_value(maximums[0][2])
            record(key, maximums[0][2])
        elif minimums:
            if not re.search(r"\b(rest|gap)\b", clause):
                raise ValueError("Only rest-gap minimum proposals are supported")
            sole_value(minimums[0][2])
            record("minimum_gap_after_24hr_hours", minimums[0][2])
    if not result:
        raise ValueError("No unambiguous supported numeric setting found")
    return result
