/**
 * Rota Rules (admin): who can do each duty, how each duty behaves, and the safety guardrails.
 *
 * Contract: docs/rota_rules_contract.md. Groups define the pool: anyone in a selected active
 * group is eligible, and each selected group's parent call level is added to the duty's
 * effective call levels (shown as locked chips). Every option carries its plain-language hint
 * from the contract, visible under the control, with a "?" button for an example.
 *
 * Flow: load (GET, with `revision` and `groups`) -> edit a local draft -> live /check
 * (debounced, never blocks editing) -> Review & save (/check, errors block, warnings can be
 * saved anyway) -> PUT with `base_revision` (409 stale_rules / 422 invalid_rules handled).
 * History lists saved versions, compares one with the current rules, and restores it.
 */
import { workspaceDialog } from "./member-workspace";
import {
  checkRotaRules,
  getCallClusters,
  getRotaPhaseOneRules,
  getRotaRuleVersion,
  getRotaRuleVersions,
  invalidRulesProblems,
  isStaleRulesError,
  restoreRotaRuleVersion,
  updateRotaPhaseOneRules,
  type DutyRule,
  type RotaPhaseOneRules,
  type RotaRuleGroup,
  type RotaRuleProblem,
  type RotaRulesCheck,
  type RotaRulesPayload,
  type RotaRuleVersionSummary,
} from "./services/api";
import { badge, codeLabel, emptyState, esc, formatDate, nextStep, pageSkeleton, type Tone } from "./ui";

export interface RotaRulesPageOptions {
  onNavigate(view: string): void;
  /** False once the app has moved to another screen; late responses then do not paint. */
  isCurrent?: () => boolean;
}

// ---------------------------------------------------------------------------------------
// Reference data and hint texts (exactly as in the contract tables)
// ---------------------------------------------------------------------------------------

const CALL_LEVELS = [
  { key: "1ST_CALL", label: "1st Call" },
  { key: "2ND_CALL", label: "2nd Call" },
  { key: "3RD_CALL", label: "3rd Call" },
  { key: "4TH_CALL", label: "4th Call" },
  { key: "CO_4TH_CALL", label: "Co-4th Call" },
  { key: "5TH_CALL", label: "5th Call" },
];

const CATEGORIES: { key: string; label: string; heading: string }[] = [
  { key: "main", label: "Main duty", heading: "Main duties" },
  { key: "rc", label: "RC duty", heading: "RC duties" },
  { key: "cb", label: "CB duty", heading: "CB duties" },
  { key: "caesar", label: "Caesar duty", heading: "Caesar duties" },
  { key: "pac", label: "PAC", heading: "PAC duties" },
  { key: "shift", label: "Shift duty", heading: "Shift duties" },
  { key: "chad", label: "CHAD", heading: "CHAD duties" },
  { key: "cart", label: "CART", heading: "CART duties" },
  { key: "schell", label: "Schell duty", heading: "Schell duties" },
  { key: "floating", label: "Floating consultant", heading: "Floating consultant" },
  { key: "fifth_call", label: "5th call duty", heading: "5th call duties" },
  { key: "ruhsa", label: "RUHSA", heading: "RUHSA duties" },
  { key: "paeds", label: "Paeds", heading: "Paeds duties" },
  { key: "neuro", label: "Neuro", heading: "Neuro duties" },
];

interface Hint { label: string; text: string; more: string }

const HINTS: Record<string, Hint> = {
  active: {
    label: "Active",
    text: "The duty exists in this department. Inactive duties are hidden from templates and never generated.",
    more: "Turn it off for a duty the department no longer runs. Its past duties and history are kept.",
  },
  is_mandatory: {
    label: "Mandatory",
    text: "Generated automatically every day when a month's template is built, and the generator must fill it first.",
    more: "Use it for duties that must be covered every day, such as the main 24-hour calls.",
  },
  is_adjustable: {
    label: "Adjustable",
    text: "Optional: not generated unless you tick it in the template's duty list for that month.",
    more: "Use it for duties that run only in some months; tick them in Rota Template when they are needed.",
  },
  blocks_elective_same_day: {
    label: "Same-day block",
    text: "Whoever does this duty cannot take another duty that same day. 24-hour duties always do this.",
    more: "Turn it on for duties that take up the whole day, so nobody is booked twice on that day.",
  },
  blocks_elective_next_day: {
    label: "Next-day block",
    text: "Whoever does this duty is rested the next day and gets no duty then. 24-hour duties always do this.",
    more: "Turn it on for night or long duties that need a rest day afterwards.",
  },
  allowed_call_levels: {
    label: "Call levels allowed",
    text: "Which call levels can do this duty. Selected groups add their own call level automatically.",
    more: "Example: choose 3rd Call for a 3rd call duty. If you also choose a 4th Call group such as PAC Senior, 4th Call is added for you and shown with a lock.",
  },
  allowed_cluster_keys: {
    label: "Groups allowed",
    text: "If any are chosen, only members of at least one chosen group can do the duty (any of them, not all).",
    more: "Example: choose PAC SR and PAC Senior and members of either group can do it. Leave it empty to let everyone on the chosen call levels do it.",
  },
  excluded_cluster_keys: {
    label: "Groups excluded",
    text: "Members of these groups can never do this duty, even if otherwise eligible.",
    more: "Example: exclude Schell so members of that group are never given this duty. A group cannot be both allowed and excluded.",
  },
  group: {
    label: "Duty category",
    text: "Used for counting and grouping duties in reports and exports. It is not a member list.",
    more: "Changing it moves the duty to another section on this page and in reports. It does not change who can do the duty.",
  },
  duration_hours: {
    label: "Hours",
    text: "Length of the duty. 24-hour duties count towards the 24-hour totals.",
    more: "Use whole hours from 0 to 48.",
  },
  label: {
    label: "Display label",
    text: "The name people see on the rota, templates and exports.",
    more: "Keep labels unique so two duties are never confused. The duty's internal key does not change.",
  },
};

interface GuardField { path: string; label: string; text: string; more: string; unit: string; min: number; max: number; nullable?: boolean }

const GUARD_FIELDS: GuardField[] = [
  { path: "rest_rules.minimum_gap_after_24hr_hours", label: "Minimum gap after 24hr duty", text: "Hours of rest required after a 24-hour duty before the next duty.", more: "24 means a full day of rest after a 24-hour duty.", unit: "hours", min: 0, max: 168 },
  { path: "unit_staffing_rules.minimum_available_count", label: "Minimum available per unit", text: "The fewest people a unit must keep free each day.", more: "Used for every unit; small units can rely on this number alone (see below).", unit: "people", min: 0, max: 99 },
  { path: "unit_staffing_rules.warning_unavailable_percent", label: "Warning unavailable %", text: "Show a warning when this share of a unit is away or on duty.", more: "Keep it below the hard block so you are warned before assignments are refused.", unit: "%", min: 0, max: 100 },
  { path: "unit_staffing_rules.hard_block_unavailable_percent", label: "Hard block unavailable %", text: "Refuse more assignments when this share of a unit is away or on duty.", more: "Set it at or above the warning %; otherwise people are refused before anyone is warned.", unit: "%", min: 0, max: 100 },
  { path: "duty_count_limits.max_24hr_per_month", label: "Max 24hr duties/month", text: "Cap per person; leave it empty for no cap.", more: "Counts every 24-hour duty a person does in the month.", unit: "duties", min: 0, max: 31, nullable: true },
  { path: "duty_count_limits.max_weekend_24hr_per_month", label: "Max weekend 24hr/month", text: "Cap per person on weekend 24-hour duties.", more: "Leave it empty for no cap.", unit: "duties", min: 0, max: 10, nullable: true },
];

const GUARD_SWITCHES: { path: string; label: string; text: string; more: string }[] = [
  { path: "rest_rules.post_24hr_blocks_next_day_elective", label: "Post-24hr blocks next-day elective", text: "After a 24-hour duty the person is not available for elective work the next day.", more: "Elective lists for the day after a 24-hour duty will not include that person." },
  { path: "unit_staffing_rules.small_unit_uses_absolute_minimum", label: "Small units use absolute minimum", text: "Small units use the minimum number above instead of percentages.", more: "In a unit of three, one person away is already 33%; the minimum number is fairer there." },
];

const FLAGS = ["active", "is_mandatory", "is_adjustable", "blocks_elective_same_day", "blocks_elective_next_day"] as const;
type Flag = (typeof FLAGS)[number];
const LIST_FIELDS = ["allowed_call_levels", "allowed_cluster_keys", "excluded_cluster_keys"] as const;
type ListField = (typeof LIST_FIELDS)[number];

const FIELD_LABELS: Record<string, string> = {
  label: "Display label", group: "Duty category", duration_hours: "Hours", active: "Active", is_mandatory: "Mandatory",
  is_adjustable: "Adjustable", blocks_elective_same_day: "Same-day block", blocks_elective_next_day: "Next-day block",
  allowed_call_levels: "Call levels allowed", allowed_cluster_keys: "Groups allowed", excluded_cluster_keys: "Groups excluded",
};

type Filter = "all" | "groups" | "nobody" | "warnings" | "inactive" | "changed";
const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "groups", label: "Uses groups" },
  { key: "nobody", label: "Nobody eligible" },
  { key: "warnings", label: "Warnings" },
  { key: "inactive", label: "Inactive" },
  { key: "changed", label: "Changed" },
];

const LOCK_ICON = `<svg class="rr-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path fill="currentColor" d="M4.5 7V5a3.5 3.5 0 0 1 7 0v2h.5A1 1 0 0 1 13 8v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1h.5Zm1.5 0h4V5a2 2 0 0 0-4 0v2Z"/></svg>`;
const WARN_ICON = `<svg class="rr-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path fill="currentColor" d="M8 1.5c.4 0 .8.2 1 .6l6 10.6c.4.8-.1 1.8-1 1.8H2c-.9 0-1.4-1-1-1.8L7 2.1c.2-.4.6-.6 1-.6Zm-.75 4.25v4h1.5v-4h-1.5Zm0 5.25v1.5h1.5V11h-1.5Z"/></svg>`;
const CHECK_ICON = `<svg class="rr-icon rr-chip__tick" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path fill="currentColor" d="M6.2 11.6 2.9 8.3l1.1-1.1 2.2 2.2 5.8-5.8 1.1 1.1z"/></svg>`;
const CHEVRON = `<svg class="rr-icon rr-chev" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path fill="currentColor" d="M5.7 3.3 10.4 8l-4.7 4.7-1.1-1.1L8.2 8 4.6 4.4z"/></svg>`;
const SEARCH_ICON = `<svg class="rr-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path fill="currentColor" d="M7 2a5 5 0 0 1 4 8l3 3-1 1-3-3A5 5 0 1 1 7 2Zm0 1.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z"/></svg>`;

// ---------------------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------------------

interface State {
  root: HTMLElement;
  page: HTMLElement;
  opts: RotaRulesPageOptions;
  saved: RotaPhaseOneRules;
  draft: RotaPhaseOneRules;
  revision: string | null;
  groups: RotaRuleGroup[];
  check: RotaRulesCheck | null;
  checkState: "idle" | "checking" | "error";
  checkFresh: boolean;
  checkSeq: number;
  checkTimer: number | undefined;
  query: string;
  filter: Filter;
  expanded: Set<string>;
  collapsed: Set<string>;
  openHints: Set<string>;
  guardOpen: boolean;
  status: { text: string; tone: Tone } | null;
}

let state: State | null = null;
let unloadBound = false;

