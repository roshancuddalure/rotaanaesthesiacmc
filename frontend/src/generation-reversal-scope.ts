const escape = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);

/** Display existing job identity without deriving reversal eligibility in the browser. */
export function generationReversalScope(job: { id: string; revision: number }, month: string, kind: "members" | "template" | "intelligent") {
  const label = kind === "template" ? "Template allocation" : kind === "intelligent" ? "Whole-month assignments" : "Member assignments";
  return `<div class="generation-reversal-scope"><p>Review the exact generation below. Server validation determines whether it can be reversed.</p><dl><div><dt>Month</dt><dd>${escape(month)}</dd></div><div><dt>Changes</dt><dd>${label}</dd></div><div><dt>Generation ID</dt><dd><code>${escape(job.id)}</code></dd></div><div><dt>Job revision</dt><dd>${escape(job.revision)}</dd></div></dl></div>`;
}
