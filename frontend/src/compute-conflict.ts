import { request } from "./services/api";

/** A proposal that blocks starting a new generation stage for the month. */
export interface ProposalConflict {
  job_id: string; month: string; status: string; kind?: string; processed: number; total: number;
  owned?: boolean; operator_name?: string | null; updated_at?: string | null;
  template?: { options?: object } | null;
}
type Stage = "members" | "template" | "intelligent" | "extra_duty" | "balance";

const escape = (value: unknown) => String(value ?? "").replace(/[&<>"']/g,
  c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
export const stageName = (kind?: string) => kind === "extra_duty" ? "Extra-duty layer" : kind === "balance" ? "Balance duties" : kind === "template" ? "Build template (unit allocation)"
  : kind === "intelligent" ? "Whole-month optimisation" : "Autoassign members (quick safe fill)";
const statusText = (c: ProposalConflict) => c.status === "completed" ? "Ready for review — not applied yet"
  : c.status === "queued" ? "Waiting to start" : `Paused at ${c.processed} of ${c.total} duties`;

/** Jobs from the list endpoint, or the structured 409/429 detail from a start request. */
export function conflictsFromError(error: unknown): ProposalConflict[] | null {
  const detail = (error as { detail?: unknown })?.detail as Record<string, unknown> | undefined;
  if (!detail || typeof detail !== "object") return null;
  if (Array.isArray(detail.jobs)) return detail.jobs as ProposalConflict[];
  return typeof detail.job_id === "string" ? [detail as unknown as ProposalConflict] : null;
}

/**
 * Explain which proposal blocks this stage and offer Resume / Cancel right here.
 * `retry` reopens the stage the user asked for after a cancel succeeds.
 */
export function showProposalConflict(dialog: HTMLDialogElement, opts: {
  month: string; admin: boolean; stage: Stage; conflicts: ProposalConflict[];
  onApplied: () => void; retry: () => void; message?: string;
}) {
  const { month, admin, stage, onApplied, retry } = opts;
  let conflicts = opts.conflicts;
  let confirming = "";
  let busy = false;
  let notice = "";
  function render() {
    dialog.innerHTML = `<header class="mw-header"><div><h2>Another proposal is in progress</h2><p>${escape(month)} · You asked for: ${escape(stageName(stage))}</p></div>
      <button type="button" data-close aria-label="Close">Close</button></header>
      <div class="mw-content compute-conflict">
      <p>${escape(opts.message || "Only one generation proposal can be open for a month at a time. Finish it, or cancel it to start this stage.")}</p>
      ${conflicts.map(c => `<article class="panel compute-conflict-card" data-conflict="${escape(c.job_id)}">
        <h3>${escape(stageName(c.kind))}</h3>
        <p>${escape(statusText(c))}${c.month && c.month !== month ? ` · ${escape(c.month)}` : ""}${c.owned === false && c.operator_name ? ` · started by ${escape(c.operator_name)}` : ""}</p>
        ${c.total ? `<progress max="${Math.max(1, c.total)}" value="${c.processed}" aria-label="Progress of the blocking proposal"></progress>` : ""}
        ${c.owned === false
          ? `<p class="hint">Only the person who started it can resume or cancel it. Ask ${escape(c.operator_name || "them")} to cancel it, or it expires two hours after its last activity.</p>`
          : `<div class="button-row">
            <button type="button" class="primary" data-conflict-open="${escape(c.job_id)}" ${busy ? "disabled" : ""}>${c.status === "completed" ? "Open it to review or apply" : "Resume it"}</button>
            ${confirming === c.job_id
              ? `<button type="button" class="danger-button" data-conflict-cancel="${escape(c.job_id)}" ${busy ? "disabled" : ""}>Yes, discard it${c.month === month ? ` and start ${escape(stageName(stage))}` : ""}</button>
                 <button type="button" data-conflict-keep ${busy ? "disabled" : ""}>Keep it</button>`
              : `<button type="button" data-conflict-ask="${escape(c.job_id)}" ${busy ? "disabled" : ""}>Cancel it</button>`}
          </div>
          ${confirming === c.job_id ? '<p class="hint" role="note">Cancelling discards only this unapplied proposal. Saved duties and assignments are not changed.</p>' : ""}`}
      </article>`).join("")}
      <p role="status" aria-live="polite">${escape(notice)}</p></div>`;
  }
  dialog.onchange = null;
  dialog.onclick = async event => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button");
    if (!button || busy) return;
    if (button.matches("[data-close]")) { dialog.close(); return; }
    if (button.matches("[data-conflict-keep]")) { confirming = ""; render(); return; }
    const ask = button.dataset.conflictAsk;
    if (ask) { confirming = ask; render(); dialog.querySelector<HTMLButtonElement>("[data-conflict-cancel]")?.focus(); return; }
    const cancelId = button.dataset.conflictCancel;
    const openId = button.dataset.conflictOpen;
    const target = conflicts.find(c => c.job_id === (cancelId || openId));
    if (!target) return;
    busy = true; notice = cancelId ? "Cancelling…" : "Opening…"; render();
    try {
      if (cancelId) {
        const job = await request<{ status: string }>(`/api/v1/rota-compute/jobs/${encodeURIComponent(cancelId)}/cancel`,
          { method: "POST", body: "{}", signal: AbortSignal.timeout(30000) });
        conflicts = conflicts.filter(c => c.job_id !== cancelId);
        busy = false; confirming = "";
        if (job.status === "applied") { notice = "That proposal had already been applied; nothing was discarded."; render(); return; }
        if (!conflicts.length) { dialog.close(); retry(); return; }
        notice = "Proposal cancelled."; render(); return;
      }
      const jobMonth = target.month || month;
      let options: object | undefined;
      if (target.kind === "template") {
        options = target.template?.options;
        if (!options) {
          const full = await request<ProposalConflict>(`/api/v1/rota-compute/jobs/${encodeURIComponent(target.job_id)}`,
            { signal: AbortSignal.timeout(10000) });
          options = full.template?.options || {};
        }
      }
      dialog.close();
      if (target.kind === "intelligent") await (await import("./rota-intelligence")).openIntelligentRota(jobMonth, admin, onApplied);
      else await (await import("./rota-compute")).openRotaCompute(jobMonth, admin, onApplied, options);
    } catch (error) {
      busy = false;
      notice = `${error instanceof Error ? error.message : "That action failed"}. Nothing was changed; try again.`;
      render();
    }
  };
  render();
  dialog.querySelector<HTMLButtonElement>("[data-conflict-open]")?.focus();
}
