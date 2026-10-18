import { request } from "./services/api";
import { workspaceDialog } from "./member-workspace";

const esc = (value: unknown) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );

export async function openMappingCreator(saved: () => void) {
  const dialog = workspaceDialog("Add imported label mapping", "mw-import");
  let dirty = false,
    busy = false;
  const close = () => {
    if (busy || (dirty && !confirm("Discard this mapping draft?"))) return;
    dialog.close();
    dialog.remove();
  };
  dialog.addEventListener("cancel", (e) => {
    e.preventDefault();
    close();
  });
  dialog.innerHTML = `<header class="mw-header"><h2>Add Mapping</h2><button type="button" data-close aria-label="Close mapping creation">×</button></header><form class="mw-content"><p>Connect an imported label to an existing definition. Examples: U04 → Main Unit IV; CL → Casual leave belongs in Leave references.</p><label>Mapping category<select name="mapping_type"><option value="duty_label">Duty label</option><option value="unit_label">Unit label</option><option value="posting_label">Posting label</option></select></label><label>Imported spelling<input name="source_label" required maxlength="255"></label><label>Find destination<input type="search" data-find></label><label>Approved destination<select name="target_key" required></select></label><label>Notes<textarea name="notes"></textarea></label><p data-error role="alert" class="mw-error"></p><footer class="mw-footer"><button type="button" data-close>Cancel</button><button type="submit" class="primary">Save mapping</button></footer></form>`;
  dialog
    .querySelectorAll<HTMLButtonElement>("[data-close]")
    .forEach((b) => (b.onclick = close));
  const form = dialog.querySelector<HTMLFormElement>("form")!;
  const type = form.querySelector<HTMLSelectElement>("[name=mapping_type]")!;
  const target = form.querySelector<HTMLSelectElement>("[name=target_key]")!;
  async function load() {
    try {
      const values = await request<any[]>(
        type.value === "unit_label"
          ? "/api/v1/normalization/units"
          : `/api/v1/normalization/catalog/${type.value === "duty_label" ? "duty_type" : "posting_type"}`,
      );
      target.innerHTML = `<option value="">Select a destination</option>${values
        .filter((i) => i.active !== false && i.active_status !== "archived")
        .map(
          (i) =>
            `<option value="${esc(i.id || i.key)}">${esc(i.label || `${i.campus || ""} ${i.name}`.trim())}</option>`,
        )
        .join("")}`;
    } catch (error) {
      form.querySelector("[data-error]")!.textContent = (
        error as Error
      ).message;
    }
  }
  type.onchange = () => void load();
  form.oninput = () => {
    dirty = true;
  };
  form.querySelector<HTMLInputElement>("[data-find]")!.oninput = (e) => {
    const q = (e.target as HTMLInputElement).value.toLowerCase();
    Array.from(target.options).forEach(
      (o) =>
        (o.hidden = Boolean(
          o.value && !o.selected && !o.text.toLowerCase().includes(q),
        )),
    );
  };
  form.onsubmit = async (e) => {
    e.preventDefault();
    if (busy) return;
    busy = true;
    try {
      const values = Object.fromEntries(new FormData(form));
      await request("/api/v1/admin/mappings", {
        method: "POST",
        body: JSON.stringify({
          ...values,
          status: "reviewed",
          target_label: target.selectedOptions[0]?.text,
        }),
      });
      dirty = false;
      busy = false;
      close();
      saved();
    } catch (error) {
      form.querySelector("[data-error]")!.textContent = (
        error as Error
      ).message;
    } finally {
      busy = false;
    }
  };
  await load();
}
type Unit = {
  id: string;
  name: string;
  code: string;
  campus: string | null;
  notes: string | null;
  aliases: string[];
  active_status: string;
  minimum_free_people: number;
  revision: string;
  usage: Record<string, number>;
  call_minimums?: [string, number][];
};

