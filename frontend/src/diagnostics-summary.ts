/** A shareable presentation of diagnostics, never a copy of an arbitrary response. */
type Count = number | null;
type Counts = Record<string, Count>;

const TABLES = new Set([
  'people', 'person_designations', 'units', 'rota_periods', 'duty_slots',
  'duty_assignments', 'postings', 'import_batches', 'import_warnings',
  'admin_mappings', 'user_accounts',
]);
const MAPPING_STATUSES = new Set([
  'pending', 'confirmed', 'reviewed', 'unreviewed', 'ignored', 'rejected',
  'invalid', 'active', 'inactive', 'unmapped', 'mapped', 'needs_review',
  'resolved', 'archived', 'unknown',
]);
const SEVERITIES = new Set(['info', 'information', 'warning', 'error', 'critical', 'debug', 'notice', 'unknown']);
const PERIOD_STATUSES = new Set(['draft', 'published', 'archived', 'active', 'inactive', 'cancelled', 'unpublished', 'ready', 'review']);
const ROLES = new Set(['computer_admin', 'superadmin', 'rota_board_member']);

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function count(value: unknown): Count {
  // Preserve reported numeric values, including zero; never coerce or invent counts.
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function timestamp(value: unknown): string | null {
  // Keep valid server timestamps as reported. Arbitrary text is not support metadata.
  if (typeof value !== 'string') return null;
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|[+-](\d{2}):(\d{2}))?$/.exec(value);
  if (!parts) return null;
  const [year, month, day, hour, minute, second] = parts.slice(1, 7).map(Number);
  const calendar = new Date(0);
  calendar.setUTCFullYear(year, month - 1, day);
  if (calendar.getUTCFullYear() !== year || calendar.getUTCMonth() !== month - 1 || calendar.getUTCDate() !== day
    || hour > 23 || minute > 59 || second > 59 || Number(parts[7] ?? 0) > 23 || Number(parts[8] ?? 0) > 59) return null;
  return Number.isFinite(Date.parse(value)) ? value : null;
}

export function shareableDiagnostics(value: unknown) {
  const input = record(value) ?? {};
  let withheldLabels = 0;
  const counts = (raw: unknown, known: Set<string>, additionalPrefix: string): Counts => {
    const result: Counts = Object.create(null);
    let additional = 0;
    for (const [key, amount] of Object.entries(record(raw) ?? {})) {
      // Category names can be free-form stored data. Retain every count while
      // naming unknown categories anonymously instead of exposing their labels.
      const label = known.has(key) ? key : `${additionalPrefix}_${++additional}`;
      if (!known.has(key)) withheldLabels++;
      result[label] = count(amount);
    }
    return result;
  };
  const summary = {
    generated_at: timestamp(input.generated_at),
    database_counts: counts(input.database_counts, TABLES, 'additional_table'),
    mapping_status: counts(input.mapping_status, MAPPING_STATUSES, 'additional_category'),
    import_warnings: counts(input.import_warnings, SEVERITIES, 'additional_category'),
    rota_period_status: counts(input.rota_period_status, PERIOD_STATUSES, 'additional_category'),
    invalid_member_names: count(input.invalid_member_names),
    auth_accounts_by_role: counts(input.auth_accounts_by_role, ROLES, 'additional_role'),
    invalid_name_rule_count: Array.isArray(input.invalid_name_rules) ? input.invalid_name_rules.length : null,
  };
  return {
    ...summary,
    privacy: {
      category_labels_withheld: withheldLabels,
      rule_text_excluded: true,
      unsupported_fields_excluded: true,
    },
  };
}
