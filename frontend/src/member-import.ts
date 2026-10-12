import {
  downloadMemberImportTemplate, memberWorkbookRequest, downloadPreviewIssues,
  type MemberImportOptions, type MemberImportPreview, type MemberWorkbookInspection,
} from "./services/api";

const escape = (value: unknown) => String(value ?? "").replace(/[&<>"']/g,
  (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
let file: File | undefined;
let inspection: MemberWorkbookInspection | undefined;
let preview: MemberImportPreview | undefined;
let options: MemberImportOptions = { sheet: "", header_row: 1, mapping: {}, resolutions: {} };
let reviewed = false;
let busy = false;
let message = "";
let reviewFilter = "all";

function details(values: Record<string, unknown>): string {
  return Object.entries(values).filter(([, value]) => value != null && value !== "" &&
    (!Array.isArray(value) || value.length > 0)).map(([field, value]) =>
    `<div><span>${escape(field.replace(/_/g, " "))}:</span> ${escape(Array.isArray(value) ? value.join("; ") : value)}</div>`).join("");
}

function changes(values: Record<string, unknown>): string {
  return Object.entries(values).map(([field, value]) => {
    const change = value as { from?: string; to?: string };
    return `<div>${escape(field.replace(/_/g, " "))}: ${change && typeof change === "object" && "to" in change
      ? `${escape(change.from || "Unassigned")} → <strong>${escape(change.to)}</strong>`
      : escape(Array.isArray(value) ? value.join("; ") : value)}</div>`;
  }).join("");
}

export function resetMemberImport() {
  file = undefined; inspection = undefined; preview = undefined;
  options = { sheet: "", header_row: 1, mapping: {}, resolutions: {} };
  reviewed = false; busy = false; message = "";
  reviewFilter = "all";
}

export function mountMemberImport(host: HTMLElement, refresh: () => Promise<void>) {
  function render() {
    const sheet = inspection?.sheets.find((s) => s.name === options.sheet);
    const callChanges = preview?.rows.filter(row => row.action === "update" && "call_level" in row.changes).length ?? 0;
    const visibleRows = preview?.rows.filter(row => reviewFilter === "all" || row.action === reviewFilter) ?? [];
    host.innerHTML = `<details class="panel member-import" ${file ? "open" : ""}>
      <summary>Import and Review Members</summary>
      <p>Upload CSV or Excel (up to 5 MB and 5000 rows). Every name is checked against the master list and saved aliases,
      including previously imported, historical, and archived members.</p>
      <p>Blank cells preserve existing values. Members absent from the file stay unchanged.
      Existing names stay unchanged when matched; duties, leave, and postings remain linked.</p>
      <p>Designation requires an effective-from date. Use Excel dates or YYYY-MM-DD.
      Separate aliases with semicolons. Resolve uncertain matches or skip rows before applying.</p>
      <fieldset ${busy ? "disabled" : ""}>
        <button type="button" data-mi="template">Download Excel Template</button>
        <button type="button" data-mi="csv-template">Download CSV Template (Name + Call Level)</button>
        <label>CSV or Excel file <input type="file" data-mi="file" accept=".csv,.xlsx" /></label>
        <span>${file ? escape(file.name) : "No file selected"}</span>
        <label>Header row <input type="number" data-mi="header" min="1" max="100" value="${options.header_row}" /></label>
        <button type="button" data-mi="inspect" ${file ? "" : "disabled"}>Read File and Columns</button>
        ${inspection ? `<label>Worksheet <select data-mi="sheet">${inspection.sheets.map(s =>
          `<option ${s.name === options.sheet ? "selected" : ""} value="${escape(s.name)}">${escape(s.name)}</option>`).join("")}</select></label>
        <div class="member-import-mapping">${inspection.fields.map(field => `<label>${escape(field.replace(/_/g, " "))}${field === "name" ? " *" : ""}
          <select data-mi-field="${field}"><option value="">Ignore column</option>${sheet?.headers.map((header, index) =>
            `<option value="${index}" ${options.mapping[field] === index ? "selected" : ""}>${index + 1}: ${escape(header || "(blank header)")}</option>`).join("")}</select></label>`).join("")}</div>
        <button type="button" class="primary" data-mi="preview">Preview Normalized Members</button>` : ""}
        ${preview ? `<p>${Object.entries(preview.counts).map(([action, count]) => `${count} ${escape(action.replace(/_/g, " "))}`).join(" · ")}</p>
        ${!reviewed ? "<p>Selections changed. Preview again to review the updated result.</p>" : ""}
        <label>Review rows <select data-mi="filter">${["all", "needs_review", "update", "create", "unchanged", "skip"].map(action =>
          `<option value="${action}" ${reviewFilter === action ? "selected" : ""}>${escape(action.replace(/_/g, " "))}</option>`).join("")}</select></label>
        <button type="button" data-mi="rejected">Download Rejected Rows CSV</button>
        <div class="member-import-table"><table><thead><tr><th>File row / original</th><th>Normalized details</th><th>Action / changes</th><th>Resolve</th></tr></thead>
        <tbody>${visibleRows.map(row => `<tr><td>${row.row}${details(row.raw)}</td>
          <td>${details(row.normalized)}</td>
          <td><strong>${escape(row.action.replace(/_/g, " "))}</strong>${row.target_name ? `<p>Matched: ${escape(row.target_name)}</p>` : ""}
            ${changes(row.changes)}
            ${row.errors.map(error => `<p>${escape(error)}</p>`).join("")}</td>
          <td><select data-mi-row="${row.row}" aria-label="Resolve file row ${row.row}">
            <option value="">Automatic / review required</option>
            <option value="skip" ${options.resolutions[row.row] === "skip" ? "selected" : ""}>Skip this row</option>
            <option value="new" ${options.resolutions[row.row] === "new" ? "selected" : ""}>Create as a new member</option>
            ${row.candidates.map(candidate => `<option value="${candidate.id}" ${options.resolutions[row.row] === candidate.id ? "selected" : ""}>Match ${escape(candidate.name)}</option>`).join("")}
          </select></td></tr>`).join("")}</tbody></table></div>
        ${callChanges ? `<label class="member-import-confirm"><input type="checkbox" data-mi="confirm-calls" ${options.confirm_call_changes ? "checked" : ""} />
          I reviewed and approve the ${callChanges} existing member call-level changes shown above.</label>` : ""}
        <p>Apply records the reviewed changes and source rows in import history.</p>
        <button type="button" class="primary" data-mi="apply" ${reviewed && !preview.counts.needs_review &&
          (!callChanges || options.confirm_call_changes) && preview.rows.length > 0 ? "" : "disabled"}>Apply Reviewed Import</button>` : ""}
      </fieldset><p role="status" aria-live="polite">${busy ? "Working…" : escape(message)}</p>
    </details>`;
  }

  // Replacing handlers prevents duplicates when the member screen refreshes.
  host.onchange = (event) => {
    const target = event.target as HTMLInputElement;
    if (target.dataset.mi === "filter") { reviewFilter = target.value; render(); return; }
    if (target.dataset.mi === "confirm-calls") { options.confirm_call_changes = target.checked; render(); return; }
    reviewed = false;
    options.confirm_call_changes = false;
    message = "";
    if (target.dataset.mi === "file") {
      file = target.files?.[0]; inspection = undefined; preview = undefined;
      options = { sheet: "", header_row: 1, mapping: {}, resolutions: {} };
    } else if (target.dataset.mi === "header") {
      options.header_row = Number(target.value); inspection = undefined; preview = undefined;
    } else if (target.dataset.mi === "sheet") {
      options.sheet = target.value;
      options.mapping = { ...inspection?.sheets.find(s => s.name === target.value)?.mapping };
      options.resolutions = {}; preview = undefined;
    } else if (target.dataset.miField) {
      if (target.value === "") delete options.mapping[target.dataset.miField];
      else options.mapping[target.dataset.miField] = Number(target.value);
      options.resolutions = {}; preview = undefined;
    } else if (target.dataset.miRow) {
      options.resolutions[target.dataset.miRow] = target.value;
    }
    render();
  };

  host.onclick = async (event) => {
    const action = (event.target as HTMLElement).closest<HTMLElement>("[data-mi]")?.dataset.mi;
    if (!action || ["file", "sheet", "header", "filter", "confirm-calls"].includes(action) || busy) return;
    busy = true; message = ""; render();
    try {
      if (action === "rejected" && preview) downloadPreviewIssues(preview.rows, "member_rejected_rows.csv");
      else if (action === "template" || action === "csv-template") {
        const format = action === "csv-template" ? "csv" : "xlsx";
        const blob = await downloadMemberImportTemplate(format);
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url; link.download = `department-members-template.${format}`; link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      } else if (file && action === "inspect") {
        inspection = await memberWorkbookRequest<MemberWorkbookInspection>("inspect", file, options);
        options.sheet = inspection.sheets[0]?.name ?? "";
        options.mapping = { ...inspection.sheets[0]?.mapping };
        options.resolutions = {}; preview = undefined; reviewed = false;
        options.confirm_call_changes = false; reviewFilter = "all";
      } else if (file && action === "preview") {
        preview = await memberWorkbookRequest<MemberImportPreview>("preview", file, options);
        options.confirm_call_changes = false;
        reviewed = true;
      } else if (file && action === "apply" && preview && reviewed) {
        const result = await memberWorkbookRequest<{ counts: Record<string, number>; replayed?: boolean }>("apply", file, options, preview.preview_hash);
        message = result.replayed ? "This reviewed batch was already applied. No additional members were created or changed." : `Imported ${result.counts.create} new members and updated ${result.counts.update}. ${result.counts.unchanged} unchanged; ${result.counts.skip} skipped. Master list and counts refreshed.`;
        reviewed = false; preview = undefined;
        busy = false;
        await refresh();
      }
    } catch (error) {
      message = error instanceof Error ? error.message : "Import failed.";
      if (action === "apply") reviewed = false;
    } finally {
      busy = false; render();
    }
  };
  render();
}
