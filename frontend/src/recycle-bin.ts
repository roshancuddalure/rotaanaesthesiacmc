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
import { formatAuditTimestamp } from "./audit-time";

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
  return formatAuditTimestamp(value, "Asia/Kolkata");
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
  let loaded = false;
  let loadError = "";
  let refreshRequired = false;
  let retired = false;
  const alive = () => !retired && host.isConnected && root.contains(host);
  const removal = new MutationObserver((records) => {
    if (!host.isConnected || records.some((record) => [...record.removedNodes].some((node) => node === host || node.contains(host)))) {
      retired = true;
      removal.disconnect();
    }
  });
  removal.observe(document.body, { childList: true, subtree: true });

  // Replacing a focused action temporarily moves focus to the body. Restore it only
  // while the user has not deliberately moved into another part of the application.
  function focusAfterAction() {
    let owned = host.contains(document.activeElement);
    const moved = (event: FocusEvent) => {
      if (event.target !== document.body && !host.contains(event.target as Node)) owned = false;
    };
    document.addEventListener("focusin", moved);
    return (selector: string) => {
      document.removeEventListener("focusin", moved);
      if (!owned || !alive() || (document.activeElement !== document.body && !host.contains(document.activeElement))) return;
      const target = host.querySelector<HTMLElement>(selector);
      if (target && !target.matches("button, input, select, textarea, a[href]")) target.setAttribute("tabindex", "-1");
      target?.focus();
    };
  }

  const intro = `<section class="panel"><h3>Recycle bin</h3>
    <p>Deleted members, leave, unit postings and past duties stay here for 30 days. Restore puts them back as they were; after 30 days they are removed for good.</p></section>`;

  function render() {
    if (!alive()) return;
    if (!loaded) {
      host.innerHTML = `${intro}<section class="panel" ${loadError ? 'role="alert"' : ""}>
        ${loadError ? `<h3>Could not load the recycle bin</h3><p>${esc(loadError)}</p><button type="button" class="primary" data-rb-retry ${busy ? "disabled" : ""}>Try again</button>` : '<p role="status">Loading the recycle bin…</p>'}
      </section>`;
      return;
    }
    const missingOutcomes = [...outcomes].filter(([id]) => !batches.some((batch) => batch.batch_id === id));
    host.innerHTML = `${intro}
      <section class="panel" aria-labelledby="rb-list-title">
        <div class="table-caption"><h3 id="rb-list-title">Deleted in the last 30 days</h3><span class="table-caption__count">${batches.length} ${batches.length === 1 ? "entry" : "entries"}</span></div>
        <p class="rb-notice" role="status">${esc(notice)}</p>
        ${refreshRequired ? `<div class="rb-refresh" ${loadError ? 'role="alert"' : 'role="status"'}>
          <h4>${loadError ? "The action finished, but the list could not be refreshed" : "Refreshing the recycle bin…"}</h4>
          <p>Action results below are confirmed. The displayed list has not been refreshed; restore and delete controls are unavailable until a fresh list is loaded.</p>
          ${loadError ? `<p>${esc(loadError)}</p><button type="button" class="primary" data-rb-retry ${busy ? "disabled" : ""}>Refresh list</button><p>Refresh only reloads the list. It does not repeat a restore or delete.</p>` : ""}
        </div>` : ""}
        ${missingOutcomes.map(([, outcome]) => `<div class="rb-batch__outcome is-${outcome.tone}" role="status"><p>${esc(outcome.text)}</p>${outcome.failed?.length ? `<ul>${outcome.failed.map((item) => `<li><strong>${esc(item.label)}</strong>: ${esc(item.reason)}</li>`).join("")}</ul>` : ""}</div>`).join("")}
        ${batches.length
          ? `<ul class="rb-list">${batches.map((batch) => batchCard(batch, outcomes.get(batch.batch_id), busy || refreshRequired)).join("")}</ul>`
          : refreshRequired ? '<p>Awaiting a fresh list.</p>' : emptyState({ title: "Nothing deleted in the last 30 days", body: "Items you delete from Members, Leave, Units or Past duties appear here." })}
      </section>`;
  }

  async function load() {
    if (busy || !alive()) return;
    const restoreFocus = focusAfterAction();
    busy = true;
    loadError = "";
    render();
    try {
      const fresh = await getRecycleBin();
      if (!alive()) return;
      batches = fresh;
      loaded = true;
      refreshRequired = false;
    } catch (error) {
      if (!alive()) return;
      loadError = messageOf(error, "The recycle bin could not be loaded.");
    } finally {
      busy = false;
      render();
      restoreFocus(loadError ? "[data-rb-retry]" : "#rb-list-title");
    }
  }

  async function act(batchId: string, kind: "restore" | "purge") {
    const batch = batches.find((item) => item.batch_id === batchId);
    if (!batch || busy || refreshRequired || !alive()) return;
    if (kind === "purge" && !window.confirm(`Delete ${kindText(batch.kind, batch.count)} forever? This cannot be undone.`)) return;
    const restoreFocus = focusAfterAction();
    busy = true;
    notice = "";
    render();
    try {
      if (kind === "restore") {
        const result = await restoreRecycleBatch(batchId);
        if (!alive()) return;
        const failed = result.failed ?? [];
        outcomes.set(batchId, {
          tone: failed.length ? (result.restored ? "warning" : "danger") : "success",
          text: `Restored ${result.restored} of ${batch.count}.${failed.length ? ` ${failed.length} could not be restored:` : ""}`,
          failed,
        });
        notice = `Restore finished: ${result.restored} of ${batch.count} restored.${failed.length ? ` ${failed.length} could not be restored; see the details below.` : ""}`;
      } else {
        const result = await purgeRecycleBatch(batchId);
        if (!alive()) return;
        outcomes.delete(batchId);
        batches = batches.filter((item) => item.batch_id !== batchId);
        notice = `Deleted forever: ${kindText(batch.kind, result.purged ?? batch.count)}.`;
      }
      refreshRequired = true;
      loadError = "";
      render();
      try {
        const fresh = await getRecycleBin();
        if (!alive()) return;
        batches = fresh;
        refreshRequired = false;
      } catch (error) {
        if (!alive()) return;
        loadError = messageOf(error, "The recycle bin could not be refreshed.");
      }
    } catch (error) {
      if (!alive()) return;
      outcomes.set(batchId, { tone: "danger", text: messageOf(error, kind === "restore" ? "Restore failed." : "Delete failed.") });
    } finally {
      busy = false;
      render();
      const outcomeSelector = `[data-rb-batch="${CSS.escape(batchId)}"] .rb-batch__outcome`;
      restoreFocus(refreshRequired ? "[data-rb-retry]" : host.querySelector(outcomeSelector) ? outcomeSelector : ".rb-notice");
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
      <p data-rec-selection role="status" aria-live="polite" aria-atomic="true">${state === "ready" ? `${selected.size} selected of ${items.length} shown for ${esc(monthName)}${truncated ? ". Selection covers only the shown rows; the whole-month action is separate." : "."}` : ""}</p>
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
