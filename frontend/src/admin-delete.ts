// Admin delete with a recycle bin (docs/admin_delete_contract.md). The window previews
// exactly what will be deleted (and what is blocked, with the reason), asks for a typed
// phrase on whole-month deletes, and sends the preview token so the server refuses if the
// data changed since. Deleted items stay restorable from the Recycle bin for 30 days.
import { workspaceDialog } from "./member-workspace";
import {
  adminDelete,
  previewAdminDelete,
  type AdminDeleteKind,
  type AdminDeletePreview,
  type AdminDeleteResult,
} from "./services/api";
import { badge, esc } from "./ui";

export interface AdminDeleteRequest {
  kind: AdminDeleteKind;
  ids?: string[];
  month?: string;
  title: string;
}

const NOUNS: Record<AdminDeleteKind, [string, string]> = {
  member: ["member", "members"],
  leave: ["leave record", "leave records"],
  posting: ["posting", "postings"],
  past_duty: ["past duty", "past duties"],
};

const noun = (kind: AdminDeleteKind, n: number) => NOUNS[kind][n === 1 ? 0 : 1];

function blockedHint(kind: AdminDeleteKind): string {
  return kind === "member" ? "Archive or merge instead." : "";
}

export function confirmAdminDelete(request: AdminDeleteRequest): Promise<AdminDeleteResult | null> {
  const { kind, title } = request;
  const selection = request.month ? { kind, month: request.month } : { kind, ids: request.ids ?? [] };
  const dialog = workspaceDialog(title, "admin-delete");
  let preview: AdminDeletePreview | undefined;
  let typed = "";
  let busy = false;
  let message = "";
  let settled = false;
  let resolveResult: (value: AdminDeleteResult | null) => void = () => undefined;
  const promise = new Promise<AdminDeleteResult | null>((resolve) => { resolveResult = resolve; });

  const finish = (value: AdminDeleteResult | null) => {
    if (settled) return;
    settled = true;
    dialog.close();
    dialog.remove();
    resolveResult(value);
  };
  const close = () => {
    if (busy) return;
    finish(null);
  };
  const phraseOk = () => !preview?.confirm_phrase || typed.trim() === preview.confirm_phrase;
  const canDelete = () => Boolean(preview && preview.count > 0 && phraseOk() && !busy);

  const render = () => {
    const header = `<header class="mw-header"><div><h2>${esc(title)}</h2>
        <p>Review what will be deleted, then confirm. Nothing changes until you do.</p></div>
      <button type="button" data-close aria-label="Close ${esc(title)}">×</button></header>`;
    let body: string;
    if (!preview) {
      body = message ? "" : `<p role="status">Checking what will be deleted… nothing has been changed.</p>`;
    } else {
      const shown = preview.items.slice(0, 10);
      const more = preview.count - shown.length;
      const effects: string[] = [];
      if (preview.effects?.linked_records) effects.push(`${preview.effects.linked_records} linked records (aliases, notes, history) go into the bin with them.`);
      if (preview.effects?.extra_slots) effects.push(`${preview.effects.extra_slots} empty imported duty slots are removed too.`);
      body = `<p class="admin-delete__count">${badge(String(preview.count), preview.count ? "danger" : "neutral")}
          <strong>${preview.count ? `${preview.count} ${noun(kind, preview.count)} will be deleted.` : `Nothing here can be deleted.`}</strong></p>
        ${shown.length ? `<ul class="admin-delete__items">${shown.map((item) => `<li>${esc(item.label)}</li>`).join("")}</ul>
          ${more > 0 ? `<p class="muted-text">and ${more} more.</p>` : ""}` : ""}
        ${effects.map((e) => `<p class="muted-text">${esc(e)}</p>`).join("")}
        ${preview.blocked.length ? `<section class="admin-delete__blocked" aria-labelledby="admin-delete-blocked-title">
            <h3 id="admin-delete-blocked-title">${badge(String(preview.blocked.length), "warning")} Not deleted</h3>
            <ul>${preview.blocked.slice(0, 50).map((row) => `<li><strong>${esc(row.label)}</strong>
              <span>${esc(row.reason)}${blockedHint(kind) && !/archiv|merg/i.test(row.reason) ? ` ${esc(blockedHint(kind))}` : ""}</span></li>`).join("")}</ul>
            ${preview.blocked.length > 50 ? `<p class="muted-text">and ${preview.blocked.length - 50} more.</p>` : ""}
          </section>` : ""}
        <p class="admin-delete__note" role="note">Deleted items can be restored from the Recycle bin for 30 days.</p>
        ${preview.confirm_phrase && preview.count ? `<label class="archive-all__phrase">Type <strong>${esc(preview.confirm_phrase)}</strong> to confirm
            <input type="text" data-phrase autocomplete="off" spellcheck="false" value="${esc(typed)}" aria-describedby="admin-delete-help">
          </label>
          <p id="admin-delete-help" class="muted-text">The button stays off until the phrase matches exactly.</p>` : ""}`;
    }
    const count = preview?.count ?? 0;
    dialog.innerHTML = `${header}<div class="mw-content">${body}
      <div class="admin-preview__actions">
        <button type="button" class="danger-button" data-delete ${canDelete() ? "" : "disabled"}>${busy ? "Deleting…" : `Delete ${count ? `${count} ` : ""}${noun(kind, count)}`}</button>
        <button type="button" class="icon-button" data-close>Cancel</button>
        <p class="admin-preview__message" role="status" aria-live="polite">${esc(message)}</p>
      </div></div>`;
    dialog.querySelector<HTMLInputElement>("[data-phrase]")?.addEventListener("input", (event) => {
      typed = (event.target as HTMLInputElement).value;
      const button = dialog.querySelector<HTMLButtonElement>("[data-delete]");
      if (button) button.disabled = !canDelete();
    });
  };

  const load = async () => {
    preview = undefined;
    render();
    try {
      preview = await previewAdminDelete(selection);
    } catch (error) {
      message = error instanceof Error ? error.message : "Could not prepare the preview";
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
    if (!target.closest("[data-delete]") || !preview || busy) return;
    if (!phraseOk()) {
      message = `Type ${preview.confirm_phrase} exactly to confirm.`;
      return render();
    }
    busy = true;
    message = "";
    render();
    try {
      const result = await adminDelete(selection, preview.preview_token, preview.confirm_phrase ? typed.trim() : null);
      busy = false;
      finish(result);
    } catch (error) {
      busy = false;
      const err = error as Error & { status?: number; detail?: { code?: string } | string };
      if (err.status === 409) {
        const keep = "The records changed since this preview. Here is the updated preview; review it and confirm again.";
        typed = "";
        message = "";
        await load();
        message = keep;
        render();
      } else {
        message = err.message || "Could not delete";
        render();
      }
    }
  });

  render();
  dialog.showModal();
  void load();
  return promise;
}
