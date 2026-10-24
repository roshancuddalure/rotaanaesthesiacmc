import { request, requestMultipartJSON, type DepartmentMember } from "./services/api";
import { workspaceDialog, openMemberWorkspace } from "./member-workspace";
import { lockWorkspaceControls, protectWorkspaceDraft } from "./workspace-load-state";
import { openUnitRegistry, openReferenceCatalog } from "./reference-workspace";
import { applyBlocker, badge, importSummary, memberMatch, retainActionFocus, steps, type MemberMatchView } from "./ui";

const IMPORT_STEPS = ["Upload file", "Map columns", "Review rows", "Apply"];

type Row = Record<string, any>;
type Preview = {
  id: string;
  kind: string;
  month: string;
  mode: string;
  headers: string[];
  fields: string[];
  rows: Row[];
  replacement_scope: Row[];
};
const esc = (value: unknown) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );

export async function createMemberInline(
  name: string,
  done: (member: DepartmentMember) => void,
) {
  const dialog = workspaceDialog("Create department member", "mw-import");
  dialog.innerHTML = `<header class="mw-header"><h2>Create department member</h2><button type="button" data-close aria-label="Close member creation">×</button></header><form class="mw-content"><p>Check the suggested existing members before creating a new identity. This creates the member; the import still requires review and apply.</p><label>Full member name<input name="canonical_name" required maxlength="255" value="${esc(name)}"></label><section data-existing-members aria-live="polite"></section><label>Default call level<select name="call_level"><option value="">Unassigned</option>${["1ST_CALL", "2ND_CALL", "3RD_CALL", "CO_4TH_CALL", "4TH_CALL", "5TH_CALL"].map((key) => `<option>${key}</option>`).join("")}</select></label><p data-error class="mw-error" role="alert"></p><button class="primary" type="submit">Create member</button></form>`;
  let busy = false;
  let memberDraftDirty = false;
  protectWorkspaceDraft(dialog, () => busy || memberDraftDirty);
  let lookupSequence = 0;
  let nameEditSequence = 0;
  const creationStatus = document.createElement("p");
  creationStatus.setAttribute("role", "status");
  creationStatus.setAttribute("aria-live", "polite");
  dialog.append(creationStatus);
  const close = () => {
    if (
      busy ||
      (memberDraftDirty && !confirm("Discard this new member draft?"))
    )
      return;
    dialog.close();
    dialog.remove();
  };
  dialog.querySelector("[data-close]")!.addEventListener("click", close);
  dialog.addEventListener("cancel", (e) => {
    e.preventDefault();
    close();
  });
  async function checkExisting() {
    const current = ++lookupSequence;
    const nameInput = dialog.querySelector<HTMLInputElement>(
      "[name=canonical_name]",
    )!;
    if (!nameInput.value.trim()) {
      dialog.querySelector("[data-existing-members]")!.textContent = "Enter a name to check existing members.";
      return;
    }
    try {
      const result = await request<Row>(
        "/api/v1/normalization/members/resolve",
        { method: "POST", body: JSON.stringify({ name: nameInput.value }) },
      );
      if (current !== lookupSequence || !dialog.open) return;
      const root = dialog.querySelector<HTMLElement>(
        "[data-existing-members]",
      )!;
      const focusedCandidate = document.activeElement instanceof HTMLButtonElement && root.contains(document.activeElement)
        ? { use: document.activeElement.dataset.useExisting, review: document.activeElement.dataset.reviewExisting }
        : null;
      root.innerHTML = result.candidates.length
        ? `<h3>Check existing members</h3>${result.candidates.map((c: Row) => `<article class="mw-history"><strong>${esc(c.name)}</strong><p>${esc(c.status)} &rarr; ${esc(c.call_level || "Unassigned")} &rarr; ${esc(c.designation || "No current designation")}</p>${c.status === "active" ? `<button type="button" data-use-existing="${c.id}">Use this member</button>` : `<button type="button" data-review-existing="${c.id}">Review / restore member</button>`}</article>`).join("")}`
        : "<p>No matching identities found.</p>";
      root.querySelectorAll<HTMLButtonElement>("[data-use-existing]").forEach(
        (button) =>
          (button.onclick = async () => {
            if (busy) return;
            const selectedNameVersion = nameEditSequence;
            const choiceIsCurrent = () => dialog.isConnected && dialog.open
              && selectedNameVersion === nameEditSequence;
            const restoreFocus = retainActionFocus(dialog, button, () => button.isConnected ? button : null);
            busy = true;
            button.disabled = true;
            creationStatus.textContent = "Checking selected member. Changing the name cancels this choice.";
            dialog.querySelector("[data-error]")!.textContent = "";
            try {
              const members = await request<DepartmentMember[]>(
                "/api/v1/admin/members",
              );
              if (!choiceIsCurrent()) return;
              const member = members.find(
                (m) => m.id === button.dataset.useExisting,
              );
              if (member) {
                memberDraftDirty = false;
                busy = false;
                close();
                done(member);
              } else dialog.querySelector("[data-error]")!.textContent = "This member is no longer available. Check the name again.";
            } catch (error) {
              if (choiceIsCurrent()) dialog.querySelector("[data-error]")!.textContent = (error as Error).message;
            } finally {
              busy = false;
              button.disabled = false;
              if (dialog.open) creationStatus.textContent = "";
              restoreFocus(choiceIsCurrent());
            }
          }),
      );
      root
        .querySelectorAll<HTMLButtonElement>("[data-review-existing]")
        .forEach(
          (button) =>
            (button.onclick = async () => {
              await openMemberWorkspace(
                button.dataset.reviewExisting!,
                true,
                () => {
                  void checkExisting();
                },
                [],
                "details",
                "active",
              );
            }),
        );
      if (focusedCandidate && document.activeElement === document.body) {
        const replacement = [...root.querySelectorAll<HTMLButtonElement>("[data-use-existing], [data-review-existing]")]
          .find(button => (focusedCandidate.use && button.dataset.useExisting === focusedCandidate.use)
            || (focusedCandidate.review && button.dataset.reviewExisting === focusedCandidate.review));
        (replacement ?? nameInput).focus({ preventScroll: true });
      }
    } catch (error) {
      if (current === lookupSequence && dialog.open)
        dialog.querySelector("[data-error]")!.textContent = (
          error as Error
        ).message;
    }
  }
  dialog.querySelector<HTMLFormElement>("form")!.oninput = (event) => {
    memberDraftDirty = true;
    lookupSequence++;
    if (event.target instanceof HTMLInputElement && event.target.name === "canonical_name") nameEditSequence++;
  };
  dialog.querySelector<HTMLInputElement>("[name=canonical_name]")!.onblur =
    () => void checkExisting();
  if (name) void checkExisting();
  dialog.querySelector<HTMLFormElement>("form")!.onsubmit = async (e) => {
    e.preventDefault();
    if (busy) return;
    const form = e.target as HTMLFormElement;
    const submit = form.querySelector<HTMLButtonElement>('[type="submit"]')!;
    const values = Object.fromEntries(
      new FormData(form),
    );
    busy = true;
    lookupSequence++;
    const alive = () => dialog.isConnected && dialog.open;
    const restoreFocus = retainActionFocus(dialog, submit, () => submit.isConnected ? submit : null);
    const unlock = lockWorkspaceControls(dialog);
    submit.textContent = "Creating member…";
    form.setAttribute("aria-busy", "true");
    creationStatus.textContent = "Creating member. Please wait before closing.";
    dialog.querySelector("[data-error]")!.textContent = "";
    try {
      const member = await request<DepartmentMember>("/api/v1/admin/members", {
        method: "POST",
        body: JSON.stringify({
          ...values,
          call_level: values.call_level || null,
        }),
      });
      if (!alive()) return;
      busy = false;
      memberDraftDirty = false;
      close();
      done(member);
    } catch (error) {
      if (alive()) dialog.querySelector("[data-error]")!.textContent = (
        error as Error
      ).message;
    } finally {
      unlock();
      busy = false;
      if (alive()) {
        submit.textContent = "Create member";
        form.removeAttribute("aria-busy");
        creationStatus.textContent = "";
      }
      restoreFocus(alive());
    }
  };
}

