import { openReferenceCatalog } from "./reference-workspace";
import { openRecordEditor } from "./record-workspace";
import { request, type DepartmentMember } from "./services/api";

const esc = (value: unknown) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const labels: Record<string, string> = {
  overview: "Overview",
  details: "Details",
  roles: "Roles & eligibility",
  postings: "Postings",
  leave: "Leave",
  duties: "Duty history",
  names: "Names & duplicates",
  activity: "Activity",
};
const levels = [
  "1ST_CALL",
  "2ND_CALL",
  "3RD_CALL",
  "CO_4TH_CALL",
  "4TH_CALL",
  "5TH_CALL",
  "PAIN",
  "SICU",
  "DRP",
  "NEURO_ICU",
];
const callLabel = (value: unknown): string =>
  ({
    "1ST_CALL": "1st Call",
    "2ND_CALL": "2nd Call",
    "3RD_CALL": "3rd Call",
    CO_4TH_CALL: "Co 4th Call",
    "4TH_CALL": "4th Call",
    "5TH_CALL": "5th Call",
  })[String(value)] || String(value || "Unassigned").replace(/_/g, " ");
const statusLabel = (value: unknown) =>
  String(value || "Unknown")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
const periodLabel = (from: string, until?: string | null) => {
  const today = new Date().toLocaleDateString("en-CA");
  return from > today
    ? "Upcoming"
    : until && until < today
      ? "Past"
      : "Current";
};
type Row = Record<string, unknown>;
type Profile = { member: DepartmentMember; impact: Record<string, number> };

export function workspaceDialog(
  title: string,
  className = "",
): HTMLDialogElement {
  const opener = document.activeElement as HTMLElement | null;
  const dialog = document.createElement("dialog");
  dialog.className = `member-workspace ${className}`;
  dialog.setAttribute("aria-label", title);
  document.body.append(dialog);
  const fitViewport = () => {
    if (
      window.matchMedia("(max-width:700px)").matches &&
      window.visualViewport
    ) {
      dialog.style.height = `${window.visualViewport.height}px`;
      dialog.style.maxHeight = `${window.visualViewport.height}px`;
      dialog.style.top = `${window.visualViewport.offsetTop}px`;
    } else {
      dialog.style.removeProperty("height");
      dialog.style.removeProperty("max-height");
      dialog.style.removeProperty("top");
    }
    dialog
      .querySelector("[role=tablist]")
      ?.setAttribute(
        "aria-orientation",
        window.matchMedia("(max-width:700px)").matches
          ? "horizontal"
          : "vertical",
      );
  };
  window.visualViewport?.addEventListener("resize", fitViewport);
  window.visualViewport?.addEventListener("scroll", fitViewport);
  window.addEventListener("resize", fitViewport);
  dialog.addEventListener(
    "close",
    () => {
      window.visualViewport?.removeEventListener("resize", fitViewport);
      window.visualViewport?.removeEventListener("scroll", fitViewport);
      window.removeEventListener("resize", fitViewport);
      if (opener?.isConnected) opener.focus();
    },
    { once: true },
  );
  dialog.addEventListener("keydown", (e) => {
    if (e.key === "Escape") e.stopPropagation();
  });
  dialog.showModal();
  fitViewport();
  return dialog;
}

