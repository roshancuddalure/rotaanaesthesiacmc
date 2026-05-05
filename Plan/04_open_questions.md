# Open Questions

These questions should be clarified before implementation moves from planning to schema and MVP build.

## Scope

1. Answered: first version should both import/analyze existing rotas and create future rotas.
2. Which rota types must be supported first: Anaesthesia main rota only, or Main + RC + CB + PB + ICU/Pain/DRP from day one?
3. Is the system only for Anaesthesia CMC, or should it be configurable for other departments later?

## Users and Permissions

4. Answered for MVP: rota admins are the only users initially. Need exact admin permission levels later.
5. Who can approve leave?
6. Who can publish a rota?
7. Answered for MVP: individual staff login is not required initially. Final output should export to Excel.
8. Is audit history legally/administratively important enough that every edit needs user/time/reason tracking?

## Leave Management

9. What leave types exist?
10. Is leave measured in full days only, or half days/partial days too?
11. Answered for MVP: leave balances do not need to be calculated now, but may be added later.
12. Can leave be requested after duty allocation?
13. What should happen if approved leave conflicts with an existing duty?

## Rota Rules

14. Answered: at least 24 hours should exist between two 24-hour duties for the same person.
15. Answered directionally: duty limits should be configurable in admin panel. Need default values later.
16. Are there maximum weekend duties per month?
17. Are some people eligible only for specific campuses or duty types?
18. Should units be balanced equally across campuses?
19. Are there rules about post-duty off days?
20. Are fifth call, floating consultant, CART, CHAD, and RUHSA assigned by the same rota admin or separate teams?

## Data Imports

21. What are the exact Excel input files we need for one normal month?
22. Will the original Excel formats continue, or may they change?
23. What notepad/text list formats should be supported?
24. Should users map columns manually when a new Excel format appears?
25. Do we need to keep original uploaded files permanently?

## Analysis and Reporting

26. Which reports are essential for MVP?
27. Should reports be exportable as Excel, PDF, and HTML?
28. Answered: self-contained offline HTML report is desirable if possible.
29. Answered: historical data from Jan 2025 to May 2026 should be imported as seed data.

## Deployment

30. Where should the app be hosted?
31. Does it need hospital intranet access only, or public internet with login?
32. What authentication method is preferred: email/password, Google/Microsoft login, or hospital SSO?
33. Are there privacy/security requirements for personnel and leave data?

## Product Direction

34. Should the generator be assistive first, with human final decision, or fully automatic eventually?
35. Should the app optimize for fairness only, or also continuity of unit/campus coverage?
36. Who is the final authority for resolving ambiguous names and rule exceptions?
