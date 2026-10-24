/**
 * Balance duties (docs/call_level_pool_and_balance_contract.md §2 and §3).
 *
 * - `balanceStageHtml` is the "Balance duties" button and its one-line status on the Rota
 *   Template stage list. The status line fills itself from GET /status after it is inserted.
 * - `openBalanceDuties` previews the plan (before → after per call level, the moves grouped by
 *   level, and every member's share), applies it after an explicit review, and can undo a run.
 *   Every write is guarded by the preview token and plan hash, like the extra-duty layer.
 * All endpoints are admin-only; callers show these only to admins.
 */
import {
  request, type BalanceApplyResult, type BalanceBatch, type BalanceLevel, type BalanceMember, type BalanceMove,
  type BalancePreview, type BalanceRange, type BalanceStatus,
} from "./services/api";
import { workspaceDialog } from "./member-workspace";
import { conflictsFromError, showProposalConflict, type ProposalConflict } from "./compute-conflict";
import { auditReportLinks, callLevelText, ruleLabel } from "./extra-duty";
import { formatDate, formatMonth } from "./ui";
import { formatAuditTimestamp } from "./audit-time";

const API = "/api/v1/balance-duties";
export const BALANCE_UNDO = (batchId: string) => `${API}/batches/${encodeURIComponent(batchId)}/undo`;
/** Batches recorded by Balance duties carry `summary.mode === "balance"`. */
export const isBalanceBatch = (b: { summary?: unknown } | null | undefined) =>
  (b?.summary as { mode?: string } | undefined)?.mode === "balance";

