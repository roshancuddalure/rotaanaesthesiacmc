import { request, type DepartmentMember } from "./services/api";
import { workspaceDialog } from "./member-workspace";
import { openUnitRegistry, openReferenceCatalog } from "./reference-workspace";
import { createMemberInline } from "./operational-import";
import { workspaceLoading, workspaceLoadFailure, protectWorkspaceDraft } from "./workspace-load-state";

type Row = Record<string, any>;
const esc = (v: unknown) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );

export async function openRecordEditor(
  kind: "units" | "leave",
  personId: string | undefined,
  identity: string | undefined,
  admin: boolean,
  saved: () => void,
  initial?: Row,
) {
  const opener = document.activeElement as HTMLElement | null;
  const dialog = workspaceDialog(
    `${identity ? "Edit" : "Add"} ${kind === "units" ? "posting" : "leave"}`,
    "mw-import record-workspace",
  );
  let busy = false,
    dirty = false,
    token: string | undefined;
  protectWorkspaceDraft(dialog, () => dirty || busy);
  let draftRevision = 0;
  let members: DepartmentMember[] = [],
    units: Row[] = [],
    references: Record<string, Row[]> = {};
  let draft: Row = {
    person_id: personId || "",
    starts_on: new Date().toLocaleDateString("en-CA"),
    ends_on: "",
    posting_type: "2ND_CALL",
    unit_id: "",
    leave_type: "ANNUAL_LEAVE",
    leave_slot: "FULL_DAY",
    status: "requested",
    notes: "",
    ...initial,
  };
  const close = () => {
    if (busy || (dirty && !confirm("Discard unsaved changes?"))) return;
    dialog.close();
    dialog.remove();
    opener?.focus();
  };
  dialog.addEventListener("cancel", (e) => {
    e.preventDefault();
    close();
  });
  async function options() {
    members = await request<DepartmentMember[]>("/api/v1/admin/members");
    units = await request<Row[]>("/api/v1/normalization/units");
    const kinds =
      kind === "units"
        ? ["posting_type"]
        : ["leave_type", "leave_slot", "leave_status"];
    for (const key of kinds)
      references[key] = await request<Row[]>(
        `/api/v1/normalization/catalog/${key}`,
      );
  }
  async function loadEditor() {
    if (!dialog.open) return;
    const restoreFocus = workspaceLoading(dialog, `${identity ? "Edit" : "Add"} ${kind === "units" ? "posting" : "leave"}`, close);
    try {
    await options();
    if (!dialog.open) return;
    if (identity)
      draft = {
        ...draft,
        ...(await request<Row>(
          `/api/v1/normalization/records/${kind}/${identity}`,
        )),
      };
    render();
    restoreFocus();
    } catch (error) {
      workspaceLoadFailure(dialog, "Editor unavailable", error, () => void loadEditor(), close);
    }
  }
  await loadEditor();
  function render() {
    if (!dialog.open) return;
    const select = (field: string, label: string, items: Row[]) =>
      `<label>${label}<select name="${field}" required>${items
        .filter((i) => i.active)
        .map(
          (i) =>
            `<option value="${esc(i.key)}" ${draft[field] === i.key ? "selected" : ""}>${esc(i.label)}</option>`,
        )
        .join("")}</select></label>`;
    dialog.innerHTML = `<header class="mw-header"><h2>${identity ? "Edit" : "Add"} ${kind === "units" ? "posting" : "leave"}</h2><button type="button" data-close aria-label="Close editor">×</button></header><form class="mw-content"><label>Find member<input type="search" data-member-search placeholder="Name, call level or designation"></label><label>Member<select name="person_id" required><option value="">Select member</option>${members
      .filter((m) => m.active_status === "active" || m.id === draft.person_id)
      .map(
        (m) =>
          `<option value="${m.id}" ${draft.person_id === m.id ? "selected" : ""}>${esc(m.canonical_name)} · ${esc(m.call_level || "Unassigned")} · ${esc(m.active_status)}</option>`,
      )
      .join(
        "",
      )}</select></label>${admin ? '<button type="button" data-new-member>Create member</button>' : ""}${
      kind === "units"
        ? `${select("posting_type", "Posting / monthly call override", references.posting_type)}<label>Unit<select name="unit_id"><option value="">No unit (special postings only)</option>${units
            .filter(
              (u) => u.active_status === "active" || u.id === draft.unit_id,
            )
            .map(
              (u) =>
                `<option value="${u.id}" ${draft.unit_id === u.id ? "selected" : ""}>${esc(u.name)} · ${esc(u.campus || "No campus")}</option>`,
            )
            .join(
              "",
            )}</select></label>${admin ? '<button type="button" data-new-unit>Create unit</button>' : ""}<p>A dated posting may override the department default. Leave the end date blank for an ongoing posting.</p>`
        : `${select("leave_type", "Leave type", references.leave_type)}${select("leave_slot", "Session", references.leave_slot)}${select("status", "Approval state", references.leave_status)}<p>Approved leave blocks availability. Pending leave warns. Cancelled or rejected leave does not block availability.</p>`
    }${admin ? '<button type="button" data-references>Manage labels and mappings</button>' : ""}<label>Effective from<input name="starts_on" type="date" required value="${esc(draft.starts_on)}"></label><label>Until<input name="ends_on" type="date" ${kind === "leave" ? "required" : ""} value="${esc(draft.ends_on)}"></label><label>Notes<textarea name="notes" rows="3">${esc(draft.notes)}</textarea></label><div data-error role="alert" class="mw-error"></div><section data-review aria-live="polite"></section><footer class="mw-footer"><button type="button" data-close>Cancel</button><button type="submit">Review changes</button><button type="button" class="primary" data-save disabled>Save reviewed changes</button></footer></form>`;
    dialog
      .querySelectorAll<HTMLButtonElement>("[data-close]")
      .forEach((b) => (b.onclick = close));
    const form = dialog.querySelector<HTMLFormElement>("form")!;
    const clearValidation = () => {
      form.querySelectorAll('[data-server-field-error]').forEach(node => node.remove());
      form.querySelectorAll<HTMLElement>('[data-server-invalid]').forEach(field => {
        field.removeAttribute('aria-invalid');
        field.removeAttribute('data-server-invalid');
        const references = (field.getAttribute('aria-describedby') || '').split(/\s+/).filter(id => id && !id.startsWith('record-validation-'));
        if (references.length) field.setAttribute('aria-describedby', references.join(' '));
        else field.removeAttribute('aria-describedby');
      });
    };
    const showValidation = (error: unknown, moveFocus: boolean) => {
      if (!dialog.open || !form.isConnected) return;
      clearValidation();
      const summary = form.querySelector<HTMLElement>('[data-error]')!;
      summary.textContent = error instanceof Error ? error.message : 'Unable to review changes.';
      summary.tabIndex = -1;
      const detail = (error as { detail?: unknown })?.detail;
      if (Array.isArray(detail)) {
        const list = document.createElement('ul');
        for (const [index, item] of detail.slice(0, 20).entries()) {
          if (!item || !Array.isArray(item.loc) || typeof item.msg !== 'string') continue;
          const parts = item.loc.filter((part: unknown) => !['body', 'values'].includes(String(part)));
          const row = document.createElement('li');
          const field = parts.length === 1 && typeof parts[0] === 'string' ? form.elements.namedItem(parts[0]) : null;
          if (!(field instanceof HTMLInputElement || field instanceof HTMLSelectElement || field instanceof HTMLTextAreaElement)) {
            row.textContent = item.msg;
            list.append(row);
            continue;
          }
          const errorId = `record-validation-${kind}-${parts[0]}-${index}`;
          const label = field.labels?.[0]?.cloneNode(true) as HTMLElement | undefined;
          label?.querySelectorAll('input, select, textarea, [data-server-field-error]').forEach(node => node.remove());
          const describedIds = new Set((field.getAttribute('aria-describedby') || '').split(/\s+/));
          label?.querySelectorAll('[id]').forEach(node => { if (describedIds.has(node.id)) node.remove(); });
          const fieldName = label?.textContent?.trim() || String(parts[0]).replace(/_/g, ' ');
          const hint = document.createElement('span');
          hint.id = errorId;
          hint.dataset.serverFieldError = '';
          hint.className = 'mw-error';
          hint.textContent = item.msg;
          field.after(hint);
          field.setAttribute('aria-invalid', 'true');
          field.dataset.serverInvalid = '';
          field.setAttribute('aria-describedby', [field.getAttribute('aria-describedby'), errorId].filter(Boolean).join(' '));
          const action = document.createElement('button');
          action.type = 'button';
          action.className = 'quiet-button';
          action.textContent = `${fieldName}: ${item.msg}`;
          action.onclick = () => field.focus();
          row.append(action);
          list.append(row);
        }
        if (list.children.length) summary.append(list);
      }
      if (moveFocus) summary.focus();
    };
    const read = () => {
      draft = { ...draft, ...Object.fromEntries(new FormData(form)) };
    };
    form.oninput = () => {
      clearValidation();
      form.querySelector('[data-error]')!.textContent = '';
      read();
      dirty = true;
      draftRevision++;
      token = undefined;
      dialog.querySelector<HTMLButtonElement>("[data-save]")!.disabled = true;
      dialog.querySelector("[data-review]")!.textContent =
        "Review your changes before saving.";
    };
    dialog.querySelector<HTMLInputElement>("[data-member-search]")!.oninput = (
      e,
    ) => {
      e.stopPropagation();
      const q = (e.target as HTMLInputElement).value.toLowerCase();
      form
        .querySelectorAll<HTMLOptionElement>("[name=person_id] option")
        .forEach(
          (o) =>
            (o.hidden = Boolean(
              o.value && !o.selected && !o.text.toLowerCase().includes(q),
            )),
        );
    };
    dialog
      .querySelector<HTMLButtonElement>("[data-new-member]")
      ?.addEventListener("click", () => {
        read();
        void createMemberInline("", (m) => {
          members.push(m);
          draft.person_id = m.id;
          dirty = true;
          render();
          dialog.querySelector<HTMLSelectElement>("[name=person_id]")?.focus();
        });
      });
    dialog
      .querySelector<HTMLButtonElement>("[data-new-unit]")
      ?.addEventListener("click", () => {
        read();
        void openUnitRegistry(
          (unit) => {
            if (unit) {
              units.push(unit);
              draft.unit_id = unit.id;
              dirty = true;
              render();
              dialog
                .querySelector<HTMLSelectElement>("[name=unit_id]")
                ?.focus();
            }
          },
          undefined,
          true,
        );
      });
    dialog
      .querySelector<HTMLButtonElement>("[data-references]")
      ?.addEventListener("click", () => {
        read();
        void openReferenceCatalog(() => {
          void options().then(() => {
            if (!dialog.open) return;
            const focused = document.activeElement;
            const owned = focused instanceof HTMLElement && dialog.contains(focused);
            const name = owned ? focused.getAttribute("name") : null;
            const memberSearch = owned && focused.matches('[data-member-search]');
            const search = memberSearch ? (focused as HTMLInputElement).value : "";
            const selection = focused instanceof HTMLInputElement || focused instanceof HTMLTextAreaElement
              ? [focused.selectionStart, focused.selectionEnd] : null;
            const scroll = dialog.querySelector<HTMLElement>("form")?.scrollTop ?? 0;
            render();
            if (owned && (document.activeElement === document.body || document.activeElement === dialog)) {
              const target = name ? dialog.querySelector<HTMLElement>(`[name="${CSS.escape(name)}"]`)
                : memberSearch ? dialog.querySelector<HTMLInputElement>('[data-member-search]') : null;
              if (target) {
                if (memberSearch) {
                  (target as HTMLInputElement).value = search;
                  target.dispatchEvent(new Event("input", { bubbles: true }));
                }
                target.focus({ preventScroll: true });
                if (selection && (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) {
                  try { target.setSelectionRange(selection[0], selection[1]); } catch { /* Native date/select controls have no text selection. */ }
                }
              }
            }
            const form = dialog.querySelector<HTMLElement>("form");
            if (form) form.scrollTop = scroll;
          }).catch((error) => {
            if (dialog.open) dialog.querySelector("[data-error]")!.textContent =
              `Unable to refresh reference options. Your draft is preserved. ${(error as Error).message}`;
          });
        });
      });
    form.onsubmit = async (e) => {
      e.preventDefault();
      if (busy) return;
      clearValidation();
      form.querySelector('[data-error]')!.textContent = '';
      read();
      busy = true;
      const reviewedRevision = draftRevision;
      const reviewButton = form.querySelector<HTMLButtonElement>("button[type=submit]")!;
      reviewButton.disabled = true;
      reviewButton.textContent = "Reviewing...";
      form.setAttribute("aria-busy", "true");
      let focusMoved = false;
      const trackFocus = (event: FocusEvent) => {
        if (event.target !== document.body && event.target !== document.documentElement) focusMoved = true;
      };
      document.addEventListener('focusin', trackFocus);
      try {
        const review = await request<Row>(
          `/api/v1/normalization/records/${kind}/preview`,
          { method: "POST", body: JSON.stringify({ identity, values: draft }) },
        );
        if (!dialog.open || reviewedRevision !== draftRevision) return;
        token = review.review_token;
        dialog.querySelector("[data-review]")!.innerHTML =
          `<h3>Review proposed changes</h3><dl>${Object.entries(review.after)
            .filter(([k]) => !["person_id", "unit_id"].includes(k))
            .map(
              ([k, v]) =>
                `<dt>${esc(k.replace(/_/g, " "))}</dt><dd>${review.before ? `${esc(review.before[k])} → ` : ""}${esc(v || "Ongoing / blank")}</dd>`,
            )
            .join(
              "",
            )}</dl><p>${esc(review.availability)}</p>${review.duties.length ? `<h4>${review.duties.length} affected duties</h4>${review.duties.map((d: Row) => `<p>${esc(d.date)} · ${esc(d.duty)}</p>`).join("")}` : kind === "leave" ? "<p>No existing duty conflicts in this leave range.</p>" : "<p>No overlapping primary postings found.</p>"}`;
        dialog.querySelector<HTMLButtonElement>("[data-save]")!.disabled =
          false;
        dialog.querySelector("[data-error]")!.textContent = "";
      } catch (error) {
        if (reviewedRevision === draftRevision) showValidation(error, !focusMoved);
      } finally {
        document.removeEventListener('focusin', trackFocus);
        busy = false;
        reviewButton.disabled = false;
        reviewButton.textContent = "Review changes";
        form.removeAttribute("aria-busy");
      }
    };
    dialog.querySelector<HTMLButtonElement>("[data-save]")!.onclick =
      async () => {
        if (busy || !token) return;
        busy = true;
        try {
          await request(`/api/v1/normalization/records/${kind}/save`, {
            method: "POST",
            body: JSON.stringify({
              identity,
              values: draft,
              review_token: token,
            }),
          });
          dirty = false;
          busy = false;
          close();
          saved();
        } catch (error) {
          dialog.querySelector("[data-error]")!.textContent = (
            error as Error
          ).message;
          token = undefined;
          dialog.querySelector<HTMLButtonElement>("[data-save]")!.disabled =
            true;
        } finally {
          busy = false;
        }
      };
  }
}