async function openReferenceHistory(query: string) {
  const dialog = workspaceDialog("Reference activity", "mw-import");
  const close = () => {
    dialog.close();
    dialog.remove();
  };
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    close();
  });
  dialog.innerHTML = '<p role="status">Loading activity…</p>';
  try {
    const rows = await request<Record<string, any>[]>(
      `/api/v1/normalization/activity?${query}`,
    );
    dialog.innerHTML = `<header class="mw-header"><h2>Reference activity</h2><button type="button" data-close aria-label="Close activity">×</button></header><div class="mw-content">${
      rows
        .map(
          (row) =>
            `<article class="mw-history"><strong>${esc(row.action.replace(/_/g, " "))}</strong><p>${esc(row.operator)} · ${esc(new Date(row.created_at).toLocaleString())}</p><dl>${Object.entries(
              row.details.after || row.details.before || {},
            )
              .filter(([key]) => !["id", "revision", "usage"].includes(key))
              .map(
                ([key, value]) =>
                  `<dt>${esc(key.replace(/_/g, " "))}</dt><dd>${esc(typeof value === "object" ? JSON.stringify(value) : value)}</dd>`,
              )
              .join("")}</dl></article>`,
        )
        .join("") || "<p>No activity recorded for this reference yet.</p>"
    }</div>`;
  } catch (error) {
    dialog.innerHTML = `<p role="alert">${esc((error as Error).message)}</p><button data-close>Close</button>`;
  }
  dialog.querySelector<HTMLButtonElement>("[data-close]")!.onclick = close;
}

