# Duty Rota Software Planning Hub

This folder is the project memory for the duty rota software. It should capture the product idea, assumptions, architecture decisions, domain rules, open questions, and development logs so future development and debugging do not depend on memory or chat history.

## Current Planning Documents

- `01_product_understanding.md` - what the system is meant to do and who it serves.
- `02_architecture_and_tech_stack.md` - proposed web app architecture, services, data flow, and stack choices.
- `03_domain_rules_and_decision_trees.md` - duty classification, rota parsing, leave, unit, and fairness logic.
- `04_open_questions.md` - questions to clarify before implementation decisions become expensive.
- `05_confirmed_decisions.md` - user-confirmed answers that should not be repeatedly asked.
- `06_project_operating_principles.md` - evidence-based work rules and logging discipline.
- `07_phased_roadmap.md` - implementation phases and checklists.
- `08_new_session_checklist.md` - startup checklist for future sessions.
- `development_log.md` - chronological record of analysis, decisions, and future changes.

## Reference Files Reviewed

- `d:\00 ANESTHESIA CMC\rota\algo\CMC_Anaesthesia_Duty_Analysis_Guide.md`
- `d:\00 ANESTHESIA CMC\rota\Full analysis\Data2025-26\output\CMC_Duty_Analysis_v5.html`

## Working Principle

The core product should not be only a rota display tool. It should become a rule-aware rota operations platform:

1. Import messy Excel and text inputs.
2. Normalize people, units, dates, call levels, postings, and leave.
3. Validate and explain conflicts.
4. Generate or assist rota allocation.
5. Produce analysis dashboards and audit-quality reports.
6. Preserve all decisions and overrides for accountability.

## Current Confirmed Direction

- First version should support both existing rota import/analysis and new rota creation.
- Initial users are rota admins only.
- Final rota output must export to Excel.
- Leave balance calculation is not needed initially.
- At least 24 hours must separate two 24-hour duties for the same person.
- Duty limits should be configurable from the admin panel.
- Historical Jan 2025-May 2026 data should be imported as seed data.
- Offline self-contained HTML report export is desirable.