export async function openOperationalImport(
  kind: "units" | "leave",
  month: string,
  updated: () => void,
  admin: boolean,
) {
  const dialog = workspaceDialog(
    kind === "units" ? "Import unitwise assignments" : "Import leave",
    "mw-import operational-import",
  );
  let members: DepartmentMember[] = [];
  let units: Row[] = [];
  let preview: Preview | undefined;
  let file: File | undefined;
  let busy = false;
  let finished = false;
  protectWorkspaceDraft(dialog, () => busy || Boolean((file || preview) && !finished));
  let previewDirty = true;
  let draftVersion = 0;
  let columnLoadSequence = 0;
  let columns:
    | { headers: string[]; fields: string[]; suggested: Record<string, string> }
    | undefined;
  const corrections: Record<string, Row> = {};
  const mapping: Record<string, string> = {};
  const repeated: Record<string, Record<string, string>> = {
    members: {},
    units: {},
  };
  const excluded = new Set<string>();
  let page = 0;
  const title = kind === "units" ? "Unitwise assignments" : "Leave";
  dialog.innerHTML = `<header class="mw-header"><div><h2>Import ${title.toLowerCase()}</h2><div data-import-steps>${steps(IMPORT_STEPS, 0)}</div></div><button data-close type="button" aria-label="Close import review">×</button></header><div class="mw-content"><div class="registry-actions"><a class="icon-button" href="/templates/${kind === "units" ? "unitwise-assignments" : "leave-records"}.csv" download>Download ${kind === "units" ? "unitwise" : "leave"} CSV template</a><a class="quiet-button" href="/templates/${kind === "units" ? "unitwise-assignments" : "leave-records"}-example.csv" download>Download example CSV</a>${admin ? `<button type="button" class="quiet-button" data-manage-import-references>Manage labels and mappings</button>` : ""}</div><details class="mw-csv-help"><summary>CSV examples</summary><p>Use one row per dated record. Replace the illustrative member and unit names with your department records.</p><pre>${kind === "units" ? "member_name,unit_name,posting_type,starts_on,ends_on\nDr Example Member,Main Unit IV,2ND_CALL,2026-10-01,2026-10-31" : "member_name,starts_on,ends_on,leave_type,leave_slot,status\nDr Example Member,2026-10-03,2026-10-04,CL,FULL_DAY,approved"}</pre></details><form data-settings><label>Month<input type="month" name="month" required value="${esc(month)}"></label><label>File (up to 5 MB and 5,000 rows)<input type="file" required accept="${kind === "units" ? ".csv,.xlsx,.xlsm,.txt" : ".csv,.xlsx,.xls"}"></label><label>Operation<select name="mode"><option value="append">Append new records</option><option value="update_matching">Update matching member/date records</option><option value="replace_month">Replace imported records in this month</option></select></label><label>Dates in this file<select name="date_format"><option value="auto">ISO / detect unambiguous dates</option><option value="DMY">Day / month / year</option><option value="MDY">Month / day / year</option></select></label><p>Ambiguous dates need an explicit format. Blank unitwise dates use the selected month. Leave needs a start date. Replacement preserves records outside the month${kind === "leave" ? " and manually entered leave" : ""}.</p><div data-mapping></div><button class="primary" type="submit">Preview and normalize</button></form><p data-message role="status"></p><section data-review></section></div>`;
  function setStep(index: number) {
    const host = dialog.querySelector<HTMLElement>("[data-import-steps]");
    if (host) host.innerHTML = steps(IMPORT_STEPS, index);
  }
  const close = () => {
    if (
      busy ||
      ((file || preview) &&
        !finished &&
        !confirm("Discard this import draft? No import changes have been applied."))
    )
      return;
    dialog.close();
    dialog.remove();
  };
  dialog.querySelector("[data-close]")!.addEventListener("click", close);
  dialog.addEventListener("cancel", (e) => {
    e.preventDefault();
    close();
  });
  const message = dialog.querySelector<HTMLElement>("[data-message]")!;
  dialog
    .querySelector<HTMLButtonElement>("[data-manage-import-references]")
    ?.addEventListener("click", () => {
      void openReferenceCatalog(
        () => {
          dirtyPreview();
        },
        kind === "units" ? "posting_type" : "leave_type",
      );
    });
  async function loadOptions() {
    [members, units] = await Promise.all([
      request<DepartmentMember[]>("/api/v1/admin/members"),
      request<Row[]>("/api/v1/normalization/units"),
    ]);
  }
  // Load member and unit choices in the background: the file picker and form must respond
  // immediately, or a file chosen while this loads would be silently ignored.
  const optionsReady = loadOptions().catch((error) => {
    message.textContent = (error as Error).message;
  });
  // The apply button sits below a long row list, so mirror status next to it.
  function say(text: string, revealFooter = true) {
    message.textContent = text;
    const status = dialog.querySelector<HTMLElement>("[data-apply-status]");
    if (status) {
      status.textContent = text;
      if (revealFooter) status.scrollIntoView({ block: "nearest" });
    }
  }
  function dirtyPreview(revealFooter = true) {
    draftVersion++;
    previewDirty = true;
    dialog
      .querySelector<HTMLButtonElement>("[data-apply]")
      ?.setAttribute("aria-disabled", "true");
    say(
      "Changes need a refreshed preview before applying. Click “Refresh normalized preview”.",
      revealFooter,
    );
  }
  dialog.querySelector<HTMLFormElement>("[data-settings]")!.onchange =
    () => dirtyPreview();
  const fileInput = dialog.querySelector<HTMLInputElement>("input[type=file]")!;
  fileInput.onchange = async () => {
    const inspectedSequence = ++columnLoadSequence;
    file = fileInput.files?.[0];
    finished = false;
    preview = undefined;
    columns = undefined;
    previewDirty = true;
    Object.keys(corrections).forEach((k) => delete corrections[k]);
    Object.keys(mapping).forEach((k) => delete mapping[k]);
    excluded.clear();
    page = 0;
    dialog.querySelector("[data-review]")!.innerHTML = "";
    dialog.querySelector("[data-mapping]")!.innerHTML = "";
    if (!file) return;
    const inspectedFile = file;
    const upload = new FormData();
    upload.append("file", file);
    try {
      const result = await requestMultipartJSON<{headers:string[];fields:string[];suggested:Record<string,string>}>('/api/v1/import-review/columns', upload);
      if (inspectedSequence !== columnLoadSequence || file !== inspectedFile || !dialog.isConnected || !dialog.open) return;
      columns = result;
      setStep(1);
      Object.assign(
        mapping,
        Object.fromEntries(
          Object.entries(columns!.suggested).filter(([, field]) =>
            Boolean(field),
          ),
        ),
      );
      renderMapping();
      message.textContent = columns!.headers.length
        ? "Check column mappings, then preview the records."
        : "Section-style file: preview to review extracted records.";
    } catch (error) {
      if (inspectedSequence === columnLoadSequence && file === inspectedFile && dialog.isConnected && dialog.open)
        message.textContent = (error as Error).message;
    }
  };
  async function runPreview(initiator?: HTMLElement) {
    if (!file || busy) return;
    busy = true;
    const alive = () => dialog.isConnected && dialog.open;
    const initiatedWithFocus = Boolean(initiator && document.activeElement === initiator);
    let focusMoved = false;
    const trackFocus = (event: FocusEvent) => {
      if (event.target !== initiator && event.target !== document.body && event.target !== document.documentElement)
        focusMoved = true;
    };
    document.addEventListener("focusin", trackFocus);
    const submittedVersion = draftVersion;
    say("Parsing and normalizing records…", false);
    const values = new FormData(
      dialog.querySelector<HTMLFormElement>("[data-settings]")!,
    );
    const data = new FormData();
    data.append("file", file);
    data.append("month", String(values.get("month")));
    data.append("mode", String(values.get("mode")));
    data.append(
      "settings_json",
      JSON.stringify({
        date_format: values.get("date_format"),
        mapping,
        corrections,
        repeated,
        excluded: [...excluded],
      }),
    );
    try {
      const result = await requestMultipartJSON<Preview>(`/api/v1/import-review/${kind}/preview`, data);
      if (submittedVersion !== draftVersion || !alive())
        throw new Error(
          "Inputs changed while the preview was loading. Refresh the preview.",
        );
      await optionsReady;
      if (!alive()) return;
      if (submittedVersion !== draftVersion)
        throw new Error("Inputs changed while the preview was loading. Refresh the preview.");
      const chosenRow = initiator?.dataset.pickRow;
      const restoreInitiator = initiatedWithFocus && !focusMoved && initiator?.isConnected
        && document.activeElement === initiator && (initiator.matches("[data-refresh]") || Boolean(chosenRow));
      preview = result;
      finished = false;
      previewDirty = false;
      setStep(2);
      renderReview();
      renderMapping();
      say(`${preview!.rows.length} rows normalized. Nothing has been applied.`, false);
      if (restoreInitiator && alive() && !focusMoved
        && (document.activeElement === document.body || document.activeElement === dialog)) {
        const target = chosenRow
          ? dialog.querySelector<HTMLElement>(`[data-review-row="${CSS.escape(chosenRow)}"] summary`)
          : dialog.querySelector<HTMLElement>("[data-refresh]");
        const restored = target ?? dialog.querySelector<HTMLElement>("[data-refresh]");
        restored?.focus({ preventScroll: true });
        if (chosenRow) restored?.scrollIntoView({ block: "nearest", behavior: "instant" });
      }
    } catch (error) {
      if (alive()) say((error as Error).message, false);
    } finally {
      document.removeEventListener("focusin", trackFocus);
      busy = false;
    }
  }
  dialog.querySelector<HTMLFormElement>("[data-settings]")!.onsubmit = (e) => {
    e.preventDefault();
    void runPreview(e.submitter instanceof HTMLElement ? e.submitter : undefined);
  };
  function renderMapping() {
    const headerInfo = columns || preview;
    if (!headerInfo?.headers.length) return;
    const root = dialog.querySelector("[data-mapping]")!;
    root.innerHTML = `<details open><summary>Map columns</summary><p>Change a column mapping and preview again.</p>${headerInfo.headers.map((header, index) => `<label>${esc(header)}<select data-map="${index}"><option value="">Automatic / ignore unknown</option>${headerInfo.fields.map((field) => `<option value="${field}" ${mapping[header] === field ? "selected" : ""}>${esc(field.replace(/_/g, " "))}</option>`).join("")}</select></label>`).join("")}</details>`;
    root.querySelectorAll<HTMLSelectElement>("[data-map]").forEach(
      (select) =>
        (select.onchange = () => {
          const header = headerInfo.headers[Number(select.dataset.map)];
          mapping[header] = select.value;
          dirtyPreview();
        }),
    );
  }
  function renderReview() {
    if (!preview) return;
    const root = dialog.querySelector<HTMLElement>("[data-review]")!;
    const shown = preview.rows.slice(page * 25, (page + 1) * 25);
    const reviewCounts = () =>
      `${preview!.rows.filter((row) => !excluded.has(row.key) && !row.issues.length).length} ready · ${preview!.rows.filter((row) => !excluded.has(row.key) && row.issues.length).length} need review · ${excluded.size} excluded`;
    const actionCount = (action: string) => preview!.rows.filter((row) => row.action === action && !excluded.has(row.key)).length;
    const groupedSummary = importSummary([
      { label: "new", count: actionCount("create") },
      { label: "updates", count: actionCount("update") },
      { label: "unchanged", count: actionCount("unchanged") },
      { label: "need attention", count: preview!.rows.filter((row) => !excluded.has(row.key) && row.issues.length).length, tone: "warning" },
    ]);
    const matchState = (row: Row) =>
      excluded.has(row.key)
        ? "Excluded"
        : row.person_match.state === "ambiguous" ||
            row.unit_match?.state === "ambiguous"
          ? "Ambiguous"
          : row.issues.some((issue: string) =>
                /duplicate|repeated|already exists/i.test(issue),
              )
            ? "Duplicate"
            : row.issues.some((issue: string) =>
                  /invalid|ambiguous date|end date|outside.*month/i.test(issue),
                )
              ? "Invalid"
              : row.issues.length
                ? "Needs review"
                : row.action === "create"
                  ? "Matched - new record"
                  : "Matched";
    const memberView = (row: Row): MemberMatchView => ({
      raw: String(row.values.member_name ?? ""),
      status: row.person_match.state === "inactive" ? "inactive" : (row.person_match.status ?? row.person_match.state),
      name: row.person_match.canonical_name,
      method: row.person_match.method,
      reason: row.person_match.reason,
      warnings: row.person_match.warnings ?? [],
      candidates: row.person_match.candidates ?? [],
    });
    const memberOptions = (row: Row, value: Row) =>
      members
        .filter((m) => m.active_status === "active")
        .map((m) => `<option value="${m.id}" ${m.id === (value.person_id || row.after.person_id) ? "selected" : ""}>${esc(m.canonical_name)} · ${esc(m.call_level || "Unassigned")} · ${esc(m.designations.slice(-1)[0]?.designation || "Position missing")}</option>`)
        .join("");
    const unitOptions = (row: Row, value: Row) =>
      units
        .filter((u) => u.active_status === "active")
        .map((u) => `<option value="${u.id}" ${u.id === (value.unit_id || row.after.unit_id) ? "selected" : ""}>${esc(u.name)} · ${esc(u.campus || "Campus not specified")}</option>`)
        .join("");
    const special = (row: Row) => ["PAIN", "SICU", "DRP"].includes(row.after.posting_type);
    const rowHtml = (row: Row) => {
      const value = { ...row.values, ...corrections[row.key] };
      const tone = excluded.has(row.key) ? "neutral" : row.issues.length ? "warning" : "success";
      const otherIssues = row.issues.filter((issue: string) => !/department member/i.test(issue));
      const unitLine = kind === "units" && row.unit_match
        ? `<p class="import-row__unit"><span class="muted-text">Unit</span> ${esc(row.values.unit_name || "(blank)")} → <strong>${esc(row.unit_match.name || (special(row) ? "Special posting (no unit)" : "not chosen"))}</strong>${row.unit_match.state !== "matched" && !special(row) ? ` ${badge("Choose unit", "warning")}` : ""}</p>`
        : "";
      return `<article class="import-row${excluded.has(row.key) ? " is-excluded" : ""}" data-review-row="${esc(row.key)}">
        <header class="import-row__head">
          <label class="import-row__include"><input type="checkbox" data-include="${esc(row.key)}" ${excluded.has(row.key) ? "" : "checked"}> Include</label>
          <span class="import-row__source">${esc(row.source.sheet)} row ${esc(row.source.row)}</span>
          ${badge(matchState(row), tone)}
          ${row.action !== "needs_review" ? `<span class="muted-text">${esc(String(row.action).replace(/_/g, " "))}</span>` : ""}
        </header>
        ${memberMatch(row.key, memberView(row))}
        ${unitLine}
        ${otherIssues.length ? `<ul class="import-row__issues">${otherIssues.map((issue: string) => `<li>${esc(issue)}</li>`).join("")}</ul>` : ""}
        ${row.warnings.length ? `<p class="member-match__warn">${row.warnings.map(esc).join(" · ")}</p>` : ""}
        <div class="import-row__actions">
          ${admin ? `<button type="button" class="quiet-button btn-sm" data-create-member="${esc(row.key)}">Create new member</button>` : ""}
          ${row.after.person_id || value.person_id ? `<button type="button" class="quiet-button btn-sm" data-repeat-member="${esc(row.key)}">Use this member for every “${esc(row.values.member_name)}” row</button>` : ""}
          <label class="checkbox-line"><input type="checkbox" data-row="${esc(row.key)}" data-field="remember_person_alias" ${admin ? "" : "disabled"} ${value.remember_person_alias ? "checked" : ""}> Remember this spelling${admin ? "" : " (administrator only)"}</label>
        </div>
        <details class="import-row__edit">
          <summary>Edit row</summary>
          <div class="import-row__fields">
            <label>Find member<input type="search" data-find-member="${esc(row.key)}" placeholder="Name, call level or designation"></label>
            <label>Member<select data-row="${esc(row.key)}" data-field="person_id"><option value="">Select member</option>${memberOptions(row, value)}</select></label>
            ${kind === "units"
              ? `<label>Find unit<input type="search" data-find-unit="${esc(row.key)}" placeholder="Unit name or campus"></label>
                 <label>Unit<select data-row="${esc(row.key)}" data-field="unit_id"><option value="">No unit / select unit</option>${unitOptions(row, value)}</select></label>
                 ${admin ? `<button type="button" class="quiet-button btn-sm" data-create-unit="${esc(row.key)}">Create unit</button>` : ""}
                 <label>Posting / call type<input data-row="${esc(row.key)}" data-field="posting_type" value="${esc(value.posting_type)}"></label>
                 <label class="checkbox-line"><input type="checkbox" data-row="${esc(row.key)}" data-field="remember_unit_alias" ${admin ? "" : "disabled"} ${value.remember_unit_alias ? "checked" : ""}> Remember this unit label${admin ? "" : " (administrator only)"}</label>
                 <button type="button" class="quiet-button btn-sm" data-repeat-unit="${esc(row.key)}">Use this unit for repeated labels</button>`
              : ["leave_type", "leave_slot", "status"].map((field) => `<label>${esc(field.replace(/_/g, " "))}<input data-row="${esc(row.key)}" data-field="${field}" value="${esc(value[field])}"></label>`).join("")}
            <label>Start date<input data-row="${esc(row.key)}" data-field="starts_on" value="${esc(value.starts_on)}" placeholder="YYYY-MM-DD"></label>
            <label>End date<input data-row="${esc(row.key)}" data-field="ends_on" value="${esc(value.ends_on)}" placeholder="YYYY-MM-DD"></label>
          </div>
          <dl class="import-row__changes">${(row.normalizations || []).map((change: Row) => `<dt>${esc(change.field.replace(/_/g, " "))}</dt><dd>${esc(change.original || "Blank")} → ${esc(change.proposed || "Blank")} <small>${esc(change.reason)}</small></dd>`).join("")}</dl>
          ${row.person_match.candidates?.length ? `<div class="registry-actions">${row.person_match.candidates.map((c: Row) => `<button type="button" class="quiet-button btn-sm" data-review-candidate="${esc(c.id)}">${c.status === "active" ? "Open profile:" : "Review / restore"} ${esc(c.name)}</button>`).join("")}</div>` : ""}
        </details>
      </article>`;
    };
    const blocker = () =>
      previewDirty
        ? "Your changes need a refreshed preview before applying."
        : applyBlocker(
            preview!.rows.map((r) => ({ key: r.key, issues: r.issues, label: `row ${r.source.row} “${r.values.member_name ?? ""}”` })),
            excluded,
          );
    root.innerHTML = `<h3>Resolve and review</h3>${groupedSummary}<p data-review-counts class="review-counts">${reviewCounts()}</p>${preview.mode === "replace_month" ? `<details><summary>${preview.replacement_scope.length} existing records affected by replacement</summary>${preview.replacement_scope.map((r) => `<p>${esc(members.find((m) => m.id === r.person_id)?.canonical_name || r.person_id)} · ${esc(r.starts_on)} to ${esc(r.ends_on || "Ongoing")}</p>`).join("")}</details>` : ""}${shown.map(rowHtml).join("")}<div class="pager" ${preview.rows.length <= 25 ? "hidden" : ""}><button type="button" class="icon-button btn-sm" data-page="-1" ${page === 0 ? "disabled" : ""}>Previous rows</button><span>Page ${page + 1} of ${Math.ceil(preview.rows.length / 25)}</span><button type="button" class="icon-button btn-sm" data-page="1" ${(page + 1) * 25 >= preview.rows.length ? "disabled" : ""}>Next rows</button></div><label class="checkbox-line"><input type="checkbox" data-acknowledge> I reviewed the affected duties and replacement scope</label><div class="registry-actions import-apply-bar"><button type="button" class="icon-button" data-refresh>Refresh normalized preview</button><button type="button" class="quiet-button" data-report>Download row report</button><button type="button" class="primary" data-apply ${previewDirty ? 'aria-disabled="true"' : ""}>Apply reviewed rows</button></div><p class="import-apply-blocker" data-apply-blocker role="status">${esc(blocker())}</p><p data-apply-status role="status" aria-live="polite"></p>`;
    // One-click member choice: save it and re-run the preview so the row is checked again.
    root.querySelectorAll<HTMLButtonElement>("[data-pick-member]").forEach(
      (button) =>
        (button.onclick = () => {
          (corrections[button.dataset.pickRow!] ??= {}).person_id = button.dataset.pickMember!;
          dirtyPreview(false);
          void runPreview(button);
        }),
    );
    root.querySelectorAll<HTMLButtonElement>("[data-review-candidate]").forEach(
      (button) =>
        (button.onclick = () => {
          const candidate = members.find(
            (member) => member.id === button.dataset.reviewCandidate,
          );
          void openMemberWorkspace(
            button.dataset.reviewCandidate!,
            admin,
            (member) => {
              members = members.map((existing) =>
                existing.id === member.id ? member : existing,
              );
              renderReview();
              dirtyPreview();
            },
            [],
            "details",
            candidate?.active_status !== "active" && admin
              ? "active"
              : undefined,
          );
        }),
    );
    root
      .querySelectorAll<HTMLInputElement>(
        "[data-find-member], [data-find-unit]",
      )
      .forEach(
        (input) =>
          (input.oninput = () => {
            const key = input.dataset.findMember || input.dataset.findUnit!;
            const field = input.dataset.findMember ? "person_id" : "unit_id";
            const select = Array.from(
              root.querySelectorAll<HTMLSelectElement>("select[data-row]"),
            ).find(
              (el) => el.dataset.row === key && el.dataset.field === field,
            );
            const query = input.value.toLowerCase();
            if (select)
              Array.from(select.options).forEach(
                (option) =>
                  (option.hidden = Boolean(
                    option.value &&
                    !option.selected &&
                    !option.text.toLowerCase().includes(query),
                  )),
              );
          }),
      );
    root
      .querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-row]")
      .forEach(
        (input) =>
          (input.onchange = () => {
            (corrections[input.dataset.row!] ??= {})[input.dataset.field!] =
              input instanceof HTMLInputElement && input.type === "checkbox"
                ? input.checked
                : input.value;
            dirtyPreview();
          }),
      );
    root.querySelectorAll<HTMLInputElement>("[data-include]").forEach(
      (input) =>
        (input.onchange = () => {
          if (input.checked) excluded.delete(input.dataset.include!);
          else excluded.add(input.dataset.include!);
          root.querySelector("[data-review-counts]")!.textContent =
            reviewCounts();
          dirtyPreview();
          const note = root.querySelector("[data-apply-blocker]");
          if (note) note.textContent = blocker();
        }),
    );
    root.querySelectorAll<HTMLButtonElement>("[data-page]").forEach(
      (b) =>
        (b.onclick = () => {
          if (b.disabled) return;
          const restoreFocus = retainActionFocus(dialog, b, () =>
            root.querySelector<HTMLButtonElement>(`[data-page="${b.dataset.page}"]:not(:disabled)`)
            ?? root.querySelector<HTMLButtonElement>('[data-page]:not(:disabled)'));
          page += Number(b.dataset.page);
          renderReview();
          restoreFocus(dialog.open);
        }),
    );
    root
      .querySelector("[data-refresh]")!
      .addEventListener("click", event => void runPreview(event.currentTarget as HTMLElement));
    root.querySelectorAll<HTMLButtonElement>("[data-create-member]").forEach(
      (button) =>
        (button.onclick = () => {
          const row = preview!.rows.find(
            (r) => r.key === button.dataset.createMember,
          )!;
          void createMemberInline(row.values.member_name, (member) => {
            members.push(member);
            (corrections[row.key] ??= {}).person_id = member.id;
            renderReview();
            dirtyPreview();
          });
        }),
    );
    root.querySelectorAll<HTMLButtonElement>("[data-create-unit]").forEach(
      (button) =>
        (button.onclick = () => {
          const key = button.dataset.createUnit!;
          const importFile = file;
          const importPreview = preview;
          const importColumns = columnLoadSequence;
          const current = () => dialog.isConnected && dialog.open
            && file === importFile && preview === importPreview
            && columnLoadSequence === importColumns;
          void openUnitRegistry(
            (unit) => {
              if (!unit || !current()) return;
              (corrections[key] ??= {}).unit_id = unit.id;
              dirtyPreview(false);
              let retry: HTMLButtonElement | undefined;
              let refreshing = false;
              const choiceMessage = (text: string) => {
                if (retry?.isConnected && message.firstChild?.nodeType === Node.TEXT_NODE) {
                  message.firstChild.textContent = text;
                  const status = dialog.querySelector<HTMLElement>("[data-apply-status]");
                  if (status) status.textContent = text;
                } else say(text, false);
              };
              const refreshChoices = async () => {
                if (refreshing || !current()) return;
                refreshing = true;
                retry?.setAttribute("aria-disabled", "true");
                choiceMessage("Unit created. Refreshing member and unit choices…");
                try {
                  const [loadedMembers, loadedUnits] = await Promise.all([
                    request<DepartmentMember[]>("/api/v1/admin/members"),
                    request<Row[]>("/api/v1/normalization/units"),
                  ]);
                  if (!current()) return;
                  const restoreRow = document.activeElement === button
                    || document.activeElement === retry;
                  members = loadedMembers;
                  units = loadedUnits;
                  renderReview();
                  say("Unit created and selected for this row. Refresh the normalized preview before applying.", false);
                  if (restoreRow) {
                    const summary = dialog.querySelector<HTMLElement>(`[data-review-row="${CSS.escape(key)}"] summary`);
                    summary?.focus({ preventScroll: true });
                    summary?.scrollIntoView({ block: "nearest", behavior: "instant" });
                  }
                } catch (error) {
                  if (!current()) return;
                  const restoreRetry = document.activeElement === button
                    || document.activeElement === retry;
                  choiceMessage(`Unit created. Member and unit choices could not refresh. ${error instanceof Error ? error.message : "Please retry."}`);
                  retry ??= document.createElement("button");
                  retry.type = "button";
                  retry.className = "quiet-button";
                  retry.dataset.retryUnitOptions = "";
                  retry.textContent = "Retry member and unit choices";
                  retry.onclick = () => void refreshChoices();
                  if (!retry.isConnected) message.append(retry);
                  if (restoreRetry) {
                    retry.focus({ preventScroll: true });
                    message.scrollIntoView({ block: "nearest", behavior: "instant" });
                  }
                } finally {
                  refreshing = false;
                  retry?.removeAttribute("aria-disabled");
                }
              };
              void refreshChoices();
            },
            undefined,
            true,
          );
        }),
    );
    root
      .querySelectorAll<HTMLButtonElement>(
        "[data-repeat-member],[data-repeat-unit]",
      )
      .forEach(
        (button) =>
          (button.onclick = () => {
            const member = Boolean(button.dataset.repeatMember);
            const key =
              button.dataset.repeatMember || button.dataset.repeatUnit!;
            const row = preview!.rows.find((r) => r.key === key)!;
            const selected =
              (corrections[key] || {})[member ? "person_id" : "unit_id"] ||
              row.after[member ? "person_id" : "unit_id"];
            if (!selected) {
              say("Select a member or unit first.");
              return;
            }
            if (
              !confirm(
                "Apply this selection to repeated occurrences of the same raw label in this file?",
              )
            )
              return;
            const raw = member ? row.values.member_name : row.values.unit_name;
            preview!.rows
              .filter(
                (r) =>
                  (member ? r.values.member_name : r.values.unit_name) === raw,
              )
              .forEach(
                (r) =>
                  ((corrections[r.key] ??= {})[
                    member ? "person_id" : "unit_id"
                  ] = selected),
              );
            dirtyPreview();
          }),
      );
    const downloadReport = () => {
      const cell = (v: unknown) =>
        `"${String(v ?? "")
          .replace(/^[\s]*[=+@-]|^[\t\r\n]/, "'$&")
          .replace(/"/g, '""')}"`;
      const content = [
        [
          "sheet",
          "row",
          "name",
          "action",
          "issues",
          "warnings",
          "original_values",
          "proposed_values",
          "excluded",
        ],
        ...preview!.rows.map((r) => [
          r.source.sheet,
          r.source.row,
          r.values.member_name,
          r.action,
          r.issues.join("; "),
          r.warnings.join("; "),
          JSON.stringify(r.original),
          JSON.stringify(r.after),
          excluded.has(r.key) ? "Yes" : "No",
        ]),
      ]
        .map((r) => r.map(cell).join(","))
        .join("\r\n");
      const url = URL.createObjectURL(
        new Blob(["\ufeff", content], { type: "text/csv;charset=utf-8" }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = `${kind}-normalization-report.csv`;
      a.click();
      URL.revokeObjectURL(url);
    };
    root
      .querySelector("[data-report]")!
      .addEventListener("click", downloadReport);
    root.querySelector("[data-apply]")!.addEventListener("click", async event => {
      if (busy) return say("An import action is still running…");
      if (previewDirty)
        return say(
          "Changes need a refreshed preview before applying. Click “Refresh normalized preview”.",
        );
      const acknowledge = (
        root.querySelector("[data-acknowledge]") as HTMLInputElement
      ).checked;
      const selected = preview!.rows.filter((r) => !excluded.has(r.key));
      const blocked = selected.filter((r) => r.issues.length);
      if (!selected.length) return say("Select at least one row to apply.");
      if (blocked.length)
        return say(
          `${blocked.length} included row(s) still need review (e.g. row ${blocked[0].source.row}: ${blocked[0].issues[0]}). Fix them or untick “Include”, then refresh the preview.`,
        );
      if (preview!.mode === "replace_month" && !acknowledge)
        return say(
          "Tick “I reviewed the affected duties and replacement scope” first.",
        );
      if (selected.some((r) => r.warnings.length) && !acknowledge)
        return say(
          "Some rows affect existing duties. Tick “I reviewed the affected duties and replacement scope” first.",
        );
      if (
        !confirm(
          `Apply ${selected.length} reviewed rows for ${preview!.month}?`,
        )
      )
        return;
      const appliedPreview = preview!;
      const appliedFile = file;
      const appliedVersion = draftVersion;
      const applyPayload = JSON.stringify({
        excluded: [...excluded],
        acknowledge_warnings: acknowledge,
      });
      const ownsApply = () => dialog.isConnected && dialog.open && preview === appliedPreview
        && file === appliedFile && draftVersion === appliedVersion;
      const restoreApplyFocus = retainActionFocus(dialog, event.currentTarget as HTMLElement,
        () => dialog.querySelector<HTMLElement>("[data-apply], [data-download-completed-report]"));
      busy = true;
      // A delayed inspection must not replace locked controls or apply feedback.
      columnLoadSequence++;
      const unlock = lockWorkspaceControls(dialog);
      say("Applying reviewed rows…");
      try {
        const result = await request<Row>(
          `/api/v1/import-review/${appliedPreview.id}/apply`,
          {
            method: "POST",
            body: applyPayload,
          },
        );
        if (!ownsApply()) return;
        finished = true;
        setStep(IMPORT_STEPS.length);
        root.innerHTML = `<h3>Import complete</h3><p>${result.created} created · ${result.updated} updated · ${result.unchanged} unchanged · ${result.excluded} excluded · ${result.removed} previous records replaced</p><p>Batch ${esc(result.batch_id)}</p><button type="button" data-download-completed-report>Download applied / excluded row report</button>`;
        root
          .querySelector("[data-download-completed-report]")!
          .addEventListener("click", downloadReport);
        updated();
      } catch (error) {
        if (ownsApply()) say((error as Error).message);
      } finally {
        unlock();
        busy = false;
        restoreApplyFocus(ownsApply());
      }
    });
  }
}
