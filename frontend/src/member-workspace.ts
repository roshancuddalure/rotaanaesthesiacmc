import { openReferenceCatalog } from "./reference-workspace";
import { openRecordEditor } from "./record-workspace";
import { protectWorkspaceDraft, lockWorkspaceControls, workspaceLoading, workspaceLoadFailure } from "./workspace-load-state";
import { request, requestMultipartJSON, type DepartmentMember } from "./services/api";
import { applyBlocker, memberMatch, retainActionFocus, steps, formatCalendarDate, type MemberMatchView } from "./ui";
import { formatAuditTimestamp } from "./audit-time";
import { installFormValidation } from "./form-validation";

const MEMBER_IMPORT_STEPS = ["Upload file", "Map columns", "Review rows", "Apply"];

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
// Presentation only: an explicitly unassigned effective level must not inherit the base.
// Preserve unrecognised server values verbatim; callers escape labels when rendering.
function memberCallPresentation(member: DepartmentMember) {
  const returned = member.effective_call_level !== undefined;
  const value = returned ? member.effective_call_level : member.call_level;
  const label = value == null ? "Unassigned"
    : levels.includes(value) ? callLabel(value) : value === "" ? "Not recorded (empty value)" : String(value);
  return {
    returned,
    label,
    caption: returned ? "Effective call level" : "Base default",
    note: returned ? "" : "Current effective call level not returned.",
    needsReview: !returned || value == null || !levels.includes(value),
  };
}
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
// Calendar-only presentation: dates never imply approval or scheduling eligibility.
function recordedCalendarDate(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000-")) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : null;
}
function localCalendarToday(): string {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
}
function recordedDateMarkup(value: unknown, missing = "Not recorded"): string {
  const date = recordedCalendarDate(value);
  return date ? `<time datetime="${esc(date)}">${esc(formatCalendarDate(date))}</time>`
    : value == null || value === "" ? esc(missing) : `${esc(value)} (invalid date)`;
}
function recordedRange(from: unknown, until: unknown, openEnded: boolean): { markup: string; state: string } {
  const start = recordedCalendarDate(from);
  const end = recordedCalendarDate(until);
  const missingStart = from == null || from === "";
  const missingEnd = until == null || until === "";
  const markup = `${recordedDateMarkup(from)} to ${recordedDateMarkup(until, openEnded ? "Ongoing" : "Not recorded")}`;
  if ((!start && !missingStart) || (!end && !missingEnd) || (start && end && end < start)) return { markup, state: "Date range invalid" };
  if (!start || (!end && !openEnded)) return { markup, state: "Date range not recorded" };
  const today = localCalendarToday();
  return { markup, state: start > today ? "Scheduled dates" : end && end < today ? "Ended" : "Includes today" };
}
type Row = Record<string, unknown>;
type Profile = { member: DepartmentMember; impact: Record<string, number> };
let memberSectionCueSequence = 0;

function updateMemberSectionCue(dialog: HTMLDialogElement) {
  const rail = dialog.querySelector<HTMLElement>(".mw-rail[role=tablist]");
  const cue = dialog.querySelector<HTMLElement>("[data-member-sections-cue]");
  if (!rail || !cue) return;
  const vertical = memberSectionsVertical(dialog);
  const overflow = vertical
    ? rail.scrollHeight > rail.clientHeight + 1
    : rail.scrollWidth > rail.clientWidth + 1;
  cue.hidden = !overflow;
  if (!overflow) {
    rail.removeAttribute("aria-describedby");
    return;
  }
  const bounds = rail.getBoundingClientRect();
  const tabs = [...rail.querySelectorAll<HTMLElement>("[role=tab]")];
  const before = tabs.some((item) => {
    const rect = item.getBoundingClientRect();
    return vertical ? rect.top < bounds.top - 1 : rect.left < bounds.left - 1;
  });
  const after = tabs.some((item) => {
    const rect = item.getBoundingClientRect();
    return vertical ? rect.bottom > bounds.bottom + 1 : rect.right > bounds.right + 1;
  });
  const direction = vertical
    ? before && after ? "above and below" : before ? "above" : "below"
    : before && after ? "to the left and right" : before ? "to the left" : "to the right";
  const text = `More sections ${direction}. Scroll or use ${vertical ? "Up/Down" : "Left/Right"} arrow keys on a tab.`;
  if (cue.textContent !== text) cue.textContent = text;
  rail.setAttribute("aria-describedby", cue.id);
}

function revealMemberSection(rail: HTMLElement, selected: HTMLElement, vertical: boolean) {
  const target = selected.getBoundingClientRect();
  const viewport = rail.getBoundingClientRect();
  if (vertical) {
    if (target.top < viewport.top) rail.scrollTop -= viewport.top - target.top;
    else if (target.bottom > viewport.bottom) rail.scrollTop += target.bottom - viewport.bottom;
  } else {
    if (target.left < viewport.left) rail.scrollLeft -= viewport.left - target.left;
    else if (target.right > viewport.right) rail.scrollLeft += target.right - viewport.right;
  }
}

function memberSectionsVertical(dialog: HTMLDialogElement): boolean {
  const rail = dialog.querySelector<HTMLElement>('.mw-rail');
  // Follow the rendered rail, including container-query and media fallbacks.
  return rail ? getComputedStyle(rail).flexDirection === 'column'
    : !window.matchMedia('(max-width:700px)').matches;
}

function updateMemberIdentityScroll(dialog: HTMLDialogElement) {
  const heading = dialog.querySelector<HTMLElement>("[data-member-identity]");
  if (!heading) return;
  if (heading.scrollHeight > heading.clientHeight) {
    heading.tabIndex = 0;
    heading.setAttribute("aria-description", "Scroll within this heading to read the full member name.");
  } else {
    heading.removeAttribute("tabindex");
    heading.removeAttribute("aria-description");
  }
}

