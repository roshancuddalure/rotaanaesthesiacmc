import { formatCalendarDate } from "./ui";

const escape = (value: unknown) => String(value ?? "").replace(/[&<>"']/g,
  c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
type Designation = { id?: string; designation: string; effective_from: string; effective_to: string | null; source?: string; notes?: string | null };

export function recordedCalendarDate(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000-")) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : null;
}

export function designationPresentation(entries: Designation[], comparisonDate: unknown, context: "device" | "system") {
  if (!Array.isArray(entries)) return { label: "Current designation not determined", note: "Designation history was not returned; current designation cannot be determined.", needsReview: true };
  const today = recordedCalendarDate(comparisonDate);
  let uncertain = false;
  const current = entries.filter(entry => {
    const start = recordedCalendarDate(entry.effective_from);
    const end = recordedCalendarDate(entry.effective_to);
    const open = entry.effective_to == null || entry.effective_to === "";
    if (!start || (!open && !end) || (start && end && end < start)) { uncertain = true; return false; }
    return today != null && start <= today && (open || end! >= today);
  });
  const labels = current.map(entry => entry.designation?.trim() ? entry.designation : "Designation not recorded");
  const dateNote = today
    ? `Based on recorded dates; compared with ${formatCalendarDate(today)} ${context === "device" ? "on this device" : "returned by the system"}.`
    : "Comparison date not available; current designation cannot be determined from recorded dates.";
  return {
    label: !today ? "Current designation not determined" : labels.length ? labels.join(" · ") : "No designation recorded for this date",
    note: `${current.length > 1 ? "Multiple recorded positions match this date. " : ""}${uncertain ? "Some designation dates are missing or invalid; review designation history. " : ""}${dateNote}`,
    needsReview: !today || !current.length || uncertain || current.some(entry => !entry.designation?.trim()),
  };
}

function dateMarkup(value: unknown, missing: string): string {
  const date = recordedCalendarDate(value);
  return date ? `<time datetime="${escape(date)}">${escape(formatCalendarDate(date))}</time>`
    : value == null || value === "" ? missing : `${escape(value)} (invalid date)`;
}

export function designationHistoryMarkup(entries: Designation[], comparisonDate: unknown, context: "device" | "system") {
  if (!Array.isArray(entries)) return "<p data-designation-history-unavailable>Designation history was not returned.</p>";
  const today = recordedCalendarDate(comparisonDate);
  const ordered = entries.map((entry, index) => ({entry, index})).sort((a,b) => {
    const first = recordedCalendarDate(a.entry.effective_from), second = recordedCalendarDate(b.entry.effective_from);
    return first && second ? first.localeCompare(second) || a.index-b.index : first ? -1 : second ? 1 : a.index-b.index;
  });
  const contextText = today
    ? `Date ranges are compared with ${formatCalendarDate(today)} ${context === "device" ? "on this device" : "returned by the system"}. Recorded positions do not imply promotion rank or call-level eligibility.`
    : "Comparison date not available. Recorded positions cannot be labelled current or scheduled.";
  return `<p data-designation-date-context>${escape(contextText)}</p>${ordered.length ? `<ol data-designation-timeline aria-label="Recorded designation history">${ordered.map(({entry,index}) => {
    const start = recordedCalendarDate(entry.effective_from), end = recordedCalendarDate(entry.effective_to);
    const open = entry.effective_to == null || entry.effective_to === "";
    const missing = entry.effective_from == null || entry.effective_from === "";
    const invalid = (!start && !missing) || (!open && !end) || (start && end && end < start);
    const state = invalid ? "Date range invalid" : !start ? "Date range not recorded" : !today ? "Comparison date not available" : start > today ? "Scheduled dates" : end && end < today ? "Ended" : "Includes displayed date";
    // Missing or duplicate IDs have no stable ownership for restoration after refresh.
    const stableId = entry.id && entries.filter(other => other.id === entry.id).length === 1 ? entry.id : null;
    return `<li data-designation-history-index="${index}"><article class="mw-history"><h4>${escape(entry.designation?.trim() ? entry.designation : "Designation not recorded")}</h4><p data-designation-dates>${dateMarkup(entry.effective_from,"Not recorded")} to ${dateMarkup(entry.effective_to,"Ongoing")}</p><span class="mw-period-badge mw-designation-date-state">${state}</span><p data-designation-notes>${escape(entry.notes)}</p><details data-designation-provenance${stableId ? ` data-profile-disclosure="designation-source-${escape(stableId)}"` : ""}><summary>Record provenance</summary><p>Source: ${escape(entry.source || "Not recorded")}</p></details></article></li>`;
  }).join("")}</ol>` : "<p>No designation history recorded.</p>"}`;
}
