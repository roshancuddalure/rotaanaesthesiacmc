import { request, type DepartmentMember } from "./services/api";
import { workspaceDialog } from "./member-workspace";
import { openUnitRegistry, openReferenceCatalog } from "./reference-workspace";
import { createMemberInline } from "./operational-import";

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
  dialog.innerHTML = "<p role='status'>Loading editor…</p>";
  try {
    await options();
    if (identity)
      draft = {
        ...draft,
        ...(await request<Row>(
          `/api/v1/normalization/records/${kind}/${identity}`,
        )),
      };
    render();
  } catch (error) {
    dialog.innerHTML = `<p role="alert">${esc((error as Error).message)}</p><button type="button">Close</button>`;
    dialog.querySelector("button")!.onclick = close;
  }
  function render() {
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
    }${admin ? '<button type="button" data-references>Manage labels and mappings</button>' : ""}<label>Effective from<input name="starts_on" type="date" required value="${esc(draft.starts_on)}"></label><label>Until<input name="ends_on" type="date" ${kind === "leave" ? "required" : ""} value="${esc(draft.ends_on)}"></label><label>Notes<textarea name="notes" rows="3">${esc(draft.notes)}</textarea></label><p data-error role="alert" class="mw-error"></p><section data-review aria-live="polite"></section><footer class="mw-footer"><button type="button" data-close>Cancel</button><button type="submit">Review changes</button><button type="button" class="primary" data-save disabled>Save reviewed changes</button></footer></form>`;
    dialog
      .querySelectorAll<HTMLButtonElement>("[data-close]")
      .forEach((b) => (b.onclick = close));
    const form = dialog.querySelector<HTMLFormElement>("form")!;
    const read = () => {
      draft = { ...draft, ...Object.fromEntries(new FormData(form)) };
    };
    form.oninput = () => {
      read();
      dirty = true;
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
          void options().then(render);
        });
      });
    form.onsubmit = async (e) => {
      e.preventDefault();
      if (busy) return;
      read();
      busy = true;
      try {
        const review = await request<Row>(
          `/api/v1/normalization/records/${kind}/preview`,
          { method: "POST", body: JSON.stringify({ identity, values: draft }) },
        );
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
        dialog.querySelector("[data-error]")!.textContent = (
          error as Error
        ).message;
      } finally {
        busy = false;
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
