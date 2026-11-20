import { request } from './services/api';
import { workspaceDialog } from './member-workspace';
import { dutyImpacts, renderDutyImpact, object, integer, id, digest, esc, type DutyImpact } from './leave-impact-view';

type Leave = {id:string;name:string;start:string;end:string};
type Review = {month:string;leave_ids:string[];repair_slots:string[];locked_slots:string[];review_token:string;
  context_digest:string;affected_duties:DutyImpact[];eligible_repair_slots:string[];preserved_slot_count:number;
  proposal_enabled:boolean;scope_available:boolean;basis:string};
type OtScope = {status:'disabled'|'evaluated'|'not_evaluated';basis:string;reasons:string[];assignment_ids:string[]};
type ScopeReview = Review & {ot_repair_scope:OtScope;ot_affected_duties:DutyImpact[]};
const ids=(value:unknown):value is string[]=>Array.isArray(value)&&value.every(id)&&new Set(value).size===value.length;
const same=(left:string[],right:string[])=>{const ordered=[...right].sort();return left.length===right.length&&[...left].sort().every((value,index)=>value===ordered[index]);};
function parsed(value:unknown,month:string,leaves:string[],repairs:string[],locks:string[]):ScopeReview {
  if(!object(value)||value.month!==month||!ids(value.leave_ids)||!same(value.leave_ids,leaves)
    ||!ids(value.repair_slots)||!same(value.repair_slots,repairs)||!ids(value.locked_slots)||!same(value.locked_slots,locks)
    ||!digest(value.review_token)||!digest(value.context_digest)||!ids(value.eligible_repair_slots)
    ||!repairs.every(slot=>(value.eligible_repair_slots as string[]).includes(slot))||locks.some(slot=>repairs.includes(slot))
    ||!integer(value.preserved_slot_count)||typeof value.proposal_enabled!=='boolean'
    ||typeof value.scope_available!=='boolean'||typeof value.basis!=='string')
    throw new Error('Repair review was incomplete or did not match your selection. Refresh before creating a proposal.');
  const impacts=dutyImpacts(value.affected_duties);
  const otImpacts=dutyImpacts(value.ot_affected_duties,true),ot=value.ot_repair_scope;
  if(!object(ot)||!['disabled','evaluated','not_evaluated'].includes(String(ot.status))||typeof ot.basis!=='string'
    ||!Array.isArray(ot.reasons)||!ot.reasons.every(reason=>typeof reason==='string')||!ids(ot.assignment_ids)
    ||(ot.status!=='evaluated'&&(ot.assignment_ids.length>0||otImpacts.length>0)))
    throw new Error('OT repair scope was incomplete. Refresh before creating a proposal.');
  const otIds=ot.assignment_ids;
  if(otImpacts.some(row=>!otIds.includes(row.id)||!row.reasons.includes('ot_reservation_component')))
    throw new Error('OT repair duties did not match the reviewed reservation components.');
  if(!value.eligible_repair_slots.every(slot=>[...impacts,...otImpacts].some(row=>row.slot_id===slot&&row.month===month&&!row.protected_period&&row.reviewed_repair_candidate)))
    throw new Error('Eligible repair duties did not match the affected draft scope. Refresh the review.');
  return {...value,affected_duties:impacts,ot_affected_duties:otImpacts} as ScopeReview;
}

