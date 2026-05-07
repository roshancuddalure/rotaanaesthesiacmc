const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";

let authToken = localStorage.getItem("duty_rota_auth_token") ?? "";

export function setAuthToken(token: string) {
  authToken = token;
  localStorage.setItem("duty_rota_auth_token", token);
}

export function clearAuthToken() {
  authToken = "";
  localStorage.removeItem("duty_rota_auth_token");
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      ...options.headers,
    },
    ...options,
  });
  if (!response.ok) {
    throw new Error(`API request failed: ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export function healthCheck(): Promise<{ status: string }> {
  return request<{ status: string }>("/api/health");
}

export function getMetadata(): Promise<unknown> {
  return request<unknown>("/api/v1/metadata");
}

export type MappingType = "duty_label" | "unit_label" | "posting_label";

export interface AdminMapping {
  id: string;
  mapping_type: MappingType;
  source_label: string;
  target_key: string | null;
  target_label: string | null;
  status: string;
  source: string;
  notes: string | null;
}

export interface MappingOptions {
  duty_types: Array<{ key: string; label: string }>;
  mapping_types: MappingType[];
}

export interface MappingScanResult {
  created: number;
  existing: number;
  total: number;
}

export interface HistoricalImportStatus {
  people: number;
  units: number;
  duty_slots: number;
  duty_assignments: number;
  postings: number;
  import_batches: number;
  import_warnings: number;
}

export interface HistoricalImportSummary {
  rota_files: number;
  unitwise_files: number;
  periods_created: number;
  people_created: number;
  aliases_created: number;
  units_created: number;
  duty_slots_created: number;
  duty_assignments_created: number;
  postings_created: number;
  source_records_created: number;
  warnings_created: number;
  skipped_assignments: number;
}

export interface HistoricalAnalysisImportResult {
  dry_run: {
    matched_rota_assignments: number;
    skipped_rota_assignments: number;
    matched_main_24hr_assignments: number;
    matched_weekend_main_24hr_assignments: number;
  };
  import: {
    duty_rows_read: number;
    posting_rows_read: number;
    people_created: number;
    periods_created: number;
    units_created: number;
    duty_slots_created: number;
    duty_assignments_created: number;
    postings_created: number;
    existing_duty_assignments: number;
    existing_postings: number;
    skipped_unknown_people: number;
    skipped_unmapped_duties: number;
    source: string;
  };
}

export interface AnalysisPerson {
  name: string;
  total_24hr: number;
  total_weekend_24hr: number;
  total_weekday_24hr: number;
  main_24hr: number;
  cb_24hr: number;
  rc_24hr: number;
  schell: number;
  floating: number;
  fifth_call: number;
  fifth_call_weekend: number;
  caesar_b: number;
  cart: number;
  caesar_a: number;
  pac: number;
  shift: number;
  rc12hr: number;
  cb_co12hr: number;
  chad: number;
  ruhsa: number;
  neuro_dept: number;
  day_breakdown: Record<string, number>;
  monthly_24hr: Record<string, number>;
  fifth_call_monthly: Record<string, number>;
  fifth_call_days: Record<string, number>;
  pain_months: string[];
  sicu_months: string[];
  drp_months: string[];
  neuro_icu_months: string[];
  call_levels: Record<string, string>;
  units: Record<string, string>;
  promotions: Array<{ month: string; from: string; to: string }>;
  months_active: string[];
}

export interface AnalysisDashboard {
  summary: {
    personnel: number;
    active_personnel: number;
    total_records: number;
    total_24hr: number;
    total_weekend_24hr: number;
    weekend_percent: number;
    months: number;
    avg_24hr_per_active_person: number;
  };
  months: string[];
  month_labels: Record<string, string>;
  month_stats: Record<
    string,
    {
      total: number;
      total_24hr: number;
      weekend_24hr: number;
      persons: number;
      duty_type_counts: Record<string, number>;
    }
  >;
  days: string[];
  duty_category_totals: Record<string, number>;
  people: AnalysisPerson[];
}

export interface AnalysisPreflight {
  safe_to_publish: boolean;
  status: "ready" | "needs_review";
  issues: string[];
  included_periods: string[];
  counts: {
    analysis_periods: number;
    invalid_members: number;
    duplicate_groups: number;
    unresolved_duty_mappings: number;
    unknown_duty_types: number;
    empty_periods: number;
  };
  examples: {
    invalid_members: string[];
    duplicate_groups: Array<{ key: string; names: string[] }>;
    unresolved_duty_mappings: string[];
    unknown_duty_types: string[];
    empty_periods: string[];
  };
}

export interface AnalysisManualReview {
  summary: {
    skipped_names: number;
    unique_skipped_names: number;
    parser_warnings: number;
    unmapped_duty_warnings: number;
    status_counts: Record<string, number>;
    warning_counts: Record<string, number>;
    current_main_24hr: number;
    reference_main_24hr: number;
    main_24hr_gap: number;
    current_weekend_24hr: number;
    reference_weekend_24hr: number;
    weekend_24hr_gap: number;
  };
  files: {
    skipped_names: string;
    parser_warnings: string;
  };
  top_skipped_names: Array<{
    cleaned_person_name: string;
    status: string;
    reason: string;
    count: number;
  }>;
  sample_rows: Array<Record<string, string>>;
  unmapped_duty_rows: Array<Record<string, string>>;
  reference_comparison: Array<Record<string, string>>;
}

export interface DepartmentMember {
  id: string;
  canonical_name: string;
  active_status: string;
  call_level: string | null;
  aliases: Array<{ id: string; alias: string; source: string }>;
  designations: Array<{
    id: string;
    designation: string;
    effective_from: string;
    effective_to: string | null;
    source: string;
    notes: string | null;
  }>;
}

export interface LeavePerson {
  id: string;
  canonical_name: string;
  active_status: string;
  call_level: string | null;
}

export interface LeaveRequest {
  id: string;
  person: LeavePerson;
  leave_type: string;
  leave_slot: string;
  starts_on: string;
  ends_on: string;
  status: string;
  source: string;
  raw_person_name: string | null;
  notes: string | null;
  days: number;
}

export interface LeaveSummary {
  month: string;
  starts_on: string;
  ends_on: string;
  total_requests: number;
  blocking_requests: number;
  people_on_leave: number;
  total_leave_days: number;
  busiest_day: { date: string; count: number } | null;
  status_counts: Record<string, number>;
  type_counts: Record<string, number>;
  slot_counts: Record<string, number>;
  unit_counts: Record<string, number>;
  call_level_counts: Record<string, number>;
}

export interface LeaveDayEntry {
  leave_id: string;
  person_id: string;
  person_name: string;
  leave_type: string;
  leave_slot: string;
  status: string;
  unit: string | null;
  posting_type: string | null;
  call_level: string;
}

export interface LeaveCalendar {
  month: string;
  summary: LeaveSummary;
  days: Record<string, LeaveDayEntry[]>;
}

export interface LeaveRequestPayload {
  person_id: string;
  leave_type: string;
  leave_slot: string;
  starts_on: string;
  ends_on: string;
  status: string;
  notes?: string | null;
}

export interface UnitRead {
  id: string;
  code: string;
  name: string;
  campus: string | null;
  active_status: string;
  notes: string | null;
}

export interface UnitPerson {
  id: string;
  canonical_name: string;
  active_status: string;
  call_level: string | null;
}

export interface UnitAssignment {
  id: string;
  person: UnitPerson;
  unit: UnitRead | null;
  posting_type: string;
  starts_on: string;
  ends_on: string | null;
  source: string;
  notes: string | null;
}

export interface UnitSummary {
  unit_id: string;
  assigned_members: number;
  people_with_leave: number;
  leave_days: number;
  leave_by_call_level: Record<string, number>;
}

export interface UnitValidationIssue {
  severity: "error" | "warning" | "info";
  code: string;
  message: string;
  person_id: string | null;
  unit_id: string | null;
  posting_id: string | null;
}

export interface UnitManagementMonth {
  month: string;
  starts_on: string;
  ends_on: string;
  units: UnitRead[];
  assignments: UnitAssignment[];
  unit_summaries: UnitSummary[];
  validation_issues: UnitValidationIssue[];
}

export interface UnitAssignmentPayload {
  person_id: string;
  unit_id: string;
  posting_type: string;
  starts_on: string;
  ends_on?: string | null;
  notes?: string | null;
}

export interface MemberAudit {
  total_members: number;
  active_members: number;
  inactive_members: number;
  aliases: number;
  designations: number;
  invalid_members: number;
  duplicate_groups: number;
  missing_designations: number;
  missing_call_levels: number;
  positions: Record<string, number>;
  call_levels: Record<string, number>;
  sources: Record<string, number>;
  status: "clean" | "needs_review";
}

export interface DuplicateCandidate {
  normalized_name: string;
  people: DepartmentMember[];
}

export interface InvalidMembersResult {
  count: number;
  people: DepartmentMember[];
}

export interface CleanupMembersResult {
  normalized: number;
  deleted: number;
}

export interface RosterReconciliationResult {
  roster_entries: number;
  matched_people: number;
  created_people: number;
  renamed_people: number;
  merged_people: number;
  aliases_created: number;
  designations_created: number;
  unmatched_database_people: number;
  examples: string[];
}

export interface AutoMergeDuplicatesResult {
  merged_groups: number;
  merged_people: number;
  remaining_groups: number;
}

export interface CallLevelPrefillResult {
  matched: number;
  unmatched: number;
  cleared: number;
  unmatched_names: string[];
  examples: string[];
}

export interface UserAccount {
  id: string;
  username: string;
  display_name: string;
  email: string | null;
  role: "rota_board_member" | "computer_admin" | "superadmin";
  role_label: string;
  active_status: string;
}

export interface SignInResponse {
  token: string;
  user: UserAccount;
}

export interface DiagnosticsSummary {
  generated_at: string;
  database_counts: Record<string, number>;
  mapping_status: Record<string, number>;
  import_warnings: Record<string, number>;
  rota_period_status: Record<string, number>;
  invalid_member_names: number;
  auth_accounts_by_role: Record<string, number>;
  invalid_name_rules: string[];
}

export function getMappingOptions(): Promise<MappingOptions> {
  return request<MappingOptions>("/api/v1/admin/mappings/options");
}

export function getMappings(mappingType?: MappingType): Promise<AdminMapping[]> {
  const query = mappingType ? `?mapping_type=${mappingType}` : "";
  return request<AdminMapping[]>(`/api/v1/admin/mappings${query}`);
}

export function scanHistoricalMappings(): Promise<MappingScanResult> {
  return request<MappingScanResult>("/api/v1/admin/mappings/scan-historical", {
    method: "POST",
    body: "{}",
  });
}

export function updateMapping(
  mapping: AdminMapping,
): Promise<AdminMapping> {
  return request<AdminMapping>(`/api/v1/admin/mappings/${mapping.id}`, {
    method: "PUT",
    body: JSON.stringify({
      target_key: mapping.target_key,
      target_label: mapping.target_label,
      status: mapping.status,
      notes: mapping.notes,
    }),
  });
}

export function getHistoricalImportStatus(): Promise<HistoricalImportStatus> {
  return request<HistoricalImportStatus>("/api/v1/admin/imports/historical/status");
}

export function runHistoricalImport(): Promise<HistoricalAnalysisImportResult> {
  return request<HistoricalAnalysisImportResult>("/api/v1/admin/imports/historical/run", {
    method: "POST",
    body: "{}",
  });
}

export function getAnalysisDashboard(): Promise<AnalysisDashboard> {
  return request<AnalysisDashboard>("/api/v1/analysis/dashboard");
}

export function getAnalysisPreflight(): Promise<AnalysisPreflight> {
  return request<AnalysisPreflight>("/api/v1/analysis/preflight");
}

export function getAnalysisManualReview(): Promise<AnalysisManualReview> {
  return request<AnalysisManualReview>("/api/v1/analysis/manual-review");
}

export function getMembers(q = ""): Promise<DepartmentMember[]> {
  const query = q ? `?q=${encodeURIComponent(q)}` : "";
  return request<DepartmentMember[]>(`/api/v1/admin/members${query}`);
}

export function getLeaveCalendar(month: string): Promise<LeaveCalendar> {
  return request<LeaveCalendar>(`/api/v1/leave/calendar?month=${encodeURIComponent(month)}`);
}

export function getLeaveRequests(month: string): Promise<LeaveRequest[]> {
  return request<LeaveRequest[]>(`/api/v1/leave/requests?month=${encodeURIComponent(month)}`);
}

export function createLeaveRequest(payload: LeaveRequestPayload): Promise<LeaveRequest> {
  return request<LeaveRequest>("/api/v1/leave/requests", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateLeaveRequest(id: string, payload: LeaveRequestPayload): Promise<LeaveRequest> {
  return request<LeaveRequest>(`/api/v1/leave/requests/${id}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export function cancelLeaveRequest(id: string): Promise<LeaveRequest> {
  return request<LeaveRequest>(`/api/v1/leave/requests/${id}/cancel`, {
    method: "POST",
    body: "{}",
  });
}

export function getUnits(): Promise<UnitRead[]> {
  return request<UnitRead[]>("/api/v1/units");
}

export function getUnitManagementMonth(month: string): Promise<UnitManagementMonth> {
  return request<UnitManagementMonth>(`/api/v1/unit-management/month?month=${encodeURIComponent(month)}`);
}

export function createUnitAssignment(payload: UnitAssignmentPayload): Promise<UnitAssignment> {
  return request<UnitAssignment>("/api/v1/unit-management/assignments", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateUnitAssignment(id: string, payload: UnitAssignmentPayload): Promise<UnitAssignment> {
  return request<UnitAssignment>(`/api/v1/unit-management/assignments/${id}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export function deleteUnitAssignment(id: string): Promise<{ status: string }> {
  return request<{ status: string }>(`/api/v1/unit-management/assignments/${id}`, {
    method: "DELETE",
  });
}

export function getMemberAudit(): Promise<MemberAudit> {
  return request<MemberAudit>("/api/v1/admin/members/audit");
}

export function createMember(
  canonicalName: string,
  activeStatus = "active",
): Promise<DepartmentMember> {
  return request<DepartmentMember>("/api/v1/admin/members", {
    method: "POST",
    body: JSON.stringify({ canonical_name: canonicalName, active_status: activeStatus }),
  });
}

export function updateMember(member: DepartmentMember): Promise<DepartmentMember> {
  return request<DepartmentMember>(`/api/v1/admin/members/${member.id}`, {
    method: "PUT",
    body: JSON.stringify({
      canonical_name: member.canonical_name,
      active_status: member.active_status,
      call_level: member.call_level,
    }),
  });
}

export function addMemberDesignation(
  personId: string,
  designation: string,
  effectiveFrom: string,
  notes = "",
): Promise<DepartmentMember> {
  return request<DepartmentMember>(`/api/v1/admin/members/${personId}/designations`, {
    method: "POST",
    body: JSON.stringify({
      designation,
      effective_from: effectiveFrom,
      notes: notes || null,
    }),
  });
}

export function getDedupeCandidates(): Promise<DuplicateCandidate[]> {
  return request<DuplicateCandidate[]>("/api/v1/admin/members/dedupe-candidates");
}

export function mergeMembers(
  targetPersonId: string,
  sourcePersonIds: string[],
): Promise<DepartmentMember> {
  return request<DepartmentMember>("/api/v1/admin/members/merge", {
    method: "POST",
    body: JSON.stringify({
      target_person_id: targetPersonId,
      source_person_ids: sourcePersonIds,
    }),
  });
}

export function getInvalidMembers(): Promise<InvalidMembersResult> {
  return request<InvalidMembersResult>("/api/v1/admin/members/invalid");
}

export function cleanupInvalidMembers(): Promise<CleanupMembersResult> {
  return request<CleanupMembersResult>("/api/v1/admin/members/cleanup-invalid", {
    method: "POST",
    body: "{}",
  });
}

export function reconcileTrustedRoster(): Promise<RosterReconciliationResult> {
  return request<RosterReconciliationResult>("/api/v1/admin/members/reconcile-trusted-roster", {
    method: "POST",
    body: "{}",
  });
}

export function autoMergeDuplicates(): Promise<AutoMergeDuplicatesResult> {
  return request<AutoMergeDuplicatesResult>("/api/v1/admin/members/auto-merge-duplicates", {
    method: "POST",
    body: "{}",
  });
}

export function prefillCallLevels(): Promise<CallLevelPrefillResult> {
  return request<CallLevelPrefillResult>("/api/v1/admin/members/prefill-call-levels", {
    method: "POST",
    body: "{}",
  });
}

export async function signIn(username: string, password: string): Promise<SignInResponse> {
  const response = await request<SignInResponse>("/api/v1/auth/sign-in", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
  setAuthToken(response.token);
  return response;
}

export function getCurrentUser(): Promise<UserAccount> {
  return request<UserAccount>("/api/v1/auth/me");
}

export function createUserAccount(payload: {
  username: string;
  display_name: string;
  password: string;
  email?: string;
  role: string;
}): Promise<UserAccount> {
  return request<UserAccount>("/api/v1/auth/accounts", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function listUserAccounts(): Promise<UserAccount[]> {
  return request<UserAccount[]>("/api/v1/auth/accounts");
}

export function forgotPassword(username: string): Promise<{ message: string; reset_token: string | null }> {
  return request<{ message: string; reset_token: string | null }>("/api/v1/auth/forgot-password", {
    method: "POST",
    body: JSON.stringify({ username }),
  });
}

export function resetPassword(token: string, newPassword: string): Promise<{ status: string }> {
  return request<{ status: string }>("/api/v1/auth/reset-password", {
    method: "POST",
    body: JSON.stringify({ token, new_password: newPassword }),
  });
}

export function getDiagnosticsSummary(): Promise<DiagnosticsSummary> {
  return request<DiagnosticsSummary>("/api/v1/diagnostics/summary");
}
