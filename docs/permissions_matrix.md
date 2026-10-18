# Duty Rota permission matrix

Role permissions are returned by `/api/v1/auth/me`, sign-in and `/api/v1/auth/permissions`. The backend checks every privileged action; menu visibility and disabled controls only explain those checks to users. Unknown/inactive roles cannot authenticate.

| Action category | Rota board | HOD | Computer admin | Superadmin |
|---|---|---|---|---|
| View workflow, member identities, approved exports and own account | Yes | Yes | Yes | Yes |
| Manage leave, postings, monthly scope, template, assignments, review and exchanges | Yes | Yes | Yes | Yes |
| Member master create/edit/archive/restore, aliases, designations, cleanup/merge | No | No | Yes | Yes |
| Dated call changes and private Admin/HOD comments | No | Yes | Yes | Yes |
| Rules, eligibility groups, mappings, member/past imports and diagnostics | No | No | Yes | Yes |
| Leave/unit imports and their history | Yes | Yes | Yes | Yes |
| Final publication approval | Yes | Yes | No | Yes |
| Manage/provision ordinary login accounts and issue recovery codes | No | No | Yes | Yes |
| Grant/recover superadmin access | No | No | No | Yes |

Computer admins maintain the data and account infrastructure; final publication is a board/HOD/superadmin approval. Board and HOD accounts retain monthly workflow operations. Private profile comments are never included for a board account. Legacy server-folder history rebuild is retired (HTTP 410); it is not a supported upload pathway.

Public endpoints are health, catalog metadata, sign-in, recovery instructions and reset using an administrator-issued code. They do not expose personnel or reset codes. Authenticated recovery codes expire after 30 minutes and invalidate older codes.

Server gate legend: `current_user` = recognized active authenticated role; `require_admin` = computer admin/superadmin; `profile_manager` = admin/HOD; `require_publisher` = board/HOD/superadmin; `require_superadmin` = superadmin.

The inventory below is generated from router, decorator and function-parameter dependencies by `tools/permissions_manifest.py`. Runtime regressions verify anonymous rejection, board/HOD versus admin behavior, superadmin grant/recovery restrictions and all four publication roles. A regression compares this inventory with OpenAPI and fails if a new non-public route lacks a declared gate.

## Complete API action inventory