export function workspaceDialog(
  title: string,
  className = "",
  fallbackFocus?: () => HTMLElement | null,
): HTMLDialogElement {
  const opener = document.activeElement as HTMLElement | null;
  const dialog = document.createElement("dialog");
  dialog.className = `member-workspace ${className}`;
  dialog.setAttribute("aria-label", title);
  document.body.append(dialog);
  let observedRail: HTMLElement | null = null;
  const fitViewport = () => {
    if (!dialog.isConnected || !dialog.open) return;
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
        memberSectionsVertical(dialog) ? "vertical" : "horizontal",
      );
    const rail = dialog.querySelector<HTMLElement>("[role=tablist]");
    // The cue occupies space outside the rail. Settle its visibility before
    // measuring the selected tab, including when ResizeObserver is unavailable.
    updateMemberSectionCue(dialog);
    const selected = rail?.querySelector<HTMLElement>("[aria-selected=true]");
    if (rail && selected) {
      revealMemberSection(rail, selected, memberSectionsVertical(dialog));
    }
    if (rail !== observedRail) {
      if (observedRail) sizeObserver?.unobserve(observedRail);
      observedRail = rail || null;
      if (observedRail) sizeObserver?.observe(observedRail);
    }
    updateMemberSectionCue(dialog);
    updateMemberIdentityScroll(dialog);
  };
  const updateRailScroll = (event: Event) => {
    if (event.target === observedRail) updateMemberSectionCue(dialog);
  };
  window.visualViewport?.addEventListener("resize", fitViewport);
  window.visualViewport?.addEventListener("scroll", fitViewport);
  window.addEventListener("resize", fitViewport);
  const sizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(fitViewport) : undefined;
  sizeObserver?.observe(dialog);
  dialog.addEventListener("membersectionschange", fitViewport);
  dialog.addEventListener("scroll", updateRailScroll, true);
  const cleanupViewport = () => {
    sizeObserver?.disconnect();
    removalObserver.disconnect();
    window.visualViewport?.removeEventListener('resize', fitViewport);
    window.visualViewport?.removeEventListener('scroll', fitViewport);
    window.removeEventListener('resize', fitViewport);
    dialog.removeEventListener("membersectionschange", fitViewport);
    dialog.removeEventListener("scroll", updateRailScroll, true);
  };
  const removalObserver = new MutationObserver(() => {
    if (!dialog.isConnected) cleanupViewport();
  });
  removalObserver.observe(document.body, {childList:true});
  dialog.addEventListener(
    "close",
    () => {
      cleanupViewport();
      dialog.remove();
      // Native close can restore focus before its queued close event. Preserve
      // a newer deliberate destination instead of scrolling back to the opener.
      if (opener?.isConnected && (document.activeElement === document.body || dialog.contains(document.activeElement)))
        opener.focus({preventScroll:true});
      else if (!opener?.isConnected && document.activeElement === document.body)
        fallbackFocus?.()?.focus({preventScroll:true});
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
  const sectionsCueId = `mw-sections-cue-${++memberSectionCueSequence}`;
  const alive = () => dialog.isConnected && dialog.open;
  const dismissInitialLoad = () => {
    dialog.close();
    dialog.remove();
  };
  workspaceLoading(dialog, "Member profile", dismissInitialLoad);
  let profile: Profile;
  try {
    profile = await request<Profile>(`/api/v1/admin/member-workspace/${id}`);
    if (!alive()) return;
  } catch (error) {
    if (!alive()) return;
    workspaceLoadFailure(dialog, "Member profile unavailable", error, () => {
      if (!alive()) return;
      dismissInitialLoad();
      if (opener?.isConnected) opener.focus({ preventScroll: true });
      void openMemberWorkspace(id, admin, changed, ids, initialTab, proposedStatus);
    }, dismissInitialLoad);
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
  let formValidation: ReturnType<typeof installFormValidation>;
  const cache: Record<string, Row[] | undefined> = {};
  const errors: Record<string, string> = {};
  function sectionMetadata(key: string) {
    if (!["postings", "leave", "duties", "activity"].includes(key)) return { description: "", markup: "" };
    if (errors[key]) return { description: `${labels[key]} could not load. Use Retry in this section.`, markup: '<span class="mw-tab-count is-error" aria-hidden="true">Retry needed</span>' };
    if (!cache[key]) return { description: "", markup: "" };
    const count = cache[key].length;
    return { description: `${count} ${count === 1 ? "record" : "records"} loaded in this section. Loaded records may be a subset of the full history.`, markup: `<span class="mw-tab-count" aria-hidden="true">${count} loaded</span>` };
  }
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
  protectWorkspaceDraft(dialog, () => dirty() || busy);

  function designationEditor() {
    return `<div class="mw-timeline">${draft.designations.map((d, i) => `<fieldset data-designation-row="${i}"><legend>Position ${i + 1}</legend><label>Designation<input data-d="${i}" data-key="designation" required maxlength="100" value="${esc(d.designation)}"></label><label>From<input type="date" required data-d="${i}" data-key="effective_from" value="${esc(d.effective_from)}"></label><label>Until (optional)<input type="date" data-d="${i}" data-key="effective_to" value="${esc(d.effective_to)}"></label><label>Notes<input data-d="${i}" data-key="notes" value="${esc(d.notes)}"></label><button type="button" data-remove-designation="${i}">Remove position</button></fieldset>`).join("")}</div><button type="button" data-add-designation-row>Add position</button>`;
  }

  function scheduledCalls() {
    const changes = draft.call_level_changes || [];
    if (!editing) {
      const effective = memberCallPresentation(member);
      const ordered = changes.map((change, index) => ({ change, index })).sort((a, b) => {
        const first = recordedCalendarDate(a.change.effective_from);
        const second = recordedCalendarDate(b.change.effective_from);
        return first && second ? first.localeCompare(second) || a.index - b.index : first ? -1 : second ? 1 : a.index - b.index;
      });
      return `<h3>Dated default call-level changes</h3><p data-effective-call-context>${effective.returned ? `Current effective call level returned by the system: <strong>${esc(effective.label)}</strong>. Base default: ${esc(callLabel(member.call_level))}.` : `${esc(effective.note)} Base default: <strong>${esc(effective.label)}</strong>.`}</p><p>Changes are shown by effective date, oldest first. A recorded date is not proof that a change is currently effective. Monthly postings may override the default.</p><p class="mw-date-context">Date labels are compared with ${recordedDateMarkup(localCalendarToday())} on this device.</p>${ordered.length ? `<ol class="mw-call-timeline" aria-label="Dated default call-level history">${ordered.map(({ change, index }) => {
        const date = recordedCalendarDate(change.effective_from);
        const state = date ? date > localCalendarToday() ? "Scheduled change" : "Recorded change" : change.effective_from == null || change.effective_from === "" ? "Date not recorded" : "Date invalid";
        return `<li data-call-change-history="${index}"><article class="mw-history"><h4>Default changes to ${esc(callLabel(change.call_level))}</h4><span class="mw-period-badge">${state}</span><p>Effective from ${recordedDateMarkup(change.effective_from)}</p><p>${esc(change.notes)}</p></article></li>`;
      }).join("")}</ol>` : "<p>No dated changes recorded.</p>"}`;
    }
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
              return `<article class="mw-history"><strong>${esc(String(row.action).replace(/_/g, " "))}</strong><p>${esc(row.operator)} · <time datetime="${esc(row.created_at)}">${esc(formatAuditTimestamp(typeof row.created_at === "string" ? row.created_at : undefined))}</time></p><dl>${changed.map((key) => `<dt>${esc(key.replace(/_/g, " "))}</dt><dd>${esc(describe(before[key]))} → ${esc(describe(after[key]))}</dd>`).join("")}</dl>${details.batch_id ? `<p>Import batch ${esc(details.batch_id)}</p>` : ""}</article>`;
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
                `<p>${esc(month)} <strong>${esc(count)}</strong>${/^\d{4}-(0[1-9]|1[0-2])$/.test(month) ? ` <button type="button" class="quiet-button" data-duty-month="${esc(month)}">Review duty records for ${esc(month)}</button>` : ""}</p>`,
            )
            .join("")}${detailedAnalysis()}<h3>Duty records</h3>`
        : "";
    const filter =
      tab === "duties"
        ? `<div class="mw-date-filter"><label>From date<input type="date" data-duty-from value="${esc(dutyFrom)}"></label><label>Until date<input type="date" data-duty-until value="${esc(dutyUntil)}"></label>${dutyFrom || dutyUntil ? '<button type="button" class="quiet-button" data-clear-duty-dates>Show all duty records</button>' : ""}</div>`
        : "";
    return (
      analysis +
      filter +
      (tab === "postings" || tab === "leave" ? `<p class="mw-date-context">Date labels are compared with ${recordedDateMarkup(localCalendarToday())} on this device.</p>` : "") +
      (rows.length
        ? rows
            .map(
              (row, index) => {
                const datedRecord = tab === "postings" || tab === "leave";
                const range = datedRecord ? recordedRange(row.starts_on, row.ends_on, tab === "postings") : null;
                const contextId = `${sectionsCueId}-record-${index}`;
                const unit = typeof row.unit === "string" && row.unit !== "" ? row.unit : "Unit not recorded";
                const heading = tab === "postings" ? `Posting: ${unit} · ${callLabel(row.posting_type)}` : `Leave: ${statusLabel(row.type ?? row.leave_type)}`;
                return `<article class="mw-history">${range ? `<h3 class="mw-record-heading" id="${contextId}-heading">${esc(heading)}</h3><p class="mw-record-dates" id="${contextId}-dates">${range.markup}</p><span class="mw-period-badge mw-date-state">${range.state}</span>${tab === "leave" ? `<p class="mw-record-status">Status: ${esc(statusLabel(row.status))}</p>` : ""}` : row.starts_on || row.effective_from ? `<span class="mw-period-badge">${periodLabel(String(row.starts_on || row.effective_from), (row.ends_on || row.effective_to) as string | null)}</span>` : ""}<dl>${Object.entries(
                  row,
                )
                  .filter(([key]) => key !== "id")
                  .map(
                    ([key, value]) =>
                      `<div><dt>${esc(key.replace(/_/g, " "))}</dt><dd>${typeof value === "object" && value !== null ? `<pre>${esc(JSON.stringify(value, null, 2))}</pre>` : esc(key === "call_level" || key === "posting_type" ? callLabel(value) : ["type", "slot", "source", "status"].includes(key) ? statusLabel(value) : typeof value === "boolean" ? (value ? "Yes" : "No") : typeof value === "string" && ["date", "duty_date", "starts_on", "ends_on", "effective_from", "effective_to"].includes(key) ? formatCalendarDate(value) : (value ?? (["ends_on", "effective_to"].includes(key) ? "Ongoing" : "Not recorded")))}</dd></div>`,
                  )
                  .join(
                    "",
                  )}</dl>${["postings", "leave"].includes(tab) ? `<button type="button" data-edit-record="${esc(row.id)}" aria-describedby="${contextId}-heading ${contextId}-dates">Edit ${tab === "postings" ? "posting" : "leave"}</button>${tab === "leave" && row.status !== "cancelled" ? `<button type="button" class="danger-button" data-cancel-profile-leave="${esc(row.id)}" aria-describedby="${contextId}-heading ${contextId}-dates">Cancel leave</button>` : ""}` : ""}</article>`;
              },
            )
            .join("")
        : `<p class="empty-state">No ${esc(labels[tab].toLowerCase())} records in this range.</p>`)
    );
  }
  function content() {
    const call = memberCallPresentation(member);
    const today = new Date().toLocaleDateString("en-CA");
    const current = member.designations
      .filter(
        (d) =>
          d.effective_from <= today &&
          (!d.effective_to || d.effective_to >= today),
      )
      .slice(-1)[0];
    if (tab === "overview")
      return `<div class="mw-summary"><article><small>Current position</small><strong>${esc(current?.designation || "Missing designation")}</strong></article><article data-effective-call-summary><small>${esc(call.caption)}</small><strong>${esc(call.label)}</strong>${call.note ? `<p data-member-call-note>${esc(call.note)}</p>` : ""}</article><article><small>Membership</small><strong>${esc(statusLabel(member.active_status))}</strong></article></div><h3>Needs attention</h3>${!current ? `<button type="button" data-tab-link="roles">Add or correct designation</button>` : ""}${call.needsReview ? `<button type="button" data-tab-link="details">Review call level</button>` : ""}${current && !call.needsReview ? "<p>No missing designation or effective call level.</p>" : ""}<h3>Identity checks</h3><button type="button" data-tab-link="names">Review aliases and possible duplicates</button><h3>Linked records</h3><p>${esc(profile.impact.future_duties)} future duties · ${esc(profile.impact.current_or_future_postings)} current/upcoming postings · ${esc(profile.impact.eligibility_memberships)} eligibility memberships</p><p>Monthly postings may override this member’s default call level. Review the relevant month in Postings.</p>`;
    if (tab === "details")
      return `<label>Member ID<input readonly data-member-id value="${esc(member.id)}"></label><button type="button" data-copy-member-id>Copy member ID</button><label>Member name<input data-field="canonical_name" required maxlength="255" value="${esc(draft.canonical_name)}" ${!editing ? "readonly" : ""}></label>${editing ? `<label><input type="checkbox" data-preserve-name ${preservePreviousName ? "checked" : ""}> Keep the previous name as an alias when renaming</label>` : ""}<label>Membership status<select data-field="active_status" ${!editing ? "disabled" : ""}>${["active", "historical", "archived"].map((s) => `<option ${draft.active_status === s ? "selected" : ""}>${s}</option>`).join("")}</select></label><label>Base default call level<select data-field="call_level" ${!editing ? "disabled" : ""}><option value="">Unassigned</option>${[...new Set([...levels, ...(draft.call_level ? [draft.call_level] : [])])].map((s) => `<option value="${esc(s)}" ${draft.call_level === s ? "selected" : ""}>${esc(callLabel(s))}</option>`).join("")}</select></label><p>Changing status preserves historical records. Future duties and memberships remain linked and need review.</p>`;
    if (tab === "roles")
      return `${admin ? `<button type="button" data-manage-profile-references>Manage designations and aliases</button>` : ""}<h3>Designation history</h3>${editing ? designationEditor() : member.designations.map((d) => `<article class="mw-history"><strong>${esc(d.designation)}</strong><span class="mw-period-badge">${periodLabel(d.effective_from, d.effective_to)}</span><p>${esc(d.effective_from)} → ${esc(d.effective_to || "Ongoing")} · ${esc(d.source)}</p><p>${esc(d.notes)}</p></article>`).join("") || "<p>No designation recorded.</p>"}${scheduledCalls()}<h3>Eligibility groups</h3><p>Groups restrict particular duties within a call level. Membership does not override approved leave, posting dates or rest requirements.</p>${history()}`;
    if (tab === "names")
      return `<p>Aliases connect imported spellings to this member. Previous names are preserved by default when renaming.</p>${editing ? `${draft.aliases.map((a, i) => `<div class="mw-alias-row"><span>${esc(a.alias)}</span><button type="button" data-remove-alias="${i}" aria-label="Remove alias ${esc(a.alias)}">Remove</button></div>`).join("")}<label>Aliases (one per line)<textarea data-aliases rows="7">${esc(draft.aliases.map((a) => a.alias).join("\n"))}</textarea></label>` : member.aliases.map((a) => `<article class="mw-history"><strong>${esc(a.alias)}</strong><small>${esc(a.source)}</small></article>`).join("") || "<p>No aliases recorded.</p>"}<h3>Possible duplicates</h3>${cache.duplicates ? (cache.duplicates.length ? cache.duplicates.map((r) => `<article class="mw-history"><strong>${esc(r.name)}</strong><p>${esc(statusLabel(r.status))} \u00b7 ${esc(callLabel(r.call_level))}</p><p>${esc(r.duties)} duties \u00b7 ${esc(r.postings)} postings \u00b7 ${esc(r.leave)} leave records \u00b7 ${esc(r.memberships)} memberships</p><p>Positions: ${esc((r.designations as string[]).join(", "))}</p>${r.member ? `<details><summary>Compare profile details</summary><p>Surviving member: ${esc(member.canonical_name)} \u00b7 ${esc(statusLabel(member.active_status))} \u00b7 ${esc(callLabel(member.call_level))}</p><p>Surviving aliases: ${esc(member.aliases.map((a) => a.alias).join(", ") || "None")}</p><p>Other member aliases: ${esc((r.member as DepartmentMember).aliases.map((a) => a.alias).join(", ") || "None")}</p><h4>Other member's designation history</h4>${(r.member as DepartmentMember).designations.map((d) => `<p>${esc(d.designation)} \u00b7 ${esc(d.effective_from)} to ${esc(d.effective_to || "Ongoing")} \u00b7 ${esc(d.notes)}</p>`).join("") || "<p>No positions recorded.</p>"}<h4>Other member's dated call levels</h4>${((r.member as DepartmentMember).call_level_changes || []).map((c) => `<p>${esc(callLabel(c.call_level))} from ${esc(c.effective_from)}</p>`).join("") || "<p>No dated changes.</p>"}</details>` : ""}${admin ? `<button type="button" class="danger-button" data-merge-source="${esc(r.id)}">Merge into ${esc(member.canonical_name)}</button>` : ""}</article>`).join("") : "<p>No duplicate candidates found.</p>") : errors.duplicates ? `<p role="alert">${esc(errors.duplicates)}</p><button type="button" data-retry-duplicates>Retry duplicate check</button>` : "<p>Checking duplicate identities\u2026</p>"}`;
    if (tab === "postings")
      return `<button type="button" class="primary" data-add-record>Add Posting</button><p>Dated postings determine monthly unit and call-level overrides. Base department default: ${esc(callLabel(member.call_level))}.</p>${history()}`;
    if (tab === "leave")
      return `<button type="button" class="primary" data-add-record>Add Leave</button><p>Approved leave blocks availability. Requested or imported pending leave needs review; cancelled leave does not block duties.</p>${history()}`;
    // Extra-duty ledger (docs/extra_duty_contract.md §8), filled after render.
    if (tab === "duties" && admin)
      return `${history()}<section data-extra-duties-host aria-label="Extra duties"></section>`;
    return history();
  }
  function render() {
    if (!dialog.open) return;
    const call = memberCallPresentation(member);
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
    const contentScroll = dialog.querySelector(".mw-content")?.scrollTop || 0;
    const railScroll = dialog.querySelector(".mw-rail")?.scrollLeft || 0;
    const selection = focused instanceof HTMLInputElement || focused instanceof HTMLTextAreaElement
      ? [focused.selectionStart, focused.selectionEnd] as const : null;
    const focusAttrs =
      focused && dialog.contains(focused)
        ? Object.entries(focused.dataset).map(
            ([key, value]) =>
              `data-${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}="${CSS.escape(value || "")}"`,
          )
        : [];
    dialog.innerHTML = `<header class="mw-header"><div><small>Department member</small><h2 data-member-identity>${esc(member.canonical_name)}</h2><span>${esc(statusLabel(member.active_status))} · <span data-member-call-identity aria-label="${esc(`${call.caption}: ${call.label}`)}">${call.returned ? esc(call.label) : `${esc(call.caption)}: ${esc(call.label)}`}</span></span>${call.note ? ` <span data-member-call-note>${esc(call.note)}</span>` : ""}</div><button type="button" data-close aria-label="Close member profile">×</button></header><p class="mw-sections-cue" data-member-sections-cue id="${sectionsCueId}" hidden></p><div class="mw-layout"><nav class="mw-rail" role="tablist" aria-label="Member sections" tabindex="-1">${Object.entries(
      labels,
    )
      .map(
        ([key, label]) => {
          const metadata = sectionMetadata(key);
          return `<button type="button" role="tab" id="mw-tab-${key}" aria-controls="mw-panel" aria-selected="${tab === key}" tabindex="${tab === key ? 0 : -1}" data-tab="${key}" ${metadata.description ? `aria-description="${esc(metadata.description)}"` : ""}>${label}${metadata.markup}</button>`;
        },
      )
      .join(
        "",
      )}</nav><form id="mw-form"><section class="mw-content" id="mw-panel" role="tabpanel" aria-labelledby="mw-tab-${tab}" tabindex="0">${content()}</section><div id="mw-error" class="mw-error" role="alert"></div><footer class="mw-footer"><span id="mw-save-status" aria-live="polite">${dirty() ? "Unsaved changes" : editing ? "Editing profile" : ""}</span>${editing ? `<button type="button" data-cancel-edit>Cancel</button><button class="primary" type="submit" ${busy ? "disabled" : ""}>${busy ? "Saving…" : "Save changes"}</button>` : admin ? `<button type="button" data-edit>Edit profile</button>` : `<span>View only</span>`}<button type="button" data-prev ${ids.indexOf(id) <= 0 ? "disabled" : ""}>Previous</button><button type="button" data-next ${ids.indexOf(id) < 0 || ids.indexOf(id) >= ids.length - 1 ? "disabled" : ""}>Next</button></footer></form></div>`;
    updateMemberIdentityScroll(dialog);
    dialog.querySelector<HTMLButtonElement>("[data-close]")!.onclick = close;
    const form = dialog.querySelector<HTMLFormElement>("#mw-form")!;
    formValidation = installFormValidation(form, dialog.querySelector<HTMLElement>("#mw-error")!, (path) => {
      if (path.length === 1 && typeof path[0] === "string")
        return form.querySelector<HTMLInputElement | HTMLSelectElement>(`[data-field="${CSS.escape(path[0])}"]`);
      if (path.length === 3 && typeof path[1] === "number" && typeof path[2] === "string") {
        const attribute = path[0] === "designations" ? "data-d" : path[0] === "call_level_changes" ? "data-call-change" : null;
        if (attribute) return form.querySelector<HTMLInputElement | HTMLSelectElement>(`[${attribute}="${path[1]}"][data-key="${CSS.escape(path[2])}"]`);
      }
      return null;
    });
    const clearLocalErrors = () => {
      Object.keys(fieldErrors).forEach(key => delete fieldErrors[key]);
      form.querySelectorAll<HTMLElement>("[data-member-validation-hint]").forEach(hint => {
        form.querySelectorAll<HTMLElement>('[aria-describedby]').forEach(field => {
          const ids = (field.getAttribute("aria-describedby") || "").split(/\s+/).filter(id => id && id !== hint.id);
          if (ids.length) field.setAttribute("aria-describedby", ids.join(" "));
          else field.removeAttribute("aria-describedby");
          if (field.getAttribute("aria-invalid") === "true" && field.dataset.memberInvalid === hint.id) {
            field.removeAttribute("aria-invalid");
            delete field.dataset.memberInvalid;
          }
        });
        hint.remove();
      });
    };
    form.addEventListener("input", clearLocalErrors);
    form.addEventListener("change", clearLocalErrors);
    const extraDutiesHost = dialog.querySelector<HTMLElement>("[data-extra-duties-host]");
    if (extraDutiesHost) {
      const loadExtraDuties = () => {
        extraDutiesHost.innerHTML = '<p role="status">Loading extra duties...</p>';
        void import("./extra-duty")
          .then((m) => { if (extraDutiesHost.isConnected && dialog.open) return m.renderMemberExtraDuties(extraDutiesHost, id); })
          .catch(() => {
            if (!extraDutiesHost.isConnected || !dialog.open) return;
            extraDutiesHost.innerHTML = '<p role="alert">Extra duties could not be loaded. Duty history remains available.</p><button type="button">Retry extra duties</button>';
            extraDutiesHost.querySelector("button")!.onclick = loadExtraDuties;
          });
      };
      loadExtraDuties();
    }
    dialog.querySelectorAll<HTMLButtonElement>("[data-remove-alias]").forEach(
      (button) =>
        (button.onclick = () => {
          draft.aliases.splice(Number(button.dataset.removeAlias), 1);
          render();
        }),
    );
    const copyButton = dialog.querySelector<HTMLButtonElement>("[data-copy-member-id]");
    if (copyButton) {
      const copyStatus = document.createElement('p');
      copyStatus.dataset.copyMemberStatus = '';
      copyStatus.className = 'muted-text';
      copyStatus.setAttribute('role', 'status');
      copyStatus.setAttribute('aria-live', 'polite');
      copyStatus.setAttribute('aria-atomic', 'true');
      copyButton.after(copyStatus);
      copyButton.addEventListener("click", async () => {
        if (copyButton.disabled) return;
        const field = dialog.querySelector<HTMLInputElement>('[data-member-id]');
        if (!field) return;
        const alive = () => dialog.isConnected && dialog.open && copyButton.isConnected && field.isConnected && copyStatus.isConnected;
        const originalFocus = document.activeElement;
        let moved = false, copied = false;
        let deadline: ReturnType<typeof setTimeout> | undefined;
        const trackFocus = (event: FocusEvent) => {
          if (event.target !== copyButton && event.target !== document.body) moved = true;
        };
        document.addEventListener('focusin', trackFocus);
        copyButton.disabled = true;
        copyButton.setAttribute('aria-busy', 'true');
        copyButton.textContent = 'Copying member ID…';
        copyStatus.textContent = '';
        try {
          if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
          await Promise.race([
            navigator.clipboard.writeText(member.id),
            new Promise<never>((_resolve, reject) => { deadline = setTimeout(() => reject(new Error('Clipboard did not respond')), 8000); }),
          ]);
          if (!alive()) return;
          copied = true;
          copyButton.textContent = 'Member ID copied';
          copyStatus.textContent = 'Member ID copied to the clipboard.';
        } catch {
          if (!alive()) return;
          copyButton.textContent = 'Copy member ID';
          const maySelect = !moved && (document.activeElement === copyButton || document.activeElement === document.body || document.activeElement === originalFocus);
          if (maySelect) {
            field.focus();
            field.select();
            copyStatus.textContent = 'Automatic copy was not confirmed. Member ID selected; copy it using your keyboard or selection menu.';
          } else {
            copyStatus.textContent = 'Automatic copy was not confirmed. Select the member ID above and copy it manually.';
          }
        } finally {
          clearTimeout(deadline);
          document.removeEventListener('focusin', trackFocus);
          if (alive()) {
            copyButton.disabled = false;
            copyButton.removeAttribute('aria-busy');
            if (copied && !moved && originalFocus === copyButton && document.activeElement === document.body) copyButton.focus();
          }
        }
      });
    }
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
        error.dataset.memberValidationHint = "";
        field.dataset.memberInvalid = error.id;
        error.textContent = message;
        field.setAttribute("aria-invalid", "true");
        field.setAttribute("aria-describedby", [field.getAttribute("aria-describedby"), error.id].filter(Boolean).join(" "));
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
    dialog.querySelectorAll<HTMLButtonElement>("[data-duty-month]").forEach(button => {
      button.onclick = () => {
        const month = button.dataset.dutyMonth || "";
        if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return;
        dutyFrom = `${month}-01`;
        const end = new Date(`${month}-01T00:00:00Z`);
        end.setUTCMonth(end.getUTCMonth() + 1);
        end.setUTCDate(0);
        dutyUntil = end.toISOString().slice(0, 10);
        render();
        dialog.querySelector<HTMLInputElement>("[data-duty-from]")?.focus();
      };
    });
    dialog.querySelector<HTMLButtonElement>("[data-clear-duty-dates]")?.addEventListener("click", () => {
      dutyFrom = "";
      dutyUntil = "";
      render();
      dialog.querySelector<HTMLInputElement>("[data-duty-from]")?.focus();
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
            const leave = cache.leave?.find(
              (row) => String(row.id) === button.dataset.cancelProfileLeave,
            );
            if (!leave) {
              errors.leave = "This leave record is no longer available in this view. Refresh Leave before cancelling.";
              render();
              return;
            }
            if (
              !confirm(
                `Cancel leave for ${member.canonical_name}?\nFrom: ${leave.starts_on ?? "Not recorded"}\nUntil: ${leave.ends_on ?? "Not recorded"}\nCategory: ${statusLabel(leave.type)}\nRecord ID: ${leave.id}\n\nIt will no longer block availability. History is retained. Existing duties remain assigned and may need review.`,
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
          const vertical = memberSectionsVertical(dialog);
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
    dialog.querySelector("[data-retry]")?.addEventListener("click", (event) => {
      const button = event.currentTarget as HTMLElement;
      const retryTab = tab;
      const restoreFocus = retainActionFocus(dialog, button, () =>
        dialog.querySelector<HTMLElement>("[data-retry]")
          ?? dialog.querySelector<HTMLElement>(`[data-tab="${CSS.escape(retryTab)}"]`));
      const key = tab === 'names' ? 'duplicates' : tab;
      // A failed linked action can leave useful old history cached. Explicit
      // retry must read fresh history, rather than silently returning that cache.
      delete errors[key];
      delete cache[key];
      render();
      void loadTab().finally(() => restoreFocus());
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
    const vertical = memberSectionsVertical(dialog);
    dialog
      .querySelector("[role=tablist]")
      ?.setAttribute("aria-orientation", vertical ? "vertical" : "horizontal");
    if (focusAttrs.length)
      {
      const restored = dialog
        .querySelector<HTMLElement>(focusAttrs.map((a) => `[${a}]`).join(""))
      restored?.focus({ preventScroll: true });
      if (selection && selection[0] !== null && selection[1] !== null &&
          (restored instanceof HTMLInputElement || restored instanceof HTMLTextAreaElement)) {
        try { restored.setSelectionRange(selection[0], selection[1]); } catch { /* Date and number controls do not expose text selection. */ }
      }
      }
    const panel = dialog.querySelector<HTMLElement>(".mw-content");
    if (panel) panel.scrollTop = contentScroll;
    const rail = dialog.querySelector<HTMLElement>(".mw-rail");
    if (rail) {
      rail.scrollLeft = railScroll;
      const selected = rail.querySelector<HTMLElement>("[aria-selected=true]");
      if (selected) revealMemberSection(rail, selected, vertical);
    }
    dialog.dispatchEvent(new Event("membersectionschange"));
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
        const issues = (error as { detail?: unknown }).detail;
        if (Array.isArray(issues)) {
          const path = issues.find(issue => Array.isArray(issue?.loc))?.loc.filter((part: unknown) => part !== "body");
          const destination = path?.[0] === "designations" || path?.[0] === "call_level_changes" ? "roles"
            : ["canonical_name", "active_status", "call_level"].includes(path?.[0]) ? "details" : tab;
          if (destination !== tab) { tab = destination; render(); }
        }
        formValidation.show(error);
        const target = dialog.querySelector<HTMLElement>("#mw-error")!;
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

let csvExampleCueSequence = 0;

export function openMemberCsvImport(done: () => void) {
  const dialog = workspaceDialog("Import department members", "mw-import");
  const exampleCueId = `mw-csv-example-cue-${++csvExampleCueSequence}`;
  dialog.innerHTML = `<header class="mw-header"><div><h2>Import department members</h2><div data-import-steps>${steps(MEMBER_IMPORT_STEPS, 0)}</div></div><button type="button" data-close aria-label="Close import">×</button></header><div class="mw-content"><div class="registry-actions"><a class="primary" href="/templates/department-members.csv" download>Download blank CSV template</a><a class="icon-button" href="/templates/department-members-example.csv" download>Download example CSV (filled)</a></div><p>Only canonical_name is required. Blank cells keep the member's current value. New members default to Active and Unassigned.</p><details class="mw-csv-help" open><summary>CSV format and example</summary><p>One member per row. Open the example in Excel, replace the example rows with your members, then save as <strong>CSV UTF-8</strong>.</p><p class="mw-csv-example-cue" id="${esc(exampleCueId)}">If the example extends beyond this panel, scroll horizontally. With a keyboard, focus the example and use the Left and Right arrow keys.</p><pre class="mw-csv-example" tabindex="0" role="region" aria-label="CSV example" aria-describedby="${esc(exampleCueId)}">member_id,canonical_name,active_status,call_level,designation,designation_effective_from
,Dr Example Member One,active,1ST_CALL,SENIOR RESIDENT,2026-10-01
,Dr Example Member Two,active,2ND_CALL,SENIOR RESIDENT (DM TRAINEE),2026-10-01
,Dr Example Member Three,active,3RD_CALL,ASSISTANT PROFESSOR,
,Dr Example Member Four,,4TH_CALL,ASSOCIATE PROFESSOR,
,Dr Example Member Five,,5TH_CALL,PROFESSOR,
,Dr Example Member Six,,,,</pre><table class="mw-csv-columns"><caption>CSV field reference</caption><colgroup><col class="mw-csv-column-name"><col></colgroup><thead><tr><th scope="col">Column</th><th scope="col">What to enter</th></tr></thead><tbody><tr><th scope="row">member_id</th><td>Optional. Leave blank; names are matched automatically. Paste the ID from a profile only to force a match.</td></tr><tr><th scope="row">canonical_name</th><td><strong>Required.</strong> Full name, e.g. Dr Example Member One. Saved aliases and close spellings are matched.</td></tr><tr><th scope="row">active_status</th><td>Optional: active, inactive or archived. Use active to restore an archived member.</td></tr><tr><th scope="row">call_level</th><td>Optional: 1ST_CALL, 2ND_CALL, 3RD_CALL, CO_4TH_CALL, 4TH_CALL, 5TH_CALL, PAIN, SICU, DRP, NEURO_ICU. Enter __CLEAR__ to remove a default call level.</td></tr><tr><th scope="row">designation</th><td>Optional position, e.g. SENIOR RESIDENT, ASSISTANT PROFESSOR, PROFESSOR.</td></tr><tr><th scope="row">designation_effective_from</th><td>Optional start date of the position as YYYY-MM-DD. In roster sync a blank date means today; other modes require it.</td></tr></tbody></table><p>A plain list with only a canonical_name column (or just one name per line) also works.</p></details><form id="csv-form"><label>CSV UTF-8 file (up to 2 MB and 5,000 members)<input type="file" accept=".csv,text/csv" required></label><label>Import mode<select name="mode"><option value="roster_sync">Sync full department roster (create, update, list missing)</option><option value="create_only">Create new members only</option><option value="update_existing">Update existing members only</option></select></label><p>Roster sync treats the file as the complete current list: it adds new names, updates call levels, positions and status of matched members, and lists active members missing from the file so you can choose who to archive.</p><div id="csv-column-mapping"></div><button class="primary" type="submit">Preview import</button></form><p role="status" id="csv-message"></p><div id="csv-preview"></div></div>`;
  let file: File | undefined;
  let preview: { id: string; mode?: string; headers: string[]; rows: Row[]; missing?: Row[] } | undefined;
  let applied = false;
  let busy = false;
  protectWorkspaceDraft(dialog, () => busy || Boolean((file || preview) && !applied));
  // True once a value, mode or mapping changed after the last preview; Apply then waits for a refresh.
  let stale = false;
  let columnSequence = 0;
  const corrections: Record<string, Row> = {};
  const mapping: Record<string, string> = {};
  // Preserve explicit review choices, while unresolved rows retain their normal defaults.
  const includeChoices = new Map<string, boolean>();
  const archiveChoices = new Map<string, boolean>();
  const close = () => {
    if (
      busy ||
      ((file || preview) &&
        !applied &&
        !confirm(
          "Discard this import draft? No member changes have been applied.",
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
  function setImportStep(index: number) {
    const host = dialog.querySelector<HTMLElement>("[data-import-steps]");
    if (host) host.innerHTML = steps(MEMBER_IMPORT_STEPS, index);
  }
  async function previewFile(focusRow?: string) {
    if (!file || busy) return;
    const requestedFile = file;
    const alive = () => dialog.isConnected && dialog.open && file === requestedFile;
    const focused = document.activeElement;
    const restoreFocus = focused instanceof HTMLElement && dialog.contains(focused)
      ? retainActionFocus(dialog, focused, () => focused.isConnected ? focused
        : (focusRow ? dialog.querySelector<HTMLElement>(`[data-csv-row="${CSS.escape(focusRow)}"] .import-row-edit summary`) : null)
          ?? dialog.querySelector('[data-refresh]')) : () => {};
    let unlock = () => {};
    busy = true;
    columnSequence++;
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
      unlock = lockWorkspaceControls(dialog);
      dialog.querySelector("#csv-form")?.setAttribute("aria-busy", "true");
      const data = await requestMultipartJSON<NonNullable<typeof preview>>('/api/v1/admin/member-workspace/csv/preview', form);
      if (!alive()) return;
      preview = data;
      applied = false;
      stale = false;
      setImportStep(2);
      renderPreview();
      message.textContent = `${preview!.rows.length} rows previewed. Nothing has been saved.`;
    } catch (error) {
      if (alive()) message.textContent = (error as Error).message;
    } finally {
      unlock();
      busy = false;
      if (alive()) dialog.querySelector("#csv-form")?.removeAttribute("aria-busy");
      restoreFocus(alive());
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
    return `<button type="button" data-refresh>Refresh preview after corrections</button><button type="button" data-report>Download row report</button><button class="primary" type="button" data-apply aria-describedby="csv-apply-blocker">${preview!.mode === "roster_sync" ? "Apply roster changes" : "Apply selected rows"}</button><p class="import-apply-blocker" id="csv-apply-blocker" data-apply-blocker hidden></p><p role="status" data-apply-status aria-live="polite"></p>`;
  }
  /** The member decision for a CSV row, in the shared resolver vocabulary. */
  function matchView(row: Row): MemberMatchView {
    const values = row.values as Row;
    const before = row.before as Row | null;
    const suggestions = (row.suggestions || []) as Row[];
    const errors = (row.errors || []) as string[];
    const raw = String(values.canonical_name ?? "");
    const distinct = (corrections[String(row.row_number)] || values)._confirm_distinct === "yes";
    if (row.person_id && before) {
      const exact = raw.trim().toLowerCase() === String(before.canonical_name ?? "").trim().toLowerCase();
      return {
        raw,
        status: "matched",
        name: String(before.canonical_name),
        method: values.member_id ? "member_id" : exact ? "canonical_exact" : "approved_alias",
      };
    }
    if (suggestions.length)
      return {
        raw,
        status: "needs_review",
        reason: `Possible duplicate of ${suggestions.map((m) => `${m.name} (${m.status || "member"})`).join(", ")}. Choose the member, or confirm this is a different person.`,
        candidates: suggestions.map((m) => ({
          id: String(m.id),
          name: String(m.name),
          status: m.status as string | undefined,
          call_level: m.call_level as string | null,
          designation: m.designation as string | null,
          units: (m.units || []) as string[],
        })),
      };
    if (row.action === "invalid" && errors.length)
      return { raw, status: "needs_review", reason: errors[0] };
    return {
      raw,
      status: "not_found",
      reason: distinct
        ? "You confirmed this is a different person; a new member will be created."
        : "No existing member with this name; a new member will be created.",
    };
  }
  function rowHtml(row: Row): string {
    const values = row.values as Row;
    const key = String(row.row_number);
    const suggestions = (row.suggestions || []) as Row[];
    const errors = (row.errors || []) as string[];
    const distinct = (corrections[key] || values)._confirm_distinct === "yes";
    const chosen = (corrections[key] || {}).member_id;
    const decisions = [
      suggestions.length ? `<button type="button" class="quiet-button" data-csv-distinct="${esc(key)}">This is a different person</button>` : "",
      distinct || chosen ? `<button type="button" class="quiet-button" data-csv-undo="${esc(key)}">Undo my choice</button>` : "",
      ...suggestions.map((suggestion) => `<button type="button" class="quiet-button" data-csv-review-member="${esc(suggestion.id)}">Review profile: ${esc(suggestion.name)}</button>`),
    ].join("");
    return `<article class="mw-history" data-csv-row="${esc(key)}"><label><input type="checkbox" data-include="${row.row_number}" ${["invalid", "needs_review"].includes(String(row.action)) ? "" : "checked"}> Include row ${row.row_number}</label><strong>${esc(String(row.action).replace(/_/g, " "))}</strong>${memberMatch(key, matchView(row))}${decisions ? `<div class="registry-actions">${decisions}</div>` : ""}${changeSummary(row)}${errors.length ? `<p class="mw-error">${esc(errors.join(" · "))}</p>` : ""}<details class="import-row-edit"><summary>Edit row</summary><p>Change values, then refresh the preview. Paste a member ID to force a match.</p>${["member_id", "canonical_name", "active_status", "call_level", "designation", "designation_effective_from"].map((field) => `<label>${esc(field.replace(/_/g, " "))}<input data-row="${row.row_number}" data-key="${field}" value="${esc(values[field])}"></label>`).join("")}</details><details><summary>Before → After</summary><pre>${esc(JSON.stringify({ before: row.before, after: row.after, designation_change: row.designation_change }, null, 2))}</pre></details></article>`;
  }
  /** Plain-language reason Apply cannot run yet, or "" when the reviewed rows can be applied. */
  function blockerText(): string {
    if (!preview) return "";
    if (stale) return "Values changed. Refresh the preview before applying.";
    const root = dialog.querySelector<HTMLElement>("#csv-preview")!;
    const excluded = new Set(
      [...root.querySelectorAll<HTMLInputElement>("[data-include]:not(:checked)")].map((i) => i.dataset.include!),
    );
    const archive = root.querySelectorAll("[data-archive]:checked").length;
    const rows = preview.rows.map((r) => {
      const errors = (r.errors || []) as string[];
      return {
        key: String(r.row_number),
        label: `Row ${r.row_number} (${(r.values as Row).canonical_name || "no name"})`,
        issues: ["invalid", "needs_review"].includes(String(r.action))
          ? errors.length ? errors : [matchView(r).reason || "needs review"]
          : [],
      };
    });
    // Roster sync may only archive members missing from the file.
    if (archive && rows.every((r) => excluded.has(r.key))) return "";
    return applyBlocker(rows, excluded);
  }
  function updateBlocker() {
    const host = dialog.querySelector<HTMLElement>("[data-apply-blocker]");
    if (!host) return;
    const text = blockerText();
    host.textContent = text;
    host.hidden = !text;
  }
  /** Record a reviewer's member decision for one row, then refresh the preview. */
  function chooseRow(row: string, change: Row, note: string) {
    Object.assign((corrections[row] ??= {}), change);
    stale = true;
    updateBlocker();
    dialog.querySelector("#csv-message")!.textContent = note;
    void previewFile(row);
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
    root.querySelectorAll<HTMLButtonElement>("[data-pick-member]").forEach(
      (button) =>
        (button.onclick = () =>
          chooseRow(
            button.dataset.pickRow!,
            { member_id: button.dataset.pickMember, _confirm_distinct: "" },
            "Member chosen. Refreshing the preview…",
          )),
    );
    root.querySelectorAll<HTMLButtonElement>("[data-csv-distinct]").forEach(
      (button) =>
        (button.onclick = () =>
          chooseRow(
            button.dataset.csvDistinct!,
            { _confirm_distinct: "yes", member_id: "" },
            "Marked as a different person. Refreshing the preview…",
          )),
    );
    root.querySelectorAll<HTMLButtonElement>("[data-csv-undo]").forEach(
      (button) =>
        (button.onclick = () =>
          chooseRow(
            button.dataset.csvUndo!,
            { _confirm_distinct: "", member_id: "" },
            "Choice undone. Refreshing the preview…",
          )),
    );
    root
      .querySelectorAll<HTMLInputElement>("[data-include], [data-archive]")
      .forEach((input) => {
        const choices = input.dataset.include ? includeChoices : archiveChoices;
        const key = input.dataset.include ?? input.dataset.archive!;
        if (choices.has(key)) input.checked = choices.get(key)!;
        input.addEventListener("change", () => {
          choices.set(key, input.checked);
          updateBlocker();
        });
      });
    const retainArchiveChoices = () => {
      root.querySelectorAll<HTMLInputElement>("[data-archive]").forEach(input => archiveChoices.set(input.dataset.archive!, input.checked));
      updateBlocker();
    };
    root.querySelector("[data-archive-all]")?.addEventListener("click", retainArchiveChoices);
    root.querySelector("[data-archive-none]")?.addEventListener("click", retainArchiveChoices);
    updateBlocker();
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
          stale = true;
          updateBlocker();
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
      // Apply stays clickable; it explains what is missing instead (the server re-checks too).
      const blocker = blockerText();
      updateBlocker();
      if (blocker) {
        status.textContent = blocker;
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
      const appliedPreview = preview!;
      const appliedFile = file;
      const alive = () => dialog.isConnected && dialog.open && file === appliedFile && preview === appliedPreview;
      const trigger = root.querySelector<HTMLElement>("[data-apply]")!;
      const restoreFocus = retainActionFocus(dialog, trigger, () =>
        trigger.isConnected ? trigger : root.querySelector<HTMLElement>('[data-result-member]') ?? root.querySelector<HTMLElement>('h3'));
      busy = true;
      columnSequence++;
      const unlock = lockWorkspaceControls(dialog);
      status.textContent = "Applying reviewed member changes…";
      try {
        const result = await request<Row>(
          `/api/v1/admin/member-workspace/csv/${appliedPreview.id}/apply`,
          {
            method: "POST",
            body: JSON.stringify({ excluded, archive_missing: archive }),
          },
        );
        if (!alive()) return;
        applied = true;
        setImportStep(MEMBER_IMPORT_STEPS.length);
        root.innerHTML = `<h3>Import complete</h3><p>${esc(result.created)} created · ${esc(result.updated)} updated · ${esc(result.unchanged)} unchanged · ${esc(result.archived ?? 0)} archived · ${esc(result.excluded)} excluded</p><p>Each change is recorded in the member's profile activity.</p><p>Batch ${esc(result.batch_id)}</p>${(result.members as Row[]).map((m) => `<button type="button" data-result-member="${esc(m.id)}">Open ${esc(m.canonical_name)}</button>`).join("")}`;
        root.querySelector<HTMLElement>('h3')!.tabIndex = -1;
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
        if (alive()) dialog.querySelector("#csv-message")!.textContent = status.textContent =
          (error as Error).message;
      } finally {
        unlock();
        busy = false;
        restoreFocus(alive());
      }
    });
  }
  dialog.querySelector<HTMLInputElement>("input[type=file]")!.onchange = async (
    event,
  ) => {
    if (busy) return;
    const sequence = ++columnSequence;
    file = (event.target as HTMLInputElement).files?.[0];
    applied = false;
    stale = true;
    preview = undefined;
    Object.keys(corrections).forEach((k) => delete corrections[k]);
    Object.keys(mapping).forEach((k) => delete mapping[k]);
    includeChoices.clear();
    archiveChoices.clear();
    dialog.querySelector("#csv-preview")!.innerHTML = "";
    if (!file) return;
    const inspectedFile = file;
    const form = new FormData();
    form.append("file", file);
    try {
      const data = await requestMultipartJSON<{headers:string[]}>('/api/v1/admin/member-workspace/csv/columns', form);
      if (sequence !== columnSequence || file !== inspectedFile || !dialog.isConnected || !dialog.open) return;
      setImportStep(1);
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
            stale = true;
            updateBlocker();
          }),
      );
    } catch (error) {
      if (sequence === columnSequence && file === inspectedFile && dialog.isConnected && dialog.open)
        dialog.querySelector("#csv-message")!.textContent = (
        error as Error
      ).message;
    }
  };
  dialog.querySelector<HTMLSelectElement>("select[name=mode]")!.onchange =
    () => {
      stale = true;
      updateBlocker();
      dialog.querySelector("#csv-message")!.textContent =
        "Import mode changed. Preview again before applying.";
    };
  dialog.querySelector<HTMLFormElement>("form")!.onsubmit = (event) => {
    event.preventDefault();
    void previewFile();
  };
}
