import {
  getMembers, getPastDutyStatus, getPastDutyHistory, pastDutyUpload, downloadPastDutyTemplate, saveHistoryFairness, downloadPreviewIssues,
  type PastDutyOptions, type PastDutyPreview, type PastDutyStatus, type MemberWorkbookInspection, type DepartmentMember,
  type HistoryFairnessPolicy,
} from "./services/api";
import { applyBlocker, memberMatch, type MemberMatchCandidate, type MemberMatchView } from "./ui";

/** Past-duty preview row as the shared member resolver now describes it. */
type PastRow = PastDutyPreview["rows"][number] & {
  resolution_status?: string | null;
  resolution_reason?: string;
  resolution_method?: string | null;
  resolution_warnings?: string[];
  person_candidates: MemberMatchCandidate[];
};

const toggleListeners = new WeakMap<HTMLElement, (event: Event) => void>();

function writtenName(row: PastRow): string {
  return String(row.raw.name ?? "");
}

function rowView(row: PastRow, chosen: string | undefined): MemberMatchView {
  const status = row.resolution_status ?? (row.normalized.person_id ? "matched" : "not_found");
  const matched = status === "matched";
  return {
    raw: writtenName(row),
    status,
    name: matched ? String(row.normalized.name ?? "") : null,
    method: matched ? row.resolution_method ?? (chosen ? "member_id" : undefined) : undefined,
    reason: row.resolution_reason || "",
    warnings: row.resolution_warnings ?? [],
    candidates: row.person_candidates ?? [],
  };
}

