"""Availability targets follow covered duties, preserving approved pooled demand.

The model rounds only at a bounded integer precision. Exact rational targets are
used independently for reports and positive gap certificates. No clinical rule
is selected here.
"""
from collections import Counter, defaultdict
from fractions import Fraction
from math import lcm

from app.services.allocation_fairness_policy import AVAILABILITY, SCALE, fairness_mode
from app.services.rota_safety import required_call_levels, rule_for_slot, rules_groups


def enabled(context):
    return (fairness_mode(getattr(context, 'rules', None)) == AVAILABILITY
            and getattr(context, 'fairness_available_days', None) is not None)


class CoveredTargets:
    def __init__(self, context, slots):
        self.members = {str(p): level for p, level in context.fairness_member_levels.items()}
        groups = defaultdict(list)
        for p, level in self.members.items():
            groups[level].append(p)
        weights = {str(p): max(0, round(day * 1440))
                   for p, day in context.fairness_available_days.items()}
        totals = {level: sum(weights.get(p, 0) for p in people) for level, people in groups.items()}
        self.person_weights = {p: (Fraction(weights.get(p, 0), totals[level]) if totals[level] else Fraction(0))
                               for p, level in self.members.items()}
        self.group_counts = {level: len(people) for level, people in groups.items()}
        attached = rules_groups(context.rules)

        def category(slot):
            return tuple(sorted(required_call_levels(slot, rule_for_slot(slot, context.rules), attached)))

        fixed = {str(a.duty_slot.id): a.duty_slot
                 for p, rows in context.assignments_by_person.items() if str(p) in self.members
                 for a in rows}
        # Slots under decision replace the same logical saved duty, never double count.
        fixed = {s: slot for s, slot in fixed.items() if s not in slots}
        self.fixed = Counter(category(slot) for slot in fixed.values())
        self.slot_categories = {s: category(slot) for s, slot in slots.items()}
        self.categories = set(self.fixed) | set(self.slot_categories.values())
        self.fractions = {}
        for levels in self.categories:
            denominator = sum(self.group_counts.get(level, 0) for level in levels)
            split = {level: (Fraction(self.group_counts.get(level, 0), denominator)
                             if denominator else Fraction(1, len(levels))) for level in levels}
            self.fractions[levels] = {p: split.get(level, Fraction(0)) * self.person_weights[p]
                                     for p, level in self.members.items()}
        # At most N contributions: coefficient error <1/(16*SCALE) per person's
        # target, then <=.5/SCALE division rounding. Pairwise error <2/SCALE.
        self.maximum = len(fixed) + len(slots)
        self.precision = SCALE * max(1, self.maximum) * 8
        safe_precision = (2**60) // max(1, self.maximum*SCALE)
        self.precisions = {}
        for p in self.members:
            exact = lcm(*(fractions[p].denominator for fractions in self.fractions.values()))
            self.precisions[p] = exact if exact <= safe_precision else self.precision
        self.coefficients = {cat: {p: self.nearest(share * self.precisions[p])
                                   for p, share in fractions.items()}
                             for cat, fractions in self.fractions.items()}

    @staticmethod
    def nearest(value):
        return (2 * value.numerator + value.denominator) // (2 * value.denominator)

    def covered_categories(self, choices):
        covered = self.fixed.copy()
        covered.update(self.slot_categories[s] for s in choices)
        return covered

    def exact(self, choices):
        covered = self.covered_categories(choices)
        return {p: sum((self.fractions[cat][p] * count for cat, count in covered.items()), Fraction(0))
                for p in self.members}

    def scaled(self, choices):
        covered = self.covered_categories(choices)
        return {p: (sum(self.coefficients[cat][p] * count for cat, count in covered.items())
                    * SCALE + self.precisions[p] // 2) // self.precisions[p] for p in self.members}

    def add_model(self, model, variables):
        rows = defaultdict(list)
        for (s, _), variable in variables.items():
            rows[self.slot_categories[s]].append(variable)
        category_counts = {}
        for i, cat in enumerate(sorted(self.categories)):
            count = model.new_int_var(0, self.maximum, f'covered_category:{i}')
            model.add(count == self.fixed[cat] + sum(rows[cat]))
            category_counts[cat] = count
        targets = {}
        for p in self.members:
            precision = self.precisions[p]
            numerator = model.new_int_var(0, self.maximum * precision, f'covered_numerator:{p}')
            model.add(numerator == sum(self.coefficients[cat][p] * count
                                       for cat, count in category_counts.items()))
            target = model.new_int_var(0, self.maximum * SCALE, f'covered_target:{p}')
            model.add_division_equality(target, numerator * SCALE + precision // 2, precision)
            targets[p] = target
        return targets


def exact_targets(context, choices, slots):
    if enabled(context):
        return {p: float(target) for p, target in CoveredTargets(context, slots).exact(choices).items()}
    return {str(p): target for p, target in (getattr(context, 'fairness_person_targets', None) or {}).items()}
