import { openMemberWorkspace } from "./member-workspace";
import { designationPresentation, designationHistoryMarkup } from "./member-presentation";
import { getMemberProfile, addMemberCallChange, addMemberComment, updateMember, addMemberAlias, addMemberDesignation,
  type MemberProfile } from "./services/api";
import { formatAuditTimestamp } from "./audit-time";

const escape = (v: unknown) => String(v ?? "").replace(/[&<>"']/g,
  c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const callLabel = (v: string | null) => v?.replace(/_/g, " ") ?? "Unassigned";
const timestamp = (v: string) => formatAuditTimestamp(v, "Asia/Kolkata");

// Presentation only: known states get plain labels; unknown returned text stays exact.
const leaveHistoryStatusLabel = (value: unknown): string => {
  const text = String(value ?? "");
  switch (text.toLowerCase()) {
    case "approved": return "Approved";
    case "requested": return "Requested";
    case "imported_pending_review": return "Imported, Pending Review";
    case "cancelled":
    case "canceled": return "Cancelled";
    case "rejected": return "Rejected";
    default: return text;
  }
};

export async function openMemberProfile(id: string, role: string, refresh: () => Promise<void>) {
  const opener = document.activeElement as HTMLElement | null;
  const previous = document.getElementById("member-profile-dialog") as HTMLDialogElement | null;
  if (previous?.open) {
    if (previous.dispatchEvent(new Event("cancel", { cancelable: true }))) previous.close();
    if (previous.open) return;
  }
  previous?.remove();
  const dialog = document.createElement("dialog");
  dialog.id = "member-profile-dialog";
  dialog.className = "member-profile-dialog";
  dialog.setAttribute("aria-label", "Department member profile");
  document.body.append(dialog);
  dialog.innerHTML = '<button type="button" data-profile-close>Close</button><p role="status">Loading profile…</p>';
  dialog.showModal();
  dialog.addEventListener("close", () => {
    dialog.remove();
    if (opener?.isConnected && (document.activeElement === document.body || dialog.contains(document.activeElement)))
      opener.focus({ preventScroll: true });
  }, { once: true });
  let profile: MemberProfile;
  let busy = false;
  let error = "";
  const isAdmin = ["computer_admin", "superadmin"].includes(role);
  const drafts = new Map<string, Record<string, FormDataEntryValue>>();
  const baselines = new Map<string, Record<string, FormDataEntryValue>>();
  let confirmedSave: { action: string; values: Record<string, FormDataEntryValue> } | undefined;
  let submittedForm: string | undefined;
  let failedForm: string | undefined;
  let pendingForm: string | undefined;
  const nativeInvalidForms = new Set<string>();
  const valuesOf = (form: HTMLFormElement) => {
    const values: Record<string, FormDataEntryValue> = {};
    form.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>("[name]")
      .forEach((input) => { values[input.name] = input.value; });
    return values;
  };
  const formChanged = (form: HTMLFormElement) =>
    JSON.stringify(valuesOf(form)) !== JSON.stringify(baselines.get(form.dataset.profileForm!));
  const dirty = () => [...dialog.querySelectorAll<HTMLFormElement>("[data-profile-form]")].some(formChanged);
  const updateDraftStatus = () => {
    const status = dialog.querySelector<HTMLElement>("[data-profile-draft-status]");
    if (status) status.textContent = dirty() ? "Unsaved profile changes" : "";
    dialog.querySelectorAll<HTMLFormElement>("[data-profile-form]").forEach(form => {
      const marker = form.querySelector<HTMLElement>("[data-profile-section-status]");
      if (marker) marker.textContent = [busy && pendingForm === form.dataset.profileForm ? "Saving changes..." : "", confirmedSave?.action === form.dataset.profileForm ? "Saved; refresh this profile before another change." : formChanged(form) ? "Unsaved changes in this section." : "", nativeInvalidForms.has(form.dataset.profileForm!) ? "Review required fields in this section." : "", !confirmedSave && failedForm === form.dataset.profileForm && error ? "Save unsuccessful. Review the profile message." : ""].filter(Boolean).join(" ");
    });
    const notice = dialog.querySelector<HTMLElement>("[data-profile-close-notice]");
    if (notice && !busy) notice.textContent = "";
  };
  const requestClose = () => {
    if (busy) {
      const notice = dialog.querySelector<HTMLElement>("[data-profile-close-notice]");
      if (notice) notice.textContent = "A save is still in progress. Wait for its result before closing this profile.";
      return;
    }
    if (dirty() && !window.confirm("Discard unsaved profile changes?")) return;
    dialog.close();
  };
  dialog.addEventListener("cancel", event => { event.preventDefault(); requestClose(); });
  dialog.addEventListener("input", event => {
    const form = (event.target as HTMLElement).closest<HTMLFormElement>("[data-profile-form]");
    if (form) nativeInvalidForms.delete(form.dataset.profileForm!);
    updateDraftStatus();
  });
  dialog.addEventListener("invalid", event => {
    const form = (event.target as HTMLElement).closest<HTMLFormElement>("[data-profile-form]");
    if (form) nativeInvalidForms.add(form.dataset.profileForm!);
    updateDraftStatus();
  }, true);
  dialog.addEventListener("change", updateDraftStatus);
  const unload = (event: BeforeUnloadEvent) => {
    if (dialog.isConnected && (busy || dirty())) { event.preventDefault(); event.returnValue = ""; }
  };
  window.addEventListener("beforeunload", unload);
  // Account changes can remove private dialogs directly; release the unload guard then too.
  const removalObserver = new MutationObserver(() => { if (!dialog.isConnected) cleanup(); });
  const cleanup = () => {
    window.removeEventListener("beforeunload", unload);
    removalObserver.disconnect();
    window.removeEventListener("resize", updateLegacyIdentityScroll);
  };
  removalObserver.observe(document.body, { childList: true });
  dialog.addEventListener("close", cleanup, { once: true });
  function updateLegacyIdentityScroll() {
    const identity = dialog.querySelector<HTMLElement>("[data-legacy-identity-region]");
    const cue = dialog.querySelector<HTMLElement>("[data-legacy-identity-cue]");
    if (!identity) return;
    const overflow = identity.scrollHeight > identity.clientHeight + 1;
    identity.tabIndex = overflow ? 0 : -1;
    if (overflow) identity.setAttribute("aria-description", "Scroll within member identity to read the full name, designation and status.");
    else identity.removeAttribute("aria-description");
    if (cue) cue.hidden = !overflow;
  }
  window.addEventListener("resize", updateLegacyIdentityScroll);
  dialog.addEventListener("close", () => window.removeEventListener("resize", updateLegacyIdentityScroll), { once: true });
  type FocusSnapshot = { selector: string; index?: number };
  function captureFocus(element: Element | null): FocusSnapshot | undefined {
    if (!element || !dialog.contains(element)) return;
    const form = element.closest<HTMLFormElement>("[data-profile-form]");
    if (form) {
      const prefix = `[data-profile-form="${CSS.escape(form.dataset.profileForm!)}"]`;
      const name = element.getAttribute("name");
      if (name) return { selector: `${prefix} [name="${CSS.escape(name)}"]` };
      if (element.matches("button")) return { selector: `${prefix} button` };
    }
    if (element.matches("[data-profile-close]")) return { selector: "[data-profile-close]" };
    if (element.matches("[data-profile-refresh]")) return { selector: "[data-profile-refresh]" };
    if (element.matches("details[data-profile-disclosure] > summary"))
      return { selector: `[data-profile-disclosure="${CSS.escape(element.parentElement?.dataset.profileDisclosure || "")}"] > summary` };
  }
  function render(fallbackFocus?: FocusSnapshot) {
    if (!dialog.open) return;
    const focus = captureFocus(document.activeElement) || fallbackFocus;
    const scrollTop = dialog.scrollTop;
    const openDetails = new Map([...dialog.querySelectorAll<HTMLDetailsElement>("details[data-profile-disclosure]")].map(details => [details.dataset.profileDisclosure!, details.open]));
    dialog.querySelectorAll<HTMLFormElement>("[data-profile-form]").forEach((form) => {
      if (form.dataset.profileForm === submittedForm) return;
      if (formChanged(form)) drafts.set(form.dataset.profileForm!, valuesOf(form));
      else drafts.delete(form.dataset.profileForm!);
    });
    const member = profile.member;
    const designation = designationPresentation(member.designations, profile.today, "system");
    dialog.innerHTML = `<header class="member-profile-header"><div><div data-legacy-identity-region role="region" aria-label="Member identity" tabindex="-1"><h2 data-legacy-member-name>${escape(member.canonical_name)}</h2>
      <p data-legacy-member-designation>${escape(designation.label)}</p><p data-legacy-member-status><span data-legacy-active-status>${escape(member.active_status)}</span> · <span data-legacy-member-call>${escape(profile.current_call_level === undefined ? "Effective call level not returned" : callLabel(profile.current_call_level))}</span></p><p data-legacy-designation-context>${escape(designation.note)}</p></div><small data-legacy-identity-cue hidden>Scroll for full identity. Use Up/Down arrows.</small></div>
      <button type="button" data-profile-close>Close</button></header>
      <p data-profile-draft-status role="status"></p>${isAdmin || profile.can_manage ? '<p class="profile-editor-scope" data-profile-save-scope>Each section saves separately. Closing this profile asks before discarding unsaved sections.</p>' : ""}<p data-profile-close-notice role="alert"></p>
      ${confirmedSave ? '<p role="alert">Your change was saved. Refresh this profile before submitting another change. Other unsaved fields remain here.</p><button type="button" data-profile-refresh>Refresh profile</button>' : ""}
      <details data-profile-disclosure="record-identification"><summary>Record identification</summary><p>Member ID: ${escape(member.id)}. This profile is linked to imports, unit postings, leave, duties, and candidate suggestions.</p></details>
      <section class="member-workload" aria-label="Workload summary"><h3>Workload summary</h3><p data-profile-workload-period>Reporting period not returned. These are the system's recorded totals.</p><dl data-profile-workload-metrics>${[["official_duties", "Official duties"], ["hours24", "24-hour duties"], ["weekend_duties", "Weekend duties"]].map(([key,label]) => {
        const value = (profile.statistics as unknown as Record<string, unknown> | null)?.[key];
        return `<div><dt>${escape(label)}</dt><dd>${typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? escape(value) : "Not returned"}</dd></div>`;
      }).join("")}</dl><button type="button" data-profile-review-duties ${busy ? "disabled" : ""}>Review duty records</button><p class="muted-text">Duty records may include drafts; their scope can differ from these totals.</p></section>
      <section><h3>Call-Level and Promotion Timeline</h3><p>Changes apply from their effective date. Existing members' earlier promotion dates are unknown until recorded; the current level is the baseline. Add changes in effective-date order. A future change remains scheduled.</p>
        ${!Array.isArray(profile.call_history) ? "<p data-profile-history-unavailable=\"call\">Call history was not returned.</p>" : profile.call_history.length ? `<ol class="member-timeline">${profile.call_history.map(c => `<li><strong>${escape(c.effective_from)}: ${c.from === c.to ? `Baseline recorded: ${escape(callLabel(c.to))}` : `${escape(callLabel(c.from))} → ${escape(callLabel(c.to))}`}${c.scheduled ? " (scheduled)" : ""}</strong>
        <p>${escape(c.reason)}</p><details data-profile-disclosure="call-provenance-${escape(c.id)}"><summary>Record provenance</summary><small>${escape(c.author)} · ${escape(c.source)} · recorded ${escape(timestamp(c.recorded_at))}</small></details></li>`).join("")}</ol>` : "<p>No dated call changes recorded yet.</p>"}
        ${profile.can_manage ? `<form data-profile-form="call"><fieldset ${busy ? "disabled" : ""}><legend>Record promotion / call-level change</legend>
          <label>Call level <select name="call_level"><option value="">Unassigned</option>${["1ST_CALL","2ND_CALL","3RD_CALL","CO_4TH_CALL","4TH_CALL","5TH_CALL"].map(c => `<option value="${c}" ${profile.current_call_level === c ? "selected" : ""}>${escape(callLabel(c))}</option>`).join("")}</select></label>
          <label>Effective from <input name="effective_from" type="date" value="${profile.today}" required /></label>
          <label>Reason / approval reference <textarea name="reason" maxlength="4000" required></textarea></label>
          <button type="submit" class="primary">Record call change</button></fieldset></form>` : ""}</section>
      <section><h3>Designation History</h3>${designationHistoryMarkup(member.designations, profile.today, "system")}
        ${isAdmin ? `<form data-profile-form="designation"><fieldset ${busy ? "disabled" : ""}><label>Designation <input name="designation" maxlength="100" required /></label><label>Effective from <input name="effective_from" type="date" required /></label><button>Add designation</button></fieldset></form>` : ""}</section>
      <section><h3>Aliases</h3><p>${!Array.isArray(member.aliases) ? "Alias history was not returned." : member.aliases.map(a => escape(a.alias)).join("; ") || "No aliases recorded."}</p>
        ${isAdmin ? `<form data-profile-form="alias"><fieldset ${busy ? "disabled" : ""}><label>Alternate spelling <input name="alias" maxlength="255" required /></label><button>Add alias</button></fieldset></form>` : ""}</section>
      ${profile.can_manage ? `<section><h3>Admin and HOD Comments</h3><p>Visible to admins and HOD. Comments retain the author and time; corrections should be added as a follow-up comment.</p>
        <div class="member-comments">${!Array.isArray(profile.comments) ? "<p data-profile-history-unavailable=\"comments\">Comments were not returned.</p>" : profile.comments.map(c => `<article><strong>${escape(c.role === "hod" ? "HOD" : "Admin")}: ${escape(c.author)}</strong><small>${escape(timestamp(c.recorded_at))}</small><p>${escape(c.body)}</p></article>`).join("") || "<p>No comments yet.</p>"}</div>
        <form data-profile-form="comment"><fieldset ${busy ? "disabled" : ""}><label>${role === "hod" ? "HOD" : "Admin"} comment <textarea name="body" maxlength="8000" required></textarea></label><button class="primary">Add comment</button></fieldset></form></section>` : ""}
      <details data-profile-disclosure="posting-leave-history"><summary>Unit Posting and Leave History</summary><h3>Postings</h3>${!Array.isArray(profile.postings) ? "<p data-profile-history-unavailable=\"postings\">Posting history was not returned.</p>" : profile.postings.map(p => `<p>${escape(p.unit ?? "Special posting")}: ${escape(p.type)} (${escape(p.starts_on)} – ${escape(p.ends_on ?? "ongoing")})</p>`).join("") || "<p>No postings.</p>"}
      <h3>Recent Leave</h3>${!Array.isArray(profile.leaves) ? "<p data-profile-history-unavailable=\"leave\">Leave history was not returned.</p>" : profile.leaves.map(l => `<p>${escape(l.type)}: ${escape(l.from)} – ${escape(l.to)} (Status: <span data-profile-leave-status>${escape(leaveHistoryStatusLabel(l.status))}</span>)</p>`).join("") || "<p>No leave.</p>"}</details>
      <details data-profile-disclosure="import-sources"><summary>Member Import Sources</summary>${!Array.isArray(profile.imports) ? "<p data-profile-history-unavailable=\"imports\">Import history was not returned.</p>" : profile.imports.map(i => `<p>${escape(i.file)} / ${escape(i.sheet)} / row ${i.row} · ${escape(timestamp(i.recorded_at))}</p>`).join("") || "<p>No member import sources recorded.</p>"}</details>
      ${isAdmin ? `<details data-profile-disclosure="edit-member-details"><summary>Edit Member Details</summary><form data-profile-form="details"><fieldset ${busy ? "disabled" : ""}><label>Name <input name="name" value="${escape(member.canonical_name)}" maxlength="255" required /></label><label>Status <select name="status">${["active","inactive","historical","archived"].map(s => `<option value="${s}" ${member.active_status === s ? "selected" : ""}>${s}</option>`).join("")}</select></label><button>Save member details</button></fieldset></form></details>` : ""}
      <p role="status">${busy ? "Saving…" : escape(error)}</p>`;
    dialog.querySelectorAll<HTMLFormElement>("[data-profile-form]").forEach((form) => {
      const marker = document.createElement("p");
      marker.dataset.profileSectionStatus = form.dataset.profileForm!;
      marker.className = "member-section-status";
      marker.setAttribute("role", "status");
      const actions = document.createElement("div");
      actions.className = "profile-editor-actions";
      actions.setAttribute("role", "group");
      actions.setAttribute("aria-label", "Section actions");
      const submit = form.querySelector<HTMLButtonElement>("fieldset button")!;
      submit.classList.add("primary");
      submit.before(actions);
      actions.append(marker, submit);
      if (busy && pendingForm === form.dataset.profileForm) submit.textContent = "Saving...";
      if (confirmedSave?.action === form.dataset.profileForm) {
        const fieldset = form.querySelector("fieldset");
        if (fieldset) fieldset.disabled = true;
        form.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>("[name]").forEach((input) => {
          const value = confirmedSave!.values[input.name];
          if (typeof value === "string") input.value = value;
        });
      }
      baselines.set(form.dataset.profileForm!, valuesOf(form));
      const values = drafts.get(form.dataset.profileForm!);
      if (!values) return;
      form.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>("[name]").forEach((input) => {
        if (typeof values[input.name] === "string") input.value = String(values[input.name]);
      });
    });
    if (confirmedSave) {
      dialog.querySelectorAll<HTMLButtonElement>("form button").forEach(button => { button.disabled = true; });
    }
    const refreshButton = dialog.querySelector<HTMLButtonElement>("[data-profile-refresh]");
    if (refreshButton) refreshButton.disabled = busy;
    dialog.querySelectorAll<HTMLDetailsElement>("details[data-profile-disclosure]").forEach(details => { if (openDetails.has(details.dataset.profileDisclosure!)) details.open = openDetails.get(details.dataset.profileDisclosure!)!; });
    updateLegacyIdentityScroll();
    if (!busy && focus)
      dialog.querySelectorAll<HTMLElement>(focus.selector)[focus.index ?? 0]?.focus({ preventScroll: true });
    dialog.scrollTop = scrollTop;
    submittedForm = undefined;
    updateDraftStatus();
  }
  dialog.onclick = async event => {
    const target = event.target as HTMLElement;
    if (target.closest("[data-profile-close]")) requestClose();
    else if (target.closest("[data-profile-review-duties]")) {
      void openMemberWorkspace(id, isAdmin, () => {}, [], "duties");
    }
    else if (target.closest("[data-profile-refresh]") && confirmedSave && !busy) {
      const refreshFocus = captureFocus(document.activeElement);
      busy = true; error = ""; render();
      try {
        profile = await getMemberProfile(id);
        await refresh();
        // Clear only the already-saved form; preserve edits in the other forms.
        submittedForm = confirmedSave.action;
        drafts.delete(confirmedSave.action);
        confirmedSave = undefined;
        error = "Saved. Member list and linked data refreshed.";
      } catch (failure) {
        error = `Your change was saved, but the profile could not refresh. ${failure instanceof Error ? failure.message : "Try Refresh profile again."}`;
      } finally { busy = false; if (dialog.isConnected) render(refreshFocus); }
    }
  };
  dialog.onsubmit = async event => {
    const form = event.target as HTMLFormElement;
    if (!form.dataset.profileForm) return;
    event.preventDefault();
    if (busy || confirmedSave) return;
    const data = new FormData(form);
    const submitFocus = captureFocus(document.activeElement);
    let focusMoved = false;
    const trackFocus = (event: FocusEvent) => {
      // Replacing/disabled controls can leave BODY focused. Only a subsequent
      // meaningful focus destination cancels restoration of the submitted action.
      if (event.target !== document.body && event.target !== document.documentElement)
        focusMoved = true;
    };
    pendingForm = form.dataset.profileForm;
    busy = true; error = ""; render();
    document.addEventListener("focusin", trackFocus);
    try {
      const action = form.dataset.profileForm;
      if (action === "call") profile = await addMemberCallChange(id, String(data.get("call_level")) || null, String(data.get("effective_from")), String(data.get("reason")));
      else if (action === "comment") profile = await addMemberComment(id, String(data.get("body")));
      else if (action === "alias") await addMemberAlias(id, String(data.get("alias")));
      else if (action === "designation") await addMemberDesignation(id, String(data.get("designation")), String(data.get("effective_from")));
      else if (action === "details") await updateMember({ ...profile.member, canonical_name: String(data.get("name")), active_status: String(data.get("status")), call_level: profile.current_call_level });
      confirmedSave = { action: action!, values: valuesOf(form) };
      submittedForm = action;
      drafts.delete(action!);
      profile = await getMemberProfile(id);
      await refresh();
      confirmedSave = undefined;
      error = "Saved. Member list and linked data refreshed.";
      failedForm = undefined;
      nativeInvalidForms.delete(form.dataset.profileForm!);
    } catch (failure) {
      failedForm = confirmedSave ? undefined : form.dataset.profileForm;
      const detail = failure instanceof Error ? failure.message : "Unable to save profile.";
      error = confirmedSave ? `Your change was saved, but the profile could not refresh. ${detail}` : detail;
    }
    finally {
      document.removeEventListener("focusin", trackFocus);
      busy = false; pendingForm = undefined;
      if (dialog.isConnected) render(focusMoved ? undefined : submitFocus);
    }
  };
  try { profile = await getMemberProfile(id); if (dialog.isConnected) render(); }
  catch (failure) { if (dialog.open) dialog.innerHTML = `<button type="button" data-profile-close>Close</button><p role="alert">${escape(failure instanceof Error ? failure.message : failure)}</p>`; }
}
