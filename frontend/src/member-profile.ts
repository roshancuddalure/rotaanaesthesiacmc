import { getMemberProfile, addMemberCallChange, addMemberComment, updateMember, addMemberAlias, addMemberDesignation,
  type MemberProfile } from "./services/api";

const escape = (v: unknown) => String(v ?? "").replace(/[&<>"']/g,
  c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const callLabel = (v: string | null) => v?.replace(/_/g, " ") ?? "Unassigned";
const timestamp = (v: string) => new Date(v).toLocaleString("en-IN", { timeZone: "Asia/Calcutta" });

export async function openMemberProfile(id: string, role: string, refresh: () => Promise<void>) {
  document.getElementById("member-profile-dialog")?.remove();
  const dialog = document.createElement("dialog");
  dialog.id = "member-profile-dialog";
  dialog.className = "member-profile-dialog";
  dialog.setAttribute("aria-label", "Department member profile");
  document.body.append(dialog);
  dialog.innerHTML = '<button type="button" data-profile-close>Close</button><p role="status">Loading profile…</p>';
  dialog.showModal();
  dialog.addEventListener("close", () => dialog.remove());
  let profile: MemberProfile;
  let busy = false;
  let error = "";
  const isAdmin = ["computer_admin", "superadmin"].includes(role);
  function render() {
    const member = profile.member;
    const latest = member.designations[member.designations.length - 1];
    dialog.innerHTML = `<header class="member-profile-header"><div><h2>${escape(member.canonical_name)}</h2>
      <p>${escape(latest?.designation ?? "Designation not recorded")} · ${escape(member.active_status)} · ${escape(callLabel(profile.current_call_level))}</p></div>
      <button type="button" data-profile-close>Close</button></header>
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
      <details><summary>Unit Posting and Leave History</summary><h4>Postings</h4>${profile.postings.map(p => `<p>${escape(p.unit ?? "Special posting")}: ${escape(p.type)} (${escape(p.starts_on)} – ${escape(p.ends_on ?? "ongoing")})</p>`).join("") || "<p>No postings.</p>"}
      <h4>Recent Leave</h4>${profile.leaves.map(l => `<p>${escape(l.type)}: ${escape(l.from)} – ${escape(l.to)} (${escape(l.status)})</p>`).join("") || "<p>No leave.</p>"}</details>
      <details><summary>Member Import Sources</summary>${profile.imports.map(i => `<p>${escape(i.file)} / ${escape(i.sheet)} / row ${i.row} · ${escape(timestamp(i.recorded_at))}</p>`).join("") || "<p>No member import sources recorded.</p>"}</details>
      ${isAdmin ? `<details><summary>Edit Member Details</summary><form data-profile-form="details"><fieldset ${busy ? "disabled" : ""}><label>Name <input name="name" value="${escape(member.canonical_name)}" maxlength="255" required /></label><label>Status <select name="status">${["active","inactive","historical","archived"].map(s => `<option value="${s}" ${member.active_status === s ? "selected" : ""}>${s}</option>`).join("")}</select></label><button>Save Member Details</button></fieldset></form></details>` : ""}
      <p role="status">${busy ? "Saving…" : escape(error)}</p>`;
  }
  dialog.onclick = event => { if ((event.target as HTMLElement).closest("[data-profile-close]")) dialog.close(); };
  dialog.onsubmit = async event => {
    const form = event.target as HTMLFormElement;
    if (!form.dataset.profileForm || busy) return;
    event.preventDefault();
    const data = new FormData(form);
    busy = true; error = ""; render();
    try {
      const action = form.dataset.profileForm;
      if (action === "call") profile = await addMemberCallChange(id, String(data.get("call_level")) || null, String(data.get("effective_from")), String(data.get("reason")));
      else if (action === "comment") profile = await addMemberComment(id, String(data.get("body")));
      else if (action === "alias") await addMemberAlias(id, String(data.get("alias")));
      else if (action === "designation") await addMemberDesignation(id, String(data.get("designation")), String(data.get("effective_from")));
      else if (action === "details") await updateMember({ ...profile.member, canonical_name: String(data.get("name")), active_status: String(data.get("status")), call_level: profile.current_call_level });
      profile = await getMemberProfile(id);
      await refresh();
      error = "Saved. Member list and linked data refreshed.";
    } catch (failure) { error = failure instanceof Error ? failure.message : "Unable to save profile."; }
    finally { busy = false; if (dialog.isConnected) render(); }
  };
  try { profile = await getMemberProfile(id); if (dialog.isConnected) render(); }
  catch (failure) { dialog.innerHTML = `<button data-profile-close>Close</button><p>${escape(failure instanceof Error ? failure.message : failure)}</p>`; }
}
