/**
 * Recycle bin (admin tools): deleted members, leave, unit postings and past duties stay here for
 * 30 days. Each entry is one delete action and can be restored or removed for good.
 * See docs/admin_delete_contract.md.
 */
import { confirmAdminDelete } from "./admin-delete";
import {
  getRecordedPastDuties, getRecycleBin, purgeRecycleBatch, restoreRecycleBatch,
  type AdminDeleteKind, type RecordedPastDuty, type RecycleBinBatch, type RecycleRestoreResult,
} from "./services/api";
import { badge, codeLabel, emptyState, esc, formatDate, formatMonth } from "./ui";

const KIND_LABEL: Record<AdminDeleteKind, [string, string]> = {
  member: ["Member", "members"],
  leave: ["Leave", "leave records"],
  posting: ["Unit posting", "unit postings"],
  past_duty: ["Past duty", "past duties"],
};

function kindText(kind: string, count: number): string {
  const [one, many] = KIND_LABEL[kind as AdminDeleteKind] ?? [kind, kind];
  return count === 1 ? `1 ${one.toLowerCase()}` : `${count} ${many}`;
}

function when(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return formatDate(value, { weekday: false });
  return date.toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Calcutta" });
}

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

/** Outcome of the last restore or purge, keyed by batch, shown under that entry. */
type Outcome = { tone: "success" | "warning" | "danger"; text: string; failed?: RecycleRestoreResult["failed"] };

function batchCard(batch: RecycleBinBatch, outcome: Outcome | undefined, busy: boolean): string {
  const [kindLabel] = KIND_LABEL[batch.kind] ?? [batch.kind];
  const restored = Boolean(batch.restored_at);
  const more = batch.count - batch.labels.length;
  const titleId = `rb-title-${esc(batch.batch_id)}`;
  return `<li class="rb-batch" data-rb-batch="${esc(batch.batch_id)}">
    <div class="rb-batch__head">
      <h4 id="${titleId}">${esc(kindText(batch.kind, batch.count))}</h4>
      ${badge(kindLabel, "neutral")}
      ${restored ? badge("Restored", "success") : ""}
    </div>
    ${batch.labels.length ? `<ul class="rb-batch__labels">${batch.labels.map((label) => `<li>${esc(label)}</li>`).join("")}${more > 0 ? `<li class="rb-batch__more">and ${more} more</li>` : ""}</ul>` : ""}
    <p class="rb-batch__meta">Deleted ${esc(when(batch.deleted_at))}${batch.deleted_by ? ` by ${esc(batch.deleted_by)}` : ""}</p>
    ${restored
      ? `<p class="rb-batch__meta">Restored ${esc(when(batch.restored_at))}${batch.restored_by ? ` by ${esc(batch.restored_by)}` : ""}</p>`
      : `<p class="rb-batch__meta">Removed for good on ${esc(formatDate(batch.purge_after, { weekday: false }))}</p>`}
    ${outcome ? `<div class="rb-batch__outcome is-${outcome.tone}" role="status">
      <p>${esc(outcome.text)}</p>
      ${outcome.failed?.length ? `<ul>${outcome.failed.map((item) => `<li><strong>${esc(item.label)}</strong>: ${esc(item.reason)}</li>`).join("")}</ul>` : ""}
    </div>` : ""}
    ${restored ? "" : `<div class="rb-batch__actions">
      <button type="button" class="primary btn-sm" data-rb-restore="${esc(batch.batch_id)}" ${busy ? "disabled" : ""}>Restore</button>
      <button type="button" class="icon-button danger-button btn-sm" data-rb-purge="${esc(batch.batch_id)}" ${busy ? "disabled" : ""}>Delete forever…</button>
    </div>`}
  </li>`;
}

