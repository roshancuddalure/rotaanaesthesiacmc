import { decorativeIcon } from "./decorative-icons";
/**
 * Limits (superadmin only) — docs/limits_callevel_fairness_contract.md §3 (API) and §4 (page).
 *
 * The page groups every limit into five cards (per member each month, rest after a 24-hour duty,
 * unit staffing, equal duties within a call level, extra duties). Each setting shows its label,
 * a plain explanation and a worked example from the API `fields`, a hard / can-be-exceeded badge,
 * its unit, "blank = no limit" where that applies, the saved value with a changed marker, and
 * inline validation. The equal-duties card also shows the computed per-call-level targets for a
 * chosen month.
 *
 * Saving: one sticky bar (unsaved count, Reset, "Save limits…") opens a confirmation that lists
 * each change as a sentence (POST /preview), the problems, the impact on the month, an optional
 * note and a required "I understand" box. PUT sends `base_revision`-style `base_version_id`:
 * 409 `stale_limits` offers to load the other version while keeping my edits on top; 422
 * `invalid_limits` puts the problems on the fields; 403 says only a superadmin can change limits.
 * History lists earlier versions and restores one after a confirmation.
 *
 * `limitsSpreadDebrief` is the compact, collapsible per-call-level spread table that Publish
 * shows under "Duty totals uneven within a call level".
 */
import {
  request,
  ApiRequestError,
  LIMIT_SECTION_KEYS,
  type CallLevelSpread,
  type CallLevelTarget,
  type LimitChange,
  type LimitField,
  type LimitProblem,
  type LimitSections,
  type LimitsHistoryEntry,
  type LimitsPreview,
  type LimitsRead,
} from "./services/api";
import { workspaceDialog } from "./member-workspace";
import { announceToast } from "./ui-feedback";
import { callLevelText } from "./extra-duty";
import { emptyState, esc, formatDate, formatMonth, pageSkeleton } from "./ui";

const API = "/api/v1/admin/limits";
const NOTE_MAX = 500;

export interface LimitsPageOptions {
  /** Month whose call-level targets are shown first (YYYY-MM). */
  month: string;
  onNavigate(view: string): void;
  /** False once the app has moved to another screen; late responses then do not paint. */
  isCurrent?: () => boolean;
}

// ---------------------------------------------------------------------------------------
// Cards and the fallback field list (the server's `fields` win; these keep the page usable
// and identical in wording if an older server omits them)
// ---------------------------------------------------------------------------------------

interface Card { section: string; id: string; title: string; intro: string }

const CARDS: Card[] = [
  { section: "duty_count_limits", id: "member", title: "Per member each month",
    intro: "Caps on how many duties one person can be given in a month. Leave a cap blank for no limit." },
  { section: "rest_rules", id: "rest", title: "Rest after a 24-hour duty",
    intro: "How long a member rests after a 24-hour duty before anything else can be booked." },
  { section: "unit_staffing_rules", id: "unit", title: "Unit staffing",
    intro: "How many people each unit keeps free every day, so duties and leave never empty a unit." },
  { section: "fairness_rules", id: "equal", title: "Equal duties within a call level",
    intro: "Everyone on the same call level should end the month with almost the same number of duties, all campuses together." },
  { section: "extra_duty_rules", id: "extra", title: "Extra duties (justice)",
    intro: "When a duty has to go to someone as an extra, whoever did the fewest extras recently goes first." },
];

const FALLBACK_FIELDS: LimitField[] = [
  { path: "duty_count_limits.max_24hr_per_month", section: "duty_count_limits", label: "Max 24-hour duties per member per month",
    help: "The most 24-hour duties one member can be given in a month.", example: "6 means nobody is given a 7th 24-hour duty that month.",
    kind: "int", min: 0, max: 31, unit: "duties", blank_means: "No limit", hard_or_soft: "hard" },
  { path: "duty_count_limits.max_weekend_24hr_per_month", section: "duty_count_limits", label: "Max weekend 24-hour duties per member per month",
    help: "The most Saturday or Sunday 24-hour duties one member can be given in a month.", example: "2 means at most two weekend 24-hour duties each.",
    kind: "int", min: 0, max: 10, unit: "duties", blank_means: "No limit", hard_or_soft: "hard" },
  { path: "duty_count_limits.max_same_group_per_month", section: "duty_count_limits", label: "Max duties of the same category per month",
    help: "The most duties of one category (for example PAC or CB) one member can be given in a month.", example: "4 means a fifth PAC duty goes to someone else.",
    kind: "int", min: 0, max: 31, unit: "duties", blank_means: "No limit", hard_or_soft: "hard" },
  { path: "duty_count_limits.max_same_campus_per_month", section: "duty_count_limits", label: "Max duties on the same campus per month",
    help: "The most duties one member can be given on one campus in a month.", example: "8 means the ninth duty on that campus goes to someone else.",
    kind: "int", min: 0, max: 31, unit: "duties", blank_means: "No limit", hard_or_soft: "hard" },
  { path: "rest_rules.minimum_gap_after_24hr_hours", section: "rest_rules", label: "Minimum rest after a 24-hour duty",
    help: "Hours that must pass after a 24-hour duty ends before the member's next duty starts.", example: "24 means a duty ending 8 am Tuesday leaves the member free until 8 am Wednesday.",
    kind: "hours", min: 0, max: 168, unit: "hours", blank_means: null, hard_or_soft: "hard" },
  { path: "rest_rules.post_24hr_blocks_next_day_elective", section: "rest_rules", label: "No elective work the day after a 24-hour duty",
    help: "When on, a member coming off a 24-hour duty is left off elective lists the next day.", example: "On: after Monday's 24-hour duty, the member is not on Tuesday's elective list.",
    kind: "bool", hard_or_soft: "hard" },
  { path: "unit_staffing_rules.minimum_available_count", section: "unit_staffing_rules", label: "Minimum people free in each unit",
    help: "The fewest members a unit must keep free each day, after duties and leave.", example: "1 means the last free person in a unit is never put on a duty.",
    kind: "int", min: 0, max: 99, unit: "people", blank_means: null, hard_or_soft: "hard" },
  { path: "unit_staffing_rules.warning_unavailable_percent", section: "unit_staffing_rules", label: "Warn when this share of a unit is away",
    help: "Review shows a warning once this share of a unit is on duty or on leave. Assignments still go ahead.", example: "30% in a unit of 10 warns from the 3rd person away.",
    kind: "percent", min: 0, max: 100, unit: "%", blank_means: null, hard_or_soft: "soft" },
  { path: "unit_staffing_rules.hard_block_unavailable_percent", section: "unit_staffing_rules", label: "Refuse when this share of a unit is away",
    help: "No more assignments are made in a unit once this share of it is on duty or on leave. Keep it above the warning share.", example: "40% in a unit of 10 refuses the 4th person away.",
    kind: "percent", min: 0, max: 100, unit: "%", blank_means: null, hard_or_soft: "hard" },
  { path: "unit_staffing_rules.small_unit_uses_absolute_minimum", section: "unit_staffing_rules", label: "Small units use the minimum number instead of percentages",
    help: "In small units a single person is already a large share, so only the minimum number above is used there.", example: "On: in a unit of 3, one person away (33%) is allowed as long as 1 stays free.",
    kind: "bool", hard_or_soft: "hard" },
  { path: "fairness_rules.max_gap_within_call_level", section: "fairness_rules", label: "Largest allowed gap within a call level",
    help: "The most that monthly duty totals may differ between two members of the same call level, all campuses together.", example: "1 means if the busiest 3rd call member has 7 duties, every other 3rd call member has 6 or 7.",
    kind: "int", min: 0, max: 10, unit: "duties", blank_means: null, hard_or_soft: "soft" },
  { path: "fairness_rules.target_mode", section: "fairness_rules", label: "How the target is worked out",
    help: "Automatic: the call level's duty slots in the month divided by its members available that month.", example: "60 slots ÷ 10 members = a target of 6 duties each.",
    kind: "choice", unit: null, blank_means: null, hard_or_soft: "guide", choices: [{ value: "auto", label: "Automatic (slots ÷ members)" }] },
  { path: "extra_duty_rules.justice_lookback_months", section: "extra_duty_rules", label: "Months counted for extra duties",
    help: "How far back the justice ledger looks when deciding who has done the fewest extra duties.", example: "12 means extras done in the last 12 months count; older ones are forgotten.",
    kind: "int", min: 1, max: 36, unit: "months", blank_means: null, hard_or_soft: "guide" },
];

const BADGES: Record<string, { text: string; title: string }> = {
  hard: { text: "Hard limit", title: "Never broken by generation, auto-fill or the extra-duty layer." },
  soft: { text: "Can be exceeded", title: "The rota can go past it; Review and Publish warn you when it does." },
  guide: { text: "Guide", title: "Steers who is chosen first; it never refuses anyone." },
};

const STAR = decorativeIcon("star", "limits-icon");
const WARN_ICON = decorativeIcon("warning", "limits-icon");

// ---------------------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------------------

type Raw = string | boolean;

