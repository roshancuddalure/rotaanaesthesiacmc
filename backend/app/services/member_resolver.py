"""The single resolver that turns a written name into a department member.

Every import and admin tool that names a member resolves through ``MemberIndex.resolve``
(docs/member_resolution_audit.md). Order, each step recorded on the result:

1. an explicit member id;
2. a reviewed resolution rule for the name form, chosen by call level, duty area and date;
3. an exact canonical name;
4. an approved alias, unless the alias is a short form shared by several people;
5. context: if several people own the name, the one whose call level fits the row;
6. similar names, offered as candidates only.

Hard rules: fuzzy similarity never assigns; ties and shared short forms ask; historical or
archived members are never assigned on a live import without the reviewer choosing them.
Results do not depend on database row order.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import asdict, dataclass, field
from datetime import date
from difflib import SequenceMatcher
from typing import Iterable, Literal
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.models import MemberResolutionRule, Person, PersonPosting
from app.services.normalization import display_text, member_key
from app.services.rota_call_levels import normalize_call_level

Status = Literal["matched", "needs_review", "not_found", "ambiguous", "conflict"]
# "live": leave, postings, rota work for current members. "history": past duties and the
# historical rebuild, where historical (but never archived) members are legitimate targets.
Purpose = Literal["live", "history"]

FUZZY_FLOOR = 0.65
MAX_CANDIDATES = 5
CALL_LEVELS = {"1ST_CALL", "2ND_CALL", "3RD_CALL", "CO_4TH_CALL", "4TH_CALL", "5TH_CALL"}


class MemberResolutionError(ValueError):
    """Base for resolution failures that callers turn into row-specific messages."""

    def __init__(self, message: str, *, raw_name: str = "", row: object = None):
        super().__init__(message)
        self.raw_name, self.row = raw_name, row


class UnknownMemberId(MemberResolutionError):
    pass


@dataclass(frozen=True)
class ResolutionContext:
    call_level: str | None = None
    on: date | None = None
    duty_area: str | None = None

    @classmethod
    def build(cls, call_level: str | None = None, on: date | None = None, duty_area: str | None = None):
        level = normalize_call_level(call_level) if call_level else None
        return cls(level if level in CALL_LEVELS else None, on, (duty_area or "").strip().upper() or None)

    @property
    def known(self) -> bool:
        return bool(self.call_level or self.duty_area)


def rule_applies(rule: MemberResolutionRule, ctx: ResolutionContext) -> bool:
    if rule.requires_context and not ctx.known:
        return False
    if rule.call_levels and ctx.call_level not in rule.call_levels:
        return False
    if rule.duty_areas and ctx.duty_area not in rule.duty_areas:
        return False
    if rule.effective_from and (ctx.on is None or ctx.on < rule.effective_from):
        return False
    if rule.effective_to and (ctx.on is None or ctx.on > rule.effective_to):
        return False
    return True


def is_conditional(rule: MemberResolutionRule) -> bool:
    return bool(rule.call_levels or rule.duty_areas or rule.effective_from or rule.effective_to
                or rule.requires_context)


def match_rules(rules: list[MemberResolutionRule], ctx: ResolutionContext):
    """Apply the rules for one name form.

    Returns ("rule", rule) when exactly one person is meant, ("ask", rules) when the form is
    context-dependent and this context fits none (or ties), or ("none", []) without rules.
    Rules must be pre-sorted by descending priority.
    """
    if not rules:
        return "none", []
    unconditional = [r for r in rules if not is_conditional(r)]
    fitting = [r for r in rules if is_conditional(r) and rule_applies(r, ctx)]
    if fitting:
        top = [r for r in fitting if r.priority == fitting[0].priority]
        if len({r.person_id for r in top}) == 1 and top[0].person_id is not None:
            return "rule", top[0]
    if not unconditional:
        return "ask", [r for r in rules if r.person_id]
    if len({r.person_id for r in unconditional}) == 1 and unconditional[0].person_id is not None:
        return "rule", unconditional[0]
    return "ask", [r for r in unconditional if r.person_id]


@dataclass
class Candidate:
    person_id: str
    name: str
    status: str
    call_level: str | None
    score: float
    reason: str


@dataclass
class Resolution:
    raw: str
    comparison_key: str
    status: Status
    person_id: str | None = None
    canonical_name: str | None = None
    method: str | None = None
    score: float | None = None
    reason: str = ""
    candidates: list[Candidate] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    @property
    def matched(self) -> bool:
        return self.status == "matched"

    @property
    def only_similar(self) -> bool:
        """Nothing owns this name exactly; the candidates are look-alike names only."""
        return not self.matched and all(c.reason == "similar name" for c in self.candidates)

    def as_dict(self) -> dict:
        return asdict(self)


def _tokens(name: str) -> list[str]:
    return [t for t in "".join(c if c.isalnum() else " " for c in display_text(name).casefold()).split() if t]


class MemberIndex:
    """Everything needed to resolve names for one request, loaded once."""

    def __init__(self, people: Iterable[Person], rules: Iterable[MemberResolutionRule]):
        # Sort so that ties and candidate order never depend on database row order.
        self.people = sorted(people, key=lambda p: (p.canonical_name.casefold(), str(p.id)))
        self.by_id = {p.id: p for p in self.people}
        self.canonical: dict[str, set[UUID]] = defaultdict(set)
        self.alias: dict[str, set[UUID]] = defaultdict(set)
        self.token_owners: dict[str, set[UUID]] = defaultdict(set)
        self.labels: list[tuple[str, UUID]] = []
        for person in self.people:
            key = member_key(person.canonical_name)
            if key:
                self.canonical[key].add(person.id)
                self.labels.append((key, person.id))
            for token in _tokens(person.canonical_name):
                self.token_owners[token].add(person.id)
            for alias in sorted(person.aliases, key=lambda a: a.alias):
                akey = member_key(alias.alias)
                if akey:
                    self.alias[akey].add(person.id)
                    self.labels.append((akey, person.id))
        self.rules: dict[str, list[MemberResolutionRule]] = defaultdict(list)
        for rule in rules:
            if rule.active and (rule.person_id is None or rule.person_id in self.by_id):
                self.rules[rule.form_key].append(rule)
        for key in self.rules:
            self.rules[key].sort(key=lambda r: (-r.priority, str(r.person_id), str(r.id)))

    @classmethod
    def load(cls, db: Session) -> "MemberIndex":
        people = db.scalars(select(Person).options(
            selectinload(Person.aliases),
            selectinload(Person.call_changes),
            selectinload(Person.call_level_changes),
            selectinload(Person.designations),
            selectinload(Person.postings).selectinload(PersonPosting.unit),
        )).all()
        rules = db.scalars(select(MemberResolutionRule)).all()
        return cls(people, rules)

    # -- helpers -------------------------------------------------------------------------

    def exact_owners(self, name_or_key: str) -> set[UUID]:
        """Members whose canonical name or saved alias has exactly this comparison key."""
        key = member_key(name_or_key)
        return set(self.canonical.get(key, set())) | set(self.alias.get(key, set()))

    def _call_level_on(self, person: Person, day: date | None) -> str | None:
        from app.services.member_profiles import call_level_on

        level = call_level_on(person, day) if day else person.call_level
        level = normalize_call_level(level) if level else None
        return level if level in CALL_LEVELS else None

    def _candidate(self, person: Person, score: float, reason: str, day: date | None) -> Candidate:
        return Candidate(str(person.id), person.canonical_name, person.active_status,
                         self._call_level_on(person, day), round(score, 3), reason)

    def _shared_short_form(self, key: str, owners: set[UUID]) -> bool:
        """A one-word alias that is part of several people's names is not safe to trust."""
        if key not in self.token_owners:
            return False
        return len(self.token_owners[key] | owners) > 1

    def similar(self, key: str, day: date | None, exclude: set[UUID] = frozenset()) -> list[Candidate]:
        best: dict[UUID, float] = {}
        for label, person_id in self.labels:
            if person_id in exclude:
                continue
            score = SequenceMatcher(None, key, label).ratio()
            if len(key) >= 4 and (label.startswith(key) or key.startswith(label)):
                score = max(score, 0.9)
            if score >= FUZZY_FLOOR and score > best.get(person_id, 0):
                best[person_id] = score
        ranked = sorted(best.items(), key=lambda kv: (-kv[1], self.by_id[kv[0]].canonical_name.casefold()))
        return [self._candidate(self.by_id[pid], s, "similar name", day) for pid, s in ranked[:MAX_CANDIDATES]]

    def _finish(self, result: Resolution, person: Person, purpose: Purpose, day: date | None) -> Resolution:
        """Apply the status safety rules to a proposed match."""
        result.person_id, result.canonical_name = str(person.id), person.canonical_name
        if person.active_status == "active" or (purpose == "history" and person.active_status == "historical"):
            if person.active_status == "historical":
                result.warnings.append(f"{person.canonical_name} is a historical member")
            result.status = "matched"
            return result
        # Never assign an archived/historical/inactive member without a reviewer choosing them.
        result.warnings.append(f"{person.canonical_name} is {person.active_status}; confirm before assigning")
        result.candidates.insert(0, self._candidate(person, result.score or 1.0, result.method or "match", day))
        result.status, result.person_id, result.canonical_name = "needs_review", None, None
        result.reason = f"Matches {person.canonical_name}, who is {person.active_status}"
        return result

    # -- the resolver --------------------------------------------------------------------

    def resolve(self, raw: str, ctx: ResolutionContext | None = None, *, person_id: UUID | str | None = None,
                purpose: Purpose = "live") -> Resolution:
        ctx = ctx or ResolutionContext()
        raw = display_text(raw or "")
        key = member_key(raw)
        result = Resolution(raw=raw, comparison_key=key, status="not_found")

        if person_id:
            try:
                person = self.by_id.get(UUID(str(person_id)))
            except ValueError:
                person = None
            if person is None:
                raise UnknownMemberId(f"Member ID {person_id} does not exist", raw_name=raw)
            result.method, result.score, result.reason = "member_id", 1.0, "Chosen by member ID"
            # An explicit choice by a reviewer is the confirmation the safety rule asks for.
            result.person_id, result.canonical_name, result.status = str(person.id), person.canonical_name, "matched"
            if person.active_status != "active":
                result.warnings.append(f"{person.canonical_name} is {person.active_status}")
            return result
        if not key:
            result.reason = "No name given"
            return result

        outcome, found = match_rules(self.rules.get(key, []), ctx)
        if outcome == "rule":
            result.method, result.score = ("context_rule" if is_conditional(found) else "approved_rule"), 1.0
            result.reason = (f"Rule for '{found.form}': {found.note or 'context'}" if is_conditional(found)
                             else f"Approved name form '{found.form}'")
            return self._finish(result, self.by_id[found.person_id], purpose, ctx.on)
        if outcome == "ask":
            # The form means different people in different contexts and none fits this row.
            ids = sorted({r.person_id for r in found}, key=lambda i: self.by_id[i].canonical_name.casefold())
            result.candidates = [self._candidate(self.by_id[i], 1.0, "possible by call level / date", ctx.on)
                                 for i in ids][:MAX_CANDIDATES]
            result.status = "needs_review"
            result.reason = (f"'{raw}' means different people by call level or date; "
                             + ("this row's context matches none of the rules" if ctx.known
                                else "this row has no call level"))
            return result

        owners_canonical = self.canonical.get(key, set())
        owners_alias = self.alias.get(key, set())
        if len(owners_canonical) == 1:
            result.method, result.score, result.reason = "canonical_exact", 1.0, "Exact department member name"
            return self._finish(result, self.by_id[next(iter(owners_canonical))], purpose, ctx.on)
        owners = owners_canonical | owners_alias
        if len(owners) == 1 and not self._shared_short_form(key, owners):
            result.method, result.score, result.reason = "approved_alias", 1.0, "Approved alias"
            return self._finish(result, self.by_id[next(iter(owners))], purpose, ctx.on)

        if owners or (key in self.token_owners and len(self.token_owners[key]) > 1):
            pool = owners | self.token_owners.get(key, set())
            people = sorted((self.by_id[i] for i in pool), key=lambda p: p.canonical_name.casefold())
            if ctx.call_level:
                fit = [p for p in people if self._call_level_on(p, ctx.on) == ctx.call_level
                       and p.active_status in (("active", "historical") if purpose == "history" else ("active",))]
                if len(fit) == 1:
                    result.method, result.score = "context", 0.95
                    result.reason = f"Only {fit[0].canonical_name} named '{raw}' is on {ctx.call_level.replace('_', ' ').lower()}"
                    result.warnings.append("Matched by call level; check the review list")
                    return self._finish(result, fit[0], purpose, ctx.on)
            result.candidates = [self._candidate(p, 1.0, "shares this name", ctx.on) for p in people][:MAX_CANDIDATES]
            result.status = "ambiguous" if len(owners) > 1 else "needs_review"
            result.reason = f"'{raw}' could be {len(people)} different members"
            return result

        result.candidates = self.similar(key, ctx.on)
        if result.candidates:
            result.status = "needs_review"
            result.reason = "No exact match; similar names shown for review"
        else:
            result.reason = "No department member with this name"
        return result

    # -- duplicate prevention ------------------------------------------------------------

    def near_duplicates(self, name: str, threshold: float = 0.86) -> list[Candidate]:
        """Existing members a new member with this name might duplicate (any status)."""
        key = member_key(name)
        if not key:
            return []
        found: dict[UUID, float] = {}
        for label, person_id in self.labels:
            score = SequenceMatcher(None, key, label).ratio()
            contained = min(len(key), len(label)) >= 6 and (key in label or label in key)
            if score >= threshold or contained or label == key:
                found[person_id] = max(found.get(person_id, 0), 1.0 if label == key else max(score, 0.9 if contained else 0))
        ranked = sorted(found.items(), key=lambda kv: (-kv[1], self.by_id[kv[0]].canonical_name.casefold()))
        return [self._candidate(self.by_id[pid], s, "possible duplicate", None) for pid, s in ranked[:MAX_CANDIDATES]]