export async function openMemberWorkspace(
  id: string,
  admin: boolean,
  changed: (member: DepartmentMember) => void,
  ids: string[] = [],
  initialTab = "overview",
  proposedStatus?: string,
) {
  const opener = document.activeElement as HTMLElement | null;
  const dialog = workspaceDialog("Member profile");
  dialog.innerHTML = `<p role="status">Loading member profile…</p>`;
  let profile: Profile;
  try {
    profile = await request<Profile>(`/api/v1/admin/member-workspace/${id}`);
  } catch (error) {
    dialog.innerHTML = `<p role="alert">${esc((error as Error).message)}</p><button data-dismiss>Close</button>`;
    dialog.querySelector("button")!.onclick = () => {
      dialog.close();
      dialog.remove();
      opener?.focus();
    };
    return;
  }
  let member = profile.member;
  let draft = structuredClone(member);
  let tab = initialTab;
  let editing = Boolean(proposedStatus && admin);
  if (proposedStatus && admin) draft.active_status = proposedStatus;
  let busy = false;
  let preservePreviousName = true;
  const fieldErrors: Record<string, string> = {};
  const cache: Record<string, Row[] | undefined> = {};
  const errors: Record<string, string> = {};
  let dutyAnalysis: Row | undefined;
  let dutyMonths: string[] = [];
  let dutyFrom = "";
  let dutyUntil = "";
  const dirty = () => JSON.stringify(draft) !== JSON.stringify(member);

  function validateDraft(): boolean {
    Object.keys(fieldErrors).forEach((key) => delete fieldErrors[key]);
    if (!draft.canonical_name?.trim())
      fieldErrors.canonical_name = "Enter the member’s name.";
    if (draft.canonical_name?.length > 255)
      fieldErrors.canonical_name = "Use at most 255 characters.";
    draft.designations.forEach((d, i) => {
      if (!d.designation?.trim())
        fieldErrors[`designation-${i}`] = "Enter a designation.";
      else if (!/^\d{4}-\d{2}-\d{2}$/.test(d.effective_from || ""))
        fieldErrors[`designation-${i}`] =
          "Choose the designation’s start date.";
      else if (d.effective_to && d.effective_to < d.effective_from)
        fieldErrors[`designation-${i}`] =
          "The end date must be on or after the start date.";
    });
    const ordered = draft.designations
      .map((d, i) => ({ ...d, index: i }))
      .sort((a, b) =>
        (a.effective_from || "").localeCompare(b.effective_from || ""),
      );
    ordered.forEach((d, i) => {
      if (
        i &&
        (ordered[i - 1].effective_to || "9999-12-31") >= d.effective_from
      )
        fieldErrors[`designation-${d.index}`] =
          "This position overlaps the previous one. End the previous position first.";
    });
    const dates = new Set<string>();
    (draft.call_level_changes || []).forEach((c, i) => {
      if (!c.effective_from || dates.has(c.effective_from))
        fieldErrors[`call-${i}`] =
          "Choose a unique effective date for this change.";
      dates.add(c.effective_from);
    });
    if (!Object.keys(fieldErrors).length) return true;
    const first = Object.keys(fieldErrors)[0];
    tab = first === "canonical_name" ? "details" : "roles";
    render();
    const field =
      first === "canonical_name"
        ? dialog.querySelector<HTMLInputElement>("[data-field=canonical_name]")
        : first.startsWith("call-")
          ? dialog.querySelector<HTMLInputElement>(
              `[data-call-change="${first.slice(5)}"][data-key=effective_from]`,
            )
          : dialog.querySelector<HTMLInputElement>(
              `[data-d="${first.slice(12)}"]`,
            );
    field?.focus();
    field?.scrollIntoView({ block: "nearest" });
    return false;
  }
  const close = () => {
    if (busy || (dirty() && !confirm("Discard unsaved member changes?")))
      return;
    dialog.close();
    dialog.remove();
    if (opener?.isConnected) opener.focus();
    else
      document
        .querySelector<HTMLElement>("#member-search, main button, nav button")
        ?.focus();
  };
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    close();
  });
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) {
      const r = dialog.getBoundingClientRect();
      const e = event as MouseEvent;
      if (
        e.clientX < r.left ||
        e.clientX > r.right ||
        e.clientY < r.top ||
        e.clientY > r.bottom
      )
        close();
    }
  });
  const unload = (e: BeforeUnloadEvent) => {
    if (dirty()) e.preventDefault();
  };
  window.addEventListener("beforeunload", unload);
  dialog.addEventListener(
    "close",
    () => window.removeEventListener("beforeunload", unload),
    { once: true },
  );

  function designationEditor() {
    return `<div class="mw-timeline">${draft.designations.map((d, i) => `<fieldset data-designation-row="${i}"><legend>Position ${i + 1}</legend><label>Designation<input data-d="${i}" data-key="designation" required maxlength="100" value="${esc(d.designation)}"></label><label>From<input type="date" required data-d="${i}" data-key="effective_from" value="${esc(d.effective_from)}"></label><label>Until (optional)<input type="date" data-d="${i}" data-key="effective_to" value="${esc(d.effective_to)}"></label><label>Notes<input data-d="${i}" data-key="notes" value="${esc(d.notes)}"></label><button type="button" data-remove-designation="${i}">Remove position</button></fieldset>`).join("")}</div><button type="button" data-add-designation-row>Add position</button>`;
  }

  function scheduledCalls() {
    const changes = draft.call_level_changes || [];
    return `<h3>Dated default call-level changes</h3><p>A dated change overrides the base default from its effective date. Monthly postings still take precedence.</p>${changes.map((c, i) => `<fieldset><legend>Call-level change ${i + 1}</legend><label>Call level<select data-call-change="${i}" data-key="call_level" ${editing ? "" : "disabled"}>${[...new Set([...levels, c.call_level])].map((level) => `<option ${level === c.call_level ? "selected" : ""} value="${esc(level)}">${esc(callLabel(level))}</option>`).join("")}</select></label><label>Effective from<input type="date" data-call-change="${i}" data-key="effective_from" value="${esc(c.effective_from)}" ${editing ? "" : "readonly"}></label><label>Notes<input maxlength="1000" data-call-change="${i}" data-key="notes" value="${esc(c.notes)}" ${editing ? "" : "readonly"}></label>${editing ? `<button type="button" data-remove-call-change="${i}">Remove dated change</button>` : ""}</fieldset>`).join("")}${editing ? `<button type="button" data-add-call-change>Add dated call-level change</button>` : changes.length ? "" : "<p>No dated changes recorded.</p>"}`;
  }
  function detailedAnalysis() {
    if (!dutyAnalysis) return "";
    const days = (dutyAnalysis.day_breakdown || {}) as Row;
    const calls = (dutyAnalysis.call_levels || {}) as Row;
    const units = (dutyAnalysis.units || {}) as Row;
    const promotions = (dutyAnalysis.promotions || []) as Row[];
    return `<details><summary>Day-of-week breakdown</summary><dl>${Object.entries(
      days,
    )
      .map(([day, count]) => `<dt>${esc(day)}</dt><dd>${esc(count)}</dd>`)
      .join(
        "",
      )}</dl></details><details><summary>Monthly call levels and units</summary>${dutyMonths.map((month) => `<p>${esc(month)} &middot; ${esc(callLabel(calls[month]))} &middot; ${esc(units[month] || "Unit not recorded")}</p>`).join("")}${promotions.map((change) => `<p>${esc(change.month)}: ${esc(callLabel(change.from))} to ${esc(callLabel(change.to))}</p>`).join("")}</details><details><summary>Special postings</summary>${[
      "pain_months",
      "sicu_months",
      "drp_months",
      "neuro_icu_months",
    ]
      .map(
        (key) =>
          `<p>${esc(
            key
              .replace(/_months$/, "")
              .replace(/_/g, " ")
              .toUpperCase(),
          )}: ${esc(((dutyAnalysis![key] || []) as string[]).join(", ") || "None recorded")}</p>`,
      )
      .join("")}</details>`;
  }

  function history() {
    if (errors[tab])
      return `<p role="alert">${esc(errors[tab])}</p><button type="button" data-retry>Retry</button>`;
    if (!cache[tab]) return `<p role="status">Loading ${esc(labels[tab])}…</p>`;
    if (tab === "activity")
      return cache.activity!.length
        ? cache
            .activity!.map((row) => {
              const details = (row.details || {}) as Row;
              const original = (details.before || {}) as Row;
              const before = (original.target || original) as Row;
              const after = (details.after || {}) as Row;
              const changed = Object.keys(after).filter(
                (key) =>
                  JSON.stringify(before[key]) !== JSON.stringify(after[key]),
              );
              const describe = (value: unknown): string => {
                if (value == null || value === "") return "Not set";
                if (Array.isArray(value))
                  return (
                    value
                      .map((item) =>
                        Array.isArray(item)
                          ? item
                              .slice(1)
                              .filter((v) => v != null)
                              .join(" · ")
                          : String(item),
                      )
                      .join("; ") || "None"
                  );
                return typeof value === "string"
                  ? value.replace(/_/g, " ")
                  : String(value);
              };
              return `<article class="mw-history"><strong>${esc(String(row.action).replace(/_/g, " "))}</strong><p>${esc(row.operator)} · <time datetime="${esc(row.created_at)}">${esc(new Date(String(row.created_at)).toLocaleString())}</time></p><dl>${changed.map((key) => `<dt>${esc(key.replace(/_/g, " "))}</dt><dd>${esc(describe(before[key]))} → ${esc(describe(after[key]))}</dd>`).join("")}</dl>${details.batch_id ? `<p>Import batch ${esc(details.batch_id)}</p>` : ""}</article>`;
            })
            .join("")
        : "<p>No changes recorded yet.</p>";
    const rows = cache[tab]!.filter(
      (row) =>
        tab !== "duties" ||
        ((!dutyFrom || String(row.date) >= dutyFrom) &&
          (!dutyUntil || String(row.date) <= dutyUntil)),
    );
    const analysis =
      tab === "duties" && dutyAnalysis
        ? `<h3>Official analysis · ${esc(dutyMonths[0])} to ${esc(dutyMonths[dutyMonths.length - 1])}</h3><p>Historical, approved, published and finalized periods. Draft duties appear separately below.</p><div class="mw-summary">${Object.entries(
            dutyAnalysis,
          )
            .filter(
              ([key, value]) =>
                typeof value === "number" && !key.endsWith("_id"),
            )
            .map(
              ([key, value]) =>
                `<article><small>${esc(key.replace(/_/g, " "))}</small><strong>${esc(value)}</strong></article>`,
            )
            .join("")}</div><h3>Monthly 24-hour duties</h3>${Object.entries(
            (dutyAnalysis.monthly_24hr ?? {}) as Row,
          )
            .map(
              ([month, count]) =>
                `<p>${esc(month)} <strong>${esc(count)}</strong></p>`,
            )
            .join("")}${detailedAnalysis()}<h3>Duty records</h3>`
        : "";
    const filter =
      tab === "duties"
        ? `<div class="mw-date-filter"><label>From date<input type="date" data-duty-from value="${esc(dutyFrom)}"></label><label>Until date<input type="date" data-duty-until value="${esc(dutyUntil)}"></label></div>`
        : "";
    return (
      analysis +
      filter +
      (rows.length
        ? rows
            .map(
              (row) =>
                `<article class="mw-history">${row.starts_on || row.effective_from ? `<span class="mw-period-badge">${periodLabel(String(row.starts_on || row.effective_from), (row.ends_on || row.effective_to) as string | null)}</span>` : ""}<dl>${Object.entries(
                  row,
                )
                  .filter(([key]) => key !== "id")
                  .map(
                    ([key, value]) =>
                      `<div><dt>${esc(key.replace(/_/g, " "))}</dt><dd>${typeof value === "object" && value !== null ? `<pre>${esc(JSON.stringify(value, null, 2))}</pre>` : esc(key === "call_level" || key === "posting_type" ? callLabel(value) : ["type", "slot", "source", "status"].includes(key) ? statusLabel(value) : typeof value === "boolean" ? (value ? "Yes" : "No") : (value ?? "Ongoing"))}</dd></div>`,
                  )
                  .join(
                    "",
                  )}</dl>${["postings", "leave"].includes(tab) ? `<button type="button" data-edit-record="${esc(row.id)}">Edit ${tab === "postings" ? "posting" : "leave"}</button>${tab === "leave" && row.status !== "cancelled" ? `<button type="button" data-cancel-profile-leave="${esc(row.id)}">Cancel leave</button>` : ""}` : ""}</article>`,
            )
            .join("")
        : `<p class="empty-state">No ${esc(labels[tab].toLowerCase())} records in this range.</p>`)
    );
  }
  function content() {
    const today = new Date().toLocaleDateString("en-CA");
    const current = member.designations
      .filter(
        (d) =>
          d.effective_from <= today &&
          (!d.effective_to || d.effective_to >= today),
      )
      .slice(-1)[0];
    if (tab === "overview")
      return `<div class="mw-summary"><article><small>Current position</small><strong>${esc(current?.designation || "Missing designation")}</strong></article><article><small>Default call level</small><strong>${esc(callLabel(member.effective_call_level || member.call_level))}</strong></article><article><small>Membership</small><strong>${esc(statusLabel(member.active_status))}</strong></article></div><h3>Needs attention</h3>${!current ? `<button type="button" data-tab-link="roles">Add or correct designation</button>` : ""}${!(member.effective_call_level || member.call_level) ? `<button type="button" data-tab-link="details">Assign a default call level</button>` : ""}${current && (member.effective_call_level || member.call_level) ? "<p>No missing designation or call level.</p>" : ""}<h3>Identity checks</h3><button type="button" data-tab-link="names">Review aliases and possible duplicates</button><h3>Linked records</h3><p>${esc(profile.impact.future_duties)} future duties · ${esc(profile.impact.current_or_future_postings)} current/upcoming postings · ${esc(profile.impact.eligibility_memberships)} eligibility memberships</p><p>Monthly postings may override this member’s default call level. Review the relevant month in Postings.</p>`;
    if (tab === "details")
      return `<label>Member ID<input readonly data-member-id value="${esc(member.id)}"></label><button type="button" data-copy-member-id>Copy member ID</button><label>Member name<input data-field="canonical_name" required maxlength="255" value="${esc(draft.canonical_name)}" ${!editing ? "readonly" : ""}></label>${editing ? `<label><input type="checkbox" data-preserve-name ${preservePreviousName ? "checked" : ""}> Keep the previous name as an alias when renaming</label>` : ""}<label>Membership status<select data-field="active_status" ${!editing ? "disabled" : ""}>${["active", "historical", "archived"].map((s) => `<option ${draft.active_status === s ? "selected" : ""}>${s}</option>`).join("")}</select></label><label>Base default call level<select data-field="call_level" ${!editing ? "disabled" : ""}><option value="">Unassigned</option>${[...new Set([...levels, ...(draft.call_level ? [draft.call_level] : [])])].map((s) => `<option value="${esc(s)}" ${draft.call_level === s ? "selected" : ""}>${esc(callLabel(s))}</option>`).join("")}</select></label><p>Changing status preserves historical records. Future duties and memberships remain linked and need review.</p>`;
    if (tab === "roles")
      return `${admin ? `<button type="button" data-manage-profile-references>Manage designations and aliases</button>` : ""}<h3>Designation history</h3>${editing ? designationEditor() : member.designations.map((d) => `<article class="mw-history"><strong>${esc(d.designation)}</strong><span class="mw-period-badge">${periodLabel(d.effective_from, d.effective_to)}</span><p>${esc(d.effective_from)} → ${esc(d.effective_to || "Ongoing")} · ${esc(d.source)}</p><p>${esc(d.notes)}</p></article>`).join("") || "<p>No designation recorded.</p>"}${scheduledCalls()}<h3>Eligibility groups</h3><p>Groups restrict particular duties within a call level. Membership does not override approved leave, posting dates or rest requirements.</p>${history()}`;
    if (tab === "names")
      return `<p>Aliases connect imported spellings to this member. Previous names are preserved by default when renaming.</p>${editing ? `${draft.aliases.map((a, i) => `<div class="mw-alias-row"><span>${esc(a.alias)}</span><button type="button" data-remove-alias="${i}" aria-label="Remove alias ${esc(a.alias)}">Remove</button></div>`).join("")}<label>Aliases (one per line)<textarea data-aliases rows="7">${esc(draft.aliases.map((a) => a.alias).join("\n"))}</textarea></label>` : member.aliases.map((a) => `<article class="mw-history"><strong>${esc(a.alias)}</strong><small>${esc(a.source)}</small></article>`).join("") || "<p>No aliases recorded.</p>"}<h3>Possible duplicates</h3>${cache.duplicates ? (cache.duplicates.length ? cache.duplicates.map((r) => `<article class="mw-history"><strong>${esc(r.name)}</strong><p>${esc(statusLabel(r.status))} \u00b7 ${esc(callLabel(r.call_level))}</p><p>${esc(r.duties)} duties \u00b7 ${esc(r.postings)} postings \u00b7 ${esc(r.leave)} leave records \u00b7 ${esc(r.memberships)} memberships</p><p>Positions: ${esc((r.designations as string[]).join(", "))}</p>${r.member ? `<details><summary>Compare profile details</summary><p>Surviving member: ${esc(member.canonical_name)} \u00b7 ${esc(statusLabel(member.active_status))} \u00b7 ${esc(callLabel(member.call_level))}</p><p>Surviving aliases: ${esc(member.aliases.map((a) => a.alias).join(", ") || "None")}</p><p>Other member aliases: ${esc((r.member as DepartmentMember).aliases.map((a) => a.alias).join(", ") || "None")}</p><h4>Other member's designation history</h4>${(r.member as DepartmentMember).designations.map((d) => `<p>${esc(d.designation)} \u00b7 ${esc(d.effective_from)} to ${esc(d.effective_to || "Ongoing")} \u00b7 ${esc(d.notes)}</p>`).join("") || "<p>No positions recorded.</p>"}<h4>Other member's dated call levels</h4>${((r.member as DepartmentMember).call_level_changes || []).map((c) => `<p>${esc(callLabel(c.call_level))} from ${esc(c.effective_from)}</p>`).join("") || "<p>No dated changes.</p>"}</details>` : ""}${admin ? `<button type="button" data-merge-source="${esc(r.id)}">Merge into ${esc(member.canonical_name)}</button>` : ""}</article>`).join("") : "<p>No duplicate candidates found.</p>") : errors.duplicates ? `<p role="alert">${esc(errors.duplicates)}</p><button type="button" data-retry-duplicates>Retry duplicate check</button>` : "<p>Checking duplicate identities\u2026</p>"}`;
    if (tab === "postings")
      return `<button type="button" class="primary" data-add-record>Add Posting</button><p>Dated postings determine monthly unit and call-level overrides. Base department default: ${esc(callLabel(member.call_level))}.</p>${history()}`;
    if (tab === "leave")
      return `<button type="button" class="primary" data-add-record>Add Leave</button><p>Approved leave blocks availability. Requested or imported pending leave needs review; cancelled leave does not block duties.</p>${history()}`;
    return history();
  }
  function render() {
    const today = new Date().toLocaleDateString("en-CA");
    const position =
      member.designations
        .filter(
          (d) =>
            d.effective_from <= today &&
            (!d.effective_to || d.effective_to >= today),
        )
        .slice(-1)[0]?.designation || "Position not recorded";
    const focused = document.activeElement as HTMLElement | null;
    const focusAttrs =
      focused && dialog.contains(focused)
        ? Object.entries(focused.dataset).map(
            ([key, value]) =>
              `data-${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}="${CSS.escape(value || "")}"`,
          )
        : [];
    dialog.innerHTML = `<header class="mw-header"><div><small>Department member</small><h2>${esc(member.canonical_name)}</h2><span>${esc(statusLabel(member.active_status))} · ${esc(callLabel(member.effective_call_level || member.call_level))}</span></div><button type="button" data-close aria-label="Close member profile">×</button></header><div class="mw-layout"><nav class="mw-rail" role="tablist" aria-label="Member sections">${Object.entries(
      labels,
    )
      .map(
        ([key, label]) =>
          `<button type="button" role="tab" id="mw-tab-${key}" aria-controls="mw-panel" aria-selected="${tab === key}" tabindex="${tab === key ? 0 : -1}" data-tab="${key}">${label}</button>`,
      )
      .join(
        "",
      )}</nav><form id="mw-form"><section class="mw-content" id="mw-panel" role="tabpanel" aria-labelledby="mw-tab-${tab}" tabindex="0">${content()}</section><div id="mw-error" class="mw-error" role="alert"></div><footer class="mw-footer"><span id="mw-save-status" aria-live="polite">${dirty() ? "Unsaved changes" : editing ? "Editing profile" : ""}</span>${editing ? `<button type="button" data-cancel-edit>Cancel</button><button class="primary" type="submit" ${busy ? "disabled" : ""}>${busy ? "Saving…" : "Save changes"}</button>` : admin ? `<button type="button" data-edit>Edit profile</button>` : `<span>View only</span>`}<button type="button" data-prev ${ids.indexOf(id) <= 0 ? "disabled" : ""}>Previous</button><button type="button" data-next ${ids.indexOf(id) < 0 || ids.indexOf(id) >= ids.length - 1 ? "disabled" : ""}>Next</button></footer></form></div>`;
    dialog.querySelector<HTMLButtonElement>("[data-close]")!.onclick = close;
    dialog.querySelectorAll<HTMLButtonElement>("[data-remove-alias]").forEach(
      (button) =>
        (button.onclick = () => {
          draft.aliases.splice(Number(button.dataset.removeAlias), 1);
          render();
        }),
    );
    dialog
      .querySelector("[data-copy-member-id]")
      ?.addEventListener("click", async (event) => {
        try {
          await navigator.clipboard.writeText(member.id);
          (event.target as HTMLButtonElement).textContent = "Member ID copied";
        } catch {
          dialog.querySelector<HTMLInputElement>("[data-member-id]")?.select();
        }
      });
    dialog
      .querySelector<HTMLInputElement>("[data-preserve-name]")
      ?.addEventListener("change", (event) => {
        preservePreviousName = (event.target as HTMLInputElement).checked;
      });
    for (const [key, message] of Object.entries(fieldErrors)) {
      const field =
        key === "canonical_name"
          ? dialog.querySelector<HTMLInputElement>(
              "[data-field=canonical_name]",
            )
          : key.startsWith("call-")
            ? dialog.querySelector<HTMLInputElement>(
                `[data-call-change="${key.slice(5)}"][data-key=effective_from]`,
              )
            : dialog.querySelector<HTMLInputElement>(
                `[data-d="${key.slice(12)}"]`,
              );
      if (field) {
        const error = document.createElement("span");
        error.id = `mw-error-${key}`;
        error.className = "mw-field-error";
        error.textContent = message;
        field.setAttribute("aria-invalid", "true");
        field.setAttribute("aria-describedby", error.id);
        field.parentElement?.insertAdjacentElement("afterend", error);
      }
    }
    dialog
      .querySelectorAll<HTMLInputElement | HTMLSelectElement>(
        "[data-call-change]",
      )
      .forEach(
        (input) =>
          (input.oninput = () => {
            const change =
              draft.call_level_changes![Number(input.dataset.callChange)];
            (change as unknown as Row)[input.dataset.key!] = input.value;
            status();
          }),
      );
    dialog
      .querySelector("[data-add-call-change]")
      ?.addEventListener("click", () => {
        (draft.call_level_changes ??= []).push({
          call_level: draft.call_level || "1ST_CALL",
          effective_from: "",
          notes: "",
        });
        render();
      });
    dialog
      .querySelectorAll<HTMLButtonElement>("[data-remove-call-change]")
      .forEach(
        (button) =>
          (button.onclick = () => {
            draft.call_level_changes!.splice(
              Number(button.dataset.removeCallChange),
              1,
            );
            render();
          }),
      );
    dialog
      .querySelector<HTMLButtonElement>("[data-manage-profile-references]")
      ?.addEventListener("click", () => {
        void openReferenceCatalog(() => {}, "designation");
      });
    dialog
      .querySelector<HTMLInputElement>("[data-duty-from]")
      ?.addEventListener("change", (e) => {
        dutyFrom = (e.target as HTMLInputElement).value;
        render();
      });
    dialog
      .querySelector<HTMLInputElement>("[data-duty-until]")
      ?.addEventListener("change", (e) => {
        dutyUntil = (e.target as HTMLInputElement).value;
        render();
      });
    dialog
      .querySelector<HTMLButtonElement>("[data-edit]")
      ?.addEventListener("click", () => {
        editing = true;
        if (!["details", "roles", "names"].includes(tab)) tab = "details";
        render();
        dialog.querySelector<HTMLInputElement>("[data-field]")?.focus();
      });
    dialog
      .querySelector("[data-cancel-edit]")
      ?.addEventListener("click", () => {
        if (dirty() && !confirm("Discard unsaved changes?")) return;
        draft = structuredClone(member);
        Object.keys(fieldErrors).forEach((key) => delete fieldErrors[key]);
        editing = false;
        render();
      });
    dialog
      .querySelectorAll<HTMLButtonElement>("[data-tab], [data-tab-link]")
      .forEach(
        (button) =>
          (button.onclick = () => {
            tab = button.dataset.tab || button.dataset.tabLink!;
            render();
            dialog.querySelector<HTMLElement>(`[data-tab="${tab}"]`)?.focus();
            void loadTab();
          }),
      );
    dialog
      .querySelectorAll<HTMLButtonElement>("[data-cancel-profile-leave]")
      .forEach(
        (button) =>
          (button.onclick = async () => {
            if (
              !confirm(
                "Cancel this leave? It will no longer block availability. Existing duties remain assigned and may need review.",
              )
            )
              return;
            button.disabled = true;
            try {
              await request(
                `/api/v1/leave/requests/${button.dataset.cancelProfileLeave}/cancel`,
                { method: "POST" },
              );
              delete cache.leave;
              delete cache.activity;
              await loadTab();
            } catch (error) {
              errors.leave = (error as Error).message;
              render();
            }
          }),
      );
    dialog
      .querySelectorAll<HTMLButtonElement>(
        "[data-add-record], [data-edit-record]",
      )
      .forEach(
        (button) =>
          (button.onclick = () => {
            const key = tab;
            void openRecordEditor(
              key === "postings" ? "units" : "leave",
              id,
              button.dataset.editRecord,
              admin,
              () => {
                delete cache[key];
                delete cache.activity;
                delete errors[key];
                void loadTab();
              },
            );
          }),
      );
    dialog.querySelectorAll<HTMLButtonElement>("[role=tab]").forEach(
      (button) =>
        (button.onkeydown = (e) => {
          const vertical = !window.matchMedia("(max-width:700px)").matches;
          if (vertical && ["ArrowLeft", "ArrowRight"].includes(e.key)) return;
          if (!vertical && ["ArrowUp", "ArrowDown"].includes(e.key)) return;
          const tabs = [
            ...dialog.querySelectorAll<HTMLButtonElement>("[role=tab]"),
          ];
          const n = tabs.indexOf(button);
          if (
            [
              "ArrowDown",
              "ArrowRight",
              "ArrowUp",
              "ArrowLeft",
              "Home",
              "End",
            ].includes(e.key)
          ) {
            e.preventDefault();
            const i =
              e.key === "Home"
                ? 0
                : e.key === "End"
                  ? tabs.length - 1
                  : (n +
                      (e.key === "ArrowDown" || e.key === "ArrowRight"
                        ? 1
                        : -1) +
                      tabs.length) %
                    tabs.length;
            tabs[i].click();
          }
        }),
    );
    dialog
      .querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-field]")
      .forEach(
        (input) =>
          (input.oninput = () => {
            (draft as unknown as Row)[input.dataset.field!] =
              input.value || null;
            status();
          }),
      );
    dialog
      .querySelector<HTMLTextAreaElement>("[data-aliases]")
      ?.addEventListener("input", (e) => {
        draft.aliases = (e.target as HTMLTextAreaElement).value
          .split("\n")
          .filter((a) => a.trim())
          .map((alias) => ({ id: "", alias, source: "manual" }));
        status();
      });
    dialog.querySelectorAll<HTMLInputElement>("[data-d]").forEach(
      (input) =>
        (input.oninput = () => {
          (draft.designations[Number(input.dataset.d)] as unknown as Row)[
            input.dataset.key!
          ] = input.value || null;
          status();
        }),
    );
    dialog
      .querySelector("[data-add-designation-row]")
      ?.addEventListener("click", () => {
        draft.designations.push({
          id: "",
          designation: "",
          effective_from: "",
          effective_to: null,
          source: "manual",
          notes: null,
        });
        render();
      });
    dialog
      .querySelectorAll<HTMLButtonElement>("[data-remove-designation]")
      .forEach(
        (button) =>
          (button.onclick = () => {
            draft.designations.splice(
              Number(button.dataset.removeDesignation),
              1,
            );
            render();
          }),
      );
    dialog
      .querySelector("[data-retry-duplicates]")
      ?.addEventListener("click", () => {
        delete errors.duplicates;
        void loadTab();
      });
    dialog.querySelectorAll<HTMLButtonElement>("[data-merge-source]").forEach(
      (button) =>
        (button.onclick = async () => {
          if (dirty()) {
            alert("Save or cancel your edits before merging members.");
            return;
          }
          const source = cache.duplicates?.find(
            (r) => r.id === button.dataset.mergeSource,
          );
          if (
            !source ||
            !confirm(
              `Merge ${source.name} into ${member.canonical_name}? The surviving name, status and call level will remain ${member.canonical_name}, ${member.active_status}, ${member.call_level || "Unassigned"}. Linked records and aliases will be preserved. This cannot be undone automatically.`,
            )
          )
            return;
          button.disabled = true;
          try {
            member = await request<DepartmentMember>(
              `/api/v1/admin/member-workspace/${id}/merge`,
              {
                method: "POST",
                body: JSON.stringify({
                  source_id: source.id,
                  target_revision: member.revision,
                  source_revision: source.revision,
                }),
              },
            );
            draft = structuredClone(member);
            changed(member);
            Object.keys(cache).forEach((k) => delete cache[k]);
            render();
            void loadTab();
          } catch (error) {
            dialog.querySelector("#mw-error")!.textContent = (
              error as Error
            ).message;
            button.disabled = false;
          }
        }),
    );
    dialog.querySelector("[data-retry]")?.addEventListener("click", () => {
      delete errors[tab];
      void loadTab();
    });
    for (const [selector, offset] of [
      ["[data-prev]", -1],
      ["[data-next]", 1],
    ] as const)
      dialog.querySelector(selector)?.addEventListener("click", () => {
        if (dirty() && !confirm("Discard unsaved changes and switch member?"))
          return;
        draft = structuredClone(member);
        close();
        void openMemberWorkspace(
          ids[ids.indexOf(id) + offset],
          admin,
          changed,
          ids,
          tab,
        );
      });
    const vertical = !window.matchMedia("(max-width:700px)").matches;
    dialog
      .querySelector("[role=tablist]")
      ?.setAttribute("aria-orientation", vertical ? "vertical" : "horizontal");
    if (focusAttrs.length)
      dialog
        .querySelector<HTMLElement>(focusAttrs.map((a) => `[${a}]`).join(""))
        ?.focus({ preventScroll: true });
    dialog.querySelector<HTMLFormElement>("form")!.onsubmit = async (event) => {
      event.preventDefault();
      if (busy) return;
      if (!validateDraft()) return;
      if (
        draft.active_status !== member.active_status &&
        !confirm(
          `Change membership to ${draft.active_status}? Review ${profile.impact.future_duties} future duties, ${profile.impact.current_or_future_postings} postings and ${profile.impact.eligibility_memberships} memberships. History will be preserved.`,
        )
      )
        return;
      busy = true;
      render();
      try {
        member = await request<DepartmentMember>(
          `/api/v1/admin/member-workspace/${id}`,
          {
            method: "PUT",
            body: JSON.stringify({
              ...draft,
              preserve_previous_name: preservePreviousName,
              aliases: draft.aliases.map((a) => a.alias),
              designations: draft.designations.map((d) => ({
                ...d,
                id: d.id || null,
              })),
            }),
          },
        );
        draft = structuredClone(member);
        Object.keys(fieldErrors).forEach((key) => delete fieldErrors[key]);
        editing = false;
        delete cache.activity;
        changed(member);
        render();
      } catch (error) {
        const target = dialog.querySelector<HTMLElement>("#mw-error")!;
        target.textContent = (error as Error).message;
        target.tabIndex = -1;
        target.focus();
        const detail = (
          error as Error & { detail?: { current?: DepartmentMember } }
        ).detail;
        if (detail?.current) {
          const compare = document.createElement("div");
          const describe = (value: unknown): string => {
            if (value == null || value === "") return "Not set";
            if (Array.isArray(value))
              return (
                value
                  .map((item) => {
                    const entry = item as Row;
                    return [
                      entry.alias ||
                        entry.designation ||
                        callLabel(entry.call_level),
                      entry.effective_from,
                      entry.effective_to,
                    ]
                      .filter(Boolean)
                      .join(" · ");
                  })
                  .join("; ") || "None"
              );
            return String(value).replace(/_/g, " ");
          };
          compare.innerHTML = `<h3>Compare changes</h3>${["canonical_name", "active_status", "call_level", "aliases", "designations", "call_level_changes"].map((key) => `<article class="mw-history"><strong>${esc(key.replace(/_/g, " "))}</strong><dl><dt>Latest saved version</dt><dd>${esc(describe((detail.current as unknown as Row)[key]))}</dd><dt>Your unsaved draft</dt><dd>${esc(describe((draft as unknown as Row)[key]))}</dd></dl></article>`).join("")}`;
          target.append(compare);
          const button = document.createElement("button");
          button.type = "button";
          button.textContent = "Use latest version";
          button.onclick = () => {
            member = detail.current!;
            draft = structuredClone(member);
            render();
          };
          target.append(button);
          const keep = document.createElement("button");
          keep.type = "button";
          keep.textContent = "Keep my draft for review";
          keep.onclick = () => {
            member = detail.current!;
            draft.revision = member.revision;
            render();
            dialog.querySelector("#mw-error")!.textContent =
              "Latest version loaded for comparison. Review your draft before saving again.";
          };
          target.append(keep);
        }
      } finally {
        busy = false;
        const save = dialog.querySelector<HTMLButtonElement>(
          "button[type=submit]",
        );
        if (save) {
          save.disabled = false;
          save.textContent = "Save changes";
        }
      }
    };
  }
  function status() {
    dialog.querySelector("#mw-save-status")!.textContent = dirty()
      ? "Unsaved changes"
      : "Editing profile";
  }
  async function loadTab() {
    const selectedTab = tab;
    const key = tab === "names" ? "duplicates" : tab;
    if (
      ![
        "roles",
        "postings",
        "leave",
        "duties",
        "activity",
        "duplicates",
      ].includes(key) ||
      cache[key]
    )
      return;
    try {
      const result = await request<{
        rows: Row[];
        analysis?: Row;
        months?: string[];
      }>(`/api/v1/admin/member-workspace/${id}/${key}`);
      cache[key] = result.rows;
      if (key === "duties") {
        dutyAnalysis = result.analysis;
        dutyMonths = result.months || [];
      }
    } catch (error) {
      errors[key] = (error as Error).message;
    }
    if (tab === selectedTab && dialog.open) render();
  }
  render();
  dialog.querySelector<HTMLElement>("[data-close]")?.focus();
  void loadTab();
}

