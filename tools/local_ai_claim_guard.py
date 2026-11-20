"""Reject unsupported execution/override claims; never grants application authority.

This is a bounded text check, not general semantic grounding or a safety proof.
"""

import re


def validate_claims(explanation, proposed_rules):
    def normalize(text):
        return re.sub(r"[_-]+", " ", text).lower()

    for rule in proposed_rules:
        text = normalize(rule)
        if re.search(r"\b(skip|bypass|ignore|override|waive|disable|remove|nullify|circumvent)\b.{0,65}\b(leave|rest|eligibility|checks?|locks?|constraints?|safety|staffing|rules?)\b", text):
            raise ValueError("The assistant cannot propose bypassing authoritative checks")
        if re.search(r"\b(assign|apply|approve|publish|unlock|execute)\b", text):
            raise ValueError("The assistant cannot propose executing application actions")

    text = normalize(explanation)
    capability_text = text.replace("can't", "cannot").replace("couldn't", "could not").replace("won't", "will not")
    for match in re.finditer(r"\b(?:can|could|may|will)\b(?=[^.;\n]{0,110}\b(?:nullify|bypass|disable|waive|circumvent)\b[^.;\n]{0,45}\b(?:checks?|constraints?|safety|staffing|rules?|leave|rest|eligibility)\b)", capability_text):
        if not re.match(r"\s+(?:not|never|no longer)\b", capability_text[match.end():]):
            raise ValueError("The assistant cannot claim capability to nullify authoritative checks")
    if re.search(r"\b(?:does not|doesn't|do not|don't)\s+(?:require|need)\s+(?:(?:any|policy|administrator|admin|human)\s+)*review\b", text):
        raise ValueError("The assistant cannot remove review requirements")
    if re.search(r"\b(?:can|may|will)\s+(?:be\s+)?(?:executed|applied|approved|published|unlocked|assigned)\s+(?:immediately|automatically)\b", text):
        raise ValueError("The assistant cannot authorize immediate execution")
    for match in re.finditer(r"\b(?:i (?:have )?|has been |successfully )(?:applied|assigned|approved|published|unlocked)\b|\b(?:guaranteed safe|perfect allocation|all constraints satisfied)\b", text):
        prefix = re.split(r"[.;\n]", text[:match.start()])[-1]
        if match[0].startswith("has been ") and re.search(r"\bno\s+(?:\w+\s+){0,2}$", prefix):
            continue
        raise ValueError("The assistant cannot claim execution or validated safety")
    for match in re.finditer(r"\bwithout\s+(?:(?:additional|further|policy|human|administrator)\s+)*review\b", text):
        prefix = re.split(r"[.;\n]", text[:match.start()])[-1]
        if not re.search(r"\b(?:do not|don't|never|cannot|can't|must not|mustn't)\s+(?:\w+\s+){0,4}(?:assign|apply|approve|publish|execute|unlock)\s*$", prefix):
            raise ValueError("The assistant cannot authorize action without review")