| Method | Path | Declared server gates | Additional rule | Source |
|---|---|---|---|---|
| GET | `/api/health` | Public |  | `backend/app/api/v1/health.py:7` |
| GET | `/api/v1/admin/call-clusters` | require_admin |  | `backend/app/api/v1/call_clusters.py:114` |
| POST | `/api/v1/admin/call-clusters` | require_admin |  | `backend/app/api/v1/call_clusters.py:122` |
| PUT | `/api/v1/admin/call-clusters/{cluster_id}` | require_admin |  | `backend/app/api/v1/call_clusters.py:144` |
| GET | `/api/v1/admin/call-clusters/{cluster_id}/members` | require_admin |  | `backend/app/api/v1/call_clusters.py:171` |
| PUT | `/api/v1/admin/call-clusters/{cluster_id}/members` | require_admin |  | `backend/app/api/v1/call_clusters.py:180` |
| POST | `/api/v1/admin/imports/historical/run` | require_admin |  | `backend/app/api/v1/historical_imports.py:37` |
| GET | `/api/v1/admin/imports/historical/status` | require_admin |  | `backend/app/api/v1/historical_imports.py:24` |
| GET | `/api/v1/admin/mappings` | require_admin |  | `backend/app/api/v1/admin_mappings.py:172` |
| POST | `/api/v1/admin/mappings` | require_admin |  | `backend/app/api/v1/admin_mappings.py:188` |
| GET | `/api/v1/admin/mappings/options` | require_admin |  | `backend/app/api/v1/admin_mappings.py:161` |
| POST | `/api/v1/admin/mappings/scan-historical` | require_admin |  | `backend/app/api/v1/admin_mappings.py:232` |
| PUT | `/api/v1/admin/mappings/{mapping_id}` | require_admin |  | `backend/app/api/v1/admin_mappings.py:213` |
| GET | `/api/v1/admin/members` | current_user |  | `backend/app/api/v1/members.py:192` |
| POST | `/api/v1/admin/members` | current_user, require_admin |  | `backend/app/api/v1/members.py:203` |
| GET | `/api/v1/admin/members/audit` | current_user |  | `backend/app/api/v1/members.py:340` |
| POST | `/api/v1/admin/members/auto-merge-duplicates` | current_user, require_admin |  | `backend/app/api/v1/members.py:400` |
| POST | `/api/v1/admin/members/cleanup-invalid` | current_user, require_admin |  | `backend/app/api/v1/members.py:393` |
| GET | `/api/v1/admin/members/dedupe-candidates` | current_user |  | `backend/app/api/v1/members.py:320` |
| POST | `/api/v1/admin/members/import/apply` | require_admin |  | `backend/app/api/v1/member_import.py:164` |
| GET | `/api/v1/admin/members/import/history` | require_admin |  | `backend/app/api/v1/member_import.py:77` |
| GET | `/api/v1/admin/members/import/history/{batch_id}` | require_admin |  | `backend/app/api/v1/member_import.py:88` |
| POST | `/api/v1/admin/members/import/inspect` | require_admin |  | `backend/app/api/v1/member_import.py:144` |
| POST | `/api/v1/admin/members/import/preview` | require_admin |  | `backend/app/api/v1/member_import.py:152` |
| GET | `/api/v1/admin/members/import/template` | require_admin |  | `backend/app/api/v1/member_import.py:28` |
| GET | `/api/v1/admin/members/invalid` | current_user |  | `backend/app/api/v1/members.py:331` |
| POST | `/api/v1/admin/members/merge` | current_user, require_admin |  | `backend/app/api/v1/members.py:424` |
| POST | `/api/v1/admin/members/prefill-call-levels` | current_user, require_admin |  | `backend/app/api/v1/members.py:415` |
| POST | `/api/v1/admin/members/reconcile-trusted-roster` | current_user, require_admin |  | `backend/app/api/v1/members.py:405` |
| POST | `/api/v1/admin/members/reset-from-trusted-roster` | current_user, require_admin |  | `backend/app/api/v1/members.py:410` |
| PUT | `/api/v1/admin/members/{person_id}` | current_user, require_admin |  | `backend/app/api/v1/members.py:233` |
| POST | `/api/v1/admin/members/{person_id}/aliases` | current_user, require_admin |  | `backend/app/api/v1/members.py:283` |
| POST | `/api/v1/admin/members/{person_id}/archive` | current_user, require_admin |  | `backend/app/api/v1/members.py:263` |
| POST | `/api/v1/admin/members/{person_id}/designations` | current_user, require_admin |  | `backend/app/api/v1/members.py:295` |
| POST | `/api/v1/admin/members/{person_id}/restore` | current_user, require_admin |  | `backend/app/api/v1/members.py:273` |
| GET | `/api/v1/admin/past-duties/history/{batch_id}` | require_admin |  | `backend/app/api/v1/past_duties.py:107` |
| POST | `/api/v1/admin/past-duties/inspect` | require_admin |  | `backend/app/api/v1/past_duties.py:149` |
| PUT | `/api/v1/admin/past-duties/policy` | require_admin |  | `backend/app/api/v1/past_duties.py:133` |
| GET | `/api/v1/admin/past-duties/status` | require_admin |  | `backend/app/api/v1/past_duties.py:72` |
| GET | `/api/v1/admin/past-duties/template` | require_admin |  | `backend/app/api/v1/past_duties.py:53` |
| POST | `/api/v1/admin/past-duties/{action}` | require_admin |  | `backend/app/api/v1/past_duties.py:157` |
| GET | `/api/v1/admin/rota-rules/phase-one` | require_admin |  | `backend/app/api/v1/rota_rules.py:63` |
| PUT | `/api/v1/admin/rota-rules/phase-one` | require_admin |  | `backend/app/api/v1/rota_rules.py:72` |
| GET | `/api/v1/analysis/dashboard` | current_user |  | `backend/app/api/v1/analysis.py:12` |
| GET | `/api/v1/analysis/manual-review` | current_user |  | `backend/app/api/v1/analysis.py:22` |
| GET | `/api/v1/analysis/preflight` | current_user |  | `backend/app/api/v1/analysis.py:17` |
| GET | `/api/v1/auth/accounts` | require_admin |  | `backend/app/api/v1/auth.py:198` |
| POST | `/api/v1/auth/accounts` | require_admin | Granting superadmin additionally requires a superadmin. | `backend/app/api/v1/auth.py:165` |
| POST | `/api/v1/auth/accounts/{user_id}/recovery-code` | require_admin | Recovering a superadmin additionally requires a superadmin. | `backend/app/api/v1/auth.py:215` |
| POST | `/api/v1/auth/change-password` | current_user |  | `backend/app/api/v1/auth.py:238` |
| POST | `/api/v1/auth/forgot-password` | Public |  | `backend/app/api/v1/auth.py:206` |
| GET | `/api/v1/auth/me` | current_user |  | `backend/app/api/v1/auth.py:144` |
| PUT | `/api/v1/auth/me` | current_user |  | `backend/app/api/v1/auth.py:149` |
| GET | `/api/v1/auth/permissions` | current_user |  | `backend/app/api/v1/auth.py:130` |
| POST | `/api/v1/auth/reset-password` | Public |  | `backend/app/api/v1/auth.py:227` |
| POST | `/api/v1/auth/sign-in` | Public |  | `backend/app/api/v1/auth.py:135` |
| GET | `/api/v1/diagnostics/summary` | require_admin |  | `backend/app/api/v1/diagnostics.py:50` |
| GET | `/api/v1/imports/{kind}/history` | current_user | Members/past history additionally requires admin; leave/unit history follows authenticated workflow access. | `backend/app/api/v1/import_history.py:41` |
| GET | `/api/v1/imports/{kind}/history/{batch_id}` | current_user | Members/past history additionally requires admin; leave/unit history follows authenticated workflow access. | `backend/app/api/v1/import_history.py:62` |
| GET | `/api/v1/imports/{kind}/history/{batch_id}/rejected.csv` | current_user | Members/past history additionally requires admin; leave/unit history follows authenticated workflow access. | `backend/app/api/v1/import_history.py:74` |
| GET | `/api/v1/leave/calendar` | current_user |  | `backend/app/api/v1/leave.py:220` |
| POST | `/api/v1/leave/import-apply` | current_user |  | `backend/app/api/v1/leave.py:268` |
| POST | `/api/v1/leave/import-preview` | current_user |  | `backend/app/api/v1/leave.py:251` |
| GET | `/api/v1/leave/pressure` | current_user |  | `backend/app/api/v1/leave.py:238` |
| GET | `/api/v1/leave/requests` | current_user |  | `backend/app/api/v1/leave.py:148` |
| POST | `/api/v1/leave/requests` | current_user |  | `backend/app/api/v1/leave.py:161` |
| PUT | `/api/v1/leave/requests/{leave_id}` | current_user |  | `backend/app/api/v1/leave.py:186` |
| POST | `/api/v1/leave/requests/{leave_id}/cancel` | current_user |  | `backend/app/api/v1/leave.py:208` |
| POST | `/api/v1/members/{person_id}/call-changes` | current_user, profile_manager |  | `backend/app/api/v1/member_profiles.py:191` |
| POST | `/api/v1/members/{person_id}/comments` | current_user, profile_manager |  | `backend/app/api/v1/member_profiles.py:219` |
| GET | `/api/v1/members/{person_id}/profile` | current_user | Private notes and management controls additionally restricted to admin/HOD. | `backend/app/api/v1/member_profiles.py:67` |
| GET | `/api/v1/metadata` | Public |  | `backend/app/api/v1/metadata.py:10` |
| DELETE | `/api/v1/rota-assignments/assignments/{assignment_id}` | current_user |  | `backend/app/api/v1/rota_assignments.py:62` |
| POST | `/api/v1/rota-assignments/slots/{slot_id}/assign` | current_user |  | `backend/app/api/v1/rota_assignments.py:39` |
| POST | `/api/v1/rota-auto-fill/draft` | current_user |  | `backend/app/api/v1/rota_auto_fill.py:39` |
| GET | `/api/v1/rota-auto-fill/month` | current_user |  | `backend/app/api/v1/rota_auto_fill.py:25` |
| GET | `/api/v1/rota-candidates/month` | current_user |  | `backend/app/api/v1/rota_candidates.py:49` |
| GET | `/api/v1/rota-candidates/slots/{slot_id}` | current_user |  | `backend/app/api/v1/rota_candidates.py:35` |
| GET | `/api/v1/rota-publish/export` | current_user |  | `backend/app/api/v1/rota_publish.py:80` |
| GET | `/api/v1/rota-publish/month` | current_user |  | `backend/app/api/v1/rota_publish.py:43` |
| POST | `/api/v1/rota-publish/publish` | require_publisher |  | `backend/app/api/v1/rota_publish.py:57` |
| POST | `/api/v1/rota-review/exchanges` | current_user |  | `backend/app/api/v1/rota_review.py:117` |
| POST | `/api/v1/rota-review/exchanges/{exchange_id}/approve` | current_user |  | `backend/app/api/v1/rota_review.py:136` |
| POST | `/api/v1/rota-review/exchanges/{exchange_id}/reject` | current_user |  | `backend/app/api/v1/rota_review.py:155` |
| GET | `/api/v1/rota-review/month` | current_user |  | `backend/app/api/v1/rota_review.py:83` |
| POST | `/api/v1/rota-review/slots/{slot_id}/decisions` | current_user |  | `backend/app/api/v1/rota_review.py:97` |
| GET | `/api/v1/rota-safety/month` | current_user |  | `backend/app/api/v1/rota_safety.py:24` |
| GET | `/api/v1/rota-setup/month` | current_user |  | `backend/app/api/v1/rota_setup.py:103` |
| POST | `/api/v1/rota-setup/month/clone-previous` | current_user |  | `backend/app/api/v1/rota_setup.py:141` |
| PUT | `/api/v1/rota-setup/month/scope` | current_user |  | `backend/app/api/v1/rota_setup.py:117` |
| GET | `/api/v1/rota-template/allocation-statistics` | current_user |  | `backend/app/api/v1/rota_template.py:97` |
| DELETE | `/api/v1/rota-template/cache` | current_user |  | `backend/app/api/v1/rota_template.py:138` |
| GET | `/api/v1/rota-template/call-wise-export` | current_user |  | `backend/app/api/v1/rota_template.py:172` |
| GET | `/api/v1/rota-template/eagle-eye-export` | current_user |  | `backend/app/api/v1/rota_template.py:153` |
| POST | `/api/v1/rota-template/generate` | current_user |  | `backend/app/api/v1/rota_template.py:111` |
| GET | `/api/v1/rota-template/month` | current_user |  | `backend/app/api/v1/rota_template.py:83` |
| POST | `/api/v1/unit-management/assignments` | current_user |  | `backend/app/api/v1/unit_management.py:490` |
| DELETE | `/api/v1/unit-management/assignments/{assignment_id}` | current_user |  | `backend/app/api/v1/unit_management.py:539` |
| PUT | `/api/v1/unit-management/assignments/{assignment_id}` | current_user |  | `backend/app/api/v1/unit_management.py:519` |
| POST | `/api/v1/unit-management/import-apply` | current_user |  | `backend/app/api/v1/unit_management.py:433` |
| POST | `/api/v1/unit-management/import-preview` | current_user |  | `backend/app/api/v1/unit_management.py:392` |
| GET | `/api/v1/unit-management/month` | current_user |  | `backend/app/api/v1/unit_management.py:279` |
| PUT | `/api/v1/unit-management/units/{unit_id}/settings` | current_user |  | `backend/app/api/v1/unit_management.py:346` |
| GET | `/api/v1/units` | current_user |  | `backend/app/api/v1/unit_management.py:271` |
