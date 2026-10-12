import { getWorkflowImportHistory, getWorkflowImportRows, downloadRejectedImportRows,
  type WorkflowImportKind, type WorkflowImportHistory, type WorkflowImportRows } from "./services/api";

const escape = (value: unknown) => String(value ?? "").replace(/[&<>"']/g,
  c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]!);

export async function mountWorkflowImportHistory(host: HTMLElement, kind: WorkflowImportKind, month?: string) {
  let history: WorkflowImportHistory;
  let detail: WorkflowImportRows | undefined;
  let selected = "";
  let busy = false;
  let message = "";
  function render() {
    if (!host.isConnected) return;
    host.innerHTML = `<section class="panel"><h3>Import History${month ? ` — ${escape(month)}` : ""}</h3>
      <p>Reviewed batches retain source rows, outcomes and linked records. Repeating an applied batch does not create duplicate records.</p>
      <div class="table-scroll" tabindex="0" aria-label="Import batch history"><table><caption class="visually-hidden">${escape(kind)} import batches</caption><thead><tr><th scope="col">File / month</th><th scope="col">Account / time</th><th scope="col">Outcome</th><th scope="col">Review</th></tr></thead>
      <tbody>${history.items.map(batch => `<tr><td>${escape(batch.filename)}<small>${escape(batch.month)}</small></td><td>${escape(batch.actor)}<small>${escape(batch.at ? new Date(batch.at).toLocaleString() : batch.status)}</small></td>
      <td>${Object.entries(batch.counts).map(([key,value])=>`${value} ${escape(key.replace(/_/g," "))}`).join("; ")}</td><td><button type="button" data-history="open" data-batch="${escape(batch.id)}" ${busy?"disabled":""}>View Rows</button>
      <button type="button" data-history="download" data-batch="${escape(batch.id)}" ${busy?"disabled":""}>Rejected Rows CSV</button></td></tr>`).join("") || '<tr><td colspan="4">No reviewed uploads yet.</td></tr>'}</tbody></table></div>
      <div class="topbar-actions"><button type="button" data-history="previous" ${busy||history.offset===0?"disabled":""}>Previous batches</button><button type="button" data-history="next" ${busy||!history.has_more?"disabled":""}>Next batches</button></div>
      ${detail ? `<h4>${escape(detail.filename)}</h4><div class="table-scroll" tabindex="0" aria-label="Recorded import source rows"><table><thead><tr><th scope="col">Source</th><th scope="col">Original</th><th scope="col">Normalized</th><th scope="col">Outcome</th></tr></thead><tbody>${detail.rows.map(row=>`<tr><td>${escape(row.sheet)} / ${row.row??""}</td><td><pre>${escape(JSON.stringify(row.raw,null,2))}</pre></td><td><pre>${escape(JSON.stringify(row.normalized,null,2))}</pre></td><td><pre>${escape(JSON.stringify(row.outcome,null,2))}</pre></td></tr>`).join("")}</tbody></table></div>
      <div class="topbar-actions"><button type="button" data-history="rows-previous" ${busy||detail.offset===0?"disabled":""}>Previous rows</button><button type="button" data-history="rows-next" ${busy||!detail.has_more?"disabled":""}>Next rows</button></div>` : ""}
      <p role="status" aria-live="polite">${busy?"Loading…":escape(message)}</p></section>`;
  }
  host.innerHTML='<section class="panel"><p role="status">Loading import history…</p></section>';
  try { history=await getWorkflowImportHistory(kind,month); }
  catch(error) { host.innerHTML=`<section class="panel"><p role="alert">${escape(error instanceof Error?error.message:error)}</p></section>`;return; }
  host.onclick=async event=>{
    const button=(event.target as HTMLElement).closest<HTMLButtonElement>('[data-history]');
    if (!button || busy) return;
    const action=button.dataset.history;
    busy=true;message="";render();
    try {
      if(action==='download' && button.dataset.batch) await downloadRejectedImportRows(kind,button.dataset.batch);
      else if(action==='open' && button.dataset.batch) { selected=button.dataset.batch;detail=await getWorkflowImportRows(kind,selected); }
      else if(action==='next'||action==='previous') { history=await getWorkflowImportHistory(kind,month,Math.max(0,history.offset+(action==='next'?25:-25)));detail=undefined; }
      else if(detail && (action==='rows-next'||action==='rows-previous')) detail=await getWorkflowImportRows(kind,selected,Math.max(0,detail.offset+(action==='rows-next'?50:-50)));
    } catch(error) { message=error instanceof Error?error.message:'Unable to load import records'; }
    finally {busy=false;render();}
  };
  render();
}
