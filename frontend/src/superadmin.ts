/**
 * Superadmin allocation and "publish anyway" (docs/superadmin_override_contract.md §3).
 *
 * - `openSuperadminAllocation` puts any active member on one slot after a reason and an explicit
 *   confirmation. Leave, rest after a 24-hour duty and double duty are never overridden: those
 *   people are listed but cannot be chosen, with the exact reason in red.
 * - `openPublishAnyway` publishes a month with open slots and unresolved blockers.
 * - `superadminSlotAction`, `publishAnywayControl` and `publishOverrideNotice` return the small HTML
 *   hooks the pages render; each returns "" unless the signed-in role is `superadmin`.
 *   `installSuperadminActions` wires the slot buttons once for the whole app.
 * The backend enforces the role as well (403 for everyone else).
 */
import { request, ApiRequestError, type RotaPublishMonth } from "./services/api";
import { workspaceDialog } from "./member-workspace";
import { announceToast } from "./ui-feedback";
import { callLevelText, ruleLabel } from "./extra-duty";
import { codeLabel, formatDate, formatMonth } from "./ui";
import { setRoleSource } from "./session-role";

const API = "/api/v1/superadmin-allocation";
const REASON_MIN = 5;
const REASON_MAX = 500;
const esc = (value: unknown) => String(value ?? "").replace(/[&<>"']/g,
  c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export const isSuperadmin = (role: string | null | undefined) => role === "superadmin";

/* ----------------------------------------------------------------------------------------- */
/* Shapes (contract §1 and §2)                                                                */
/* ----------------------------------------------------------------------------------------- */

export interface RuleNote { code: string; label?: string; detail?: string }
export interface AllocationSlot {
  id: string; duty_date: string; duty_type: string; duty_label?: string | null; unit_id?: string | null; unit_name?: string | null;
  call_level?: string | null; is_24hr?: boolean; starts_at?: string | null; ends_at?: string | null;
  current: { assignment_id: string; person_id: string; person_name: string }[];
  /** Not in the contract's minimum shape; honoured when the backend sends it. */
  period_status?: string;
}
export interface AllocationPerson {
  person_id: string; person_name: string; call_level?: string | null; unit_id?: string | null; unit_name?: string | null;
  /** `cross_level`: a different call level; choosable only with its own confirmation (docs/limits_callevel_fairness_contract.md §1). */
  status: "available" | "cross_level" | "blocked"; blocked: RuleNote[]; overrides: RuleNote[]; month_duties?: number | null; note?: string | null;
  warning?: string | null;
}
export interface AllocationOptions { slot: AllocationSlot; people: AllocationPerson[] }
export interface AllocationResult {
  assignment_id: string; batch_id: string; slot_id: string; person_id: string; person_name: string;
  overrides: (RuleNote | string)[]; post_publish: boolean;
  replaced?: { assignment_id: string; person_id: string; person_name: string }[];
}
interface UndoConflict { slot_id?: string; code?: string; message?: string; reason?: string }
interface UndoResult { batch_id: string; restored: number; removed?: number; conflicts?: UndoConflict[]; dry_run?: boolean;
  would_restore?: number; already_undone?: boolean }
type PublishChecklist = RotaPublishMonth & { can_superadmin_override?: boolean };

/** Plain words for what an allocation bypasses; the server's own label wins when it sends one. */
const OVERRIDE_LABELS: Record<string, string> = {
  call_level_mismatch: "Call level does not match the duty",
  not_in_group: "Not in the duty's eligibility group",
  excluded_group: "In a group excluded from this duty",
  unit_rule: "Duty not allowed for this person's unit",
  not_posted: "Not posted to this unit this month",
  fairness: "Above the equal-duty share",
  superadmin_cross_level: "Call level crossed by superadmin",
};
const BLOCK_LABELS: Record<string, string> = {
  on_leave: "On leave",
  rest_after_24hr: "Resting after a 24-hour duty",
  overlapping_duty: "Already on another duty at this time",
};
const overrideText = (o: RuleNote | string) => typeof o === "string"
  ? OVERRIDE_LABELS[o] ?? ruleLabel(o)
  : o.label || OVERRIDE_LABELS[o.code] || ruleLabel(o.code);
const blockText = (b: RuleNote) => b.detail || b.label || BLOCK_LABELS[b.code] || ruleLabel(b.code);

type ApiError = Error & { status?: number; detail?: unknown; kind?: string };
const detailOf = (error: unknown) => {
  const detail = (error as ApiError)?.detail;
  return detail && typeof detail === "object" ? detail as Record<string, unknown> : null;
};
const isNetwork = (error: unknown) => error instanceof ApiRequestError && (error.kind === "network" || error.kind === "timeout");

function timeText(iso: string | null | undefined): string {
  if (!iso) return "";
  const m = String(iso).match(/T(\d{2}):(\d{2})/);
  return m ? `${m[1]}:${m[2]}` : "";
}
function dutyName(slot: AllocationSlot): string {
  return slot.duty_label || codeLabel(slot.duty_type, "Duty");
}
function scheduleText(slot: AllocationSlot): string {
  const start = timeText(slot.starts_at), end = timeText(slot.ends_at);
  const range = start && end ? `${start}–${end}` : "";
  if (slot.is_24hr) return range ? `${range} · 24-hour duty` : "24-hour duty";
  return range || "Time not set";
}

/* ----------------------------------------------------------------------------------------- */
/* Page hooks                                                                                  */
/* ----------------------------------------------------------------------------------------- */

/**
 * "Superadmin allocation" button for one slot. `context` names the duty for screen readers.
 * `published` shows the published-rota banner in the dialog.
 */
export function superadminSlotAction(slotId: string, role: string | null | undefined,
  options: { context?: string; published?: boolean; compact?: boolean; note?: string } = {}): string {
  if (!isSuperadmin(role) || !slotId) return "";
  const label = options.context ? `Superadmin allocation for ${options.context}` : "Superadmin allocation";
  const button = `<button type="button" class="superadmin-action${options.compact ? " superadmin-action--compact" : ""}" data-superadmin-allocate="${esc(slotId)}"${options.published ? ' data-superadmin-published="1"' : ""} aria-label="${esc(label)}">
    <span class="superadmin-action__mark" aria-hidden="true">★</span><span>Superadmin allocation</span></button>`;
  return options.note ? `<div class="superadmin-slot-action">${button}<p>${esc(options.note)}</p></div>` : button;
}

/** The "Publish anyway (superadmin)" button, shown only to a superadmin while blockers exist. */
export function publishAnywayControl(publish: PublishChecklist, role: string | null | undefined): string {
  if (!isSuperadmin(role) || !publish.blockers.length) return "";
  if (publish.can_superadmin_override === false) return "";
  return `<div class="superadmin-publish-cta" role="group" aria-labelledby="superadmin-publish-cta-title">
    <div><strong id="superadmin-publish-cta-title">Superadmin override</strong>
      <p>Publish now with ${plural(publish.blockers.length, "blocker")} still open${publish.summary.open_slots ? ` and ${plural(Number(publish.summary.open_slots), "open slot")} shown as “Unfilled”` : ""}. A reason is required and is recorded.</p></div>
    <button type="button" class="superadmin-danger-button" data-superadmin-publish-anyway>Publish anyway (superadmin)</button></div>`;
}

/** Banner for a month whose latest publish used the superadmin override (contract §2 summary fields). */
export function publishOverrideNotice(publish: RotaPublishMonth): string {
  const summary = (publish.latest_publish?.summary ?? {}) as Record<string, unknown>;
  if (!summary.published_with_override) return "";
  const by = String(summary.override_by ?? publish.latest_publish?.approved_by ?? "a superadmin");
  const open = Number(summary.open_slots ?? 0);
  const blockers = Array.isArray(summary.blockers) ? summary.blockers.length : 0;
  return `<section class="superadmin-published-notice" role="note" aria-labelledby="superadmin-published-title" data-published-with-override>
    <span class="superadmin-published-notice__icon" aria-hidden="true">!</span>
    <div><h3 id="superadmin-published-title">Published with superadmin override</h3>
      <p>Published by ${esc(by)}${publish.latest_publish?.created_at ? ` on ${esc(formatDate(publish.latest_publish.created_at.slice(0, 10)))}` : ""} with ${plural(open, "open slot")}${blockers ? ` and ${plural(blockers, "unresolved blocker")}` : ""}. Open slots show as “Unfilled”.</p>
      ${summary.override_reason ? `<p class="superadmin-published-notice__reason"><strong>Reason:</strong> ${esc(summary.override_reason)}</p>` : ""}</div></section>`;
}

let installed = false;
/**
 * One delegated click handler for every `[data-superadmin-allocate]` and
 * `[data-superadmin-publish-anyway]` button. The callbacks refresh whichever page the button was on.
 */
export function installSuperadminActions(options: {
  role: () => string | null | undefined;
  onAllocated: (result: AllocationResult) => void;
  publishContext?: () => { month: string; checklist: RotaPublishMonth } | null;
  onPublished?: (result: RotaPublishMonth) => void;
}): void {
  if (installed) return;
  installed = true;
  setRoleSource(options.role);
  document.addEventListener("click", event => {
    const target = event.target as HTMLElement | null;
    const allocate = target?.closest<HTMLButtonElement>("[data-superadmin-allocate]");
    const publish = target?.closest<HTMLButtonElement>("[data-superadmin-publish-anyway]");
    const button = allocate ?? publish;
    if (!button || button.disabled || !isSuperadmin(options.role())) return;
    event.preventDefault();
    event.stopPropagation();
    if (allocate) {
      void openSuperadminAllocation(allocate.dataset.superadminAllocate!, options.onAllocated, { published: allocate.dataset.superadminPublished === "1" });
      return;
    }
    const context = options.publishContext?.();
    if (context) void openPublishAnyway(context.month, context.checklist, result => options.onPublished?.(result));
  }, true);
}

/* ----------------------------------------------------------------------------------------- */
/* Shared reason + confirmation block                                                          */
/* ----------------------------------------------------------------------------------------- */

function reasonBlock(prefix: string, confirmText: string, value = "", checked = false): string {
  return `<div class="superadmin-confirm">
    <div class="superadmin-reason">
      <label for="${prefix}-reason">Reason <span class="superadmin-required">(required)</span></label>
      <textarea id="${prefix}-reason" data-sa-reason rows="3" maxlength="${REASON_MAX}" aria-describedby="${prefix}-reason-hint ${prefix}-reason-count" required>${esc(value)}</textarea>
      <div class="superadmin-reason__meta">
        <span id="${prefix}-reason-hint" data-sa-reason-hint>Between ${REASON_MIN} and ${REASON_MAX} characters. Recorded in the audit log and the 360° report.</span>
        <span id="${prefix}-reason-count" class="superadmin-reason__count" data-sa-reason-count aria-live="polite">${value.trim().length} / ${REASON_MAX}</span>
      </div>
    </div>
    <label class="superadmin-check"><input type="checkbox" data-sa-confirm ${checked ? "checked" : ""} /> <span>${esc(confirmText)}</span></label>
  </div>`;
}
const reasonValid = (text: string) => text.trim().length >= REASON_MIN && text.trim().length <= REASON_MAX;
function paintReason(dialog: HTMLElement, touched: boolean) {
  const area = dialog.querySelector<HTMLTextAreaElement>("[data-sa-reason]");
  if (!area) return;
  const length = area.value.trim().length;
  const bad = touched && !reasonValid(area.value);
  area.setAttribute("aria-invalid", bad ? "true" : "false");
  const count = dialog.querySelector<HTMLElement>("[data-sa-reason-count]");
  if (count) { count.textContent = `${length} / ${REASON_MAX}`; count.classList.toggle("is-short", length < REASON_MIN); }
  const hint = dialog.querySelector<HTMLElement>("[data-sa-reason-hint]");
  if (hint) {
    hint.textContent = bad ? `Write at least ${REASON_MIN} characters (${REASON_MIN - length > 0 ? `${REASON_MIN - length} more` : "too long"}).`
      : `Between ${REASON_MIN} and ${REASON_MAX} characters. Recorded in the audit log and the 360° report.`;
    hint.classList.toggle("is-error", bad);
  }
}

/* ----------------------------------------------------------------------------------------- */
/* Superadmin allocation dialog                                                                */
/* ----------------------------------------------------------------------------------------- */

type Filter = "available" | "cross_level" | "blocked" | "all";
const FILTER_WORDS: Record<Filter, string> = { available: "available", cross_level: "different-call-level", blocked: "blocked", all: "" };
const choosable = (p: AllocationPerson | null | undefined) => Boolean(p && (p.status === "available" || p.status === "cross_level"));
interface Notice { tone: "error" | "warning" | "info"; title: string; text?: string; reasons?: string[] }

export async function openSuperadminAllocation(slotId: string, onDone: (result: AllocationResult) => void,
  options: { published?: boolean } = {}): Promise<void> {
  const dialog = workspaceDialog("Superadmin allocation", "compute-workspace extra-duty-workspace superadmin-workspace");
  dialog.setAttribute("aria-labelledby", "sa-title");
  dialog.removeAttribute("aria-label");
  const lifetime = new AbortController();
  let closed = false;
  let busy: "" | "load" | "save" = "load";
  let data: AllocationOptions | null = null;
  let loadError = "";
  let filter: Filter = "available";
  let query = "";
  let selected = "";
  let reason = "";
  let confirmed = false;
  let crossConfirmed = false;
  let reasonTouched = false;
  let notice: Notice | null = null;
  let done: AllocationResult | null = null;
  let undo: { phase: "" | "checking" | "confirm" | "running" | "conflict" | "undone" | "error"; restored: number; text: string; conflicts: string[] } =
    { phase: "", restored: 0, text: "", conflicts: [] };

  dialog.addEventListener("close", () => { closed = true; lifetime.abort(); }, { once: true });
  dialog.addEventListener("cancel", event => { if (busy === "save") event.preventDefault(); });

  const published = () => Boolean(options.published || data?.slot.period_status?.toLowerCase() === "published");
  const person = (id: string) => data?.people.find(p => p.person_id === id) ?? null;
  const counts = () => {
    const people = data?.people ?? [];
    const available = people.filter(p => p.status === "available").length;
    const cross_level = people.filter(p => p.status === "cross_level").length;
    return { available, cross_level, blocked: people.length - available - cross_level, all: people.length };
  };
  const visible = () => {
    const q = query.trim().toLowerCase();
    return (data?.people ?? []).filter(p => (filter === "all" || p.status === filter)
      && (!q || [p.person_name, p.unit_name, callLevelText(p.call_level)].some(v => String(v ?? "").toLowerCase().includes(q))));
  };
  const isCross = () => person(selected)?.status === "cross_level";
  const ready = () => Boolean(selected && choosable(person(selected)) && reasonValid(reason) && confirmed && (!isCross() || crossConfirmed) && !busy);
  const missing = () => {
    const parts: string[] = [];
    if (!selected) parts.push("choose an available person");
    if (selected && isCross() && !crossConfirmed) parts.push("confirm the call level crossing");
    if (!reasonValid(reason)) parts.push(`give a reason of at least ${REASON_MIN} characters`);
    if (!confirmed) parts.push("tick the confirmation");
    return parts.length ? `To allocate, ${parts.join(", ")}.` : "Ready to allocate.";
  };

  function header() {
    const slot = data?.slot;
    return `<header class="mw-header superadmin-header"><div>
        <p class="superadmin-eyebrow"><span aria-hidden="true">★</span> Superadmin only</p>
        <h2 id="sa-title">Superadmin allocation</h2>
        <p>${slot ? `${esc(dutyName(slot))} · ${esc(formatDate(slot.duty_date))}${slot.unit_name ? ` · ${esc(slot.unit_name)}` : ""}` : "Loading the duty…"}</p></div>
      <button type="button" data-close aria-label="Close superadmin allocation" ${busy === "save" ? "disabled" : ""}>Close</button></header>`;
  }
  function summaryCard(slot: AllocationSlot) {
    const current = slot.current ?? [];
    return `<section class="superadmin-duty" aria-labelledby="sa-duty-title">
      <h3 id="sa-duty-title" class="visually-hidden">Duty</h3>
      <dl class="superadmin-duty__grid">
        <div><dt>Duty</dt><dd>${esc(dutyName(slot))}</dd></div>
        <div><dt>Date</dt><dd>${esc(formatDate(slot.duty_date))}</dd></div>
        <div><dt>Time</dt><dd>${esc(scheduleText(slot))}</dd></div>
        <div><dt>Unit</dt><dd>${esc(slot.unit_name || "No unit")}</dd></div>
        <div><dt>Call level</dt><dd>${esc(slot.call_level ? callLevelText(slot.call_level) : "Any")}</dd></div>
        <div><dt>On duty now</dt><dd data-sa-current>${current.length ? esc(current.map(c => c.person_name).join(", ")) : '<span class="superadmin-open">Open — no one assigned</span>'}</dd></div>
      </dl>
      ${current.length ? `<p class="superadmin-duty__note">Allocating replaces ${esc(current.map(c => c.person_name).join(" and "))}. Their extra-duty records for this slot are voided.</p>` : ""}
    </section>`;
  }
  function noticeHtml() {
    if (!notice) return "";
    return `<div class="extra-duty-notice extra-duty-notice--${notice.tone === "error" ? "error" : "info"} superadmin-notice" ${notice.tone === "error" ? 'role="alert"' : 'role="status"'} tabindex="-1" data-sa-notice>
      <p><strong>${esc(notice.title)}</strong>${notice.text ? ` ${esc(notice.text)}` : ""}</p>
      ${notice.reasons?.length ? `<ul class="superadmin-reasons">${notice.reasons.map(r => `<li>${esc(r)}</li>`).join("")}</ul>` : ""}</div>`;
  }
  function chips() {
    const c = counts();
    const chip = (key: Filter, label: string) => `<button type="button" class="superadmin-chip superadmin-chip--${key}" data-sa-filter="${key}" aria-pressed="${filter === key}">${label} <span class="superadmin-chip__count">${c[key]}</span></button>`;
    return `<div class="superadmin-chips" role="group" aria-label="Show people">${chip("available", "Available")}${chip("cross_level", "Different call level")}${chip("blocked", "Blocked")}${chip("all", "All")}</div>`;
  }
  function personRow(p: AllocationPerson, index: number) {
    const id = `sa-p-${index}`;
    const blocked = p.status === "blocked";
    const cross = p.status === "cross_level";
    const isSelected = selected === p.person_id;
    const onSlot = data?.slot.current?.some(c => c.person_id === p.person_id);
    const meta = [callLevelText(p.call_level), p.unit_name || "No posting", `${plural(Number(p.month_duties ?? 0), "duty", "duties")} this month`];
    const describedBy = [blocked ? `${id}-why` : "", cross ? `${id}-cross` : "", isSelected && p.overrides.length ? `${id}-ovr` : ""].filter(Boolean).join(" ");
    return `<li class="superadmin-person${blocked ? " is-blocked" : ""}${cross ? " is-cross-level" : ""}${isSelected ? " is-selected" : ""}" data-sa-person="${esc(p.person_id)}">
      <input type="radio" name="sa-person" id="${id}" value="${esc(p.person_id)}" ${blocked ? "disabled" : ""} ${isSelected ? "checked" : ""}${describedBy ? ` aria-describedby="${describedBy}"` : ""} />
      <label for="${id}"><span class="superadmin-person__name">${esc(p.person_name)}${onSlot ? ' <span class="superadmin-tag">On this duty now</span>' : ""}</span>
        <span class="superadmin-person__meta">${meta.map(esc).join(" · ")}</span>
        ${p.note ? `<span class="superadmin-person__note">${esc(p.note)}</span>` : ""}</label>
      ${blocked ? `<ul class="superadmin-person__why" id="${id}-why" aria-label="Cannot be allocated">${(p.blocked.length ? p.blocked : [{ code: "blocked" }]).map(b => `<li>${esc(blockText(b))}</li>`).join("")}</ul>` : ""}
      ${cross ? `<p class="superadmin-person__cross" id="${id}-cross"><span class="superadmin-person__cross-icon" aria-hidden="true">!</span><span>${esc(crossText(p))}</span></p>` : ""}
      ${isSelected ? overridesHtml(p, `${id}-ovr`) : ""}
    </li>`;
  }
  function overridesHtml(p: AllocationPerson, id: string) {
    if (!p.overrides.length) return `<div class="superadmin-overrides superadmin-overrides--none" id="${id}"><p>Within every rota rule for this duty. Nothing is overridden.</p></div>`;
    return `<div class="superadmin-overrides" id="${id}"><p><strong>This allocation overrides:</strong></p>
      <ul>${p.overrides.map(o => `<li>${esc(overrideText(o))}</li>`).join("")}</ul></div>`;
  }
  function listHtml() {
    const rows = visible();
    const all = data?.people ?? [];
    const index = new Map(all.map((p, i) => [p.person_id, i]));
    const empty = !all.length ? "No active members were found in the department."
      : query.trim() ? `No ${filter === "all" ? "" : `${FILTER_WORDS[filter]} `}people match “${query.trim()}”.`
        : filter === "available" ? (counts().cross_level ? "Nobody on this duty's call level is free. People on a different call level are under “Different call level”."
          : "Everyone is blocked for this duty (leave, rest or another duty). Nobody can be allocated.")
        : filter === "cross_level" ? "Nobody on a different call level is free for this duty."
          : "No blocked people.";
    return `<p class="superadmin-count" role="status" aria-live="polite" data-sa-count>Showing ${rows.length} of ${counts()[filter]} ${filter === "all" ? "people" : `${FILTER_WORDS[filter]} people`}</p>
      ${rows.length ? `<fieldset class="superadmin-people-set"><legend class="visually-hidden">Choose the person to allocate</legend>
        <ul class="superadmin-people" data-sa-list>${rows.map(p => personRow(p, index.get(p.person_id)!)).join("")}</ul></fieldset>`
        : `<p class="superadmin-empty">${esc(empty)}</p>`}`;
  }
  /** "Different call level: needs 3rd call, Dr X is 4th call" — the server's words win. */
  function crossText(p: AllocationPerson) {
    return p.warning || `Different call level: needs ${data?.slot.call_level ? callLevelText(data.slot.call_level) : "another call level"}, ${p.person_name} is ${callLevelText(p.call_level)}`;
  }
  function crossPanel(p: AllocationPerson) {
    const needs = data?.slot.call_level ? callLevelText(data.slot.call_level) : "a different call level";
    return `<section class="superadmin-cross" role="note" aria-labelledby="sa-cross-title" data-sa-cross>
        <span class="superadmin-cross__icon" aria-hidden="true">!</span>
        <div><h4 id="sa-cross-title">This crosses call level</h4>
          <p>Needs ${esc(needs)}; ${esc(p.person_name)} is ${esc(callLevelText(p.call_level))}. This is recorded and shown in Publish and the audit report.</p>
          <label class="superadmin-check superadmin-check--cross"><input type="checkbox" data-sa-cross-confirm ${crossConfirmed ? "checked" : ""} />
            <span>I confirm ${esc(p.person_name)} takes a ${esc(needs)} duty as ${esc(callLevelText(p.call_level))}</span></label></div>
      </section>`;
  }
  function selectionHtml() {
    const p = selected ? person(selected) : null;
    if (!p || !data) return `<p class="superadmin-selection__none">Choose an available person above.</p>`;
    return `<p class="superadmin-selection__who">Allocate <strong>${esc(p.person_name)}</strong> to ${esc(dutyName(data.slot))} on ${esc(formatDate(data.slot.duty_date))}.</p>
      ${p.status === "cross_level" ? crossPanel(p) : ""}
      ${overridesHtml(p, "sa-selection-ovr")}`;
  }
  function footer() {
    if (done) return `<p class="extra-duty-status" role="status"></p><button type="button" class="primary" data-close data-sa-done-close ${busy === "save" ? "disabled" : ""}>Close</button>`;
    return `<p class="extra-duty-status" role="status" aria-live="polite" data-sa-status>${busy === "save" ? "Allocating… keep this window open." : busy === "load" ? "" : esc(missing())}</p>
      <button type="button" data-close ${busy === "save" ? "disabled" : ""}>Cancel</button>
      <button type="button" class="primary superadmin-allocate" data-sa-allocate ${ready() ? "" : "disabled"}>${busy === "save" ? "Allocating…" : "Allocate"}</button>`;
  }
  function body() {
    if (busy === "load" && !data) return `<p role="status" class="extra-duty-loading">Loading every member and checking leave, rest and other duties…</p>`;
    if (loadError && !data) return `<div class="extra-duty-notice extra-duty-notice--error" role="alert"><p>${esc(loadError)}</p>
      ${loadError.startsWith("Only a superadmin") ? "" : '<button type="button" data-sa-retry>Try again</button>'}</div>`;
    if (!data) return "";
    if (done) return successHtml(done);
    return `${published() ? `<div class="superadmin-published-banner" role="note"><strong>This changes a published rota.</strong> The change is recorded as a post-publish change and appears in the 360° report.</div>` : ""}
      ${summaryCard(data.slot)}
      <p class="superadmin-rules-note">Leave, rest after a 24-hour duty and double duty are never overridden. Everything else — call level, groups, unit rules, posting, limits, staffing and fairness — can be, and is recorded in the justice ledger.</p>
      <div data-sa-notice-host>${noticeHtml()}</div>
      <section class="superadmin-picker" aria-labelledby="sa-people-title">
        <h3 id="sa-people-title">Choose a person</h3>
        <div class="superadmin-picker__tools">
          <label class="superadmin-search" for="sa-search"><span>Search by name, unit or call level</span>
            <input id="sa-search" type="search" data-sa-search autocomplete="off" value="${esc(query)}" /></label>
          ${chips()}
        </div>
        <div data-sa-list-host>${listHtml()}</div>
      </section>
      <section class="superadmin-selection" aria-labelledby="sa-confirm-title">
        <h3 id="sa-confirm-title">Confirm</h3>
        <div data-sa-selection>${selectionHtml()}</div>
        ${reasonBlock("sa", "I understand this overrides the rota rules", reason, confirmed)}
      </section>`;
  }
  function successHtml(result: AllocationResult) {
    const overrides = (result.overrides ?? []).map(overrideText);
    const replaced = (result.replaced ?? data?.slot.current ?? []).filter(c => c.person_id !== result.person_id).map(c => c.person_name);
    return `<section class="superadmin-success" role="status" tabindex="-1" data-sa-success aria-labelledby="sa-success-title">
      <span class="superadmin-success__icon" aria-hidden="true">✓</span>
      <div><h3 id="sa-success-title">Allocated</h3>
        <p><strong>${esc(result.person_name)}</strong> is now on ${esc(data ? dutyName(data.slot) : "the duty")}${data ? ` on ${esc(formatDate(data.slot.duty_date))}` : ""}.${replaced.length ? ` Replaced ${esc(replaced.join(" and "))}.` : ""}</p>
        <p>${overrides.length ? `Rules overridden: ${esc(overrides.join(" · "))}.` : "No rota rule was overridden."} Counted in the justice ledger.</p>
        ${result.post_publish ? `<p class="superadmin-success__post">Recorded as a change to the published rota.</p>` : ""}</div></section>
      ${undoHtml(replaced)}`;
  }
  function undoHtml(replaced: string[]) {
    const putBack = replaced.length ? `puts ${replaced.join(" and ")} back on the duty` : "leaves the duty open again";
    const body = undo.phase === "" ? `<p>Made a mistake? Undo removes this allocation and ${esc(putBack)}.</p>
        <div class="button-row"><button type="button" data-sa-undo>Undo this allocation</button></div>`
      : undo.phase === "checking" ? `<p role="status">Checking whether this allocation can be undone…</p>`
      : undo.phase === "confirm" ? `<p><strong>Undo this allocation?</strong> This removes ${esc(done?.person_name ?? "the person")} from the duty, ${esc(putBack)}, and marks the ledger record as void.</p>
        <div class="button-row"><button type="button" class="superadmin-danger-button" data-sa-undo-confirm>Yes, undo it</button><button type="button" data-sa-undo-keep>Keep it</button></div>`
      : undo.phase === "running" ? `<p role="status">Undoing… keep this window open.</p>`
      : undo.phase === "conflict" ? `<p><strong>This allocation cannot be undone yet.</strong> The duty was changed afterwards. Nothing was changed.</p>
        <ul class="superadmin-reasons">${undo.conflicts.map(c => `<li>${esc(c)}</li>`).join("")}</ul>
        <div class="button-row"><button type="button" data-sa-undo-keep>Close this message</button></div>`
      : undo.phase === "undone" ? `<p><strong>Allocation undone.</strong> ${esc(undo.text)}</p>`
      : `<p><strong>Undo did not go through.</strong> ${esc(undo.text)} Nothing was changed.</p>
        <div class="button-row"><button type="button" data-sa-undo>Try again</button></div>`;
    return `<section class="superadmin-undo superadmin-undo--${undo.phase || "offer"}" aria-labelledby="sa-undo-title" tabindex="-1" data-sa-undo-panel>
      <h3 id="sa-undo-title" class="visually-hidden">Undo</h3>${body}</section>`;
  }
  async function runUndo(dryRun: boolean) {
    if (!done || busy) return;
    undo = { ...undo, phase: dryRun ? "checking" : "running" };
    if (!dryRun) busy = "save";
    render("[data-sa-undo-panel]");
    try {
      const result = await request<UndoResult>(`${API}/${encodeURIComponent(done.batch_id)}/undo`, { method: "POST", body: JSON.stringify({ dry_run: dryRun }) });
      busy = "";
      const conflicts = (result.conflicts ?? []).map(c => c.message || c.reason || "A duty in this allocation was changed");
      if (result.already_undone) undo = { phase: "undone", restored: 0, text: "It had already been undone.", conflicts: [] };
      else if (conflicts.length) undo = { phase: "conflict", restored: 0, text: "", conflicts };
      else if (dryRun) undo = { phase: "confirm", restored: result.would_restore ?? result.restored ?? 0, text: "", conflicts: [] };
      else {
        undo = { phase: "undone", restored: result.restored ?? 0, text: `${plural(result.restored ?? 0, "earlier holder")} put back; the ledger record is now void.`, conflicts: [] };
        announceToast("Superadmin allocation undone", "success");
        try { onDone(done); } catch { /* keep the dialog usable */ }
      }
    } catch (error) {
      busy = "";
      if (closed) return;
      const detail = detailOf(error);
      if (detail?.code === "undo_conflict") {
        const list = Array.isArray(detail.conflicts) ? (detail.conflicts as UndoConflict[]) : [];
        undo = { phase: "conflict", restored: 0, text: "", conflicts: list.length ? list.map(c => c.message || c.reason || "A duty was changed") : [String(detail.message ?? (error as Error).message)] };
      } else undo = { phase: "error", restored: 0, text: isNetwork(error) ? "No answer from the server; refresh the page to check before trying again." : (error as Error).message || "Unknown error.", conflicts: [] };
    }
    render(undo.phase === "confirm" ? "[data-sa-undo-confirm]" : "[data-sa-undo-panel]");
  }

  function render(focus?: string) {
    if (closed) return;
    dialog.innerHTML = `${header()}<div class="mw-content extra-duty-content superadmin-content">${body()}</div><footer class="mw-footer extra-duty-footer superadmin-footer">${footer()}</footer>`;
    const target = focus ? dialog.querySelector<HTMLElement>(focus) : null;
    const start = dialog.querySelector<HTMLElement>("[data-sa-search]") ?? dialog.querySelector<HTMLElement>("[data-sa-retry]")
      ?? dialog.querySelector<HTMLElement>("[data-close]");
    (target ?? start)?.focus({ preventScroll: !target });
  }
  /** Partial repaint that keeps the search box, the textarea and the checkbox untouched. */
  function paintList() {
    const host = dialog.querySelector<HTMLElement>("[data-sa-list-host]");
    if (host) host.innerHTML = listHtml();
    dialog.querySelectorAll<HTMLButtonElement>("[data-sa-filter]").forEach(b => {
      const key = b.dataset.saFilter as Filter;
      b.setAttribute("aria-pressed", String(filter === key));
      const count = b.querySelector(".superadmin-chip__count");
      if (count) count.textContent = String(counts()[key]);
    });
  }
  function paintSelection() {
    const host = dialog.querySelector<HTMLElement>("[data-sa-selection]");
    if (host) host.innerHTML = selectionHtml();
    paintFooter();
  }
  function paintFooter() {
    const button = dialog.querySelector<HTMLButtonElement>("[data-sa-allocate]");
    if (button) button.disabled = !ready();
    const status = dialog.querySelector<HTMLElement>("[data-sa-status]");
    if (status && !busy) status.textContent = missing();
  }
  function paintNotice(focus = false) {
    const host = dialog.querySelector<HTMLElement>("[data-sa-notice-host]");
    if (host) host.innerHTML = noticeHtml();
    if (focus) host?.querySelector<HTMLElement>("[data-sa-notice]")?.focus();
  }

  async function load(keepNotice = false) {
    busy = "load"; loadError = "";
    if (!keepNotice) notice = null;
    if (!data) render();
    try {
      const result = await request<AllocationOptions>(`${API}/options?slot_id=${encodeURIComponent(slotId)}`,
        { signal: lifetime.signal, readTimeoutMs: 20000 });
      if (closed) return;
      data = { slot: { ...result.slot, current: result.slot.current ?? [] },
        people: (result.people ?? []).map(p => ({ ...p, blocked: p.blocked ?? [], overrides: p.overrides ?? [] })) };
      if (selected && !choosable(person(selected))) selected = "";
      if (!counts().available && filter === "available" && (counts().blocked || counts().cross_level)) filter = counts().cross_level ? "cross_level" : "all";
    } catch (error) {
      if (closed) return;
      const status = (error as ApiError).status;
      loadError = status === 403 ? "Only a superadmin can make this allocation. Your account does not have that role."
        : status === 404 ? "This duty no longer exists. Close this window and refresh the page."
          : isNetwork(error) ? "Could not reach the server. Check your connection and try again."
            : `${(error as Error).message || "Could not load the people for this duty."}`;
      if (data) notice = { tone: "error", title: "Could not refresh the list.", text: loadError };
    }
    busy = "";
    const active = document.activeElement as HTMLElement | null;
    const keepFocus = data && dialog.contains(active) && active?.matches("[data-sa-search], [data-sa-reason], [data-sa-confirm]");
    if (keepFocus && dialog.querySelector("[data-sa-list-host]")) { paintList(); paintSelection(); paintNotice(); }
    else render(notice ? "[data-sa-notice]" : undefined);
  }

  async function allocate() {
    if (!ready() || !data) return;
    const chosen = person(selected)!;
    busy = "save"; notice = null;
    paintNotice();
    dialog.querySelectorAll<HTMLButtonElement>("[data-close]").forEach(b => { b.disabled = true; });
    const button = dialog.querySelector<HTMLButtonElement>("[data-sa-allocate]");
    if (button) { button.disabled = true; button.textContent = "Allocating…"; }
    const status = dialog.querySelector<HTMLElement>("[data-sa-status]");
    if (status) status.textContent = "Allocating… keep this window open.";
    try {
      const result = await request<AllocationResult>(API, { method: "POST",
        body: JSON.stringify({ slot_id: slotId, person_id: chosen.person_id, reason: reason.trim(), replace_existing: true,
          ...(chosen.status === "cross_level" ? { confirm_cross_level: true } : {}) }) });
      busy = "";
      done = { ...result, person_name: result.person_name || chosen.person_name, overrides: result.overrides ?? chosen.overrides };
      announceToast(`${done.person_name} allocated by superadmin override${done.post_publish ? " (published rota changed)" : ""}`, "success");
      if (!closed) render("[data-sa-success]");
      try { onDone(done); } catch { /* the page refresh must not break the dialog */ }
      return;
    } catch (error) {
      busy = "";
      if (closed) return;
      const detail = detailOf(error);
      const status = (error as ApiError).status;
      if (status === 409 && detail?.code === "strict_blocked") {
        const reasons = Array.isArray(detail.blocked) ? (detail.blocked as RuleNote[]).map(blockText) : [];
        notice = { tone: "error", title: `${chosen.person_name} cannot be allocated.`,
          text: `${reasons.length ? "" : `${String(detail.message ?? "A strict rule blocks this allocation.")} `}Nothing was saved. The list has been refreshed.`, reasons };
        selected = "";
        await load(true);
        if (!closed) { render("[data-sa-notice]"); }
        return;
      }
      if (status === 409 && detail?.code === "cross_level_confirmation_required") {
        crossConfirmed = false;
        notice = { tone: "error", title: "Call level confirmation needed.",
          text: `${String(detail.message ?? `${chosen.person_name} is on a different call level from this duty.`)} Nothing was saved. Read the warning, tick the call-level confirmation, then allocate again.` };
        await load(true);
        if (closed) return;
        render("[data-sa-notice]");
        return;
      }
      notice = status === 403 ? { tone: "error", title: "Not allowed.", text: "Only a superadmin can make this allocation. Nothing was saved." }
        : status === 404 ? { tone: "error", title: "Not found.", text: "This duty or person no longer exists. Nothing was saved. Close this window and refresh the page." }
          : status === 422 ? { tone: "error", title: "Check the details.", text: `${(error as Error).message} Nothing was saved.` }
            : isNetwork(error) ? { tone: "error", title: "No answer from the server.", text: "The allocation may or may not have been saved. Refresh the list to see who is on the duty before trying again." }
              : { tone: "error", title: "The allocation did not go through.", text: `${(error as Error).message || "Unknown error."} Nothing was saved.` };
      render("[data-sa-notice]");
      if (isNetwork(error)) {
        const host = dialog.querySelector<HTMLElement>("[data-sa-notice]");
        host?.insertAdjacentHTML("beforeend", '<button type="button" data-sa-refresh>Refresh the list</button>');
      }
    }
  }

  dialog.addEventListener("input", event => {
    const target = event.target as HTMLElement;
    if (target.matches("[data-sa-search]")) { query = (target as HTMLInputElement).value; paintList(); return; }
    if (target.matches("[data-sa-reason]")) { reason = (target as HTMLTextAreaElement).value; paintReason(dialog, reasonTouched); paintFooter(); }
  });
  dialog.addEventListener("focusout", event => {
    if ((event.target as HTMLElement).matches("[data-sa-reason]") && reason.length) { reasonTouched = true; paintReason(dialog, true); }
  });
  dialog.addEventListener("change", event => {
    const target = event.target as HTMLInputElement;
    if (target.name === "sa-person") {
      if (selected !== target.value) crossConfirmed = false;
      selected = target.value;
      paintList();
      paintSelection();
      dialog.querySelector<HTMLInputElement>(`input[name="sa-person"][value="${CSS.escape(selected)}"]`)?.focus();
      return;
    }
    if (target.matches("[data-sa-confirm]")) { confirmed = target.checked; paintFooter(); }
    if (target.matches("[data-sa-cross-confirm]")) { crossConfirmed = target.checked; paintFooter(); }
  });
  dialog.addEventListener("keydown", event => {
    // Enter in the search box must not submit or select anything.
    if (event.key === "Enter" && (event.target as HTMLElement).matches("[data-sa-search]")) event.preventDefault();
  });
  dialog.addEventListener("click", event => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button");
    if (!button || button.disabled) return;
    if (button.matches("[data-close]")) { if (busy !== "save") dialog.close(); return; }
    if (button.dataset.saFilter) { filter = button.dataset.saFilter as Filter; paintList(); return; }
    if (button.matches("[data-sa-allocate]")) {
      if (!reasonValid(reason)) { reasonTouched = true; paintReason(dialog, true); }
      void allocate(); return;
    }
    if (button.matches("[data-sa-retry]")) { void load(); return; }
    if (button.matches("[data-sa-refresh]")) { notice = null; void load(); return; }
    if (button.matches("[data-sa-undo]")) { void runUndo(true); return; }
    if (button.matches("[data-sa-undo-confirm]")) { void runUndo(false); return; }
    if (button.matches("[data-sa-undo-keep]")) { undo = { phase: "", restored: 0, text: "", conflicts: [] }; render("[data-sa-undo-panel]"); }
  });
  render();
  await load();
}

/* ----------------------------------------------------------------------------------------- */
/* Publish anyway dialog                                                                       */
/* ----------------------------------------------------------------------------------------- */

export async function openPublishAnyway(month: string, checklist: RotaPublishMonth, onDone: (result: RotaPublishMonth) => void): Promise<void> {
  const dialog = workspaceDialog("Publish anyway (superadmin)", "compute-workspace extra-duty-workspace superadmin-workspace superadmin-publish-workspace");
  dialog.setAttribute("aria-labelledby", "sa-publish-title");
  dialog.removeAttribute("aria-label");
  let busy = false;
  let closed = false;
  let reason = "";
  let confirmed = false;
  let touched = false;
  let error: { title: string; text: string } | null = null;
  let published: RotaPublishMonth | null = null;
  dialog.addEventListener("close", () => { closed = true; }, { once: true });
  dialog.addEventListener("cancel", event => { if (busy) event.preventDefault(); });

  const open = Number(checklist.summary.open_slots ?? 0);
  const ready = () => reasonValid(reason) && confirmed && !busy;
  const item = (i: { title: string; detail: string }) => `<li><strong>${esc(i.title)}</strong>${i.detail ? `<span>${esc(i.detail)}</span>` : ""}</li>`;

  function body() {
    if (published) return `<section class="superadmin-success superadmin-success--publish" role="status" tabindex="-1" data-sa-success aria-labelledby="sa-published-title">
        <span class="superadmin-success__icon" aria-hidden="true">✓</span>
        <div><h3 id="sa-published-title">Published with superadmin override</h3>
          <p>${esc(formatMonth(month))} is now the final rota${open ? `, with ${plural(open, "open slot")} shown as “Unfilled”` : ""}. The override, your reason and every open blocker are recorded in the approval and the 360° report.</p></div></section>`;
    return `<div class="superadmin-published-banner superadmin-published-banner--danger" role="note"><strong>This publishes the rota with problems still open.</strong> Everyone sees it as final. Open slots show as “Unfilled”.</div>
      <ul class="extra-duty-chips superadmin-publish-chips" aria-label="What is still open">
        <li class="extra-duty-chip extra-duty-chip--warning"><strong>${open}</strong><span>${open === 1 ? "open slot" : "open slots"}</span></li>
        <li class="extra-duty-chip extra-duty-chip--danger"><strong>${checklist.blockers.length}</strong><span>${checklist.blockers.length === 1 ? "blocker" : "blockers"}</span></li>
        <li class="extra-duty-chip extra-duty-chip--warning"><strong>${checklist.warnings.length}</strong><span>${checklist.warnings.length === 1 ? "warning" : "warnings"}</span></li>
      </ul>
      ${error ? `<div class="extra-duty-notice extra-duty-notice--error" role="alert" tabindex="-1" data-sa-notice><p><strong>${esc(error.title)}</strong> ${esc(error.text)}</p></div>` : ""}
      <section class="superadmin-issues superadmin-issues--blockers" aria-labelledby="sa-blockers-title">
        <h3 id="sa-blockers-title">Blockers you are overriding (${checklist.blockers.length})</h3>
        ${checklist.blockers.length ? `<ul>${checklist.blockers.map(item).join("")}</ul>` : "<p>None.</p>"}</section>
      <section class="superadmin-issues superadmin-issues--warnings" aria-labelledby="sa-warnings-title">
        <h3 id="sa-warnings-title">Warnings (${checklist.warnings.length})</h3>
        ${checklist.warnings.length ? `<ul>${checklist.warnings.map(item).join("")}</ul>` : "<p>None.</p>"}</section>
      <section class="superadmin-selection" aria-labelledby="sa-publish-confirm-title">
        <h3 id="sa-publish-confirm-title">Confirm</h3>
        ${reasonBlock("sa-publish", "I understand this publishes the rota with open slots and unresolved blockers", reason, confirmed)}
      </section>`;
  }
  function footer() {
    if (published) return `<p class="extra-duty-status" role="status"></p><button type="button" class="primary" data-close>Close</button>`;
    return `<p class="extra-duty-status" role="status" aria-live="polite" data-sa-status>${busy ? "Publishing… keep this window open." : ready() ? "Ready to publish." : `To publish, ${[!reasonValid(reason) ? `give a reason of at least ${REASON_MIN} characters` : "", !confirmed ? "tick the confirmation" : ""].filter(Boolean).join(", ")}.`}</p>
      <button type="button" data-close ${busy ? "disabled" : ""}>Cancel</button>
      <button type="button" class="superadmin-danger-button" data-sa-publish ${ready() ? "" : "disabled"}>${busy ? "Publishing…" : "Publish anyway"}</button>`;
  }
  function render(focus?: string) {
    if (closed) return;
    dialog.innerHTML = `<header class="mw-header superadmin-header superadmin-header--danger"><div>
        <p class="superadmin-eyebrow"><span aria-hidden="true">★</span> Superadmin only</p>
        <h2 id="sa-publish-title">Publish anyway (superadmin)</h2><p>${esc(formatMonth(month))} · overrides the publish checklist</p></div>
        <button type="button" data-close aria-label="Close publish anyway" ${busy ? "disabled" : ""}>Close</button></header>
      <div class="mw-content extra-duty-content superadmin-content">${body()}</div>
      <footer class="mw-footer extra-duty-footer superadmin-footer">${footer()}</footer>`;
    const target = focus ? dialog.querySelector<HTMLElement>(focus) : null;
    (target ?? dialog.querySelector<HTMLElement>("[data-sa-reason]") ?? dialog.querySelector<HTMLElement>("[data-close]"))?.focus({ preventScroll: !target });
    paintReason(dialog, touched);
  }
  function paintFooter() {
    const button = dialog.querySelector<HTMLButtonElement>("[data-sa-publish]");
    if (button) button.disabled = !ready();
    const status = dialog.querySelector<HTMLElement>("[data-sa-status]");
    if (status) status.textContent = ready() ? "Ready to publish." : `To publish, ${[!reasonValid(reason) ? `give a reason of at least ${REASON_MIN} characters` : "", !confirmed ? "tick the confirmation" : ""].filter(Boolean).join(", ")}.`;
  }
  async function publish() {
    if (!ready()) return;
    busy = true; error = null;
    render();
    try {
      const result = await request<RotaPublishMonth>(`/api/v1/rota-publish/publish?month=${encodeURIComponent(month)}`, {
        method: "POST",
        body: JSON.stringify({ confirm_warnings: true, approval_note: reason.trim(), superadmin_override: true, override_reason: reason.trim() }),
      });
      busy = false; published = result;
      announceToast("Published with superadmin override", "success");
      render("[data-sa-success]");
      try { onDone(result); } catch { /* keep the dialog usable */ }
    } catch (failure) {
      busy = false;
      const status = (failure as ApiError).status;
      error = status === 403 ? { title: "Not allowed.", text: "Only a superadmin can publish with an override. The rota was not published." }
        : isNetwork(failure) ? { title: "No answer from the server.", text: "The rota may or may not have been published. Close this window and reload Publish to check before trying again." }
          : { title: "The rota was not published.", text: (failure as Error).message || "Unknown error." };
      render("[data-sa-notice]");
    }
  }
  dialog.addEventListener("input", event => {
    if ((event.target as HTMLElement).matches("[data-sa-reason]")) { reason = (event.target as HTMLTextAreaElement).value; paintReason(dialog, touched); paintFooter(); }
  });
  dialog.addEventListener("focusout", event => {
    if ((event.target as HTMLElement).matches("[data-sa-reason]") && reason.length) { touched = true; paintReason(dialog, true); }
  });
  dialog.addEventListener("change", event => {
    if ((event.target as HTMLElement).matches("[data-sa-confirm]")) { confirmed = (event.target as HTMLInputElement).checked; paintFooter(); }
  });
  dialog.addEventListener("click", event => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button");
    if (!button || button.disabled) return;
    if (button.matches("[data-close]")) { if (!busy) dialog.close(); return; }
    if (button.matches("[data-sa-publish]")) void publish();
  });
  render();
}