export function openMemberCsvImport(done: () => void) {
  const dialog = workspaceDialog("Import department members", "mw-import");
  dialog.innerHTML = `<header class="mw-header"><div><h2>Import department members</h2><p>Upload &rarr; Map &rarr; Normalize &rarr; Resolve &rarr; Review &rarr; Apply</p><p>Download the template, fill your member list, then preview changes.</p></div><button type="button" data-close aria-label="Close import">×</button></header><div class="mw-content"><div class="registry-actions"><a class="primary" href="/templates/department-members.csv" download>Download blank CSV template</a><a class="icon-button" href="/templates/department-members-example.csv" download>Download example CSV (filled)</a></div><p>Only canonical_name is required. Blank cells keep the member's current value. New members default to Active and Unassigned.</p><details class="mw-csv-help" open><summary>CSV format and example</summary><p>One member per row. Open the example in Excel, replace the example rows with your members, then save as <strong>CSV UTF-8</strong>.</p><pre>member_id,canonical_name,active_status,call_level,designation,designation_effective_from
,Dr Example Member One,active,1ST_CALL,SENIOR RESIDENT,2026-10-01
,Dr Example Member Two,active,2ND_CALL,SENIOR RESIDENT (DM TRAINEE),2026-10-01
,Dr Example Member Three,active,3RD_CALL,ASSISTANT PROFESSOR,
,Dr Example Member Four,,4TH_CALL,ASSOCIATE PROFESSOR,
,Dr Example Member Five,,5TH_CALL,PROFESSOR,
,Dr Example Member Six,,,,</pre><table class="mw-csv-columns"><thead><tr><th>Column</th><th>What to enter</th></tr></thead><tbody><tr><td>member_id</td><td>Optional. Leave blank; names are matched automatically. Paste the ID from a profile only to force a match.</td></tr><tr><td>canonical_name</td><td><strong>Required.</strong> Full name, e.g. Dr Example Member One. Saved aliases and close spellings are matched.</td></tr><tr><td>active_status</td><td>Optional: active, inactive or archived. Use active to restore an archived member.</td></tr><tr><td>call_level</td><td>Optional: 1ST_CALL, 2ND_CALL, 3RD_CALL, CO_4TH_CALL, 4TH_CALL, 5TH_CALL, PAIN, SICU, DRP, NEURO_ICU. Enter __CLEAR__ to remove a default call level.</td></tr><tr><td>designation</td><td>Optional position, e.g. SENIOR RESIDENT, ASSISTANT PROFESSOR, PROFESSOR.</td></tr><tr><td>designation_effective_from</td><td>Optional start date of the position as YYYY-MM-DD. In roster sync a blank date means today; other modes require it.</td></tr></tbody></table><p>A plain list with only a canonical_name column (or just one name per line) also works.</p></details><form id="csv-form"><label>CSV UTF-8 file (up to 2 MB and 5,000 members)<input type="file" accept=".csv,text/csv" required></label><label>Import mode<select name="mode"><option value="roster_sync">Sync full department roster (create, update, list missing)</option><option value="create_only">Create new members only</option><option value="update_existing">Update existing members only</option></select></label><p>Roster sync treats the file as the complete current list: it adds new names, updates call levels, positions and status of matched members, and lists active members missing from the file so you can choose who to archive.</p><div id="csv-column-mapping"></div><button class="primary" type="submit">Preview import</button></form><p role="status" id="csv-message"></p><div id="csv-preview"></div></div>`;
  let file: File | undefined;
  let preview: { id: string; mode?: string; headers: string[]; rows: Row[]; missing?: Row[] } | undefined;
  let applied = false;
  let busy = false;
  const corrections: Record<string, Row> = {};
  const mapping: Record<string, string> = {};
  const close = () => {
    if (
      busy ||
      (preview &&
        !applied &&
        !confirm(
          "Close this import preview? No member changes have been applied.",
        ))
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
  async function previewFile() {
    if (!file || busy) return;
    busy = true;
    const message = dialog.querySelector<HTMLElement>("#csv-message")!;
    message.textContent = "Reading and validating CSV…";
    try {
      const form = new FormData();
      form.append("file", file);
      form.append(
        "mode",
        (dialog.querySelector("select") as HTMLSelectElement).value,
      );
      form.append("corrections", JSON.stringify(corrections));
      form.append("mapping", JSON.stringify(mapping));
      const response = await fetch(
        `${import.meta.env.VITE_API_BASE_URL ?? ""}/api/v1/admin/member-workspace/csv/preview`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${localStorage.getItem("duty_rota_auth_token") || ""}`,
          },
          body: form,
        },
      );
      const data = await response.json();
      if (!response.ok)
        throw new Error(
          typeof data.detail === "string"
            ? data.detail
            : "Unable to preview this file",
        );
      preview = data;
      applied = false;
      renderPreview();
      message.textContent = `${preview!.rows.length} rows previewed. Nothing has been saved.`;
    } catch (error) {
      message.textContent = (error as Error).message;
    } finally {
      busy = false;
    }
  }
  function changeSummary(row: Row): string {
    const before = (row.before || {}) as Row;
    const after = (row.after || {}) as Row;
    const lines = ["canonical_name", "active_status", "call_level"]
      .filter((key) => row.before && before[key] !== after[key])
      .map((key) => `<li>${esc(key.replace(/_/g, " "))}: ${esc(before[key] || "Unassigned")} &rarr; <strong>${esc(after[key] || "Unassigned")}</strong></li>`);
    const designation = row.designation_change as Row | null;
    if (designation)
      lines.push(`<li>position: <strong>${esc((designation.add as Row).designation)}</strong> from ${esc((designation.add as Row).effective_from)}</li>`);
    return lines.length ? `<ul>${lines.join("")}</ul>` : "";
  }
  function renderRosterPreview(root: HTMLElement) {
    const rows = preview!.rows;
    const fresh = rows.filter((r) => !r.person_id);
    const matched = rows.filter((r) => r.person_id);
    const missing = preview!.missing || [];
    const changed = matched.filter((r) => r.action === "update").length;
    const section = (title: string, hint: string, items: Row[]) =>
      `<section class="mw-roster-list"><h4>${esc(title)} (${items.length})</h4><p>${esc(hint)}</p>${items.length ? items.map(rowHtml).join("") : "<p>None.</p>"}</section>`;
    root.innerHTML = `<h3>Compare roster with department members</h3><p>${fresh.length} new in file / ${matched.length} matched (${changed} with changes) / ${missing.length} existing members missing from file</p><p>Correct values below, then refresh preview. Every applied change is recorded in that member's profile activity. Call-level changes take effect today and are added to call history; a new position ends the previous one the day before.</p>${section(
      "New in file",
      "These names did not match any existing member or alias. Check possible matches before creating new members.",
      fresh,
    )}${section(
      "Matched existing members",
      "Blank cells keep the current value. Rows marked unchanged need no update.",
      matched,
    )}<section class="mw-roster-list"><h4>Existing but missing from file (${missing.length})</h4><p>These active members are not in the uploaded roster. Tick the ones to archive; unticked members stay active. Archiving keeps their duties, leave and history.</p>${missing.length ? `<div class="registry-actions"><button type="button" data-archive-all>Tick all</button><button type="button" data-archive-none>Untick all</button></div>${missing.map((m) => `<article class="mw-history"><label><input type="checkbox" data-archive="${esc(m.id)}"> Archive <strong>${esc(m.canonical_name)}</strong></label><p>${esc(m.call_level || "Unassigned")} &middot; ${esc(m.designation || "No current designation")}</p>${m.possible_row ? `<p class="mw-error">Possibly file row ${esc(m.possible_row)} (spelling differs) &mdash; resolve that row before archiving.</p>` : ""}<button type="button" data-csv-review-member="${esc(m.id)}">Review member profile</button></article>`).join("")}` : "<p>None. Every active member is in the file.</p>"}</section>${actions()}`;
  }
  function actions() {
    return `<button type="button" data-refresh>Refresh preview after corrections</button><button type="button" data-report>Download row report</button><button class="primary" type="button" data-apply>${preview!.mode === "roster_sync" ? "Apply roster changes" : "Apply selected rows"}</button><p role="status" data-apply-status aria-live="polite"></p>`;
  }
  function rowHtml(row: Row): string {
    const values = row.values as Row;
    return `<article class="mw-history"><label><input type="checkbox" data-include="${row.row_number}" ${["invalid", "needs_review"].includes(String(row.action)) ? "" : "checked"}> Include row ${row.row_number}</label><strong>${esc(String(row.action).replace(/_/g, " "))}</strong>${changeSummary(row)}${["member_id", "canonical_name", "active_status", "call_level", "designation", "designation_effective_from"].map((key) => `<label>${esc(key.replace(/_/g, " "))}<input data-row="${row.row_number}" data-key="${key}" value="${esc(values[key])}"></label>`).join("")}<p>${esc((row.errors as string[]).join(" · "))}</p>${(row.suggestions as Row[]).map((suggestion) => `<article class="mw-history"><strong>Possible match: ${esc(suggestion.name)}</strong><p>${esc(suggestion.status || "")} &middot; ${esc(suggestion.call_level || "Unassigned")} &middot; ${esc(suggestion.designation || "No current designation")}</p><p>${esc(((suggestion.units || []) as string[]).join(", "))}</p><button type="button" data-csv-use-member="${esc(suggestion.id)}" data-csv-member-row="${row.row_number}">Select existing member</button><button type="button" data-csv-review-member="${esc(suggestion.id)}">Review member profile</button></article>`).join("")}${(row.suggestions as Row[]).length ? `<label><input type="checkbox" data-distinct-row="${row.row_number}" ${values._confirm_distinct === "yes" ? "checked" : ""}> I reviewed the matches; create a separate member</label>` : ""}<details><summary>Before → After</summary><pre>${esc(JSON.stringify({ before: row.before, after: row.after, designation_change: row.designation_change }, null, 2))}</pre></details></article>`;
  }
  function renderPreview() {
    const root = dialog.querySelector<HTMLElement>("#csv-preview")!;
    if (preview!.mode === "roster_sync") renderRosterPreview(root);
    else
      root.innerHTML = `<h3>Review changes</h3><p>${["create", "update", "unchanged", "needs_review", "invalid"].map((action) => `${preview!.rows.filter((r) => r.action === action).length} ${action.replace(/_/g, " ")}`).join(" / ")}</p><p>Correct values below, then refresh preview. Exclude rows you do not want to apply. Possible duplicate matches require a member ID or exclusion.</p>${preview!.rows.map(rowHtml).join("")}${actions()}`;
    root.querySelector("[data-archive-all]")?.addEventListener("click", () =>
      root.querySelectorAll<HTMLInputElement>("[data-archive]").forEach((i) => (i.checked = true)));
    root.querySelector("[data-archive-none]")?.addEventListener("click", () =>
      root.querySelectorAll<HTMLInputElement>("[data-archive]").forEach((i) => (i.checked = false)));
    root.querySelectorAll<HTMLButtonElement>("[data-csv-use-member]").forEach(
      (button) =>
        (button.onclick = () => {
          const row = button.dataset.csvMemberRow!;
          (corrections[row] ??= {}).member_id = button.dataset.csvUseMember;
          const input = root.querySelector<HTMLInputElement>(
            `[data-row="${row}"][data-key="member_id"]`,
          );
          if (input) input.value = button.dataset.csvUseMember!;
          root.querySelector<HTMLButtonElement>("[data-apply]")!.disabled =
            true;
          dialog.querySelector("#csv-message")!.textContent =
            "Member selected. Choose Update existing members if appropriate, then refresh the preview.";
        }),
    );
    root
      .querySelectorAll<HTMLButtonElement>("[data-csv-review-member]")
      .forEach(
        (button) =>
          (button.onclick = () => {
            void openMemberWorkspace(
              button.dataset.csvReviewMember!,
              true,
              () => {},
              [],
              "details",
            );
          }),
      );
    root.querySelectorAll<HTMLInputElement>("[data-row]").forEach(
      (input) =>
        (input.oninput = () => {
          (corrections[input.dataset.row!] ??= {})[input.dataset.key!] =
            input.value;
          root.querySelector<HTMLButtonElement>("[data-apply]")!.disabled =
            true;
        }),
    );
    root.querySelectorAll<HTMLInputElement>("[data-distinct-row]").forEach(
      (input) =>
        (input.onchange = () => {
          (corrections[input.dataset.distinctRow!] ??= {})._confirm_distinct =
            input.checked ? "yes" : "";
          root.querySelector<HTMLButtonElement>("[data-apply]")!.disabled =
            true;
        }),
    );
    root
      .querySelector("[data-refresh]")!
      .addEventListener("click", () => void previewFile());
    root.querySelector("[data-report]")!.addEventListener("click", () => {
      const cell = (v: unknown) =>
        `"${String(v ?? "")
          .replace(/^[\s]*[=+@\-]|^[\t\r\n]/, "'$&")
          .replace(/"/g, '""')}"`;
      const csv = [
        ["row", "name", "action", "errors"],
        ...preview!.rows.map((r) => [
          r.row_number,
          (r.values as Row).canonical_name,
          r.action,
          (r.errors as string[]).join("; "),
        ]),
      ]
        .map((r) => r.map(cell).join(","))
        .join("\r\n");
      const url = URL.createObjectURL(
        new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = "department-member-import-report.csv";
      a.click();
      URL.revokeObjectURL(url);
    });
    root.querySelector("[data-apply]")!.addEventListener("click", async () => {
      if (busy) return;
      const excluded = [
        ...root.querySelectorAll<HTMLInputElement>(
          "[data-include]:not(:checked)",
        ),
      ].map((i) => Number(i.dataset.include));
      const count = preview!.rows.length - excluded.length;
      const archive = [
        ...root.querySelectorAll<HTMLInputElement>("[data-archive]:checked"),
      ].map((i) => i.dataset.archive!);
      const status = root.querySelector<HTMLElement>("[data-apply-status]")!;
      const blocked = preview!.rows.filter(
        (r) =>
          !excluded.includes(Number(r.row_number)) &&
          ["invalid", "needs_review"].includes(String(r.action)),
      );
      if (blocked.length) {
        status.textContent = `Resolve or untick ${blocked.length} row(s) that need review (first: row ${blocked[0].row_number}), then refresh the preview.`;
        return;
      }
      if (!count && !archive.length) {
        status.textContent = "Select at least one row or member to archive.";
        return;
      }
      if (
        !confirm(
          `Apply ${count} member row(s)${archive.length ? ` and archive ${archive.length} member(s) missing from the file` : ""}?`,
        )
      )
        return;
      busy = true;
      try {
        const result = await request<Row>(
          `/api/v1/admin/member-workspace/csv/${preview!.id}/apply`,
          {
            method: "POST",
            body: JSON.stringify({ excluded, archive_missing: archive }),
          },
        );
        applied = true;
        root.innerHTML = `<h3>Import complete</h3><p>${esc(result.created)} created · ${esc(result.updated)} updated · ${esc(result.unchanged)} unchanged · ${esc(result.archived ?? 0)} archived · ${esc(result.excluded)} excluded</p><p>Each change is recorded in the member's profile activity.</p><p>Batch ${esc(result.batch_id)}</p>${(result.members as Row[]).map((m) => `<button type="button" data-result-member="${esc(m.id)}">Open ${esc(m.canonical_name)}</button>`).join("")}`;
        root
          .querySelectorAll<HTMLButtonElement>("[data-result-member]")
          .forEach(
            (button) =>
              (button.onclick = () => {
                void openMemberWorkspace(
                  button.dataset.resultMember!,
                  true,
                  () => {},
                );
              }),
          );
        done();
      } catch (error) {
        dialog.querySelector("#csv-message")!.textContent = status.textContent =
          (error as Error).message;
      } finally {
        busy = false;
      }
    });
  }
  dialog.querySelector<HTMLInputElement>("input[type=file]")!.onchange = async (
    event,
  ) => {
    file = (event.target as HTMLInputElement).files?.[0];
    preview = undefined;
    Object.keys(corrections).forEach((k) => delete corrections[k]);
    Object.keys(mapping).forEach((k) => delete mapping[k]);
    dialog.querySelector("#csv-preview")!.innerHTML = "";
    if (!file) return;
    const form = new FormData();
    form.append("file", file);
    try {
      const response = await fetch(
        `${import.meta.env.VITE_API_BASE_URL ?? ""}/api/v1/admin/member-workspace/csv/columns`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${localStorage.getItem("duty_rota_auth_token") || ""}`,
          },
          body: form,
        },
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail);
      const fields = [
        "canonical_name",
        "member_id",
        "active_status",
        "call_level",
        "designation",
        "designation_effective_from",
      ];
      const aliases: Record<string, string> = {
        name: "canonical_name",
        doctor_name: "canonical_name",
        member_name: "canonical_name",
        position: "designation",
        status: "active_status",
        id: "member_id",
        effective_from: "designation_effective_from",
      };
      const root = dialog.querySelector("#csv-column-mapping")!;
      root.innerHTML = `<details><summary>Map CSV columns</summary><p>For a list without a heading, leave mapping unchanged.</p>${(
        data.headers as string[]
      )
        .map((h, i) => {
          const normalized = h.trim().toLowerCase().replace(/ /g, "_");
          const suggested = aliases[normalized] || normalized;
          return `<label>${esc(h)}<select data-map-column="${i}"><option value="">Ignore column</option>${fields.map((f) => `<option value="${f}" ${f === suggested ? "selected" : ""}>${esc(f)}</option>`).join("")}</select></label>`;
        })
        .join("")}</details>`;
      root.querySelectorAll<HTMLSelectElement>("select").forEach(
        (select) =>
          (select.onchange = () => {
            (data.headers as string[]).forEach((h, i) => {
              mapping[h] = root.querySelector<HTMLSelectElement>(
                `[data-map-column="${i}"]`,
              )!.value;
            });
            dialog
              .querySelector<HTMLButtonElement>("[data-apply]")
              ?.setAttribute("disabled", "");
          }),
      );
    } catch (error) {
      dialog.querySelector("#csv-message")!.textContent = (
        error as Error
      ).message;
    }
  };
  dialog.querySelector<HTMLSelectElement>("select[name=mode]")!.onchange =
    () => {
      dialog
        .querySelector<HTMLButtonElement>("[data-apply]")
        ?.setAttribute("disabled", "");
      dialog.querySelector("#csv-message")!.textContent =
        "Import mode changed. Preview again before applying.";
    };
  dialog.querySelector<HTMLFormElement>("form")!.onsubmit = (event) => {
    event.preventDefault();
    void previewFile();
  };
}
