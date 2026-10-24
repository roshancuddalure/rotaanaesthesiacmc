# Current role visibility and unavailable links

This is a frontend visibility inventory and test record. It describes the existing policy; this batch does not change roles, permissions, API contracts or backend enforcement. The authenticated API remains authoritative for every protected operation. No real accounts or production data were used.

## Navigation

| Context | Workflow navigation | Admin navigation | Limits |
| --- | --- | --- | --- |
| Signed out | Absent; sign-in and recovery tabs available | Absent | Absent |
| Rota board member | All ten workflow sections | Absent | Absent |
| Head of Department | All ten workflow sections | Absent | Absent |
| Computer admin | All ten workflow sections | Eight admin sections | Absent |
| Superadmin | All ten workflow sections | Eight admin sections | Present |

Workflow sections are Overview, Duty Analysis, Department Members, Leave, Unit Management, Rota Setup, Rota Template, Rota Review, Publish & Export, and User Guide. Admin sections are Rota Rules, Eligibility Groups, Mappings, Past Duties, Login Accounts, Diagnostics, Compute Settings and Recycle bin. Limits is an additional superadmin section. This list comes from `NAV_ITEMS` and the unchanged `visibleNavItems()` policy in `frontend/src/main.ts`.

On mobile, Overview, Leave, Units and Rota are primary destinations. More lists the remaining visible sections in the same order as desktop navigation. Its list is checked against the role-specific desktop list rather than assuming that hiding a sidebar removes the mobile entry point.

## Operational controls inspected and exercised

| Existing control | Board member / HOD | Computer admin / superadmin |
| --- | --- | --- |
| Members: Add member / Import CSV | Absent | Present when the existing admin audit data loads |
| Leave: Add leave / Import leave CSV | Present | Present |
| Leave: Approve all pending | Absent | Present; existing pending-count disabling remains |
| Units: Add dated posting | Present | Present |
| Units: Add department unit | Absent | Present |

These assertions establish visibility of the listed controls and successful navigation to their screens. Their mutation outcomes belong to separate action-specific suites. They do not certify every row action, profile tab, generation action or server authorization path.

Publish visibility is distinct from publish permission. The existing publish renderer uses returned `permissions` when supplied and its existing role fallback otherwise. Navigating to Publish & Export never establishes authority to publish. Profile editing also requires a separate action/permission review; this inventory does not infer editable fields from the existence of a Members link.

The backend role registry already contains `hod`. The current frontend `UserAccount.role` union omits it while runtime UI branches elsewhere recognize it. Tests include its existing runtime value; this batch does not alter that type or any permission decision.

## Unavailable links

Previously an unknown or role-limited hash could display Overview without an explanation. A persistent callout now identifies an unknown link or a section unavailable to the current account, explains that Overview is displayed, and provides **Continue to Overview**. The button performs actual navigation, normalizes the hash to Overview and focuses its heading. Ordinary navigation clears the callout.

The callout uses fixed copy. Arbitrary URL values are not inserted into its HTML. It sits outside the asynchronously rendered screen so a background Overview response does not erase the explanation. It adds no request and preserves the existing fallback and role gates. Signed-out startup continues to show authentication, with no protected navigation or availability callout.

## Evidence and limits

`qa-role-navigation.json` records 24 actual-app contexts: four mocked role values, 320/1280 widths, and Chromium/Firefox/WebKit. Each checks exact sidebar navigation, mobile More where applicable, initial unknown-link explanation, its keyboard action, one role-limited link (an unknown link for superadmin), operational toolbar visibility, month continuity and notice cleanup. Requests are GET-only against the disposable in-memory fixture at port 8031. Restricted-link transitions do not request Accounts or Limits data. These tests do not exercise all restricted routes or prove server permission enforcement.

`qa-signed-out-navigation.json` records six signed-out layouts. An Accounts URL shows authentication, protected navigation stays absent, password-manager autocomplete values remain, and keyboard switching to recovery and back performs the actual form transition without a credential submission.

The 24 callout surfaces have zero tagged axe findings. Screenshots for all four signed-in role values at 320/1280 are in `screenshots/recovery/route-*.png`; the coordinator visually inspected the HOD mobile and superadmin desktop examples. Automated checks and emulation do not replace native screen-reader or physical-device checks, which remain pending. This record is partial evidence for the full 260-item programme, not a completion certificate.

The mobile screenshot also exposed a separate Overview layout defect: Template wraps mid-word in a narrow workflow tile. It is recorded for a dedicated responsive correction; the availability callout itself wraps without page overflow.

Follow-up: the Template word-break is now corrected for the 30 tested Overview layouts in `qa-overview-steps.json`; see `reviews/overview-style-inventory-current.json`. The original screenshot and finding remain historical. The24role layouts were rerun after this CSS change, now hashing styles.css as well.