const escape = (v: unknown) => String(v ?? "").replace(/[&<>"']/g,
  c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
function values(data: Record<string, unknown>) {
  return Object.entries(data).filter(([field, v]) => field !== "person_id" && v != null && v !== "").map(([field, v]) =>
    `<div>${escape(field.replace(/_/g, " "))}: ${escape(v)}</div>`).join("");
}

export async function mountPastDuties(host: HTMLElement) {
  host.innerHTML = '<section class="panel"><p role="status">Loading past duties…</p></section>';
  let status: PastDutyStatus;
  let members: DepartmentMember[];
  try { [status, members] = await Promise.all([getPastDutyStatus(), getMembers()]); }
  catch (error) { host.innerHTML = `<section class="panel">${escape(error instanceof Error ? error.message : error)}</section>`; return; }
  if (!host.isConnected) return;
  let file: File | undefined;
  let inspection: MemberWorkbookInspection | undefined;
  let preview: PastDutyPreview | undefined;
  let reviewed = false;
  let busy = false;
  let message = "";
  let historyHtml = "";
  let filter = "all";
  let policy: HistoryFairnessPolicy = { ...status.policy };
  let effectiveFrom = `${status.today.slice(0, 7)}-01`;
  const previousMonth = new Date(`${status.today.slice(0, 7)}-01T12:00:00`);
  previousMonth.setMonth(previousMonth.getMonth() - 1);
  let options: PastDutyOptions = { month: `${previousMonth.getFullYear()}-${String(previousMonth.getMonth()+1).padStart(2,"0")}`,
    sheet: "", layout: "table", header_row: 1, mapping: {}, resolutions: {}, confirm_corrections: false, confirm_warnings: false };

  const openEdits = new Set<string>();
  // Keep "Edit row" panels open across re-renders (toggle does not bubble, so capture it).
  const onToggle = (event: Event) => {
    const panel = event.target as HTMLDetailsElement;
    const key = panel.dataset?.pastEdit;
    if (!key) return;
    if (panel.open) openEdits.add(key); else openEdits.delete(key);
  };
  const previousToggle = toggleListeners.get(host);
  if (previousToggle && typeof host.removeEventListener === "function") host.removeEventListener("toggle", previousToggle, true);
  toggleListeners.set(host, onToggle);
  if (typeof host.addEventListener === "function") host.addEventListener("toggle", onToggle, true);

  /** Plain-language reason Apply cannot run yet, or "" when the reviewed upload can be applied. */
  function blockerText(): string {
    if (!preview) return "";
    if (!reviewed) return "Selections changed. Preview again before applying.";
    const rows = (preview.rows as PastRow[]).map(row => ({
      key: row.key, label: `Row ${row.row}:${row.column} (${writtenName(row) || "no name"})`,
      issues: row.action === "needs_review" ? (row.errors.length ? row.errors : [row.resolution_reason || "needs review"]) : [],
    }));
    const skipped = new Set(preview.rows.filter(row => row.action === "skip").map(row => row.key));
    const blocked = applyBlocker(rows, skipped);
    if (blocked) return blocked;
    if (preview.warnings.length && !options.confirm_warnings) return "Tick the box to confirm you reviewed the parser warnings before applying.";
    if (preview.counts.correct && !options.confirm_corrections) return `Tick the box to approve the ${preview.counts.correct} recorded member corrections before applying.`;
    return "";
  }

  function render() {
    const sheet = inspection?.sheets.find(s => s.name === options.sheet);
    const blocker = blockerText();
    host.innerHTML = `<section class="panel member-import"><h3>Upload Past Duties</h3>
      <p>Completed duties update statistics and future person-allocation scoring. Existing member call levels stay unchanged.</p>
      <p>Table layout: one assignment per row, with date, name, and duty type. Department matrix: date row, weekday row, then duty labels and names, as in the existing departmental rotas.</p>
      <fieldset ${busy ? "disabled" : ""}><button type="button" data-past="template">Download Duty Template</button>
        <label>Workbook <input data-past="file" type="file" accept=".xls,.xlsx" /></label><span>${escape(file?.name ?? "No file selected")}</span>
        <label>Month <input type="month" data-past="month" value="${options.month}" max="${status.today.slice(0,7)}" /></label>
        <label>Layout <select data-past="layout"><option value="table" ${options.layout === "table" ? "selected" : ""}>Assignment table</option><option value="matrix" ${options.layout === "matrix" ? "selected" : ""}>Departmental matrix</option></select></label>
        <label>${options.layout === "matrix" ? "Date row" : "Header row"} <input type="number" data-past="header" min="1" max="100" value="${options.header_row}" /></label>
        <button type="button" data-past="inspect" ${file ? "" : "disabled"}>Read Worksheets</button>
        ${inspection ? `<label>Worksheet <select data-past="sheet">${inspection.sheets.map(s => `<option value="${escape(s.name)}" ${options.sheet === s.name ? "selected" : ""}>${escape(s.name)}</option>`).join("")}</select></label>
        ${options.layout === "table" ? `<div class="member-import-mapping">${inspection.fields.map(field => `<label>${escape(field.replace(/_/g," "))}<select data-past-field="${field}"><option value="">Ignore</option>${sheet?.headers.map((h,i) => `<option value="${i}" ${options.mapping[field] === i ? "selected" : ""}>${i+1}: ${escape(h)}</option>`).join("")}</select></label>`).join("")}</div>` : ""}
        <button type="button" data-past="preview" class="primary">Preview Past Duties</button>` : ""}
        ${preview ? `<p>${Object.entries(preview.counts).map(([a,c]) => `${c} ${escape(a.replace(/_/g," "))}`).join(" · ")}</p>
        <p>Confirmed month: ${escape(preview.month)}; worksheet: ${escape(preview.sheet)}. Review dates and standard start/end times before applying. Times use local hospital time.</p>
        ${!reviewed ? "<p>Selections changed. Preview again before applying.</p>" : ""}
        <label>Review rows <select data-past="filter">${["all","needs_review","correct","create","unchanged","skip"].map(a => `<option value="${a}" ${filter === a ? "selected" : ""}>${escape(a.replace(/_/g," "))}</option>`).join("")}</select></label>
        <button type="button" data-past="rejected">Download Rejected Rows CSV</button>
        <div class="member-import-table"><table><thead><tr><th>Source row</th><th>Member</th><th>Outcome</th><th>Decision</th></tr></thead><tbody>${(preview.rows as PastRow[]).filter(r => filter === "all" || r.action === filter).map(row => {
          const resolution = options.resolutions[row.key] ?? {};
          const skipped = row.action === "skip";
          return `<tr data-past-row-key="${escape(row.key)}"><td>${row.row}:${row.column}</td>
          <td>${skipped ? `<p>${escape(writtenName(row) || "(blank)")} — skipped; this row will not be recorded.</p>` : memberMatch(row.key, rowView(row, resolution.person_id))}</td>
          <td><strong>${escape(row.action.replace(/_/g, " "))}</strong>${row.conflicts.map(c => `<p>Recorded: ${escape(c.name)} (${escape(c.slot)})</p>`).join("")}${row.errors.map(e => `<p class="mw-error">${escape(e)}</p>`).join("")}</td>
          <td><div class="registry-actions">${resolution.person_id ? `<button type="button" class="quiet-button" data-past-resolve-row="${escape(row.key)}" data-past-resolve="person_id" data-past-value="">Undo member choice</button>` : ""}${skipped
            ? `<button type="button" class="quiet-button" data-past-resolve-row="${escape(row.key)}" data-past-resolve="action" data-past-value="">Include this row again</button>`
            : `<button type="button" class="quiet-button" data-past-resolve-row="${escape(row.key)}" data-past-resolve="action" data-past-value="skip">Skip this row</button>`}</div>
          ${row.conflicts.length ? `<label>Replace recorded member <select data-past-row="${row.key}" data-resolution="replace_assignment_id"><option value="">Do not replace</option>${row.conflicts.map(c => `<option value="${c.id}" ${resolution.replace_assignment_id === c.id ? "selected" : ""}>${escape(c.name)} (${escape(c.slot)})</option>`).join("")}</select></label>` : ""}
          <details class="import-row-edit" data-past-edit="${escape(row.key)}" ${openEdits.has(row.key) ? "open" : ""}><summary>Edit row</summary>
          <label>Member <select data-past-row="${row.key}" data-resolution="person_id"><option value="">Automatic matching</option>${members.map(p => `<option value="${p.id}" ${resolution.person_id === p.id ? "selected" : ""}>${escape(p.canonical_name)} (${escape(p.active_status)})</option>`).join("")}</select></label>
          <label>Duty type <select data-past-row="${row.key}" data-resolution="duty_type"><option value="">Automatic mapping</option>${status.duty_types.map(d => `<option value="${d.key}" ${resolution.duty_type === d.key ? "selected" : ""}>${escape(d.label)}</option>`).join("")}</select></label>
          <label>Action <select data-past-row="${row.key}" data-resolution="action"><option value="">Automatic / review</option><option value="skip" ${resolution.action === "skip" ? "selected" : ""}>Skip</option><option value="additional" ${resolution.action === "additional" ? "selected" : ""}>Additional parallel duty (needs distinct slot in file)</option></select></label>
          <div><strong>Original</strong>${values(row.raw)}</div><div><strong>Normalized</strong>${values(row.normalized)}</div></details></td></tr>`;
        }).join("")}</tbody></table></div>
        ${preview.warnings.length ? `<div>${preview.warnings.map(w => `<p>Row ${w.row ?? "?"}: ${escape(w.message)}</p>`).join("")}</div><label class="member-import-confirm"><input type="checkbox" data-past="confirm-warnings" ${options.confirm_warnings ? "checked" : ""} />I reviewed the parser warnings and skipped source cells.</label>` : ""}
        ${preview.counts.correct ? `<label class="member-import-confirm"><input type="checkbox" data-past="confirm-corrections" ${options.confirm_corrections ? "checked" : ""} />I approve ${preview.counts.correct} recorded member corrections. Prior assignments remain in the audit history and no longer count in statistics.</label>` : ""}
        <button type="button" class="primary" data-past="apply" ${blocker ? 'aria-describedby="past-apply-blocker"' : ""}>Apply Reviewed Past Duties</button>
        ${blocker ? `<p class="import-apply-blocker" id="past-apply-blocker">${escape(blocker)}</p>` : ""}` : ""}
      </fieldset><p role="status">${busy ? "Working…" : escape(message)}</p></section>
      <section class="panel"><h3>Recorded History Coverage</h3><p>These are observed records, not proof of a complete roster. Missing dates and members are not assigned zero workload. Fairness uses each member's observed months within the configured window.</p>
        <div class="member-import-table"><table><thead><tr><th>Month</th><th>Duties</th><th>Members</th><th>Days recorded</th><th>Latest duty</th></tr></thead><tbody>${status.coverage.map(c => `<tr><td>${escape(c.month)}</td><td>${c.assignments}</td><td>${c.members}</td><td>${c.days_with_records}</td><td>${escape(c.latest_duty_date)}</td></tr>`).join("") || '<tr><td colspan="5">No approved past duties recorded yet.</td></tr>'}</tbody></table></div></section>
      <section class="panel member-import"><h3>Historical Fairness Settings</h3><p>History adds a ranking penalty for above-average observed burden among active peers at the same current call level. Unknown history is neutral. Safety and leave rules remain authoritative.</p>
      <fieldset ${busy ? "disabled" : ""}><label class="member-import-confirm"><input type="checkbox" data-policy="enabled" ${policy.enabled ? "checked" : ""} />Use historical fairness</label>
      <label>Effective from <input type="date" data-past="effective-from" value="${effectiveFrom}" /></label>
      ${(["lookback_months", "total_weight", "hours24_weight", "weekend_weight", "group_weight"] as const).map(field => `<label>${escape(field.replace(/_/g," "))}<input type="number" data-policy="${field}" value="${policy[field]}" min="${field === "lookback_months" ? 1 : 0}" max="${field === "lookback_months" ? 36 : 100}" step="${field === "lookback_months" ? 1 : .5}" /></label>`).join("")}
      <button type="button" data-past="save-policy">Save Fairness Settings</button></fieldset></section>
      <section class="panel"><h3>Past-Duty Import History</h3><div class="member-import-table"><table><thead><tr><th>File / month</th><th>Account / imported</th><th>Outcome</th><th>Review</th></tr></thead><tbody>${status.history.map(h => `<tr><td>${escape(h.filename)}<small>${escape(h.month)} / ${escape(h.sheet)}</small></td><td>${escape(h.actor)}<small>${escape(h.at ? new Date(h.at).toLocaleString("en-IN", {timeZone:"Asia/Calcutta"}) : "")}</small></td><td>${Object.entries(h.counts).map(([a,c]) => `${c} ${escape(a)}`).join(" · ")}</td><td><button data-past-batch="${h.id}" ${busy ? "disabled" : ""}>View Rows</button></td></tr>`).join("") || '<tr><td colspan="4">No uploads yet.</td></tr>'}</tbody></table></div>${historyHtml}</section>`;
  }
  host.onchange = event => {
    const target = event.target as HTMLInputElement;
    if (target.dataset.policy) {
      if (target.dataset.policy === "enabled") policy.enabled = target.checked;
      else policy = { ...policy, [target.dataset.policy]: Number(target.value) };
      return;
    }
    if (target.dataset.past === "effective-from") { effectiveFrom = target.value; return; }
    if (target.dataset.past === "filter") { filter = target.value; render(); return; }
    if (target.dataset.past === "confirm-warnings") { options.confirm_warnings = target.checked; render(); return; }
    if (target.dataset.past === "confirm-corrections") { options.confirm_corrections = target.checked; render(); return; }
    reviewed = false; options.confirm_corrections = false; options.confirm_warnings = false;
    if (target.dataset.pastRow) {
      const row = options.resolutions[target.dataset.pastRow] ??= {};
      row[target.dataset.resolution!] = target.value;
    } else if (target.dataset.pastField) {
      if (target.value === "") delete options.mapping[target.dataset.pastField];
      else options.mapping[target.dataset.pastField] = Number(target.value);
      preview = undefined; options.resolutions = {};
    } else if (target.dataset.past === "file") {
      file = target.files?.[0]; inspection = undefined; preview = undefined; options.resolutions = {};
    } else if (target.dataset.past === "header") {
      options.header_row = Number(target.value); inspection = undefined; preview = undefined; options.resolutions = {};
    } else if (target.dataset.past === "sheet") {
      options.sheet = target.value; options.mapping = { ...inspection?.sheets.find(s => s.name === options.sheet)?.mapping };
      preview = undefined; options.resolutions = {};
    } else if (target.dataset.past === "month") { options.month = target.value; preview = undefined; options.resolutions = {}; }
    else if (target.dataset.past === "layout") { options.layout = target.value; preview = undefined; options.resolutions = {}; }
    render();
  };
  host.onclick = async event => {
    if (busy) return;
    const clicked = event.target as HTMLElement;
    // One-click member choice or row decision: record it the same way the row selects do, then preview again.
    const found = clicked.closest<HTMLElement>("[data-pick-member], [data-past-resolve-row]");
    const pick = found?.dataset.pickMember !== undefined || found?.dataset.pastResolveRow !== undefined ? found : null;
    let target = clicked.closest<HTMLElement>("[data-past], [data-past-batch]");
    let action = target?.dataset.past;
    if (pick) {
      const key = pick.dataset.pickRow ?? pick.dataset.pastResolveRow!;
      const field = pick.dataset.pickMember !== undefined ? "person_id" : pick.dataset.pastResolve!;
      const resolution = options.resolutions[key] ??= {};
      resolution[field] = pick.dataset.pickMember ?? pick.dataset.pastValue ?? "";
      reviewed = false; options.confirm_corrections = false; options.confirm_warnings = false; message = "";
      if (!file || !inspection) { render(); return; }
      target = pick; action = "preview";
    }
    if (!target || (action && !["template","inspect","preview","apply","save-policy","rejected"].includes(action))) return;
    if (action === "apply") {
      const blocker = blockerText();
      if (blocker) { message = blocker; render(); return; }
    }
    busy = true; message = ""; render();
    try {
      if (target.dataset.pastBatch) {
        const batch = await getPastDutyHistory(target.dataset.pastBatch);
        historyHtml = `<h4>${escape(batch.filename)}</h4><div class="member-import-table"><table><thead><tr><th>Source</th><th>Original</th><th>Normalized</th><th>Outcome / prior member</th></tr></thead><tbody>${batch.rows.map(r => `<tr><td>${r.row}:${r.column}</td><td>${values(r.raw)}</td><td>${values(r.normalized)}</td><td>${escape(r.action)}${r.before ? `<p>Previous: ${escape(r.before.name)} (${escape(r.before.status)})</p>` : ""}</td></tr>`).join("")}</tbody></table></div>`;
      } else if (action === "rejected" && preview) {
        downloadPreviewIssues(preview.rows,"past_duty_rejected_rows.csv");
      } else if (action === "template") {
        const blob = await downloadPastDutyTemplate(); const url = URL.createObjectURL(blob);
        const link = document.createElement("a"); link.href = url; link.download = "past-duties-template.xlsx"; link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      } else if (action === "save-policy") {
        await saveHistoryFairness(policy, effectiveFrom); reviewed = false;
        message = `Fairness settings saved, effective ${effectiveFrom}. Candidate suggestions use the version effective at the target month's start.`;
      } else if (file && action === "inspect") {
        inspection = await pastDutyUpload<MemberWorkbookInspection>("inspect", file, options);
        options.sheet = inspection.sheets[0]?.name ?? ""; options.mapping = { ...inspection.sheets[0]?.mapping };
        preview = undefined; options.resolutions = {}; reviewed = false;
      } else if (file && action === "preview") {
        preview = await pastDutyUpload<PastDutyPreview>("preview", file, options);
        reviewed = true; options.confirm_corrections = false; options.confirm_warnings = false;
      } else if (file && action === "apply" && reviewed && preview) {
        const result = await pastDutyUpload<{counts: Record<string,number>; replayed?: boolean}>("apply", file, options, preview.preview_hash);
        reviewed = false; preview = undefined;
        message = result.replayed ? "This reviewed batch was already applied. No additional duties or corrections were recorded." : `Recorded ${result.counts.create} new duties, ${result.counts.correct} corrections, ${result.counts.unchanged} unchanged. Statistics and future candidate scoring now use the saved records.`;
        status = await getPastDutyStatus();
      }
    } catch (error) { message = error instanceof Error && error.message ? error.message : "Past-duty operation failed."; if (action === "apply") reviewed = false; }
    finally { busy = false; if (host.isConnected) render(); }
  };
  render();
  void mountRecordedSection(host, options.month, status.today.slice(0, 7));
}

/**
 * Admin "Recorded past duties · <Month>" table, placed right after the upload host (render()
 * replaces the host's content, so it lives in a sibling). Loaded on demand; skipped when there
 * is no real DOM.
 */
async function mountRecordedSection(host: HTMLElement, month: string, maxMonth: string) {
  if (typeof document === "undefined" || typeof HTMLElement === "undefined" || !(host instanceof HTMLElement) || !host.parentElement) return;
  let section = host.nextElementSibling as HTMLElement | null;
  if (!section?.hasAttribute("data-recorded-past-duties")) {
    section = document.createElement("div");
    section.setAttribute("data-recorded-past-duties", "");
    host.after(section);
  }
  const target = section.cloneNode(false) as HTMLElement;
  section.replaceWith(target);
  try {
    const { mountRecordedPastDuties } = await import("./recycle-bin");
    if (target.isConnected) await mountRecordedPastDuties(target, month, maxMonth);
  } catch (error) {
    target.innerHTML = `<section class="panel" role="alert">Recorded past duties could not be shown: ${escape(error instanceof Error ? error.message : error)}</section>`;
  }
}
