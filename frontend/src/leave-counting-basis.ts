/** Read-only presentation of versioned canonical coverage; never infer missing totals. */
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const number = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;
const integer = (value: unknown): value is number => number(value) && Number.isInteger(value);

export function renderLeaveCoverage(value: unknown): string {
  const unavailable = '<p data-leave-coverage-unavailable>Interval coverage is unavailable. Request-days are not a leave-taken total.</p>';
  if (!object(value) || value.version !== 1 || !object(value.groups)) return unavailable;
  const rows: string[] = [];
  for (const [key, title] of [["approved", "Approved"], ["pending", "Pending review"], ["active", "All active records"]]) {
    const group = value.groups[key];
    if (!object(group) || typeof group.precise !== "boolean"
      || !number(group.known_clock_hours) || !integer(group.known_person_calendar_dates)
      || !Array.isArray(group.unresolved_record_ids) || !group.unresolved_record_ids.every(id => typeof id === "string")
      || (group.precise && (!number(group.clock_hours) || !integer(group.person_calendar_dates)
        || group.unresolved_record_ids.length > 0))
      || (!group.precise && (group.clock_hours !== null || group.person_calendar_dates !== null))) return unavailable;
    const text = group.precise
      ? `${group.clock_hours} covered clock hours · ${group.person_calendar_dates} person-calendar dates`
      : `Exact coverage unknown: ${group.unresolved_record_ids.length} unresolved records. Known coverage: ${group.known_clock_hours} clock hours · ${group.known_person_calendar_dates} person-calendar dates`;
    rows.push(`<div data-leave-coverage-group="${key}"><dt>${title}</dt><dd>${text}</dd></div>`);
  }
  return `<section class="panel" aria-label="Recorded leave interval coverage" data-leave-coverage>
    <h3>Recorded interval coverage</h3><dl>${rows.join("")}</dl>
    <p>Overlapping records are counted once per person. A partial date counts as a touched date, not a full day of leave. Approved and pending coverage can overlap; do not add them together.</p>
    <p>These totals include future approved dates. They do not confirm attendance or leave already taken. Working-day totals, entitlement balances and historical completeness are unavailable.</p></section>`;
}

export function renderUnitLeaveBasis(value: unknown): string {
  if (!object(value) || !integer(value.unresolved_leave_person_dates))
    return '<p data-unit-leave-basis-unavailable>Dated leave attribution coverage is unavailable.</p>';
  return `<p data-unit-leave-basis>Leave dates count distinct people on each date during their unit-board posting. Partial dates count as touched dates, not entitlement days. ${value.unresolved_leave_person_dates > 0
    ? `<strong>${value.unresolved_leave_person_dates} person-dates have conflicting unit attribution and are excluded from definite totals.</strong>`
    : "No conflicting unit person-dates were reported."}</p>`;
}

export function renderLeaveAttributionWarnings(value: unknown): string {
  if (!Array.isArray(value)) return '<p data-leave-attribution-unavailable>Dated attribution warnings were not returned.</p>';
  if (!value.every(row => object(row) && typeof row.leave_id === "string" && typeof row.date === "string"
      && Array.isArray(row.codes) && row.codes.every(code => typeof code === "string")))
    return '<p data-leave-attribution-unavailable>Dated attribution warnings were incomplete.</p>';
  if (!value.length) return "";
  return `<p data-leave-attribution-warning>${value.length} request-date entries have missing or unresolved unit/call information. Unknown groups are retained in the breakdowns; review dated postings and call history.</p>`;
}

export function renderUnitLeaveOverview(values: unknown): string {
  if (!Array.isArray(values) || !values.every(value => object(value)
      && integer(value.unresolved_leave_person_dates)))
    return '<p data-unit-leave-overview>Dated leave attribution coverage is unavailable for one or more units.</p>';
  const unresolved = values.reduce((sum, value) => sum + (value as Record<string, number>).unresolved_leave_person_dates, 0);
  return `<p data-unit-leave-overview>Unit leave person-dates count distinct people on each active leave date within their dated unit-board posting. Partial dates are touched dates, not entitlement days. ${unresolved > 0
    ? `${unresolved} unit/person-date references have unresolved unit attribution and are excluded from definite totals. One conflicting person-date may affect more than one unit.`
    : "No conflicting unit person-dates were reported."}</p>`;
}
