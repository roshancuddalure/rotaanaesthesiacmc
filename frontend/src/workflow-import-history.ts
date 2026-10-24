import { getWorkflowImportHistory, getWorkflowImportRows, downloadRejectedImportRows,
  type WorkflowImportKind, type WorkflowImportHistory, type WorkflowImportRows } from "./services/api";
import { emptyState, formatMonth, retainActionFocus } from "./ui";
import { formatAuditTimestamp } from "./audit-time";

const escape = (value: unknown) => String(value ?? "").replace(/[&<>"']/g,
  c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]!);

const historyLoads = new WeakMap<HTMLElement, number>();

export async function mountWorkflowImportHistory(host: HTMLElement, kind: WorkflowImportKind, month?: string) {
  const generation = (historyLoads.get(host) ?? 0) + 1;
  historyLoads.set(host, generation);
  const isCurrent = () => host.isConnected && historyLoads.get(host) === generation;
  let history: WorkflowImportHistory;
  let detail: WorkflowImportRows | undefined;
  let selected = "";
  let busy = false;
  let message = "";
  function focusTarget(action?: string, batch?: string) {
    const buttons = [...host.querySelectorAll<HTMLButtonElement>('[data-history]:not(:disabled)')];
    const exact = buttons.find(button => button.dataset.history === action && button.dataset.batch === batch);
    if (exact) return exact;
    const opposite: Record<string, string> = { next: 'previous', previous: 'next', 'rows-next': 'rows-previous', 'rows-previous': 'rows-next' };
    const pager = action && buttons.find(button => button.dataset.history === opposite[action]);
    if (pager) return pager;
    if (!action && buttons[0]) return buttons[0];
    const heading = host.querySelector<HTMLElement>('h3');
    if (heading) heading.tabIndex = -1;
    return heading;
  }
  function render() {
    if (!isCurrent()) return;
    const focusedRegion = host.contains(document.activeElement) && document.activeElement?.matches('.table-scroll')
      ? document.activeElement.getAttribute('aria-label') : null;
    host.innerHTML = `<section class="panel import-history"><h3>Import history${month ? ` · ${escape(formatMonth(month))}` : ""}</h3>
      <p>Each applied import keeps its source rows and outcomes. Re-applying the same reviewed batch never creates duplicates.</p>
      ${history.items.length ? `<div class="table-scroll" tabindex="0" aria-label="Import batch history"><table><caption class="visually-hidden">${escape(kind)} import batches</caption><thead><tr><th scope="col">File / month</th><th scope="col">Account / time</th><th scope="col">Outcome</th><th scope="col">Review</th></tr></thead>
      <tbody>${history.items.map(batch => `<tr><td>${escape(batch.filename)}<small>${escape(formatMonth(batch.month))}</small></td><td>${escape(batch.actor)}<small>${escape(batch.at ? formatAuditTimestamp(batch.at) : batch.status)}</small></td>
      <td>${Object.entries(batch.counts).map(([key,value])=>`${value} ${escape(key.replace(/_/g," "))}`).join("; ")}</td><td><button type="button" class="icon-button btn-sm" data-history="open" data-batch="${escape(batch.id)}" ${busy?"disabled":""}>View rows</button>
      <button type="button" class="quiet-button btn-sm" data-history="download" data-batch="${escape(batch.id)}" ${busy?"disabled":""}>Rejected rows CSV</button></td></tr>`).join("")}</tbody></table></div>` : emptyState({ title: "No imports yet", body: month ? "Nothing has been imported for this month." : "Nothing has been imported yet." })}
      ${history.offset > 0 || history.has_more ? `<div class="pager"><button type="button" class="icon-button btn-sm" data-history="previous" ${busy||history.offset===0?"disabled":""}>Previous batches</button><button type="button" class="icon-button btn-sm" data-history="next" ${busy||!history.has_more?"disabled":""}>Next batches</button></div>` : ""}
      ${detail ? `<h4>${escape(detail.filename)}</h4><div class="table-scroll" tabindex="0" aria-label="Recorded import source rows"><table><thead><tr><th scope="col">Source</th><th scope="col">Original</th><th scope="col">Normalized</th><th scope="col">Outcome</th></tr></thead><tbody>${detail.rows.map(row=>`<tr><td>${escape(row.sheet)} / ${row.row??""}</td><td><pre>${escape(JSON.stringify(row.raw,null,2))}</pre></td><td><pre>${escape(JSON.stringify(row.normalized,null,2))}</pre></td><td><pre>${escape(JSON.stringify(row.outcome,null,2))}</pre></td></tr>`).join("")}</tbody></table></div>
      <div class="pager"><button type="button" class="icon-button btn-sm" data-history="rows-previous" ${busy||detail.offset===0?"disabled":""}>Previous rows</button><button type="button" class="icon-button btn-sm" data-history="rows-next" ${busy||!detail.has_more?"disabled":""}>Next rows</button></div>` : ""}
      <p role="status" aria-live="polite">${busy?"Loading…":escape(message)}</p></section>`;
    if (focusedRegion && document.activeElement === document.body) {
      [...host.querySelectorAll<HTMLElement>('.table-scroll')].find(region => region.getAttribute('aria-label') === focusedRegion)?.focus();
    }
  }
  host.innerHTML='<section class="panel"><p role="status">Loading import history…</p></section>';
  host.onclick = null;
  try { history=await getWorkflowImportHistory(kind,month); }
  catch(error) {
    if (!isCurrent()) return;
    host.innerHTML=`<section class="panel"><h3>Import history unavailable</h3><p role="alert">${escape(error instanceof Error?error.message:error)}</p><button type="button" data-history-retry>Try again</button></section>`;
    host.querySelector<HTMLButtonElement>('[data-history-retry]')?.addEventListener('click', event => {
      const restoreFocus = retainActionFocus(host, event.currentTarget as HTMLElement, () => host.querySelector<HTMLElement>('[data-history-retry]') ?? focusTarget());
      const retryGeneration = (historyLoads.get(host) ?? 0) + 1;
      void mountWorkflowImportHistory(host, kind, month).finally(() => restoreFocus(historyLoads.get(host) === retryGeneration));
    });
    return;
  }
  if (!isCurrent()) return;
  host.onclick=async event=>{
    const button=(event.target as HTMLElement).closest<HTMLButtonElement>('[data-history]');
    if (!button || busy) return;
    const action=button.dataset.history;
    const restoreFocus = retainActionFocus(host, button, () => focusTarget(action, button.dataset.batch));
    busy=true;message="";render();
    try {
      if(action==='download' && button.dataset.batch) await downloadRejectedImportRows(kind,button.dataset.batch);
      else if(action==='open' && button.dataset.batch) {
        const batch = button.dataset.batch;
        const loaded = await getWorkflowImportRows(kind,batch);
        if (!isCurrent()) return;
        selected=batch;detail=loaded;
      }
      else if(action==='next'||action==='previous') { history=await getWorkflowImportHistory(kind,month,Math.max(0,history.offset+(action==='next'?25:-25)));detail=undefined; }
      else if(detail && (action==='rows-next'||action==='rows-previous')) detail=await getWorkflowImportRows(kind,selected,Math.max(0,detail.offset+(action==='rows-next'?50:-50)));
    } catch(error) { message=error instanceof Error?error.message:'Unable to load import records'; }
    finally {busy=false;render();restoreFocus(isCurrent());}
  };
  render();
}
