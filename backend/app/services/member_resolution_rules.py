"""Seed data and loading for member resolution rules.

The seed is Plan/Alias/Alias_Resolution_Summary.md (authoritative) written as data, using the
roster's stored canonical spellings and the owner's decisions of 20 Oct 2026
(docs/member_resolution_audit.md, "Decisions"). Where the summary says a short form is
ambiguous in a context, there is deliberately no rule: the resolver asks.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import date, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import MemberResolutionRule, Person
from app.services.normalization import member_key

logger = logging.getLogger(__name__)

SEED_SOURCE = "alias_summary_2026_05"

C1, C2, C3, C4 = "1ST_CALL", "2ND_CALL", "3RD_CALL", "4TH_CALL"


@dataclass(frozen=True)
class SeedRule:
    forms: tuple[str, ...]
    person: str
    call_levels: tuple[str, ...] = ()
    duty_areas: tuple[str, ...] = ()
    effective_from: date | None = None
    effective_to: date | None = None
    requires_context: bool = False
    priority: int = 0
    note: str = ""
    extra: dict = field(default_factory=dict)


def _any(forms: str, person: str, note: str = "") -> SeedRule:
    return SeedRule(tuple(f.strip() for f in forms.split(",")), person, note=note)


# Direct alias map: these forms mean one person in any context.
DIRECT = [
    _any("Pradeeshya, Pradeeshya Parthiban", "Pradeeshya Parthiban"),
    _any("Jerin, Jerin Daniel, Jerin Daniel D", "Jerin Daniel D"),
    _any("Raichel, Raichel Kurian, Raichel Kurien", "Raichel Kurian"),
    _any("Annielyn, Annielyn Benitta P J, Annielyn Benita P J", "Annielyn Benitta P J"),
    _any("Anjali, Anjali R, Anjali Rachel Mathew, Anjali Rachael Mathew", "Anjali Rachel Mathew"),
    _any("Anton, Anton Max Cassella Kumar, Anton Max Casella", "Anton Max Cassella Kumar"),
    _any("Vejans, Vejans Vishal Antony V, Vejans Vishal Antony", "Vejans Vishal Antony V"),
    _any("Alwin, Alwin Mesak K, Alwin Mesak", "Alwin Mesak K"),
    _any("Edward, Edward Lourdes Roshan A, Edward Lourde Roshan", "Edward Lourdes Roshan A"),
    _any("Velu, Velu Ranganathan, Velu Renganathan", "Velu Ranganathan"),
    _any("Madhumita, Madumitha, Madhumitha", "Madhumitha P S"),
    _any("Jenifer, Jenifer A, Jennifer, Jennifer A", "Jennifer A"),
    _any("Preethi Elizabeth Kurian, Preethi Kurian, Preethi Kuryan", "Preethi Elizabeth Kurian"),
    _any("Sam Charles, Sam Charles D, Samcharles D", "Samcharles D"),
    # Owner decision: Samuel D C and Samuel David Chandran are one person (the active record).
    _any("Samuel Chandran, Samuel David Chandran, Sam David, Sam D C, Samuel D C, Sam C, "
         "Sam Chandran, Samuel C, Samuel David", "Samuel David Chandran"),
    _any("Pradeep K, Pradeep Daniel", "Pradeep Daniel"),
    _any("Daniel Jonathan Roy, Daniel Jonathan Roy L", "Daniel Jonathan Roy L"),
    _any("Shanmugam, Shanmugham, Shanmuga", "Shanmuga Sundaram"),
    _any("Tamizhanban, Tamizanban, Thamizanban, Thamizhanban, Tamizhanabn", "Thamizhanban D"),
    _any("Vimal, Vimal Babu", "Vimal B"),
    _any("Meghna, Meghna S David", "Meghna S David"),
    _any("Savarin, Savarin Jebha", "Savarin Jebha J"),
    _any("Karthik, Karthick S, Karthik S", "Karthik S"),
    _any("David K, Karumuru David Raj", "Karumuru David Raj"),
    _any("David Samson Rontala", "David Samson Rontala"),
    _any("Divya, Divya J", "Divya J"),
    _any("Chris, Chris Maria J, Chris Maria Joseph", "Chris Maria Joseph"),
    _any("Lilly, Lilly Sophia, Lilly Sophia M", "Lilly Sophia M"),
    _any("Ajay, Ajay A, Ajay Ashok", "Ajay A"),
    _any("Prem, Prem Jepina, Prem Jepina P", "Prem Jepina P"),
    _any("Joe, Joe Renitta, Joe Renitta S", "Joe Renitta S"),
    _any("James, James Thapa M, James Thapa Magar", "James Thapa Magar"),
    _any("Pavithra P", "Pavithra"),
    _any("Soumya, Sowmya, Soumiya, Sowmya A", "Sowmya A"),
    _any("Jacintha, Jacintha Graceline J", "Jacintha Gracelin J"),
    _any("Yuvraj K, Yuvaraj K", "Yuvaraj K"),
    _any("Sudarshan, Sudharshan, Sudharsan", "Sudharsan T R"),
    _any("Navfal, Navfal Mohammed S A", "Navfal Mohamed S A"),
    _any("R Vignesh, Vighnesh, Vignesh", "Vignesh R"),
    _any("Angelyn A, Angelin, Angelina, Angelina Niruth, Angelin Anirudha, Angelin Aniruth", "Angelin Aniruth"),
    _any("Sinduja, Sindhuja", "Sindhuja D K"),
    _any("Jeeva, Jeeva Priscilla D M", "Jeeva Priscilla D M"),
    _any("Jona S, Jona Samraj D", "Jona Samraj D"),
    _any("Jonathan Joseph", "Jonathan Joseph"),
    _any("Priyadarshini S, Priyadharshini S, Priyadarshni S", "Priyadharshini S"),
    _any("Rohith B", "Buddula Rohith"),
    _any("Nandhini S, Nanthini S, Nandini, Nandhini", "Nanthini S"),
    _any("Emy Hannah, Emy Hanna Moni", "Emy Hanna Moni"),
    _any("Karthick Pandiyan, Karthik Pandiyan, Karthikpandian S", "Karthikpandian S"),
    _any("Kaviya Sree, Kaviya Sri, Kaviya S, Kaviyashri", "Kaviya"),
    _any("Calwin, Calvin, Calwin Lawrence, Calwin Lawrence Dalmeida", "Calvin Lawrence Dalmeida"),
    _any("DIVYA LAK, Divyalakshmi", "Divyalakshmi"),
    _any("Kavi, Kaviarasan, Kaviarsan", "Kaviarasan"),
    _any("Mathew, Matthew, Mattews, Matthew J, Mathews JO, Mathews Joji", "Mathews Joji"),
    _any("Christina R, Christina Reshma R", "Christina Reshma R"),
    _any("Christina T, Christina Thomas", "Christina Thomas"),
    _any("Aneesha, Aneesha C, Aneesha Cris, Aneesha Chris, Aneesha Chris Wilfred", "Aneesha Chris W"),
    _any("Emelia, Emilya", "Emilia Mary Pushparaj"),
    _any("PRAISE V, PRAISE VP", "V Praise Prudveer Nazson"),
    _any("Elwis, Elvis Fabian Petre", "Elvis Fabian Peters"),
    _any("Selvinderan P", "Selvendiran P"),
    _any("Joseph, Joseph A P", "Joseph A P"),
    _any("R MAWII", "Ramengmawii Khawlhring"),
    _any("MEETA G", "Meeta G"),
    _any("Mispah", "Jammi Mizpah Shen"),
    _any("TIRZAH NM", "Trizah Narayana Moorthy"),
    _any("Pornima", "Poornima K"),
    _any("Joufin", "Jofin F A"),
    _any("JIM SAHI", "Jim Shahi G S"),
    # Owner decisions of 20 Oct 2026 for names the summary had left unresolved.
    _any("SERINA", "Serina Ruth Salin", "Owner confirmed 2026-10-20"),
    _any("KAREN", "Karen Ruby Lionel", "Owner confirmed 2026-10-20"),
    _any("ANITA", "Anita Shirley Joselyn", "Owner confirmed 2026-10-20"),
    _any("SATHISH", "Sathish Kumar D", "Owner confirmed 2026-10-20"),
    _any("SREE", "Anjane Sree", "Owner confirmed 2026-10-20"),
    _any("Joanna", "Joanna Emmanuel", "Owner confirmed 2026-10-20"),
    # "Any context" rows of the context sections.
    _any("Rohan JT, Rohan Jacob Titus, Rohan Titus", "Rohan Jacob Titus"),
    _any("Naveen S, Suda Naveen, Suda Naveen Kumar", "Suda Naveen Kumar"),
    _any("Koppaka Naveen", "Koppaka Naveen Kumar"),
    _any("Preethi A, Preethy, Preethy A", "Preethi A"),
    _any("Angeline M A, Angeline Mary Abraham", "Angeline Mary Abraham"),
    _any("Anisha P", "Anisha Pauline L"),
]


def _ctx(forms: str, person: str, **kw) -> SeedRule:
    return SeedRule(tuple(f.strip() for f in forms.split(",")), person, **kw)


ROHAN = "Rohan, Rohan C, Rohan Chacko"
DANIEL, JOEL, DAVID, JEENU, RIYA = "Daniel", "Joel", "David", "Jeenu", "Riya"
PRIYA = "Priya, Priyadharshini, Priyadarshini"

# Context rules: the form means this person only in the stated context. Higher priority wins;
# a requires_context rule is the summary's "other contexts" default and never fires without context.
CONTEXT = [
    _ctx(ROHAN, "Rohan Jacob Titus", call_levels=(C3,), effective_to=date(2026, 3, 31), priority=20,
         note="3rd call before 2026-04"),
    _ctx(ROHAN, "Rohan Chacko Jacob", requires_context=True, priority=1, note="Other contexts / later period"),
    _ctx("Naveen, Naveen K", "Koppaka Naveen Kumar", call_levels=(C1, C2, C3), priority=10, note="Less than 4th call"),
    _ctx("Naveen, Naveen K", "Suda Naveen Kumar", call_levels=(C4,), priority=10, note="4th call"),
    _ctx("Preethi", "Preethi A", call_levels=(C1, C2), priority=10, note="Junior / less than 3rd call"),
    _ctx("Preethi", "Preethi Elizabeth Kurian", call_levels=(C3, C4, "5TH_CALL"), priority=10, note="3rd call or higher"),
    _ctx(DANIEL, "Pradeep Daniel", call_levels=(C4,), priority=20, note="4th call"),
    _ctx(DANIEL, "Joel Daniel", call_levels=(C1,), effective_from=date(2026, 4, 1), priority=20,
         note="1st call after 2026-03"),
    _ctx(DANIEL, "Daniel Jonathan Roy L", call_levels=(C1, C2, C3), priority=10, note="Other junior/2nd/3rd contexts"),
    _ctx(JOEL, "Joel V Peter", call_levels=(C3, C4), priority=20, note="3rd or 4th call"),
    _ctx(JOEL, "Joel Daniel", call_levels=(C1,), effective_from=date(2026, 4, 1), priority=20, note="1st call after 2026-03"),
    _ctx(JOEL, "Joel Koil Raj J", call_levels=(C1, C2), priority=10, note="Earlier junior context"),
    _ctx(DAVID, "David Samson Rontala", call_levels=(C1,), priority=10, note="1st call"),
    _ctx(DAVID, "Karumuru David Raj", call_levels=(C2,), priority=10, note="2nd call"),
    _ctx(JEENU, "Jeenu Ann Jose", duty_areas=("CART",), priority=20, note="CART"),
    _ctx(JEENU, "Jeenu Ann Jose", call_levels=(C2, C3), priority=10, note="2nd or 3rd call"),
    _ctx(JEENU, "Jeenu Ann Jose", duty_areas=("CAESAR", "PAC"), priority=10, note="Caesar or PAC"),
    _ctx(JEENU, "Jeenu D", call_levels=(C4,), priority=20, note="4th call"),
    _ctx(RIYA, "Riya Lal", call_levels=(C3,), priority=20, note="3rd call"),
    _ctx(RIYA, "Riya Sarah Abraham", call_levels=(C4,), priority=10, note="Senior / 4th call"),
    _ctx(RIYA, "Riya Sarah Abraham", requires_context=True, priority=1, note="Other contexts"),
    _ctx(PRIYA, "Priyadharshini S", call_levels=(C1, C2), priority=10, note="1st or 2nd call"),
    _ctx(PRIYA, "Priyadarshini Kalahasthi", call_levels=(C3,), priority=10, note="3rd call"),
    _ctx("Jonathan", "Jonathan Samuel B", call_levels=(C3,), priority=10, note="3rd call"),
    _ctx("Sharon", "Sharon J Ebenezer", call_levels=(C2, C3), priority=10, note="2nd or 3rd call"),
    _ctx("Sharon", "Sharon Kavya Chandana P", call_levels=(C4,), priority=10, note="4th call"),
    _ctx("Sam", "Samcharles D", call_levels=(C1, C2), priority=10, note="1st or 2nd call"),
    _ctx("Sam", "Samuel David Chandran", call_levels=(C4,), priority=10, note="4th call"),
    _ctx("Angeline", "Angeline Mary Abraham", call_levels=(C4,), priority=20, note="4th call / senior PAC"),
    _ctx("Angeline", "Angelin Aniruth", call_levels=(C1, C2, C3), priority=10, note="1st, 2nd or 3rd call"),
    _ctx("Angeline", "Angelin Aniruth", duty_areas=("PAC",), priority=5, note="Ordinary PAC"),
    _ctx("Anisha", "Anisha Joy", call_levels=(C2,), priority=10, note="2nd call"),
]

SEED_RULES = DIRECT + CONTEXT


def build_seed_rules(people: dict[str, Person]) -> tuple[list[MemberResolutionRule], set[str]]:
    """Seed rules as unsaved rows for the members that exist, plus the names that do not."""
    rules, missing, seen = [], set(), set()
    now = datetime.utcnow()
    for rule in SEED_RULES:
        person = people.get(rule.person)
        if person is None:
            missing.add(rule.person)
            continue
        for form in rule.forms:
            key = member_key(form)
            signature = (key, person.id, tuple(rule.call_levels), tuple(rule.duty_areas), rule.effective_from,
                         rule.effective_to, rule.requires_context)
            if not key or signature in seen:
                continue
            seen.add(signature)
            rules.append(MemberResolutionRule(
                form=form, form_key=key, person_id=person.id, call_levels=list(rule.call_levels),
                duty_areas=list(rule.duty_areas), effective_from=rule.effective_from,
                effective_to=rule.effective_to, requires_context=rule.requires_context,
                priority=rule.priority, active=True, note=rule.note or None, source=SEED_SOURCE,
                created_at=now, updated_at=now,
            ))
    return rules, missing


def seed_resolution_rules(db: Session) -> dict:
    """Insert the seed rules whose member exists. Idempotent; never overwrites admin edits."""
    people = {p.canonical_name: p for p in db.scalars(select(Person))}
    existing = {
        (r.form_key, r.person_id, tuple(r.call_levels or []), tuple(r.duty_areas or []), r.effective_from,
         r.effective_to, r.requires_context)
        for r in db.scalars(select(MemberResolutionRule))
    }
    rules, missing = build_seed_rules(people)
    created = 0
    for rule in rules:
        signature = (rule.form_key, rule.person_id, tuple(rule.call_levels), tuple(rule.duty_areas),
                     rule.effective_from, rule.effective_to, rule.requires_context)
        if signature not in existing:
            db.add(rule)
            created += 1
    db.flush()
    if missing:
        logger.warning("Resolution rules skipped; members not in roster: %s", sorted(missing))
    return {"created": created, "missing_members": sorted(missing)}
