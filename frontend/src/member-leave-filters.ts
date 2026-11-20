/** Canonical record filtering; no derived attendance/entitlement or private-field search. */
export type LeaveFilter = {search: string; status: string; type: string; from: string; until: string};
export type LeaveRow = Record<string, unknown>;
const text = (value: unknown): string => typeof value === "string" ? value : "";
const isoDate = (value: unknown): value is string => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
};
export const publicLeaveFields = new Set(["id", "type", "leave_type", "slot", "leave_slot",
  "starts_on", "ends_on", "status", "source"]);

export function leaveFilterError(filter: LeaveFilter): string | null {
  if ((filter.from && !isoDate(filter.from)) || (filter.until && !isoDate(filter.until)))
    return "Choose valid start and end dates.";
  if (filter.from && filter.until && filter.until < filter.from)
    return "The end date must be on or after the start date.";
  return null;
}

export function filterMemberLeave(rows: LeaveRow[], filter: LeaveFilter): LeaveRow[] {
  if (leaveFilterError(filter)) return [];
  const query = filter.search.trim().toLocaleLowerCase();
  return rows.filter(row => {
    if (filter.status && text(row.status).toLowerCase() !== filter.status.toLowerCase()) return false;
    if (filter.type && text(row.type ?? row.leave_type) !== filter.type) return false;
    if (query && !["id", "type", "leave_type", "slot", "leave_slot", "status", "source", "starts_on", "ends_on"]
      .some(key => text(row[key]).toLocaleLowerCase().includes(query))) return false;
    if (filter.from || filter.until) {
      if (!isoDate(row.starts_on) || !isoDate(row.ends_on) || row.ends_on < row.starts_on) return false;
      if (filter.from && row.ends_on < filter.from) return false;
      if (filter.until && row.starts_on > filter.until) return false;
    }
    return true;
  });
}
