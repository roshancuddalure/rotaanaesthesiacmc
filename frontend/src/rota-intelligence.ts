import { safeSessionStorage } from './frontend-runtime';
import { request, getUnits, downloadProposalReviewExport, downloadRotaReviewExport } from './services/api';
import { workspaceDialog } from './member-workspace';
import { prepareEngine, RecoveringCompute, invalidateDevice, preference, selectedEngine,scoreFrame,optimizerConfiguration } from './compute-device';
import { conflictsFromError, showProposalConflict } from './compute-conflict';
import { protectWorkspaceDraft } from './workspace-load-state';
import { generationReversalScope } from './generation-reversal-scope';
import { workloadComparison, alternativeComparison } from './generation-comparison';
import { objectiveBasisText } from './objective-basis';
import { assistantReference, sameAssistantReference, type AssistantReference } from './assistant-reference';
import { otDemandReference, type OtDemandReference } from './assistant-ot-reference';

const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]!);
const intelligenceRequest = <T = any>(path: string, data?: unknown) => request<T>(`/api/v1/rota-intelligence/${path}`,
  data === undefined ? {signal:AbortSignal.timeout(15000)} : {method:'POST',body:JSON.stringify(data),signal:AbortSignal.timeout(150000)});
const computeRequest = <T = any>(path: string, data?: unknown) => request<T>(`/api/v1/rota-compute/${path}`,
  data === undefined ? {signal:AbortSignal.timeout(15000)} : {method:'POST',body:JSON.stringify(data),signal:AbortSignal.timeout(150000)});
type Decision = {slot_id:string; date:string; duty:string; action:string; person_id:string|null; person_name:string|null; reason:string; original?:{person_id:string}};
type Job = {id:string;revision:number;status:string;decisions:Decision[];proposed:number;unresolved:number;
  engine:'server'|'local_gpu';context_hash:string;benchmark_context_hash?:string;fallback_reason?:string;frame?:{rows:number[][];ties:number[];token:string;batches?:{rows:number[][];ties:number[]}[]};
  burden:{members:number;before:Record<string,{min:number;max:number;mean:number}>;after:Record<string,{min:number;max:number;mean:number}>};
  intelligence?:{selected:number;alternatives:{status:string;uncovered:number;changed:number;elapsed_ms:number;warnings:string[];objective_basis?:unknown;gap_feasibility?:{limit:number;status:string;policy?:string}[];fairness?:{call_level:string;members:number;minimum:number;maximum:number;gap:number}[];fairness_exceptions?:{call_level:string;gap:number;outliers:{person_name:string;duties:number;fixed_duties:number;clear_candidate_duties:number;initial_candidate_restrictions:Record<string,number>}[]}[];objectives:{name:string;value:number;proven:boolean}[];history_window:{start:string;end:string;observed_months:string[]}}[]};result?:{assigned:number;replaced:number}};
type Setup = {slots:{id:string;date:string;label:string;assigned:{id:string;name:string}[]}[];people:{id:string;name:string}[];history_lookback:number;history_months:string[];rules:any;holiday_dates:string[]};

