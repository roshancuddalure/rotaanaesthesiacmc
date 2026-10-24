import { getMemberProfile, addMemberCallChange, addMemberComment, updateMember, addMemberAlias, addMemberDesignation,
  type MemberProfile } from "./services/api";
import { formatAuditTimestamp } from "./audit-time";

const escape = (v: unknown) => String(v ?? "").replace(/[&<>"']/g,
  c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const callLabel = (v: string | null) => v?.replace(/_/g, " ") ?? "Unassigned";
const timestamp = (v: string) => formatAuditTimestamp(v, "Asia/Kolkata");

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
  dialog.addEventListener("input", updateDraftStatus);
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
  };
  removalObserver.observe(document.body, { childList: true });
  dialog.addEventListener("close", cleanup, { once: true });
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
    if (element.matches("details > summary"))
      return { selector: "details > summary", index: [...dialog.querySelectorAll("details > summary")].indexOf(element) };
  }
  function render(fallbackFocus?: FocusSnapshot) {
    if (!dialog.open) return;
    const focus = captureFocus(document.activeElement) || fallbackFocus;
    const scrollTop = dialog.scrollTop;
    const openDetails = [...dialog.querySelectorAll("details")].map((details) => details.open);
    dialog.querySelectorAll<HTMLFormElement>("[data-profile-form]").forEach((form) => {
      if (form.dataset.profileForm === submittedForm) return;
      if (formChanged(form)) drafts.set(form.dataset.profileForm!, valuesOf(form));
      else drafts.delete(form.dataset.profileForm!);
    });
    const member = profile.member;
    const latest = member.designations.filter(d => d.effective_from <= profile.today && (!d.effective_to || d.effective_to >= profile.today)).slice(-1)[0];
    dialog.innerHTML = `<header class="member-profile-header"><div><h2>${escape(member.canonical_name)}</h2>
      <p>${escape(latest?.designation ?? "Designation not recorded")} · ${escape(member.active_status)} · ${escape(callLabel(profile.current_call_level))}</p></div>
      <button type="button" data-profile-close>Close</button></header>
      <p data-profile-draft-status role="status"></p><p data-profile-close-notice role="alert"></p>
      ${confirmedSave ? '<p role="alert">Your change was saved. Refresh this profile before submitting another change. Other unsaved fields remain here.</p><button type="button" data-profile-refresh>Refresh profile</button>' : ""}
      <p>Member ID: ${escape(member.id)}. This profile is linked to imports, unit postings, leave, duties, and candidate suggestions.</p>
      <div class="audit-chip-row"><span>${profile.statistics.official_duties} official duties</span><span>${profile.statistics.hours24} 24-hour duties</span><span>${profile.statistics.weekend_duties} weekend duties</span></div>
      <section><h3>Call-Level and Promotion Timeline</h3><p>Changes apply from their effective date. Existing members' earlier promotion dates are unknown until recorded; the current level is the baseline. Add changes in effective-date order. A future change remains scheduled.</p>
        ${profile.call_history.length ? `<ol class="member-timeline">${profile.call_history.map(c => `<li><strong>${escape(c.effective_from)}: ${c.from === c.to ? `Baseline recorded: ${escape(callLabel(c.to))}` : `${escape(callLabel(c.from))} → ${escape(callLabel(c.to))}`}${c.scheduled ? " (scheduled)" : ""}</strong>
        <p>${escape(c.reason)}</p><small>${escape(c.author)} · ${escape(c.source)} · recorded ${escape(timestamp(c.recorded_at))}</small></li>`).join("")}</ol>` : "<p>No dated call changes recorded yet.</p>"}
        ${profile.can_manage ? `<form data-profile-form="call"><fieldset ${busy ? "disabled" : ""}><legend>Record promotion / call-level change</legend>
          <label>Call level <select name="call_level"><option value="">Unassigned</option>${["1ST_CALL","2ND_CALL","3RD_CALL","CO_4TH_CALL","4TH_CALL","5TH_CALL"].map(c => `<option value="${c}" ${profile.current_call_level === c ? "selected" : ""}>${escape(callLabel(c))}</option>`).join("")}</select></label>
          <label>Effective from <input name="effective_from" type="date" value="${profile.today}" required /></label>
          <label>Reason / approval reference <textarea name="reason" maxlength="4000" required></textarea></label>
          <button type="submit" class="primary">Record Call Change</button></fieldset></form>` : ""}</section>
      <section><h3>Designation History</h3>${member.designations.map(d => `<p><strong>${escape(d.designation)}</strong> ${escape(d.effective_from)} – ${escape(d.effective_to ?? "ongoing")}<br/>${escape(d.notes ?? "")}</p>`).join("") || "<p>No designation history recorded.</p>"}
        ${isAdmin ? `<form data-profile-form="designation"><fieldset ${busy ? "disabled" : ""}><label>Designation <input name="designation" maxlength="100" required /></label><label>Effective from <input name="effective_from" type="date" required /></label><button>Add Designation</button></fieldset></form>` : ""}</section>
      <section><h3>Aliases</h3><p>${member.aliases.map(a => escape(a.alias)).join("; ") || "No aliases recorded."}</p>
        ${isAdmin ? `<form data-profile-form="alias"><fieldset ${busy ? "disabled" : ""}><label>Alternate spelling <input name="alias" maxlength="255" required /></label><button>Add Alias</button></fieldset></form>` : ""}</section>
      ${profile.can_manage ? `<section><h3>Admin and HOD Comments</h3><p>Visible to admins and HOD. Comments retain the author and time; corrections should be added as a follow-up comment.</p>
        <div class="member-comments">${profile.comments.map(c => `<article><strong>${escape(c.role === "hod" ? "HOD" : "Admin")}: ${escape(c.author)}</strong><small>${escape(timestamp(c.recorded_at))}</small><p>${escape(c.body)}</p></article>`).join("") || "<p>No comments yet.</p>"}</div>
        <form data-profile-form="comment"><fieldset ${busy ? "disabled" : ""}><label>${role === "hod" ? "HOD" : "Admin"} comment <textarea name="body" maxlength="8000" required></textarea></label><button class="primary">Add Comment</button></fieldset></form></section>` : ""}
      <details><summary>Unit Posting and Leave History</summary><h3>Postings</h3>${profile.postings.map(p => `<p>${escape(p.unit ?? "Special posting")}: ${escape(p.type)} (${escape(p.starts_on)} – ${escape(p.ends_on ?? "ongoing")})</p>`).join("") || "<p>No postings.</p>"}
      <h3>Recent Leave</h3>${profile.leaves.map(l => `<p>${escape(l.type)}: ${escape(l.from)} – ${escape(l.to)} (${escape(l.status)})</p>`).join("") || "<p>No leave.</p>"}</details>
      <details><summary>Member Import Sources</summary>${profile.imports.map(i => `<p>${escape(i.file)} / ${escape(i.sheet)} / row ${i.row} · ${escape(timestamp(i.recorded_at))}</p>`).join("") || "<p>No member import sources recorded.</p>"}</details>
      ${isAdmin ? `<details><summary>Edit Member Details</summary><form data-profile-form="details"><fieldset ${busy ? "disabled" : ""}><label>Name <input name="name" value="${escape(member.canonical_name)}" maxlength="255" required /></label><label>Status <select name="status">${["active","inactive","historical","archived"].map(s => `<option value="${s}" ${member.active_status === s ? "selected" : ""}>${s}</option>`).join("")}</select></label><button>Save Member Details</button></fieldset></form></details>` : ""}
      <p role="status">${busy ? "Saving…" : escape(error)}</p>`;
    dialog.querySelectorAll<HTMLFormElement>("[data-profile-form]").forEach((form) => {
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
    dialog.querySelectorAll("details").forEach((details, index) => { if (index < openDetails.length) details.open = openDetails[index]; });
    if (!busy && focus)
      dialog.querySelectorAll<HTMLElement>(focus.selector)[focus.index ?? 0]?.focus({ preventScroll: true });
    dialog.scrollTop = scrollTop;
    submittedForm = undefined;
    updateDraftStatus();
  }
  dialog.onclick = async event => {
    const target = event.target as HTMLElement;
    if (target.closest("[data-profile-close]")) requestClose();
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
    } catch (failure) {
      const detail = failure instanceof Error ? failure.message : "Unable to save profile.";
      error = confirmedSave ? `Your change was saved, but the profile could not refresh. ${detail}` : detail;
    }
    finally {
      document.removeEventListener("focusin", trackFocus);
      busy = false;
      if (dialog.isConnected) render(focusMoved ? undefined : submitFocus);
    }
  };
  try { profile = await getMemberProfile(id); if (dialog.isConnected) render(); }
  catch (failure) { if (dialog.open) dialog.innerHTML = `<button type="button" data-profile-close>Close</button><p role="alert">${escape(failure instanceof Error ? failure.message : failure)}</p>`; }
}