export async function openUnitRegistry(
  saved: (unit?: Unit) => void,
  initialId?: string,
  createNew = false,
) {
  const opener = document.activeElement as HTMLElement | null;
  const dialog = workspaceDialog(
    "Manage department units",
    "mw-import reference-workspace",
  );
  let units: Unit[] = [];
  let selected: Unit | undefined;
  let busy = false;
  let dirty = false;
  let month = new Date().toLocaleDateString("en-CA").slice(0, 7);
  let statusFilter = "all";
  const close = () => {
    if (busy || (dirty && !confirm("Discard unsaved unit details?"))) return;
    dialog.close();
    dialog.remove();
    opener?.focus();
  };
  dialog.addEventListener("cancel", (e) => {
    e.preventDefault();
    close();
  });
  dialog.innerHTML = "<p role='status'>Loading units…</p>";
  try {
    units = await request<Unit[]>(`/api/v1/normalization/units?month=${month}`);
  } catch (error) {
    dialog.innerHTML = `<p role="alert">${esc((error as Error).message)}</p><button type="button">Close</button>`;
    dialog.querySelector("button")!.onclick = close;
    return;
  }
  selected = units.find((u) => u.id === initialId);

  function render() {
    dialog.innerHTML = `<header class="mw-header"><div><h2>Department units</h2><p>Create units, maintain names and aliases, and preserve their history.</p></div><button data-close type="button" aria-label="Close unit management">×</button></header><div class="mw-content"><div class="registry-actions"><label>Find a unit<input type="search" data-search placeholder="Name, code, campus or alias"></label><label>Member count month<input type="month" data-unit-month value="${month}"></label><label>Show units<select data-unit-status><option value="all">All</option><option value="active" ${statusFilter === "active" ? "selected" : ""}>Active</option><option value="archived" ${statusFilter === "archived" ? "selected" : ""}>Archived</option></select></label><button type="button" data-new>Add Unit</button></div><div class="registry-unit-list">${units.map((u) => `<button type="button" data-select-unit="${u.id}" data-unit-state="${u.active_status}" data-unit-search="${esc([u.name, u.code, u.campus, ...u.aliases].join(" ").toLowerCase())}"><strong>${esc(u.name)}</strong> · ${esc(u.campus || "Campus not specified")} · ${esc(u.code)} · ${esc(u.active_status)} &middot; ${u.usage.selected_members ?? 0} members in ${month}</button>`).join("") || "<p>No units yet. Add your first department unit below.</p>"}</div><hr><h3>${selected ? `Edit ${esc(selected.name)}` : "Add a unit"}</h3>${selected ? `<p>${selected.usage.postings} postings · ${selected.usage.duties} duty slots linked. ${selected.usage.future_postings} current/upcoming postings and ${selected.usage.future_duties} future duty slots.</p><button type="button" data-unit-history>View unit activity</button>` : ""}<form id="registry-unit-form"><label>Unit name<input name="name" required maxlength="255" value="${esc(selected?.name)}" placeholder="For example: Unit IV"></label><label>Campus<input name="campus" maxlength="100" value="${esc(selected?.campus)}" placeholder="For example: Main or Ranipet"></label><label>Unique unit code<input name="code" maxlength="50" value="${esc(selected?.code)}" placeholder="Suggested from name and campus"></label><label>Minimum free people<input name="minimum_free_people" type="number" min="0" required value="${selected?.minimum_free_people ?? 1}"></label><details><summary>Call-wise staffing minimums</summary>${["1ST_CALL", "2ND_CALL", "3RD_CALL", "CO_4TH_CALL", "4TH_CALL", "5TH_CALL"].map((level) => `<label>${level.replace(/_/g, " ")}<input type="number" min="0" data-call-minimum="${level}" placeholder="Use fallback minimum" value="${selected?.call_minimums?.find(([key]) => key === level)?.[1] ?? ""}"></label>`).join("")}</details><label>Alternative labels (one per line)<textarea name="aliases" rows="4" placeholder="Use campus-qualified aliases where numbered units could be confused">${esc(selected?.aliases.join("\n"))}</textarea></label><label>Notes<textarea name="notes" rows="3">${esc(selected?.notes)}</textarea></label><label>Membership<select name="active_status"><option value="active" ${selected?.active_status !== "archived" ? "selected" : ""}>Active</option><option value="archived" ${selected?.active_status === "archived" ? "selected" : ""}>Archived</option></select></label><p>Renaming keeps the previous unit label as an alias. Archiving preserves postings and duty history.</p><p class="mw-error" role="alert" data-error></p><div class="mw-footer"><span data-dirty>Saved details</span><button type="button" data-close>Cancel</button><button class="primary" type="submit">${selected ? "Save unit" : "Create unit"}</button></div></form></div>`;
    dialog
      .querySelectorAll<HTMLButtonElement>("[data-close]")
      .forEach((b) => (b.onclick = close));
    dialog
      .querySelector<HTMLButtonElement>("[data-unit-history]")
      ?.addEventListener("click", () => {
        if (selected) void openReferenceHistory(`entity_id=${selected.id}`);
      });
    dialog.querySelector<HTMLButtonElement>("[data-new]")!.onclick = () => {
      if (dirty && !confirm("Discard edits and create another unit?")) return;
      selected = undefined;
      dirty = false;
      render();
      dialog.querySelector<HTMLInputElement>("[name=name]")!.focus();
    };
    dialog.querySelectorAll<HTMLButtonElement>("[data-select-unit]").forEach(
      (b) =>
        (b.onclick = () => {
          if (dirty && !confirm("Discard edits and switch units?")) return;
          selected = units.find((u) => u.id === b.dataset.selectUnit);
          dirty = false;
          render();
        }),
    );
    dialog.querySelector<HTMLInputElement>("[data-search]")!.oninput = (e) => {
      const q = (e.target as HTMLInputElement).value.toLowerCase();
      dialog
        .querySelectorAll<HTMLButtonElement>("[data-unit-search]")
        .forEach((b) => (b.hidden = !b.dataset.unitSearch!.includes(q)));
    };
    function filterUnits() {
      const q = dialog
        .querySelector<HTMLInputElement>("[data-search]")!
        .value.toLowerCase();
      dialog
        .querySelectorAll<HTMLElement>("[data-unit-search]")
        .forEach(
          (el) =>
            (el.hidden =
              !el.dataset.unitSearch!.includes(q) ||
              (statusFilter !== "all" &&
                el.dataset.unitState !== statusFilter)),
        );
    }
    dialog.querySelector<HTMLSelectElement>("[data-unit-status]")!.onchange = (
      e,
    ) => {
      statusFilter = (e.target as HTMLSelectElement).value;
      filterUnits();
    };
    dialog.querySelector<HTMLInputElement>("[data-search]")!.oninput =
      filterUnits;
    dialog.querySelector<HTMLInputElement>("[data-unit-month]")!.onchange =
      async (e) => {
        if (dirty && !confirm("Discard edits and change the count month?")) {
          (e.target as HTMLInputElement).value = month;
          return;
        }
        month = (e.target as HTMLInputElement).value || month;
        try {
          units = await request<Unit[]>(
            `/api/v1/normalization/units?month=${month}`,
          );
          selected = units.find((u) => u.id === selected?.id);
          dirty = false;
          render();
        } catch (error) {
          dialog.querySelector("[data-error]")!.textContent = (
            error as Error
          ).message;
        }
      };
    filterUnits();
    const form = dialog.querySelector<HTMLFormElement>("form")!;
    form.oninput = () => {
      dirty = true;
      dialog.querySelector("[data-dirty]")!.textContent = "Unsaved changes";
    };
    form.querySelector<HTMLInputElement>("[name=name]")!.onblur = async () => {
      if (
        selected ||
        (form.elements.namedItem("code") instanceof HTMLInputElement &&
          (form.elements.namedItem("code") as HTMLInputElement).value)
      )
        return;
      const name = (form.elements.namedItem("name") as HTMLInputElement).value;
      const campus = (form.elements.namedItem("campus") as HTMLInputElement)
        .value;
      try {
        const result = await request<{ code: string }>(
          `/api/v1/normalization/units/suggest-code?name=${encodeURIComponent(name)}&campus=${encodeURIComponent(campus)}`,
        );
        (form.elements.namedItem("code") as HTMLInputElement).value =
          result.code;
      } catch {
        /* Code can be generated when saving. */
      }
    };
    form.onsubmit = async (event) => {
      event.preventDefault();
      if (busy) return;
      const formData = new FormData(form);
      const values = Object.fromEntries(formData);
      const payload = {
        ...values,
        active_status: String(values.active_status),
        minimum_free_people: Number(values.minimum_free_people),
        aliases: String(values.aliases || "")
          .split("\n")
          .map((a) => a.trim())
          .filter(Boolean),
        revision: selected?.revision,
        call_minimums: Array.from(
          form.querySelectorAll<HTMLInputElement>("[data-call-minimum]"),
        )
          .filter((input) => input.value !== "")
          .map((input) => ({
            call_level: input.dataset.callMinimum,
            minimum_free_people: Number(input.value),
          })),
      };
      if (
        selected &&
        payload.active_status !== selected.active_status &&
        !confirm(
          `Change ${selected.name} to ${payload.active_status}? ${selected.usage.future_postings} postings and ${selected.usage.future_duties} future duty slots remain linked.`,
        )
      )
        return;
      busy = true;
      const submit = form.querySelector<HTMLButtonElement>("[type=submit]")!;
      submit.disabled = true;
      try {
        const result = await request<Unit>(
          `/api/v1/normalization/units${selected ? `/${selected.id}` : ""}`,
          { method: selected ? "PUT" : "POST", body: JSON.stringify(payload) },
        );
        selected = result;
        dirty = false;
        if (createNew) {
          busy = false;
          close();
          saved(result);
          return;
        }
        units = await request<Unit[]>(
          `/api/v1/normalization/units?month=${month}`,
        );
        selected = result;
        dirty = false;
        render();
        saved(result);
      } catch (error) {
        form.querySelector("[data-error]")!.textContent = (
          error as Error
        ).message;
      } finally {
        busy = false;
        submit.disabled = false;
      }
    };
  }
  if (createNew) selected = undefined;
  render();
}

