import { getMemberImportHistory, getMemberImportHistoryDetail } from "./services/api";
import { retainActionFocus } from "./ui";
import { formatAuditTimestamp } from "./audit-time";
import { matchesImportHistory } from "./history-filter";

const historyLoads = new WeakMap<HTMLElement, number>();
const historyQueries = new WeakMap<HTMLElement, string>();
let memberHistoryScopeSequence = 0;

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
  host.oninput = null;
  host.innerHTML = '<section class="panel"><h3>Import History</h3><p role="status">Loading imports…</p></section>';
  try {
    const history = await getMemberImportHistory();
    if (!isCurrent()) return;
    const searchScopeId = `member-history-search-scope-${++memberHistoryScopeSequence}`;
    host.innerHTML = `<section class="panel member-import-history"><h3>Import History</h3>
      <p>Recent CSV and Excel imports into the same master list. Open a batch to review the recorded source rows and changes.</p>
      <label>Search returned member imports<input type="search" data-member-history-search value="${escape(historyQueries.get(host) ?? "")}" aria-describedby="${searchScopeId}"></label>
      <p id="${searchScopeId}">Search filenames, worksheets, recorded import times, people and displayed results in this returned list.</p>
      <button type="button" data-member-history-clear>Clear search</button><p role="status" data-member-history-matches></p>
      <p data-member-history-no-matches hidden>No returned imports match this search. Clear search to show the returned list.</p>
      ${history.length ? `<div class="member-import-table" tabindex="0" role="region" aria-label="Member import batch history"><table><caption class="visually-hidden">Member import batches</caption><thead><tr><th scope="col">File / worksheet</th><th scope="col">Imported</th><th scope="col">By</th><th scope="col">Result</th><th scope="col">Review</th></tr></thead>
      <tbody>${history.map(batch => `<tr data-member-history-row="${escape(batch.id)}"><td>${escape(batch.filename)}<small>${escape(batch.sheet ?? "")}</small></td>
        <td>${escape(batch.completed_at ? formatAuditTimestamp(batch.completed_at, "Asia/Kolkata") : batch.status)}</td>
        <td>${escape(batch.actor)}</td><td>${Object.entries(batch.counts).map(([action, count]) => `${count} ${escape(action.replace(/_/g, " "))}`).join(" · ")}</td>
        <td><button type="button" data-member-batch="${escape(batch.id)}">View Rows</button></td></tr>`).join("")}</tbody></table></div>` : "<p>No member imports recorded yet.</p>"}
      <p data-member-history-detail-filter-context hidden></p><div data-member-history-detail></div><p role="status" data-member-history-status></p><button type="button" data-member-history-detail-retry hidden>Retry recorded rows</button></section>`;
    const search = host.querySelector<HTMLInputElement>("[data-member-history-search]")!;
    const matches = host.querySelector<HTMLElement>("[data-member-history-matches]")!;
    const noMatches = host.querySelector<HTMLElement>("[data-member-history-no-matches]")!;
    const detailFilterContext = host.querySelector<HTMLElement>("[data-member-history-detail-filter-context]")!;
    const detailRetry = host.querySelector<HTMLButtonElement>("[data-member-history-detail-retry]")!;
    const listRows = Array.from(host.querySelectorAll<HTMLTableRowElement>("[data-member-history-row]"));
    let selectedDetail: { id: string; filename: string } | null = null;
    let retryBatchId: string | null = null;
    let detailSequence = 0;
    const applyFilter = () => {
      const query = search.value;
      historyQueries.set(host, query);
      let count = 0;
      history.forEach((batch, index) => {
        const displayedTime = batch.completed_at ? formatAuditTimestamp(batch.completed_at, "Asia/Kolkata") : batch.status;
        const displayedResults = Object.entries(batch.counts).map(([action, count]) => `${count} ${action.replace(/_/g, " ")}`).join(" · ");
        const visible = matchesImportHistory(query, [batch.filename, batch.sheet ?? "", displayedTime, batch.actor, displayedResults]);
        listRows[index].hidden = !visible;
        if (visible) count++;
      });
      matches.textContent = `${count} of ${history.length} returned imports shown.`;
      noMatches.hidden = count > 0 || history.length === 0;
      const detailSelection = selectedDetail;
      const selectedHidden = detailSelection && listRows.some(row => row.dataset.memberHistoryRow === detailSelection.id && row.hidden);
      detailFilterContext.hidden = !selectedHidden;
      detailFilterContext.textContent = selectedHidden ? `Recorded rows below remain for ${detailSelection!.filename} (batch ${detailSelection!.id}), which is outside the current search results.` : "";
    };
    host.oninput = event => {
      if (!isCurrent() || event.target !== search) return;
      applyFilter();
    };
    applyFilter();
    host.onclick = async event => {
      if (!isCurrent()) return;
      const target = event.target as HTMLElement;
      if (target.closest("[data-member-history-clear]")) {
        search.value = "";
        applyFilter();
        search.focus();
        return;
      }
      const retry = target.closest<HTMLButtonElement>("[data-member-history-detail-retry]");
      const button = target.closest<HTMLButtonElement>("[data-member-batch]");
      const batchId = retry ? retryBatchId : button?.dataset.memberBatch;
      if (!batchId || (retry ?? button)?.disabled) return;
      const requestedBatch = history.find(batch => batch.id === batchId);
      if (!requestedBatch) return;
      const sequence = ++detailSequence;
      const isDetailCurrent = () => isCurrent() && detailSequence === sequence;
      const detail = host.querySelector<HTMLElement>("[data-member-history-detail]")!;
      const status = host.querySelector<HTMLElement>("[data-member-history-status]")!;
      const action = (retry ?? button)!;
      const restoreFocus = retainActionFocus(host, action, () => {
        if (action.isConnected && !action.hidden && !action.closest("tr[hidden]")) return action;
        return search;
      });
      host.querySelectorAll<HTMLButtonElement>("[data-member-batch]").forEach(item => item.disabled = true);
      detailRetry.hidden = true;
      detailRetry.disabled = true;
      status.textContent = `Loading recorded rows for ${requestedBatch.filename} (batch ${batchId})…`;
      try {
        const batch = await getMemberImportHistoryDetail(batchId);
        if (!isDetailCurrent()) return;
        if (batch.batch.id !== batchId) throw new Error("The returned batch does not match the requested import. Retry recorded rows.");
        selectedDetail = { id: batchId, filename: batch.batch.filename };
        detail.innerHTML = `<h4>${escape(batch.batch.filename)}</h4><p>Batch ${escape(batchId)}</p>
          <p>${batch.batch.call_changes_confirmed ? "Call-level changes were explicitly approved for this import." : "Recorded import details."}</p>
          <div class="member-import-table" tabindex="0" role="region" aria-label="Recorded member import source rows"><table><caption class="visually-hidden">Recorded member import rows</caption><thead><tr><th scope="col">File row</th><th scope="col">Original</th><th scope="col">Normalized</th><th scope="col">Action / changes</th></tr></thead>
          <tbody>${batch.rows.map(row => `<tr><td>${escape(row.sheet)} / ${row.row}</td><td>${fields(row.raw)}</td>
          <td>${fields(row.normalized)}</td><td>${escape(row.action)}${fields(row.changes)}${row.errors.map(error => `<p>${escape(error)}</p>`).join("")}</td></tr>`).join("")}</tbody></table></div>`;
        retryBatchId = null;
        status.textContent = "";
        applyFilter();
      } catch (error) {
        if (isDetailCurrent()) {
          retryBatchId = batchId;
          status.textContent = `Recorded rows for ${requestedBatch.filename} (batch ${batchId}) could not be loaded. ${error instanceof Error ? error.message : "Unable to load import rows."}`;
          detailRetry.hidden = false;
        }
      } finally {
        if (isDetailCurrent()) {
          host.querySelectorAll<HTMLButtonElement>("[data-member-batch]").forEach(item => item.disabled = false);
          detailRetry.disabled = false;
        }
        restoreFocus(isDetailCurrent());
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
