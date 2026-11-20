/** Read-only audit projection: caller permissions supplement server authorization. */
import { request } from "./services/api";
import { workspaceDialog } from "./member-workspace";
import { formatAuditTimestamp } from "./audit-time";

type Row = Record<string, unknown>;
const object = (value: unknown): value is Row => value !== null && typeof value === "object" && !Array.isArray(value);
const esc = (value: unknown) => String(value ?? "").replace(/[&<>"']/g,
  char => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[char]!);
const uuid = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(value);
const categories = ["audit", "imports", "recycle", "merges"] as const;
type Category = typeof categories[number] | "";
type History = {leave_id: string; record_present: boolean; events: Row[]; sources: Row[];
  lineage_ids: string[]; related_record_ids: string[]; unvisited_record_ids: string[];
  pagination: {next_cursor: string | null; has_more: boolean}; coverage: {warnings: string[]}};

function parsed(value: unknown, record: string): History {
  if (!object(value) || value.leave_id !== record || typeof value.record_present !== "boolean"
      || !Array.isArray(value.events) || !value.events.every(row => object(row) && typeof row.id === "string" && typeof row.action === "string")
      || !Array.isArray(value.sources) || !value.sources.every(object)
      || ![value.lineage_ids, value.related_record_ids, value.unvisited_record_ids].every(ids => Array.isArray(ids) && ids.every(uuid))
      || !object(value.pagination) || typeof value.pagination.has_more !== "boolean"
      || !(value.pagination.next_cursor === null || (typeof value.pagination.next_cursor === "string" && value.pagination.next_cursor.length <= 2048))
      || value.pagination.has_more !== Boolean(value.pagination.next_cursor)
      || !object(value.coverage) || !Array.isArray(value.coverage.warnings) || !value.coverage.warnings.every(code => typeof code === "string"))
    throw new Error("Leave history was incomplete. Retry this read before relying on its evidence.");
  return value as unknown as History;
}

export async function openMemberLeaveHistory(record: string) {
  if (!uuid(record)) throw new Error("A canonical leave record ID is required.");
  const opener = document.activeElement as HTMLElement | null;
  const parent = opener?.closest("dialog");
  const dialog = workspaceDialog("Leave lifecycle history", "mw-import");
  let selected = record, category: Category = "";
  let result: History | null = null, busy = false, error = "", ticket = 0;
  let pending: {record: string; category: Category; cursor: string | null} | null = null;
  const known = new Set([record]);
  const alive = () => dialog.isConnected && dialog.open && (!parent || (parent.isConnected && parent.open));
  const close = () => { ticket++; dialog.close(); dialog.remove(); if (opener?.isConnected) opener.focus(); };
  const parentClosed = () => close();
  parent?.addEventListener("close", parentClosed, {once:true});
  const observer = new MutationObserver(() => { if (parent && !parent.isConnected && dialog.isConnected) close(); });
  observer.observe(document.body, {childList:true});
  dialog.addEventListener("close", () => { ticket++; observer.disconnect(); parent?.removeEventListener("close", parentClosed); dialog.remove(); }, {once:true});
  const timestamp = (value: unknown) => esc(formatAuditTimestamp(typeof value === "string" ? value : undefined));
  const actor = (value: unknown) => object(value)
    ? `${esc(typeof value.name === "string" ? value.name : "Name not recorded")}${uuid(value.id) ? ` · ${esc(value.id)}` : " · Actor ID not recorded"}`
    : "Actor not recorded";
  const facts = (value: unknown) => object(value) ? ["person_id","leave_type","leave_slot","starts_on","ends_on","status","source"]
    .filter(key => typeof value[key] === "string").map(key => `<div><dt>${esc(key.replace(/_/g," "))}</dt><dd>${esc(value[key])}</dd></div>`).join("") : "";

  function render() {
    if (!alive()) return;
    dialog.innerHTML = `<header class="mw-header"><h2>Leave lifecycle history</h2><button type="button" data-history-close>Close history</button></header>
      <div class="mw-content" aria-busy="${busy}"><p>Canonical record: <span data-history-record>${esc(selected)}</span>. ${result ? result.record_present ? "Current record is present." : "Current record is absent; retained evidence is shown." : ""}</p>
      <p>Recorded evidence may be incomplete. Approval is not proof of attendance. Private notes and raw source contents are excluded.</p>
      <label>Linked leave record<select data-history-record-select ${busy ? "disabled" : ""}>${[...known].sort().map(id=>`<option value="${id}" ${id===selected ? "selected" : ""}>${id}</option>`).join("")}</select></label>
      <label>Evidence category<select data-history-category ${busy ? "disabled" : ""}><option value="">Overview</option>${categories.map(key=>`<option ${category===key ? "selected" : ""} value="${key}">${key}</option>`).join("")}</select></label>
      ${busy ? '<p role="status">Loading recorded history…</p>' : ""}${error ? `<p role="alert">${esc(error)}</p><button type="button" data-history-retry ${busy ? "disabled" : ""}>Retry history read</button>` : ""}
      ${result ? `<p data-history-coverage>${result.coverage.warnings.length} coverage notices: ${esc(result.coverage.warnings.join(", "))}. Retained evidence does not prove historical completeness.</p>
      ${category ? '<p>Evidence pages read live backing records. A page may contain no events; continue when another page is available.</p>' : '<p>Overview is bounded. Choose each evidence category to read further pages and follow linked records.</p>'}
      <h3>Events</h3>${result.events.length ? result.events.map(row=>`<article class="mw-history"><h4>${esc(String(row.action).replace(/_/g," "))}</h4><p>${timestamp(row.recorded_at)} · ${actor(row.actor)}</p>
      ${typeof row.record_id === "string" ? `<p>Leave record ${esc(row.record_id)}</p>` : ""}${typeof row.reason === "string" ? `<p>Recorded reason: ${esc(row.reason)}</p>` : ""}
      <details><summary>Recorded changes</summary><h5>Before</h5><dl>${facts(row.before)}</dl><h5>After</h5><dl>${facts(row.after ?? row.changes)}</dl></details></article>`).join("") : '<p>No events on this view.</p>'}
      <h3>Source references</h3>${result.sources.length ? result.sources.map(row=>`<article class="mw-history"><p>${esc(typeof row.filename === "string" ? row.filename : "Filename not recorded")}</p><p>Sheet: ${esc(typeof row.sheet === "string" ? row.sheet : "Not recorded")} · Row: ${esc(typeof row.row === "number" ? row.row : "Not recorded")}</p><p>${timestamp(row.recorded_at)} · ${actor(row.actor)}</p>${uuid(row.record_id) ? `<p>Leave record ${esc(row.record_id)}</p>` : ""}${uuid(row.batch_id) ? `<p>Import batch ${esc(row.batch_id)}</p>` : ""}</article>`).join("") : '<p>No source references on this view.</p>'}
      ${result.pagination.has_more ? `<button type="button" data-history-next ${busy ? "disabled" : ""}>Next evidence page</button>` : ""}` : ""}
      <button type="button" data-history-refresh ${busy ? "disabled" : ""}>Read latest overview</button></div>`;
    dialog.querySelector<HTMLButtonElement>("[data-history-close]")!.onclick = close;
    dialog.querySelector<HTMLSelectElement>("[data-history-record-select]")!.onchange = event => {
      void load((event.target as HTMLSelectElement).value, "", null);
    };
    dialog.querySelector<HTMLSelectElement>("[data-history-category]")!.onchange = event => {
      void load(selected, (event.target as HTMLSelectElement).value as Category, null);
    };
    dialog.querySelector<HTMLButtonElement>("[data-history-next]")?.addEventListener("click", () => {
      if (result) void load(selected, category, result.pagination.next_cursor);
    });
    dialog.querySelector<HTMLButtonElement>("[data-history-retry]")?.addEventListener("click", () => {
      if (pending) void load(pending.record, pending.category, pending.cursor);
    });
    dialog.querySelector<HTMLButtonElement>("[data-history-refresh]")!.onclick = () => { void load(selected,"",null); };
  }

  async function load(id: string, kind: Category, next: string | null) {
    if (!alive() || busy || !known.has(id) || (kind && !categories.includes(kind))) return;
    const sequence = ++ticket;
    pending = {record:id, category:kind, cursor:next}; busy = true; error = ""; render();
    try {
      const params = new URLSearchParams({category:kind, limit:"100"});
      if (next) params.set("cursor",next);
      const path = `/api/v1/leave/requests/${id}/history${kind ? `/page?${params}` : ""}`;
      const loaded = parsed(await request<unknown>(path), id);
      if (!alive() || sequence !== ticket) return;
      result = loaded; selected = id; category = kind;
      for (const key of [...loaded.lineage_ids,...loaded.related_record_ids,...loaded.unvisited_record_ids]) known.add(key);
      pending = null;
    } catch (caught) {
      if (!alive() || sequence !== ticket) return;
      error = `This history read failed; previously shown evidence remains unchanged. ${caught instanceof Error ? caught.message : "Try again."}`;
    } finally {
      if (alive() && sequence === ticket) {
        busy = false; render();
        (dialog.querySelector<HTMLElement>(error ? "[data-history-retry]" : "[data-history-category]"))?.focus({preventScroll:true});
      }
    }
  }
  render(); await load(record,"",null);
}
