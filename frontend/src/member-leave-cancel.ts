/** Existing canonical cancellation, explicit reason and read-only uncertain recovery. */
import { request } from "./services/api";
import { workspaceDialog } from "./member-workspace";
import { protectWorkspaceDraft } from "./workspace-load-state";

const esc = (value: unknown) => String(value ?? "").replace(/[&<>"']/g,
  char => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[char]!);

export function openMemberLeaveCancellation(id: string, description: string, confirmed: () => void) {
  const opener = document.activeElement as HTMLElement | null;
  const parent = opener?.closest("dialog");
  const dialog = workspaceDialog("Cancel leave", "mw-import");
  let busy = false, uncertain = false, saved = false;
  const alive = () => dialog.open && dialog.isConnected;
  const close = () => {
    if (busy) return;
    dialog.close(); dialog.remove(); if (opener?.isConnected) opener.focus();
  };
  protectWorkspaceDraft(dialog, () => busy || Boolean(dialog.querySelector<HTMLTextAreaElement>("textarea")?.value));
  dialog.addEventListener("cancel", event => {event.preventDefault();close();});
  parent?.addEventListener("close", close, {once:true});
  dialog.addEventListener("close",()=>{parent?.removeEventListener("close",close);dialog.remove();},{once:true});
  dialog.innerHTML = `<header class="mw-header"><h2>Cancel leave</h2><button type="button" data-cancel-close>Close cancellation</button></header>
    <form class="mw-content"><p>${esc(description)}</p><p>Record ${esc(id)}</p>
    <p>Cancellation stops this leave from blocking availability. Recorded history stays; existing duties remain assigned and may need review.</p>
    <label>Cancellation reason (optional)<textarea name="reason" maxlength="2000" rows="3"></textarea></label>
    <p>Record an administrative reason without private clinical details.</p>
    <label><input type="checkbox" name="acknowledge" required>I reviewed this leave record and want to cancel it.</label>
    <p role="alert" data-cancel-error></p><p role="status" data-cancel-status></p>
    <button type="submit" data-cancel-confirm>Confirm leave cancellation</button>
    <button type="button" data-cancel-read hidden style="display:none">Read latest saved leave</button></form>`;
  const form = dialog.querySelector<HTMLFormElement>("form")!;
  const action = dialog.querySelector<HTMLButtonElement>("[data-cancel-confirm]")!;
  const read = dialog.querySelector<HTMLButtonElement>("[data-cancel-read]")!;
  const error = dialog.querySelector<HTMLElement>("[data-cancel-error]")!;
  const status = dialog.querySelector<HTMLElement>("[data-cancel-status]")!;
  const lock = (value: boolean) => {
    busy = value; form.setAttribute("aria-busy",String(value));
    dialog.querySelectorAll<HTMLInputElement|HTMLTextAreaElement|HTMLButtonElement>("input,textarea,button")
      .forEach(control=>{control.disabled=value;});
    action.disabled = value || uncertain || saved;
  };
  const notify = () => { saved = true; try {confirmed();} catch {status.textContent="Cancellation saved. Refresh the member's Leave section.";} };
  dialog.querySelector<HTMLButtonElement>("[data-cancel-close]")!.onclick=close;
  form.onsubmit = async event => {
    event.preventDefault(); if (busy || uncertain || saved || !form.reportValidity()) return;
    const reason = dialog.querySelector<HTMLTextAreaElement>("textarea")!.value.trim();
    lock(true);error.textContent="";status.textContent="Saving cancellation…";
    try {
      const result=await request<{id:string;status:string}>(`/api/v1/leave/requests/${id}/cancel`,
        {method:"POST",body:JSON.stringify({reason:reason || null})});
      if (!alive()) return;
      if (result.id!==id || result.status!=="cancelled") throw new Error("The cancellation response was incomplete.");
      notify(); lock(false); close();
    } catch(caught) {
      if (!alive()) return;
      uncertain=true;
      error.textContent=`Cancellation was not confirmed. It may already have saved. ${caught instanceof Error ? caught.message : "Read the saved record."}`;
      status.textContent="Do not repeat cancellation. Read the latest saved leave before deciding the next action.";
      read.hidden=false; read.style.removeProperty("display"); lock(false); read.focus();
    } finally {if(alive()&&busy)lock(false);}
  };
  read.onclick=async()=>{
    if(busy)return;lock(true);error.textContent="";
    try {
      const result=await request<{id:string;status:string}>(`/api/v1/normalization/records/leave/${id}`);
      if(!alive())return;
      if(result.id!==id || typeof result.status!=="string")throw new Error("Saved leave was incomplete.");
      if(result.status==="cancelled"){notify();lock(false);close();}
      else status.textContent=`Latest saved status: ${result.status}. No further cancellation was sent. Close and review the canonical record before starting a new cancellation.`;
    }catch(caught){if(alive())error.textContent=caught instanceof Error ? caught.message : "Saved leave could not load.";}
    finally{if(alive())lock(false);}
  };
}
