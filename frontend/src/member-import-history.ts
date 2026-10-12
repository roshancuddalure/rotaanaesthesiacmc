import { getMemberImportHistory, getMemberImportHistoryDetail } from "./services/api";

const escape = (value: unknown) => String(value ?? "").replace(/[&<>"']/g,
  character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
function fields(data: Record<string, unknown>) {
  return Object.entries(data).filter(([, value]) => value != null && value !== "").map(([field, value]) => {
    const change = value as { from?: unknown; to?: unknown };
    const display = Array.isArray(value) ? value.join("; ")
      : typeof value === "object" && change && "to" in change
        ? `${change.from || "Unassigned"} → ${change.to}` : value;
    return `<div>${escape(field.replace(/_/g, " "))}: ${escape(display)}</div>`;
  }).join("");
}

export async function mountMemberImportHistory(host: HTMLElement) {
  host.innerHTML = '<section class="panel"><h3>Import History</h3><p role="status">Loading imports…</p></section>';
  try {
    const history = await getMemberImportHistory();
    if (!host.isConnected) return;
    host.innerHTML = `<section class="panel member-import-history"><h3>Import History</h3>
      <p>Recent CSV and Excel imports into the same master list. Open a batch to review the recorded source rows and changes.</p>
      ${history.length ? `<div class="member-import-table"><table><thead><tr><th>File / worksheet</th><th>Imported</th><th>By</th><th>Result</th><th>Review</th></tr></thead>
      <tbody>${history.map(batch => `<tr><td>${escape(batch.filename)}<small>${escape(batch.sheet ?? "")}</small></td>
        <td>${escape(batch.completed_at ? new Date(batch.completed_at).toLocaleString("en-IN", { timeZone: "Asia/Calcutta" }) : batch.status)}</td>
        <td>${escape(batch.actor)}</td><td>${Object.entries(batch.counts).map(([action, count]) => `${count} ${escape(action.replace(/_/g, " "))}`).join(" · ")}</td>
        <td><button type="button" data-member-batch="${batch.id}">View Rows</button></td></tr>`).join("")}</tbody></table></div>` : "<p>No member imports recorded yet.</p>"}
      <div data-member-history-detail></div><p role="status" data-member-history-status></p></section>`;
    host.onclick = async event => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-member-batch]");
      if (!button?.dataset.memberBatch) return;
      const detail = host.querySelector<HTMLElement>("[data-member-history-detail]")!;
      const status = host.querySelector<HTMLElement>("[data-member-history-status]")!;
      host.querySelectorAll<HTMLButtonElement>("[data-member-batch]").forEach(item => item.disabled = true);
      status.textContent = "Loading recorded rows…";
      try {
        const batch = await getMemberImportHistoryDetail(button.dataset.memberBatch);
        if (!host.isConnected) return;
        detail.innerHTML = `<h4>${escape(batch.batch.filename)}</h4>
          <p>${batch.batch.call_changes_confirmed ? "Call-level changes were explicitly approved for this import." : "Recorded import details."}</p>
          <div class="member-import-table"><table><thead><tr><th>File row</th><th>Original</th><th>Normalized</th><th>Action / changes</th></tr></thead>
          <tbody>${batch.rows.map(row => `<tr><td>${escape(row.sheet)} / ${row.row}</td><td>${fields(row.raw)}</td>
          <td>${fields(row.normalized)}</td><td>${escape(row.action)}${fields(row.changes)}${row.errors.map(error => `<p>${escape(error)}</p>`).join("")}</td></tr>`).join("")}</tbody></table></div>`;
        status.textContent = "";
      } catch (error) { status.textContent = error instanceof Error ? error.message : "Unable to load import rows."; }
      finally { host.querySelectorAll<HTMLButtonElement>("[data-member-batch]").forEach(item => item.disabled = false); }
    };
  } catch (error) {
    host.innerHTML = `<section class="panel"><h3>Import History</h3><p role="status">${escape(error instanceof Error ? error.message : "Unable to load import history.")}</p></section>`;
  }
}