/** True while the Rota Rules page is on screen with edits that have not been saved. */
export function rotaRulesHasUnsavedChanges(): boolean {
  const st = state;
  return Boolean(st && st.root.contains(st.page) && changeCount(st) > 0);
}

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const domId = (key: string) => key.replace(/[^A-Za-z0-9_-]/g, "-");
const sel = (value: string) => (typeof CSS !== "undefined" && CSS.escape ? CSS.escape(value) : value.replace(/"/g, '\\"'));
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

function normalizeLevel(value: string | null | undefined): string {
  const raw = String(value ?? "").toUpperCase().replace(/[^A-Z0-9]+/g, "_");
  if (!raw) return "";
  if (raw.includes("CO_4TH") || raw.includes("CO4TH")) return "CO_4TH_CALL";
  if (raw.includes("1ST")) return "1ST_CALL";
  if (raw.includes("2ND")) return "2ND_CALL";
  if (raw.includes("3RD")) return "3RD_CALL";
  if (raw.includes("4TH")) return "4TH_CALL";
  if (raw.includes("5TH") || raw.includes("FIFTH")) return "5TH_CALL";
  return raw;
}

function levelLabel(level: string): string {
  return CALL_LEVELS.find((item) => item.key === level)?.label ?? codeLabel(level);
}

function levelOrder(level: string): number {
  const index = CALL_LEVELS.findIndex((item) => item.key === level);
  return index < 0 ? 99 : index;
}

/** Levels the duty name implies, used when the rule lists none (as the backend does). */
function inferredLevels(dutyKey: string): string[] {
  const key = dutyKey.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
  if (key.includes("1ST")) return ["1ST_CALL"];
  if (key.includes("2ND")) return ["2ND_CALL"];
  if (key.includes("3RD")) return ["3RD_CALL"];
  if (key.includes("CO4TH") || key.includes("CO_4TH")) return ["CO_4TH_CALL"];
  if (key.includes("4TH")) return ["4TH_CALL"];
  if (key.includes("5TH") || key.includes("FIFTH")) return ["5TH_CALL"];
  return [];
}

function categoryLabel(key: string, heading = false): string {
  const cat = CATEGORIES.find((item) => item.key === key);
  if (cat) return heading ? cat.heading : cat.label;
  return codeLabel(String(key ?? "").toUpperCase(), "Uncategorised");
}

function normalizeRules(rules: RotaPhaseOneRules): RotaPhaseOneRules {
  const copy = clone(rules);
  copy.duty_rules = (copy.duty_rules ?? []).map((rule) => ({
    ...rule,
    allowed_call_levels: rule.allowed_call_levels ?? [],
    allowed_cluster_keys: rule.allowed_cluster_keys ?? [],
    excluded_cluster_keys: rule.excluded_cluster_keys ?? [],
  }));
  copy.rest_rules = copy.rest_rules ?? { minimum_gap_after_24hr_hours: 24, post_24hr_blocks_next_day_elective: true };
  copy.unit_staffing_rules = copy.unit_staffing_rules ?? { minimum_available_count: 1, warning_unavailable_percent: 30, hard_block_unavailable_percent: 40, small_unit_uses_absolute_minimum: true };
  copy.duty_count_limits = copy.duty_count_limits ?? { max_24hr_per_month: null, max_weekend_24hr_per_month: null, max_same_group_per_month: null, max_same_campus_per_month: null };
  return copy;
}

function payloadOf(rules: RotaPhaseOneRules): RotaRulesPayload {
  const { rule_version: _version, revision: _revision, groups: _groups, ...rest } = clone(rules);
  return rest as RotaRulesPayload;
}

function getPath(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((value, part) => (value && typeof value === "object" ? (value as Record<string, unknown>)[part] : undefined), obj);
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

function ruleSignature(rule: DutyRule | undefined): string {
  if (!rule) return "";
  const copy = { ...rule } as Record<string, unknown>;
  for (const field of LIST_FIELDS) copy[field] = [...(rule[field] ?? [])].sort();
  return JSON.stringify(Object.keys(copy).sort().map((key) => [key, copy[key]]));
}

function savedRule(st: State, key: string): DutyRule | undefined {
  return st.saved.duty_rules.find((rule) => rule.key === key);
}

function draftRule(st: State, key: string): DutyRule | undefined {
  return st.draft.duty_rules.find((rule) => rule.key === key);
}

function isChanged(st: State, rule: DutyRule): boolean {
  return ruleSignature(rule) !== ruleSignature(savedRule(st, rule.key));
}

function changedDuties(st: State): DutyRule[] {
  return st.draft.duty_rules.filter((rule) => isChanged(st, rule));
}

function changedGuards(st: State): string[] {
  return [...GUARD_FIELDS.map((f) => f.path), ...GUARD_SWITCHES.map((f) => f.path)]
    .filter((path) => JSON.stringify(getPath(st.draft, path) ?? null) !== JSON.stringify(getPath(st.saved, path) ?? null));
}

function changeCount(st: State): number {
  return changedDuties(st).length + changedGuards(st).length;
}

function groupByKey(st: State, key: string): RotaRuleGroup | undefined {
  return st.groups.find((group) => group.key === key);
}

function groupName(st: State, key: string): string {
  return groupByKey(st, key)?.name ?? `Missing group (${key})`;
}

function missingGroups(st: State, rule: DutyRule): string[] {
  return [...rule.allowed_cluster_keys, ...rule.excluded_cluster_keys].filter((key) => !groupByKey(st, key));
}

/** The duty's own levels: the saved list, or the levels the duty name implies when it lists none. */
function baseLevels(rule: DutyRule): { levels: string[]; inferred: boolean } {
  if (rule.allowed_call_levels.length) return { levels: [...new Set(rule.allowed_call_levels.map(normalizeLevel))], inferred: false };
  return { levels: inferredLevels(rule.key), inferred: true };
}

/** Levels added by the duty's selected active groups that are not already among its own levels. */
function groupAddedLevels(st: State, rule: DutyRule): Map<string, string[]> {
  const own = new Set(baseLevels(rule).levels);
  const added = new Map<string, string[]>();
  for (const key of rule.allowed_cluster_keys) {
    const group = groupByKey(st, key);
    if (!group || !group.active || !group.call_level) continue;
    const level = normalizeLevel(group.call_level);
    if (own.has(level)) continue;
    added.set(level, [...(added.get(level) ?? []), group.name]);
  }
  return added;
}

function effectiveLevels(st: State, rule: DutyRule): string[] {
  const server = st.checkFresh ? st.check?.duties?.[rule.key]?.effective_call_levels : undefined;
  const levels = server ?? [...baseLevels(rule).levels, ...groupAddedLevels(st, rule).keys()];
  return [...new Set(levels.map(normalizeLevel))].sort((a, b) => levelOrder(a) - levelOrder(b));
}

function dutyProblems(st: State, key: string): RotaRuleProblem[] {
  return (st.check?.problems ?? []).filter((problem) => problem.duty_key === key);
}

function eligibleNow(st: State, key: string): number | null {
  const value = st.check?.duties?.[key]?.eligible_now;
  return typeof value === "number" ? value : null;
}

function matchesFilter(st: State, rule: DutyRule): boolean {
  const query = st.query.trim().toLowerCase();
  if (query && !`${rule.label} ${rule.key} ${rule.key.replace(/_/g, " ")} ${categoryLabel(rule.group)}`.toLowerCase().includes(query)) return false;
  return filterTest(st, st.filter, rule);
}

function filterTest(st: State, filter: Filter, rule: DutyRule): boolean {
  switch (filter) {
    case "groups": return rule.allowed_cluster_keys.length > 0 || rule.excluded_cluster_keys.length > 0;
    case "nobody": return rule.active && eligibleNow(st, rule.key) === 0;
    case "warnings": return dutyProblems(st, rule.key).length > 0 || missingGroups(st, rule).length > 0;
    case "inactive": return !rule.active;
    case "changed": return isChanged(st, rule);
    default: return true;
  }
}

// ---------------------------------------------------------------------------------------
// Small HTML builders
// ---------------------------------------------------------------------------------------

/** "?" button that reveals the longer hint; the short hint is always visible. */
function helpButton(st: State, id: string, label: string): string {
  const open = st.openHints.has(id);
  return `<button type="button" class="rr-help" data-help="${esc(id)}" aria-expanded="${open}" aria-controls="${esc(id)}" aria-label="More about ${esc(label)}" data-fk="help:${esc(id)}">?</button>`;
}

function helpMore(st: State, id: string, text: string): string {
  return `<p class="rr-hint-more" id="${esc(id)}" ${st.openHints.has(id) ? "" : "hidden"}>${esc(text)}</p>`;
}

function fieldHead(st: State, id: string, hint: Hint, forId?: string): string {
  const label = forId ? `<label class="rr-field__label" for="${esc(forId)}">${esc(hint.label)}</label>` : `<span class="rr-field__label" id="${esc(id)}-label">${esc(hint.label)}</span>`;
  return `<div class="rr-field__head">${label}${helpButton(st, `${id}-more`, hint.label)}</div>
    <p class="rr-hint" id="${esc(id)}-hint">${esc(hint.text)}</p>
    ${helpMore(st, `${id}-more`, hint.more)}`;
}

function chip(options: { pressed: boolean; label: string; sub?: string; duty: string; field: ListField; value: string; tone?: "warning" | "danger"; disabled?: boolean; note?: string }): string {
  return `<button type="button" class="rr-chip${options.tone ? ` is-${options.tone}` : ""}" aria-pressed="${options.pressed}"
      ${options.disabled ? 'aria-disabled="true"' : ""} data-chip data-duty="${esc(options.duty)}" data-field="${options.field}" data-value="${esc(options.value)}"
      data-fk="chip:${esc(options.duty)}:${options.field}:${esc(options.value)}">
      ${CHECK_ICON}<span class="rr-chip__text"><span class="rr-chip__label">${esc(options.label)}</span>${options.sub ? `<span class="rr-chip__sub">${esc(options.sub)}</span>` : ""}</span>
      ${options.note ? `<span class="visually-hidden">. ${esc(options.note)}</span>` : ""}
    </button>`;
}

function switchHtml(st: State, id: string, options: { label: string; text: string; more: string; checked: boolean; attrs: string; locked?: string }): string {
  return `<div class="rr-switch-row${options.locked ? " is-locked" : ""}">
    <button type="button" role="switch" class="rr-switch" id="${esc(id)}" aria-checked="${options.checked}" aria-describedby="${esc(id)}-hint"
      ${options.locked ? 'aria-disabled="true"' : ""} ${options.attrs} data-fk="switch:${esc(id)}"><span class="rr-switch__thumb" aria-hidden="true"></span></button>
    <div class="rr-switch-row__text">
      <div class="rr-field__head"><label class="rr-switch-row__label" for="${esc(id)}">${esc(options.label)}</label>
        <span class="rr-switch-row__state" aria-hidden="true">${options.checked ? "On" : "Off"}</span>${helpButton(st, `${id}-more`, options.label)}</div>
      <p class="rr-hint" id="${esc(id)}-hint">${esc(options.text)}${options.locked ? ` <strong>${esc(options.locked)}</strong>` : ""}</p>
      ${helpMore(st, `${id}-more`, options.more)}
    </div>
  </div>`;
}

function problemsList(problems: RotaRuleProblem[]): string {
  if (!problems.length) return "";
  return `<ul class="rr-problems">${problems.map((problem) => `<li class="rr-problem is-${problem.severity === "error" ? "error" : "warning"}">
      ${WARN_ICON}<div><p class="rr-problem__msg"><span class="visually-hidden">${problem.severity === "error" ? "Error" : "Warning"}: </span>${esc(problem.message)}</p>
      ${problem.fix ? `<p class="rr-problem__fix">${esc(problem.fix)}</p>` : ""}</div></li>`).join("")}</ul>`;
}

// ---------------------------------------------------------------------------------------
// Page sections
// ---------------------------------------------------------------------------------------

function tilesHtml(st: State): string {
  const active = st.draft.duty_rules.filter((rule) => rule.active);
  const usingGroups = st.draft.duty_rules.filter((rule) => rule.allowed_cluster_keys.length || rule.excluded_cluster_keys.length).length;
  const nobody = st.check ? active.filter((rule) => eligibleNow(st, rule.key) === 0).length : null;
  const changes = changeCount(st);
  const tile = (value: string, label: string, sub: string, tone: string, filter: Filter | "") => {
    const inner = `<span class="rr-tile__value">${esc(value)}</span><span class="rr-tile__label">${esc(label)}</span><span class="rr-tile__sub">${esc(sub)}</span>`;
    return filter
      ? `<button type="button" class="rr-tile${tone ? ` is-${tone}` : ""}" data-filter="${filter}" aria-pressed="${st.filter === filter}" data-fk="tile:${filter}">${inner}</button>`
      : `<div class="rr-tile${tone ? ` is-${tone}` : ""}">${inner}</div>`;
  };
  return [
    tile(String(active.length), "Active duties", `of ${st.draft.duty_rules.length} duties`, "", ""),
    tile(String(usingGroups), "Use eligibility groups", "Allowed or excluded groups", "", "groups"),
    tile(nobody === null ? "—" : String(nobody), "Nobody eligible", nobody === null ? "Not checked yet" : "Active duties with no one today", nobody ? "alert" : nobody === 0 ? "good" : "", "nobody"),
    tile(String(changes), "Unsaved changes", changes ? "Review and save below" : "Everything is saved", changes ? "warn" : "", "changed"),
  ].join("");
}

function noticesHtml(st: State): string {
  const parts: string[] = [];
  if (st.checkState === "error") {
    parts.push(nextStep({
      tone: "warning",
      title: "Couldn't check eligibility right now",
      body: "You can keep editing; nothing is lost. Eligible counts and warnings will update when the check works again.",
      actionHtml: `<button type="button" class="icon-button btn-sm" data-retry-check>Try again</button>`,
    }));
  }
  const missing = st.draft.duty_rules.filter((rule) => missingGroups(st, rule).length);
  if (missing.length) {
    parts.push(nextStep({
      tone: "danger",
      title: `${plural(missing.length, "duty uses", "duties use")} groups that no longer exist`,
      body: `${missing.slice(0, 4).map((rule) => rule.label).join(", ")}${missing.length > 4 ? ` and ${missing.length - 4} more` : ""}. Remove the missing groups before saving.`,
      actionHtml: `<button type="button" class="primary btn-sm" data-remove-missing="*">Remove missing groups</button>`,
    }));
  }
  if (st.groups.length && !st.groups.some((group) => group.active)) {
    parts.push(nextStep({
      tone: "info",
      title: `None of your ${plural(st.groups.length, "eligibility group")} is active`,
      body: "Inactive groups make nobody eligible. Turn a group on in Eligibility groups to use it here.",
      actionHtml: `<button type="button" class="icon-button btn-sm" data-act="groups">Manage eligibility groups</button>`,
    }));
  }
  return parts.join("");
}

function toolbarCountsHtml(st: State): void {
  st.page.querySelectorAll<HTMLButtonElement>("[data-filter-chip]").forEach((button) => {
    const filter = button.dataset.filterChip as Filter;
    const count = st.draft.duty_rules.filter((rule) => filterTest(st, filter, rule)).length;
    button.setAttribute("aria-pressed", String(st.filter === filter));
    const counter = button.querySelector(".rr-filter__count");
    if (counter) counter.textContent = String(count);
  });
  const shown = st.draft.duty_rules.filter((rule) => matchesFilter(st, rule)).length;
  const summary = st.page.querySelector("[data-part=showing]");
  if (summary) summary.textContent = shown === st.draft.duty_rules.length ? `${plural(shown, "duty", "duties")}` : `Showing ${shown} of ${st.draft.duty_rules.length} duties`;
}

function headHtml(st: State, rule: DutyRule): string {
  const id = domId(rule.key);
  const open = st.expanded.has(rule.key);
  const levels = effectiveLevels(st, rule);
  const added = groupAddedLevels(st, rule);
  const groups = rule.allowed_cluster_keys;
  const excluded = rule.excluded_cluster_keys;
  const meta = [rule.campus, rule.is_24hr ? "24-hour" : `${rule.duration_hours} h`].filter(Boolean).join(" · ");
  const changed = isChanged(st, rule);
  return `
    <button type="button" class="rr-duty__toggle" id="rr-t-${id}" aria-expanded="${open}" ${open ? `aria-controls="rr-ed-${id}"` : ""}
      data-toggle-duty="${esc(rule.key)}" data-fk="toggle:${esc(rule.key)}">
      ${CHEVRON}
      <span class="rr-duty__title"><span class="rr-duty__name">${esc(rule.label || "Untitled duty")}</span>
      <span class="rr-duty__meta">${esc(meta)}${changed ? ` <span class="rr-dot" aria-hidden="true"></span><span class="rr-edited">Edited</span>` : ""}</span></span>
    </button>
    <div class="rr-duty__who" aria-label="Who can do it">
      ${levels.length ? levels.map((level) => `<span class="rr-tag${added.has(level) ? " is-auto" : ""}">${added.has(level) ? LOCK_ICON : ""}${esc(levelLabel(level))}</span>`).join("") : `<span class="rr-tag is-empty">No call level</span>`}
      ${groups.slice(0, 3).map((key) => `<span class="rr-tag is-group${groupByKey(st, key) ? "" : " is-missing"}">${esc(groupName(st, key))}</span>`).join("")}
      ${groups.length > 3 ? `<span class="rr-tag is-group">+${groups.length - 3}</span>` : ""}
      ${excluded.length ? `<span class="rr-tag is-excluded">Not ${esc(excluded.map((key) => groupName(st, key)).slice(0, 2).join(", "))}${excluded.length > 2 ? ` +${excluded.length - 2}` : ""}</span>` : ""}
    </div>
    <div class="rr-duty__flags">
      ${!rule.active ? badge("Inactive", "neutral") : ""}
      ${rule.active && rule.is_mandatory ? badge("Mandatory", "info") : ""}
      ${rule.active && rule.is_adjustable ? badge("Adjustable", "neutral") : ""}
      <span class="rr-duty__check" data-elig="${esc(rule.key)}">${eligHtml(st, rule)}</span>
    </div>`;
}

function eligHtml(st: State, rule: DutyRule): string {
  const problems = dutyProblems(st, rule.key);
  const missing = missingGroups(st, rule).length;
  const errors = problems.filter((p) => p.severity === "error").length + missing;
  const warnings = problems.length - problems.filter((p) => p.severity === "error").length;
  const count = eligibleNow(st, rule.key);
  let elig: string;
  if (count === null) elig = st.checkState === "error" ? `<span class="rr-count is-unknown" title="Couldn't check eligibility right now">— eligible</span>` : `<span class="rr-count is-unknown">Checking…</span>`;
  else if (count === 0 && rule.active) elig = `<span class="rr-count is-zero">Nobody eligible</span>`;
  else elig = `<span class="rr-count${st.checkFresh ? "" : " is-stale"}"><strong>${count}</strong> eligible</span>`;
  const total = errors + warnings;
  const warn = total ? `<span class="rr-warncount is-${errors ? "error" : "warning"}" title="${esc(plural(total, "problem"))}">${WARN_ICON}${total}<span class="visually-hidden"> ${errors ? plural(errors, "error") : ""}${errors && warnings ? " and " : ""}${warnings ? plural(warnings, "warning") : ""}</span></span>` : "";
  return `${elig}${warn}`;
}

function previewHtml(st: State, rule: DutyRule): string {
  const levels = effectiveLevels(st, rule);
  const allowed = rule.allowed_cluster_keys.map((key) => groupName(st, key));
  const excluded = rule.excluded_cluster_keys.map((key) => groupName(st, key));
  const duty = st.check?.duties?.[rule.key];
  const problems = dutyProblems(st, rule.key);
  const parts = [
    levels.length ? `call level <strong>${esc(levels.map(levelLabel).join(" or "))}</strong>` : `<strong>no call level chosen</strong>`,
    allowed.length ? `in <strong>${esc(allowed.join(" or "))}</strong>` : "",
    excluded.length ? `not in <strong>${esc(excluded.join(" or "))}</strong>` : "",
  ].filter(Boolean);
  let count = "";
  if (st.checkState === "error" && !st.checkFresh) {
    count = `<p class="rr-preview__count is-error">Couldn't check eligibility right now. Keep editing; it will be checked again. <button type="button" class="quiet-button btn-sm" data-retry-check>Try again</button></p>`;
  } else if (!duty || !st.checkFresh) {
    count = `<p class="rr-preview__count is-busy">${duty ? `<strong>${duty.eligible_now}</strong> eligible before this change · ` : ""}Checking who is eligible…</p>`;
  } else {
    const byLevel = Object.entries(duty.eligible_by_level ?? {}).filter(([, n]) => typeof n === "number").sort(([a], [b]) => levelOrder(normalizeLevel(a)) - levelOrder(normalizeLevel(b)));
    count = `<p class="rr-preview__count${duty.eligible_now === 0 && rule.active ? " is-zero" : ""}"><strong>${duty.eligible_now}</strong> ${duty.eligible_now === 1 ? "person is" : "people are"} eligible today${byLevel.length > 1 ? ` <span class="rr-preview__split">(${byLevel.map(([level, n]) => `${esc(levelLabel(normalizeLevel(level)))} ${n}`).join(" · ")})</span>` : ""}</p>`;
  }
  return `<p class="rr-preview__title">Who can do this duty</p>
    <p class="rr-preview__line">${rule.active ? "" : "<strong>Inactive</strong>: never generated. When active: "}Anyone on ${parts.join(", ")}.</p>
    ${count}
    ${problemsList(problems)}`;
}

function editorHtml(st: State, rule: DutyRule): string {
  const id = domId(rule.key);
  const key = rule.key;
  const base = baseLevels(rule);
  const added = groupAddedLevels(st, rule);
  const knownLevels = [...CALL_LEVELS.map((level) => level.key)];
  for (const level of base.levels) if (!knownLevels.includes(level)) knownLevels.push(level);
  const levelChips = knownLevels.map((level) => chip({
    pressed: base.levels.includes(level),
    label: levelLabel(level),
    duty: key,
    field: "allowed_call_levels",
    value: level,
    tone: CALL_LEVELS.some((item) => item.key === level) ? undefined : "danger",
  })).join("");
  const lockedChips = [...added.entries()].map(([level, names]) => `<span class="rr-chip is-locked" data-locked-level="${esc(level)}">
      ${LOCK_ICON}<span class="rr-chip__text"><span class="rr-chip__label">${esc(levelLabel(level))}</span><span class="rr-chip__sub">added by ${esc(names.join(", "))}</span></span></span>`).join("");
  const sortedGroups = [...st.groups].sort((a, b) => levelOrder(normalizeLevel(a.call_level)) - levelOrder(normalizeLevel(b.call_level)) || a.name.localeCompare(b.name));
  const groupChips = (field: "allowed_cluster_keys" | "excluded_cluster_keys") => {
    const selected = rule[field];
    const chips = sortedGroups.map((group) => {
      const pressed = selected.includes(group.key);
      const inactive = !group.active;
      const empty = group.active && group.members === 0;
      const sub = [group.call_level ? levelLabel(normalizeLevel(group.call_level)) : "", inactive ? "Inactive" : plural(group.members, "member"), empty ? "No members today" : ""].filter(Boolean).join(" · ");
      return chip({
        pressed, label: group.name, sub, duty: key, field, value: group.key,
        tone: inactive || empty ? "warning" : undefined,
        disabled: inactive && !pressed,
        note: inactive ? "Inactive group: its members are not eligible. Turn it on in Eligibility groups." : empty ? "This group has no members today." : undefined,
      });
    });
    const missing = selected.filter((k) => !groupByKey(st, k)).map((k) => chip({ pressed: true, label: `Missing group (${k})`, sub: "No longer exists · click to remove", duty: key, field, value: k, tone: "danger" }));
    return [...missing, ...chips].join("") || `<p class="rr-empty-note">No eligibility groups yet. <button type="button" class="quiet-button btn-sm" data-act="groups">Create one in Eligibility groups</button></p>`;
  };
  const hasInactive = [...rule.allowed_cluster_keys, ...rule.excluded_cluster_keys].some((k) => groupByKey(st, k) && !groupByKey(st, k)!.active);
  const inactiveExists = st.groups.some((group) => !group.active);
  const missing = missingGroups(st, rule);
  const levelNote = base.inferred && base.levels.length
    ? `<p class="rr-note">Taken from the duty name because none is chosen yet. Choose levels to set them yourself.</p>`
    : !base.levels.length && !added.size ? `<p class="rr-note is-warning">No call level is chosen, so nobody qualifies by call level. Choose at least one, or choose a group.</p>` : "";
  const flag = (name: Flag) => {
    const hint = HINTS[name];
    const lockedBy24 = rule.is_24hr && (name === "blocks_elective_same_day" || name === "blocks_elective_next_day");
    return switchHtml(st, `rr-${id}-${name}`, {
      label: hint.label, text: hint.text, more: hint.more,
      checked: lockedBy24 ? true : Boolean(rule[name]),
      attrs: `data-flag="${name}" data-duty="${esc(key)}"`,
      locked: lockedBy24 ? "Always on: this is a 24-hour duty." : undefined,
    });
  };
  const hours = Number(rule.duration_hours);
  const hoursBad = !Number.isFinite(hours) || hours < 0 || hours > 48;
  const categoryOptions = [...CATEGORIES];
  if (!categoryOptions.some((cat) => cat.key === rule.group)) categoryOptions.push({ key: rule.group, label: categoryLabel(rule.group), heading: "" });
  return `
    <div class="rr-editor__grid">
      <section class="rr-editor__col" aria-labelledby="rr-${id}-who">
        <h4 class="rr-editor__title" id="rr-${id}-who">Who can do it</h4>
        <div class="rr-field">
          ${fieldHead(st, `rr-${id}-levels`, HINTS.allowed_call_levels)}
          <div class="rr-chips" role="group" aria-labelledby="rr-${id}-levels-label" aria-describedby="rr-${id}-levels-hint">${levelChips}${lockedChips}</div>
          ${levelNote}
        </div>
        <div class="rr-field">
          ${fieldHead(st, `rr-${id}-allowed`, HINTS.allowed_cluster_keys)}
          <div class="rr-chips" role="group" aria-labelledby="rr-${id}-allowed-label" aria-describedby="rr-${id}-allowed-hint">${groupChips("allowed_cluster_keys")}</div>
        </div>
        <div class="rr-field">
          ${fieldHead(st, `rr-${id}-excluded`, HINTS.excluded_cluster_keys)}
          <div class="rr-chips" role="group" aria-labelledby="rr-${id}-excluded-label" aria-describedby="rr-${id}-excluded-hint">${groupChips("excluded_cluster_keys")}</div>
        </div>
        ${hasInactive ? `<p class="rr-note is-warning">An inactive group is selected. Its members are not eligible until the group is turned on in Eligibility groups.</p>`
          : inactiveExists ? `<p class="rr-note">Greyed groups are inactive; turn them on in Eligibility groups to choose them.</p>` : ""}
        ${missing.length ? `<div class="rr-note is-danger"><p>${esc(plural(missing.length, "selected group no longer exists", "selected groups no longer exist"))}.</p>
          <button type="button" class="danger-button btn-sm" data-remove-missing="${esc(key)}">Remove missing groups</button></div>` : ""}
        <div class="rr-preview" data-preview="${esc(key)}" aria-live="polite">${previewHtml(st, rule)}</div>
      </section>
      <section class="rr-editor__col" aria-labelledby="rr-${id}-how">
        <h4 class="rr-editor__title" id="rr-${id}-how">How it behaves</h4>
        <div class="rr-field">
          ${fieldHead(st, `rr-${id}-label`, HINTS.label, `rr-${id}-label-input`)}
          <input type="text" id="rr-${id}-label-input" value="${esc(rule.label)}" data-text-field="label" data-duty="${esc(key)}" data-fk="label:${esc(key)}" aria-describedby="rr-${id}-label-hint" maxlength="120" />
        </div>
        <div class="rr-field-pair">
          <div class="rr-field">
            ${fieldHead(st, `rr-${id}-group`, HINTS.group, `rr-${id}-group-input`)}
            <select id="rr-${id}-group-input" data-select-field="group" data-duty="${esc(key)}" data-fk="group:${esc(key)}" aria-describedby="rr-${id}-group-hint">
              ${categoryOptions.map((cat) => `<option value="${esc(cat.key)}" ${cat.key === rule.group ? "selected" : ""}>${esc(cat.label)}</option>`).join("")}
            </select>
          </div>
          <div class="rr-field">
            ${fieldHead(st, `rr-${id}-hours`, HINTS.duration_hours, `rr-${id}-hours-input`)}
            <input type="number" inputmode="numeric" min="0" max="48" step="1" id="rr-${id}-hours-input" value="${Number.isFinite(hours) ? hours : ""}" data-num-field="duration_hours" data-duty="${esc(key)}" data-fk="hours:${esc(key)}"
              aria-describedby="rr-${id}-hours-hint rr-${id}-hours-err" ${hoursBad ? 'aria-invalid="true"' : ""} />
            <p class="rr-field-error" id="rr-${id}-hours-err">${hoursBad ? "Enter hours from 0 to 48." : ""}</p>
          </div>
        </div>
        <div class="rr-switches">${FLAGS.map(flag).join("")}</div>
      </section>
    </div>
    <div class="rr-editor__foot">
      <p class="rr-editor__state">${isChanged(st, rule) ? "Edited · not saved yet" : "No unsaved edits"}</p>
      <button type="button" class="quiet-button btn-sm" data-reset-duty="${esc(key)}" ${isChanged(st, rule) ? "" : "disabled"} data-fk="reset:${esc(key)}">Reset this duty</button>
      <button type="button" class="icon-button btn-sm" data-toggle-duty="${esc(key)}" data-fk="done:${esc(key)}">Done</button>
    </div>`;
}

function dutyHtml(st: State, rule: DutyRule): string {
  const id = domId(rule.key);
  const open = st.expanded.has(rule.key);
  return `<article class="rr-duty${open ? " is-open" : ""}${rule.active ? "" : " is-inactive"}${isChanged(st, rule) ? " is-changed" : ""}" data-duty-row="${esc(rule.key)}" id="rr-duty-${id}">
    <div class="rr-duty__head" data-head="${esc(rule.key)}">${headHtml(st, rule)}</div>
    ${open ? `<div class="rr-editor" id="rr-ed-${id}" role="region" aria-labelledby="rr-t-${id}">${editorHtml(st, rule)}</div>` : ""}
  </article>`;
}

function listHtml(st: State): string {
  const visible = st.draft.duty_rules.filter((rule) => matchesFilter(st, rule));
  if (!visible.length) {
    return emptyState({
      title: st.draft.duty_rules.length ? "No duties match" : "No duties are set up yet",
      body: st.draft.duty_rules.length ? "Clear the search or choose another filter." : "Duties come from the department's duty types.",
      actionHtml: st.draft.duty_rules.length ? `<button type="button" class="icon-button" data-clear-filters>Show all duties</button>` : "",
    });
  }
  const order = CATEGORIES.map((cat) => cat.key);
  const cats = [...new Set(visible.map((rule) => rule.group))].sort((a, b) => {
    const ia = order.indexOf(a);
    const ib = order.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || String(a).localeCompare(String(b));
  });
  return cats.map((cat) => {
    const rules = visible.filter((rule) => rule.group === cat);
    const total = st.draft.duty_rules.filter((rule) => rule.group === cat).length;
    const collapsed = st.collapsed.has(cat);
    const edited = rules.filter((rule) => isChanged(st, rule)).length;
    const nobody = rules.filter((rule) => rule.active && eligibleNow(st, rule.key) === 0).length;
    const catId = `rr-cat-${domId(cat || "none")}`;
    return `<section class="rr-cat" data-cat="${esc(cat)}">
      <h3 class="rr-cat__head">
        <button type="button" class="rr-cat__toggle" aria-expanded="${!collapsed}" aria-controls="${catId}" data-toggle-cat="${esc(cat)}" data-fk="cat:${esc(cat)}">
          ${CHEVRON}<span class="rr-cat__name">${esc(categoryLabel(cat, true))}</span>
          <span class="rr-cat__count">${rules.length === total ? plural(total, "duty", "duties") : `${rules.length} of ${total} duties`}</span>
          ${edited ? `<span class="rr-cat__flag is-info">${edited} edited</span>` : ""}
          ${nobody ? `<span class="rr-cat__flag is-danger">${nobody} with nobody</span>` : ""}
        </button>
      </h3>
      <div class="rr-cat__body" id="${catId}" ${collapsed ? "hidden" : ""}>${rules.map((rule) => dutyHtml(st, rule)).join("")}</div>
    </section>`;
  }).join("");
}

function guardHtml(st: State): string {
  const problems = (st.check?.problems ?? []).filter((problem) => !problem.duty_key);
  const warn = Number(getPath(st.draft, "unit_staffing_rules.warning_unavailable_percent"));
  const hard = Number(getPath(st.draft, "unit_staffing_rules.hard_block_unavailable_percent"));
  const localWarn = hard < warn && !problems.some((p) => p.code === "guardrail")
    ? [{ duty_key: null, field: "unit_staffing_rules.hard_block_unavailable_percent", code: "guardrail", severity: "warning" as const, message: "Hard block % is below warning %.", fix: "Set the hard block at or above the warning % so people are warned before they are refused." }]
    : [];
  const changed = changedGuards(st).length;
  const fields = GUARD_FIELDS.map((field) => {
    const id = `rr-g-${domId(field.path)}`;
    const value = getPath(st.draft, field.path);
    const num = value === null || value === undefined || value === "" ? NaN : Number(value);
    const bad = Number.isFinite(num) ? num < field.min || num > field.max : !field.nullable;
    return `<div class="rr-field rr-guard__field">
      ${fieldHead(st, id, { label: field.label, text: field.text, more: field.more }, `${id}-input`)}
      <div class="rr-input-unit">
        <input type="number" inputmode="numeric" id="${id}-input" min="${field.min}" max="${field.max}" step="1" value="${Number.isFinite(num) ? num : ""}"
          ${field.nullable ? 'placeholder="No cap"' : ""} data-guard-num="${esc(field.path)}" data-fk="guard:${esc(field.path)}"
          aria-describedby="${id}-hint ${id}-err" ${bad ? 'aria-invalid="true"' : ""} />
        <span class="rr-input-unit__unit" aria-hidden="true">${esc(field.unit)}</span>
      </div>
      <p class="rr-field-error" id="${id}-err">${bad ? `Enter a number from ${field.min} to ${field.max}${field.nullable ? ", or leave it empty" : ""}.` : ""}</p>
    </div>`;
  }).join("");
  const switches = GUARD_SWITCHES.map((item) => switchHtml(st, `rr-g-${domId(item.path)}`, {
    label: item.label, text: item.text, more: item.more,
    checked: Boolean(getPath(st.draft, item.path)),
    attrs: `data-guard-switch="${esc(item.path)}"`,
  })).join("");
  return `<h3 class="rr-guard__heading">
      <button type="button" class="rr-cat__toggle rr-guard__toggle" aria-expanded="${st.guardOpen}" aria-controls="rr-guard-body" data-guard-toggle data-fk="guard-toggle">
        ${CHEVRON}<span class="rr-cat__name">Safety guardrails</span>
        <span class="rr-cat__count">Rest, unit cover and monthly caps for everyone</span>
        ${changed ? `<span class="rr-cat__flag is-info">${changed} edited</span>` : ""}
        ${problems.length + localWarn.length ? `<span class="rr-cat__flag is-warning">${problems.length + localWarn.length} to check</span>` : ""}
      </button>
    </h3>
    <div class="rr-guard__body" id="rr-guard-body" ${st.guardOpen ? "" : "hidden"}>
      <p class="rr-guard__intro">These limits apply to every duty and member. They protect rest and keep enough people in each unit.</p>
      ${problemsList([...problems, ...localWarn])}
      <div class="rr-guard__grid">${fields}</div>
      <div class="rr-switches rr-guard__switches">${switches}</div>
    </div>`;
}

function dockHtml(st: State): string {
  const changes = changeCount(st);
  const duties = changedDuties(st);
  const guards = changedGuards(st).length;
  const what = [...duties.slice(0, 3).map((rule) => rule.label), ...(guards ? ["guardrails"] : [])].join(", ") + (duties.length > 3 ? ` +${duties.length - 3} more` : "");
  return `<div class="rr-savebar" ${changes ? "" : "hidden"}>
      <p class="rr-savebar__text"><strong data-unsaved-count>${plural(changes, "unsaved change")}</strong><span class="rr-savebar__what">${esc(what)}</span></p>
      <div class="rr-savebar__actions">
        <button type="button" class="quiet-button" data-discard data-fk="discard">Discard</button>
        <button type="button" class="primary" data-review data-fk="review">Review &amp; save</button>
      </div>
    </div>`;
}

// ---------------------------------------------------------------------------------------
// Painting
// ---------------------------------------------------------------------------------------

/** Re-renders part of the page and puts keyboard focus back on the same control. */
function keepFocus(st: State, fn: () => void): void {
  const active = document.activeElement as HTMLElement | null;
  const fk = active && st.page.contains(active) ? active.dataset.fk : undefined;
  const range = active instanceof HTMLInputElement && active.type === "text" ? [active.selectionStart, active.selectionEnd] : null;
  fn();
  if (!fk) return;
  const next = st.page.querySelector<HTMLElement>(`[data-fk="${sel(fk)}"]`);
  if (next && next !== active) {
    next.focus({ preventScroll: true });
    if (range && next instanceof HTMLInputElement) try { next.setSelectionRange(range[0], range[1]); } catch { /* not a text field */ }
  }
}

function part(st: State, name: string): HTMLElement | null {
  return st.page.querySelector<HTMLElement>(`[data-part="${name}"]`);
}

function paintSummary(st: State): void {
  keepFocus(st, () => {
    const tiles = part(st, "tiles");
    if (tiles) tiles.innerHTML = tilesHtml(st);
    const notices = part(st, "notices");
    if (notices) notices.innerHTML = noticesHtml(st);
    const dock = part(st, "savebar");
    if (dock) dock.innerHTML = dockHtml(st);
  });
  toolbarCountsHtml(st);
}

function paintList(st: State): void {
  keepFocus(st, () => {
    const list = part(st, "list");
    if (list) list.innerHTML = listHtml(st);
  });
  toolbarCountsHtml(st);
}

function paintDuty(st: State, key: string): void {
  const rule = draftRule(st, key);
  const row = st.page.querySelector<HTMLElement>(`[data-duty-row="${sel(key)}"]`);
  if (!rule || !row) return;
  keepFocus(st, () => { row.outerHTML = dutyHtml(st, rule); });
}

function paintHead(st: State, key: string): void {
  const rule = draftRule(st, key);
  const row = st.page.querySelector<HTMLElement>(`[data-duty-row="${sel(key)}"]`);
  const head = row?.querySelector<HTMLElement>("[data-head]");
  if (!rule || !row || !head) return;
  keepFocus(st, () => { head.innerHTML = headHtml(st, rule); });
  row.classList.toggle("is-changed", isChanged(st, rule));
  const state = row.querySelector(".rr-editor__state");
  if (state) state.textContent = isChanged(st, rule) ? "Edited · not saved yet" : "No unsaved edits";
  const reset = row.querySelector<HTMLButtonElement>("[data-reset-duty]");
  if (reset) reset.disabled = !isChanged(st, rule);
}

function paintGuard(st: State): void {
  keepFocus(st, () => {
    const guard = part(st, "guard");
    if (guard) guard.innerHTML = guardHtml(st);
  });
}

/** Updates eligible counts, warnings and previews in place (after a check). */
function paintChecks(st: State): void {
  for (const rule of st.draft.duty_rules) {
    const elig = st.page.querySelector<HTMLElement>(`[data-elig="${sel(rule.key)}"]`);
    if (elig) elig.innerHTML = eligHtml(st, rule);
    const preview = st.page.querySelector<HTMLElement>(`[data-preview="${sel(rule.key)}"]`);
    if (preview) keepFocus(st, () => { preview.innerHTML = previewHtml(st, rule); });
    const head = st.page.querySelector<HTMLElement>(`[data-duty-row="${sel(rule.key)}"] .rr-duty__who`);
    if (head && st.checkFresh) {
      const fresh = document.createElement("div");
      fresh.innerHTML = headHtml(st, rule);
      const who = fresh.querySelector(".rr-duty__who");
      if (who) head.innerHTML = who.innerHTML;
    }
  }
  paintSummary(st);
  const guardOpen = st.guardOpen;
  const guard = part(st, "guard");
  const editing = guard?.contains(document.activeElement) && document.activeElement instanceof HTMLInputElement;
  if (!editing || !guardOpen) paintGuard(st);
}

function setStatus(st: State, text: string, tone: Tone = "info"): void {
  st.status = text ? { text, tone } : null;
  const region = part(st, "status");
  if (!region) return;
  region.className = `rr-status${text ? ` is-${tone}` : ""}`;
  region.innerHTML = text ? `<span>${esc(text)}</span><button type="button" class="quiet-button btn-sm" data-status-dismiss aria-label="Dismiss message">Dismiss</button>` : "";
}

function alive(st: State): boolean {
  return state === st && st.root.contains(st.page) && (st.opts.isCurrent?.() ?? true);
}

// ---------------------------------------------------------------------------------------
// Live check (debounced; never blocks editing)
// ---------------------------------------------------------------------------------------

function scheduleCheck(st: State, delay = 400): void {
  window.clearTimeout(st.checkTimer);
  st.checkFresh = false;
  st.checkTimer = window.setTimeout(() => void runCheck(st), delay);
}

async function runCheck(st: State): Promise<RotaRulesCheck | null> {
  window.clearTimeout(st.checkTimer);
  const seq = ++st.checkSeq;
  st.checkState = "checking";
  try {
    const result = await checkRotaRules(payloadOf(st.draft));
    if (seq !== st.checkSeq || !alive(st)) return result;
    st.check = { problems: result?.problems ?? [], duties: result?.duties ?? {} };
    st.checkState = "idle";
    st.checkFresh = true;
    paintChecks(st);
    return st.check;
  } catch {
    if (seq !== st.checkSeq || !alive(st)) return null;
    st.checkState = "error";
    st.checkFresh = false;
    paintChecks(st);
    return null;
  }
}

/** After any edit: repaint what depends on it and re-check. */
function edited(st: State, key: string | null, scope: "duty" | "head" | "list" | "guard" | "none" = "duty"): void {
  if (key && scope === "duty") paintDuty(st, key);
  if (key && scope === "head") paintHead(st, key);
  if (scope === "list") paintList(st);
  if (scope === "guard") paintGuard(st);
  paintSummary(st);
  scheduleCheck(st);
}

// ---------------------------------------------------------------------------------------
// Editing actions
// ---------------------------------------------------------------------------------------

function toggleChip(st: State, button: HTMLElement): void {
  const key = button.dataset.duty ?? "";
  const field = button.dataset.field as ListField;
  const value = button.dataset.value ?? "";
  const rule = draftRule(st, key);
  if (!rule || !LIST_FIELDS.includes(field)) return;
  if (button.getAttribute("aria-disabled") === "true") {
    const group = groupByKey(st, value);
    setStatus(st, `${group?.name ?? "This group"} is inactive, so it cannot be chosen. Turn it on in Eligibility groups first.`, "warning");
    return;
  }
  if (field === "allowed_call_levels" && !rule.allowed_call_levels.length) rule.allowed_call_levels = [...baseLevels(rule).levels];
  const list = rule[field];
  const index = list.indexOf(value);
  if (index >= 0) {
    list.splice(index, 1);
  } else {
    list.push(value);
    const other: ListField | null = field === "allowed_cluster_keys" ? "excluded_cluster_keys" : field === "excluded_cluster_keys" ? "allowed_cluster_keys" : null;
    if (other && rule[other].includes(value)) {
      rule[other] = rule[other].filter((k) => k !== value);
      setStatus(st, `${groupName(st, value)} moved from ${FIELD_LABELS[other].toLowerCase()} to ${FIELD_LABELS[field].toLowerCase()}: a group cannot be both.`, "info");
    }
  }
  edited(st, key);
}

function toggleFlag(st: State, button: HTMLElement): void {
  const key = button.dataset.duty ?? "";
  const flag = button.dataset.flag as Flag;
  const rule = draftRule(st, key);
  if (!rule || !FLAGS.includes(flag)) return;
  if (button.getAttribute("aria-disabled") === "true") {
    setStatus(st, `${HINTS[flag].label} is always on for 24-hour duties.`, "info");
    return;
  }
  rule[flag] = !rule[flag];
  edited(st, key);
}

function removeMissing(st: State, target: string): void {
  let removed = 0;
  for (const rule of st.draft.duty_rules) {
    if (target !== "*" && rule.key !== target) continue;
    for (const field of ["allowed_cluster_keys", "excluded_cluster_keys"] as const) {
      const keep = rule[field].filter((key) => groupByKey(st, key));
      removed += rule[field].length - keep.length;
      rule[field] = keep;
    }
  }
  setStatus(st, removed ? `Removed ${plural(removed, "missing group")}. Save to keep this.` : "No missing groups to remove.", removed ? "success" : "info");
  if (target === "*") edited(st, null, "list");
  else edited(st, target);
}

function resetDuty(st: State, key: string): void {
  const saved = savedRule(st, key);
  const index = st.draft.duty_rules.findIndex((rule) => rule.key === key);
  if (!saved || index < 0) return;
  st.draft.duty_rules[index] = clone(saved);
  setStatus(st, `${saved.label} is back to its saved settings.`, "info");
  edited(st, null, "list");
  st.page.querySelector<HTMLElement>(`[data-fk="${sel(`toggle:${key}`)}"]`)?.focus();
}

function discardAll(st: State): void {
  const n = changeCount(st);
  if (!n) return;
  if (!window.confirm(`Discard ${plural(n, "unsaved change")}? The saved rules stay as they are.`)) return;
  st.draft = clone(st.saved);
  setStatus(st, `Discarded ${plural(n, "unsaved change")}.`, "info");
  paintList(st);
  paintGuard(st);
  edited(st, null, "none");
  st.page.querySelector<HTMLElement>("[data-part=search] input")?.focus();
}

function toggleDuty(st: State, key: string): void {
  if (st.expanded.has(key)) st.expanded.delete(key);
  else st.expanded.add(key);
  paintDuty(st, key);
}

/** Opens a duty from anywhere (Review, problems) and focuses the field that needs attention. */
function goToDuty(st: State, key: string | null, field: string): void {
  if (!key) {
    st.guardOpen = true;
    paintGuard(st);
    const target = st.page.querySelector<HTMLElement>(`[data-guard-num="${sel(field)}"]`) ?? st.page.querySelector<HTMLElement>("[data-guard-toggle]");
    target?.scrollIntoView({ block: "center", behavior: reducedMotion() ? "auto" : "smooth" });
    target?.focus({ preventScroll: true });
    return;
  }
  const rule = draftRule(st, key);
  if (!rule) return;
  if (!matchesFilter(st, rule)) {
    st.filter = "all";
    st.query = "";
    const search = st.page.querySelector<HTMLInputElement>("[data-search]");
    if (search) search.value = "";
  }
  st.expanded.add(key);
  st.collapsed.delete(rule.group);
  paintList(st);
  const row = st.page.querySelector<HTMLElement>(`[data-duty-row="${sel(key)}"]`);
  const selector: Record<string, string> = {
    duration_hours: "[data-num-field]",
    label: "[data-text-field]",
    group: "[data-select-field]",
    allowed_call_levels: '[data-field="allowed_call_levels"]',
    allowed_cluster_keys: '[data-field="allowed_cluster_keys"]',
    excluded_cluster_keys: '[data-field="excluded_cluster_keys"]',
  };
  const target = (selector[field] && row?.querySelector<HTMLElement>(selector[field])) || row?.querySelector<HTMLElement>("[data-toggle-duty]");
  row?.scrollIntoView({ block: "start", behavior: reducedMotion() ? "auto" : "smooth" });
  target?.focus({ preventScroll: true });
}

// ---------------------------------------------------------------------------------------
// Saving: review, 409 stale and 422 invalid
// ---------------------------------------------------------------------------------------

function fmtValue(st: State, field: string, value: unknown): string {
  if (field === "allowed_call_levels") return (value as string[]).length ? (value as string[]).map((l) => levelLabel(normalizeLevel(l))).join(", ") : "from duty name";
  if (field === "allowed_cluster_keys" || field === "excluded_cluster_keys") return (value as string[]).length ? (value as string[]).map((k) => groupName(st, k)).join(", ") : "none";
  if (field === "group") return categoryLabel(String(value));
  if (typeof value === "boolean") return value ? "on" : "off";
  if (value === null || value === undefined || value === "") return "none";
  return String(value);
}

/** Readable differences between two versions of a duty, as "Field: before → after". */
function dutyDiff(st: State, before: DutyRule | undefined, after: DutyRule | undefined): string[] {
  if (!before || !after) return [];
  const lines: string[] = [];
  for (const field of Object.keys(FIELD_LABELS)) {
    const a = (before as unknown as Record<string, unknown>)[field];
    const b = (after as unknown as Record<string, unknown>)[field];
    const same = Array.isArray(a) && Array.isArray(b) ? JSON.stringify([...a].sort()) === JSON.stringify([...b].sort()) : JSON.stringify(a) === JSON.stringify(b);
    if (!same) lines.push(`${FIELD_LABELS[field]}: ${fmtValue(st, field, a ?? (Array.isArray(b) ? [] : null))} → ${fmtValue(st, field, b ?? (Array.isArray(a) ? [] : null))}`);
  }
  return lines;
}

function guardDiff(before: unknown, after: unknown): string[] {
  const all = [...GUARD_FIELDS, ...GUARD_SWITCHES];
  return all.flatMap((field) => {
    const a = getPath(before, field.path);
    const b = getPath(after, field.path);
    if (JSON.stringify(a ?? null) === JSON.stringify(b ?? null)) return [];
    const show = (v: unknown) => (typeof v === "boolean" ? (v ? "on" : "off") : v === null || v === undefined || v === "" ? "no cap" : String(v));
    return [`${field.label}: ${show(a)} → ${show(b)}`];
  });
}

function changesHtml(st: State): string {
  const duties = changedDuties(st);
  const guards = guardDiff(st.saved, st.draft);
  if (!duties.length && !guards.length) return `<p class="rr-muted">No changes.</p>`;
  return `<ul class="rr-diff">${duties.map((rule) => `<li><strong>${esc(rule.label)}</strong>
      <ul>${(dutyDiff(st, savedRule(st, rule.key), rule).map((line) => `<li>${esc(line)}</li>`).join("")) || "<li>Changed</li>"}</ul></li>`).join("")}
    ${guards.length ? `<li><strong>Safety guardrails</strong><ul>${guards.map((line) => `<li>${esc(line)}</li>`).join("")}</ul></li>` : ""}</ul>`;
}

function rebaseOnto(st: State, latest: RotaPhaseOneRules): void {
  const mine = changedDuties(st);
  const myGuards = changedGuards(st).map((path) => [path, getPath(st.draft, path)] as const);
  const fresh = normalizeRules(latest);
  st.saved = clone(fresh);
  st.draft = clone(fresh);
  st.revision = fresh.revision ?? null;
  if (fresh.groups) st.groups = fresh.groups;
  for (const rule of mine) {
    const index = st.draft.duty_rules.findIndex((item) => item.key === rule.key);
    if (index >= 0) st.draft.duty_rules[index] = clone(rule);
  }
  for (const [path, value] of myGuards) setPath(st.draft, path, value);
}

function applySaved(st: State, rules: RotaPhaseOneRules, message: string): void {
  const fresh = normalizeRules(rules);
  st.saved = clone(fresh);
  st.draft = clone(fresh);
  st.revision = fresh.revision ?? null;
  if (fresh.groups) st.groups = fresh.groups;
  paintList(st);
  paintGuard(st);
  paintSummary(st);
  setStatus(st, message, "success");
  scheduleCheck(st, 0);
}

function closeDialog(dialog: HTMLDialogElement, after?: () => void): void {
  if (after) dialog.addEventListener("close", () => after(), { once: true });
  dialog.close();
  dialog.remove();
}

async function openReview(st: State): Promise<void> {
  const dialog = workspaceDialog("Review rota rule changes", "rr-dialog");
  let phase: "checking" | "ready" | "saving" | "stale" | "reloading" = "checking";
  let problems: RotaRuleProblem[] = [];
  let checkFailed = false;
  let message = "";
  const label = (key: string | null) => (key ? draftRule(st, key)?.label ?? codeLabel(key) : "Safety guardrails");
  const render = () => {
    const errors = problems.filter((p) => p.severity === "error");
    const warnings = problems.filter((p) => p.severity !== "error");
    const n = changeCount(st);
    const saveLabel = phase === "saving" ? "Saving…" : errors.length ? "Fix the errors to save" : checkFailed ? "Save without the check" : warnings.length ? "Save anyway" : "Save changes";
    const item = (p: RotaRuleProblem) => `<li class="rr-review__item is-${p.severity === "error" ? "error" : "warning"}">
        <div><p class="rr-review__msg"><strong>${esc(label(p.duty_key))}</strong>: ${esc(p.message)}</p>${p.fix ? `<p class="rr-review__fix">${esc(p.fix)}</p>` : ""}</div>
        <button type="button" class="icon-button btn-sm" data-goto="${esc(p.duty_key ?? "")}" data-goto-field="${esc(p.field ?? "")}" aria-label="${esc(p.duty_key ? `Go to duty: ${label(p.duty_key)}` : "Go to safety guardrails")}">${p.duty_key ? "Go to duty" : "Go to guardrails"}</button></li>`;
    dialog.innerHTML = `<header class="mw-header"><div><h2>Review changes</h2><p>Nothing is saved until you confirm.</p></div>
        <button type="button" data-close aria-label="Close review">×</button></header>
      <div class="mw-content rr-review">
        <section class="rr-review__section"><h3>${badge(String(n), "info")} What will change</h3>${changesHtml(st)}</section>
        ${phase === "checking" ? `<p class="rr-review__busy">Checking the rules…</p>` : ""}
        ${phase === "stale" ? nextStep({
          tone: "warning",
          title: "Another admin changed the rules",
          body: "Someone saved the rota rules after you opened this page, so yours were not saved. Reload to use their version (your edits are discarded), or review again: your edits are laid over their version for you to check before saving.",
          actionHtml: `<button type="button" class="icon-button btn-sm" data-stale-reload>Reload (discard mine)</button><button type="button" class="primary btn-sm" data-stale-review>Review again</button>`,
        }) : ""}
        ${checkFailed && phase !== "stale" ? nextStep({ tone: "warning", title: "Couldn't check eligibility right now", body: "You can still save. The server checks the rules again and refuses anything invalid." }) : ""}
        ${errors.length ? `<section class="rr-review__section"><h3>${badge(String(errors.length), "danger")} Must be fixed before saving</h3><ul class="rr-review__list">${errors.map(item).join("")}</ul></section>` : ""}
        ${warnings.length ? `<section class="rr-review__section"><h3>${badge(String(warnings.length), "warning")} Worth a look (saving is still allowed)</h3><ul class="rr-review__list">${warnings.map(item).join("")}</ul></section>` : ""}
        ${phase === "ready" && !problems.length && !checkFailed ? `<p class="rr-review__ok">${badge("All clear", "success")} No problems found.</p>` : ""}
        <div class="admin-preview__actions rr-review__actions">
          ${phase === "stale" ? "" : `<button type="button" class="primary" data-save ${phase !== "ready" || errors.length || !n ? "disabled" : ""}>${esc(saveLabel)}</button>`}
          <button type="button" class="icon-button" data-close>Keep editing</button>
          <p role="status" aria-live="polite" class="admin-preview__message">${esc(message)}</p>
        </div>
      </div>`;
  };
  const check = async () => {
    phase = "checking";
    render();
    const result = await runCheck(st);
    checkFailed = !result;
    problems = result?.problems ?? [];
    phase = "ready";
    render();
    const focusTarget = dialog.querySelector<HTMLElement>("[data-goto], [data-save]:not([disabled]), [data-close]");
    if (focusTarget && !dialog.contains(document.activeElement)) focusTarget.focus();
  };
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    if (phase !== "saving") closeDialog(dialog);
  });
  dialog.addEventListener("click", async (event) => {
    const target = event.target as HTMLElement;
    if (target.closest("[data-close]")) {
      if (phase !== "saving") closeDialog(dialog);
      return;
    }
    const goto = target.closest<HTMLElement>("[data-goto]");
    if (goto) {
      const key = goto.dataset.goto || null;
      const field = goto.dataset.gotoField ?? "";
      closeDialog(dialog, () => goToDuty(st, key, field));
      return;
    }
    if (target.closest("[data-stale-reload]")) {
      phase = "reloading";
      message = "Loading the latest rules…";
      render();
      try {
        const latest = await getRotaPhaseOneRules();
        closeDialog(dialog);
        applySaved(st, latest, "Loaded the latest rules. Your unsaved edits were discarded.");
      } catch (error) {
        phase = "stale";
        message = error instanceof Error ? error.message : "Could not load the latest rules";
        render();
      }
      return;
    }
    if (target.closest("[data-stale-review]")) {
      phase = "reloading";
      message = "Loading the latest rules…";
      render();
      try {
        const latest = await getRotaPhaseOneRules();
        rebaseOnto(st, latest);
        paintList(st);
        paintGuard(st);
        paintSummary(st);
        await check();
        message = "Your edits were laid over the latest rules. Check them, then save.";
        render();
      } catch (error) {
        phase = "stale";
        message = error instanceof Error ? error.message : "Could not load the latest rules";
        render();
      }
      return;
    }
    if (target.closest("[data-save]") && phase === "ready") {
      phase = "saving";
      message = "Saving…";
      render();
      const n = changeCount(st);
      try {
        const saved = await updateRotaPhaseOneRules(payloadOf(st.draft), st.revision);
        closeDialog(dialog);
        if (alive(st)) applySaved(st, saved?.duty_rules ? saved : await getRotaPhaseOneRules(), `Rota rules saved: ${plural(n, "change")}.`);
      } catch (error) {
        if (isStaleRulesError(error)) {
          phase = "stale";
          message = "";
        } else {
          const invalid = invalidRulesProblems(error);
          phase = "ready";
          if (invalid) {
            problems = invalid;
            checkFailed = false;
            if (st.check) st.check.problems = invalid;
            paintChecks(st);
            message = "The server found problems that must be fixed before saving.";
          } else {
            message = error instanceof Error ? error.message : "Could not save the rota rules";
          }
        }
        render();
        dialog.querySelector<HTMLElement>("[data-stale-review], [data-goto], [data-close]")?.focus();
      }
    }
  });
  render();
  await check();
}

// ---------------------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------------------

const TIME_FORMAT = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" });

function formatWhen(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? String(iso ?? "") : `${formatDate(iso, { weekday: false })}, ${TIME_FORMAT.format(date)}`;
}

function versionDiffHtml(st: State, rules: RotaRulesPayload): string {
  const then = new Map((rules.duty_rules ?? []).map((rule) => [rule.key, { ...rule, allowed_call_levels: rule.allowed_call_levels ?? [], allowed_cluster_keys: rule.allowed_cluster_keys ?? [], excluded_cluster_keys: rule.excluded_cluster_keys ?? [] }]));
  const now = new Map(st.saved.duty_rules.map((rule) => [rule.key, rule]));
  const rows: string[] = [];
  for (const [key, old] of then) {
    const current = now.get(key);
    if (!current) { rows.push(`<li><strong>${esc(old.label)}</strong><ul><li>Only in this version</li></ul></li>`); continue; }
    const lines = dutyDiff(st, old, current);
    if (lines.length) rows.push(`<li><strong>${esc(current.label)}</strong><ul>${lines.map((line) => `<li>${esc(line)}</li>`).join("")}</ul></li>`);
  }
  for (const [key, current] of now) if (!then.has(key)) rows.push(`<li><strong>${esc(current.label)}</strong><ul><li>Not in this version</li></ul></li>`);
  const guards = guardDiff(rules, st.saved);
  if (guards.length) rows.push(`<li><strong>Safety guardrails</strong><ul>${guards.map((line) => `<li>${esc(line)}</li>`).join("")}</ul></li>`);
  if (!rows.length) return `<p class="rr-muted">Same as the current rules.</p>`;
  return `<p class="rr-muted">Shown as <em>this version → current rules</em>. ${plural(rows.length, "difference")}.</p><ul class="rr-diff">${rows.join("")}</ul>`;
}

async function openHistory(st: State): Promise<void> {
  const dialog = workspaceDialog("Rota rules history", "rr-dialog");
  let versions: RotaRuleVersionSummary[] | null = null;
  let loadError = "";
  const diffs = new Map<string, string>();
  const openDiffs = new Set<string>();
  let confirming: string | null = null;
  let busy = false;
  let stale = false;
  let message = "";
  const render = () => {
    const unsaved = changeCount(st);
    const list = versions === null
      ? `<p class="rr-review__busy">${loadError ? "" : "Loading saved versions…"}</p>`
      : !versions.length
        ? emptyState({ title: "No saved versions yet", body: "Each save from now on is kept here, with who saved it and which duties changed." })
        : `<ol class="rr-history">${versions.map((version, index) => {
            const vid = domId(version.version_id);
            const isCurrent = index === 0 && (!st.revision || version.revision === st.revision);
            const changed = version.changed_duties ?? [];
            return `<li class="rr-history__item">
              <div class="rr-history__head"><strong>${esc(formatWhen(version.saved_at))}</strong>
                <span class="rr-muted">by ${esc(version.saved_by || "unknown")}</span>${isCurrent ? badge("Current", "success") : ""}</div>
              <p class="rr-history__changed">${changed.length ? `Changed: ${esc(changed.slice(0, 6).join(", "))}${changed.length > 6 ? ` and ${changed.length - 6} more` : ""}` : "No duty changes recorded"}</p>
              ${version.note ? `<p class="rr-muted">${esc(version.note)}</p>` : ""}
              <div class="rr-history__actions">
                <button type="button" class="icon-button btn-sm" data-compare="${esc(version.version_id)}" aria-expanded="${openDiffs.has(version.version_id)}" aria-controls="rr-v-${vid}">Compare with current</button>
                ${isCurrent ? "" : `<button type="button" class="quiet-button btn-sm" data-restore="${esc(version.version_id)}" ${busy ? "disabled" : ""}>Restore…</button>`}
              </div>
              <div class="rr-history__diff" id="rr-v-${vid}" ${openDiffs.has(version.version_id) ? "" : "hidden"}>${diffs.get(version.version_id) ?? '<p class="rr-muted">Loading…</p>'}</div>
              ${confirming === version.version_id ? `<div class="rr-history__confirm" role="group" aria-label="Confirm restore">
                <p><strong>Restore the rules saved ${esc(formatWhen(version.saved_at))}?</strong> They become the current rules as a new version; today's rules stay in this history.${unsaved ? ` Your ${plural(unsaved, "unsaved change")} on this page will be discarded.` : ""}</p>
                <div class="rr-history__actions"><button type="button" class="primary btn-sm" data-restore-confirm="${esc(version.version_id)}" ${busy ? "disabled" : ""}>${busy ? "Restoring…" : "Restore this version"}</button>
                <button type="button" class="icon-button btn-sm" data-restore-cancel>Cancel</button></div></div>` : ""}
            </li>`;
          }).join("")}</ol>`;
    dialog.innerHTML = `<header class="mw-header"><div><h2>Rota rules history</h2><p>Every save is kept. Compare a version with the current rules, or restore it.</p></div>
        <button type="button" data-close aria-label="Close history">×</button></header>
      <div class="mw-content rr-review">
        ${loadError ? nextStep({ tone: "danger", title: "History could not load", body: loadError, actionHtml: `<button type="button" class="icon-button btn-sm" data-history-retry>Try again</button>` }) : ""}
        ${stale ? nextStep({ tone: "warning", title: "Another admin changed the rules", body: "The rules changed after this page loaded them, so nothing was restored. Reload the latest rules, then restore again.", actionHtml: `<button type="button" class="primary btn-sm" data-history-reload>Reload rules</button>` }) : ""}
        ${list}
        <div class="admin-preview__actions rr-review__actions">
          <button type="button" class="icon-button" data-close>Close</button>
          <p role="status" aria-live="polite" class="admin-preview__message">${esc(message)}</p>
        </div>
      </div>`;
  };
  const load = async () => {
    versions = null;
    loadError = "";
    render();
    try {
      versions = await getRotaRuleVersions();
      message = versions.length ? `${plural(versions.length, "saved version")}.` : "";
    } catch (error) {
      loadError = error instanceof Error ? error.message : "Could not load the history";
    }
    render();
  };
  const refocus = (selector: string) => dialog.querySelector<HTMLElement>(selector)?.focus();
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    if (!busy) closeDialog(dialog);
  });
  dialog.addEventListener("click", async (event) => {
    const target = event.target as HTMLElement;
    if (target.closest("[data-close]")) { if (!busy) closeDialog(dialog); return; }
    if (target.closest("[data-history-retry]")) { await load(); return; }
    const compare = target.closest<HTMLElement>("[data-compare]");
    if (compare) {
      const id = compare.dataset.compare ?? "";
      if (openDiffs.has(id)) openDiffs.delete(id);
      else openDiffs.add(id);
      render();
      refocus(`[data-compare="${sel(id)}"]`);
      if (openDiffs.has(id) && !diffs.has(id)) {
        try {
          const version = await getRotaRuleVersion(id);
          diffs.set(id, versionDiffHtml(st, version.rules));
        } catch (error) {
          diffs.set(id, `<p class="rr-field-error">${esc(error instanceof Error ? error.message : "Could not load this version")}</p>`);
        }
        render();
        refocus(`[data-compare="${sel(id)}"]`);
      }
      return;
    }
    const restore = target.closest<HTMLElement>("[data-restore]");
    if (restore) {
      confirming = restore.dataset.restore ?? null;
      render();
      refocus("[data-restore-confirm]");
      return;
    }
    if (target.closest("[data-restore-cancel]")) {
      const id = confirming;
      confirming = null;
      render();
      if (id) refocus(`[data-restore="${sel(id)}"]`);
      return;
    }
    const confirm = target.closest<HTMLElement>("[data-restore-confirm]");
    if (confirm && !busy) {
      const id = confirm.dataset.restoreConfirm ?? "";
      const version = versions?.find((v) => v.version_id === id);
      busy = true;
      stale = false;
      message = "Restoring…";
      render();
      try {
        const result = await restoreRotaRuleVersion(id, st.revision);
        const rules = result && Array.isArray(result.duty_rules) ? result : await getRotaPhaseOneRules();
        busy = false;
        closeDialog(dialog);
        if (alive(st)) applySaved(st, rules, `Restored the rules saved ${version ? formatWhen(version.saved_at) : ""}. They are now the current rules (saved as a new version).`);
      } catch (error) {
        busy = false;
        confirming = null;
        const status = (error as { status?: number }).status;
        if (isStaleRulesError(error)) { stale = true; message = ""; }
        else if (status === 404) message = "That version no longer exists. The list has been refreshed.";
        else message = error instanceof Error ? error.message : "Could not restore this version";
        if (status === 404) await load();
        else render();
        refocus(stale ? "[data-history-reload]" : "[data-close]");
      }
      return;
    }
    if (target.closest("[data-history-reload]")) {
      const n = changeCount(st);
      if (n && !window.confirm(`Reloading discards your ${plural(n, "unsaved change")}. Continue?`)) return;
      try {
        const latest = await getRotaPhaseOneRules();
        applySaved(st, latest, "Loaded the latest rules.");
        stale = false;
        diffs.clear();
        await load();
      } catch (error) {
        message = error instanceof Error ? error.message : "Could not load the latest rules";
        render();
      }
    }
  });
  await load();
}

