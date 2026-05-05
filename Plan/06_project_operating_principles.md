# Project Operating Principles

These principles are derived from `d:\Coding\AI training\universal rule.txt` and are mandatory for this project.

## Evidence-Based Work

Use evidence, not guesswork.

Before making a technical or domain decision:

1. Check existing project planning files.
2. Check attached/reference domain files.
3. Check existing code once code exists.
4. Use official documentation or reliable primary sources when external knowledge is needed.
5. Log the conclusion and evidence in the appropriate project file.

## No Silent Assumptions

If a decision depends on unknown department policy, data shape, or deployment constraint:

- mark it as an assumption,
- add it to open questions,
- choose the safest reversible implementation if work must proceed.

## Learning Pass Rule

If needed knowledge is missing:

1. Do a learning pass before implementation.
2. Prefer official docs for tools, frameworks, APIs, and libraries.
3. For domain-specific uncertainty, prefer project reference files and user-provided data.
4. Record what was learned in the planning docs, development log, or future skill/memory file if one is established for this project.

## Logging Rule

Important discoveries, decisions, fixes, and rule changes must be logged.

Use:

- `Plan/development_log.md` for chronological work notes.
- `Plan/05_confirmed_decisions.md` for user-confirmed answers.
- `Plan/04_open_questions.md` for unresolved questions.
- `Plan/03_domain_rules_and_decision_trees.md` for rota/leave/rule logic.
- `Plan/07_phased_roadmap.md` for phase-level implementation changes.

## Source Traceability Rule

For rota imports and analytics, every important computed result should be explainable from:

- source file,
- sheet,
- row/column or text line,
- raw value,
- cleaned value,
- rule used,
- final normalized record,
- warnings or manual override.

## Rule Versioning Rule

Duty rules, leave rules, spacing rules, and configurable limits should be versioned or at least stored with effective dates so historical analysis can be reproduced.

## Practical Rule

The system should remain usable by rota admins. Advanced automation should not hide decisions. Whenever possible, show:

- why a person is eligible,
- why a person is blocked,
- why a warning exists,
- why a report number was counted.

