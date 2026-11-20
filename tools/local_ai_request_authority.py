"""Bounded explicit bypass-request refusal; no authority is delegated to a model.

This is not a general natural-language safety classifier. Existing manual
exception workflows retain their own separately checked permissions.
"""

import re

CHECK_TARGET = r"(?:leave|rest|eligibility|qualifications?|checks?|locks?|constraints?|safety|staffing|rules?|limits?|reserves?|ot)"
BYPASS = re.compile(r"\b(?:skip|bypass|ignore|waive|disable|remove|nullify|circumvent|override)\b(?=.{0,90}\b" + CHECK_TARGET + r"\b)")
PROTECTED = re.compile(r"\b(?:unlock|change|rewrite|edit|override)\b(?=.{0,70}\b(?:published|locked)\b)")
NEGATED = re.compile(r"\b(?:do not|don't|never|cannot|can't|must not|mustn't|should not|shouldn't|will not|won't)\s+(?:(?:ever|silently)\s+)?$")


def require_reviewable_instruction(instruction):
    text = re.sub(r"[_-]+", " ", instruction.lower().replace("’", "'"))
    for clause in re.split(r"[.;!?\n]|\b(?:and|but|then)\b", text):
        for pattern in (BYPASS, PROTECTED):
            for match in pattern.finditer(clause):
                if NEGATED.search(clause[:match.start()]):
                    continue
                raise ValueError("This assistant cannot authorize bypassing checks or changing locked/published commitments. Use the separately reviewed administrator workflow; regular planning remains available.")