export async function openIntelligentRota(month:string, admin:boolean, onApplied:()=>void, fallbackFocus?:()=>HTMLElement|null, resumeJobId?:string) {
  const dialog=workspaceDialog('Intelligent rota generator','compute-workspace intelligent-workspace',fallbackFocus);
  dialog.innerHTML='<p class="mw-content" role="status">Loading planning options...</p>';
  dialog.showModal();
  let closed=false, busy=false, tab='plan', notice='', job:Job|undefined, setup:Setup;
  // A removed private workspace cannot start follow-up requests in another session.
  const api=<T=any>(path:string,data?:unknown)=>closed || !dialog.open || !dialog.isConnected
    ? Promise.reject<T>(new DOMException('Workspace closed.','AbortError')) : intelligenceRequest<T>(path,data);
  const compute=<T=any>(path:string,data?:unknown)=>closed || !dialog.open || !dialog.isConnected
    ? Promise.reject<T>(new DOMException('Workspace closed.','AbortError')) : computeRequest<T>(path,data);
  const lifetime=new AbortController();
  let gpu:RecoveringCompute|undefined;
  const endLifetime=()=>{closed=true;lifetime.abort();gpu?.close();removalObserver.disconnect();};
  const removalObserver=new MutationObserver(()=>{if(!dialog.isConnected)endLifetime();});
  removalObserver.observe(document.body,{childList:true});
  dialog.addEventListener('close',endLifetime,{once:true});
  let mode='balanced', seconds=30, instruction='', suggestion:any;
  let suggestionReference:AssistantReference|null=null, suggestionInstruction='', suggestionSourceIssue='';
  let otUnits:{id:string;code:string;name:string}[]=[],otUnit='',otDay=`${month}-01`,otReference:OtDemandReference|null=null;
  let includeOt=false,suggestionScope='',suggestionContextPath='',assistantSelectionVersion=0;
  const assistantScope=()=>JSON.stringify({includeOt,unit:includeOt?otUnit:'',day:includeOt?otDay:'',enabled,version:assistantSelectionVersion});
  const clearSuggestion=()=>{assistantSelectionVersion++;suggestion=undefined;suggestionReference=null;suggestionSourceIssue='';};
  const referenceInScope=(reference:AssistantReference|null)=>!!reference && reference.month===month
    && (includeOt?reference.ot?.unitId===otUnit && reference.ot.day===otDay:!reference.ot);
  let token=safeSessionStorage.getItem('rota_local_assistant_pairing') || '';
  let companionPort=Number(safeSessionStorage.getItem('rota_local_assistant_port') || '11437');
  let enabled=safeSessionStorage.getItem('rota_local_assistant_enabled') === 'true';
  let teaching:any[]=[], versions:any[]=[], historicalMonths:string[]=[];
  let teachingDraft:Record<string,FormDataEntryValue>={};
  let teachingDirty=false, holidayDraft='', holidayBaseline='', heldoutDraft='', heldoutBaseline='', instructionBaseline='';
  let preferenceDraft={slot_id:'',person_id:'',penalty:'-100'};
  const repairs=new Set<string>(), locks=new Set<string>();
  const preferences:{slot_id:string;person_id:string;penalty:number}[]=[];
  const planningSnapshot=()=>JSON.stringify({mode,seconds,repairs:[...repairs],locks:[...locks],preferences,preferenceDraft});
  let planningBaseline='';
  const dirty=()=>teachingDirty || holidayDraft!==holidayBaseline || heldoutDraft!==heldoutBaseline || instruction!==instructionBaseline || (planningBaseline!=='' && planningSnapshot()!==planningBaseline);
  const close=()=>{
    if((busy || dirty()) && !window.confirm(busy
      ? 'A request is still running. Close and discard local drafts? An in-flight request may still finish; check its result before submitting again.'
      : 'Discard unsaved generator changes?'))return;
    endLifetime();dialog.close();
  };
  protectWorkspaceDraft(dialog,()=>busy || dirty());
  dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
  dialog.addEventListener('close',()=>{closed=true;dialog.remove();});
  try {
    setup=await api<Setup>(`setup?month=${encodeURIComponent(month)}`);
    if(closed || !dialog.isConnected)return;
    holidayDraft=holidayBaseline=setup.holiday_dates.join(', ');
    preferenceDraft={slot_id:setup.slots[0]?.id || '',person_id:setup.people[0]?.id || '',penalty:'-100'};
    planningBaseline=planningSnapshot();
    const recent=await compute<Job[]>(`jobs?month=${encodeURIComponent(month)}`);
    if(closed || !dialog.isConnected)return;
    job=recent.find(j=>j.intelligence && ['queued','running','completed'].includes(j.status));
    job ||= recent.find(j=>j.intelligence && j.status==='applied');
    if(resumeJobId){
      const saved=await compute<Job & {month:string}>(`jobs/${encodeURIComponent(resumeJobId)}`);
      if(closed || !dialog.isConnected)return;
      if(saved.id!==resumeJobId || saved.month!==month || !saved.intelligence)throw new Error('Saved repair proposal did not match this month.');
      job=saved;
      const options=(saved.intelligence as typeof saved.intelligence & {options?:{mode?:string;seconds?:number;repair_slots?:string[];locked_slots?:string[]}}).options;
      mode=options?.mode || 'repair';seconds=options?.seconds || 30;
      options?.repair_slots?.forEach(id=>repairs.add(id));options?.locked_slots?.forEach(id=>locks.add(id));
      planningBaseline=planningSnapshot();
      if(['completed','applied'].includes(saved.status))tab='review';
      notice='Saved scoped repair proposal loaded. Review and application use the preserved scope stored with this job.';
    }
    const blocking=!resumeJobId && recent.find(j=>!j.intelligence && ['queued','running','completed'].includes(j.status));
    if(blocking){
      showProposalConflict(dialog,{month,admin,stage:'intelligent',onApplied,conflicts:[{processed:0,total:0,...(blocking as Partial<{processed:number;total:number}>),...blocking,job_id:blocking.id,month,owned:true}],
        retry:()=>void openIntelligentRota(month,admin,onApplied)});
      return;
    }
  } catch(e) {if(closed || !dialog.isConnected)return;dialog.innerHTML=`<div class="mw-content"><p role="alert">${esc(e instanceof Error?e.message:e)}</p><button data-close>Close</button></div>`;
    dialog.querySelector('button')!.onclick=close;return;}
  const people=(selected='')=>setup.people.map(p=>`<option value="${esc(p.id)}" ${p.id===selected?'selected':''}>${esc(p.name)}</option>`).join('');
  const slots=()=>setup.slots.map(s=>`<option value="${esc(s.id)}">${esc(s.date)} · ${esc(s.label)}</option>`).join('');
  const proposal=(d:Decision)=>{
    const existing=setup.slots.find(s=>s.id===d.slot_id)?.assigned || [];
    const before=d.original?(existing.find(p=>p.id===d.original!.person_id)?.name || setup.people.find(p=>p.id===d.original!.person_id)?.name || 'Previous member'):'';
    const after=d.person_name || (d.action==='preserved'?(existing.map(p=>p.name).join(', ') || 'Locked'):d.action);
    return `${before?`<small>Before: ${esc(before)}</small>`:''}${esc(after)}${d.action==='unchanged'?'<small>Unchanged</small>':''}`;
  };
  function render() {
    if(closed || !dialog.isConnected)return;
    const reversalOpen=dialog.querySelector<HTMLDetailsElement>('[data-reversal-review]')?.open ?? false;
    const workloadOpen=dialog.querySelector<HTMLDetailsElement>('[data-workload-comparison]')?.open ?? false;
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
        <label>Planning priority<select data-mode ${busy?'disabled':''}><option value="balanced" ${mode==='balanced'?'selected':''}>Balanced</option><option value="repair" ${mode==='repair'?'selected':''}>Fair repair of selected duties</option><option value="preferences" ${mode==='preferences'?'selected':''}>Preferences within fair allocation</option></select></label>
        <label>Search budget<select data-seconds ${busy?'disabled':''}>${[30,60,120].map(s=>`<option value="${s}" ${seconds===s?'selected':''}>${s} seconds</option>`).join('')}</select></label>
        <p>Historical policy: ${setup.history_lookback} months. Observed months: ${esc(setup.history_months.join(', ') || 'none; unknown history receives no zero-workload credit')}.</p>
        <p>Holiday calendar: ${setup.holiday_dates.length ? `${setup.holiday_dates.length} dates configured` : 'not configured; holiday balancing will be reported as unevaluated'}.</p>
        ${admin?`<details><summary>Maintain holiday dates</summary><label>Approved dates, comma separated<input data-holidays value="${esc(holidayDraft)}" placeholder="YYYY-MM-DD"></label><button data-save-calendar>Save reviewed calendar</button></details>`:''}
        <details><summary>Locks and repair scope</summary><p>Lock any slot. In repair mode, select existing assignments that may change; all others stay fixed.</p>
        ${setup.slots.map(s=>`<div class="intelligence-slot"><span>${esc(s.date)} · ${esc(s.label)}<small>${esc(s.assigned.map(a=>a.name).join(', ') || 'Unfilled')}</small></span>
          <label><input type="checkbox" data-lock="${s.id}" ${locks.has(s.id)?'checked':''}> Lock</label>
          ${s.assigned.length===1?`<label><input type="checkbox" data-repair="${s.id}" ${repairs.has(s.id)?'checked':''} ${mode!=='repair'?'disabled':''}> Allow replacement</label>`:''}</div>`).join('')}</details>
        <details><summary>Member preferences</summary><label>Duty<select data-pref-slot>${slots()}</select></label><label>Member<select data-pref-person>${people()}</select></label><label>Preference<select data-pref-cost><option value="-100">Prefer</option><option value="100">Avoid if possible</option></select></label><button data-add-preference>Add preference</button><p>${preferences.length} preferences recorded for this proposal.</p></details>
        <details><summary>Configured safety rules</summary><pre>${esc(JSON.stringify({rest:setup.rules.rest_rules,limits:setup.rules.duty_count_limits,staffing:setup.rules.unit_staffing_rules},null,2))}</pre></details>
        <button class="primary" data-generate ${busy || (job && ['queued','running','completed'].includes(job.status))?'disabled':''}>Generate intelligent draft</button>
        ${job && ['queued','running'].includes(job.status)?'<button data-resume>Resume generation</button><button data-continue-server>Continue on server</button>':''}`:''}
      ${tab==='review'?`${!job?'<p>Generate a draft first.</p>':`<p>${job.proposed} proposed · ${job.unresolved} uncovered. ${report?`${esc(report.status)} · ${(report.elapsed_ms/1000).toFixed(2)} seconds · ${report.changed} existing assignments changed`:''}</p>
        ${report?.warnings?.map(w=>`<p>${esc(w)}</p>`).join('') || ''}
        ${report?`<section data-objective-basis><h3>Fairness objective</h3><p>${esc(objectiveBasisText(report.objective_basis))}</p></section>`:''}
        ${report?.gap_feasibility?.length?`<section data-gap-evidence><h3>Can the selected fairness gap reach one or two?</h3><p>Checked at the achieved coverage with the current units, eligible candidates and protected duties. Other unit layouts may differ.</p><ul>${report.gap_feasibility.map(g=>`<li>${g.policy==='availability'?'Availability-adjusted deviation gap':'Raw duty-count gap'} at most ${esc(g.limit)}: <strong>${g.status==='feasible'?'Feasible':g.status==='infeasible_in_candidate_model'?'Impossible in this candidate model':'Not proven within the search time'}</strong></li>`).join('')}</ul></section>`:''}
        ${report?.fairness_exceptions?.length?`<details data-fairness-exceptions><summary>Why are some duty counts still uneven?</summary><p>These are actual fixed duties and initial candidate restrictions. They do not prove that a larger gap is unavoidable.</p>${report.fairness_exceptions.map(g=>`<h4>${esc(g.call_level.replace(/_/g,' '))}: gap ${esc(g.gap)}</h4><ul>${g.outliers.map(p=>`<li><strong>${esc(p.person_name)}</strong>: ${esc(p.duties)} duties, including ${esc(p.fixed_duties)} fixed; ${esc(p.clear_candidate_duties)} clear candidate duties. ${Object.entries(p.initial_candidate_restrictions).map(([code,n])=>`${esc(code.replace(/_/g,' '))}: ${esc(n)}`).join('; ')}</li>`).join('')}</ul>`).join('')}</details>`:''}
        ${job.burden?workloadComparison('Monthly workload comparison',job.burden,workloadOpen):''}
        ${job.status==='completed'?'<button data-review-excel>Download formatted Excel preview</button><p>The workbook contains this selected proposal and fixed duties. It is a draft for review before final approval.</p>':job.status==='applied'?'<button data-review-excel>Download formatted Excel for review</button><p>Download the current saved rota for review before final approval.</p>':''}
        ${report?`<label>Alternative<select data-alternative>${job.intelligence!.alternatives.map((a,i)=>`<option value="${i}" ${job!.intelligence!.selected===i?'selected':''}>${i+1}: ${a.uncovered} uncovered, ${a.changed} changes, ${esc(a.status)}</option>`).join('')}</select></label>
          ${alternativeComparison(job.intelligence!.alternatives,job.intelligence!.selected)}<details><summary>Optimization evidence</summary><p>Optimal describes this configured model and candidate set; uncovered duties still need review.</p><pre>${esc(JSON.stringify(report.objectives,null,2))}</pre></details>`:''}
        <div class="table-scroll"><table><thead><tr><th>Duty</th><th>Proposal</th><th>Reason / teach</th></tr></thead><tbody>${job.decisions.map(d=>`<tr><td data-label="Duty">${esc(d.date)}<small>${esc(d.duty)}</small></td><td data-label="Proposal">${proposal(d)}</td><td data-label="Reason / teach">${d.person_id?`<p>Eligible choice in the validated whole-month plan.</p><details><summary>Why this choice?</summary><p>${esc(d.reason)}</p></details><button data-teach-slot="${d.slot_id}">Teach this decision</button>`:esc(d.reason)}</td></tr>`).join('')}</tbody></table></div>
        ${job.status==='completed'?`<button data-more ${busy || job.intelligence!.alternatives.length>=3?'disabled':''}>Find another alternative</button><label><input type="checkbox" data-confirm> I reviewed changes and uncovered duties</label><button class="primary" data-apply disabled>Apply reviewed draft</button>`:''}
        ${job.status==='applied'?`<details data-reversal-review ${reversalOpen?'open':''}><summary>Reverse this generation</summary>${generationReversalScope(job,month,'intelligent')}<p>Reversal is available only while this draft and its inputs remain unchanged.</p><label><input type="checkbox" data-reversal-confirm> I reviewed and want to reverse these assignments</label><button data-revert disabled>Validate and reverse</button></details>`:''}
        ${['queued','running','completed'].includes(job.status)?'<button data-cancel>Cancel proposal</button>':''}<button data-download>Download evidence</button>`}`:''}
      ${tab==='teaching'?`<p>Examples start unverified. Administrators approve reusable lessons; one-time exceptions never become policy automatically.</p>
        <form data-teaching-form><label>Proposed duty<select name="slot_id">${job?.decisions.filter(d=>d.person_id).map(d=>`<option value="${d.slot_id}">${esc(d.date)} · ${esc(d.duty)} · ${esc(d.person_name)}</option>`).join('') || ''}</select></label>
        <label>Feedback<select name="kind"><option value="accept">Accept this decision</option><option value="prefer">Prefer another eligible member</option><option value="exception">One-time exception</option></select></label>
        <label>Preferred member (for a different choice)<select name="preferred_person_id"><option value="">Choose when needed</option>${people()}</select></label>
        <label>Reason<select name="reason">${['burden','spacing','history','coverage','preference','other'].map(r=>`<option>${r}</option>`).join('')}</select></label><label>Explanation<textarea name="note" maxlength="1000"></textarea></label><button ${!job || busy?'disabled':''}>Save teaching example</button></form>
        <button data-load-teaching>Refresh examples</button>${admin?`<button data-history-months>Choose historical examples</button>${historicalMonths.length?`<label>Historical month<select data-history-month>${historicalMonths.map(m=>`<option>${m}</option>`).join('')}</select></label><button data-prepare-history>Prepare unverified references</button>`:''}`:''}
        ${teaching.map(t=>`<article class="panel"><p>${esc(t.month)} · ${esc(t.kind)} · ${esc(t.reason)} · ${esc(t.status)}</p><p>${esc(t.decision?.person_name)} · ${esc(t.decision?.date)} · ${esc(t.decision?.duty)}</p>${t.preferred_person_name?`<p>Preferred instead: ${esc(t.preferred_person_name)}</p>`:''}<p>${esc(t.note)}</p>${admin&&t.status==='unverified'?`${t.historical_policy_unknown?`<label><input type="checkbox" data-verify-history="${t.id}"> I checked the original policy and availability</label>`:''}<button data-approve-example="${t.id}">Approve reviewed example</button>`:''}${admin&&['unverified','approved'].includes(t.status)?`<button data-reject-example="${t.id}">Exclude from future training</button>`:''}</article>`).join('')}`:''}
      ${tab==='assistant'?`<p>The optional assistant runs on this computer. It suggests settings and policies; it cannot assign members or approve exceptions. Generation works without it.</p>
        ${admin?`<section data-assistant-ot aria-label="Recorded OT demand"><h3>Recorded OT demand</h3><p>Inspect the selected unit and date directly from the saved calendar. These facts stay in this inspector unless you explicitly include the selected demand below.</p><button data-ot-units>Choose OT reference unit</button>${otUnits.length?`<label>OT reference unit<select data-ot-unit ${busy?'disabled':''}>${otUnits.map(u=>`<option value="${esc(u.id)}" ${u.id===otUnit?'selected':''}>${esc(u.code)} · ${esc(u.name)}</option>`).join('')}</select></label><label>OT reference date<input type="date" data-ot-day value="${esc(otDay)}" min="${esc(month)}-01" max="${esc(new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7)),0)).toISOString().slice(0,10))}" ${busy?'disabled':''}></label><button data-ot-read>Refresh recorded demand</button>`:''}
        ${otReference?`<article data-ot-result><p>Date: ${esc(otReference.content.day)}. Calendar status: ${esc(otReference.content.calendar_status.replace(/_/g,' '))}. ${otReference.content.demand_known?'Demand definitions are complete for this selected day.':'Demand is unknown or incomplete; do not treat missing bands as zero.'}</p>${otReference.content.bands.length?`<div data-ot-bands><p>Recorded OT bands; minimum and target are separate.</p>${otReference.content.bands.map(b=>`<article class="panel" data-ot-band><h4>Band ${b.band_index+1}</h4><dl><dt>Time interval</dt><dd style="overflow-wrap:anywhere">${esc(b.starts_at)} to ${esc(b.ends_at)}</dd><dt>Call pool</dt><dd>${esc(b.call_levels.join(', '))}</dd><dt>Mandatory minimum</dt><dd data-ot-minimum>${b.minimum}</dd><dt>Target</dt><dd data-ot-target>${b.target}</dd><dt>Skill requirements</dt><dd>${b.required_skill_count} (identifiers omitted)</dd></dl></article>`).join('')}</div>`:`<p>${otReference.content.demand_known?'No demand bands are recorded for this fully configured day.':'No complete demand answer is available.'}</p>`}<p>Closed areas: ${otReference.content.closed_area_count}. Missing area definitions: ${otReference.content.missing_area_count}. Reserve mode: ${esc(otReference.content.reserve_mode || 'not recorded')}.</p><p>This is demand only. It does not establish staff availability, exact qualifications, reserve minima or assignment safety. Bands must not be summed as unique or simultaneous people.</p><details><summary>OT reference source and version</summary><p>Retrieved ${esc(otReference.retrieved_at)}. Refresh to check for calendar changes.</p><p style="overflow-wrap:anywhere">Calendar revision: ${esc(otReference.source.calendar_revision)}</p><p style="overflow-wrap:anywhere">Demand content version: ${esc(otReference.source.content_version)}</p></details></article>`:''}</section>`:''}
        ${admin?`<label><input type="checkbox" data-include-ot ${includeOt?'checked':''} ${busy||!otReference?'disabled':''}> Include this selected unit/date OT demand in my next local suggestion</label><p>Read the recorded demand first, then opt in. Changing the unit/date or refreshing clears consent and the suggestion. This sends demand definitions only; staff availability and assignment safety remain outside the model.</p>`:''}
        <label><input type="checkbox" data-local-enabled ${enabled?'checked':''}> Allow requests to my paired local assistant</label>
        <label>Local pairing token<input type="password" data-local-token value="${esc(token)}" autocomplete="off"></label>
        <label>Local companion port<input type="number" data-local-port min="1024" max="65535" value="${companionPort}"></label>
        <details><summary>Start the local assistant</summary><p>Run the companion on this computer with this website's exact origin, then enter its temporary pairing token. Allow this site's local-network / loopback permission when the browser asks.</p><code data-companion-command>.\\tools\\start-local-rota-assistant.ps1 -WebsiteOrigin ${esc(location.origin)} -Port ${companionPort}</code><p>The launcher uses an isolated local model directory. For first-time setup only, add -PrepareModel to download the model. Processing uses the installed model; no cloud fallback.</p></details>
        <label>Your instruction<textarea data-instruction maxlength="2000">${esc(instruction)}</textarea></label><button data-ask ${busy||!enabled||!token?'disabled':''}>Ask local assistant</button>
        ${suggestion?`<article class="panel"><p>${esc(suggestion.explanation)}</p>${suggestion.discarded_unrequested_rules?'<p>Unrequested numerical changes were discarded. Existing policy was preserved.</p>':''}<p>Suggested mode: ${esc(suggestion.mode)}. Proposed rules require separate policy review.</p><ul>${suggestion.proposed_rules.map((r:string)=>`<li>${esc(r)}</li>`).join('')}</ul>${suggestion.rule_changes?.length?`<details><summary>Quoted instruction for proposed settings</summary>${suggestion.rule_changes.map((r:{evidence:string})=>`<blockquote>${esc(r.evidence)}</blockquote>`).join('')}</details>`:''}
        <section data-assistant-sources aria-label="Assistant reference sources"><h3>Reference sources</h3>${suggestionReference?`<p>Reference snapshot for ${esc(suggestionReference.month)}, retrieved ${esc(suggestionReference.generatedAt)}.</p><dl><dt>Current rule constraints — content version</dt><dd style="overflow-wrap:anywhere">${esc(suggestionReference.rules)}</dd><dt>Approved teaching features — content version</dt><dd style="overflow-wrap:anywhere">${esc(suggestionReference.teaching)}</dd></dl>`:'<p>Reference versions are unavailable.</p>'}<p>This reference does not include personal availability or private leave details. Unit OT demand is included only when the selected OT source is shown below. It does not validate a rota or approve policy changes.</p><p>The source versions are checked again before selecting a planning mode. Final generation still uses current rules and safety validation.</p>${suggestionSourceIssue?`<p role="alert">${esc(suggestionSourceIssue)}</p>`:''}</section>
        ${suggestionReference?.ot?`<section data-assistant-selected-ot-source aria-label="Selected OT reference source"><h3>Selected OT reference</h3><p>Unit: ${esc(otUnits.find(u=>u.id===suggestionReference!.ot!.unitId)?.code || suggestionReference.ot.unitId)}. Date: ${esc(suggestionReference.ot.day)}.</p><p>Demand definitions only. Unknown demand is not zero; targets are distinct from minima. This does not establish available staff or safe allocations.</p><dl><dt>Selected demand content version</dt><dd style="overflow-wrap:anywhere">${esc(suggestionReference.ot.version)}</dd><dt>Calendar revision</dt><dd style="overflow-wrap:anywhere">${esc(suggestionReference.ot.calendarRevision)}</dd></dl></section>`:''}
        <button data-use-suggestion ${!suggestionReference||suggestionSourceIssue?'disabled':''}>Use suggested planning mode</button></article>`:''}`:''}
      ${tab==='learning'&&admin?`<p>Candidate weights use approved examples only. Held-out months must pass comparison before activation; previous versions remain available for rollback.</p><button data-load-learning>Refresh versions</button><button data-propose-learning>Prepare candidate version</button>
        <label>Held-out draft months (comma separated)<input data-heldout value="${esc(heldoutDraft)}" placeholder="2026-06, 2026-07"></label>
        ${versions.map(v=>`<article class="panel"><p>${esc(v.status)} · ${esc(v.id)}</p><pre>${esc(JSON.stringify({weights:v.weights,evaluation:v.evaluation},null,2))}</pre><button data-evaluate="${v.id}">Evaluate on held-out months</button>${v.evaluation?.passed&&v.status!=='active'?`<button data-activate="${v.id}">Activate evaluated version</button>`:''}${v.activated_at&&v.status!=='active'?`<button data-rollback="${v.id}">Restore this version</button>`:''}</article>`).join('')}`:''}
      </div><footer class="mw-footer"><span>${busy?'Working. Closing this window stops further requests; an in-flight search may finish without applying assignments.':'All assignments require review and final validation.'}</span></footer>`;
    const form=dialog.querySelector<HTMLFormElement>('[data-teaching-form]');
    if(form)for(const [name,value] of Object.entries(teachingDraft)){
      const field=form.elements.namedItem(name) as HTMLInputElement | null;if(field)field.value=String(value);
    }
    for(const [selector,value] of [['[data-pref-slot]',preferenceDraft.slot_id],['[data-pref-person]',preferenceDraft.person_id],['[data-pref-cost]',preferenceDraft.penalty]]){
      const field=dialog.querySelector<HTMLSelectElement>(selector);if(field)field.value=value;
    }
    if(busy)dialog.querySelectorAll<HTMLButtonElement>('button:not([data-close]):not([data-tab])').forEach(b=>{b.disabled=true;});
    if(focusAttribute)dialog.querySelector<HTMLElement>(`[${focusAttribute==='data-revert' && job?.status==='applied'?'data-reversal-confirm':focusAttribute}${focusValue?`="${CSS.escape(focusValue)}"`:''}]`)?.focus({preventScroll:true});
  }
  async function run() {
    try {
      while(!closed && job && ['queued','running'].includes(job.status)) {
        let extra:object={};
        if(job.frame)try {
          gpu ||= new RecoveringCompute(message=>{notice=message;render();});
          const scored=await scoreFrame(job.frame,frame=>gpu!.score(frame));extra={selection:scored.winner,...('selections' in scored?{selections:scored.selections}:{}),token:job.frame.token};
        }catch(error){if(closed)break;invalidateDevice(error);gpu?.close();gpu=undefined;extra={fallback:true};notice='GPU assistance interrupted. Continuing on the server.';}
        if(closed)break;
        const prior=job;
        try {job=await compute<Job>(`jobs/${job.id}/step`,{revision:job.revision,...extra});}
        catch(error){
          const status=(error as {status?:number})?.status;
          if(status===422 && 'selection' in extra){invalidateDevice(error);job=await compute<Job>(`jobs/${prior.id}/step`,{revision:prior.revision,fallback:true});}
          else if(status===undefined || status>=500){
            const saved=await compute<Job>(`jobs/${prior.id}`);
            if(closed)break;
            job=saved.revision!==prior.revision || !['queued','running'].includes(saved.status)?saved:await compute<Job>(`jobs/${prior.id}/step`,{revision:prior.revision,...extra});
          }else throw error;
        }
        if(!closed){notice=`${job.engine==='local_gpu'?'GPU candidate ranking + server optimisation':'Server optimisation'} · ${job.status}. ${job.fallback_reason || ''}`;render();}
      }
    }finally{gpu?.close();gpu=undefined;}
    if(!closed && job?.status==='completed') {
      await compute(`jobs/${job.id}/validate`,{revision:job.revision});
      notice='Draft ready for review. No assignments have been saved.';tab='review';
    }
  }
  dialog.onchange=event=>{
    const input=event.target as HTMLInputElement;
    rememberDraft(input);
    if(input.matches('[data-mode]')) {mode=input.value;render();}
    if(input.matches('[data-seconds]')) seconds=Number(input.value);
    if(input.matches('[data-lock]')) {const id=input.dataset.lock!;if(input.checked){locks.add(id);repairs.delete(id);}else locks.delete(id);render();}
    if(input.matches('[data-repair]')) {const id=input.dataset.repair!;if(input.checked){repairs.add(id);locks.delete(id);}else repairs.delete(id);render();}
    if(input.matches('[data-confirm]')) dialog.querySelector<HTMLButtonElement>('[data-apply]')!.disabled=!input.checked||busy;
    if(input.matches('[data-reversal-confirm]')) dialog.querySelector<HTMLButtonElement>('[data-revert]')!.disabled=!input.checked||busy;
    if(input.matches('[data-local-enabled]')) {enabled=input.checked;clearSuggestion();safeSessionStorage.setItem('rota_local_assistant_enabled',String(enabled));render();}
    if(input.matches('[data-local-token]')) {token=input.value;safeSessionStorage.setItem('rota_local_assistant_pairing',token);}
    if(input.matches('[data-local-port]') && input.validity.valid){companionPort=Number(input.value);safeSessionStorage.setItem('rota_local_assistant_port',String(companionPort));const command=dialog.querySelector('[data-companion-command]');if(command)command.textContent=`.\\tools\\start-local-rota-assistant.ps1 -WebsiteOrigin ${location.origin} -Port ${companionPort}`;}
    if(input.matches('[data-instruction]')) instruction=input.value;
    if(input.matches('[data-ot-unit]')){otUnit=input.value;otReference=null;includeOt=false;clearSuggestion();render();}
    if(input.matches('[data-ot-day]')){otDay=input.value;otReference=null;includeOt=false;clearSuggestion();render();}
    if(input.matches('[data-include-ot]')){includeOt=input.checked && admin && !!otReference;clearSuggestion();render();}
    if(input.matches('[data-alternative]')) void action(async()=>{job=await api<Job>(`jobs/${job!.id}/select`,{index:Number(input.value),revision:job!.revision});});
  };
  dialog.oninput=event=>{
    const input=event.target as HTMLInputElement;
    rememberDraft(input);
    if(input.matches('[data-instruction]'))instruction=input.value;
    if(input.matches('[data-local-token]')){token=input.value;safeSessionStorage.setItem('rota_local_assistant_pairing',token);
      const ask=dialog.querySelector<HTMLButtonElement>('[data-ask]');if(ask)ask.disabled=busy||!enabled||!token;}
  };
  function rememberDraft(input:HTMLInputElement) {
    if(input.matches('[data-holidays]'))holidayDraft=input.value;
    if(input.matches('[data-heldout]'))heldoutDraft=input.value;
    if(input.matches('[data-pref-slot]'))preferenceDraft.slot_id=input.value;
    if(input.matches('[data-pref-person]'))preferenceDraft.person_id=input.value;
    if(input.matches('[data-pref-cost]'))preferenceDraft.penalty=input.value;
    if(input.closest('[data-teaching-form]'))teachingDirty=true;
  }
  async function action(work:()=>Promise<void>) {if(busy)return;busy=true;render();let handedOff=false;try{await work();}catch(e){
    if(closed || !dialog.isConnected)return;
    const conflicts=conflictsFromError(e);
    if(conflicts?.length && !closed){handedOff=true;busy=false;
      showProposalConflict(dialog,{month,admin,stage:'intelligent',onApplied,conflicts,message:e instanceof Error?e.message:undefined,
        retry:()=>void openIntelligentRota(month,admin,onApplied)});return;}
    notice=e instanceof Error?e.message:String(e);
    if(job)try{job=await compute<Job>(`jobs/${job.id}`);}catch{/*Keep known state for recovery.*/}
  }finally{if(!handedOff){busy=false;render();}}}
  dialog.onclick=event=>{
    const b=(event.target as HTMLElement).closest<HTMLButtonElement>('button');if(!b)return;
    if(b.matches('[data-close]')){close();return;}
    if(b.dataset.tab){tab=b.dataset.tab;render();return;}
    if(b.dataset.teachSlot){tab='teaching';render();(dialog.querySelector('[name="slot_id"]') as HTMLSelectElement).value=b.dataset.teachSlot;return;}
    if(b.matches('[data-use-suggestion]')){void action(async()=>{
      if(!suggestion || !suggestionReference || instruction!==suggestionInstruction || suggestionScope!==assistantScope())throw Error('The instruction or selected reference changed. Ask for a new suggestion.');
      const selectedSuggestion=suggestion, selectedReference=suggestionReference, selectedInstruction=suggestionInstruction;
      const current=assistantReference(await api(suggestionContextPath));
      if(instruction!==selectedInstruction || suggestion!==selectedSuggestion || suggestionScope!==assistantScope())throw Error('The instruction or selected reference changed. Ask for a new suggestion.');
      if(!referenceInScope(current) || !sameAssistantReference(selectedReference,current)){
        suggestionSourceIssue='The reference rules, teaching evidence or selected OT demand changed. Ask for a new suggestion.';
        throw Error(suggestionSourceIssue);
      }
      if(closed || !dialog.open || !dialog.isConnected)return;
      mode=selectedSuggestion.mode;tab='plan';notice='Suggested mode selected after checking its reference versions. Safety policies remain unchanged.';
    });return;}
    if(b.matches('[data-add-preference]')){preferences.push({slot_id:dialog.querySelector<HTMLSelectElement>('[data-pref-slot]')!.value,person_id:dialog.querySelector<HTMLSelectElement>('[data-pref-person]')!.value,penalty:Number(dialog.querySelector<HTMLSelectElement>('[data-pref-cost]')!.value)});render();return;}
    if(b.matches('[data-download]')){const url=URL.createObjectURL(new Blob([JSON.stringify(job,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=`intelligent-rota-${month}.json`;a.click();URL.revokeObjectURL(url);return;}
    if(b.closest('[data-teaching-form]'))return;
    const heldout=dialog.querySelector<HTMLInputElement>('[data-heldout]')?.value || '';
    const holidays=dialog.querySelector<HTMLInputElement>('[data-holidays]')?.value || '';
    const historyMonth=dialog.querySelector<HTMLSelectElement>('[data-history-month]')?.value || '';
    const historicalVerified=b.dataset.approveExample ? dialog.querySelector<HTMLInputElement>(`[data-verify-history="${b.dataset.approveExample}"]`)?.checked || false : false;
    const reversalConfirmed=dialog.querySelector<HTMLInputElement>('[data-reversal-confirm]')?.checked === true;
    void action(async()=>{
      if(b.matches('[data-review-excel]')) {
        const applied=job!.status==='applied';
        const {blob,filename}=await (applied?downloadRotaReviewExport(month):downloadProposalReviewExport(job!.id,job!.revision));
        if(closed || !dialog.isConnected)return;
        const url=URL.createObjectURL(blob), link=document.createElement('a');
        link.href=url;link.download=filename;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
        notice=applied?'Current saved rota Excel sent to your browser for review.':'Formatted Excel preview sent to your browser. Draft remains unapplied.';
      }
      if(b.matches('[data-generate]')) {
        const generationOptions={mode,seconds,repair_slots:mode==='repair'?[...repairs]:[],locked_slots:[...locks],preferences:preferences.map(p=>({...p}))};
        const configuration=optimizerConfiguration(generationOptions);
        const caps=await compute<{browser_gpu:boolean;optimizer_gpu:boolean;context_hash:string;optimizer_context_hash?:string;workload_estimates?:{optimizer_rows:number}}>(`capabilities?month=${encodeURIComponent(month)}`);
        const engine=await prepareEngine(admin,caps.browser_gpu&&caps.optimizer_gpu,{month,hash:caps.optimizer_context_hash || caps.context_hash,workload:'optimizer',configuration,estimatedRows:caps.workload_estimates?.optimizer_rows},lifetime.signal);
        if(closed)return;
        job=await api<Job>('jobs',{month,...generationOptions,engine});
        if(engine==='local_gpu' && preference().mode==='auto' && selectedEngine(admin,true,{month,hash:job.benchmark_context_hash || job.context_hash,workload:'optimizer',configuration})!=='local_gpu')
          job=await compute<Job>(`jobs/${job.id}/step`,{revision:job.revision,fallback:true});
        await run();
      }
      else if(b.matches('[data-resume]'))await run();
      else if(b.matches('[data-more]')) {job=await api<Job>(`jobs/${job!.id}/alternative`,{revision:job!.revision,index:0});notice='Alternative search finished. Compare coverage and changes before selecting.';}
      else if(b.matches('[data-apply]')) {const appliedPlanning=planningSnapshot();job=await compute<Job>(`jobs/${job!.id}/apply`,{revision:job!.revision});planningBaseline=appliedPlanning;notice=`${job.result?.assigned} assignments saved; ${job.result?.replaced} replaced. Not published.`;if(!closed && dialog.isConnected)onApplied();}
      else if(b.matches('[data-revert]') && reversalConfirmed) {
        await compute(`jobs/${job!.id}/reversal-check`,{revision:job!.revision});
        job=await compute<Job>(`jobs/${job!.id}/revert`,{revision:job!.revision});notice='Generation reversed. Previous assignments restored.';if(!closed && dialog.isConnected)onApplied();
      }
      else if(b.matches('[data-continue-server]')){gpu?.close();gpu=undefined;invalidateDevice();job=await compute<Job>(`jobs/${job!.id}/step`,{revision:job!.revision,fallback:true});await run();}
      else if(b.matches('[data-cancel]')){gpu?.close();gpu=undefined;job=await compute<Job>(`jobs/${job!.id}/cancel`,{});notice=job.status==='applied'?'This draft was already applied; saved assignments were preserved.':'Proposal cancelled; assignments unchanged.';}
      else if(b.matches('[data-load-teaching]'))teaching=await api('teaching');
      else if(b.matches('[data-save-calendar]')){const result=await api('calendar',{dates:holidays.split(',').map(s=>s.trim()).filter(Boolean)});setup.holiday_dates=result.dates;holidayBaseline=result.dates.join(', ');if(holidayDraft===holidays)holidayDraft=holidayBaseline;notice='Reviewed holiday calendar saved. Existing proposals must be regenerated.';}
      else if(b.matches('[data-history-months]'))historicalMonths=await api('history-months');
      else if(b.matches('[data-prepare-history]')){const result=await api('teaching/history',{month:historyMonth});notice=`${result.prepared} historical references prepared, all unverified.`;teaching=await api('teaching');}
      else if(b.dataset.approveExample){await api(`teaching/${b.dataset.approveExample}/approve`,{historical_context_verified:historicalVerified});teaching=await api('teaching');}
      else if(b.dataset.rejectExample){await api(`teaching/${b.dataset.rejectExample}/reject`,{});teaching=await api('teaching');}
      else if(b.matches('[data-load-learning]'))versions=await api('learning');
      else if(b.matches('[data-propose-learning]')){await api('learning',{});versions=await api('learning');}
      else if(b.dataset.evaluate){await api(`learning/${b.dataset.evaluate}/evaluate`,{months:heldout.split(',').map(s=>s.trim()).filter(Boolean)});heldoutBaseline=heldout;versions=await api('learning');}
      else if(b.dataset.activate){await api(`learning/${b.dataset.activate}/activate`,{});versions=await api('learning');}
      else if(b.dataset.rollback){await api(`learning/${b.dataset.rollback}/rollback`,{});versions=await api('learning');}
      else if(b.matches('[data-ot-units]')) {
        if(!admin)throw Error('Administrator access is required for OT reference facts.');
        const units=await getUnits();
        if(closed || !dialog.open || !dialog.isConnected)return;
        otUnits=units.map(u=>({id:u.id,code:u.code,name:u.name}));otUnit=otUnits[0]?.id || '';otReference=null;includeOt=false;clearSuggestion();
        notice=otUnits.length?'Choose a unit and date, then refresh recorded demand.':'No units are available for OT reference selection.';
      }
      else if(b.matches('[data-ot-read]')) {
        includeOt=false;clearSuggestion();
        otReference=null;
        const unit=otUnit,day=otDay;
        if(!admin || !otUnits.some(u=>u.id===unit))throw Error('Select an authorized OT reference unit.');
        if(!/^\d{4}-\d{2}-\d{2}$/.test(day) || day.slice(0,7)!==month)throw Error('Select an OT reference date in the working month.');
        const value=await request<unknown>(`/api/v1/admin/ot-calendars/${encodeURIComponent(unit)}/assistant-reference?day=${encodeURIComponent(day)}`,{signal:AbortSignal.timeout(15000)});
        if(closed || !dialog.open || !dialog.isConnected || otUnit!==unit || otDay!==day)return;
        const parsed=otDemandReference(value,unit,day);
        if(!parsed)throw Error('The OT reference did not match the selected unit/date or supported format. Refresh the saved calendar.');
        otReference=parsed;notice='Recorded OT demand loaded. No model request or planning change was made.';
      }
      else if(b.matches('[data-ask]')) {
        suggestion=undefined;suggestionReference=null;suggestionSourceIssue='';
        const askedInstruction=instruction,askedScope=assistantScope();
        if(includeOt && (!admin || !otReference || !otUnits.some(u=>u.id===otUnit)))throw Error('Refresh and explicitly select an authorized OT reference first.');
        const contextPath=`assistant-context${includeOt?'/ot':''}?month=${encodeURIComponent(month)}&instruction=${encodeURIComponent(askedInstruction)}${includeOt?`&unit_id=${encodeURIComponent(otUnit)}&day=${encodeURIComponent(otDay)}`:''}`;
        const context=await api(contextPath);
        const reference=assistantReference(context);
        if(askedScope!==assistantScope() || instruction!==askedInstruction || !referenceInScope(reference))throw Error('The assistant reference versions or selected scope changed. Reload the current rules and try again.');
        if(closed || !dialog.open || !dialog.isConnected)return;
        let response:Response;
        if(!Number.isInteger(companionPort)||companionPort<1024||companionPort>65535)throw Error('Enter a valid local companion port between 1024 and 65535.');
        try {response=await fetch(`http://127.0.0.1:${companionPort}/suggest`,{method:'POST',headers:{'Content-Type':'application/json','X-Rota-Pairing':token},body:JSON.stringify({instruction:askedInstruction,context:JSON.stringify(context)}),signal:AbortSignal.timeout(95000)});}
        catch {throw Error('Could not reach the local assistant. Start the companion and allow this site local-network / loopback access in browser permissions. Regular generation remains available.');}
        const data=await response.json();if(!response.ok)throw Error(data.detail || 'Local assistant unavailable');
        if(askedScope!==assistantScope() || !enabled)throw Error('The instruction or selected reference changed. Ask for a new suggestion.');
        if(!data || !['balanced','repair','preferences'].includes(data.mode) || typeof data.explanation!=='string' || !Array.isArray(data.proposed_rules) || !data.proposed_rules.every((r:unknown)=>typeof r==='string') || (data.rule_changes!==undefined && (!Array.isArray(data.rule_changes) || !data.rule_changes.every((r:unknown)=>!!r && typeof r==='object' && typeof (r as {evidence?:unknown}).evidence==='string'))) || data.needs_review!==true)throw Error('The local assistant returned an unsupported suggestion. Regular planning remains available.');
        const current=assistantReference(await api(contextPath));
        if(closed || !dialog.open || !dialog.isConnected)return;
        if(askedScope!==assistantScope() || instruction!==askedInstruction)throw Error('The instruction or selected reference changed. Ask for a new suggestion.');
        suggestion=data;suggestionReference=reference;suggestionInstruction=askedInstruction;suggestionScope=askedScope;suggestionContextPath=contextPath;
        if(!sameAssistantReference(reference,current))suggestionSourceIssue='The reference rules, teaching evidence or selected OT demand changed while the assistant was working. Ask for a new suggestion.';
        notice=suggestionSourceIssue || 'Local suggestion received. Review its reference sources before using.';
      }
    });
  };
  dialog.onsubmit=event=>{const form=event.target as HTMLFormElement;if(!form.matches('[data-teaching-form]'))return;event.preventDefault();
    const data=Object.fromEntries(new FormData(form));if(!data.preferred_person_id)data.preferred_person_id=null as any;
    const submitted=JSON.stringify(Object.fromEntries(new FormData(form)));
    void action(async()=>{await api(`jobs/${job!.id}/examples`,data);const current=dialog.querySelector<HTMLFormElement>('[data-teaching-form]');if(JSON.stringify(current?Object.fromEntries(new FormData(current)):teachingDraft)===submitted)teachingDirty=false;notice='Teaching example saved for review.';teaching=await api('teaching');});};
  render();
}