// ---------------------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------------------

function pageHtml(st: State): string {
  return `
    <section class="rr-hero panel" aria-labelledby="rr-title">
      <div class="rr-hero__top">
        <div class="rr-hero__text">
          <h3 id="rr-title">Who can do each duty</h3>
          <p>Choose the call levels and eligibility groups for each duty, and how the duty behaves in templates. Suggestions, manual assignment checks and Strict Auto-Fill all follow these rules.</p>
        </div>
        <div class="rr-hero__actions">
          <button type="button" class="icon-button" data-act="groups">Manage eligibility groups</button>
          <button type="button" class="icon-button" data-act="history">History</button>
        </div>
      </div>
      <ol class="rr-how" aria-label="How a member qualifies for a duty">
        <li><span class="rr-how__n" aria-hidden="true">1</span><div><strong>Call level</strong><span>Their call level is one the duty allows. Chosen groups add their own level.</span></div></li>
        <li><span class="rr-how__n" aria-hidden="true">2</span><div><strong>Groups allowed</strong><span>If the duty has groups, they belong to at least one of them.</span></div></li>
        <li><span class="rr-how__n" aria-hidden="true">3</span><div><strong>Groups excluded</strong><span>They are not in any excluded group.</span></div></li>
      </ol>
      <div class="rr-tiles" data-part="tiles"></div>
    </section>
    <div data-part="notices" class="rr-notices"></div>
    <section class="rr-toolbar panel" aria-label="Find duties">
      <div class="rr-search" data-part="search">
        ${SEARCH_ICON}
        <label class="visually-hidden" for="rr-search">Search duties</label>
        <input type="search" id="rr-search" placeholder="Search duties by name" value="${esc(st.query)}" data-search data-fk="search" autocomplete="off" />
      </div>
      <div class="rr-filters" role="group" aria-label="Show">
        ${FILTERS.map((f) => `<button type="button" class="rr-filter" data-filter-chip="${f.key}" data-filter="${f.key}" aria-pressed="${st.filter === f.key}" data-fk="filter:${f.key}">${esc(f.label)} <span class="rr-filter__count">0</span></button>`).join("")}
      </div>
      <div class="rr-toolbar__end">
        <span class="rr-muted" data-part="showing" aria-live="polite"></span>
        <button type="button" class="quiet-button btn-sm" data-expand-all>Expand all</button>
        <button type="button" class="quiet-button btn-sm" data-collapse-all>Collapse all</button>
      </div>
    </section>
    <div class="rr-list" data-part="list"></div>
    <section class="rr-guard panel" data-part="guard" aria-label="Safety guardrails"></section>
    <div class="rr-dock">
      <div class="rr-status" data-part="status" role="status" aria-live="polite"></div>
      <div data-part="savebar"></div>
    </div>`;
}

