// Preview-then-confirm window for admin member tools (roster reconciliation, call-level
// prefill, name cleanup, duplicate merge). The server makes no change until the admin
// confirms the exact preview shown; a stale preview (409) is re-shown with the new data.
import { workspaceDialog } from "./member-workspace";
import type { PreviewRow, ReviewedPreview } from "./services/api";
import { badge, codeLabel, emptyState } from "./ui";

const esc = (value: unknown) =>
  String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export interface PreviewSection {
  title: string;
  tone: "success" | "warning" | "danger" | "neutral";
  rows: PreviewRow[];
  /** What happens to rows in this section when the admin confirms. */
  note: string;
}

export interface ReviewedTool<T extends ReviewedPreview> {
  title: string;
  intro: string;
  confirmLabel: string;
  run: (previewToken?: string) => Promise<T>;
  sections: (preview: T) => PreviewSection[];
  /** Number of changes the confirm would make; 0 disables the confirm button. */
  changeCount: (preview: T) => number;
  onApplied: (result: T) => void | Promise<void>;
}

function rowText(row: PreviewRow): { name: string; change: string; detail: string } {
  const name = row.roster_name || row.raw_name || row.current_name || row.canonical_name || "";
  const target = row.canonical_name || row.current_name;
  const change = row.new_call_level
    ? `${target ?? "—"}: ${codeLabel(row.current_call_level ?? "") || "none"} → ${codeLabel(row.new_call_level)}`
    : row.cleaned_name
      ? `${row.current_name ?? ""} → ${row.cleaned_name}`
      : row.merge_from?.length
        ? `Merge ${row.merge_from.map((m) => m.name || m.canonical_name).join(", ")} into ${target}`
        : target && target !== name
          ? `→ ${target}`
          : row.action === "create" ? "New member" : "";
  const candidates = row.candidates?.length ? ` Possible: ${row.candidates.slice(0, 3).map((c) => c.name).join(", ")}.` : "";
  const colliding = row.colliding_with?.length ? ` Clashes with ${row.colliding_with.map((c) => c.name || c.canonical_name).join(", ")}.` : "";
  return { name, change, detail: `${row.reason ?? ""}${candidates}${colliding}`.trim() };
}

function sectionHtml(section: PreviewSection): string {
  if (!section.rows.length) return "";
  const shown = section.rows.slice(0, 200);
  return `<section class="admin-preview__section">
    <h3>${badge(String(section.rows.length), section.tone)} ${esc(section.title)}</h3>
    <p class="muted-text">${esc(section.note)}</p>
    <div class="table-scroll"><table>
      <thead><tr><th scope="col">Name</th><th scope="col">Change</th><th scope="col">Why</th></tr></thead>
      <tbody>${shown.map((row) => {
        const t = rowText(row);
        return `<tr><td>${esc(t.name)}</td><td>${esc(t.change)}</td><td>${esc(t.detail)}</td></tr>`;
      }).join("")}</tbody>
    </table></div>
    ${section.rows.length > shown.length ? `<p class="muted-text">Showing the first ${shown.length} of ${section.rows.length}.</p>` : ""}
  </section>`;
}

export async function reviewAndApply<T extends ReviewedPreview>(tool: ReviewedTool<T>): Promise<void> {
  const dialog = workspaceDialog(tool.title, "admin-preview");
  let preview: T | undefined;
  let busy = false;
  let message = "";
  const close = () => {
    if (busy) return;
    dialog.close();
    dialog.remove();
  };
  const render = () => {
    const sections = preview ? tool.sections(preview) : [];
    const changes = preview ? tool.changeCount(preview) : 0;
    dialog.innerHTML = `<header class="mw-header"><div><h2>${esc(tool.title)}</h2><p>${esc(tool.intro)}</p></div>
        <button type="button" data-close aria-label="Close ${esc(tool.title)}">×</button></header>
      <div class="mw-content">
        ${!preview ? `<p role="status">Preparing the preview… nothing has been changed.</p>`
          : sections.some((s) => s.rows.length) ? sections.map(sectionHtml).join("")
          : emptyState({ title: "Nothing to change", body: "Every member already matches." })}
        <div class="admin-preview__actions">
          <button type="button" class="primary" data-confirm ${!preview || !changes || busy ? "disabled" : ""}>
            ${busy ? "Applying…" : `${esc(tool.confirmLabel)}${changes ? ` (${changes})` : ""}`}</button>
          <button type="button" class="icon-button" data-close>Cancel</button>
          <p role="status" aria-live="polite" class="admin-preview__message">${esc(message)}</p>
        </div>
      </div>`;
  };
  const load = async () => {
    preview = undefined;
    render();
    try {
      preview = await tool.run();
      message = tool.changeCount(preview) ? "Review the changes, then confirm. Nothing changes until you do." : "";
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
    if (target.closest("[data-close]")) {
      close();
      return;
    }
    if (!target.closest("[data-confirm]") || !preview?.preview_token || busy) return;
    busy = true;
    message = "";
    render();
    try {
      const result = await tool.run(preview.preview_token);
      busy = false;
      close();
      await tool.onApplied(result);
    } catch (error) {
      busy = false;
      const err = error as Error & { status?: number; detail?: { code?: string } };
      if (err.status === 409 && err.detail?.code === "stale_preview") {
        message = "The member list changed since this preview. Here is the updated preview; review it again.";
        const keep = message;
        await load();
        message = keep;
        render();
      } else {
        message = err.message || "Could not apply the changes";
        render();
      }
    }
  });
  render();
  dialog.showModal();
  await load();
}