interface State {
  root: HTMLElement;
  page: HTMLElement;
  opts: LimitsPageOptions;
  data: LimitsRead;
  fields: LimitField[];
  saved: LimitSections;
  raw: Record<string, Raw>;
  month: string;
  targets: CallLevelTarget[];
  targetsBusy: boolean;
  targetsError: string;
  serverProblems: LimitProblem[];
  status: { text: string; tone: "success" | "info" | "warning" | "danger" } | null;
  resetConfirm: boolean;
  /** Sentences for limits another superadmin saved while this page had edits (after a 409). */
  othersChanged: string[];
  forbidden: boolean;
  /** The save note survives closing the confirmation (e.g. to fix a field) until a save succeeds. */
  note: string;
}

let state: State | null = null;
let unloadBound = false;

/** True while the Limits page is on screen with edits that have not been saved. */
export function limitsHasUnsavedChanges(): boolean {
  const st = state;
  return Boolean(st && st.root.isConnected && st.root.contains(st.page) && changedPaths(st).length > 0);
}

/** Drops the in-memory draft when the signed-in user changes. Never saves anything. */
export function disposeLimitsPage(): void {
  state = null;
}

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const domId = (path: string) => `lim-${path.replace(/[^A-Za-z0-9_-]/g, "-")}`;
const sel = (value: string) => (typeof CSS !== "undefined" && CSS.escape ? CSS.escape(value) : value.replace(/"/g, '\\"'));
const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

function getPath(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((v, part) => (v && typeof v === "object" ? (v as Record<string, unknown>)[part] : undefined), obj);
}
function setPath(obj: unknown, path: string, value: unknown): void {
  const parts = path.split(".");
  const last = parts.pop()!;
  const target = parts.reduce<Record<string, unknown>>((acc, part) => {
    if (!acc[part] || typeof acc[part] !== "object") acc[part] = {};
    return acc[part] as Record<string, unknown>;
  }, obj as Record<string, unknown>);
  target[last] = value;
}

/** Server fields first, in server order, then any fallback field the server did not send. */
function mergeFields(server: LimitField[] | undefined): LimitField[] {
  const list = Array.isArray(server) && server.length ? server : [];
  const byPath = new Map(FALLBACK_FIELDS.map((f) => [f.path, f]));
  const merged = list.map((f) => ({ ...(byPath.get(f.path) ?? {}), ...f, section: f.section || f.path.split(".")[0] }) as LimitField);
  const seen = new Set(merged.map((f) => f.path));
  return [...merged, ...FALLBACK_FIELDS.filter((f) => !seen.has(f.path))];
}

function normalizeLimits(limits: Partial<LimitSections> | undefined, defaults: Partial<LimitSections> | undefined): LimitSections {
  const out = clone(defaults ?? {}) as Record<string, Record<string, unknown>>;
  for (const key of LIMIT_SECTION_KEYS) out[key] = { ...(out[key] ?? {}), ...((limits as Record<string, Record<string, unknown>> | undefined)?.[key] ?? {}) };
  if (out.fairness_rules.max_gap_within_call_level === undefined) out.fairness_rules.max_gap_within_call_level = 1;
  if (out.fairness_rules.target_mode === undefined) out.fairness_rules.target_mode = "auto";
  if (out.extra_duty_rules.justice_lookback_months === undefined) out.extra_duty_rules.justice_lookback_months = 12;
  return out as unknown as LimitSections;
}

function rawOf(field: LimitField, value: unknown): Raw {
  if (field.kind === "bool") return Boolean(value);
  if (value === null || value === undefined) return "";
  return String(value);
}

function rawFromSaved(st: Pick<State, "fields" | "saved">): Record<string, Raw> {
  return Object.fromEntries(st.fields.map((f) => [f.path, rawOf(f, getPath(st.saved, f.path))]));
}

const nullable = (field: LimitField) => Boolean(field.blank_means);
const minOf = (field: LimitField) => field.min ?? (field.kind === "percent" || field.kind === "hours" ? 0 : 0);
const maxOf = (field: LimitField) => field.max ?? (field.kind === "percent" ? 100 : field.kind === "hours" ? 168 : 999);

/** The value a raw input stands for, or `undefined` when it is not valid. */
function parsed(field: LimitField, raw: Raw): unknown {
  if (field.kind === "bool") return Boolean(raw);
  if (field.kind === "choice") return String(raw);
  const text = String(raw).trim();
  if (!text) return nullable(field) ? null : undefined;
  if (!/^\d+$/.test(text)) return undefined;
  const n = Number(text);
  return n < minOf(field) || n > maxOf(field) ? undefined : n;
}

function rangeText(field: LimitField): string {
  const unit = field.kind === "percent" ? "%" : "";
  return `${minOf(field)}${unit} to ${maxOf(field)}${unit}`;
}

/** Inline problems for one setting: its own range, the warning-below-hard rule, and server problems. */
function problemsFor(st: State, field: LimitField): { error: string; warning: string } {
  const raw = st.raw[field.path];
  let error = "";
  if (field.kind !== "bool" && field.kind !== "choice") {
    const text = String(raw ?? "").trim();
    if (!text && !nullable(field)) error = `Enter a whole number from ${rangeText(field)}. This setting cannot be blank.`;
    else if (text && !/^\d+$/.test(text)) error = `Use a whole number from ${rangeText(field)}${nullable(field) ? `, or leave it blank for ${String(field.blank_means).toLowerCase()}` : ""}.`;
    else if (text && parsed(field, raw) === undefined) error = `${text}${field.kind === "percent" ? "%" : ""} is out of range. Use ${rangeText(field)}${nullable(field) ? `, or leave it blank for ${String(field.blank_means).toLowerCase()}` : ""}.`;
  }
  if (!error && field.path === "unit_staffing_rules.hard_block_unavailable_percent") {
    const warn = parsed(fieldBy(st, "unit_staffing_rules.warning_unavailable_percent") ?? field, st.raw["unit_staffing_rules.warning_unavailable_percent"]);
    const hard = parsed(field, raw);
    if (typeof warn === "number" && typeof hard === "number" && warn >= hard) error = `The refuse share must be higher than the warning share (now warn at ${warn}%, refuse at ${hard}%).`;
  }
  const server = st.serverProblems.filter((p) => p.path === field.path);
  const serverError = server.find((p) => p.severity === "error");
  if (!error && serverError && !isChanged(st, field, serverError)) error = serverError.message;
  const warning = server.filter((p) => p.severity !== "error").map((p) => p.message).join(" ");
  return { error, warning };
}

/** A server problem goes stale once the user edits that field again. */
const problemSnapshot = new WeakMap<LimitProblem, Raw>();
function isChanged(st: State, field: LimitField, problem: LimitProblem): boolean {
  const snap = problemSnapshot.get(problem);
  return snap !== undefined && snap !== st.raw[field.path];
}

function fieldBy(st: Pick<State, "fields">, path: string): LimitField | undefined {
  return st.fields.find((f) => f.path === path);
}

function changedPaths(st: State): string[] {
  return st.fields.filter((f) => {
    const value = parsed(f, st.raw[f.path]);
    const saved = getPath(st.saved, f.path);
    if (value === undefined) return String(st.raw[f.path]) !== String(rawOf(f, saved));
    return JSON.stringify(value) !== JSON.stringify(saved ?? null);
  }).map((f) => f.path);
}

function errorPaths(st: State): string[] {
  return st.fields.filter((f) => problemsFor(st, f).error).map((f) => f.path);
}

function draftLimits(st: State): LimitSections {
  const out = clone(st.saved);
  for (const f of st.fields) {
    const value = parsed(f, st.raw[f.path]);
    if (value !== undefined) setPath(out, f.path, value);
  }
  return out;
}

function unitWord(field: LimitField, n: number): string {
  const unit = field.unit ?? "";
  if (!unit || unit === "%") return "";
  if (n === 1) return unit === "people" ? "person" : unit.replace(/ies$/, "y").replace(/s$/, "");
  return unit;
}

/** "6 duties", "40%", "24 hours", "No limit", "On". */
function valueText(field: LimitField, value: unknown): string {
  if (field.kind === "bool") return value ? "On" : "Off";
  if (field.kind === "choice") return (field.options ?? field.choices)?.find((c) => c.value === value)?.label ?? String(value ?? "");
  if (value === null || value === undefined || value === "") return field.blank_means || "Not set";
  const n = Number(value);
  if (field.kind === "percent" || field.unit === "%") return `${n}%`;
  const unit = unitWord(field, n);
  return unit ? `${n} ${unit}` : String(n);
}

function localSentence(field: LimitField, before: unknown, after: unknown): string {
  return `${field.label}: ${valueText(field, before).toLowerCase() === "no limit" ? "no limit" : valueText(field, before)} → ${valueText(field, after)}`;
}

function localChanges(st: State): LimitChange[] {
  return changedPaths(st).map((path) => {
    const field = fieldBy(st, path)!;
    const before = getPath(st.saved, path);
    const after = parsed(field, st.raw[path]);
    return { path, label: field.label, before, after, sentence: localSentence(field, before, after) };
  });
}

function formatWhen(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return String(iso);
  const time = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" }).format(date);
  return `${formatDate(iso, { weekday: false })}, ${time}`;
}

type ApiError = Error & { status?: number; detail?: unknown; kind?: string };
const detailOf = (error: unknown): Record<string, unknown> | null => {
  const detail = (error as ApiError)?.detail;
  return detail && typeof detail === "object" && !Array.isArray(detail) ? detail as Record<string, unknown> : null;
};
const statusOf = (error: unknown) => (error as ApiError)?.status;
const isNetwork = (error: unknown) => error instanceof ApiRequestError && (error.kind === "network" || error.kind === "timeout");
const problemsOf = (error: unknown): LimitProblem[] => {
  const list = detailOf(error)?.problems;
  return Array.isArray(list) ? list.map((p) => ({ path: String(p?.path ?? ""), severity: p?.severity === "warning" ? "warning" : "error", message: String(p?.message ?? "This value is not allowed.") })) : [];
};

// ---------------------------------------------------------------------------------------
// HTML builders
// ---------------------------------------------------------------------------------------

/** Server wording for the three kinds (`hard_or_soft_labels`), so the page and the docs agree. */
let serverBadgeLabels: Record<string, string> = {};
const badgeMeaning = (kind: string) => serverBadgeLabels[kind] || (BADGES[kind] ?? BADGES.hard).title;

function badgeHtml(kind: string): string {
  const b = BADGES[kind] ?? BADGES.hard;
  return `<span class="limits-badge limits-badge--${esc(kind in BADGES ? kind : "hard")}" title="${esc(badgeMeaning(kind))}">${esc(b.text)}</span>`;
}

function controlHtml(st: State, field: LimitField, id: string, describedBy: string, invalid: boolean): string {
  const raw = st.raw[field.path];
  const readOnly = !st.data.can_edit || st.forbidden;
  if (field.kind === "bool") {
    const on = Boolean(raw);
    return `<button type="button" role="switch" class="limits-switch" id="${id}" aria-checked="${on}" aria-describedby="${describedBy}"
        data-limit-switch="${esc(field.path)}" ${readOnly ? 'aria-disabled="true"' : ""}>
        <span class="limits-switch__track" aria-hidden="true"><span class="limits-switch__thumb"></span></span>
        <span class="limits-switch__text" data-switch-text>${on ? "On" : "Off"}</span></button>`;
  }
  if (field.kind === "choice") {
    const list = field.options?.length ? field.options : field.choices;
    const choices = list?.length ? list : [{ value: String(raw), label: String(raw) }];
    return `<select id="${id}" class="limits-select" aria-describedby="${describedBy}" data-limit-choice="${esc(field.path)}" ${readOnly ? "disabled" : ""}>
        ${choices.map((c) => `<option value="${esc(c.value)}" ${String(raw) === c.value ? "selected" : ""}>${esc(c.label)}</option>`).join("")}</select>`;
  }
  const unit = field.kind === "percent" ? "%" : field.unit ?? "";
  return `<div class="limits-input${invalid ? " is-invalid" : ""}">
      <input type="text" inputmode="numeric" autocomplete="off" spellcheck="false" id="${id}" value="${esc(raw)}"
        ${nullable(field) ? `placeholder="${esc(field.blank_means)}"` : ""} aria-describedby="${describedBy}" ${invalid ? 'aria-invalid="true"' : ""}
        data-limit-num="${esc(field.path)}" ${readOnly ? "readonly" : ""} />
      ${unit ? `<span class="limits-input__unit" aria-hidden="true">${esc(unit)}</span>` : ""}
    </div>`;
}

function metaHtml(st: State, field: LimitField): string {
  const id = domId(field.path);
  const savedValue = getPath(st.saved, field.path);
  const changed = changedPaths(st).includes(field.path);
  const { error, warning } = problemsFor(st, field);
  const next = parsed(field, st.raw[field.path]);
  const savedLine = changed
    ? `<p class="limits-saved is-changed" id="${id}-saved"><span class="limits-changed-pill">Changed</span> <span>Saved: <strong>${esc(valueText(field, savedValue))}</strong>${next !== undefined ? ` → new: <strong>${esc(valueText(field, next))}</strong>` : ""}</span></p>`
    : `<p class="limits-saved" id="${id}-saved"><span>Saved: <strong>${esc(valueText(field, savedValue))}</strong></span></p>`;
  return `${nullable(field) ? `<p class="limits-blank" id="${id}-blank">Blank = ${esc(String(field.blank_means).toLowerCase())}</p>` : ""}
    ${savedLine}
    <p class="limits-error" id="${id}-err" ${error ? "" : "hidden"}>${error ? `${WARN_ICON}<span>${esc(error)}</span>` : ""}</p>
    ${warning ? `<p class="limits-warning" id="${id}-warn">${WARN_ICON}<span>${esc(warning)}</span></p>` : ""}`;
}

function settingHtml(st: State, field: LimitField): string {
  const id = domId(field.path);
  const changed = changedPaths(st).includes(field.path);
  const { error, warning } = problemsFor(st, field);
  const describedBy = [`${id}-help`, `${id}-ex`, nullable(field) ? `${id}-blank` : "", `${id}-saved`, error ? `${id}-err` : "", warning ? `${id}-warn` : ""].filter(Boolean).join(" ");
  return `<div class="limits-setting${changed ? " is-changed" : ""}${error ? " is-invalid" : ""}" data-setting="${esc(field.path)}">
    <div class="limits-setting__text">
      <div class="limits-setting__head">
        <label class="limits-setting__label" for="${id}" id="${id}-label">${esc(field.label)}</label>
        ${badgeHtml(field.hard_or_soft)}
      </div>
      <p class="limits-setting__help" id="${id}-help">${esc(field.help)}</p>
      ${field.example ? `<p class="limits-setting__example" id="${id}-ex"><span class="limits-setting__example-tag">Example</span> <span>${esc(field.example)}</span></p>` : `<span hidden id="${id}-ex"></span>`}
    </div>
    <div class="limits-setting__control">
      ${controlHtml(st, field, id, describedBy, Boolean(error))}
      <div class="limits-setting__meta" data-meta="${esc(field.path)}">${metaHtml(st, field)}</div>
    </div>
  </div>`;
}

function targetsHtml(st: State): string {
  const gapField = fieldBy(st, "fairness_rules.max_gap_within_call_level");
  const gap = gapField ? parsed(gapField, st.raw[gapField.path]) : 1;
  const rows = st.targets;
  const body = st.targetsError
    ? `<p class="limits-targets__empty is-error" role="alert">${esc(st.targetsError)} <button type="button" class="quiet-button btn-sm" data-targets-retry>Try again</button></p>`
    : !rows.length
      ? `<p class="limits-targets__empty">No targets for ${esc(formatMonth(st.month))} yet. They appear once the month's duty slots exist (generate the template in Rota Template).</p>`
      : `<div class="limits-table-wrap"><table class="limits-table">
          <caption class="visually-hidden">Equal-duty targets per call level, ${esc(formatMonth(st.month))}</caption>
          <thead><tr><th scope="col">Call level</th><th scope="col" class="is-num">Duty slots</th><th scope="col" class="is-num">Members</th><th scope="col" class="is-num">Target each</th><th scope="col">Expected</th></tr></thead>
          <tbody>${rows.map((t) => {
            const label = t.label || callLevelText(t.call_level);
            const range = t.min_expected === t.max_expected ? `${t.min_expected} duties each` : `${t.min_expected} or ${t.max_expected} duties each`;
            return `<tr><th scope="row" data-label="Call level">${esc(label)}</th>
              <td class="is-num" data-label="Duty slots">${esc(t.slots)}</td>
              <td class="is-num" data-label="Members">${esc(t.members)}</td>
              <td class="is-num" data-label="Target each"><strong>${esc(Number(t.target).toFixed(2).replace(/\.00$/, ""))}</strong></td>
              <td data-label="Expected">${t.members ? esc(range) : "No members this month"}</td></tr>`;
          }).join("")}</tbody></table></div>`;
  return `<section class="limits-targets" aria-labelledby="lim-targets-title" ${st.targetsBusy ? 'aria-busy="true"' : ""}>
      <div class="limits-targets__head">
        <div><h4 id="lim-targets-title">Targets for ${esc(formatMonth(st.month))}</h4>
          <p>Target = the call level's duty slots in the month ÷ its members available that month.${typeof gap === "number" ? ` With a gap of ${esc(gap)}, the busiest and the least busy member of a level may differ by at most ${esc(plural(gap, "duty", "duties"))}.` : ""}</p></div>
        <label class="limits-month" for="lim-month"><span>Month</span><input type="month" id="lim-month" value="${esc(st.month)}" data-targets-month /></label>
      </div>
      <div data-targets-body>${st.targetsBusy ? `<p class="limits-targets__empty" role="status">Working out the targets for ${esc(formatMonth(st.month))}…</p>` : body}</div>
      <p class="limits-targets__note">The extra-duty layer and superadmin allocations may break equality; Publish and the 360° report show when they do.</p>
    </section>`;
}

function cardHtml(st: State, base: Card): string {
  const server = st.data.sections?.find((s) => s.key === base.section);
  const card = { ...base, title: server?.title || base.title, intro: server?.intro || base.intro };
  const fields = st.fields.filter((f) => f.section === card.section);
  if (!fields.length && card.section !== "fairness_rules") return "";
  const changed = changedPaths(st).filter((p) => fields.some((f) => f.path === p)).length;
  const bad = errorPaths(st).filter((p) => fields.some((f) => f.path === p)).length;
  return `<section class="limits-card panel" id="lim-card-${card.id}" aria-labelledby="lim-card-${card.id}-title" data-card="${card.section}">
    <header class="limits-card__head">
      <div><h3 id="lim-card-${card.id}-title">${esc(card.title)}</h3><p>${esc(card.intro)}</p></div>
      <div class="limits-card__flags" data-card-flags="${card.section}">${cardFlags(changed, bad)}</div>
    </header>
    <div class="limits-card__body">${fields.map((f) => settingHtml(st, f)).join("")}</div>
    ${card.section === "fairness_rules" ? `<div data-part="targets">${targetsHtml(st)}</div>` : ""}
  </section>`;
}

function cardFlags(changed: number, bad: number): string {
  return `${changed ? `<span class="limits-flag is-info">${plural(changed, "change")}</span>` : ""}${bad ? `<span class="limits-flag is-danger">${plural(bad, "problem")}</span>` : ""}`;
}

function heroHtml(st: State): string {
  const d = st.data;
  const editable = d.can_edit && !st.forbidden;
  return `<section class="limits-hero panel" aria-labelledby="lim-title">
    <div class="limits-hero__top">
      <div class="limits-hero__text">
        <p class="limits-eyebrow">${STAR} Superadmin only</p>
        <h3 id="lim-title">Limits for every rota</h3>
        <p>Limits are the boundaries every rota stays inside: how many duties one person can be given, how long they rest after a 24-hour duty, how many people each unit keeps free, and how evenly duties are shared within a call level. Generation, auto-fill and the extra-duty layer all follow them.</p>
      </div>
      <div class="limits-hero__actions"><button type="button" class="icon-button" data-limits-history>History</button></div>
    </div>
    <ul class="limits-legend" aria-label="What the badges mean">
      <li>${badgeHtml("hard")}<span>${esc(serverBadgeLabels.hard ? `${serverBadgeLabels.hard}.` : "")} Generation, auto-fill and the extra-duty layer never go past it; only a superadmin allocation can, and that is recorded.</span></li>
      <li>${badgeHtml("soft")}<span>${esc(serverBadgeLabels.soft ? `${serverBadgeLabels.soft}.` : "The rota can go past it.")} Review and Publish warn you when it does.</span></li>
      <li>${badgeHtml("guide")}<span>${esc(serverBadgeLabels.guide ? `${serverBadgeLabels.guide}.` : "Steers who is chosen first. It never refuses anyone.")}</span></li>
    </ul>
    <div class="limits-hero__foot">
      <p class="limits-version" data-part="version">${versionText(st)}</p>
      <p class="limits-who">${editable ? "Only a superadmin can change limits. Saved limits apply the next time a rota is generated, filled or checked; rotas already made are not changed." : "<strong>View only.</strong> Only a superadmin can change limits."}</p>
    </div>
    <nav class="limits-toc" aria-label="Limit groups">${CARDS.map((c) => `<a href="#lim-card-${c.id}" data-toc="${c.id}">${esc(c.title)}</a>`).join("")}</nav>
  </section>`;
}

function versionText(st: State): string {
  const d = st.data;
  if (!d.saved_at) return "Using the default limits; nothing has been saved on this page yet.";
  return `Saved ${esc(formatWhen(d.saved_at))}${d.saved_by ? ` by <strong>${esc(d.saved_by)}</strong>` : ""}.`;
}

function noticesHtml(st: State): string {
  if (!st.othersChanged.length) return "";
  return `<div class="limits-notice limits-notice--warning" role="note" data-limits-others>
      <p><strong>Someone else saved limits while you were editing.</strong> Their values are now the saved values. Your own edits are kept on top.</p>
      <ul>${st.othersChanged.map((s) => `<li>${esc(s)}</li>`).join("")}</ul>
      <button type="button" class="quiet-button btn-sm" data-dismiss-others>Got it</button>
    </div>`;
}

function savebarHtml(st: State): string {
  const changes = changedPaths(st);
  const errors = errorPaths(st);
  const editable = st.data.can_edit && !st.forbidden;
  const names = changes.slice(0, 3).map((p) => fieldBy(st, p)?.label ?? p);
  const what = names.join(" · ") + (changes.length > 3 ? ` · +${changes.length - 3} more` : "");
  if (!editable) {
    return `<div class="limits-savebar is-readonly" role="region" aria-label="Save limits">
      <p class="limits-savebar__text"><strong>View only</strong><span>Only a superadmin can change limits.</span></p></div>`;
  }
  const reason = !changes.length ? "Change a limit above to save." : errors.length ? `Fix ${plural(errors.length, "problem")} above to save.` : "Review the changes before they are saved.";
  if (st.resetConfirm && changes.length) {
    return `<div class="limits-savebar is-confirm" role="region" aria-label="Save limits">
      <p class="limits-savebar__text"><strong>Reset ${plural(changes.length, "change")}?</strong><span>Every limit goes back to its saved value.</span></p>
      <div class="limits-savebar__actions">
        <button type="button" class="quiet-button" data-reset-keep>Keep my changes</button>
        <button type="button" class="primary" data-reset-yes>Yes, reset</button>
      </div></div>`;
  }
  return `<div class="limits-savebar${changes.length ? " has-changes" : ""}" role="region" aria-label="Save limits">
      <p class="limits-savebar__text"><strong data-limits-unsaved>${changes.length ? plural(changes.length, "unsaved change") : "All limits are saved"}</strong>
        <span id="lim-save-reason">${changes.length ? esc(what) : esc(reason)}</span>
        ${changes.length && errors.length ? `<button type="button" class="limits-linkish" data-goto-error>${esc(reason)}</button>` : ""}</p>
      <div class="limits-savebar__actions">
        <button type="button" class="quiet-button" data-limits-reset ${changes.length ? "" : "disabled"}>Reset</button>
        <button type="button" class="primary" data-limits-save ${changes.length && !errors.length ? "" : "disabled"} aria-describedby="lim-save-reason">Save limits…</button>
      </div></div>`;
}

function pageHtml(st: State): string {
  return `${heroHtml(st)}
    <div data-part="notices" class="limits-notices">${noticesHtml(st)}</div>
    ${CARDS.map((c) => cardHtml(st, c)).join("")}
    <div class="limits-dock">
      <div class="limits-status" data-part="status" role="status" aria-live="polite" tabindex="-1"></div>
      <div data-part="savebar">${savebarHtml(st)}</div>
    </div>`;
}

// ---------------------------------------------------------------------------------------
// Painting
// ---------------------------------------------------------------------------------------

function part(st: State, name: string): HTMLElement | null {
  return st.page.querySelector<HTMLElement>(`[data-part="${name}"]`);
}

/** Updates markers, errors, card flags and the save bar without touching the inputs. */
function paintMeta(st: State): void {
  const changed = new Set(changedPaths(st));
  for (const field of st.fields) {
    const row = st.page.querySelector<HTMLElement>(`[data-setting="${sel(field.path)}"]`);
    if (!row) continue;
    const { error, warning } = problemsFor(st, field);
    row.classList.toggle("is-changed", changed.has(field.path));
    row.classList.toggle("is-invalid", Boolean(error));
    const meta = row.querySelector<HTMLElement>("[data-meta]");
    if (meta) meta.innerHTML = metaHtml(st, field);
    const id = domId(field.path);
    const control = row.querySelector<HTMLElement>(`#${sel(id)}`);
    if (control) {
      control.setAttribute("aria-describedby", [`${id}-help`, `${id}-ex`, nullable(field) ? `${id}-blank` : "", `${id}-saved`, error ? `${id}-err` : "", warning ? `${id}-warn` : ""].filter(Boolean).join(" "));
      if (control instanceof HTMLInputElement) {
        if (error) control.setAttribute("aria-invalid", "true"); else control.removeAttribute("aria-invalid");
        control.parentElement?.classList.toggle("is-invalid", Boolean(error));
      }
    }
  }
  for (const card of CARDS) {
    const flags = st.page.querySelector<HTMLElement>(`[data-card-flags="${card.section}"]`);
    if (!flags) continue;
    const fields = st.fields.filter((f) => f.section === card.section).map((f) => f.path);
    flags.innerHTML = cardFlags(fields.filter((p) => changed.has(p)).length, errorPaths(st).filter((p) => fields.includes(p)).length);
  }
  paintSavebar(st);
}

function paintSavebar(st: State): void {
  const host = part(st, "savebar");
  if (!host) return;
  const active = document.activeElement as HTMLElement | null;
  const key = active && host.contains(active) ? ["data-limits-reset", "data-limits-save", "data-reset-keep", "data-reset-yes", "data-goto-error"].find((a) => active.hasAttribute(a)) : undefined;
  host.innerHTML = savebarHtml(st);
  if (key) {
    const next = host.querySelector<HTMLElement>(`[${key}]`) ?? host.querySelector<HTMLElement>("[data-limits-reset], [data-limits-save]");
    if (next && !(next as HTMLButtonElement).disabled) next.focus({ preventScroll: true });
    else host.querySelector<HTMLElement>("[data-limits-save]:not([disabled]), [data-limits-reset]:not([disabled])")?.focus({ preventScroll: true });
  }
}

function paintTargets(st: State): void {
  const host = part(st, "targets");
  if (!host) return;
  const active = document.activeElement;
  const hadMonth = active instanceof HTMLInputElement && active.matches("[data-targets-month]");
  host.innerHTML = targetsHtml(st);
  if (hadMonth) host.querySelector<HTMLInputElement>("[data-targets-month]")?.focus({ preventScroll: true });
}

function paintAll(st: State): void {
  const scroll = window.scrollY;
  st.page.innerHTML = pageHtml(st);
  paintStatus(st);
  window.scrollTo({ top: scroll });
}

function paintStatus(st: State): void {
  const region = part(st, "status");
  if (!region) return;
  region.className = `limits-status${st.status ? ` is-${st.status.tone}` : ""}`;
  region.innerHTML = st.status ? `<span>${esc(st.status.text)}</span><button type="button" class="quiet-button btn-sm" data-status-dismiss aria-label="Dismiss message">Dismiss</button>` : "";
}

function setStatus(st: State, text: string, tone: "success" | "info" | "warning" | "danger" = "info", focus = false): void {
  st.status = text ? { text, tone } : null;
  paintStatus(st);
  if (focus) part(st, "status")?.focus({ preventScroll: true });
}

function focusSetting(st: State, path: string): void {
  const control = st.page.querySelector<HTMLElement>(`#${sel(domId(path))}`);
  const row = st.page.querySelector<HTMLElement>(`[data-setting="${sel(path)}"]`);
  row?.scrollIntoView({ block: "center", behavior: reducedMotion() ? "auto" : "smooth" });
  control?.focus({ preventScroll: true });
}

// ---------------------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------------------

function getLimits(month: string, signal?: AbortSignal): Promise<LimitsRead> {
  return request<LimitsRead>(`${API}?month=${encodeURIComponent(month)}`, { signal });
}

function applyRead(st: State, read: LimitsRead, keepEdits: boolean): void {
  const mine = keepEdits ? changedPaths(st).map((p) => [p, st.raw[p]] as const) : [];
  st.data = read;
  if (read.hard_or_soft_labels && typeof read.hard_or_soft_labels === "object") serverBadgeLabels = { ...read.hard_or_soft_labels };
  st.fields = mergeFields(read.fields);
  st.saved = normalizeLimits(read.limits, read.defaults);
  st.targets = Array.isArray(read.targets) ? read.targets : [];
  st.targetsError = "";
  st.raw = rawFromSaved(st);
  for (const [path, raw] of mine) if (st.fields.some((f) => f.path === path)) st.raw[path] = raw;
  st.forbidden = st.forbidden && !read.can_edit;
}

async function reloadTargets(st: State): Promise<void> {
  st.targetsBusy = true;
  st.targetsError = "";
  paintTargets(st);
  const month = st.month;
  try {
    const read = await getLimits(month);
    if (state !== st || st.month !== month) return;
    st.targets = Array.isArray(read.targets) ? read.targets : [];
  } catch (error) {
    if (state !== st || st.month !== month) return;
    st.targetsError = isNetwork(error) ? "Could not reach the server to work out the targets." : `Could not work out the targets: ${(error as Error).message || "unknown error"}.`;
  }
  st.targetsBusy = false;
  paintTargets(st);
}

// ---------------------------------------------------------------------------------------
// Save: preview, confirm, 409 / 422 / 403
// ---------------------------------------------------------------------------------------

async function openSaveDialog(st: State): Promise<void> {
  if (!changedPaths(st).length || errorPaths(st).length) return;
  const dialog = workspaceDialog("Save limits", "limits-dialog");
  dialog.setAttribute("aria-labelledby", "lim-save-title");
  dialog.removeAttribute("aria-label");
  type Phase = "preview" | "ready" | "saving" | "stale" | "reloading";
  let phase: Phase = "preview";
  let preview: LimitsPreview | null = null;
  let previewFailed = "";
  let note = st.note;
  let understood = false;
  let notice: { tone: "error" | "warning" | "info"; title: string; text: string } | null = null;
  let closed = false;
  const wasForbidden = st.forbidden;
  dialog.addEventListener("close", () => {
    closed = true;
    // After a 403 the page turns view only (edits stay visible, nothing can be saved).
    if (st.forbidden && !wasForbidden && state === st) paintAll(st);
  }, { once: true });
  dialog.addEventListener("cancel", (event) => { if (phase === "saving") event.preventDefault(); });

  const changes = () => (preview?.changes?.length ? preview.changes : localChanges(st));
  const problems = () => {
    const list = [...(preview?.problems ?? [])];
    for (const p of st.serverProblems) {
      const field = fieldBy(st, p.path);
      if (field && isChanged(st, field, p)) continue;
      if (!list.some((q) => q.path === p.path && q.message === p.message)) list.push(p);
    }
    return list;
  };
  const errors = () => problems().filter((p) => p.severity === "error");
  const ready = () => phase === "ready" && understood && !errors().length && changes().length > 0 && !st.forbidden;
  const missing = () => {
    if (phase === "preview") return "Working out what changes…";
    if (phase === "saving") return "Saving… keep this window open.";
    if (phase === "stale" || phase === "reloading") return "Nothing was saved.";
    if (st.forbidden) return "Only a superadmin can change limits.";
    if (errors().length) return `Fix ${plural(errors().length, "problem")} before saving.`;
    if (!understood) return "Tick “I understand” to save.";
    return "Ready to save.";
  };
  const labelOf = (path: string) => fieldBy(st, path)?.label ?? (path || "Limits");

  function impactHtml(): string {
    if (phase === "preview") return `<p class="limits-dialog__busy" role="status">Checking ${esc(formatMonth(st.month))} with the new limits…</p>`;
    if (previewFailed) return `<div class="limits-impact limits-impact--unknown"><p><strong>Could not work out the impact right now.</strong> ${esc(previewFailed)} You can still save; the server checks every value again.</p></div>`;
    const impact = preview?.impact;
    if (!impact) return errors().length ? `<div class="limits-impact limits-impact--unknown"><p>The impact is worked out once the problems above are fixed.</p></div>` : "";
    const n = Number(impact.over_limit_people ?? 0);
    const names = impact.members_over ?? [];
    if (!n) return `<div class="limits-impact limits-impact--ok"><p><strong>No member in ${esc(formatMonth(st.month))} would be over a limit.</strong> The month's current duties all fit the new limits.</p></div>`;
    const more = n - names.length;
    return `<div class="limits-impact limits-impact--warn">
        <p><strong>${esc(impact.sentence || `With these limits, ${plural(n, "member")} in ${formatMonth(st.month)} would be over a limit.`)}</strong> Their current duties are not removed; Review and Publish will list them.</p>
        ${names.length ? `<p class="limits-impact__names">${esc(names.join(", "))}${more > 0 ? ` and ${esc(plural(more, "more"))}` : ""}</p>` : ""}
      </div>`;
  }

  function body(): string {
    const list = changes();
    const errs = errors();
    const warns = problems().filter((p) => p.severity !== "error");
    const problem = (p: LimitProblem) => `<li class="limits-problem is-${p.severity === "error" ? "error" : "warning"}">
        ${WARN_ICON}<div><p><span class="visually-hidden">${p.severity === "error" ? "Error" : "Warning"}: </span><strong>${esc(labelOf(p.path))}</strong>: ${esc(p.message)}</p></div>
        ${p.path && fieldBy(st, p.path) ? `<button type="button" class="icon-button btn-sm" data-goto-setting="${esc(p.path)}" aria-label="Go to setting: ${esc(labelOf(p.path))}">Go to setting</button>` : ""}</li>`;
    return `
      ${notice ? `<div class="limits-notice limits-notice--${notice.tone}" ${notice.tone === "error" ? 'role="alert"' : 'role="status"'} tabindex="-1" data-dialog-notice>
          <p><strong>${esc(notice.title)}</strong> ${esc(notice.text)}</p>
          ${phase === "stale" ? `<div class="button-row"><button type="button" class="primary btn-sm" data-stale-load>Load their version and keep my edits</button></div>` : ""}
        </div>` : ""}
      <section class="limits-dialog__section" aria-labelledby="lim-dlg-changes">
        <h3 id="lim-dlg-changes"><span class="limits-count">${list.length}</span> ${list.length === 1 ? "change" : "changes"}</h3>
        ${list.length ? `<ul class="limits-sentences">${list.map((c) => `<li>${esc(c.sentence || `${c.label}: ${String(c.before)} → ${String(c.after)}`)}</li>`).join("")}</ul>` : `<p class="limits-muted">Nothing to save: your edits match the saved limits.</p>`}
      </section>
      ${errs.length ? `<section class="limits-dialog__section" aria-labelledby="lim-dlg-errors"><h3 id="lim-dlg-errors"><span class="limits-count is-danger">${errs.length}</span> Must be fixed before saving</h3><ul class="limits-problems">${errs.map(problem).join("")}</ul></section>` : ""}
      ${warns.length ? `<section class="limits-dialog__section" aria-labelledby="lim-dlg-warns"><h3 id="lim-dlg-warns"><span class="limits-count is-warning">${warns.length}</span> Worth a look (saving is still allowed)</h3><ul class="limits-problems">${warns.map(problem).join("")}</ul></section>` : ""}
      <section class="limits-dialog__section" aria-labelledby="lim-dlg-impact">
        <h3 id="lim-dlg-impact">Impact on ${esc(formatMonth(st.month))}</h3>
        ${impactHtml()}
      </section>
      <section class="limits-dialog__section limits-confirm" aria-labelledby="lim-dlg-confirm">
        <h3 id="lim-dlg-confirm">Confirm</h3>
        <label for="lim-note" class="limits-note-label">Note <span class="limits-muted">(optional, shown in History)</span></label>
        <textarea id="lim-note" rows="2" maxlength="${NOTE_MAX}" data-limits-note aria-describedby="lim-note-count" ${phase === "saving" ? "disabled" : ""}>${esc(note)}</textarea>
        <p class="limits-note-count" id="lim-note-count" data-note-count>${note.length} / ${NOTE_MAX}</p>
        <label class="limits-check"><input type="checkbox" data-limits-understand ${understood ? "checked" : ""} ${phase === "saving" ? "disabled" : ""} />
          <span>I understand this changes how every rota is generated</span></label>
      </section>`;
  }

  function footer(): string {
    return `<p class="limits-dialog__status" role="status" aria-live="polite" data-dialog-status>${esc(missing())}</p>
      <button type="button" data-close ${phase === "saving" ? "disabled" : ""}>Keep editing</button>
      <button type="button" class="primary" data-confirm-save ${ready() ? "" : "disabled"}>${phase === "saving" ? "Saving…" : "Confirm and save"}</button>`;
  }

  function render(focus?: string): void {
    if (closed) return;
    const active = document.activeElement as HTMLElement | null;
    const keep = active && dialog.contains(active) ? (active.matches("[data-limits-note]") ? "[data-limits-note]" : active.matches("[data-limits-understand]") ? "[data-limits-understand]" : "") : "";
    dialog.innerHTML = `<header class="mw-header limits-dialog__header"><div>
        <p class="limits-eyebrow">${STAR} Superadmin only</p>
        <h2 id="lim-save-title">Save limits</h2><p>Nothing changes until you confirm.</p></div>
        <button type="button" data-close aria-label="Close save limits" ${phase === "saving" ? "disabled" : ""}>Close</button></header>
      <div class="mw-content limits-dialog__content">${body()}</div>
      <footer class="mw-footer limits-dialog__footer">${footer()}</footer>`;
    const target = (focus && dialog.querySelector<HTMLElement>(focus)) || (keep && dialog.querySelector<HTMLElement>(keep)) || null;
    (target ?? dialog.querySelector<HTMLElement>("[data-limits-understand]") ?? dialog.querySelector<HTMLElement>("[data-close]"))?.focus({ preventScroll: !target });
  }
  function paintFooter(): void {
    const button = dialog.querySelector<HTMLButtonElement>("[data-confirm-save]");
    if (button) button.disabled = !ready();
    const status = dialog.querySelector<HTMLElement>("[data-dialog-status]");
    if (status) status.textContent = missing();
  }

  async function runPreview(): Promise<void> {
    phase = "preview";
    preview = null;
    previewFailed = "";
    render();
    try {
      const result = await request<LimitsPreview>(`${API}/preview`, { method: "POST", body: JSON.stringify({ limits: draftLimits(st), month: st.month }) });
      if (closed) return;
      preview = { changes: result.changes ?? [], problems: result.problems ?? [], impact: result.impact ?? null };
    } catch (error) {
      if (closed) return;
      if (statusOf(error) === 403) { st.forbidden = true; notice = { tone: "error", title: "Not allowed.", text: "Only a superadmin can change limits. Nothing was saved." }; }
      else if (statusOf(error) === 422 && problemsOf(error).length) {
        preview = { changes: localChanges(st), problems: problemsOf(error), impact: { over_limit_people: 0, members_over: [] } };
      } else previewFailed = isNetwork(error) ? "No answer from the server." : (error as Error).message || "Unknown error.";
    }
    phase = "ready";
    render(notice ? "[data-dialog-notice]" : errors().length ? "[data-goto-setting]" : undefined);
  }

  async function save(): Promise<void> {
    if (!ready()) return;
    phase = "saving";
    notice = null;
    render("[data-confirm-save]");
    const count = changes().length;
    try {
      const saved = await request<LimitsRead>(API, { method: "PUT", body: JSON.stringify({ limits: draftLimits(st), base_version_id: st.data.version_id, note: note.trim() || null, month: st.month }) });
      if (state !== st) { dialog.close(); return; }
      st.serverProblems = [];
      st.othersChanged = [];
      st.note = "";
      applyRead(st, saved?.limits ? saved : await getLimits(st.month), false);
      dialog.close();
      st.resetConfirm = false;
      paintAll(st);
      announceToast(`Limits saved: ${plural(count, "change")}`, "success");
      setStatus(st, `Limits saved: ${plural(count, "change")}. They apply the next time a rota is generated, filled or checked.`, "success", true);
      return;
    } catch (error) {
      if (closed) return;
      const status = statusOf(error);
      const detail = detailOf(error);
      phase = "ready";
      if (status === 409 && (detail?.code === "stale_limits" || !detail?.code)) {
        phase = "stale";
        notice = { tone: "warning", title: "Someone else saved limits after you opened this page.", text: "Nothing was saved. Load their version: your edits stay on top, and you can check them here before saving." };
      } else if (status === 422 && detail?.code === "no_limit_changes") {
        notice = { tone: "info", title: "Nothing to save.", text: "These values are already the saved limits. Close this window and reload the page to see them." };
      } else if (status === 422) {
        const list = problemsOf(error);
        st.serverProblems = list;
        for (const p of list) { const f = fieldBy(st, p.path); if (f) problemSnapshot.set(p, st.raw[f.path]); }
        preview = { changes: preview?.changes ?? localChanges(st), problems: list, impact: preview?.impact ?? { over_limit_people: 0, members_over: [] } };
        notice = { tone: "error", title: "The server refused these limits.", text: list.length ? "Fix the problems below; they are also marked on the page." : `${String(detail?.message ?? (error as Error).message)} Nothing was saved.` };
        paintMeta(st);
      } else if (status === 403) {
        st.forbidden = true;
        notice = { tone: "error", title: "Not allowed.", text: "Only a superadmin can change limits. Nothing was saved; your edits are still on the page." };
      } else if (isNetwork(error)) {
        notice = { tone: "error", title: "No answer from the server.", text: "The limits may or may not have been saved. Close this window and reload the page to check before trying again." };
      } else {
        notice = { tone: "error", title: "The limits were not saved.", text: (error as Error).message || "Unknown error." };
      }
      render("[data-dialog-notice]");
    }
  }

  async function loadTheirs(): Promise<void> {
    phase = "reloading";
    render("[data-dialog-notice]");
    try {
      const latest = await getLimits(st.month);
      if (closed || state !== st) return;
      const before = clone(st.saved);
      const beforeBy = st.data.saved_by;
      applyRead(st, latest, true);
      st.othersChanged = st.fields.flatMap((f) => {
        const a = getPath(before, f.path), b = getPath(st.saved, f.path);
        return JSON.stringify(a ?? null) === JSON.stringify(b ?? null) ? [] : [`${localSentence(f, a, b)}${latest.saved_by && latest.saved_by !== beforeBy ? ` (saved by ${latest.saved_by})` : ""}`];
      });
      paintAll(st);
      notice = { tone: "info", title: "Their version is loaded.", text: st.othersChanged.length ? `${plural(st.othersChanged.length, "limit")} changed in their save. Your edits are kept on top; check the list, then confirm.` : "Your edits are kept on top; check the list, then confirm." };
      understood = false;
      if (!changedPaths(st).length) {
        notice = { tone: "info", title: "Their version is loaded.", text: "It already has the values you wanted, so there is nothing left to save." };
        phase = "ready";
        preview = { changes: [], problems: [], impact: { over_limit_people: 0, members_over: [] } };
        render("[data-dialog-notice]");
        return;
      }
      await runPreview();
      render("[data-dialog-notice]");
    } catch (error) {
      if (closed) return;
      phase = "stale";
      notice = { tone: "error", title: "Could not load the latest limits.", text: `${(error as Error).message || "Unknown error."} Nothing was saved; try again.` };
      render("[data-dialog-notice]");
    }
  }

  dialog.addEventListener("input", (event) => {
    const target = event.target as HTMLElement;
    if (target.matches("[data-limits-note]")) {
      note = (target as HTMLTextAreaElement).value;
      st.note = note;
      const count = dialog.querySelector<HTMLElement>("[data-note-count]");
      if (count) count.textContent = `${note.length} / ${NOTE_MAX}`;
    }
  });
  dialog.addEventListener("change", (event) => {
    const target = event.target as HTMLInputElement;
    if (target.matches("[data-limits-understand]")) { understood = target.checked; paintFooter(); }
  });
  dialog.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button");
    if (!button || button.disabled) return;
    if (button.matches("[data-close]")) { if (phase !== "saving") dialog.close(); return; }
    if (button.matches("[data-confirm-save]")) { void save(); return; }
    if (button.matches("[data-stale-load]")) { void loadTheirs(); return; }
    const path = button.dataset.gotoSetting;
    if (path) { dialog.close(); window.setTimeout(() => focusSetting(st, path), 0); }
  });
  render();
  await runPreview();
}

