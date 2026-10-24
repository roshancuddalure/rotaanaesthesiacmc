import { request } from "./services/api";
import { workspaceDialog } from "./member-workspace";
import { workspaceLoading, workspaceLoadFailure, savedReadbackFailure, lockWorkspaceControls, protectWorkspaceDraft } from "./workspace-load-state";
import { installFormValidation, watchFormFocus } from "./form-validation";
import { formatAuditTimestamp } from "./audit-time";

const esc = (value: unknown) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );

function updateRegistryResultStatus(dialog: HTMLDialogElement, selector: string, noun: string) {
  const choices = [...dialog.querySelectorAll<HTMLElement>(selector)];
  const shown = choices.filter(choice => !choice.hidden).length;
  const status = dialog.querySelector<HTMLElement>("[data-search-results]");
  if (status) status.textContent = !choices.length ? `No ${noun} loaded.` : shown ? `${shown} of ${choices.length} ${noun} shown.` : `No ${noun} match these filters. Clear the search or adjust the filters.`;
}

export async function openMappingCreator(saved: () => void) {
  const dialog = workspaceDialog("Add imported label mapping", "mw-import");
  let dirty = false,
    busy = false;
  protectWorkspaceDraft(dialog, () => dirty || busy);
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
  const validation = installFormValidation(form, form.querySelector<HTMLElement>("[data-error]")!);
  const type = form.querySelector<HTMLSelectElement>("[name=mapping_type]")!;
  const target = form.querySelector<HTMLSelectElement>("[name=target_key]")!;
  const saveButton = form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
  const saveStatus = document.createElement("p");
  saveStatus.setAttribute("role", "status");
  saveStatus.setAttribute("aria-atomic", "true");
  form.before(saveStatus);
  const destinationStatus = document.createElement("div");
  destinationStatus.setAttribute("data-destination-status", "");
  target.closest("label")!.after(destinationStatus);
  let destinationsReady = false;
  let optionsSequence = 0;
  const filterDestinations = () => {
    const q = form.querySelector<HTMLInputElement>("[data-find]")!.value.toLowerCase();
    Array.from(target.options).forEach(option => { option.hidden = Boolean(option.value && !option.selected && !option.text.toLowerCase().includes(q)); });
  };
  async function load() {
    const sequence = ++optionsSequence;
    const retryFocused = destinationStatus.contains(document.activeElement);
    destinationsReady = false;
    saveButton.disabled = true;
    destinationStatus.innerHTML = '<p role="status">Loading destinations…</p>';
    target.disabled = true;
    target.innerHTML = '<option value="">Loading destinations...</option>';
    try {
      const values = await request<any[]>(
        type.value === "unit_label"
          ? "/api/v1/normalization/units"
          : `/api/v1/normalization/catalog/${type.value === "duty_label" ? "duty_type" : "posting_type"}`,
      );
      if (!dialog.open || sequence !== optionsSequence) return;
      target.innerHTML = `<option value="">Select a destination</option>${values
        .filter((i) => i.active !== false && i.active_status !== "archived")
        .map(
          (i) =>
            `<option value="${esc(i.id || i.key)}">${esc(i.label || `${i.campus || ""} ${i.name}`.trim())}</option>`,
        )
        .join("")}`;
      destinationsReady = true;
      destinationStatus.replaceChildren();
      filterDestinations();
    } catch (error) {
      if (!dialog.open || sequence !== optionsSequence) return;
      target.innerHTML = '<option value="">Destinations unavailable</option>';
      destinationStatus.innerHTML = `<p role="alert">${esc(error instanceof Error ? error.message : "Destinations could not load.")}</p><button type="button" data-retry-destinations>Retry destinations</button>`;
      destinationStatus.querySelector<HTMLButtonElement>("button")!.onclick = () => void load();
      if (retryFocused && (document.activeElement === document.body || document.activeElement === dialog))
        destinationStatus.querySelector<HTMLButtonElement>("button")!.focus({ preventScroll: true });
    } finally {
      if (dialog.open && sequence === optionsSequence) {
        target.disabled = !destinationsReady;
        saveButton.disabled = !destinationsReady || busy;
        if (destinationsReady && retryFocused && (document.activeElement === document.body || document.activeElement === dialog))
          target.focus({ preventScroll: true });
      }
    }
  }
  type.onchange = () => void load();
  form.oninput = (event) => {
    if (event.target instanceof HTMLElement && event.target.matches("[name]"))
      dirty = true;
  };
  form.querySelector<HTMLInputElement>("[data-find]")!.oninput = filterDestinations;
  form.onsubmit = async (e) => {
    e.preventDefault();
    if (busy || !destinationsReady || target.disabled || !target.value) return;
    const values = Object.fromEntries(new FormData(form));
    const targetLabel = target.selectedOptions[0]?.text;
    busy = true;
    validation.clear();
    const focus = watchFormFocus();
    const unlock = lockWorkspaceControls(dialog);
    saveButton.textContent = "Saving mapping…";
    saveButton.setAttribute("aria-busy", "true");
    form.setAttribute("aria-busy", "true");
    saveStatus.textContent = "Saving mapping. Please wait before closing.";
    try {
      await request("/api/v1/admin/mappings", {
        method: "POST",
        body: JSON.stringify({
          ...values,
          status: "reviewed",
          target_label: targetLabel,
        }),
      });
      dirty = false;
      busy = false;
      close();
      saved();
    } catch (error) {
      validation.show(error, focus.unchanged());
    } finally {
      busy = false;
      unlock();
      saveButton.disabled = !destinationsReady;
      saveButton.textContent = "Save mapping";
      saveButton.removeAttribute("aria-busy");
      form.removeAttribute("aria-busy");
      saveStatus.textContent = "";
      focus.stop();
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
  async function loadActivity() {
    if (!dialog.open) return;
    const restoreFocus = workspaceLoading(dialog, "Reference activity", close);
    try {
    const rows = await request<Record<string, any>[]>(
      `/api/v1/normalization/activity?${query}`,
    );
    if (!dialog.open) return;
    dialog.innerHTML = `<header class="mw-header"><h2>Reference activity</h2><button type="button" data-close aria-label="Close activity">×</button></header><div class="mw-content">${
      rows
        .map(
          (row) =>
            `<article class="mw-history"><strong>${esc(row.action.replace(/_/g, " "))}</strong><p>${esc(row.operator)} · ${esc(formatAuditTimestamp(row.created_at))}</p><dl>${Object.entries(
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
      workspaceLoadFailure(dialog, "Activity unavailable", error, () => void loadActivity(), close);
      return;
    }
  dialog.querySelector<HTMLButtonElement>("[data-close]")!.onclick = close;
  restoreFocus();
  }
  await loadActivity();
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
  let confirmedUnit: Unit | undefined;
  let busy = false;
  let dirty = false;
  protectWorkspaceDraft(dialog, () => dirty || (busy && !confirmedUnit));
  let month = new Date().toLocaleDateString("en-CA").slice(0, 7);
  let statusFilter = "all";
  let monthSequence = 0;
  let countsMonth = month;
  let countState: "ready" | "loading" | "error" = "ready";
  let countError = "";
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
  async function loadUnits() {
    if (!dialog.open) return;
    const restoreFocus = workspaceLoading(dialog, "Department units", close);
    try {
    units = await request<Unit[]>(`/api/v1/normalization/units?month=${month}`);
    if (!dialog.open) return;
  } catch (error) {
    if (!dialog.open) return;
    workspaceLoadFailure(dialog, "Units unavailable", error, () => void loadUnits(), close);
    return;
  }
  countsMonth = month;
  countState = "ready";
  selected = units.find((u) => u.id === initialId);
  if (createNew) selected = undefined;
  render();
  restoreFocus();
  }

  async function refreshSavedUnit() {
    if (!dialog.open || !confirmedUnit || busy) return;
    busy = true;
    const restoreFocus = workspaceLoading(dialog, "Refreshing saved unit", () => { busy = false; close(); });
    try {
      const refreshed = await request<Unit[]>(`/api/v1/normalization/units?month=${month}`);
      if (!dialog.open) return;
      units = refreshed;
      countsMonth = month;
      countState = "ready";
      ++monthSequence;
      selected = confirmedUnit;
      confirmedUnit = undefined;
      busy = false;
      render();
      restoreFocus();
      saved(selected);
    } catch (error) {
      savedReadbackFailure(dialog, error, () => void refreshSavedUnit(), close);
    } finally { busy = false; }
  }

  function updateCountStatus() {
    const status = dialog.querySelector<HTMLElement>("[data-count-status]");
    if (!status) return;
    status.querySelector<HTMLElement>("[data-count-message]")!.textContent =
      countState === "loading" ? `Loading member counts for ${month}. Showing last confirmed counts for ${countsMonth}. You can keep editing.` :
      countState === "error" ? `Member counts for ${month} could not load. Showing last confirmed counts for ${countsMonth}. ${countError}` :
      `Member counts shown for ${countsMonth}.`;
    const retry = status.querySelector<HTMLButtonElement>("button")!;
    retry.hidden = countState === "ready" || (countState === "loading" && retry.hidden);
    retry.disabled = countState === "loading" || busy;
    retry.onclick = () => void refreshMemberCounts();
    const list = dialog.querySelector<HTMLElement>(".registry-unit-list")!;
    if (countState === "loading") list.setAttribute("aria-busy", "true");
    else list.removeAttribute("aria-busy");
  }

  async function refreshMemberCounts() {
    if (!dialog.open) return;
    const sequence = ++monthSequence;
    const requestedMonth = month;
    countState = "loading";
    countError = "";
    updateCountStatus();
    try {
      const loadedUnits = await request<Unit[]>(`/api/v1/normalization/units?month=${requestedMonth}`);
      if (!dialog.open || sequence !== monthSequence) return;
      // A count refresh must never replace the editor or its revision/draft.
      const counts = new Map(loadedUnits.map(unit => [unit.id, unit.usage.selected_members]));
      units.forEach(unit => {
        const count = counts.get(unit.id);
        if (count === undefined) delete unit.usage.selected_members;
        else unit.usage.selected_members = count;
      });
      countsMonth = requestedMonth;
      dialog.querySelectorAll<HTMLElement>("[data-unit-count]").forEach(label => {
        const count = counts.get(label.dataset.unitCount!);
        label.textContent = count === undefined ? `Member count unavailable for ${countsMonth}` : `${count} members in ${countsMonth}`;
      });
      countState = "ready";
    } catch (error) {
      if (!dialog.open || sequence !== monthSequence) return;
      countState = "error";
      countError = error instanceof Error ? error.message : "Please retry.";
    }
    if (!dialog.open || sequence !== monthSequence) return;
    const retry = dialog.querySelector<HTMLButtonElement>("[data-count-status] button");
    const retryFocused = document.activeElement === retry;
    updateCountStatus();
    if (countState === "ready" && retryFocused)
      dialog.querySelector<HTMLInputElement>("[data-unit-month]")?.focus({ preventScroll: true });
  }

  function render() {
    if (!dialog.open) return;
    dialog.innerHTML = `<header class="mw-header"><div><h2>Department units</h2><p>Create units, maintain names and aliases, and preserve their history.</p></div><button data-close type="button" aria-label="Close unit management">×</button></header><div class="mw-content"><div class="registry-actions"><label>Find a unit<input type="search" data-search placeholder="Name, code, campus or alias"></label><label>Member count month<input type="month" data-unit-month value="${month}"></label><label>Show units<select data-unit-status><option value="all">All</option><option value="active" ${statusFilter === "active" ? "selected" : ""}>Active</option><option value="archived" ${statusFilter === "archived" ? "selected" : ""}>Archived</option></select></label><button type="button" data-new>Add Unit</button></div><div data-count-status><p role="status" aria-atomic="true" data-count-message></p><button type="button" hidden>Retry member counts</button></div><p role="status" aria-live="polite" aria-atomic="true" data-search-results></p><div class="registry-unit-list">${units.map((u) => `<button type="button" data-select-unit="${u.id}" ${selected?.id === u.id ? 'aria-current="true"' : ""} data-unit-state="${u.active_status}" data-unit-search="${esc([u.name, u.code, u.campus, ...u.aliases].join(" ").toLowerCase())}"><strong>${esc(u.name)}</strong> · ${esc(u.campus || "Campus not specified")} · ${esc(u.code)} · ${esc(u.active_status)} &middot; <span data-unit-count="${esc(u.id)}">${u.usage.selected_members === undefined ? `Member count unavailable for ${countsMonth}` : `${u.usage.selected_members} members in ${countsMonth}`}</span></button>`).join("") || "<p>No units yet. Add your first department unit below.</p>"}</div><hr><h3>${selected ? `Edit ${esc(selected.name)}` : "Add a unit"}</h3>${selected ? `<p>${selected.usage.postings} postings · ${selected.usage.duties} duty slots linked. ${selected.usage.future_postings} current/upcoming postings and ${selected.usage.future_duties} future duty slots.</p><button type="button" data-unit-history>View unit activity</button>` : ""}<form id="registry-unit-form"><label>Unit name<input name="name" required maxlength="255" value="${esc(selected?.name)}" placeholder="For example: Unit IV"></label><label>Campus<input name="campus" maxlength="100" value="${esc(selected?.campus)}" placeholder="For example: Main or Ranipet"></label><label>Unique unit code<input name="code" maxlength="50" value="${esc(selected?.code)}" placeholder="Suggested from name and campus"></label><label>Minimum free people<input name="minimum_free_people" type="number" min="0" required value="${selected?.minimum_free_people ?? 1}"></label><details><summary>Call-wise staffing minimums</summary>${["1ST_CALL", "2ND_CALL", "3RD_CALL", "CO_4TH_CALL", "4TH_CALL", "5TH_CALL"].map((level) => `<label>${level.replace(/_/g, " ")}<input type="number" min="0" data-call-minimum="${level}" placeholder="Use fallback minimum" value="${selected?.call_minimums?.find(([key]) => key === level)?.[1] ?? ""}"></label>`).join("")}</details><label>Alternative labels (one per line)<textarea name="aliases" rows="4" placeholder="Use campus-qualified aliases where numbered units could be confused">${esc(selected?.aliases.join("\n"))}</textarea></label><label>Notes<textarea name="notes" rows="3">${esc(selected?.notes)}</textarea></label><label>Membership<select name="active_status"><option value="active" ${selected?.active_status !== "archived" ? "selected" : ""}>Active</option><option value="archived" ${selected?.active_status === "archived" ? "selected" : ""}>Archived</option></select></label><p>Renaming keeps the previous unit label as an alias. Archiving preserves postings and duty history.</p><p class="mw-error" role="alert" data-error></p><div class="mw-footer"><span data-dirty>Saved details</span><button type="button" data-close>Cancel</button><button class="primary" type="submit">${selected ? "Save unit" : "Create unit"}</button></div></form></div>`;
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
      updateRegistryResultStatus(dialog, "[data-unit-search]", "units");
    }
    dialog.querySelector<HTMLSelectElement>("[data-unit-status]")!.onchange = (
      e,
    ) => {
      statusFilter = (e.target as HTMLSelectElement).value;
      filterUnits();
    };
    dialog.querySelector<HTMLInputElement>("[data-search]")!.oninput =
      filterUnits;
    dialog.querySelector<HTMLInputElement>("[data-unit-month]")!.onchange = (e) => {
      const nextMonth = (e.target as HTMLInputElement).value || month;
      if (nextMonth === month) return;
      if (dirty && !confirm("Discard edits and change the count month?")) {
        (e.target as HTMLInputElement).value = month;
        return;
      }
      month = nextMonth;
      if (dirty) {
        // Discard only the draft explicitly confirmed now, never later edits.
        dirty = false;
        render();
      }
      void refreshMemberCounts();
    };
    updateCountStatus();
    filterUnits();
    const form = dialog.querySelector<HTMLFormElement>("form")!;
    let submittedCallInputs: HTMLInputElement[] = [];
    const validation = installFormValidation(form, form.querySelector<HTMLElement>("[data-error]")!, path => {
      if (path.length === 3 && path[0] === "call_minimums" && typeof path[1] === "number" && path[2] === "minimum_free_people") {
        return submittedCallInputs[path[1]] ?? null;
      }
      return null;
    });
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
        if (!dialog.open || !form.isConnected ||
          (form.elements.namedItem("name") as HTMLInputElement).value !== name ||
          (form.elements.namedItem("campus") as HTMLInputElement).value !== campus ||
          (form.elements.namedItem("code") as HTMLInputElement).value) return;
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
      submittedCallInputs = [...form.querySelectorAll<HTMLInputElement>("[data-call-minimum]")].filter(input => input.value !== "");
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
      const submitLabel = submit.textContent;
      submit.textContent = "Saving unit…";
      form.setAttribute("aria-busy", "true");
      validation.clear();
      const focus = watchFormFocus();
      const unlock = lockWorkspaceControls(dialog);
      try {
        const result = await request<Unit>(
          `/api/v1/normalization/units${selected ? `/${selected.id}` : ""}`,
          { method: selected ? "PUT" : "POST", body: JSON.stringify(payload) },
        );
        selected = result;
        confirmedUnit = result;
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
        countsMonth = month;
        countState = "ready";
        ++monthSequence;
        selected = result;
        confirmedUnit = undefined;
        dirty = false;
        render();
        saved(result);
      } catch (error) {
        if (confirmedUnit) savedReadbackFailure(dialog, error, () => void refreshSavedUnit(), close);
        else validation.show(error, focus.unchanged());
      } finally {
        unlock();
        focus.stop();
        busy = false;
        submit.disabled = false;
        submit.textContent = submitLabel;
        form.removeAttribute("aria-busy");
        if (dialog.open) updateCountStatus();
      }
    };
  }
  await loadUnits();
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
  let confirmedReferenceSave = false;
  protectWorkspaceDraft(dialog, () => dirty || (busy && !confirmedReferenceSave));
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
    const loadingKind = kind;
    const restoreFocus = workspaceLoading(dialog, "Reference labels and mappings", () => {
      if (confirmedReferenceSave) busy = false;
      close();
    });
    try {
      const loadedItems = await request<Reference[]>(
        `/api/v1/normalization/catalog/${kind}`,
      );
      if (!dialog.open || loadingKind !== kind) return;
      items = loadedItems;
      selected = undefined;
      dirty = false;
      const notifySaved = confirmedReferenceSave;
      confirmedReferenceSave = false;
      render();
      restoreFocus();
      if (notifySaved) saved();
    } catch (error) {
      if (!dialog.open || loadingKind !== kind) return;
      if (confirmedReferenceSave) savedReadbackFailure(dialog, error, () => void load(), close);
      else workspaceLoadFailure(dialog, "Reference labels unavailable", error, () => void load(), close);
    }
  }
  function render() {
    if (!dialog.open) return;
    dialog.innerHTML = `<header class="mw-header"><div><h2>Reference labels and mappings</h2><p>A mapping connects an imported spelling to an approved value. Example: CL → Casual leave.</p></div><button type="button" data-close aria-label="Close reference management">×</button></header><div class="mw-content"><label>Section<select data-kind>${Object.entries(
      kinds,
    )
      .map(
        ([key, label]) =>
          `<option value="${key}" ${kind === key ? "selected" : ""}>${label}</option>`,
      )
      .join(
        "",
      )}</select></label><label>Find a label<input type="search" data-search></label><div class="registry-actions"><button type="button" data-new>Add ${kind.replace(/_/g, " ")}</button><button type="button" data-add-mapping>Add Mapping</button></div><p role="status" aria-live="polite" aria-atomic="true" data-search-results></p><div class="registry-unit-list">${items.map((i) => `<button type="button" data-key="${esc(i.key)}" ${selected?.key === i.key ? 'aria-current="true"' : ""} data-label-search="${esc([i.key, i.label, ...i.aliases].join(" ").toLowerCase())}">${esc(i.label)} · ${i.active ? "Active" : "Archived"} · ${i.usage.records} linked records</button>`).join("") || "<p>No values yet. Add the first value above.</p>"}</div><form><h3>${selected ? `Edit ${esc(selected.label)}` : "Add a reference value"}</h3><label>Stable key<input name="key" required pattern="[A-Za-z0-9_]+" value="${esc(selected?.key)}" ${selected ? "readonly" : ""} placeholder="For example: STUDY_LEAVE"></label><label>Display label<input name="label" required maxlength="255" value="${esc(selected?.label)}"></label><label>Imported spellings / aliases (one per line)<textarea name="aliases" rows="4" placeholder="For example: study leave&#10;Study LV">${esc(selected?.aliases.join("\n"))}</textarea></label>${
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
      updateRegistryResultStatus(dialog, "[data-label-search]", "labels");
    };
    updateRegistryResultStatus(dialog, "[data-label-search]", "labels");
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
    const validation = installFormValidation(form, form.querySelector<HTMLElement>("[data-error]")!);
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
      validation.clear();
      const focus = watchFormFocus();
      const unlock = lockWorkspaceControls(dialog);
      const submit = form.querySelector<HTMLButtonElement>('[type="submit"]')!;
      const submitLabel = submit.textContent;
      submit.textContent = "Saving reference…";
      form.setAttribute("aria-busy", "true");
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
        confirmedReferenceSave = true;
        await load();
      } catch (error) {
        validation.show(error, focus.unchanged());
      } finally {
        unlock();
        submit.textContent = submitLabel;
        form.removeAttribute("aria-busy");
        focus.stop();
        busy = false;
      }
    };
  }
  await load();
}
