/**
 * Shared presentation helpers: readable labels for stored codes, date formatting, and small
 * HTML building blocks (badges, empty states, loading placeholders) used by every section.
 * Output is always escaped; callers pass plain text.
 */

export function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// Short forms that stay upper case when a code is turned into words.
const ACRONYMS = new Set([
  "PG", "SR", "AP", "DM", "PDF", "ICU", "SICU", "NICU", "DRP", "OT", "PAC", "CART", "RC", "CB", "CHAD",
  "RUHSA", "PB", "HOD", "CMC", "ID", "CSV", "UUID", "PMR", "ENT", "OG", "OBG", "MICU", "CTVS", "GI",
]);
const ROMAN = /^(?=[IVXL]+$)L?X{0,3}(IX|IV|V?I{0,3})$/;
const ORDINAL = /^(\d+)(ST|ND|RD|TH)$/;

// Exact wording for codes people see every day.
const KNOWN: Record<string, string> = {
  CO_1ST_CALL: "Co-1st call",
  CO_4TH_CALL: "Co-4th call",
  NEURO_ICU: "Neuro ICU",
  OTHER_SPECIAL: "Other special",
  FULL_DAY: "Full day",
  FIRST_HALF: "First half",
  SECOND_HALF: "Second half",
  DEPT_OF_CARDIAC_ANAESTHESIA: "Dept of Cardiac Anaesthesia",
  DEPT_OF_NEUROANAESTHESIA: "Dept of Neuroanaesthesia",
};

/** Turns a stored code such as `2ND_CALL`, `UNIT_IV` or `CASUAL_LEAVE` into words. */
export function codeLabel(code: string | null | undefined, fallback = "—"): string {
  const raw = String(code ?? "").trim();
  if (!raw) return fallback;
  if (KNOWN[raw]) return KNOWN[raw];
  if (!/^[A-Z0-9]+(?:_[A-Z0-9]+)*$/.test(raw)) return raw;
  const words = raw.split("_").map((part, index) => {
    const ordinal = part.match(ORDINAL);
    if (ordinal) return `${ordinal[1]}${ordinal[2].toLowerCase()}`;
    if (ACRONYMS.has(part)) return part;
    if (index > 0 && ROMAN.test(part)) return part;
    if (/^\d+$/.test(part)) return part;
    const lower = part.toLowerCase();
    return index === 0 ? lower.charAt(0).toUpperCase() + lower.slice(1) : lower;
  });
  // "Unit iv" reads oddly; units and departments are proper names.
  if (/^(UNIT|DEPT|WARD)_/.test(raw)) return words.map((w) => (/^[a-z]/.test(w) && w !== "of" ? w[0].toUpperCase() + w.slice(1) : w)).join(" ");
  return words.join(" ");
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})/;

function toDate(value: string | Date): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const match = String(value).match(DATE_RE);
  if (!match) return null;
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

const DAY_FORMAT = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const SHORT_FORMAT = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const MONTH_FORMAT = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });

/** `2026-10-19` -> `Mon 19 Oct 2026`; pass `weekday: false` for `19 Oct 2026`. */
export function formatDate(value: string | Date | null | undefined, options: { weekday?: boolean } = {}): string {
  if (!value) return "—";
  const date = toDate(value);
  if (!date) return String(value);
  return (options.weekday === false ? SHORT_FORMAT : DAY_FORMAT).format(date).replace(",", "");
}

/** `2026-10` -> `October 2026`. */
export function formatMonth(month: string | null | undefined): string {
  const match = String(month ?? "").match(/^(\d{4})-(\d{2})/);
  if (!match) return String(month ?? "");
  return MONTH_FORMAT.format(new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1)));
}

/** A date range in one phrase, collapsing a single day. */
export function formatDateRange(start: string | null | undefined, end: string | null | undefined): string {
  if (!start) return "—";
  if (!end || end === start) return formatDate(start, { weekday: false });
  return `${formatDate(start, { weekday: false })} – ${formatDate(end, { weekday: false })}`;
}

export type Tone = "neutral" | "success" | "warning" | "danger" | "info";

export function badge(text: string, tone: Tone = "neutral"): string {
  return `<span class="ds-badge ds-badge--${tone}">${esc(text)}</span>`;
}

export function emptyState(options: { title: string; body?: string; actionHtml?: string; tone?: Tone }): string {
  return `<div class="ds-empty${options.tone ? ` ds-empty--${options.tone}` : ""}" role="status">
    <p class="ds-empty__title">${esc(options.title)}</p>
    ${options.body ? `<p class="ds-empty__body">${esc(options.body)}</p>` : ""}
    ${options.actionHtml ? `<div class="ds-empty__action">${options.actionHtml}</div>` : ""}
  </div>`;
}

/** Placeholder shaped like a typical section: a header card, four tiles and a table. */
export function pageSkeleton(label: string): string {
  const line = (width: string) => `<span class="skeleton ds-skel-line" style="width:${width}"></span>`;
  return `<div class="ds-page-skeleton" aria-busy="true" aria-live="polite">
    <span class="visually-hidden">Loading ${esc(label)}…</span>
    <section class="panel ds-skel-card" aria-hidden="true">${line("32%")}${line("58%")}</section>
    <div class="summary-grid four-col" aria-hidden="true">
      ${Array.from({ length: 4 }, () => `<article class="metric ds-skel-card">${line("40%")}${line("70%")}</article>`).join("")}
    </div>
    <section class="panel ds-skel-card" aria-hidden="true">
      ${Array.from({ length: 6 }, (_, i) => line(i % 2 ? "88%" : "94%")).join("")}
    </section>
  </div>`;
}