// ---------------------------------------------------------------------------------------
// History drawer
// ---------------------------------------------------------------------------------------

async function openHistory(st: State): Promise<void> {
  const dialog = workspaceDialog("Limits history", "limits-dialog limits-drawer");
  dialog.setAttribute("aria-labelledby", "lim-hist-title");
  dialog.removeAttribute("aria-label");
  let entries: LimitsHistoryEntry[] | null = null;
  let loadError = "";
  let confirming = "";
  let restoreNote = "";
  let busy = false;
  let message: { tone: "error" | "info"; text: string } | null = null;
  let closed = false;
  dialog.addEventListener("close", () => { closed = true; }, { once: true });
  dialog.addEventListener("cancel", (event) => { if (busy) event.preventDefault(); });
  const editable = () => st.data.can_edit && !st.forbidden;

  function itemHtml(entry: LimitsHistoryEntry, index: number): string {
    const current = entry.version_id === st.data.version_id;
    const unsaved = changedPaths(st).length;
    return `<li class="limits-history__item${current ? " is-current" : ""}" data-version="${esc(entry.version_id)}">
      <div class="limits-history__head">
        <strong>${esc(formatWhen(entry.saved_at))}</strong>
        <span class="limits-muted">${entry.saved_by ? `by ${esc(entry.saved_by)}` : "by an unknown user"}</span>
        ${current ? `<span class="limits-flag is-info">Current limits</span>` : ""}
      </div>
      ${entry.note ? `<p class="limits-history__note"><span class="visually-hidden">Note: </span>“${esc(entry.note)}”</p>` : ""}
      ${entry.changes?.length ? `<ul class="limits-sentences limits-sentences--small">${entry.changes.map((c) => `<li>${esc(c.sentence || c.label)}</li>`).join("")}</ul>` : `<p class="limits-muted">No limit changed in this version.</p>`}
      ${!current && editable() ? (confirming === entry.version_id
        ? `<div class="limits-history__confirm" role="group" aria-labelledby="lim-restore-q-${index}">
            <p id="lim-restore-q-${index}"><strong>Restore the limits from ${esc(formatWhen(entry.saved_at))}?</strong> This saves them as a new version; every rota generated afterwards follows them. Duty rules are not changed.${unsaved ? ` Your ${plural(unsaved, "unsaved change")} on the page will be discarded.` : ""}</p>
            <label for="lim-restore-note-${index}" class="limits-note-label">Note <span class="limits-muted">(optional)</span></label>
            <textarea id="lim-restore-note-${index}" rows="2" maxlength="${NOTE_MAX}" data-restore-note>${esc(restoreNote)}</textarea>
            <div class="button-row"><button type="button" class="primary btn-sm" data-restore-yes="${esc(entry.version_id)}" ${busy ? "disabled" : ""}>${busy ? "Restoring…" : "Yes, restore"}</button>
              <button type="button" class="quiet-button btn-sm" data-restore-keep ${busy ? "disabled" : ""}>Cancel</button></div>
          </div>`
        : `<div class="limits-history__actions"><button type="button" class="icon-button btn-sm" data-restore="${esc(entry.version_id)}" aria-label="Restore this version from ${esc(formatWhen(entry.saved_at))}">Restore this version</button></div>`) : ""}
    </li>`;
  }

  function render(focus?: string): void {
    if (closed) return;
    const content = loadError
      ? `<div class="limits-notice limits-notice--error" role="alert"><p>${esc(loadError)}</p><button type="button" class="quiet-button btn-sm" data-hist-retry>Try again</button></div>`
      : entries === null ? `<p class="limits-dialog__busy" role="status">Loading earlier versions…</p>`
        : !entries.length ? `<p class="limits-muted">No earlier versions yet. Each save on this page adds one.</p>`
          : `<ol class="limits-history">${entries.map(itemHtml).join("")}</ol>`;
    dialog.innerHTML = `<header class="mw-header limits-dialog__header"><div>
        <p class="limits-eyebrow">${STAR} Limits</p>
        <h2 id="lim-hist-title">History</h2><p>Every saved version of the limits, newest first.</p></div>
        <button type="button" data-close aria-label="Close history" ${busy ? "disabled" : ""}>Close</button></header>
      <div class="mw-content limits-dialog__content">
        ${message ? `<div class="limits-notice limits-notice--${message.tone}" role="${message.tone === "error" ? "alert" : "status"}" tabindex="-1" data-hist-message><p>${esc(message.text)}</p></div>` : ""}
        ${content}</div>`;
    const target = focus ? dialog.querySelector<HTMLElement>(focus) : null;
    (target ?? dialog.querySelector<HTMLElement>("[data-close]"))?.focus({ preventScroll: true });
  }

  async function load(): Promise<void> {
    loadError = "";
    entries = null;
    render();
    try {
      const list = await request<LimitsHistoryEntry[] | { versions: LimitsHistoryEntry[] }>(`${API}/history`);
      if (closed) return;
      entries = Array.isArray(list) ? list : list?.versions ?? [];
    } catch (error) {
      if (closed) return;
      loadError = statusOf(error) === 403 ? "Only a superadmin can see the limits history." : isNetwork(error) ? "Could not reach the server." : `Could not load the history: ${(error as Error).message || "unknown error"}.`;
    }
    render();
  }

  async function restore(versionId: string): Promise<void> {
    busy = true;
    message = null;
    render("[data-restore-yes]");
    try {
      const restored = await request<LimitsRead>(`${API}/restore`, { method: "POST", body: JSON.stringify({ version_id: versionId, note: restoreNote.trim() || null, base_version_id: st.data.version_id, month: st.month }) });
      busy = false;
      if (state !== st) { dialog.close(); return; }
      const entry = entries?.find((e) => e.version_id === versionId);
      st.serverProblems = [];
      st.othersChanged = [];
      st.resetConfirm = false;
      applyRead(st, restored?.limits ? restored : await getLimits(st.month), false);
      dialog.close();
      paintAll(st);
      announceToast("Limits restored", "success");
      setStatus(st, `Limits restored from ${entry ? formatWhen(entry.saved_at) : "an earlier version"} as a new version.`, "success", true);
    } catch (error) {
      busy = false;
      if (closed) return;
      const status = statusOf(error);
      const code = String(detailOf(error)?.code ?? "");
      message = { tone: "error", text: status === 403 ? "Only a superadmin can restore limits. Nothing was changed."
        : status === 404 ? "That version no longer exists. Nothing was changed."
        : status === 409 || code === "stale_limits" ? "Someone else saved limits after you opened this page. Nothing was changed; close this window and reload the page, then try again."
        : code === "no_limit_changes" ? "That version has the same limits as now, so there is nothing to restore."
        : isNetwork(error) ? "No answer from the server. The restore may or may not have happened; close this window and reload the page to check."
          : `The limits were not restored: ${String(detailOf(error)?.message ?? (error as Error).message ?? "unknown error")}` };
      render("[data-hist-message]");
    }
  }

  dialog.addEventListener("input", (event) => {
    const target = event.target as HTMLElement;
    if (target.matches("[data-restore-note]")) restoreNote = (target as HTMLTextAreaElement).value;
  });
  dialog.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button");
    if (!button || button.disabled) return;
    if (button.matches("[data-close]")) { if (!busy) dialog.close(); return; }
    if (button.matches("[data-hist-retry]")) { void load(); return; }
    if (button.dataset.restore) { confirming = button.dataset.restore; restoreNote = ""; render("[data-restore-yes]"); return; }
    if (button.matches("[data-restore-keep]")) {
      const id = confirming;
      confirming = "";
      render(`[data-restore="${sel(id)}"]`);
      return;
    }
    if (button.dataset.restoreYes) void restore(button.dataset.restoreYes);
  });
  await load();
}