/** Renders the recycle bin into `root` (replacing its content). Admin-only page. */
export async function renderRecycleBin(root: HTMLElement): Promise<void> {
  const host = document.createElement("div");
  host.className = "recycle-bin";
  root.replaceChildren(host);
  let batches: RecycleBinBatch[] = [];
  const outcomes = new Map<string, Outcome>();
  let busy = false;
  let notice = "";

  const intro = `<section class="panel"><h3>Recycle bin</h3>
    <p>Deleted members, leave, unit postings and past duties stay here for 30 days. Restore puts them back as they were; after 30 days they are removed for good.</p></section>`;

  function render() {
    if (!host.isConnected) return;
    host.innerHTML = `${intro}
      <section class="panel" aria-labelledby="rb-list-title">
        <div class="table-caption"><h3 id="rb-list-title">Deleted in the last 30 days</h3><span class="table-caption__count">${batches.length} ${batches.length === 1 ? "entry" : "entries"}</span></div>
        <p class="rb-notice" role="status">${esc(notice)}</p>
        ${batches.length
          ? `<ul class="rb-list">${batches.map((batch) => batchCard(batch, outcomes.get(batch.batch_id), busy)).join("")}</ul>`
          : emptyState({ title: "Nothing deleted in the last 30 days", body: "Items you delete from Members, Leave, Units or Past duties appear here." })}
      </section>`;
  }

  async function load() {
    host.innerHTML = `${intro}<section class="panel"><p role="status">Loading the recycle bin…</p></section>`;
    try {
      batches = await getRecycleBin();
    } catch (error) {
      if (!host.isConnected) return;
      host.innerHTML = `${intro}<section class="panel" role="alert"><h3>Could not load the recycle bin</h3>
        <p>${esc(messageOf(error, "The recycle bin could not be loaded."))}</p>
        <button type="button" class="primary" data-rb-retry>Try again</button></section>`;
      return;
    }
    render();
  }

  async function act(batchId: string, kind: "restore" | "purge") {
    const batch = batches.find((item) => item.batch_id === batchId);
    if (!batch || busy) return;
    if (kind === "purge" && !window.confirm(`Delete ${kindText(batch.kind, batch.count)} forever? This cannot be undone.`)) return;
    busy = true;
    notice = "";
    render();
    try {
      if (kind === "restore") {
        const result = await restoreRecycleBatch(batchId);
        const failed = result.failed ?? [];
        outcomes.set(batchId, {
          tone: failed.length ? (result.restored ? "warning" : "danger") : "success",
          text: `Restored ${result.restored} of ${batch.count}.${failed.length ? ` ${failed.length} could not be restored:` : ""}`,
          failed,
        });
      } else {
        const result = await purgeRecycleBatch(batchId);
        outcomes.delete(batchId);
        batches = batches.filter((item) => item.batch_id !== batchId);
        notice = `Deleted forever: ${kindText(batch.kind, result.purged ?? batch.count)}.`;
      }
      try { batches = await getRecycleBin(); } catch { /* keep the current list */ }
    } catch (error) {
      outcomes.set(batchId, { tone: "danger", text: messageOf(error, kind === "restore" ? "Restore failed." : "Delete failed.") });
    } finally {
      busy = false;
      render();
      const focusTarget = host.querySelector<HTMLElement>(`[data-rb-batch="${CSS.escape(batchId)}"] .rb-batch__outcome`)
        ?? host.querySelector<HTMLElement>("#rb-list-title");
      focusTarget?.setAttribute("tabindex", "-1");
      focusTarget?.focus();
    }
  }

  host.addEventListener("click", (event) => {
    const target = (event.target as HTMLElement).closest<HTMLElement>("[data-rb-restore], [data-rb-purge], [data-rb-retry]");
    if (!target) return;
    if (target.dataset.rbRetry !== undefined) void load();
    else if (target.dataset.rbRestore) void act(target.dataset.rbRestore, "restore");
    else if (target.dataset.rbPurge) void act(target.dataset.rbPurge, "purge");
  });

  await load();
}

/**
 * "Recorded past duties · <Month>" (Past duties page, admin): lists saved past duty
 * assignments for one month with selection, "Delete selected" and "Delete all … for <Month>".
 * Lives here rather than in past-duties.ts so that module keeps its small API surface;
 * past-duties.ts loads it on demand.
 */
