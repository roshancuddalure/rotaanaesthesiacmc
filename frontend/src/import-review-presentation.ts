/** Presentation only: never decides validity, inclusion, matching or apply eligibility. */
export function importRowAttention(view: { action: string; issues: string[]; matchStatus?: string | null; reason?: string }): string {
  if (view.action === "skip") return '<p class="import-row__attention">Preview outcome: skipped. Review details remain available.</p>';
  const issues = Array.isArray(view.issues) ? view.issues.filter(issue => typeof issue === "string").join(" ") : "";
  const duplicateContext = issues + " " + (view.reason ?? "");
  const labels: string[] = [];
  // Categories quote conditions expressed by the preview; all original issues remain visible.
  if (/duplicate|repeated|multiple rows target|another row targets|already exists|already matches|alias belongs|alias conflicts/i.test(duplicateContext)) labels.push("Duplicate or conflicting row");
  if (view.action === "invalid" || /\binvalid\b|not a valid/i.test(issues)) labels.push("Invalid values");
  if (["ambiguous", "conflict", "needs_review", "inactive"].includes(view.matchStatus ?? "") && view.action === "needs_review") labels.push("Unresolved member match");
  if (view.matchStatus === "inactive") labels.push("Member not active");
  if (!labels.length && view.action === "needs_review") labels.push("Needs review");
  return labels.length ? `<p class="import-row__attention"><strong>${labels.join(" · ")}.</strong> Read the preview explanation, correct the row or exclude it, then refresh preview.</p>` : "";
}

/** Plain text; callers escape every dynamic returned value. No fallback to selected form mode. */
export function importPreviewModeText(kind: "members" | "records", mode?: string): string {
  const known: Record<string, string> = kind === "members" ? {
    roster_sync: "Preview mode: Roster sync. Review new and matched members, and any missing members you choose to archive.",
    create_only: "Preview mode: Create new members only. Existing matches require a different mode; review row errors and exclusions.",
    update_existing: "Preview mode: Update existing members only. New names require a different mode; review row errors and exclusions.",
  } : {
    append: "Preview mode: Append new records. Existing identical records may be unchanged; conflicting records need review.",
    update_matching: "Preview mode: Update matching member/date records. Rows without one existing match need review.",
    replace_month: "Preview mode: Replace imported records in the returned month. Review the server-returned replacement scope before applying.",
  };
  return mode ? Object.prototype.hasOwnProperty.call(known, mode) ? known[mode] : `Preview mode: ${mode}. No explanation is available for this returned mode; review the row outcomes.` : "Preview mode was not returned. The current form selection does not establish the mode of this preview.";
}

export function importPreviewAuthorityText(stale: boolean): string {
  return stale ? "Previous preview only. Inputs or review choices changed; refresh preview before applying." : "Current returned preview. Review included rows and the existing Apply confirmations before saving.";
}

/** Text-only update: preserves all controls and returned mode/month/identity. */
export function updateImportPreviewAuthority(host: HTMLElement, stale: boolean): void {
  host.querySelectorAll<HTMLElement>("[data-import-preview-authority]").forEach(node => { node.textContent = importPreviewAuthorityText(stale); });
}