function bindPage(st: State): void {
  const page = st.page;
  page.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    const el = <T extends HTMLElement = HTMLElement>(selector: string) => target.closest<T>(selector);
    const help = el("[data-help]");
    if (help) {
      const id = help.dataset.help ?? "";
      const region = page.querySelector<HTMLElement>(`#${sel(id)}`);
      const open = help.getAttribute("aria-expanded") !== "true";
      help.setAttribute("aria-expanded", String(open));
      if (region) region.hidden = !open;
      if (open) st.openHints.add(id);
      else st.openHints.delete(id);
      return;
    }
    const act = el("[data-act]");
    if (act?.dataset.act === "groups") { st.opts.onNavigate("call-clusters"); return; }
    if (act?.dataset.act === "history") { void openHistory(st); return; }
    const chipEl = el("[data-chip]");
    if (chipEl) { toggleChip(st, chipEl); return; }
    const flag = el("[data-flag]");
    if (flag) { toggleFlag(st, flag); return; }
    const guardSwitch = el("[data-guard-switch]");
    if (guardSwitch) {
      const path = guardSwitch.dataset.guardSwitch ?? "";
      setPath(st.draft, path, !getPath(st.draft, path));
      edited(st, null, "guard");
      return;
    }
    const toggle = el("[data-toggle-duty]");
    if (toggle) { toggleDuty(st, toggle.dataset.toggleDuty ?? ""); return; }
    const head = el("[data-head]");
    if (head && !el("button, a, input, select")) {
      toggleDuty(st, head.dataset.head ?? "");
      page.querySelector<HTMLElement>(`[data-fk="${sel(`toggle:${head.dataset.head}`)}"]`)?.focus({ preventScroll: true });
      return;
    }
    const cat = el("[data-toggle-cat]");
    if (cat) {
      const key = cat.dataset.toggleCat ?? "";
      if (st.collapsed.has(key)) st.collapsed.delete(key);
      else st.collapsed.add(key);
      paintList(st);
      return;
    }
    if (el("[data-guard-toggle]")) { st.guardOpen = !st.guardOpen; paintGuard(st); return; }
    const filter = el("[data-filter]");
    if (filter) {
      const next = filter.dataset.filter as Filter;
      st.filter = st.filter === next && next !== "all" ? "all" : next;
      paintList(st);
      paintSummary(st);
      return;
    }
    if (el("[data-clear-filters]")) {
      st.filter = "all";
      st.query = "";
      const search = page.querySelector<HTMLInputElement>("[data-search]");
      if (search) search.value = "";
      paintList(st);
      paintSummary(st);
      search?.focus();
      return;
    }
    if (el("[data-expand-all]")) {
      st.draft.duty_rules.filter((rule) => matchesFilter(st, rule)).forEach((rule) => st.expanded.add(rule.key));
      st.collapsed.clear();
      paintList(st);
      return;
    }
    if (el("[data-collapse-all]")) { st.expanded.clear(); paintList(st); return; }
    const reset = el("[data-reset-duty]");
    if (reset) { resetDuty(st, reset.dataset.resetDuty ?? ""); return; }
    const missing = el("[data-remove-missing]");
    if (missing) { removeMissing(st, missing.dataset.removeMissing ?? "*"); return; }
    if (el("[data-retry-check]")) { setStatus(st, "Checking eligibility again…", "info"); void runCheck(st).then((r) => setStatus(st, r ? "Eligibility checked." : "Still couldn't check eligibility. Your edits are kept.", r ? "success" : "warning")); return; }
    if (el("[data-discard]")) { discardAll(st); return; }
    if (el("[data-review]")) { void openReview(st); return; }
    if (el("[data-status-dismiss]")) { setStatus(st, ""); page.querySelector<HTMLElement>("[data-search]")?.focus(); }
  });
  page.addEventListener("input", (event) => {
    const target = event.target as HTMLInputElement;
    if (target.matches("[data-search]")) {
      st.query = target.value;
      paintList(st);
      return;
    }
    if (target.matches("[data-text-field]")) {
      const rule = draftRule(st, target.dataset.duty ?? "");
      if (!rule) return;
      rule.label = target.value;
      edited(st, rule.key, "head");
      return;
    }
    if (target.matches("[data-num-field]")) {
      const rule = draftRule(st, target.dataset.duty ?? "");
      if (!rule) return;
      const value = target.value.trim() === "" ? NaN : Number(target.value);
      const bad = !Number.isFinite(value) || value < 0 || value > 48;
      target.setAttribute("aria-invalid", String(bad));
      const err = st.page.querySelector<HTMLElement>(`#${sel(`rr-${domId(rule.key)}-hours-err`)}`);
      if (err) err.textContent = bad ? "Enter hours from 0 to 48." : "";
      if (!Number.isFinite(value)) return;
      rule.duration_hours = value;
      edited(st, rule.key, "head");
      return;
    }
    if (target.matches("[data-guard-num]")) {
      const path = target.dataset.guardNum ?? "";
      const field = GUARD_FIELDS.find((f) => f.path === path);
      if (!field) return;
      const raw = target.value.trim();
      const value = raw === "" ? (field.nullable ? null : NaN) : Number(raw);
      const bad = value === null ? false : !Number.isFinite(value) || value < field.min || value > field.max;
      target.setAttribute("aria-invalid", String(bad));
      const err = target.closest(".rr-field")?.querySelector(".rr-field-error");
      if (err) err.textContent = bad ? `Enter a number from ${field.min} to ${field.max}${field.nullable ? ", or leave it empty" : ""}.` : "";
      if (value !== null && !Number.isFinite(value)) return;
      setPath(st.draft, path, value);
      edited(st, null, "none");
    }
  });
  page.addEventListener("change", (event) => {
    const target = event.target as HTMLSelectElement;
    if (target.matches("[data-select-field]")) {
      const rule = draftRule(st, target.dataset.duty ?? "");
      if (!rule) return;
      rule.group = target.value;
      st.collapsed.delete(rule.group);
      setStatus(st, `${rule.label} moved to ${categoryLabel(rule.group, true)}.`, "info");
      edited(st, null, "list");
      page.querySelector<HTMLElement>(`[data-fk="${sel(`group:${rule.key}`)}"]`)?.focus();
    } else if (target.matches("[data-guard-num]")) {
      paintGuard(st);
    }
  });
}

