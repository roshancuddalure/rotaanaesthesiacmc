// "Clear all members" for admins. Clearing ARCHIVES every active member (never deletes):
// duties, leave, postings and history keep their links, and the whole batch can be
// restored in one step. The server checks admin rights, the preview token (data unchanged
// since the preview) and the typed phrase; this window only makes the decision clear.
import { workspaceDialog } from "./member-workspace";
import {
  archiveAllMembers,
  listArchiveBatches,
  previewArchiveAll,
  restoreArchiveBatch,
  type ArchiveAllBatch,
  type ArchiveAllPreview,
} from "./services/api";
import { badge, esc } from "./ui";

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });

export async function openArchiveAll(onChanged: () => void | Promise<void>): Promise<void> {
  const dialog = workspaceDialog("Clear all members", "archive-all");
  let preview: ArchiveAllPreview | undefined;
  let batches: ArchiveAllBatch[] = [];
  let typed = "";
  let busy = false;
  let message = "";
  let result: { batch_id: string; archived: number } | undefined;

  const close = () => {
    if (busy) return;
    dialog.close();
    dialog.remove();
  };
  const phraseOk = () => Boolean(preview) && typed.trim() === preview!.confirm_phrase;

  const batchList = () =>
    batches.length
      ? `<section class="archive-all__history" aria-labelledby="archive-history-title">
          <h3 id="archive-history-title">Earlier clears</h3>
          <ul>${batches.map((b) => `<li>
            <span>${esc(when(b.at))} · ${esc(b.operator_name)} · ${b.archived} archived${b.restored ? ` · ${b.restored} restored` : ""}</span>
            ${b.restored < b.archived ? `<button type="button" class="icon-button btn-sm" data-undo="${esc(b.batch_id)}">Restore this batch</button>` : badge("Restored", "success")}
          </li>`).join("")}</ul>
        </section>`
      : "";

  const render = () => {
    const header = `<header class="mw-header"><div><h2>Clear all members</h2><p>Archives every active member. Nothing is deleted, and you can restore the whole batch.</p></div>
      <button type="button" data-close aria-label="Close clear all members">×</button></header>`;
    let body: string;
    if (result) {
      body = `<div class="archive-all__done" role="status">
          ${badge("Done", "success")}
          <p><strong>${result.archived} members archived.</strong> Their duties, leave and postings are unchanged.</p>
          <div class="registry-actions">
            <button type="button" class="primary" data-undo="${esc(result.batch_id)}" ${busy ? "disabled" : ""}>Undo: restore these ${result.archived} members</button>
            <button type="button" class="icon-button" data-close>Close</button>
          </div>
        </div>`;
    } else if (!preview) {
      body = `<p role="status">Counting members and their records… nothing has been changed.</p>`;
    } else if (!preview.members) {
      body = `<p>There are no active members to archive.</p>`;
    } else {
      body = `<dl class="archive-all__counts">
          <div><dt>Active members</dt><dd>${preview.members}</dd></div>
          <div><dt>Duty assignments</dt><dd>${preview.linked_duties}</dd></div>
          <div><dt>Leave records</dt><dd>${preview.leave}</dd></div>
          <div><dt>Unit postings</dt><dd>${preview.postings}</dd></div>
        </dl>
        ${preview.future_duties ? `<p class="archive-all__warning" role="note"><strong>${preview.future_duties} upcoming duties</strong> belong to these members. They stay assigned, but archived members no longer appear when building or filling a rota.</p>` : ""}
        <label class="archive-all__phrase">Type <strong>${esc(preview.confirm_phrase)}</strong> to confirm
          <input type="text" data-phrase autocomplete="off" spellcheck="false" value="${esc(typed)}" aria-describedby="archive-all-help">
        </label>
        <p id="archive-all-help" class="muted-text">The button stays off until the phrase matches exactly.</p>
        <div class="registry-actions">
          <button type="button" class="danger-button" data-archive ${phraseOk() && !busy ? "" : "disabled"}>${busy ? "Archiving…" : `Archive all ${preview.members} members`}</button>
          <button type="button" class="icon-button" data-close>Cancel</button>
        </div>`;
    }
    dialog.innerHTML = `${header}<div class="mw-content">${body}
      <p class="archive-all__message" role="status" aria-live="polite">${esc(message)}</p>
      ${batchList()}</div>`;
    dialog.querySelector<HTMLInputElement>("[data-phrase]")?.addEventListener("input", (event) => {
      typed = (event.target as HTMLInputElement).value;
      const button = dialog.querySelector<HTMLButtonElement>("[data-archive]");
      if (button) button.disabled = !phraseOk() || busy;
    });
  };

  const load = async () => {
    preview = undefined;
    render();
    try {
      [preview, batches] = await Promise.all([previewArchiveAll(), listArchiveBatches().catch(() => [])]);
    } catch (error) {
      message = error instanceof Error ? error.message : "Could not count members";
    }
    render();
  };

  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    close();
  });
  dialog.addEventListener("click", async (event) => {
    const target = event.target as HTMLElement;
    if (target.closest("[data-close]")) return close();
    const undo = target.closest<HTMLButtonElement>("[data-undo]");
    if (undo && !busy) {
      busy = true;
      message = "Restoring…";
      render();
      try {
        const restored = await restoreArchiveBatch(undo.dataset.undo!);
        message = `${restored.restored} members restored${restored.skipped ? `; ${restored.skipped} skipped because they were changed since` : ""}.`;
        result = undefined;
        batches = await listArchiveBatches().catch(() => batches);
        busy = false;
        await onChanged();
        await load();
      } catch (error) {
        busy = false;
        message = error instanceof Error ? error.message : "Could not restore the batch";
        render();
      }
      return;
    }
    if (!target.closest("[data-archive]") || !preview || busy) return;
    if (!phraseOk()) {
      message = `Type ${preview.confirm_phrase} exactly to confirm.`;
      return render();
    }
    busy = true;
    message = "";
    render();
    try {
      result = await archiveAllMembers(preview.preview_token, typed.trim());
      busy = false;
      typed = "";
      batches = await listArchiveBatches().catch(() => batches);
      render();
      await onChanged();
    } catch (error) {
      busy = false;
      const err = error as Error & { status?: number; detail?: { code?: string } };
      if (err.status === 409) {
        message = "Members changed since these counts were made. Check the new counts and confirm again.";
        const keep = message;
        await load();
        message = keep;
        render();
      } else {
        message = err.message || "Could not archive the members";
        render();
      }
    }
  });

  render();
  dialog.showModal();
  await load();
}