// ---------------------------------------------------------------------------------------
// Page events and entry point
// ---------------------------------------------------------------------------------------

function edited(st: State, path = ""): void {
  if (st.resetConfirm) st.resetConfirm = false;
  paintMeta(st);
  if (path === "fairness_rules.max_gap_within_call_level") paintTargets(st);
}

function bindPage(st: State): void {
  const page = st.page;
  page.addEventListener("input", (event) => {
    const target = event.target as HTMLElement;
    if (target instanceof HTMLInputElement && target.matches("[data-limit-num]")) {
      if (target.readOnly) return;
      st.raw[target.dataset.limitNum ?? ""] = target.value;
      edited(st, target.dataset.limitNum);
    }
  });
  page.addEventListener("change", (event) => {
    const target = event.target as HTMLElement;
    if (target instanceof HTMLSelectElement && target.matches("[data-limit-choice]")) {
      st.raw[target.dataset.limitChoice ?? ""] = target.value;
      edited(st);
      return;
    }
    if (target instanceof HTMLInputElement && target.matches("[data-targets-month]")) {
      if (!/^\d{4}-\d{2}$/.test(target.value) || target.value === st.month) return;
      st.month = target.value;
      void reloadTargets(st);
    }
  });
  page.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    const button = target.closest<HTMLElement>("button");
    const toc = target.closest<HTMLAnchorElement>("[data-toc]");
    if (toc) {
      event.preventDefault();
      const card = st.page.querySelector<HTMLElement>(`#lim-card-${sel(toc.dataset.toc ?? "")}`);
      card?.scrollIntoView({ block: "start", behavior: reducedMotion() ? "auto" : "smooth" });
      const heading = card?.querySelector<HTMLElement>("h3");
      if (heading) { heading.tabIndex = -1; heading.focus({ preventScroll: true }); }
      return;
    }
    if (!button || (button as HTMLButtonElement).disabled) return;
    if (button.matches("[data-limit-switch]")) {
      if (button.getAttribute("aria-disabled") === "true") return;
      const path = button.dataset.limitSwitch ?? "";
      const on = !st.raw[path];
      st.raw[path] = on;
      button.setAttribute("aria-checked", String(on));
      const text = button.querySelector("[data-switch-text]");
      if (text) text.textContent = on ? "On" : "Off";
      edited(st);
      return;
    }
    if (button.matches("[data-limits-history]")) { void openHistory(st); return; }
    if (button.matches("[data-limits-save]")) { void openSaveDialog(st); return; }
    if (button.matches("[data-limits-reset]")) { st.resetConfirm = true; paintSavebar(st); page.querySelector<HTMLElement>("[data-reset-keep]")?.focus(); return; }
    if (button.matches("[data-reset-keep]")) { st.resetConfirm = false; paintSavebar(st); page.querySelector<HTMLElement>("[data-limits-reset]")?.focus(); return; }
    if (button.matches("[data-reset-yes]")) {
      const n = changedPaths(st).length;
      st.raw = rawFromSaved(st);
      st.resetConfirm = false;
      st.serverProblems = [];
      paintAll(st);
      setStatus(st, `${plural(n, "change")} reset. Every limit shows its saved value.`, "info", true);
      return;
    }
    if (button.matches("[data-goto-error]")) { const first = errorPaths(st)[0]; if (first) focusSetting(st, first); return; }
    if (button.matches("[data-targets-retry]")) { void reloadTargets(st); return; }
    if (button.matches("[data-status-dismiss]")) { setStatus(st, ""); return; }
    if (button.matches("[data-dismiss-others]")) {
      st.othersChanged = [];
      const host = part(st, "notices");
      if (host) host.innerHTML = "";
      part(st, "status")?.focus({ preventScroll: true });
    }
  });
  page.addEventListener("keydown", (event) => {
    // Enter in a number box must never submit or reload anything.
    if (event.key === "Enter" && (event.target as HTMLElement).matches("[data-limit-num]")) event.preventDefault();
  });
}

