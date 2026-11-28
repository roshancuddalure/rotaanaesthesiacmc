"""Dated unit membership is mandatory for ordinary AND extra duties.

Owner clarification, 23 Nov 2026: unposted people and people posted only outside
the month's included units are ineligible. Never synthesize a posting.
"""


def has_month_unit_posting(person_id, postings, first=None, last=None):
    return any(p.person_id == person_id and p.unit_id is not None
               and (last is None or p.starts_on <= last)
               and (first is None or p.ends_on is None or p.ends_on >= first)
               for p in postings)


def has_dated_scope_posting(person_id, postings, day, included_unit_ids):
    return any(p.person_id == person_id and p.unit_id is not None
               and (included_unit_ids is None or p.unit_id in included_unit_ids)
               and p.starts_on <= day and (p.ends_on is None or p.ends_on >= day)
               for p in postings)
