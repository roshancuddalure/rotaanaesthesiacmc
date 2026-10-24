import { getMemberImportHistory, getMemberImportHistoryDetail } from "./services/api";
import { retainActionFocus } from "./ui";
import { formatAuditTimestamp } from "./audit-time";

const historyLoads = new WeakMap<HTMLElement, number>();

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
  const generation = (historyLoads.get(host) ?? 0) + 1;
  historyLoads.set(host, generation);
  const isCurrent = () => host.isConnected && historyLoads.get(host) === generation;
  host.onclick = null;
  host.innerHTML = '<section class="panel"><h3>Import History</h3><p role="status">Loading imports…</p></section>';
  try {
    const history = await getMemberImportHistory();
    if (!isCurrent()) return;
    host.innerHTML = `<section class="panel member-import-history"><h3>Import History</h3>
      <p>Recent CSV and Excel imports into the same master list. Open a batch to review the recorded source rows and changes.</p>
      ${history.length ? `<div class="member-import-table" tabindex="0" role="region" aria-label="Member import batch history"><table><caption class="visually-hidden">Member import batches</caption><thead><tr><th scope="col">File / worksheet</th><th scope="col">Imported</th><th scope="col">By</th><th scope="col">Result</th><th scope="col">Review</th></tr></thead>
      <tbody>${history.map(batch => `<tr><td>${escape(batch.filename)}<small>${escape(batch.sheet ?? "")}</small></td>
        <td>${escape(batch.completed_at ? formatAuditTimestamp(batch.completed_at, "Asia/Kolkata") : batch.status)}</td>
        <td>${escape(batch.actor)}</td><td>${Object.entries(batch.counts).map(([action, count]) => `${count} ${escape(action.replace(/_/g, " "))}`).join(" · ")}</td>
        <td><button type="button" data-member-batch="${escape(batch.id)}">View Rows</button></td></tr>`).join("")}</tbody></table></div>` : "<p>No member imports recorded yet.</p>"}
      <div data-member-history-detail></div><p role="status" data-member-history-status></p></section>`;
    host.onclick = async event => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-member-batch]");
      if (!button?.dataset.memberBatch) return;
      const detail = host.querySelector<HTMLElement>("[data-member-history-detail]")!;
      const status = host.querySelector<HTMLElement>("[data-member-history-status]")!;
      const restoreFocus = retainActionFocus(host, button, () => button.isConnected ? button : null);
      host.querySelectorAll<HTMLButtonElement>("[data-member-batch]").forEach(item => item.disabled = true);
      status.textContent = "Loading recorded rows…";
      try {
        const batch = await getMemberImportHistoryDetail(button.dataset.memberBatch);
        if (!isCurrent()) return;
        detail.innerHTML = `<h4>${escape(batch.batch.filename)}</h4>
          <p>${batch.batch.call_changes_confirmed ? "Call-level changes were explicitly approved for this import." : "Recorded import details."}</p>
          <div class="member-import-table" tabindex="0" role="region" aria-label="Recorded member import source rows"><table><caption class="visually-hidden">Recorded member import rows</caption><thead><tr><th scope="col">File row</th><th scope="col">Original</th><th scope="col">Normalized</th><th scope="col">Action / changes</th></tr></thead>
          <tbody>${batch.rows.map(row => `<tr><td>${escape(row.sheet)} / ${row.row}</td><td>${fields(row.raw)}</td>
          <td>${fields(row.normalized)}</td><td>${escape(row.action)}${fields(row.changes)}${row.errors.map(error => `<p>${escape(error)}</p>`).join("")}</td></tr>`).join("")}</tbody></table></div>`;
        status.textContent = "";
      } catch (error) { if (isCurrent()) status.textContent = error instanceof Error ? error.message : "Unable to load import rows."; }
      finally {
        if (isCurrent()) host.querySelectorAll<HTMLButtonElement>("[data-member-batch]").forEach(item => item.disabled = false);
        restoreFocus(isCurrent());
      }
    };
  } catch (error) {
    if (!isCurrent()) return;
    host.innerHTML = `<section class="panel"><h3>Import history unavailable</h3><p role="alert">${escape(error instanceof Error ? error.message : "Unable to load import history.")}</p><button type="button" data-member-history-retry>Try again</button></section>`;
    host.querySelector<HTMLButtonElement>('[data-member-history-retry]')?.addEventListener('click', event => {
      const restoreFocus = retainActionFocus(host, event.currentTarget as HTMLElement, () => {
        const target = host.querySelector<HTMLElement>('[data-member-history-retry], [data-member-batch]') ?? host.querySelector<HTMLElement>('h3');
        if (target?.tagName === 'H3') target.tabIndex = -1;
        return target;
      });
      const retryGeneration = (historyLoads.get(host) ?? 0) + 1;
      void mountMemberImportHistory(host).finally(() => restoreFocus(historyLoads.get(host) === retryGeneration));
    });
  }
}