/** Callout shown at the top of a section when something blocks the next workflow step. */
export function nextStep(options: { tone: Tone; title: string; body?: string; actionHtml?: string }): string {
  return `<section class="ds-next ds-next--${options.tone}" role="${options.tone === "danger" ? "alert" : "status"}">
    <div>
      <p class="ds-next__title">${esc(options.title)}</p>
      ${options.body ? `<p class="ds-next__body">${esc(options.body)}</p>` : ""}
    </div>
    ${options.actionHtml ? `<div class="ds-next__action">${options.actionHtml}</div>` : ""}
  </section>`;
}

/** Progress through a multi-step flow such as an import: earlier steps done, one current. */
export function steps(labels: string[], current: number): string {
  return `<ol class="ds-steps" aria-label="Progress">${labels
    .map((label, index) => {
      const state = index < current ? "done" : index === current ? "current" : "upcoming";
      return `<li class="ds-steps__item" data-state="${state}"${state === "current" ? ' aria-current="step"' : ""}>
        <span class="ds-steps__dot" aria-hidden="true">${state === "done" ? "✓" : index + 1}</span>
        <span>${esc(label)}</span>${state === "done" ? '<span class="visually-hidden"> (done)</span>' : ""}
      </li>`;
    })
    .join("")}</ol>`;
}

/** Counts for an import review: what is new, what changes, what needs a decision. */
export function importSummary(counts: { label: string; count: number; tone?: Tone }[]): string {
  return `<div class="ds-import-summary" role="status">${counts
    .filter((item) => item.count > 0 || item.tone === "warning" || item.tone === "danger")
    .map((item) => `<span class="ds-import-summary__item${item.tone ? ` is-${item.tone}` : ""}"><strong>${item.count}</strong> ${esc(item.label)}</span>`)
    .join("")}</div>`;
}

/** One proposed member for an import row, as the server's resolver describes it. */
export interface MemberMatchCandidate {
  id?: string;
  person_id?: string;
  name: string;
  status?: string;
  call_level?: string | null;
  designation?: string | null;
  units?: string[];
  reason?: string;
  score?: number;
}

export interface MemberMatchView {
  raw: string;
  /** matched | needs_review | not_found | ambiguous | conflict | inactive */
  status: string;
  name?: string | null;
  method?: string | null;
  reason?: string;
  warnings?: string[];
  candidates?: MemberMatchCandidate[];
}

const MATCH_METHOD: Record<string, string> = {
  member_id: "chosen by you",
  canonical_exact: "exact name",
  approved_alias: "approved alias",
  approved_rule: "approved name form",
  context_rule: "name rule for this call level",
  context: "only member with this name on this call level",
  manual_override: "chosen by you",
  normalized_exact: "exact name",
};

/** Human label for how a member was matched. */
export function matchMethodText(method?: string | null): string {
  return method ? MATCH_METHOD[method] ?? codeLabel(method.toUpperCase()) : "";
}

function candidateLine(c: MemberMatchCandidate): string {
  return [codeLabel((c.call_level ?? "").toUpperCase()), c.designation, ...(c.units ?? []),
          c.status && c.status !== "active" ? c.status : ""].filter(Boolean).join(" · ");
}

/**
 * The member part of an import review row: written name → proposed member, how it was
 * matched, and one-click alternatives. Choosing an alternative is a button with
 * `data-pick-member="<id>"` and `data-pick-row="<rowKey>"`; callers handle the click.
 */
export function memberMatch(rowKey: string, view: MemberMatchView): string {
  const matched = view.status === "matched" && view.name;
  const tone: Tone = matched ? "success" : view.status === "not_found" ? "neutral" : view.status === "conflict" ? "danger" : "warning";
  const label = matched ? "Matched" : view.status === "ambiguous" ? "Several members fit"
    : view.status === "inactive" ? "Member not active" : view.status === "not_found" ? "No such member" : "Needs your choice";
  const alternatives = (view.candidates ?? []).filter((c) => (c.id ?? c.person_id) && c.name !== view.name).slice(0, 5);
  return `<div class="member-match" data-match-status="${esc(view.status)}">
    <p class="member-match__line">
      <span class="member-match__raw">${esc(view.raw || "(blank)")}</span>
      <span aria-hidden="true">→</span>
      <strong class="member-match__name">${matched ? esc(view.name) : "<em>not chosen</em>"}</strong>
      ${badge(label, tone)}
    </p>
    <p class="member-match__why">${esc(matched ? `Match: ${matchMethodText(view.method)}` : view.reason ?? "")}</p>
    ${(view.warnings ?? []).length ? `<p class="member-match__warn">${(view.warnings ?? []).map(esc).join(" · ")}</p>` : ""}
    ${alternatives.length ? `<div class="member-match__picks" role="group" aria-label="Choose the member for ${esc(view.raw)}">
      ${alternatives.map((c) => `<button type="button" class="member-pick" data-pick-row="${esc(rowKey)}" data-pick-member="${esc(c.id ?? c.person_id)}">
        <span>${matched ? "Use " : ""}${esc(c.name)}</span><small>${esc(candidateLine(c) || c.reason || "")}</small></button>`).join("")}
    </div>` : ""}
  </div>`;
}

/** Plain-language reason Apply is blocked, or "" when the reviewed rows can be applied. */
export function applyBlocker(rows: { key: string; issues: string[]; label: string }[], excluded: Set<string>): string {
  const included = rows.filter((r) => !excluded.has(r.key));
  if (!included.length) return "Include at least one row to apply.";
  const blocked = included.filter((r) => r.issues.length);
  if (!blocked.length) return "";
  const first = blocked[0];
  return `${blocked.length} ${blocked.length === 1 ? "row needs" : "rows need"} a decision before applying. First: ${first.label} — ${first.issues[0]}. Choose the member, fix the row, or untick Include.`;
}