/**
 * Renders the Limits page into `root`. Safe to call again (retry, revisit): the previous draft
 * is dropped. Only a superadmin reaches it from the navigation; the server enforces the role too.
 */
export async function renderLimitsPage(root: HTMLElement, opts: LimitsPageOptions): Promise<void> {
  state = null;
  const current = () => opts.isCurrent?.() ?? true;
  const month = /^\d{4}-\d{2}$/.test(opts.month) ? opts.month : new Date().toISOString().slice(0, 7);
  root.innerHTML = pageSkeleton("limits");
  let read: LimitsRead;
  try {
    read = await getLimits(month);
  } catch (error) {
    if (!current()) return;
    const status = statusOf(error);
    root.innerHTML = status === 403
      ? emptyState({ title: "Only a superadmin can open Limits", body: "Your account can see the limits read-only in Rota Rules. Ask a superadmin to change them.", tone: "warning",
          actionHtml: `<button type="button" class="primary" data-limits-goto-rules>Open Rota Rules</button>` })
      : emptyState({ title: "Limits could not load", body: `${isNetwork(error) ? "Could not reach the server." : (error as Error).message || "Unable to load the limits."} Nothing has changed.`, tone: "danger",
          actionHtml: `<button type="button" class="primary" data-limits-retry>Try again</button>` });
    root.querySelector<HTMLButtonElement>("[data-limits-retry]")?.addEventListener("click", () => void renderLimitsPage(root, opts), { once: true });
    root.querySelector<HTMLButtonElement>("[data-limits-goto-rules]")?.addEventListener("click", () => opts.onNavigate("rota-rules"), { once: true });
    return;
  }
  if (!current()) return;
  const page = document.createElement("div");
  page.className = "limits-page";
  const st: State = {
    root, page, opts, data: read, fields: [], saved: {} as LimitSections, raw: {}, month,
    targets: [], targetsBusy: false, targetsError: "", serverProblems: [], status: null, resetConfirm: false, othersChanged: [], forbidden: false, note: "",
  };
  applyRead(st, read, false);
  state = st;
  page.innerHTML = pageHtml(st);
  root.replaceChildren(page);
  bindPage(st);
  if (!unloadBound) {
    unloadBound = true;
    window.addEventListener("beforeunload", (event) => {
      if (!limitsHasUnsavedChanges()) return;
      event.preventDefault();
      event.returnValue = "";
    });
  }
}