export function openLeaveRepairs(sourceMonth:string,onApplied:()=>void,fallbackFocus?:()=>HTMLElement|null) {
  const dialog=workspaceDialog('Review leave repairs','leave-repair-workspace',fallbackFocus);
  let month=sourceMonth,leaves:Leave[]=[],busy=false,closed=false,error='',ticket=0;
  let review:ScopeReview|undefined,catalog:ScopeReview|undefined,submitted:Review|undefined,jobId:string|undefined,uncertain=false;
  const chosen=new Set<string>(),repairs=new Set<string>(),locks=new Set<string>();
  const live=()=>!closed&&dialog.isConnected&&dialog.open;
  const post=<T=unknown>(path:string,body:unknown)=>request<T>(`/api/v1/leave/${path}`,{
    method:'POST',body:JSON.stringify(body),signal:AbortSignal.timeout(45000)});
  const invalid=()=>{ticket++;review=undefined;jobId=undefined;error='';};
  function render() {
    if(!live())return;
    const focused=dialog.contains(document.activeElement)?document.activeElement as HTMLElement:null;
    const attribute=focused?.getAttributeNames().find(name=>name.startsWith('data-'));
    const value=attribute?focused?.getAttribute(attribute):null;
    dialog.innerHTML=`<header class="mw-header"><div><h2>Review leave repairs</h2><p>Approved leave from ${esc(sourceMonth)}</p></div><button type="button" data-close ${busy?'disabled':''}>Close</button></header>
      <div class="mw-content"><p>Select approved leave records, then review affected duties. All unselected duties, including empty slots, remain preserved. This creates a proposal; application is a separate reviewed action.</p>
      <p>Protected periods require authorized resolution. OT-only candidates may involve another person's duty; select them explicitly and review the complete replacement plan.</p>
      <p role="status" aria-live="polite">${busy?'Working…':jobId?'Proposal saved. No assignments have been changed.':review?'Current selection reviewed.':catalog?'Selection changed. Refresh the repair review.':'Choose leave and load the impact review.'}</p>
      ${error?`<p role="alert" class="mw-error">${esc(error)}</p>`:''}
      <fieldset ${busy||uncertain||jobId?'disabled':''}><legend>Approved leave to consider (up to 100)</legend>
      ${leaves.map(row=>`<label style="display:block"><input type="checkbox" data-leave="${row.id}" ${chosen.has(row.id)?'checked':''}> ${esc(row.name)}: ${esc(row.start)} to ${esc(row.end)}</label>`).join('')||'<p>No approved leave was loaded for this month.</p>'}
      <label>Duty month to repair <input type="month" data-month value="${esc(month)}"></label></fieldset>
      ${catalog?`<section><h3>Affected duties and protection</h3><p>${esc(catalog.basis)}</p>
        <p>${esc(catalog.ot_repair_scope.basis)}</p><p>OT repair scope: ${esc(catalog.ot_repair_scope.status)}.</p>
        ${catalog.ot_repair_scope.reasons.length?`<ul>${catalog.ot_repair_scope.reasons.map(reason=>`<li>${esc(reason)}</li>`).join('')}</ul>`:''}
        ${!catalog.scope_available?'<p>No unambiguous draft month with an existing generation scope is available. Set up the draft or arrange authorized resolution.</p>':''}
        <ul>${[...catalog.affected_duties,...catalog.ot_affected_duties].map(row=>`<li>${renderDutyImpact(row)}${catalog!.eligible_repair_slots.includes(row.slot_id)||locks.has(row.slot_id)?`
          <fieldset ${busy||uncertain||jobId?'disabled':''}><legend>Scope for ${esc(row.date)} - ${esc(row.duty)}</legend>
          <label><input type="checkbox" data-repair="${row.slot_id}" ${repairs.has(row.slot_id)?'checked':''} ${locks.has(row.slot_id)?'disabled':''}> Allow reviewed replacement</label>
          <label><input type="checkbox" data-lock="${row.slot_id}" ${locks.has(row.slot_id)?'checked':''}> Lock this duty</label></fieldset>`:''}</li>`).join('')}</ul>
        ${!catalog.affected_duties.length&&!catalog.ot_affected_duties.length?'<p>No direct-impact or verified deficient-component duty candidates were found. Unknown OT evidence does not prove there is no impact.</p>':''}</section>`:''}
      ${review?`<p>${review.repair_slots.length} selected for repair; ${review.preserved_slot_count} other template slots preserved.</p>${!review.proposal_enabled?'<p>Reviewed planning is disabled by the administrator.</p>':''}
      <label><input type="checkbox" data-confirm ${busy||uncertain||jobId?'disabled':''}> I reviewed the selected replacements and preserved duties</label>`:''}
      ${uncertain?'<p>Proposal creation could not be confirmed. Recover the saved result before submitting again.</p><button type="button" data-recover>Recover proposal result</button>':''}
      ${jobId?'<button type="button" class="primary" data-open>Open saved proposal for generation and review</button>':''}
      </div><footer class="mw-footer"><button type="button" data-read ${busy||uncertain||jobId||!chosen.size?'disabled':''}>Refresh repair review</button>
      <button type="button" class="primary" data-create disabled>Create scoped repair proposal</button></footer>`;
    if(jobId&&focused?.matches('[data-create],[data-recover]'))dialog.querySelector<HTMLElement>('[data-open]')?.focus();
    else if(uncertain&&focused?.matches('[data-create]'))dialog.querySelector<HTMLElement>('[data-recover]')?.focus();
    else if(attribute)dialog.querySelector<HTMLElement>(`[${attribute}${value?`="${CSS.escape(value)}"`:''}]`)?.focus({preventScroll:true});
  }
  async function read() {
    if(!live()||busy||uncertain)return;
    const own=++ticket,selection=[...chosen],selected=[...repairs],locked=[...locks],target=month;
    busy=true;review=undefined;error='';render();
    try {
      const result=parsed(await post('repair-preview',{month:target,leave_ids:selection,repair_slots:selected,locked_slots:locked}),target,selection,selected,locked);
      if(!live()||own!==ticket)return;
      review=catalog=result;
    } catch(e){if(live()&&own===ticket)error=e instanceof Error?e.message:'Could not load the repair review.';}
    finally{if(live()&&own===ticket){busy=false;render();}}
  }
  function matchingJob(value:unknown,expected:Review):value is {id:string;month:string} {
    if(!object(value)||!id(value.id)||value.month!==expected.month||value.engine!=='server'
      ||value.context_hash!==expected.context_digest||!object(value.intelligence)||!object(value.intelligence.options))return false;
    const options=value.intelligence.options;
    return options.mode==='repair'&&ids(options.repair_slots)&&same(options.repair_slots,expected.repair_slots)
      &&ids(options.locked_slots)&&options.locked_slots.length===expected.preserved_slot_count;
  }
  async function recover() {
    if(!submitted||busy||!live())return;
    busy=true;error='';render();
    try {
      const rows=await request<unknown>(`/api/v1/rota-compute/jobs?month=${encodeURIComponent(submitted.month)}`);
      if(!live())return;
      if(!Array.isArray(rows)||!rows.every(row=>object(row)&&id(row.id)&&typeof row.month==='string'))throw new Error('Proposal history was incomplete. Retry this read.');
      const matches=rows.filter(row=>matchingJob(row,submitted!));
      if(matches.length===1){jobId=matches[0].id;uncertain=false;}
      else if(!matches.length){uncertain=false;review=undefined;error='No matching proposal was found. Refresh the review before trying again.';}
      else error='More than one matching proposal was found. Resolve existing proposals in the generator before continuing.';
    }catch(e){if(live())error=e instanceof Error?e.message:'Could not recover the proposal result.';}
    finally{if(live()){busy=false;render();dialog.querySelector<HTMLElement>(jobId?'[data-open]':'[data-recover]')?.focus();}}
  }
  dialog.onchange=event=>{
    const input=event.target as HTMLInputElement;
    if(input.matches('[data-confirm]')){dialog.querySelector<HTMLButtonElement>('[data-create]')!.disabled=busy||uncertain||!!jobId||!input.checked||!review?.proposal_enabled||!review.scope_available||!review.repair_slots.length;return;}
    if(busy||uncertain||jobId)return;
    if(input.matches('[data-leave]')){invalid();input.checked?chosen.add(input.dataset.leave!):chosen.delete(input.dataset.leave!);repairs.clear();locks.clear();catalog=undefined;render();}
    else if(input.matches('[data-month]')){month=input.value;invalid();repairs.clear();locks.clear();catalog=undefined;render();}
    else if(input.matches('[data-repair]')){invalid();input.checked?repairs.add(input.dataset.repair!):repairs.delete(input.dataset.repair!);render();}
    else if(input.matches('[data-lock]')){invalid();if(input.checked){locks.add(input.dataset.lock!);repairs.delete(input.dataset.lock!);}else locks.delete(input.dataset.lock!);render();}
  };
  dialog.onclick=async event=>{
    const button=(event.target as HTMLElement).closest('button');
    if(!button||button.disabled||busy||!live())return;
    if(button.matches('[data-close]'))dialog.close();
    else if(button.matches('[data-read]'))await read();
    else if(button.matches('[data-recover]'))await recover();
    else if(button.matches('[data-create]')&&review&&!uncertain){
      submitted=review;busy=true;error='';render();
      try {
        const result=await post('repair-proposal',{month:review.month,leave_ids:review.leave_ids,repair_slots:review.repair_slots,
          locked_slots:review.locked_slots,review_token:review.review_token,seconds:30});
        if(!live())return;
        if(!matchingJob(result,submitted))throw new Error('Proposal response did not match the reviewed scope. Recover the saved result.');
        jobId=result.id;
      }catch(e){if(live()){uncertain=!Number.isInteger((e as {status?:number})?.status)||Number((e as {status?:number})?.status)>=500;review=undefined;error=e instanceof Error?e.message:'Could not confirm proposal creation.';}}
      finally{if(live()){busy=false;render();dialog.querySelector<HTMLElement>(jobId?'[data-open]':uncertain?'[data-recover]':'[data-read]')?.focus();}}
    }else if(button.matches('[data-open]')&&jobId&&submitted){
      const savedId=jobId,savedMonth=submitted.month;
      const {openIntelligentRota}=await import('./rota-intelligence');
      if(!live())return;
      dialog.close();void openIntelligentRota(savedMonth,true,onApplied,fallbackFocus,savedId);
    }
  };
  const end=()=>{closed=true;ticket++;observer.disconnect();};
  const observer=new MutationObserver(()=>{if(!dialog.isConnected)end();});
  observer.observe(document.body,{childList:true});
  dialog.addEventListener('cancel',event=>{if(busy)event.preventDefault();});
  dialog.addEventListener('close',()=>{end();dialog.remove();},{once:true});
  dialog.showModal();busy=true;render();
  void (async()=>{
    try {
      const rows=await request<unknown>(`/api/v1/leave/requests?month=${encodeURIComponent(sourceMonth)}`);
      if(!live())return;
      if(!Array.isArray(rows)||!rows.every(row=>object(row)&&id(row.id)&&typeof row.status==='string'))throw new Error('Leave records were incomplete. Close and reopen to retry.');
      leaves=rows.filter(row=>row.status.toLowerCase()==='approved').map(row=>{
        if(!object(row.person)||typeof row.person.canonical_name!=='string'||typeof row.starts_on!=='string'||typeof row.ends_on!=='string')throw new Error('Approved leave details were incomplete.');
        return {id:row.id,name:row.person.canonical_name,start:row.starts_on,end:row.ends_on};
      });
    }catch(e){if(live())error=e instanceof Error?e.message:'Could not load approved leave.';}
    finally{if(live()){busy=false;render();}}
  })();
}