const esc = (value: unknown) => String(value ?? "").replace(/[&<>"']/g,
  c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const num = (value: unknown, fallback = 0) => { const n = Number(value); return Number.isFinite(n) ? n : fallback; };
type ApiError = Error & { status?: number; detail?: Record<string, unknown> | string | null };
const errorCode = (error: unknown) => {
  const detail = (error as ApiError)?.detail;
  return detail && typeof detail === "object" && typeof detail.code === "string" ? detail.code : "";
};
const errorMessage = (error: unknown, fallback = "That did not work.") =>
  error instanceof Error && error.message ? error.message : fallback;
const sentence = (text: string) => /[.!?]$/.test(text.trim()) ? text.trim() : `${text.trim()}.`;

/** Signal that aborts when the window closes or after `ms`. */
function lifetimeSignal(lifetime: AbortController, ms: number): AbortSignal {
  const controller = new AbortController();
  const stop = () => controller.abort();
  if (lifetime.signal.aborted) controller.abort();
  lifetime.signal.addEventListener("abort", stop, { once: true });
  const timer = setTimeout(stop, ms);
  controller.signal.addEventListener("abort", () => clearTimeout(timer), { once: true });
  return controller.signal;
}

/* ----------------------------------------------------------------------------------------- */
/* Text helpers                                                                               */
/* ----------------------------------------------------------------------------------------- */

const LEVEL_ORDER = ["1ST_CALL", "2ND_CALL", "3RD_CALL", "4TH_CALL", "CO_4TH_CALL", "5TH_CALL"];
const levelRank = (level: string) => { const i = LEVEL_ORDER.indexOf(String(level).toUpperCase()); return i < 0 ? 99 : i; };
const levelName = (level: { call_level: string; label?: string }) => level.label || callLevelText(level.call_level);
/** "6–7", or "6" when both ends match. */
function goalText(goal: BalanceLevel["goal_range"] | number | null | undefined): string {
  if (goal === null || goal === undefined || goal === "") return "";
  if (typeof goal === "string") return goal;
  if (typeof goal === "number") return String(goal);
  const [low, high] = [num(goal[0]), num(goal[1] ?? goal[0])];
  return low === high ? String(low) : `${low}–${high}`;
}
function goalBounds(goal: BalanceLevel["goal_range"] | null | undefined): [number, number] | null {
  if (Array.isArray(goal) && goal.length) return [num(goal[0]), num(goal[1] ?? goal[0])];
  const m = typeof goal === "string" ? goal.match(/(\d+)\D+(\d+)/) ?? goal.match(/(\d+)/) : null;
  return m ? [Number(m[1]), Number(m[2] ?? m[1])] : null;
}
const rangeText = (r: BalanceRange) => r.min === r.max ? plural(r.min, "duty", "duties") : `${r.min}–${r.max} duties`;

/* ----------------------------------------------------------------------------------------- */
/* Stage button and status line                                                               */
/* ----------------------------------------------------------------------------------------- */

const statusCache = new Map<string, { at: number; value: Promise<BalanceStatus> }>();
function loadStatus(month: string, signal?: AbortSignal): Promise<BalanceStatus> {
  const hit = statusCache.get(month);
  if (hit && Date.now() - hit.at < 4000) return hit.value;
  const value = request<BalanceStatus>(`${API}/status?month=${encodeURIComponent(month)}`, { signal: signal ?? AbortSignal.timeout(15000) });
  statusCache.set(month, { at: Date.now(), value });
  value.catch(() => statusCache.delete(month));
  return value;
}
/** Forget the cached status (after apply or undo, here or in the extra-duty window). */
export function invalidateBalanceStatus(month?: string) { if (month) statusCache.delete(month); else statusCache.clear(); }

/** Plain one-line status: "Duties are balanced" or "1st call: 5–9 duties (target 6–7)". */
export function balanceStatusText(status: BalanceStatus): { tone: "ok" | "uneven" | "off"; text: string } {
  if (!status.enabled) return { tone: "off", text: "Balance duties is turned off." };
  const uneven = (status.levels ?? [])
    .map(l => ({ l, min: num(l.min ?? l.before?.min), max: num(l.max ?? l.before?.max), gap: num(l.gap ?? l.before?.gap), ok: l.ok ?? l.ok_after }))
    .filter(x => x.ok === false)
    .sort((a, b) => b.gap - a.gap || levelRank(a.l.call_level) - levelRank(b.l.call_level));
  if (status.balanced || !uneven.length) return { tone: "ok", text: "Duties are balanced." };
  const first = uneven[0];
  const target = goalText(first.l.goal_range ?? (first.l as { target?: number }).target ?? null);
  const head = `${levelName(first.l)}: ${first.min === first.max ? first.min : `${first.min}–${first.max}`} duties${target ? ` (target ${target})` : ""}`;
  return { tone: "uneven", text: uneven.length > 1 ? `${head} · ${plural(uneven.length - 1, "more level")} uneven` : head };
}

/** Hint shown when extra duties were added after the last balance run (balance_extra_duties_contract §3). */
export const BALANCE_AGAIN_TEXT = "Run Balance duties again to even out the extra duties.";
type RunBatch = { status: string; created_at: string; summary?: unknown };
/** True when an extra-duty run (standard or all units) was applied after the last applied balance run. */
export function extraRunSinceBalance(balanceBatches: RunBatch[], extraBatches: RunBatch[]): boolean {
  const latest = (list: RunBatch[]) => list.filter(b => b.status === "applied").map(b => String(b.created_at || "")).sort().pop() ?? "";
  const extra = latest(extraBatches.filter(b => !isBalanceBatch(b) && (b.summary as { mode?: string } | undefined)?.mode !== "superadmin_allocation"));
  const balance = latest([...balanceBatches, ...extraBatches.filter(isBalanceBatch)]);
  return Boolean(extra) && (!balance || Date.parse(extra) > Date.parse(balance));
}
function loadExtraRuns(month: string): Promise<RunBatch[]> {
  return request<{ batches?: RunBatch[] }>(`/api/v1/extra-duty/status?month=${encodeURIComponent(month)}`, { signal: AbortSignal.timeout(15000) })
    .then(s => Array.isArray(s?.batches) ? s.batches : [], () => []);
}

let hydrateQueued = false;
/** Fill every status line on the page that is still waiting. */
function hydrateStatusLines() {
  hydrateQueued = false;
  document.querySelectorAll<HTMLElement>("[data-balance-status]:not([data-balance-loaded])").forEach(line => {
    line.dataset.balanceLoaded = "1";
    const month = line.dataset.balanceMonth || "";
    const button = line.closest(".balance-stage")?.querySelector<HTMLButtonElement>("[data-balance-duties]");
    loadStatus(month).then(status => {
      if (!line.isConnected) return;
      const { tone, text } = balanceStatusText(status);
      line.dataset.tone = tone;
      line.textContent = text;
      if (!status.enabled && button) { button.disabled = true; button.title = "Balance duties is turned off for this deployment."; }
      if (tone === "uneven") void loadExtraRuns(month).then(runs => {
        if (!line.isConnected || line.dataset.tone !== "uneven" || !extraRunSinceBalance(status.batches ?? [], runs)) return;
        line.dataset.balanceAgain = "1";
        line.textContent = `${BALANCE_AGAIN_TEXT} ${text}`;
      });
    }).catch(() => {
      if (!line.isConnected) return;
      line.dataset.tone = "unknown";
      line.textContent = "Balance not checked yet. Open Balance duties to see it.";
    });
  });
}

/**
 * The "Balance duties" button and its status line, for the Rota Template stage list.
 * Disabled when the month is not a draft, units are not locked, or nobody has a duty yet.
 */
export function balanceStageHtml(month: string, options: { draft: boolean; locked: boolean; assigned: number }): string {
  const disabled = !options.draft || !options.locked || !options.assigned;
  const why = !options.draft ? "This month is published." : !options.locked ? "Lock the month's units first."
    : !options.assigned ? "Autoassign members first; there is nothing to balance yet." : "";
  if (!disabled && !hydrateQueued) { hydrateQueued = true; setTimeout(hydrateStatusLines, 0); }
  return `<span class="balance-stage__actions">
    <button type="button" class="balance-button" data-balance-duties ${disabled ? "disabled" : ""} aria-describedby="balance-stage-status-${esc(month)}">Balance duties</button>
    <span class="balance-stage__status" id="balance-stage-status-${esc(month)}" ${disabled ? 'data-tone="off"' : `data-balance-status data-balance-month="${esc(month)}"`} role="status">${esc(disabled ? why : "Checking the balance…")}</span></span>`;
}

/* ----------------------------------------------------------------------------------------- */
/* Window                                                                                     */
/* ----------------------------------------------------------------------------------------- */

interface UndoConflict { slot_id?: string; reason?: string; message?: string; duty_date?: string; person_name?: string; duty_label?: string }
interface UndoResult { batch_id: string; restored: number; conflicts: UndoConflict[] }
type Notice = { tone: "error" | "success" | "info"; title?: string; text: string; next?: "preview" | "retry" | ""; list?: string[] };

const NEVER_BROKEN: [string, string][] = [
  ["Leave", "Nobody on leave is given a duty."],
  ["Rest", "Rest before and after every duty, and no two duties at once."],
  ["Call level", "Only the duty's own call level, or its pool (for example 3rd + 4th call)."],
  ["Groups", "Allowed and excluded groups are followed exactly."],
  ["Unit rules", "A duty never goes to a unit its rules leave out, or one that would be left short."],
  ["Limits", "Nobody goes past an individual duty limit."],
];

function aboutHtml(folded = false): string {
  const box = `<section class="balance-about" aria-labelledby="balance-about-title">
    <div class="balance-about__lead"><h3 id="balance-about-title">What this does</h3>
      <p>Moves duties from members with the most to members with the fewest <strong>in the same call level</strong>, until everyone is within the allowed gap of their fair share. A duty may move to another unit when that is the only fair way.</p>
      <p class="balance-about__share"><strong>Fair share:</strong> members on leave or posted for only part of the month get a smaller share, in proportion to the days they are available.</p>
      <p class="balance-about__extra" data-balance-about-extra>Extra duties can be passed on too; the justice-ledger credit moves with the duty.</p></div>
    <div class="balance-about__never"><h4>Never broken</h4>
      <ul>${NEVER_BROKEN.map(([title, text]) => `<li><strong>${esc(title)}</strong><span>${esc(text)}</span></li>`).join("")}</ul></div>
  </section>`;
  // Once there is an outcome to read, the explanation folds away under the outcome.
  return folded ? `<details class="balance-about-fold"><summary>What Balance duties does and never breaks</summary>${box}</details>` : box;
}

/** Before → after strip for one call level, with a shared scale and the goal band. */
function levelCard(level: BalanceLevel, done: boolean): string {
  const goal = goalBounds(level.goal_range);
  const lo = Math.max(0, Math.min(level.before.min, level.after.min, goal?.[0] ?? Infinity) - 1);
  const hi = Math.max(level.before.max, level.after.max, goal?.[1] ?? 0) + 1;
  const span = Math.max(1, hi - lo);
  const pos = (v: number) => `${((v - lo) / span * 100).toFixed(2)}%`;
  const width = (a: number, b: number) => `max(10px, ${((b - a) / span * 100).toFixed(2)}%)`;
  const band = goal ? `<span class="balance-bar__goal" style="left:${pos(goal[0])};width:${width(goal[0], goal[1])}"></span>` : "";
  const beforeOk = level.allowed_gap === undefined ? null : level.before.gap <= level.allowed_gap;
  const row = (label: string, r: BalanceRange, tone: string) => `<div class="balance-bar">
      <span class="balance-bar__label">${esc(label)}</span>
      <span class="balance-bar__track" aria-hidden="true">${band}<span class="balance-bar__range is-${tone}" style="left:${pos(r.min)};width:${width(r.min, r.max)}"></span></span>
      <span class="balance-bar__value"><strong>${esc(r.min === r.max ? String(r.min) : `${r.min}–${r.max}`)}</strong> <span>gap ${esc(r.gap)}</span></span></div>`;
  const ok = level.ok_after;
  return `<li class="balance-level${ok ? " is-ok" : " is-uneven"}" data-balance-level="${esc(level.call_level)}">
    <div class="balance-level__head"><h4>${esc(levelName(level))}</h4>
      <span class="balance-badge balance-badge--${ok ? "ok" : "warn"}">${ok ? (done ? "Balanced" : "Balanced after") : "Still uneven"}</span></div>
    <p class="balance-level__goal">Fair share <strong>${esc(goalText(level.goal_range) || "—")}</strong> duties each${level.allowed_gap !== undefined ? ` · allowed gap ${esc(level.allowed_gap)}` : ""}</p>
    ${row("Before", level.before, beforeOk === false ? "warn" : "muted")}
    ${row(done ? "Now" : "After", level.after, ok ? "ok" : "warn")}
    <p class="visually-hidden">${esc(`${levelName(level)}: before ${rangeText(level.before)}, gap ${level.before.gap}; ${done ? "now" : "after"} ${rangeText(level.after)}, gap ${level.after.gap}. Fair share ${goalText(level.goal_range) || "not given"}.`)}</p>
    ${!ok && level.reason_if_not ? `<p class="balance-level__reason"><span>Why:</span> ${esc(level.reason_if_not)}</p>` : ""}</li>`;
}

function moveItem(move: BalanceMove): string {
  const swap = move.kind === "swap";
  const date = move.duty_date ? formatDate(move.duty_date) : "Date not given";
  const swapBack = swap && move.swap_duty_label
    ? `<span class="balance-move__back">In return: ${esc([move.swap_duty_date ? formatDate(move.swap_duty_date) : "", move.swap_duty_label].filter(Boolean).join(" · "))} goes from ${esc(move.to_person)} to ${esc(move.from_person)}</span>` : "";
  // An extra-duty-layer duty carries its justice-ledger record with it (balance_extra_duties_contract §3).
  const extra = move.extra_duty === true;
  const codes = (move.new_overridden_rules ?? []).filter(Boolean);
  const ledger = extra ? `<p class="balance-move__ledger" data-balance-ledger>Ledger credit moves to <strong>${esc(move.ledger_to || move.to_person)}</strong>${move.ledger_from && move.ledger_from !== move.from_person ? ` (from ${esc(move.ledger_from)})` : ""}${codes.length
    ? `<span class="balance-move__codes">Recorded as: ${esc(codes.map(ruleLabel).join(" · "))}</span>` : ""}</p>` : "";
  return `<li class="balance-move${swap ? " is-swap" : ""}${extra ? " is-extra" : ""}" data-balance-move="${esc(move.slot_id)}"${extra ? " data-balance-extra" : ""}>
    <p class="balance-move__what"><span class="balance-move__duty">${esc(date)} · ${esc(move.duty_label || "Duty")}:</span>
      <span class="balance-move__people"><span>${esc(move.from_person)}</span><span class="balance-move__arrow" aria-hidden="true">${swap ? "⇄" : "→"}</span><span class="visually-hidden">${swap ? " swaps with " : " to "}</span><strong>${esc(move.to_person)}</strong></span></p>
    <p class="balance-move__tags">${extra ? '<span class="balance-badge balance-badge--extra">Extra duty</span>' : ""}${swap ? '<span class="balance-badge balance-badge--swap">Swap</span>' : ""}${move.cross_unit
      ? `<span class="balance-badge balance-badge--cross">Changes unit: ${esc(move.from_unit || "unit not named")} → ${esc(move.to_unit || "unit not named")}</span>`
      : move.to_unit ? `<span class="balance-move__unit">${esc(move.to_unit)}</span>` : ""}</p>
    ${swapBack}${ledger}
    ${move.reason ? `<p class="balance-move__reason">${esc(move.reason)}</p>` : ""}</li>`;
}

/** Moves grouped by call level, in level order. Long groups show 8 and fold the rest. */
function movesHtml(moves: BalanceMove[], members: BalanceMember[], levels: BalanceLevel[], done: boolean): string {
  if (!moves.length) return "";
  const levelOf = new Map(members.map(m => [m.name, m.call_level]));
  const groups = new Map<string, BalanceMove[]>();
  for (const move of moves) {
    const level = move.call_level || levelOf.get(move.from_person) || levelOf.get(move.to_person) || "";
    groups.set(level, [...(groups.get(level) ?? []), move]);
  }
  const labelOf = new Map(levels.map(l => [l.call_level, levelName(l)]));
  const ordered = [...groups].sort(([a], [b]) => levelRank(a) - levelRank(b) || a.localeCompare(b));
  const show = 8;
  return `<section class="balance-moves" aria-labelledby="balance-moves-title">
    <h3 id="balance-moves-title">${done ? "Duties moved" : "Duties that move"} <span class="fill-all-count">${moves.length}</span></h3>
    ${ordered.map(([level, list]) => {
      const name = labelOf.get(level) || (level ? callLevelText(level) : "Other duties");
      const swaps = list.filter(m => m.kind === "swap").length, cross = list.filter(m => m.cross_unit).length;
      const extras = list.filter(m => m.extra_duty === true).length;
      return `<div class="balance-moves__group" data-balance-group="${esc(level)}">
        <h4>${esc(name)} <span class="balance-moves__meta">${esc([plural(list.length - swaps, "move"), swaps ? plural(swaps, "swap") : "", cross ? `${cross} across units` : "", extras ? plural(extras, "extra duty", "extra duties") : ""].filter(Boolean).join(" · "))}</span></h4>
        <ul>${list.slice(0, show).map(moveItem).join("")}</ul>
        ${list.length > show ? `<details class="balance-more"><summary>Show ${list.length - show} more in ${esc(name)}</summary><ul>${list.slice(show).map(moveItem).join("")}</ul></details>` : ""}</div>`;
    }).join("")}</section>`;
}

function membersHtml(members: BalanceMember[], levels: BalanceLevel[], month: string, done: boolean): string {
  if (!members.length) return "";
  const days = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate() || 31;
  const labelOf = new Map(levels.map(l => [l.call_level, levelName(l)]));
  const sorted = [...members].sort((a, b) => levelRank(a.call_level) - levelRank(b.call_level) || a.call_level.localeCompare(b.call_level) || a.name.localeCompare(b.name));
  const changed = members.filter(m => m.before !== m.after).length;
  // Extra-duty-layer duties before → after; the column shows only when someone holds one.
  const withExtra = members.some(m => num(m.extra_before) > 0 || num(m.extra_after) > 0);
  const extraCell = (m: BalanceMember) => {
    if (!withExtra) return "";
    const b = num(m.extra_before), a = num(m.extra_after);
    return `<td data-label="Extra duties" class="is-num" data-balance-extra-cell><span>${b === a ? (b ? esc(b) : '<span class="hint">—</span><span class="visually-hidden">none</span>')
      : `${esc(b)} <span aria-hidden="true">→</span><span class="visually-hidden"> to </span> <strong>${esc(a)}</strong>`}</span></td>`;
  };
  const rows = sorted.map(m => {
    const delta = m.after - m.before;
    const off = Math.abs(m.after - m.goal);
    return `<tr data-balance-member="${esc(m.person_id)}"${delta ? ' class="is-changed"' : ""}>
      <th scope="row" data-label="Member">${esc(m.name)}</th>
      <td data-label="Call level">${esc(labelOf.get(m.call_level) || callLevelText(m.call_level))}</td>
      <td data-label="Unit">${m.unit ? esc(m.unit) : '<span class="hint">No posting</span>'}</td>
      <td data-label="Before" class="is-num">${esc(m.before)}</td>
      <td data-label="${done ? "Now" : "After"}" class="is-num"><span><strong>${esc(m.after)}</strong>${delta ? ` <span class="balance-delta ${delta > 0 ? "is-up" : "is-down"}">${delta > 0 ? "+" : "−"}${Math.abs(delta)}</span>` : ""}</span></td>
      ${extraCell(m)}<td data-label="Fair share" class="is-num"><span>${esc(m.goal)}${off > 1 ? ' <span class="balance-delta is-off">more than 1 away</span>' : ""}</span></td>
      <td data-label="Days available" class="is-num"><span>${esc(m.avail_days)}${m.avail_days < days ? ' <span class="balance-partial">part month</span>' : ""}</span></td></tr>`;
  }).join("");
  return `<details class="balance-members" data-balance-members>
    <summary><span>Every member's share</span> <span class="balance-moves__meta">${esc(plural(members.length, "member"))} · ${esc(`${changed} changed`)}</span></summary>
    <div class="table-scroll"><table class="balance-table">
      <caption>Duties per member, ${esc(formatMonth(month))}. Fair share is pro-rata to the days each member is available.</caption>
      <thead><tr><th scope="col">Member</th><th scope="col">Call level</th><th scope="col">Unit</th><th scope="col" class="is-num">Before</th>
        <th scope="col" class="is-num">${done ? "Now" : "After"}</th>${withExtra ? `<th scope="col" class="is-num">Extra duties ${done ? "before → now" : "before → after"}</th>` : ""}<th scope="col" class="is-num">Fair share</th><th scope="col" class="is-num">Days available</th></tr></thead>
      <tbody>${rows}</tbody></table></div></details>`;
}

/** Extra-duty-layer duties this plan passes on: the summary count, or the flagged moves when it is missing. */
const extraMoves = (preview: BalancePreview) =>
  num(preview.summary.extra_moves, preview.moves.filter(m => m.extra_duty === true).length);

function chipsHtml(preview: BalancePreview, done: boolean): string {
  const s = preview.summary;
  const total = preview.levels.length || Math.max(s.levels_balanced_after, s.levels_balanced_before);
  const chip = (value: string, label: string, tone: string) =>
    `<li class="extra-duty-chip extra-duty-chip--${tone}"><strong>${esc(value)}</strong><span>${esc(label)}</span></li>`;
  return `<ul class="extra-duty-chips balance-chips" aria-label="Summary">
    ${chip(String(s.moves), done ? "duties moved" : "duties move", "info")}
    ${chip(String(s.swaps), s.swaps === 1 ? "swap" : "swaps", "neutral")}
    ${chip(String(s.cross_unit), "change unit", s.cross_unit ? "warning" : "neutral")}
    ${extraMoves(preview) ? chip(String(extraMoves(preview)), extraMoves(preview) === 1 ? "extra duty passed on" : "extra duties passed on", "extra") : ""}
    ${chip(`${s.levels_balanced_before} → ${s.levels_balanced_after}`, `of ${total} levels balanced`, s.levels_balanced_after >= total ? "success" : "warning")}</ul>`;
}

function reportHtml(source: BalancePreview, month: string, done: boolean): string {
  const levels = [...source.levels].sort((a, b) => levelRank(a.call_level) - levelRank(b.call_level));
  return `${chipsHtml(source, done)}
    <section class="balance-levels-section" aria-labelledby="balance-levels-title">
      <h3 id="balance-levels-title">${done ? "Before and now" : "Before and after"}, per call level</h3>
      <ul class="balance-levels">${levels.map(l => levelCard(l, done)).join("")}</ul>
      <p class="balance-legend" aria-hidden="true"><span class="balance-legend__goal"></span>Fair-share band <span class="balance-legend__range"></span>Lowest to highest member</p></section>
    ${movesHtml(source.moves, source.members, levels, done)}
    ${membersHtml(source.members, levels, month, done)}`;
}

/** Plain-words "Already balanced" view, from the status endpoint's levels. */
function balancedLevelsHtml(status: BalanceStatus | null): string {
  const levels = (status?.levels ?? []).filter(l => l.min !== undefined || l.before);
  if (!levels.length) return "";
  return `<ul class="balance-levels balance-levels--plain">${[...levels].sort((a, b) => levelRank(a.call_level) - levelRank(b.call_level)).map(l => {
    const min = num(l.min ?? l.before?.min), max = num(l.max ?? l.before?.max), gap = num(l.gap ?? l.before?.gap);
    const ok = (l.ok ?? l.ok_after) !== false;
    return `<li class="balance-level ${ok ? "is-ok" : "is-uneven"}" data-balance-level="${esc(l.call_level)}"><div class="balance-level__head"><h4>${esc(levelName(l))}</h4>
      <span class="balance-badge balance-badge--${ok ? "ok" : "warn"}">${ok ? "Balanced" : "Uneven"}</span></div>
      <p class="balance-level__goal">${esc(min === max ? plural(min, "duty", "duties") : `${min}–${max} duties`)} · gap ${esc(gap)}${goalText(l.goal_range ?? null) ? ` · fair share ${esc(goalText(l.goal_range ?? null))}` : ""}</p></li>`;
  }).join("")}</ul>`;
}

export async function openBalanceDuties(month: string, onApplied: () => void): Promise<void> {
  const dialog = workspaceDialog("Balance duties", "compute-workspace extra-duty-workspace balance-workspace");
  const lifetime = new AbortController();
  let closed = false;
  let busy: "" | "load" | "apply" | "undo-check" | "undo" = "";
  let status: BalanceStatus | null = null;
  let preview: BalancePreview | null = null;
  let applied: BalanceApplyResult | null = null;
  let reviewed = false;
  let notice: Notice | null = null;
  let blocked = "";
  let undo: { batchId: string; phase: "confirm" | "conflict"; restored: number; conflicts: UndoConflict[] } | null = null;

  dialog.addEventListener("close", () => { closed = true; lifetime.abort(); dialog.remove(); });
  dialog.addEventListener("cancel", event => { if (busy === "apply" || busy === "undo") event.preventDefault(); });

  const post = <T>(path: string, body: object, ms = 60000) => request<T>(path.startsWith("/") ? path : `${API}/${path}`,
    { method: "POST", body: JSON.stringify(body), signal: lifetimeSignal(lifetime, ms) });

  function noticeHtml() {
    if (!notice) return "";
    return `<div class="extra-duty-notice extra-duty-notice--${notice.tone} balance-notice" ${notice.tone === "error" ? 'role="alert"' : 'role="status"'} tabindex="-1" data-balance-notice>
      ${notice.title ? `<p class="balance-notice__title"><strong>${esc(notice.title)}</strong></p>` : ""}<p>${esc(notice.text)}</p>
      ${notice.list?.length ? `<ul>${notice.list.map(i => `<li>${esc(i)}</li>`).join("")}</ul>` : ""}
      ${notice.next === "preview" ? `<button type="button" class="primary" data-balance-repreview ${busy ? "disabled" : ""}>Preview again</button>` : ""}
      ${notice.next === "retry" ? `<button type="button" data-balance-repreview ${busy ? "disabled" : ""}>Try again</button>` : ""}</div>`;
  }

  function batchesHtml() {
    const batches = (status?.batches ?? []) as BalanceBatch[];
    if (!batches.length) return "";
    return `<section class="extra-duty-batches balance-batches" aria-labelledby="balance-batches-title"><h3 id="balance-batches-title">Balance runs this month</h3>
      <ul>${batches.map(b => `<li data-balance-batch="${esc(b.id)}"><div><strong>${b.status === "applied" ? "Applied" : b.status === "undone" ? "Undone" : esc(b.status)}</strong>
        <span>${esc(formatAuditTimestamp(b.created_at))}${b.created_by_name ? ` · ${esc(b.created_by_name)}` : ""} · ${esc(plural(num(b.summary?.moves), "duty", "duties"))} moved${b.summary?.swaps ? ` · ${esc(plural(num(b.summary.swaps), "swap"))}` : ""}${b.summary?.extra_moves ? ` · ${esc(plural(num(b.summary.extra_moves), "extra duty", "extra duties"))} passed on` : ""}</span></div>
        ${b.status === "applied" ? `<button type="button" class="danger-button" data-balance-undo="${esc(b.id)}" ${busy ? "disabled" : ""}>Undo this run</button>` : ""}</li>`).join("")}</ul>
      ${batches.some(b => b.status === "applied") ? auditReportLinks(month) : ""}</section>`;
  }

  function undoHtml() {
    if (!undo) return "";
    const conflicts = undo.conflicts.map(c => [c.duty_date ? formatDate(c.duty_date) : "", c.duty_label || "", c.person_name || "", c.message || c.reason || ""]
      .filter(Boolean).join(" · ") || "A duty in this run was changed");
    return `<section class="extra-duty-undo panel" role="region" aria-labelledby="balance-undo-title" tabindex="-1" data-balance-undo-panel>
      <h3 id="balance-undo-title">${undo.phase === "conflict" ? "This run cannot be undone yet" : "Undo this balance run?"}</h3>
      ${undo.phase === "conflict"
        ? `<p>These duties were changed after balancing, so undoing could remove someone else's work:</p>
           <ul data-balance-undo-conflicts>${conflicts.map(c => `<li>${esc(c)}</li>`).join("")}</ul>
           <p class="hint">Next step: put those duties back as they were, or change them one by one in the day view. Nothing was changed.</p>
           <div class="button-row"><button type="button" data-balance-undo-keep>Close this message</button></div>`
        : `<p>This puts ${esc(plural(undo.restored, "duty", "duties"))} back with the person and unit they had before balancing. Other duties are not touched.</p>
           <div class="button-row"><button type="button" class="danger-button" data-balance-undo-confirm ${busy ? "disabled" : ""}>Yes, undo this run</button>
           <button type="button" data-balance-undo-keep ${busy ? "disabled" : ""}>Keep it</button></div>`}</section>`;
  }

  /** Outcome first (notice, undo question), then the report; the explanation leads only while previewing. */
  function content() {
    if (busy === "load") return `${aboutHtml()}<p role="status" class="extra-duty-loading balance-loading"><span class="balance-spinner" aria-hidden="true"></span>Working out a fair share for every member and the moves that get there…</p>`;
    const top = `${noticeHtml()}${undoHtml()}`;
    if (applied) return `${top}${batchesHtml()}${reportHtml(applied, month, true)}${aboutHtml(true)}`;
    if (blocked === "balanced") return `${top}${balancedLevelsHtml(status)}${batchesHtml()}${aboutHtml(true)}`;
    if (blocked || !preview) return `${top}${batchesHtml()}${aboutHtml(true)}`;
    return `${top}${aboutHtml()}${reportHtml(preview, month, false)}${batchesHtml()}`;
  }

  function footer() {
    if (applied || !preview || blocked) {
      return `<p class="extra-duty-status" role="status" aria-live="polite" data-balance-status-text>${busy === "undo" ? "Undoing…" : busy === "undo-check" ? "Checking the run…" : ""}</p>
        <button type="button" data-balance-close ${busy === "undo" ? "disabled" : ""}>Close</button>`;
    }
    const movable = preview.summary.moves + preview.summary.swaps > 0;
    return `<label class="extra-duty-review"><input type="checkbox" data-balance-reviewed ${reviewed ? "checked" : ""} ${!movable || busy ? "disabled" : ""}> I reviewed these moves</label>
      <p class="extra-duty-status" role="status" aria-live="polite" data-balance-status-text>${busy === "apply" ? "Applying… keep this window open."
        : !movable ? "No duty can move without breaking a rule." : reviewed ? "Ready to apply. Nothing is saved until you apply." : "Tick the review box to apply. Nothing is saved yet."}</p>
      <button type="button" data-balance-close ${busy === "apply" ? "disabled" : ""}>Cancel</button>
      <button type="button" class="primary" data-balance-apply ${!movable || !reviewed || busy ? "disabled" : ""} aria-busy="${busy === "apply"}">${busy === "apply" ? "Applying…" : "Apply balance"}</button>`;
  }

  function render(focus?: string) {
    if (closed) return;
    dialog.innerHTML = `<header class="mw-header"><div><h2>Balance duties</h2><p>${esc(formatMonth(month))} · Equal duties within each call level.${applied ? "" : " Nothing is saved until you apply."}</p></div>
      <button type="button" data-close aria-label="Close balance duties" ${busy === "apply" || busy === "undo" ? "disabled" : ""}>Close</button></header>
      <div class="mw-content extra-duty-content balance-content" tabindex="0" role="region" aria-label="Balance report">${content()}</div>
      <footer class="mw-footer extra-duty-footer balance-footer">${footer()}</footer>`;
    const target = focus ? dialog.querySelector<HTMLElement>(focus) : null;
    const start = dialog.querySelector<HTMLElement>("[data-balance-notice]") ?? dialog.querySelector<HTMLElement>(".mw-content");
    (target ?? start)?.focus({ preventScroll: true });
    if (!target) dialog.querySelector<HTMLElement>(".mw-content")?.scrollTo({ top: 0 });
    else target.scrollIntoView({ block: "nearest" });
    // The window itself never scrolls (only its content does); focusing can nudge it, so pin it.
    dialog.scrollTop = 0;
  }

  function showConflict(error: unknown) {
    const listed = conflictsFromError(error);
    const detail = (error as ApiError).detail as Record<string, unknown> | undefined;
    const summary = detail?.conflict_summary as ProposalConflict | undefined;
    const conflicts = listed?.length ? listed.map(c => ({ ...c, month: c.month || month })) : summary ? [{ ...summary, month: summary.month || month }] : [];
    showProposalConflict(dialog, { month, admin: true, stage: "balance", conflicts, onApplied,
      retry: () => void openBalanceDuties(month, onApplied),
      message: `${sentence(errorMessage(error))} Finish or cancel it, then balance the duties.` });
  }

  async function refreshStatus() {
    invalidateBalanceStatus(month);
    try { status = await loadStatus(month, lifetimeSignal(lifetime, 15000)); } catch { /* keep the last known list */ }
  }

  async function load() {
    busy = "load"; preview = null; applied = null; reviewed = false; notice = null; blocked = ""; undo = null;
    render();
    try {
      invalidateBalanceStatus(month);
      status = await loadStatus(month, lifetimeSignal(lifetime, 15000)).catch(() => null);
      if (closed) return;
      if (status && !status.enabled) {
        blocked = "disabled";
        notice = { tone: "info", title: "Balance duties is turned off", text: "It is switched off for this deployment. Ask the system administrator to enable it." };
        return;
      }
      if (status?.balanced) {
        blocked = "balanced";
        notice = { tone: "success", title: "Already balanced", text: "Every call level is within the allowed gap of its fair share. Nothing needs to move." };
        return;
      }
      preview = await post<BalancePreview>("preview", { month }, 60000);
    } catch (error) {
      if (closed) return;
      const code = errorCode(error);
      if (code === "proposal_active") { busy = ""; showConflict(error); return; }
      blocked = code || "error";
      if (code === "nothing_to_balance") {
        blocked = "balanced";
        notice = { tone: "success", title: "Already balanced", text: `${sentence(errorMessage(error, "There is nothing to balance."))} Nothing needs to move.` };
        return;
      }
      const next = code === "not_draft" ? "Undo the publish first, or choose a draft month."
        : code === "scope_unlocked" ? "Lock the month's units in Rota Setup and build the template first."
        : code === "disabled" ? "Ask the system administrator to enable it." : "Check the connection, then try again.";
      notice = { tone: "error", text: `${sentence(errorMessage(error))} ${next}`, next: ["not_draft", "scope_unlocked", "disabled"].includes(code) ? "" : "retry" };
    } finally {
      if (busy === "load") { busy = ""; render(notice?.next ? "[data-balance-repreview]" : undefined); }
    }
  }

  async function apply() {
    if (!preview || !reviewed || busy) return;
    busy = "apply"; notice = null; render("[data-balance-apply]");
    try {
      const result = await post<BalanceApplyResult>("apply", { month, token: preview.token, plan_hash: preview.plan_hash }, 120000);
      applied = { ...preview, ...result, levels: result.levels ?? preview.levels, moves: result.moves ?? preview.moves, members: result.members ?? preview.members, summary: result.summary ?? preview.summary };
      busy = "";
      await refreshStatus();
      const s = applied.summary;
      const total = applied.levels.length;
      const uneven = applied.levels.filter(l => !l.ok_after).map(levelName);
      const passed = extraMoves(applied);
      notice = { tone: "success", title: "Balance applied", text: `${plural(s.moves, "duty", "duties")} moved${s.swaps ? `, ${plural(s.swaps, "swap")}` : ""}${s.cross_unit ? `, ${s.cross_unit} across units` : ""}.${passed
        ? ` ${plural(passed, "extra duty", "extra duties")} passed on; the justice-ledger credit moved with ${passed === 1 ? "it" : "them"}.` : ""} ${uneven.length
        ? `${s.levels_balanced_after} of ${total} levels are now within the gap; ${uneven.join(", ")} could not be evened further (the reason is shown below).`
        : "Every call level is now within the allowed gap."} Undo and the audit report are just below.` };
      onApplied();
    } catch (error) {
      busy = "";
      if (closed) return;
      const code = errorCode(error);
      if (code === "proposal_active") { showConflict(error); return; }
      const violations = (((error as ApiError).detail as Record<string, unknown> | undefined)?.violations as { message?: string; code?: string }[] | undefined) ?? [];
      notice = code === "stale_preview" ? { tone: "error", title: "The rota changed", text: `${sentence(errorMessage(error))} Nothing was saved. Preview again to see the current plan.`, next: "preview" }
        : code === "bad_token" ? { tone: "error", text: `${sentence(errorMessage(error))} Nothing was saved. Preview again, then apply.`, next: "preview" }
        : code === "verification_failed" ? { tone: "error", title: "The safety check stopped this", text: `${sentence(errorMessage(error))} Nothing was saved. Preview again; if this repeats, send these details to the administrator.`,
            next: "preview", list: violations.map(v => v.message || v.code || "Rule broken") }
        : code === "nothing_to_balance" ? { tone: "success", title: "Already balanced", text: `${sentence(errorMessage(error))} Nothing was saved.`, next: "" }
        : { tone: "error", text: `${sentence(errorMessage(error))} Nothing was saved. Try again.`, next: "" };
    }
    render(notice?.next ? "[data-balance-repreview]" : applied ? undefined : "[data-balance-apply]");
  }

  function undoConflictsFrom(error: unknown): UndoConflict[] {
    const detail = (error as ApiError).detail as Record<string, unknown> | undefined;
    const list = (detail?.conflicts ?? detail?.slots) as UndoConflict[] | undefined;
    return Array.isArray(list) && list.length ? list : [{ message: errorMessage(error) }];
  }
  async function checkUndo(batchId: string) {
    if (busy) return;
    busy = "undo-check"; notice = null; render();
    try {
      const result = await post<UndoResult>(BALANCE_UNDO(batchId), { dry_run: true });
      undo = { batchId, phase: result.conflicts?.length ? "conflict" : "confirm", restored: result.restored ?? 0, conflicts: result.conflicts ?? [] };
    } catch (error) {
      if (closed) return;
      if (errorCode(error) === "undo_conflict") undo = { batchId, phase: "conflict", restored: 0, conflicts: undoConflictsFrom(error) };
      else notice = { tone: "error", text: `${sentence(errorMessage(error))} Nothing was changed. Try again.` };
    }
    busy = ""; render(undo ? "[data-balance-undo-panel]" : undefined);
  }
  async function runUndo() {
    if (!undo || busy) return;
    const batchId = undo.batchId;
    busy = "undo"; render("[data-balance-undo-panel]");
    try {
      const result = await post<UndoResult>(BALANCE_UNDO(batchId), { dry_run: false }, 120000);
      undo = null; applied = null; preview = null; busy = "";
      await refreshStatus();
      blocked = "undone";
      notice = { tone: "success", title: "Run undone", text: `${plural(result.restored ?? 0, "duty", "duties")} put back with the person and unit they had before balancing.` };
      onApplied();
    } catch (error) {
      busy = "";
      if (closed) return;
      if (errorCode(error) === "undo_conflict") undo = { batchId, phase: "conflict", restored: 0, conflicts: undoConflictsFrom(error) };
      else { undo = null; notice = { tone: "error", text: `${sentence(errorMessage(error))} Nothing was changed. Try again.` }; }
    }
    render(undo ? "[data-balance-undo-panel]" : undefined);
  }

  dialog.onchange = event => {
    const input = event.target as HTMLInputElement;
    if (input.matches("[data-balance-reviewed]")) { reviewed = input.checked; render("[data-balance-reviewed]"); }
  };
  dialog.onclick = event => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button");
    if (!button || button.disabled || !dialog.contains(button)) return;
    if (button.matches("[data-close], [data-balance-close]")) { if (busy !== "apply" && busy !== "undo") dialog.close(); return; }
    if (button.matches("[data-balance-apply]")) { void apply(); return; }
    if (button.matches("[data-balance-repreview]")) { if (!busy) void load(); return; }
    if (button.dataset.balanceUndo) { void checkUndo(button.dataset.balanceUndo); return; }
    if (button.matches("[data-balance-undo-confirm]")) { void runUndo(); return; }
    if (button.matches("[data-balance-undo-keep]")) { undo = null; render(); }
  };
  await load();
}