// ---------------------------------------------------------------------------------------
// Publish: compact spread table under "Duty totals uneven within a call level"
// ---------------------------------------------------------------------------------------

export const UNEVEN_DUTIES_WARNING = "Duty totals uneven within a call level";

/** Off target = outside the whole numbers either side of the target (e.g. 5.4 → 5 or 6). */
function offTarget(level: CallLevelSpread) {
  const lo = Math.floor(Number(level.target)), hi = Math.ceil(Number(level.target));
  return (level.members ?? []).filter((m) => m.duties < lo || m.duties > hi).sort((a, b) => a.diff_from_target - b.diff_from_target || a.name.localeCompare(b.name));
}

/**
 * The compact spread per call level for Publish: target, min, max, gap and members off target,
 * inside a collapsible block. Uneven levels are listed first and open their member list.
 */
export function limitsSpreadDebrief(spread: CallLevelSpread[] | undefined, monthLabel: string): string {
  const levels = (spread ?? []).filter(Boolean);
  if (!levels.length) return "";
  const uneven = levels.filter((l) => !l.ok);
  const sorted = [...uneven, ...levels.filter((l) => l.ok)];
  const fmt = (n: number) => Number(n).toFixed(2).replace(/\.?0+$/, "");
  const label = (l: CallLevelSpread) => l.label || callLevelText(l.call_level);
  const rows = sorted.map((l) => {
    const off = offTarget(l);
    return `<tr class="${l.ok ? "" : "is-uneven"}"><th scope="row" data-label="Call level">${esc(label(l))}</th>
      <td class="is-num" data-label="Target">${esc(fmt(l.target))}</td>
      <td class="is-num" data-label="Min">${esc(l.min)}</td>
      <td class="is-num" data-label="Max">${esc(l.max)}</td>
      <td class="is-num" data-label="Gap"><span><strong>${esc(l.gap)}</strong> <span class="limits-muted">/ ${esc(l.allowed_gap)} allowed</span></span></td>
      <td data-label="Off target">${l.ok ? `<span class="limits-spread__ok">Even</span>` : `<span class="limits-spread__bad">${esc(plural(off.length, "member"))}</span>`}</td></tr>`;
  }).join("");
  const members = uneven.map((l) => {
    const off = offTarget(l);
    if (!off.length && !l.reason) return "";
    return `<details class="limits-spread__level" open>
        <summary>${esc(label(l))}: ${esc(plural(off.length, "member"))} off target <span class="limits-muted">(target ${esc(fmt(l.target))})</span></summary>
        ${l.reason ? `<p class="limits-spread__reason">${esc(l.reason)}</p>` : ""}
        ${off.length ? `<ul class="limits-spread__members">${off.map((m) => `<li><span>${esc(m.name)}</span><span class="limits-spread__count">${esc(plural(m.duties, "duty", "duties"))}${m.extra_duties ? ` <span class="limits-muted">(${esc(m.extra_duties)} extra)</span>` : ""}</span><span class="limits-spread__diff ${m.diff_from_target < 0 ? "is-below" : "is-above"}">${m.diff_from_target > 0 ? "+" : ""}${esc(fmt(m.diff_from_target))}</span></li>`).join("")}</ul>` : ""}
      </details>`;
  }).join("");
  return `<details class="limits-spread" data-call-level-spread ${uneven.length ? "open" : ""}>
      <summary>Duty spread by call level <span class="limits-muted">· ${esc(uneven.length ? `${plural(uneven.length, "level")} uneven` : "all even")}</span></summary>
      <div class="limits-table-wrap"><table class="limits-table limits-table--spread">
        <caption class="visually-hidden">Monthly duty totals per call level, ${esc(monthLabel)}</caption>
        <thead><tr><th scope="col">Call level</th><th scope="col" class="is-num">Target</th><th scope="col" class="is-num">Min</th><th scope="col" class="is-num">Max</th><th scope="col" class="is-num">Gap</th><th scope="col">Off target</th></tr></thead>
        <tbody>${rows}</tbody></table></div>
      ${members}
    </details>`;
}