def resolve_rows(index: MemberIndex, rows: list[dict], *, purpose: Purpose = "live") -> list[Resolution]:
    """Resolve a whole file and flag contradictions between its rows.

    rows: dicts with raw_name and optional person_id, call_level, on, duty_area.
    The same written name in the same context always resolves the same way; when one name
    resolves to different people (by call level) or two spellings land on one person on the
    same day, each affected row gets a warning so the reviewer sees it.
    """
    results = []
    for row in rows:
        ctx = ResolutionContext.build(row.get("call_level"), row.get("on"), row.get("duty_area"))
        results.append(index.resolve(row.get("raw_name", ""), ctx, person_id=row.get("person_id"), purpose=purpose))
    by_key: dict[str, set[str]] = defaultdict(set)
    by_person_day: dict[tuple[str, date | None], set[str]] = defaultdict(set)
    for row, res in zip(rows, results):
        if res.person_id:
            by_key[res.comparison_key].add(res.person_id)
            by_person_day[(res.person_id, row.get("on"))].add(res.comparison_key)
    for row, res in zip(rows, results):
        if res.person_id and len(by_key[res.comparison_key]) > 1:
            res.warnings.append(f"'{res.raw}' resolves to {len(by_key[res.comparison_key])} different members in this file")
        if res.person_id and len(by_person_day[(res.person_id, row.get('on'))]) > 1:
            res.warnings.append(f"{res.canonical_name} appears under different spellings on the same day")
    return results
