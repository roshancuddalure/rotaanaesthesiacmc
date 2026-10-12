import {
  downloadMemberImportTemplate, memberWorkbookRequest,
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

export function resetMemberImport() {
  file = undefined; inspection = undefined; preview = undefined;
  options = { sheet: "", header_row: 1, mapping: {}, resolutions: {} };
  reviewed = false; busy = false; message = "";
}

export function mountMemberImport(host: HTMLElement, refresh: () => Promise<void>) {
  function render() {
    const sheet = inspection?.sheets.find((s) => s.name === options.sheet);
    host.innerHTML = `<details class="panel member-import" ${file ? "open" : ""}>
      <summary>Import Members from Excel</summary>
      <p>Upload an .xlsx workbook (up to 5 MB and 5000 rows). Review changes before importing.
      Existing names stay unchanged when matched; blank cells preserve existing values.</p>
      <p>Designation requires an effective-from date. Use Excel dates or YYYY-MM-DD.
      Separate aliases with semicolons. Resolve uncertain matches or skip rows before applying.</p>
      <fieldset ${busy ? "disabled" : ""}>
        <button type="button" data-mi="template">Download Excel Template</button>
        <label>Excel workbook <input type="file" data-mi="file" accept=".xlsx" /></label>
        <span>${file ? escape(file.name) : "No file selected"}</span>
        <label>Header row <input type="number" data-mi="header" min="1" max="100" value="${options.header_row}" /></label>
        <button type="button" data-mi="inspect" ${file ? "" : "disabled"}>Read Worksheets</button>
        ${inspection ? `<label>Worksheet <select data-mi="sheet">${inspection.sheets.map(s =>
          `<option ${s.name === options.sheet ? "selected" : ""} value="${escape(s.name)}">${escape(s.name)}</option>`).join("")}</select></label>
        <div class="member-import-mapping">${inspection.fields.map(field => `<label>${escape(field.replace(/_/g, " "))}${field === "name" ? " *" : ""}
          <select data-mi-field="${field}"><option value="">Ignore column</option>${sheet?.headers.map((header, index) =>
            `<option value="${index}" ${options.mapping[field] === index ? "selected" : ""}>${index + 1}: ${escape(header || "(blank header)")}</option>`).join("")}</select></label>`).join("")}</div>
        <button type="button" class="primary" data-mi="preview">Preview Normalized Members</button>` : ""}
        ${preview ? `<p>${Object.entries(preview.counts).map(([action, count]) => `${count} ${escape(action.replace(/_/g, " "))}`).join(" · ")}</p>
        ${!reviewed ? "<p>Selections changed. Preview again to review the updated result.</p>" : ""}
        <div class="member-import-table"><table><thead><tr><th>Excel row / original</th><th>Normalized details</th><th>Action / changes</th><th>Resolve</th></tr></thead>
        <tbody>${preview.rows.map(row => `<tr><td>${row.row}<pre>${escape(JSON.stringify(row.raw, null, 2))}</pre></td>
          <td><pre>${escape(JSON.stringify(row.normalized, null, 2))}</pre></td>
          <td>${escape(row.action.replace(/_/g, " "))}${row.target_name ? `<p>Matched: ${escape(row.target_name)}</p>` : ""}
            ${Object.keys(row.changes).length ? `<pre>${escape(JSON.stringify(row.changes, null, 2))}</pre>` : ""}
            ${row.errors.map(error => `<p>${escape(error)}</p>`).join("")}</td>
          <td><select data-mi-row="${row.row}" aria-label="Resolve Excel row ${row.row}">
            <option value="">Automatic / review required</option>
            <option value="skip" ${options.resolutions[row.row] === "skip" ? "selected" : ""}>Skip this row</option>
            <option value="new" ${options.resolutions[row.row] === "new" ? "selected" : ""}>Create as a new member</option>
            ${row.candidates.map(candidate => `<option value="${candidate.id}" ${options.resolutions[row.row] === candidate.id ? "selected" : ""}>Match ${escape(candidate.name)}</option>`).join("")}
          </select></td></tr>`).join("")}</tbody></table></div>
        <p>Apply records the reviewed changes and source rows in import history.</p>
        <button type="button" class="primary" data-mi="apply" ${reviewed && !preview.counts.needs_review &&
          (preview.counts.create + preview.counts.update > 0) ? "" : "disabled"}>Apply Reviewed Import</button>` : ""}
      </fieldset><p role="status" aria-live="polite">${busy ? "Working…" : escape(message)}</p>
    </details>`;
  }

  // Replacing handlers prevents duplicates when the member screen refreshes.
  host.onchange = (event) => {
    const target = event.target as HTMLInputElement;
    reviewed = false;
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
    if (!action || ["file", "sheet", "header"].includes(action) || busy) return;
    busy = true; message = ""; render();
    try {
      if (action === "template") {
        const blob = await downloadMemberImportTemplate();
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url; link.download = "department-members-template.xlsx"; link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      } else if (file && action === "inspect") {
        inspection = await memberWorkbookRequest<MemberWorkbookInspection>("inspect", file, options);
        options.sheet = inspection.sheets[0]?.name ?? "";
        options.mapping = { ...inspection.sheets[0]?.mapping };
        options.resolutions = {}; preview = undefined; reviewed = false;
      } else if (file && action === "preview") {
        preview = await memberWorkbookRequest<MemberImportPreview>("preview", file, options);
        reviewed = true;
      } else if (file && action === "apply" && preview && reviewed) {
        const result = await memberWorkbookRequest<{ counts: Record<string, number> }>("apply", file, options, preview.preview_hash);
        message = `Imported ${result.counts.create} new members and updated ${result.counts.update}. Skipped ${result.counts.skip} rows.`;
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
