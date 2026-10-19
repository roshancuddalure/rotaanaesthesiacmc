import { request } from './services/api';
import { workspaceDialog } from './member-workspace';

const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]!);
const api = <T = any>(path: string, data?: unknown) => request<T>(`/api/v1/rota-intelligence/${path}`,
  data === undefined ? {} : {method:'POST',body:JSON.stringify(data)});
const compute = <T = any>(path: string, data?: unknown) => request<T>(`/api/v1/rota-compute/${path}`,
  data === undefined ? {} : {method:'POST',body:JSON.stringify(data)});
type Decision = {slot_id:string; date:string; duty:string; action:string; person_id:string|null; person_name:string|null; reason:string; original?:{person_id:string}};
type Job = {id:string;revision:number;status:string;decisions:Decision[];proposed:number;unresolved:number;
  burden:{members:number;before:Record<string,{min:number;max:number;mean:number}>;after:Record<string,{min:number;max:number;mean:number}>};
  intelligence?:{selected:number;alternatives:{status:string;uncovered:number;changed:number;elapsed_ms:number;warnings:string[];objectives:{name:string;value:number;proven:boolean}[];history_window:{start:string;end:string;observed_months:string[]}}[]};result?:{assigned:number;replaced:number}};
type Setup = {slots:{id:string;date:string;label:string;assigned:{id:string;name:string}[]}[];people:{id:string;name:string}[];history_lookback:number;history_months:string[];rules:any;holiday_dates:string[]};

