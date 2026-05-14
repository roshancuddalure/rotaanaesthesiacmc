const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ?? "";

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
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      headers: {
        "Content-Type": "application/json",
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        ...options.headers,
      },
      ...options,
    });
  } catch (error) {
    console.error("Backend request failed", error);
    throw new Error(
      "Backend server is offline. Start Duty Rota with launch.bat and keep the Backend window running.",
    );
  }
  if (!response.ok) {
    let message = `API request failed: ${response.status}`;
    let detail: unknown = null;
    try {
      const payload = await response.json();
      detail = payload.detail;
      if (typeof payload.detail === "string") {
        message = payload.detail;
      } else if (payload.detail?.message) {
        message = payload.detail.message;
      }
    } catch {
      // Keep the status-based fallback when the server does not return JSON.
    }
    const error = new Error(message) as Error & { detail?: unknown };
    error.detail = detail;
    throw error;
  }
  return response.json() as Promise<T>;
}

async function errorFromResponse(response: Response): Promise<Error> {
  let message = `API request failed: ${response.status}`;
  let detail: unknown = null;
  if (response.status >= 500) {
    message = "Backend server is offline or crashed. Start Duty Rota with launch.bat and keep the Backend window running.";
  }
  try {
    const payload = await response.json();
    detail = payload.detail;
    if (typeof payload.detail === "string") {
      message = payload.detail;
    } else if (payload.detail?.message) {
      message = payload.detail.message;
    }
  } catch {
    // Keep the status-based fallback when the server does not return JSON.
  }
  const error = new Error(message) as Error & { detail?: unknown };
  error.detail = detail;
  return error;
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

export interface AdminMappingPayload {
  mapping_type: MappingType;
  source_label: string;
  target_key?: string | null;
  target_label?: string | null;
  status?: string;
  notes?: string | null;
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
  main_shift: number;
  rc_shift: number;
  pb_shift: number;
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
  archived_at: string | null;
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

export interface LeavePressure {
  month: string;
  starts_on: string;
  ends_on: string;
  days: Array<{
    date: string;
    total_people: number;
    blocking_people: number;
    unit_counts: Record<string, number>;
    call_level_counts: Record<string, number>;
    entries: LeaveDayEntry[];
  }>;
  unit_totals: Record<string, number>;
  call_level_totals: Record<string, number>;
  blockers: Array<Record<string, unknown>>;
}

export interface LeaveImportPreview {
  filename: string;
  month: string;
  total_rows: number;
  matched_rows: number;
  unresolved_rows: number;
  invalid_rows: number;
  sheets: string[];
  source_formats: string[];
  parser_warnings: string[];
  rows: Array<{
    row_number: number;
    sheet_name?: string;
    source_format?: string;
    confidence?: string;
    match_confidence?: string;
    raw_person_name: string;
    cleaned_person_name?: string;
    person_id: string | null;
    person_name: string | null;
    suggested_person_id?: string | null;
    suggested_person_name?: string | null;
    match_method?: string | null;
    starts_on: string | null;
    ends_on: string | null;
    leave_type: string;
    leave_slot: string;
    status: string;
    notes: string;
    preview_status: string;
    issues: string[];
  }>;
}

export interface LeaveImportApplyResult {
  filename: string;
  month: string;
  created_rows: number;
  skipped_rows: number;
  skipped_preview_rows: LeaveImportPreview["rows"];
  preview: LeaveImportPreview;
}

export interface UnitAssignmentImportPreview {
  filename: string;
  month: string;
  total_rows: number;
  matched_rows: number;
  auto_resolved_rows: number;
  auto_assignable_rows: number;
  needs_review_rows: number;
  review_suggested_rows: number;
  unresolved_rows: number;
  invalid_rows: number;
  sheets: string[];
  source_formats: string[];
  parser_warnings: string[];
  rows: Array<{
    row_key: string;
    row_number: number;
    sheet_name?: string;
    column_label?: string;
    raw_person_name: string;
    cleaned_person_name?: string;
    person_id: string | null;
    person_name: string | null;
    suggested_person_id?: string | null;
    suggested_person_name?: string | null;
    match_method?: string | null;
    match_confidence?: string;
    match_score?: number | null;
    raw_unit_label: string;
    unit_id: string | null;
    unit_name: string | null;
    unit_match_method?: string | null;
    unit_match_score?: number | null;
    raw_posting_label: string;
    posting_type: string;
    special_posting?: boolean;
    skip?: boolean;
    section_posting_label?: string | null;
    child_posting_label?: string | null;
    parser_rule?: string | null;
    parser_confidence?: string | null;
    source_context?: string | null;
    preview_status: string;
    auto_assignable?: boolean;
    row_action?: "auto_assign" | "needs_review";
    auto_resolved?: boolean;
    auto_resolved_fields?: string[];
    review_suggested?: boolean;
    resolution_notes?: string[];
    auto_assign_blockers?: string[];
    auto_decision_reason?: string;
    issues: string[];
  }>;
}

export interface UnitImportResolution {
  person_id?: string;
  unit_id?: string;
  posting_type?: string;
  skip?: boolean;
}

export interface UnitAssignmentImportApplyResult {
  filename: string;
  month: string;
  created_rows: number;
  auto_assigned_rows: number;
  learned_mappings: number;
  deleted_existing_rows: number;
  skipped_rows: number;
  skipped_preview_rows: UnitAssignmentImportPreview["rows"];
  preview: UnitAssignmentImportPreview;
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
  minimum_free_people: number;
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

export interface UnitCallMinimum {
  unit_id: string;
  call_level: string;
  assigned_members: number;
  minimum_free_people: number;
  max_allowed: number;
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
  unit_call_minimums: UnitCallMinimum[];
  validation_issues: UnitValidationIssue[];
}

export interface UnitAssignmentPayload {
  person_id: string;
  unit_id?: string | null;
  posting_type: string;
  starts_on: string;
  ends_on?: string | null;
  notes?: string | null;
}

export interface UnitSettingsPayload {
  minimum_free_people: number;
  call_minimums?: Array<{ call_level: string; minimum_free_people: number }>;
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

export interface DutyRule {
  key: string;
  label: string;
  group: string;
  campus: string | null;
  duration_hours: number;
  start_time: string;
  end_time: string;
  is_24hr: boolean;
  counts_in_main_24hr: boolean;
  is_mandatory: boolean;
  is_adjustable: boolean;
  blocks_elective_same_day: boolean;
  blocks_elective_next_day: boolean;
  active: boolean;
  allowed_call_levels: string[];
  allowed_cluster_keys: string[];
  excluded_cluster_keys: string[];
  allowed_designations: string[];
  allowed_units: string[];
  excluded_units: string[];
}

export interface CallClusterMember {
  id: string;
  person_id: string;
  canonical_name: string;
  call_level: string | null;
  effective_from: string;
  effective_to: string | null;
  source: string;
  notes: string | null;
}

export interface CallCluster {
  id: string;
  key: string;
  name: string;
  call_level: string;
  description: string | null;
  active: boolean;
  member_count: number;
  members?: CallClusterMember[];
}

export interface RotaPhaseOneRules {
  rule_version: {
    id: string;
    name: string;
    description: string | null;
    effective_from: string;
    effective_to: string | null;
    is_active: boolean;
    created_at: string;
  };
  duty_rules: DutyRule[];
  duty_count_limits: {
    max_24hr_per_month: number | null;
    max_weekend_24hr_per_month: number | null;
    max_same_group_per_month: number | null;
    max_same_campus_per_month: number | null;
  };
  rest_rules: {
    minimum_gap_after_24hr_hours: number;
    post_24hr_blocks_next_day_elective: boolean;
  };
  unit_staffing_rules: {
    minimum_available_count: number;
    warning_unavailable_percent: number;
    hard_block_unavailable_percent: number;
    small_unit_uses_absolute_minimum: boolean;
  };
  notes: string | null;
}

export interface RotaSetupUnitReadiness {
  unit_id: string;
  unit_name: string;
  unit_code: string;
  campus: string | null;
  scope_status: "included" | "excluded" | "unselected";
  readiness: "ready" | "needs_review";
  assigned_members: number;
  call_level_counts: Record<string, number>;
  people_with_leave: number;
  leave_days: number;
  warnings: string[];
}

export interface RotaSetupMonth {
  month: string;
  rota_period: {
    id: string;
    name: string;
    starts_on: string;
    ends_on: string;
    status: string;
  };
  scope: {
    id: string;
    include_excluded_units_in_safety: boolean;
    is_locked: boolean;
    lock_reason: string | null;
    units: Array<{ unit_id: string; status: "included" | "excluded"; notes: string | null }>;
  };
  unit_readiness: RotaSetupUnitReadiness[];
}

export interface RotaTemplateMonth {
  month: string;
  rota_period: {
    id: string;
    name: string;
    starts_on: string;
    ends_on: string;
    status: string;
  };
  scope: {
    id: string;
    is_locked: boolean;
    included_units: Array<{ id: string; code: string; name: string; campus: string | null }>;
  };
  rule_version: {
    id: string;
    name: string;
  };
  duty_options: Array<{
    key: string;
    label: string;
    group: string;
    is_mandatory: boolean;
    is_adjustable: boolean;
    active: boolean;
  }>;
  summary: {
    total_slots: number;
    ready_slots: number;
    needs_review_slots: number;
    status_counts: Record<string, number>;
  };
  latest_run: null | {
    id: string;
    status: string;
    included_units: number;
    created_slots: number;
    needs_review_slots: number;
    skipped_slots: number;
    blocked_slots: number;
    summary: Record<string, unknown>;
    created_at: string;
    events: Array<{
      id: string;
      unit_id: string | null;
      unit_name: string | null;
      unit_code: string | null;
      duty_date: string | null;
      duty_type: string | null;
      action: string;
      severity: string;
      reason: string;
      details: Record<string, unknown>;
      created_at: string;
    }>;
  };
  slots: Array<{
    id: string;
    unit_id: string | null;
    unit_name: string | null;
    unit_code: string | null;
    duty_date: string;
    duty_type: string;
    call_level: string | null;
    slot_label: string;
    starts_at: string;
    ends_at: string;
    is_24hr: boolean;
    max_assignees: number;
    source: string;
    template_status: string;
    template_reason: string | null;
    assignments: RotaSlotAssignment[];
    notes: string | null;
  }>;
}

export interface RotaSlotAssignment {
  id: string;
  person_id: string;
  person_name: string;
  call_level: string | null;
  status: string;
  source: string;
  override_reason: string | null;
  created_at: string;
}

export interface RotaSafetyPerson {
  person_id: string;
  person_name: string;
  call_level: string;
  posting_type: string;
  blockers?: Array<Record<string, unknown>>;
}

export interface RotaSafetySlot {
  slot_id: string;
  unit_id: string | null;
  unit_name: string | null;
  unit_code: string | null;
  duty_date: string;
  duty_type: string;
  slot_label: string;
  required_call_levels: string[];
  safety_status: "safe" | "needs_review" | "hard_blocked" | string;
  reasons: string[];
  total_unit_members: number;
  eligible_members: number;
  available_members: number;
  hard_blocked_members: number;
  warning_members: number;
  available_people: RotaSafetyPerson[];
  hard_blocked_people: RotaSafetyPerson[];
  warning_people: RotaSafetyPerson[];
}

export interface RotaSafetyMonth {
  month: string;
  rota_period: {
    id: string;
    name: string;
    starts_on: string;
    ends_on: string;
    status: string;
  };
  scope: {
    id: string;
    is_locked: boolean;
  };
  summary: {
    total_slots: number;
    safe_slots: number;
    needs_review_slots: number;
    hard_blocked_slots: number;
    status_counts: Record<string, number>;
  };
  slots: RotaSafetySlot[];
  unit_day_safety: Array<{
    unit_id: string | null;
    unit_name: string | null;
    unit_code: string | null;
    date: string;
    safety_status: "safe" | "needs_review" | "hard_blocked" | string;
    slots: number;
    safe_slots: number;
    needs_review_slots: number;
    hard_blocked_slots: number;
    minimum_available_members: number;
  }>;
}

export interface RotaTemplateGeneratePayload {
  duty_keys: string[] | null;
  starts_on?: string | null;
  ends_on?: string | null;
  include_weekdays: boolean;
  include_weekends: boolean;
  replace_existing: boolean;
}

export interface RotaTemplateClearResult {
  month: string;
  cleared_slots: number;
  cleared_assignments: number;
  cleared_runs: number;
  cleared_events: number;
}

export interface RotaManualAssignmentPayload {
  person_id: string;
  replace_existing: boolean;
  override_reason?: string | null;
}

export interface RotaManualAssignmentResult {
  status: string;
  assignment: RotaSlotAssignment | null;
  validation: {
    status: string;
    issues: Array<{ severity: string; code: string; message: string }>;
    requires_override: boolean;
    slot_safety?: RotaSafetySlot;
  } | null;
  slot_safety: RotaSafetySlot | null;
}

export interface RotaCandidate {
  person_id: string;
  person_name: string;
  call_level: string | null;
  posting_type: string | null;
  candidate_status: "eligible" | "needs_review" | "blocked" | string;
  rank_score: number;
  score_parts: Record<string, number>;
  requires_override: boolean;
  validation_status: string;
  validation_issues: Array<{ severity: string; code: string; message: string }>;
  counts: {
    total_assignments: number;
    target_is_weekend?: number;
    same_day_type?: number;
    weekday_assignments?: number;
    weekend_assignments?: number;
    total_24hr: number;
    weekend_24hr: number;
    same_group: number;
    same_campus: number;
  };
  rest_gap_hours: number | null;
  reasons: string[];
}

export interface RotaCandidateSlot {
  slot_id: string;
  duty_date: string;
  duty_type: string;
  unit_id: string | null;
  unit_name: string | null;
  unit_code: string | null;
  safety_status: string;
  candidates: RotaCandidate[];
}

export interface RotaCandidateMonth {
  month: string;
  summary: {
    slots_checked: number;
    slots_with_candidates: number;
    eligible_candidates: number;
    needs_review_candidates: number;
    blocked_candidates: number;
  };
  slots: RotaCandidateSlot[];
}

export interface RotaAutoFillEvent {
  id: string;
  slot_id: string | null;
  assignment_id: string | null;
  person_id: string | null;
  person_name: string | null;
  unit_name: string | null;
  unit_code: string | null;
  duty_date: string | null;
  duty_type: string | null;
  action: string;
  severity: string;
  reason: string;
  details: Record<string, unknown>;
  created_at: string;
}

export interface RotaAutoFillRun {
  id: string;
  status: string;
  total_slots: number;
  assigned_slots: number;
  skipped_slots: number;
  review_slots: number;
  blocked_slots: number;
  summary: Record<string, unknown>;
  created_at: string;
  events: RotaAutoFillEvent[];
}

export interface RotaAutoFillMonth {
  month: string;
  latest_run: RotaAutoFillRun | null;
}

export interface RotaReviewSlot {
  id: string;
  unit_id: string | null;
  unit_name: string | null;
  unit_code: string | null;
  duty_date: string;
  duty_type: string;
  slot_label: string;
  call_level: string | null;
  template_status: string;
  template_reason: string | null;
}

export interface RotaReviewIssue {
  severity: string;
  code: string;
  message: string;
  accepted?: boolean;
  decision?: {
    id: string;
    issue_code: string;
    decision_type: string;
    note: string;
    decided_by: string | null;
    created_at: string;
    updated_at: string;
  } | null;
}

export interface RotaReviewItem {
  slot: RotaReviewSlot;
  severity: string;
  issues: RotaReviewIssue[];
  safety: RotaSafetySlot | null;
  assignments: RotaSlotAssignment[];
  candidates: RotaCandidate[];
  recommended_action: string;
  accepted?: boolean;
}

export interface RotaPersonWorkload {
  person_id: string;
  person_name: string;
  call_level: string | null;
  total_assignments: number;
  total_24hr: number;
  weekday_assignments?: number;
  weekend_assignments?: number;
  weekend_24hr: number;
  override_assignments: number;
  group_counts?: Record<string, number>;
  assignments: Array<{
    assignment_id: string;
    slot_id: string;
    duty_date: string;
    duty_type: string;
    unit_name: string | null;
    override_reason: string | null;
  }>;
}

export interface RotaCallLevelFairness {
  call_level: string;
  people: number;
  total_assignments: number;
  average_assignments: number;
  total_24hr: number;
  weekend_24hr: number;
  over_assigned: Array<{
    person_id: string;
    person_name: string;
    total_assignments: number;
    total_24hr: number;
    weekend_24hr: number;
  }>;
  under_assigned: Array<{
    person_id: string;
    person_name: string;
    total_assignments: number;
    total_24hr: number;
    weekend_24hr: number;
  }>;
  group_totals: Record<string, number>;
}

export interface RotaAssignmentOption {
  assignment: RotaSlotAssignment & { slot_id: string };
  slot: RotaReviewSlot;
  label: string;
}

export interface RotaExchangeRequest {
  id: string;
  rota_period_id: string;
  from_assignment_id: string | null;
  from_slot: RotaReviewSlot | null;
  from_person: { id: string; canonical_name: string; call_level: string | null } | null;
  to_person: { id: string; canonical_name: string; call_level: string | null } | null;
  requested_by: string | null;
  approved_by: string | null;
  applied_assignment_id: string | null;
  status: string;
  request_reason: string;
  decision_reason: string | null;
  validation_status: string;
  validation_snapshot: Record<string, unknown>;
  created_at: string;
  decided_at: string | null;
}

export interface RotaReviewMonth {
  month: string;
  rota_period: {
    id: string;
    name: string;
    starts_on: string;
    ends_on: string;
    status: string;
  };
  scope: {
    id: string;
    is_locked: boolean;
  };
  summary: {
    total_slots: number;
    assigned_slots: number;
    open_slots: number;
    review_items: number;
    hard_blocked_items: number;
    accepted_review_items?: number;
    unresolved_warning_items?: number;
    override_assignments: number;
    exchange_requests: number;
    pending_exchange_requests: number;
    fairness_call_levels?: number;
    over_assigned_people?: number;
    under_assigned_people?: number;
  };
  review_items: RotaReviewItem[];
  person_workload: RotaPersonWorkload[];
  call_level_fairness?: RotaCallLevelFairness[];
  exchange_requests: RotaExchangeRequest[];
  assignment_options: RotaAssignmentOption[];
}

export interface RotaPublishChecklistItem {
  status: string;
  title: string;
  detail: string;
}

export interface RotaPublishApproval {
  id: string;
  rota_period_id: string;
  approved_by: string | null;
  status: string;
  confirmed_warnings: boolean;
  approval_note: string;
  summary: Record<string, unknown>;
  created_at: string;
}

export interface RotaPublishMonth {
  month: string;
  rota_period: {
    id: string;
    name: string;
    starts_on: string;
    ends_on: string;
    status: string;
  };
  rule_version: {
    id: string;
    name: string;
  };
  summary: RotaReviewMonth["summary"];
  can_publish: boolean;
  requires_warning_confirmation: boolean;
  checks: RotaPublishChecklistItem[];
  blockers: RotaPublishChecklistItem[];
  warnings: RotaPublishChecklistItem[];
  latest_publish: RotaPublishApproval | null;
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

export function createMapping(payload: AdminMappingPayload): Promise<AdminMapping> {
  return request<AdminMapping>("/api/v1/admin/mappings", {
    method: "POST",
    body: JSON.stringify(payload),
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

export function getLeavePressure(month: string): Promise<LeavePressure> {
  return request<LeavePressure>(`/api/v1/leave/pressure?month=${encodeURIComponent(month)}`);
}

export async function previewLeaveImport(month: string, file: File): Promise<LeaveImportPreview> {
  const formData = new FormData();
  formData.append("file", file);
  const response = await fetch(`${API_BASE_URL}/api/v1/leave/import-preview?month=${encodeURIComponent(month)}`, {
    method: "POST",
    headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
    body: formData,
  });
  if (!response.ok) {
    throw await errorFromResponse(response);
  }
  return response.json() as Promise<LeaveImportPreview>;
}

export async function applyLeaveImport(month: string, file: File): Promise<LeaveImportApplyResult> {
  const formData = new FormData();
  formData.append("file", file);
  const response = await fetch(`${API_BASE_URL}/api/v1/leave/import-apply?month=${encodeURIComponent(month)}`, {
    method: "POST",
    headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
    body: formData,
  });
  if (!response.ok) {
    throw await errorFromResponse(response);
  }
  return response.json() as Promise<LeaveImportApplyResult>;
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

export async function previewUnitAssignmentImport(
  month: string,
  file: File,
  replaceExisting = false,
  resolutions: Record<string, UnitImportResolution> = {},
): Promise<UnitAssignmentImportPreview> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("resolutions_json", JSON.stringify(resolutions));
  const response = await fetch(`${API_BASE_URL}/api/v1/unit-management/import-preview?month=${encodeURIComponent(month)}&replace_existing=${replaceExisting}`, {
    method: "POST",
    headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
    body: formData,
  });
  if (!response.ok) {
    throw await errorFromResponse(response);
  }
  return response.json() as Promise<UnitAssignmentImportPreview>;
}

export async function applyUnitAssignmentImport(
  month: string,
  file: File,
  replaceExisting: boolean,
  resolutions: Record<string, UnitImportResolution> = {},
): Promise<UnitAssignmentImportApplyResult> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("resolutions_json", JSON.stringify(resolutions));
  const response = await fetch(
    `${API_BASE_URL}/api/v1/unit-management/import-apply?month=${encodeURIComponent(month)}&replace_existing=${replaceExisting}`,
    {
      method: "POST",
      headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
      body: formData,
    },
  );
  if (!response.ok) {
    throw await errorFromResponse(response);
  }
  return response.json() as Promise<UnitAssignmentImportApplyResult>;
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

export function updateUnitSettings(id: string, payload: UnitSettingsPayload, month?: string): Promise<UnitRead> {
  const query = month ? `?month=${encodeURIComponent(month)}` : "";
  return request<UnitRead>(`/api/v1/unit-management/units/${id}/settings${query}`, {
    method: "PUT",
    body: JSON.stringify(payload),
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

export function archiveMember(personId: string): Promise<DepartmentMember> {
  return request<DepartmentMember>(`/api/v1/admin/members/${personId}/archive`, {
    method: "POST",
    body: "{}",
  });
}

export function restoreMember(personId: string): Promise<DepartmentMember> {
  return request<DepartmentMember>(`/api/v1/admin/members/${personId}/restore`, {
    method: "POST",
    body: "{}",
  });
}

export function addMemberAlias(personId: string, alias: string): Promise<DepartmentMember> {
  return request<DepartmentMember>(`/api/v1/admin/members/${personId}/aliases`, {
    method: "POST",
    body: JSON.stringify({ alias, source: "unit_import_resolution" }),
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

export function updateCurrentUserProfile(payload: {
  display_name: string;
  email?: string | null;
}): Promise<UserAccount> {
  return request<UserAccount>("/api/v1/auth/me", {
    method: "PUT",
    body: JSON.stringify(payload),
  });
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

export function getCallClusters(): Promise<CallCluster[]> {
  return request<CallCluster[]>("/api/v1/admin/call-clusters");
}

export function createCallCluster(payload: {
  name: string;
  call_level: string;
  description?: string | null;
  active?: boolean;
}): Promise<CallCluster> {
  return request<CallCluster>("/api/v1/admin/call-clusters", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateCallCluster(clusterId: string, payload: {
  key?: string;
  name: string;
  call_level: string;
  description?: string | null;
  active?: boolean;
}): Promise<CallCluster> {
  return request<CallCluster>(`/api/v1/admin/call-clusters/${clusterId}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export function getCallClusterMembers(clusterId: string): Promise<CallCluster> {
  return request<CallCluster>(`/api/v1/admin/call-clusters/${clusterId}/members`);
}

export function updateCallClusterMembers(
  clusterId: string,
  members: Array<{ person_id: string; effective_from: string; effective_to?: string | null; notes?: string | null }>,
): Promise<CallCluster> {
  return request<CallCluster>(`/api/v1/admin/call-clusters/${clusterId}/members`, {
    method: "PUT",
    body: JSON.stringify({ members }),
  });
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

export function changePassword(currentPassword: string, newPassword: string): Promise<{ status: string }> {
  return request<{ status: string }>("/api/v1/auth/change-password", {
    method: "POST",
    body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
  });
}

export function getDiagnosticsSummary(): Promise<DiagnosticsSummary> {
  return request<DiagnosticsSummary>("/api/v1/diagnostics/summary");
}

export function getRotaPhaseOneRules(): Promise<RotaPhaseOneRules> {
  return request<RotaPhaseOneRules>("/api/v1/admin/rota-rules/phase-one");
}

export function updateRotaPhaseOneRules(payload: Omit<RotaPhaseOneRules, "rule_version">): Promise<RotaPhaseOneRules> {
  return request<RotaPhaseOneRules>("/api/v1/admin/rota-rules/phase-one", {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export function getRotaSetupMonth(month: string): Promise<RotaSetupMonth> {
  return request<RotaSetupMonth>(`/api/v1/rota-setup/month?month=${encodeURIComponent(month)}`);
}

export function updateRotaSetupScope(month: string, payload: {
  included_unit_ids: string[];
  excluded_unit_ids: string[];
  include_excluded_units_in_safety: boolean;
  is_locked: boolean;
  lock_reason?: string | null;
}): Promise<RotaSetupMonth> {
  return request<RotaSetupMonth>(`/api/v1/rota-setup/month/scope?month=${encodeURIComponent(month)}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export function clonePreviousRotaSetupScope(month: string): Promise<RotaSetupMonth> {
  return request<RotaSetupMonth>(`/api/v1/rota-setup/month/clone-previous?month=${encodeURIComponent(month)}`, {
    method: "POST",
    body: "{}",
  });
}

export function getRotaTemplateMonth(month: string): Promise<RotaTemplateMonth> {
  return request<RotaTemplateMonth>(`/api/v1/rota-template/month?month=${encodeURIComponent(month)}`);
}

export function getRotaSafetyMonth(month: string): Promise<RotaSafetyMonth> {
  return request<RotaSafetyMonth>(`/api/v1/rota-safety/month?month=${encodeURIComponent(month)}`);
}

export function getRotaCandidateMonth(month: string): Promise<RotaCandidateMonth> {
  return request<RotaCandidateMonth>(`/api/v1/rota-candidates/month?month=${encodeURIComponent(month)}&limit_per_slot=5`);
}

export function getRotaSlotCandidates(slotId: string, limit = 50): Promise<RotaCandidateSlot> {
  return request<RotaCandidateSlot>(`/api/v1/rota-candidates/slots/${encodeURIComponent(slotId)}?limit=${encodeURIComponent(String(limit))}`);
}

export function getRotaAutoFillMonth(month: string): Promise<RotaAutoFillMonth> {
  return request<RotaAutoFillMonth>(`/api/v1/rota-auto-fill/month?month=${encodeURIComponent(month)}`);
}

export function getRotaReviewMonth(month: string): Promise<RotaReviewMonth> {
  return request<RotaReviewMonth>(`/api/v1/rota-review/month?month=${encodeURIComponent(month)}`);
}

export function acceptRotaReviewIssue(
  slotId: string,
  payload: { issue_code: string; note: string },
): Promise<NonNullable<RotaReviewIssue["decision"]>> {
  return request<NonNullable<RotaReviewIssue["decision"]>>(`/api/v1/rota-review/slots/${slotId}/decisions`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function getRotaPublishMonth(month: string): Promise<RotaPublishMonth> {
  return request<RotaPublishMonth>(`/api/v1/rota-publish/month?month=${encodeURIComponent(month)}`);
}

export function generateRotaTemplate(
  month: string,
  payload: RotaTemplateGeneratePayload,
): Promise<RotaTemplateMonth> {
  return request<RotaTemplateMonth>(`/api/v1/rota-template/generate?month=${encodeURIComponent(month)}`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function clearRotaTemplateCache(month: string, options: { clear_assignments?: boolean } = {}): Promise<RotaTemplateClearResult> {
  const clearAssignments = options.clear_assignments ? "&clear_assignments=true" : "";
  return request<RotaTemplateClearResult>(`/api/v1/rota-template/cache?month=${encodeURIComponent(month)}${clearAssignments}`, {
    method: "DELETE",
  });
}

export function assignRotaSlot(
  slotId: string,
  payload: RotaManualAssignmentPayload,
): Promise<RotaManualAssignmentResult> {
  return request<RotaManualAssignmentResult>(`/api/v1/rota-assignments/slots/${slotId}/assign`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function clearRotaAssignment(assignmentId: string): Promise<RotaManualAssignmentResult> {
  return request<RotaManualAssignmentResult>(`/api/v1/rota-assignments/assignments/${assignmentId}`, {
    method: "DELETE",
  });
}

export function runRotaAutoFillDraft(month: string, payload: { strict_call_level?: boolean } = {}): Promise<RotaAutoFillRun> {
  return request<RotaAutoFillRun>(`/api/v1/rota-auto-fill/draft?month=${encodeURIComponent(month)}`, {
    method: "POST",
    body: JSON.stringify({ strict_call_level: payload.strict_call_level ?? true }),
  });
}

export function requestRotaExchange(payload: {
  assignment_id: string;
  to_person_id: string;
  reason: string;
}): Promise<RotaExchangeRequest> {
  return request<RotaExchangeRequest>("/api/v1/rota-review/exchanges", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function approveRotaExchange(
  exchangeId: string,
  decisionReason?: string | null,
): Promise<RotaExchangeRequest> {
  return request<RotaExchangeRequest>(`/api/v1/rota-review/exchanges/${exchangeId}/approve`, {
    method: "POST",
    body: JSON.stringify({ decision_reason: decisionReason || null }),
  });
}

export function rejectRotaExchange(
  exchangeId: string,
  decisionReason?: string | null,
): Promise<RotaExchangeRequest> {
  return request<RotaExchangeRequest>(`/api/v1/rota-review/exchanges/${exchangeId}/reject`, {
    method: "POST",
    body: JSON.stringify({ decision_reason: decisionReason || null }),
  });
}

export function publishRotaMonth(
  month: string,
  payload: { confirm_warnings: boolean; approval_note: string },
): Promise<RotaPublishMonth> {
  return request<RotaPublishMonth>(`/api/v1/rota-publish/publish?month=${encodeURIComponent(month)}`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

function filenameFromDisposition(disposition: string | null, fallback: string): string {
  const match = disposition?.match(/filename="?([^";]+)"?/i);
  return match?.[1] ?? fallback;
}

export async function downloadRotaExport(month: string): Promise<{ blob: Blob; filename: string }> {
  const response = await fetch(`${API_BASE_URL}/api/v1/rota-publish/export?month=${encodeURIComponent(month)}`, {
    headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
  });
  if (!response.ok) {
    throw await errorFromResponse(response);
  }
  return {
    blob: await response.blob(),
    filename: filenameFromDisposition(response.headers.get("Content-Disposition"), `final-rota-${month}.xlsx`),
  };
}

export async function downloadRotaTemplateEagleEyeExport(month: string): Promise<{ blob: Blob; filename: string }> {
  const response = await fetch(`${API_BASE_URL}/api/v1/rota-template/eagle-eye-export?month=${encodeURIComponent(month)}`, {
    headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
  });
  if (!response.ok) {
    throw await errorFromResponse(response);
  }
  return {
    blob: await response.blob(),
    filename: filenameFromDisposition(response.headers.get("Content-Disposition"), `eagle-eye-rota-template-${month}.xlsx`),
  };
}

export async function downloadRotaTemplateCallWiseExport(month: string): Promise<{ blob: Blob; filename: string }> {
  const response = await fetch(`${API_BASE_URL}/api/v1/rota-template/call-wise-export?month=${encodeURIComponent(month)}`, {
    headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
  });
  if (!response.ok) {
    throw await errorFromResponse(response);
  }
  return {
    blob: await response.blob(),
    filename: filenameFromDisposition(response.headers.get("Content-Disposition"), `call-wise-rota-template-${month}.xlsx`),
  };
}