type Reference = {
  kind: string;
  key: string;
  label: string;
  aliases: string[];
  active: boolean;
  version: number;
  behavior: Record<string, unknown>;
  usage: { records: number };
};
export async function openReferenceCatalog(
  saved: () => void,
  initialKind = "leave_type",
) {
  const dialog = workspaceDialog(
    "Reference labels and mappings",
    "mw-import reference-workspace",
  );
  const opener = document.activeElement as HTMLElement | null;
  let kind = initialKind,
    items: Reference[] = [],
    selected: Reference | undefined,
    dirty = false,
    busy = false;
  const kinds: Record<string, string> = {
    campus: "Campuses",
    designation: "Designations",
    leave_type: "Leave types",
    leave_slot: "Leave sessions",
    leave_status: "Approval labels",
    posting_type: "Posting labels",
    duty_type: "Duty types and behavior",
  };
  const close = () => {
    if (busy || (dirty && !confirm("Discard reference changes?"))) return;
    dialog.close();
    dialog.remove();
    opener?.focus();
  };
  dialog.addEventListener("cancel", (e) => {
    e.preventDefault();
    close();
  });
  async function load() {
    try {
      items = await request<Reference[]>(
        `/api/v1/normalization/catalog/${kind}`,
      );
      selected = undefined;
      dirty = false;
      render();
    } catch (error) {
      dialog.innerHTML = `<p role="alert">${esc((error as Error).message)}</p><button>Close</button>`;
      dialog.querySelector("button")!.onclick = close;
    }
  }
  function render() {
    dialog.innerHTML = `<header class="mw-header"><div><h2>Reference labels and mappings</h2><p>A mapping connects an imported spelling to an approved value. Example: CL → Casual leave.</p></div><button type="button" data-close aria-label="Close reference management">×</button></header><div class="mw-content"><label>Section<select data-kind>${Object.entries(
      kinds,
    )
      .map(
        ([key, label]) =>
          `<option value="${key}" ${kind === key ? "selected" : ""}>${label}</option>`,
      )
      .join(
        "",
      )}</select></label><label>Find a label<input type="search" data-search></label><div class="registry-actions"><button type="button" data-new>Add ${kind.replace(/_/g, " ")}</button><button type="button" data-add-mapping>Add Mapping</button></div><div class="registry-unit-list">${items.map((i) => `<button type="button" data-key="${esc(i.key)}" data-label-search="${esc([i.key, i.label, ...i.aliases].join(" ").toLowerCase())}">${esc(i.label)} · ${i.active ? "Active" : "Archived"} · ${i.usage.records} linked records</button>`).join("") || "<p>No values yet. Add the first value above.</p>"}</div><form><h3>${selected ? `Edit ${esc(selected.label)}` : "Add a reference value"}</h3><label>Stable key<input name="key" required pattern="[A-Za-z0-9_]+" value="${esc(selected?.key)}" ${selected ? "readonly" : ""} placeholder="For example: STUDY_LEAVE"></label><label>Display label<input name="label" required maxlength="255" value="${esc(selected?.label)}"></label><label>Imported spellings / aliases (one per line)<textarea name="aliases" rows="4" placeholder="For example: study leave&#10;Study LV">${esc(selected?.aliases.join("\n"))}</textarea></label>${
      ["leave_status", "leave_slot", "posting_type"].includes(kind)
        ? `<label>Operational meaning<select name="maps_to" required><option value="">Choose a supported meaning</option>${items
            .filter((i) => i.behavior.maps_to === i.key)
            .map(
              (i) =>
                `<option value="${esc(i.key)}" ${selected?.behavior.maps_to === i.key ? "selected" : ""}>${esc(i.label)}</option>`,
            )
            .join(
              "",
            )}</select></label><p>${kind === "leave_status" ? "Approved blocks availability; pending warns; cancelled and rejected do not block." : kind === "leave_slot" ? "Map the imported session to a supported time window; custom sessions conservatively block duties until clarified." : "A label uses the selected posting's unit and eligibility rules. Genuinely new duty behavior requires duty-rule configuration."}</p>`
        : ""
    }${
      kind === "duty_type"
        ? `<fieldset><legend>Scheduling behavior</legend><label>Duty family<select name="group">${["main", "cb", "rc", "pac", "caesar", "schell", "floating", "fifth_call", "cart", "shift", "chad", "ruhsa", "paeds", "neuro"].map((group) => `<option ${selected?.behavior.group === group ? "selected" : ""}>${group}</option>`).join("")}</select></label><label>Duration in hours<input name="duration_hours" type="number" min="1" max="48" required value="${selected?.behavior.duration_hours ?? 24}"></label><label>Start time<input name="start_time" type="time" required value="${esc(selected?.behavior.start_time || "08:00")}"></label><label>End time<input name="end_time" type="time" required value="${esc(selected?.behavior.end_time || "08:00")}"></label><label>Eligible call levels<select name="allowed_call_levels" multiple required size="6">${["1ST_CALL", "2ND_CALL", "3RD_CALL", "4TH_CALL", "CO_4TH_CALL", "5TH_CALL"].map((level) => `<option ${((selected?.behavior.allowed_call_levels as string[]) || []).includes(level) ? "selected" : ""}>${level}</option>`).join("")}</select></label>${[
            ["counts_in_main_24hr", "Count as a main 24-hour duty"],
            ["is_mandatory", "Required in template"],
            [
              "blocks_elective_same_day",
              "Block elective duties on the same day",
            ],
            [
              "blocks_elective_next_day",
              "Block elective duties on the next day",
            ],
          ]
            .map(
              ([field, label]) =>
                `<label><input type="checkbox" name="${field}" ${selected?.behavior[field] === true ? "checked" : ""}>${label}</label>`,
            )
            .join(
              "",
            )}<p>Duration controls the 24-hour flag. Eligibility, unit staffing, approved leave and rest checks apply when duties are assigned.</p></fieldset>`
        : ""
    }<label>Status<select name="active"><option value="true" ${selected?.active !== false ? "selected" : ""}>Active</option><option value="false" ${selected?.active === false ? "selected" : ""}>Archived</option></select></label>${selected ? `<p>${selected.usage.records} records use this reference. Renaming keeps the previous label as an alias; historical records remain linked.</p><button type="button" data-reference-history>View reference activity</button>` : ""}<p role="alert" class="mw-error" data-error></p><footer class="mw-footer"><button type="button" data-close>Cancel</button><button type="submit" class="primary">Save reference</button></footer></form></div>`;
    dialog
      .querySelectorAll<HTMLButtonElement>("[data-close]")
      .forEach((b) => (b.onclick = close));
    dialog.querySelector<HTMLSelectElement>("[data-kind]")!.onchange = (e) => {
      if (dirty && !confirm("Discard changes and switch sections?")) {
        (e.target as HTMLSelectElement).value = kind;
        return;
      }
      kind = (e.target as HTMLSelectElement).value;
      void load();
    };
    dialog.querySelector<HTMLInputElement>("[data-search]")!.oninput = (e) => {
      const q = (e.target as HTMLInputElement).value.toLowerCase();
      dialog
        .querySelectorAll<HTMLElement>("[data-label-search]")
        .forEach((el) => (el.hidden = !el.dataset.labelSearch!.includes(q)));
    };
    dialog.querySelectorAll<HTMLButtonElement>("[data-key]").forEach(
      (b) =>
        (b.onclick = () => {
          if (dirty && !confirm("Discard edits?")) return;
          selected = items.find((i) => i.key === b.dataset.key);
          dirty = false;
          render();
        }),
    );
    dialog
      .querySelector<HTMLButtonElement>("[data-reference-history]")
      ?.addEventListener("click", () => {
        if (selected)
          void openReferenceHistory(
            `kind=${kind}&key=${encodeURIComponent(selected.key)}`,
          );
      });
    dialog.querySelector<HTMLButtonElement>("[data-new]")!.onclick = () => {
      if (dirty && !confirm("Discard edits?")) return;
      selected = undefined;
      dirty = false;
      render();
      dialog.querySelector<HTMLInputElement>("[name=label]")!.focus();
    };
    dialog.querySelector<HTMLButtonElement>("[data-add-mapping]")!.onclick =
      () => {
        if (!selected) {
          dialog.querySelector("[data-error]")!.textContent =
            "Select the destination label above, then add the imported spelling to its aliases.";
          dialog.querySelector<HTMLElement>("[data-key]")?.focus();
          return;
        }
        dialog.querySelector<HTMLTextAreaElement>("[name=aliases]")!.focus();
      };
    const form = dialog.querySelector<HTMLFormElement>("form")!;
    form.oninput = () => {
      dirty = true;
    };
    form.querySelector<HTMLInputElement>("[name=label]")!.onblur = () => {
      const key = form.querySelector<HTMLInputElement>("[name=key]")!;
      if (!selected && !key.value)
        key.value = form
          .querySelector<HTMLInputElement>("[name=label]")!
          .value.toUpperCase()
          .replace(/[^A-Z0-9]+/g, "_")
          .replace(/^_|_$/g, "");
    };
    form.onsubmit = async (e) => {
      e.preventDefault();
      if (busy) return;
      const formData = new FormData(form);
      const values = Object.fromEntries(formData);
      if (
        selected &&
        values.active === "false" &&
        selected.active &&
        !confirm(
          `Archive ${selected.label}? ${selected.usage.records} historical records remain; new selections will exclude it.`,
        )
      )
        return;
      busy = true;
      try {
        await request(
          `/api/v1/normalization/catalog/${kind}/${encodeURIComponent(String(values.key))}`,
          {
            method: "PUT",
            body: JSON.stringify({
              label: values.label,
              aliases: String(values.aliases || "")
                .split("\n")
                .map((a) => a.trim())
                .filter(Boolean),
              active: values.active === "true",
              version: selected?.version || 0,
              behavior:
                kind === "duty_type"
                  ? {
                      ...selected?.behavior,
                      group: values.group,
                      duration_hours: Number(values.duration_hours),
                      start_time: values.start_time,
                      end_time: values.end_time,
                      is_24hr: Number(values.duration_hours) === 24,
                      allowed_call_levels: formData.getAll(
                        "allowed_call_levels",
                      ),
                      ...Object.fromEntries(
                        [
                          "counts_in_main_24hr",
                          "is_mandatory",
                          "blocks_elective_same_day",
                          "blocks_elective_next_day",
                        ].map((key) => [key, formData.has(key)]),
                      ),
                    }
                  : values.maps_to
                    ? { maps_to: values.maps_to }
                    : selected?.behavior || {},
            }),
          },
        );
        dirty = false;
        await load();
        saved();
      } catch (error) {
        form.querySelector("[data-error]")!.textContent = (
          error as Error
        ).message;
      } finally {
        busy = false;
      }
    };
  }
  await load();
}