export async function mountRecordedPastDuties(host: HTMLElement, defaultMonth: string, maxMonth: string): Promise<void> {
  let month = defaultMonth;
  let items: RecordedPastDuty[] = [];
  let truncated = false;
  let state: "loading" | "ready" | "error" = "loading";
  let error = "";
  let notice = "";
  let busy = false;
  const selected = new Set<string>();

  function render() {
    if (!host.isConnected) return;
    const monthName = formatMonth(month);
    const allChecked = items.length > 0 && items.every((item) => selected.has(item.id));
    const someChecked = !allChecked && items.some((item) => selected.has(item.id));
    let body: string;
    if (state === "loading") body = `<p role="status">Loading recorded past duties…</p>`;
    else if (state === "error") body = `<div role="alert"><p>${esc(error)}</p><button type="button" class="primary" data-rec="retry">Try again</button></div>`;
    else if (!items.length) body = emptyState({ title: `No past duties recorded for ${monthName}` });
    else body = `${truncated ? `<p class="rec-past__note" role="note">Showing the first ${items.length} duties only. Use "Delete all past duties for ${esc(monthName)}" to include the rest.</p>` : ""}
      <div class="table-panel rec-past__table">
        <table>
          <caption class="visually-hidden">Recorded past duties for ${esc(monthName)}</caption>
          <thead><tr>
            <th scope="col"><input type="checkbox" data-rec-all ${allChecked ? "checked" : ""} ${busy ? "disabled" : ""} aria-label="Select all past duties shown" /></th>
            <th scope="col">Date</th><th scope="col">Duty</th><th scope="col">Member</th><th scope="col">Source</th>
          </tr></thead>
          <tbody>${items.map((item) => `<tr data-rec-row="${esc(item.id)}">
            <td><input type="checkbox" data-rec-id="${esc(item.id)}" ${selected.has(item.id) ? "checked" : ""} ${busy ? "disabled" : ""}
              aria-label="Select ${esc(`${item.member_name ?? "unassigned"}, ${item.duty_label || codeLabel(item.duty_type)}, ${formatDate(item.date, { weekday: false })}`)}" /></td>
            <td>${esc(formatDate(item.date))}</td>
            <td>${esc(item.duty_label || codeLabel(item.duty_type))}</td>
            <td>${esc(item.member_name ?? "—")}</td>
            <td>${esc(item.source ? codeLabel(item.source.toUpperCase()) : "—")}</td>
          </tr>`).join("")}</tbody>
        </table>
      </div>`;
    host.innerHTML = `<section class="panel rec-past" aria-labelledby="rec-past-title">
      <div class="table-caption"><h3 id="rec-past-title">Recorded past duties · ${esc(monthName)}</h3>
        ${state === "ready" ? `<span class="table-caption__count">${items.length}${truncated ? "+" : ""} duties</span>` : ""}</div>
      <p>Delete duties recorded by mistake. Deleted duties can be restored from the Recycle bin for 30 days.</p>
      <div class="rec-past__toolbar">
        <label>Month <input type="month" data-rec="month" value="${esc(month)}" max="${esc(maxMonth)}" ${busy ? "disabled" : ""} /></label>
        <button type="button" class="icon-button danger-button btn-sm" data-rec="delete-selected" ${selected.size && !busy ? "" : "disabled"}>Delete selected (${selected.size})</button>
        <button type="button" class="icon-button danger-button btn-sm" data-rec="delete-month" ${state === "ready" && items.length && !busy ? "" : "disabled"}>Delete all past duties for ${esc(monthName)}…</button>
      </div>
      <p class="rec-past__status" role="status">${esc(notice)}</p>
      ${body}
    </section>`;
    const all = host.querySelector<HTMLInputElement>("[data-rec-all]");
    if (all) all.indeterminate = someChecked;
  }

  async function load() {
    state = "loading";
    render();
    const requested = month;
    try {
      const data = await getRecordedPastDuties(requested);
      if (requested !== month) return;
      items = data.items;
      truncated = data.truncated;
      state = "ready";
      const present = new Set(items.map((item) => item.id));
      for (const id of [...selected]) if (!present.has(id)) selected.delete(id);
    } catch (err) {
      if (requested !== month) return;
      state = "error";
      error = messageOf(err, "Recorded past duties could not be loaded.");
    }
    render();
  }

  async function remove(byMonth: boolean) {
    const ids = [...selected];
    if (busy || (!byMonth && !ids.length)) return;
    busy = true;
    notice = "";
    render();
    try {
      const result = await confirmAdminDelete(byMonth
        ? { kind: "past_duty", month, title: `Delete all past duties for ${formatMonth(month)}` }
        : { kind: "past_duty", ids, title: `Delete ${ids.length} past ${ids.length === 1 ? "duty" : "duties"}` });
      if (result) {
        selected.clear();
        notice = `Deleted ${result.deleted} past ${result.deleted === 1 ? "duty" : "duties"}. You can restore them from the Recycle bin for 30 days.`;
        busy = false;
        await load();
        return;
      }
    } catch (err) {
      notice = messageOf(err, "Delete failed.");
    }
    busy = false;
    render();
  }

  host.addEventListener("change", (event) => {
    const target = event.target as HTMLInputElement;
    if (target.dataset.rec === "month") {
      if (!target.value || target.value === month) return;
      month = target.value;
      selected.clear();
      notice = "";
      void load();
    } else if (target.dataset.recAll !== undefined) {
      for (const item of items) target.checked ? selected.add(item.id) : selected.delete(item.id);
      render();
      host.querySelector<HTMLInputElement>("[data-rec-all]")?.focus();
    } else if (target.dataset.recId) {
      target.checked ? selected.add(target.dataset.recId) : selected.delete(target.dataset.recId);
      render();
      host.querySelector<HTMLInputElement>(`[data-rec-id="${CSS.escape(target.dataset.recId)}"]`)?.focus();
    }
  });
  host.addEventListener("click", (event) => {
    const action = (event.target as HTMLElement).closest<HTMLElement>("[data-rec]")?.dataset.rec;
    if (action === "retry") void load();
    else if (action === "delete-selected") void remove(false);
    else if (action === "delete-month") void remove(true);
  });

  await load();
}