/**
 * Renders the Rota Rules page into `root`. Safe to call again (retry, revisit): the previous
 * page state is dropped.
 */
export async function renderRotaRulesPage(root: HTMLElement, opts: RotaRulesPageOptions): Promise<void> {
  if (state) window.clearTimeout(state.checkTimer);
  state = null;
  const current = () => opts.isCurrent?.() ?? true;
  root.innerHTML = pageSkeleton("rota rules");
  let rules: RotaPhaseOneRules;
  let groups: RotaRuleGroup[] = [];
  try {
    rules = normalizeRules(await getRotaPhaseOneRules());
    if (rules.groups) groups = rules.groups;
    else {
      try {
        groups = (await getCallClusters()).map((c) => ({ key: c.key, name: c.name, call_level: c.call_level, active: c.active, members: c.member_count ?? 0 }));
      } catch { groups = []; }
    }
  } catch (error) {
    if (!current()) return;
    root.innerHTML = emptyState({
      title: "Rota rules could not load",
      body: `${error instanceof Error ? error.message : "Unable to load the rules."} Nothing has changed.`,
      tone: "danger",
      actionHtml: `<button type="button" class="primary" data-rr-retry>Try again</button>`,
    });
    root.querySelector<HTMLButtonElement>("[data-rr-retry]")?.addEventListener("click", () => void renderRotaRulesPage(root, opts), { once: true });
    return;
  }
  if (!current()) return;
  const page = document.createElement("div");
  page.className = "rr-page";
  const st: State = {
    root, page, opts,
    saved: clone(rules), draft: clone(rules), revision: rules.revision ?? null, groups,
    check: null, checkState: "idle", checkFresh: false, checkSeq: 0, checkTimer: undefined,
    query: "", filter: "all", expanded: new Set(), collapsed: new Set(), openHints: new Set(), guardOpen: false, status: null,
  };
  state = st;
  page.innerHTML = pageHtml(st);
  root.replaceChildren(page);
  bindPage(st);
  paintList(st);
  paintGuard(st);
  paintSummary(st);
  if (!unloadBound) {
    unloadBound = true;
    window.addEventListener("beforeunload", (event) => {
      if (!rotaRulesHasUnsavedChanges()) return;
      event.preventDefault();
      event.returnValue = "";
    });
  }
  await runCheck(st);
}