export async function openIntelligentRota(month:string, admin:boolean, onApplied:()=>void) {
  const dialog=workspaceDialog('Intelligent rota generator','compute-workspace intelligent-workspace');
  dialog.innerHTML='<p class="mw-content" role="status">Loading planning options...</p>';
  dialog.showModal();
  let closed=false, busy=false, tab='plan', notice='', job:Job|undefined, setup:Setup;
  let mode='balanced', seconds=30, instruction='', suggestion:any;
  let token=sessionStorage.getItem('rota_local_assistant_pairing') || '';
  let companionPort=Number(sessionStorage.getItem('rota_local_assistant_port') || '11437');
  let enabled=sessionStorage.getItem('rota_local_assistant_enabled') === 'true';
  let teaching:any[]=[], versions:any[]=[], historicalMonths:string[]=[];
  let teachingDraft:Record<string,FormDataEntryValue>={};
  const repairs=new Set<string>(), locks=new Set<string>();
  const preferences:{slot_id:string;person_id:string;penalty:number}[]=[];
  dialog.addEventListener('close',()=>{closed=true;dialog.remove();});
  try {
    setup=await api<Setup>(`setup?month=${encodeURIComponent(month)}`);
    const recent=await compute<Job[]>(`jobs?month=${encodeURIComponent(month)}`);
    job=recent.find(j=>j.intelligence && ['queued','running','completed'].includes(j.status));
    if(recent.some(j=>!j.intelligence && ['queued','running','completed'].includes(j.status))) notice='An existing scoring proposal is active. Resume or cancel it in Generate & review draft first.';
  } catch(e) {dialog.innerHTML=`<div class="mw-content"><p role="alert">${esc(e instanceof Error?e.message:e)}</p><button data-close>Close</button></div>`;
    dialog.querySelector('button')!.onclick=()=>dialog.close();return;}
  const people=(selected='')=>setup.people.map(p=>`<option value="${esc(p.id)}" ${p.id===selected?'selected':''}>${esc(p.name)}</option>`).join('');
  const slots=()=>setup.slots.map(s=>`<option value="${esc(s.id)}">${esc(s.date)} · ${esc(s.label)}</option>`).join('');
  const proposal=(d:Decision)=>{
    const existing=setup.slots.find(s=>s.id===d.slot_id)?.assigned || [];
    const before=d.original?(existing.find(p=>p.id===d.original!.person_id)?.name || setup.people.find(p=>p.id===d.original!.person_id)?.name || 'Previous member'):'';
    const after=d.person_name || (d.action==='preserved'?(existing.map(p=>p.name).join(', ') || 'Locked'):d.action);
    return `${before?`<small>Before: ${esc(before)}</small>`:''}${esc(after)}${d.action==='unchanged'?'<small>Unchanged</small>':''}`;
  };
  function render() {
    if(closed)return;
    const active=dialog.contains(document.activeElement)?document.activeElement:null;
    const focusAttribute=active?.getAttributeNames().find(name=>name.startsWith('data-'));
    const focusValue=focusAttribute?active?.getAttribute(focusAttribute):null;
    const existingForm=dialog.querySelector<HTMLFormElement>('[data-teaching-form]');
    if(existingForm)teachingDraft=Object.fromEntries(new FormData(existingForm));
    const report=job?.intelligence?.alternatives[job.intelligence.selected];
    dialog.innerHTML=`<header class="mw-header"><div><h2>Intelligent rota generator</h2><p>${esc(month)} · ${esc(job?.status || 'Ready')}</p></div><button data-close>Close</button></header>
      <nav class="intelligence-tabs" aria-label="Generator sections">${['plan','review','teaching','assistant',...(admin?['learning']:[])].map(t=>`<button data-tab="${t}" aria-pressed="${tab===t}">${t[0].toUpperCase()+t.slice(1)}</button>`).join('')}</nav>
      <div class="mw-content"><p role="status" aria-live="polite">${esc(notice)}</p>
      ${tab==='plan'?`<p>Plan the whole month while enforcing configured eligibility, leave, rest, limits and staffing checks. Existing assignments stay fixed unless selected for repair.</p>
        <label>Planning priority<select data-mode ${busy?'disabled':''}><option value="balanced" ${mode==='balanced'?'selected':''}>Balanced</option><option value="repair" ${mode==='repair'?'selected':''}>Fewest changes / repair</option><option value="preferences" ${mode==='preferences'?'selected':''}>Preferences first, after safe coverage</option></select></label>
        <label>Search budget<select data-seconds ${busy?'disabled':''}>${[30,60,120].map(s=>`<option value="${s}" ${seconds===s?'selected':''}>${s} seconds</option>`).join('')}</select></label>
        <p>Historical policy: ${setup.history_lookback} months. Observed months: ${esc(setup.history_months.join(', ') || 'none; unknown history receives no zero-workload credit')}.</p>
        <p>Holiday calendar: ${setup.holiday_dates.length ? `${setup.holiday_dates.length} dates configured` : 'not configured; holiday balancing will be reported as unevaluated'}.</p>
        ${admin?`<details><summary>Maintain holiday dates</summary><label>Approved dates, comma separated<input data-holidays value="${esc(setup.holiday_dates.join(', '))}" placeholder="YYYY-MM-DD"></label><button data-save-calendar>Save reviewed calendar</button></details>`:''}
        <details><summary>Locks and repair scope</summary><p>Lock any slot. In repair mode, select existing assignments that may change; all others stay fixed.</p>
        ${setup.slots.map(s=>`<div class="intelligence-slot"><span>${esc(s.date)} · ${esc(s.label)}<small>${esc(s.assigned.map(a=>a.name).join(', ') || 'Unfilled')}</small></span>
          <label><input type="checkbox" data-lock="${s.id}" ${locks.has(s.id)?'checked':''}> Lock</label>
          ${s.assigned.length===1?`<label><input type="checkbox" data-repair="${s.id}" ${repairs.has(s.id)?'checked':''} ${mode!=='repair'?'disabled':''}> Allow replacement</label>`:''}</div>`).join('')}</details>
        <details><summary>Member preferences</summary><label>Duty<select data-pref-slot>${slots()}</select></label><label>Member<select data-pref-person>${people()}</select></label><label>Preference<select data-pref-cost><option value="-100">Prefer</option><option value="100">Avoid if possible</option></select></label><button data-add-preference>Add preference</button><p>${preferences.length} preferences recorded for this proposal.</p></details>
        <details><summary>Configured safety rules</summary><pre>${esc(JSON.stringify({rest:setup.rules.rest_rules,limits:setup.rules.duty_count_limits,staffing:setup.rules.unit_staffing_rules},null,2))}</pre></details>
        <button class="primary" data-generate ${busy || (job && ['queued','running','completed'].includes(job.status))?'disabled':''}>Generate intelligent draft</button>
        ${job && ['queued','running'].includes(job.status)?'<button data-resume>Resume generation</button>':''}`:''}
      ${tab==='review'?`${!job?'<p>Generate a draft first.</p>':`<p>${job.proposed} proposed · ${job.unresolved} uncovered. ${report?`${esc(report.status)} · ${(report.elapsed_ms/1000).toFixed(2)} seconds · ${report.changed} existing assignments changed`:''}</p>
        ${report?.warnings?.map(w=>`<p>${esc(w)}</p>`).join('') || ''}
        ${job.burden?`<details><summary>Monthly workload comparison</summary><p>${job.burden.members} active posted members. Counts include preserved assignments.</p><dl>${[['total','All duties'],['hours24','24-hour duties'],['weekend24','Weekend 24-hour duties']].map(([key,label])=>`<dt>${label}</dt><dd>Before: ${job!.burden.before[key].min}–${job!.burden.before[key].max}; proposed: ${job!.burden.after[key].min}–${job!.burden.after[key].max}. Mean ${job!.burden.before[key].mean} → ${job!.burden.after[key].mean}.</dd>`).join('')}</dl></details>`:''}
        ${report?`<label>Alternative<select data-alternative>${job.intelligence!.alternatives.map((a,i)=>`<option value="${i}" ${job!.intelligence!.selected===i?'selected':''}>${i+1}: ${a.uncovered} uncovered, ${a.changed} changes, ${esc(a.status)}</option>`).join('')}</select></label>
          <details><summary>Optimization evidence</summary><p>Optimal describes this configured model and candidate set; uncovered duties still need review.</p><pre>${esc(JSON.stringify(report.objectives,null,2))}</pre></details>`:''}
        <div class="table-scroll"><table><thead><tr><th>Duty</th><th>Proposal</th><th>Reason / teach</th></tr></thead><tbody>${job.decisions.map(d=>`<tr><td data-label="Duty">${esc(d.date)}<small>${esc(d.duty)}</small></td><td data-label="Proposal">${proposal(d)}</td><td data-label="Reason / teach">${d.person_id?`<p>Eligible choice in the validated whole-month plan.</p><details><summary>Why this choice?</summary><p>${esc(d.reason)}</p></details><button data-teach-slot="${d.slot_id}">Teach this decision</button>`:esc(d.reason)}</td></tr>`).join('')}</tbody></table></div>
        ${job.status==='completed'?`<button data-more ${busy || job.intelligence!.alternatives.length>=3?'disabled':''}>Find another alternative</button><label><input type="checkbox" data-confirm> I reviewed changes and uncovered duties</label><button class="primary" data-apply disabled>Apply reviewed draft</button>`:''}
        ${['queued','running','completed'].includes(job.status)?'<button data-cancel>Cancel proposal</button>':''}<button data-download>Download evidence</button>`}`:''}
      ${tab==='teaching'?`<p>Examples start unverified. Administrators approve reusable lessons; one-time exceptions never become policy automatically.</p>
        <form data-teaching-form><label>Proposed duty<select name="slot_id">${job?.decisions.filter(d=>d.person_id).map(d=>`<option value="${d.slot_id}">${esc(d.date)} · ${esc(d.duty)} · ${esc(d.person_name)}</option>`).join('') || ''}</select></label>
        <label>Feedback<select name="kind"><option value="accept">Accept this decision</option><option value="prefer">Prefer another eligible member</option><option value="exception">One-time exception</option></select></label>
        <label>Preferred member (for a different choice)<select name="preferred_person_id"><option value="">Choose when needed</option>${people()}</select></label>
        <label>Reason<select name="reason">${['burden','spacing','history','coverage','preference','other'].map(r=>`<option>${r}</option>`).join('')}</select></label><label>Explanation<textarea name="note" maxlength="1000"></textarea></label><button ${!job || busy?'disabled':''}>Save teaching example</button></form>
        <button data-load-teaching>Refresh examples</button>${admin?`<button data-history-months>Choose historical examples</button>${historicalMonths.length?`<label>Historical month<select data-history-month>${historicalMonths.map(m=>`<option>${m}</option>`).join('')}</select></label><button data-prepare-history>Prepare unverified references</button>`:''}`:''}
        ${teaching.map(t=>`<article class="panel"><p>${esc(t.month)} · ${esc(t.kind)} · ${esc(t.reason)} · ${esc(t.status)}</p><p>${esc(t.decision?.person_name)} · ${esc(t.decision?.date)} · ${esc(t.decision?.duty)}</p>${t.preferred_person_name?`<p>Preferred instead: ${esc(t.preferred_person_name)}</p>`:''}<p>${esc(t.note)}</p>${admin&&t.status==='unverified'?`${t.historical_policy_unknown?`<label><input type="checkbox" data-verify-history="${t.id}"> I checked the original policy and availability</label>`:''}<button data-approve-example="${t.id}">Approve reviewed example</button>`:''}${admin&&['unverified','approved'].includes(t.status)?`<button data-reject-example="${t.id}">Exclude from future training</button>`:''}</article>`).join('')}`:''}
      ${tab==='assistant'?`<p>The optional assistant runs on this computer. It suggests settings and policies; it cannot assign members or approve exceptions. Generation works without it.</p>
        <label><input type="checkbox" data-local-enabled ${enabled?'checked':''}> Allow requests to my paired local assistant</label>
        <label>Local pairing token<input type="password" data-local-token value="${esc(token)}" autocomplete="off"></label>
        <label>Local companion port<input type="number" data-local-port min="1024" max="65535" value="${companionPort}"></label>
        <details><summary>Start the local assistant</summary><p>Run the companion on this computer with this website's exact origin, then enter its temporary pairing token. Allow this site's local-network / loopback permission when the browser asks.</p><code data-companion-command>.\\tools\\start-local-rota-assistant.ps1 -WebsiteOrigin ${esc(location.origin)} -Port ${companionPort}</code><p>The launcher uses an isolated local model directory. For first-time setup only, add -PrepareModel to download the model. Processing uses the installed model; no cloud fallback.</p></details>
        <label>Your instruction<textarea data-instruction maxlength="2000">${esc(instruction)}</textarea></label><button data-ask ${busy||!enabled||!token?'disabled':''}>Ask local assistant</button>
        ${suggestion?`<article class="panel"><p>${esc(suggestion.explanation)}</p>${suggestion.discarded_unrequested_rules?'<p>Unrequested numerical changes were discarded. Existing policy was preserved.</p>':''}<p>Suggested mode: ${esc(suggestion.mode)}. Proposed rules require separate policy review.</p><ul>${suggestion.proposed_rules.map((r:string)=>`<li>${esc(r)}</li>`).join('')}</ul>${suggestion.rule_changes?.length?`<details><summary>Quoted instruction for proposed settings</summary>${suggestion.rule_changes.map((r:{evidence:string})=>`<blockquote>${esc(r.evidence)}</blockquote>`).join('')}</details>`:''}<button data-use-suggestion>Use suggested planning mode</button></article>`:''}`:''}
      ${tab==='learning'&&admin?`<p>Candidate weights use approved examples only. Held-out months must pass comparison before activation; previous versions remain available for rollback.</p><button data-load-learning>Refresh versions</button><button data-propose-learning>Prepare candidate version</button>
        <label>Held-out draft months (comma separated)<input data-heldout placeholder="2026-06, 2026-07"></label>
        ${versions.map(v=>`<article class="panel"><p>${esc(v.status)} · ${esc(v.id)}</p><pre>${esc(JSON.stringify({weights:v.weights,evaluation:v.evaluation},null,2))}</pre><button data-evaluate="${v.id}">Evaluate on held-out months</button>${v.evaluation?.passed&&v.status!=='active'?`<button data-activate="${v.id}">Activate evaluated version</button>`:''}${v.activated_at&&v.status!=='active'?`<button data-rollback="${v.id}">Restore this version</button>`:''}</article>`).join('')}`:''}
      </div><footer class="mw-footer"><span>${busy?'Working. Closing this window stops further requests; an in-flight search may finish without applying assignments.':'All assignments require review and final validation.'}</span></footer>`;
    const form=dialog.querySelector<HTMLFormElement>('[data-teaching-form]');
    if(form)for(const [name,value] of Object.entries(teachingDraft)){
      const field=form.elements.namedItem(name) as HTMLInputElement | null;if(field)field.value=String(value);
    }
    if(busy)dialog.querySelectorAll<HTMLButtonElement>('button:not([data-close]):not([data-tab])').forEach(b=>{b.disabled=true;});
    if(focusAttribute)dialog.querySelector<HTMLElement>(`[${focusAttribute}${focusValue?`="${CSS.escape(focusValue)}"`:''}]`)?.focus({preventScroll:true});
  }
  async function run() {
    while(!closed && job && ['queued','running'].includes(job.status)) job=await compute<Job>(`jobs/${job.id}/step`,{revision:job.revision});
    if(job?.status==='completed') {
      await compute(`jobs/${job.id}/validate`,{revision:job.revision});
      notice='Draft ready for review. No assignments have been saved.';tab='review';
    }
  }
  dialog.onchange=event=>{
    const input=event.target as HTMLInputElement;
    if(input.matches('[data-mode]')) {mode=input.value;render();}
    if(input.matches('[data-seconds]')) seconds=Number(input.value);
    if(input.matches('[data-lock]')) {const id=input.dataset.lock!;if(input.checked){locks.add(id);repairs.delete(id);}else locks.delete(id);render();}
    if(input.matches('[data-repair]')) {const id=input.dataset.repair!;if(input.checked){repairs.add(id);locks.delete(id);}else repairs.delete(id);render();}
    if(input.matches('[data-confirm]')) dialog.querySelector<HTMLButtonElement>('[data-apply]')!.disabled=!input.checked||busy;
    if(input.matches('[data-local-enabled]')) {enabled=input.checked;sessionStorage.setItem('rota_local_assistant_enabled',String(enabled));render();}
    if(input.matches('[data-local-token]')) {token=input.value;sessionStorage.setItem('rota_local_assistant_pairing',token);}
    if(input.matches('[data-local-port]') && input.validity.valid){companionPort=Number(input.value);sessionStorage.setItem('rota_local_assistant_port',String(companionPort));const command=dialog.querySelector('[data-companion-command]');if(command)command.textContent=`.\\tools\\start-local-rota-assistant.ps1 -WebsiteOrigin ${location.origin} -Port ${companionPort}`;}
    if(input.matches('[data-instruction]')) instruction=input.value;
    if(input.matches('[data-alternative]')) void action(async()=>{job=await api<Job>(`jobs/${job!.id}/select`,{index:Number(input.value),revision:job!.revision});});
  };
  dialog.oninput=event=>{
    const input=event.target as HTMLInputElement;
    if(input.matches('[data-instruction]'))instruction=input.value;
    if(input.matches('[data-local-token]')){token=input.value;sessionStorage.setItem('rota_local_assistant_pairing',token);
      const ask=dialog.querySelector<HTMLButtonElement>('[data-ask]');if(ask)ask.disabled=busy||!enabled||!token;}
  };
  async function action(work:()=>Promise<void>) {if(busy)return;busy=true;render();try{await work();}catch(e){notice=e instanceof Error?e.message:String(e);
    if(job)try{job=await compute<Job>(`jobs/${job.id}`);}catch{/*Keep known state for recovery.*/}
  }finally{busy=false;render();}}
  dialog.onclick=event=>{
    const b=(event.target as HTMLElement).closest<HTMLButtonElement>('button');if(!b)return;
    if(b.matches('[data-close]')){dialog.close();return;}
    if(b.dataset.tab){tab=b.dataset.tab;render();return;}
    if(b.dataset.teachSlot){tab='teaching';render();(dialog.querySelector('[name="slot_id"]') as HTMLSelectElement).value=b.dataset.teachSlot;return;}
    if(b.matches('[data-use-suggestion]')){mode=suggestion.mode;tab='plan';notice='Suggested mode selected. Safety policies remain unchanged.';render();return;}
    if(b.matches('[data-add-preference]')){preferences.push({slot_id:dialog.querySelector<HTMLSelectElement>('[data-pref-slot]')!.value,person_id:dialog.querySelector<HTMLSelectElement>('[data-pref-person]')!.value,penalty:Number(dialog.querySelector<HTMLSelectElement>('[data-pref-cost]')!.value)});render();return;}
    if(b.matches('[data-download]')){const url=URL.createObjectURL(new Blob([JSON.stringify(job,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=`intelligent-rota-${month}.json`;a.click();URL.revokeObjectURL(url);return;}
    if(b.closest('[data-teaching-form]'))return;
    const heldout=dialog.querySelector<HTMLInputElement>('[data-heldout]')?.value || '';
    const holidays=dialog.querySelector<HTMLInputElement>('[data-holidays]')?.value || '';
    const historyMonth=dialog.querySelector<HTMLSelectElement>('[data-history-month]')?.value || '';
    const historicalVerified=b.dataset.approveExample ? dialog.querySelector<HTMLInputElement>(`[data-verify-history="${b.dataset.approveExample}"]`)?.checked || false : false;
    void action(async()=>{
      if(b.matches('[data-generate]')) {job=await api<Job>('jobs',{month,mode,seconds,repair_slots:mode==='repair'?[...repairs]:[],locked_slots:[...locks],preferences});await run();}
      else if(b.matches('[data-resume]'))await run();
      else if(b.matches('[data-more]')) {job=await api<Job>(`jobs/${job!.id}/alternative`,{revision:job!.revision,index:0});notice='Alternative search finished. Compare coverage and changes before selecting.';}
      else if(b.matches('[data-apply]')) {job=await compute<Job>(`jobs/${job!.id}/apply`,{revision:job!.revision});notice=`${job.result?.assigned} assignments saved; ${job.result?.replaced} replaced. Not published.`;onApplied();}
      else if(b.matches('[data-cancel]')){job=await compute<Job>(`jobs/${job!.id}/cancel`,{});notice=job.status==='applied'?'This draft was already applied; saved assignments were preserved.':'Proposal cancelled; assignments unchanged.';}
      else if(b.matches('[data-load-teaching]'))teaching=await api('teaching');
      else if(b.matches('[data-save-calendar]')){const result=await api('calendar',{dates:holidays.split(',').map(s=>s.trim()).filter(Boolean)});setup.holiday_dates=result.dates;notice='Reviewed holiday calendar saved. Existing proposals must be regenerated.';}
      else if(b.matches('[data-history-months]'))historicalMonths=await api('history-months');
      else if(b.matches('[data-prepare-history]')){const result=await api('teaching/history',{month:historyMonth});notice=`${result.prepared} historical references prepared, all unverified.`;teaching=await api('teaching');}
      else if(b.dataset.approveExample){await api(`teaching/${b.dataset.approveExample}/approve`,{historical_context_verified:historicalVerified});teaching=await api('teaching');}
      else if(b.dataset.rejectExample){await api(`teaching/${b.dataset.rejectExample}/reject`,{});teaching=await api('teaching');}
      else if(b.matches('[data-load-learning]'))versions=await api('learning');
      else if(b.matches('[data-propose-learning]')){await api('learning',{});versions=await api('learning');}
      else if(b.dataset.evaluate){await api(`learning/${b.dataset.evaluate}/evaluate`,{months:heldout.split(',').map(s=>s.trim()).filter(Boolean)});versions=await api('learning');}
      else if(b.dataset.activate){await api(`learning/${b.dataset.activate}/activate`,{});versions=await api('learning');}
      else if(b.dataset.rollback){await api(`learning/${b.dataset.rollback}/rollback`,{});versions=await api('learning');}
      else if(b.matches('[data-ask]')) {
        const context=await api(`assistant-context?month=${encodeURIComponent(month)}&instruction=${encodeURIComponent(instruction)}`);
        let response:Response;
        if(!Number.isInteger(companionPort)||companionPort<1024||companionPort>65535)throw Error('Enter a valid local companion port between 1024 and 65535.');
        try {response=await fetch(`http://127.0.0.1:${companionPort}/suggest`,{method:'POST',headers:{'Content-Type':'application/json','X-Rota-Pairing':token},body:JSON.stringify({instruction,context:JSON.stringify(context)}),signal:AbortSignal.timeout(95000)});}
        catch {throw Error('Could not reach the local assistant. Start the companion and allow this site local-network / loopback access in browser permissions. Regular generation remains available.');}
        const data=await response.json();if(!response.ok)throw Error(data.detail || 'Local assistant unavailable');suggestion=data;notice='Local suggestion received. Review before using.';
      }
    });
  };
  dialog.onsubmit=event=>{const form=event.target as HTMLFormElement;if(!form.matches('[data-teaching-form]'))return;event.preventDefault();
    const data=Object.fromEntries(new FormData(form));if(!data.preferred_person_id)data.preferred_person_id=null as any;
    void action(async()=>{await api(`jobs/${job!.id}/examples`,data);notice='Teaching example saved for review.';teaching=await api('teaching');});};
  render();
}
