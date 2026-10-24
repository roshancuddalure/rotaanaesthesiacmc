import { request } from './services/api';
import { workspaceDialog } from './member-workspace';
import { formatDateRange, formatMonth, codeLabel, retainActionFocus } from './ui';

type Review = {
  month: string; pending_count: number; review_token: string;
  requests: {id: string; person_name: string; starts_on: string; ends_on: string; status: string}[];
  affected_duties: {id: string; person_id: string; person_name: string; date: string; duty: string}[];
};
const esc = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]!);

export function openMonthlyLeaveApproval(month: string, onApproved: (count: number) => void) {
  const dialog = workspaceDialog('Approve monthly leave', 'leave-approval-workspace');
  let review: Review | undefined, loading = false, applying = false, closed = false, error = '';
  function render() {
    if (closed) return;
    const focused = dialog.contains(document.activeElement)
      ? document.activeElement?.getAttributeNames().find(name => name.startsWith('data-')) : undefined;
    dialog.innerHTML = `<header class="mw-header"><div><h2>Approve monthly leave</h2><p>${esc(formatMonth(month))}</p></div><button type="button" data-close ${applying ? 'disabled' : ''}>Close</button></header>
      <div class="mw-content"><p>Approve all pending requests that overlap this month, including imported requests awaiting review. Approved, cancelled and rejected records stay unchanged.</p>
      <p>Requests spanning adjacent months are approved for their full date range. Existing duty assignments stay in place and may need repair.</p>
      <p role="status" aria-live="polite">${loading ? 'Loading approval review...' : review ? `${review.pending_count} pending request${review.pending_count === 1 ? '' : 's'} to approve.` : ''}</p>
      ${error ? `<p role="alert" class="mw-error">${esc(error)}</p>` : ''}
      ${review ? `<div class="table-scroll"><table><caption>Requests included in this approval</caption><thead><tr><th scope="col">Member</th><th scope="col">Dates</th><th scope="col">Status</th></tr></thead><tbody>${review.requests.map(leave => `<tr><td data-label="Member">${esc(leave.person_name)}</td><td data-label="Dates">${esc(formatDateRange(leave.starts_on, leave.ends_on))}</td><td data-label="Status">${esc(codeLabel(leave.status.toUpperCase()))}</td></tr>`).join('')}</tbody></table></div>
      ${review.affected_duties.length ? `<section><h3>Assigned duties need review</h3><p>${review.affected_duties.length} existing assignment${review.affected_duties.length === 1 ? ' overlaps' : 's overlap'} these requests. Approval blocks availability but does not remove or reassign duties.</p><ul>${review.affected_duties.map(duty => `<li>${esc(duty.person_name)}: ${esc(duty.date)} - ${esc(duty.duty)}</li>`).join('')}</ul><label><input type="checkbox" data-duty-ack> I reviewed the affected duties and will arrange any necessary changes</label></section>` : ''}
      ${review.pending_count ? '<label><input type="checkbox" data-confirm> I reviewed these requests and want to approve them all</label>' : '<p>No pending leave requests to approve for this month.</p>'}` : ''}</div>
      <footer class="mw-footer"><button type="button" data-refresh ${loading || applying ? 'disabled' : ''}>Refresh review</button><button type="button" class="primary" data-approve disabled>${applying ? 'Approving...' : `Approve all ${review?.pending_count ?? ''} pending requests`}</button></footer>`;
    if (focused && (document.activeElement === document.body || document.activeElement === dialog))
      dialog.querySelector<HTMLElement>(`[${focused}]`)?.focus({preventScroll:true});
  }
  function updateApproval() {
    const checked = dialog.querySelector<HTMLInputElement>('[data-confirm]')?.checked;
    const acknowledged = !review?.affected_duties.length || dialog.querySelector<HTMLInputElement>('[data-duty-ack]')?.checked;
    dialog.querySelector<HTMLButtonElement>('[data-approve]')!.disabled = loading || applying || !review?.pending_count || !checked || !acknowledged;
  }
  async function refresh(initiator?: HTMLElement) {
    const restoreFocus = initiator
      ? retainActionFocus(dialog, initiator, () => dialog.querySelector('[data-refresh]')) : () => {};
    loading = true; review = undefined; error = ''; render();
    try { review = await request<Review>('/api/v1/leave/approval-preview', {method: 'POST', body: JSON.stringify({month}), signal: AbortSignal.timeout(30000)}); }
    catch (e) { error = e instanceof Error ? e.message : 'Could not load approval review. Try again.'; }
    finally { loading = false; render(); restoreFocus(); }
  }
  dialog.onchange = updateApproval;
  dialog.onclick = async event => {
    const button = (event.target as HTMLElement).closest('button');
    if (!button || button.disabled) return;
    if (button.matches('[data-close]') && !applying) dialog.close();
    else if (button.matches('[data-refresh]') && !loading && !applying) await refresh(button);
    else if (button.matches('[data-approve]') && review && !applying) {
      const token = review.review_token;
      const acknowledged = dialog.querySelector<HTMLInputElement>('[data-duty-ack]')?.checked || false;
      const restoreFocus = retainActionFocus(dialog, button, () => dialog.querySelector('[data-refresh]'));
      applying = true; error = ''; render();
      try {
        const result = await request<{approved_count: number}>('/api/v1/leave/approve-month', {method: 'POST', body: JSON.stringify({month, review_token: token, acknowledge_duties: acknowledged}), signal: AbortSignal.timeout(60000)});
        onApproved(result.approved_count); dialog.close();
      } catch (e) { review = undefined; error = `${e instanceof Error ? e.message : 'Approval could not be confirmed.'} Refresh the review before trying again.`; }
      finally { applying = false; render(); restoreFocus(); }
    }
  };
  dialog.addEventListener('cancel', event => { if (applying) event.preventDefault(); });
  dialog.addEventListener('close', () => { closed = true; dialog.remove(); });
  dialog.showModal(); void refresh();
}
