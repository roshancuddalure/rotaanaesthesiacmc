/** Native administrator OT calendar. Drafts never become allocation rules without review. */
import './ot-calendar.css';
import { ApiRequestError, getUnits, request, type UnitRead } from './services/api';
import { esc } from './ui';
import { formatAuditTimestamp } from './audit-time';
import { mountOtMonthCapacity } from './ot-month-capacity';
import { mountOtCalendarTransfer } from './ot-calendar-transfer';
import { OT_DAYS, OT_LEVELS, areaLabel, bandText, clockText, configurationKey, copyWeekday,
  dayLabel, levelLabel, type OtBand, type OtConfig, type OtException, type OtPreview,
  type OtSaved, type OtVersion, type OtWeekly } from './ot-calendar-model';

const API='/api/v1/admin/ot-calendars';
let dirtyReader=()=>false;
let savingReader=()=>false;
let disposeCurrent=()=>{};
export const otCalendarHasUnsavedChanges=()=>dirtyReader();
export const otCalendarIsSaving=()=>savingReader();
export function disposeOtCalendarPage(){disposeCurrent();disposeCurrent=()=>{};dirtyReader=()=>false;savingReader=()=>false;}

function summaryHtml(config:OtConfig|null):string {
  if(!config)return '<p>No reviewed calendar saved.</p>';
  return `${config.qualification_bindings?.length?`<h4>Reviewed qualification bindings</h4><ul>${config.qualification_bindings.map(binding=>`<li>${esc(binding.skill_key)}: ${binding.group_keys.map(key=>esc(areaLabel(key))).join(' or ')}</li>`).join('')}</ul>`:''}<p>${config.reserve_mode==='included'?'Existing reserve includes OT staffing.':'Existing reserve is additional to OT staffing.'}</p><ul>${config.weekly.map(row=>`<li><strong>${esc(dayLabel(row.weekday))} · ${esc(areaLabel(row.area_key))}</strong><br>${esc(row.effective_from)} to ${esc(row.effective_to??'ongoing')}<ul>${row.bands.map(b=>`<li>${esc(bandText(b))}</li>`).join('')}</ul></li>`).join('')}${config.exceptions.map(row=>`<li><strong>${esc(row.day)} · ${esc(areaLabel(row.area_key))}</strong>: ${row.closed?'Closed':row.bands.map(b=>esc(bandText(b))).join('; ')}</li>`).join('')}</ul>${!config.weekly.length&&!config.exceptions.length?'<p>No area definitions. Unspecified dates remain unknown.</p>':''}`;
}

export async function renderOtCalendar(host:HTMLElement):Promise<void> {
  disposeOtCalendarPage();
  let disposeMonth=()=>{};
  let disposeTransfer=()=>{};
  let alive=true,readSequence=0,editRevision=0,capacitySequence=0,saving=false,reviewing=false,formDirty=false;
  let units:UnitRead[]=[],unit='',day='SUN',saved:OtSaved|null=null,draft:OtConfig|null=null;
  let reserveChoice='',cleanReserve='',cleanKey='',note='',message='',remote:OtSaved|null=null,versions:OtVersion[]=[];
  let needsRead=false,groupsLoaded=false;
  let confirmedImportUnit='';
  let qualificationGroups:{key:string;name:string;call_level:string;active:boolean}[]=[];
  let editWeekly:{id:string;key:string}|null=null,editException:string|null=null,editExceptionRole:string|null=null;
  let preview:OtPreview|null=null,copy:OtConfig|null=null;
  const current=()=>alive&&host.isConnected;
  const dirty=()=>Boolean(formDirty||draft&&(configurationKey(draft)!==cleanKey||reserveChoice!==cleanReserve));
  dirtyReader=()=>current()&&dirty();savingReader=()=>current()&&saving;
  const unload=(event:BeforeUnloadEvent)=>{if(dirty()||saving){event.preventDefault();event.returnValue='';}};
  window.addEventListener('beforeunload',unload);
  const sessionChanged=()=>disposeOtCalendarPage();
  window.addEventListener('duty-rota:session-changed',sessionChanged);
  disposeCurrent=()=>{alive=false;readSequence++;disposeMonth();disposeTransfer();window.removeEventListener('beforeunload',unload);window.removeEventListener('duty-rota:session-changed',sessionChanged);host.querySelector('dialog')?.close();};
  const notify=(value:string)=>{message=value;const region=host.querySelector<HTMLElement>('[data-ot-message]');if(region)region.textContent=value;};
  const status=()=>{const region=host.querySelector('[data-ot-dirty]');if(region)region.textContent=saving?'Saving reviewed calendar…':dirty()?'Draft changes — not saved':'Saved calendar unchanged';};
  const confirmDiscard=()=>!formDirty||window.confirm('You have unfinished OT form entries. Discard those entries? Added draft schedules will stay.');
  const formValue=(data:FormData,name:string)=>String(data.get(name)??'').trim();
  const bandFields=(prefix:string,value?:OtBand)=>`<div class="ot-grid"><label>Role name<input name="role" required maxlength="80" value="${esc(value?.key??'')}"></label><label>Starts at<input name="start" type="time" required value="${value?clockText(value.start_minute):''}"></label><label>Ends at<input name="end" type="time" required value="${value?clockText(value.end_minute):''}"></label></div><label class="ot-check"><input type="checkbox" name="overnight" ${value&&value.end_minute>=1440?'checked':''}>Ends the following day</label><fieldset><legend>Eligible call levels — choose the approved pool</legend><div class="ot-levels">${OT_LEVELS.map(level=>`<label class="ot-check"><input type="checkbox" name="levels" value="${level}" ${value?.call_levels.includes(level)?'checked':''}>${levelLabel(level)}</label>`).join('')}</div></fieldset><div class="ot-grid"><label>Mandatory minimum<input name="minimum" type="number" min="0" max="128" step="1" required value="${value?.minimum??''}"></label><label>Preferred target<input name="target" type="number" min="0" max="128" step="1" required value="${value?.target??''}"></label><label>Required skill codes (optional)<input name="skills" maxlength="1000" value="${esc(value?.required_skills.join(', ')??'')}" aria-describedby="${prefix}-skills-help"></label></div><p id="${prefix}-skills-help" class="ot-muted">Use reviewed qualification codes separated by commas. A skill requirement must be explicitly satisfied; it does not expand the call-level pool.</p>`;
  function readBand(data:FormData):OtBand {
    const minute=(name:string)=>{const parts=formValue(data,name).split(':').map(Number);return parts.length===2&&parts.every(Number.isFinite)?parts[0]*60+parts[1]:NaN;};
    const start=minute('start'),end=minute('end')+(data.has('overnight')?1440:0);
    const minimum=Number(formValue(data,'minimum')),target=Number(formValue(data,'target'));
    const key=formValue(data,'role').replace(/\s+/g,'_');
    const levels=data.getAll('levels').map(String);
    if(!/^[a-zA-Z0-9_-]{1,80}$/.test(key))throw Error('Use a role name with letters, numbers, spaces, hyphens or underscores.');
    if(!levels.length)throw Error('Choose at least one eligible call level.');
    if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start||end-start>1440)throw Error('Choose an increasing time band lasting no more than 24 hours. Check “following day” for an overnight list.');
    if(!formValue(data,'minimum')||!formValue(data,'target')||!Number.isInteger(minimum)||!Number.isInteger(target)||minimum<0||target<minimum||target>128)throw Error('Enter whole-number counts from 0 to 128; the target must cover the minimum.');
    return {key,start_minute:start,end_minute:end,minimum,target,call_levels:levels,required_skills:[...new Set(formValue(data,'skills').split(',').map(v=>v.trim()).filter(Boolean))]};
  }
  function areaKey(data:FormData):string {
    const area=formValue(data,'area').replace(/\s+/g,'_');
    if(!/^[a-zA-Z0-9_-]{1,80}$/.test(area))throw Error('Use an OT area name with letters, numbers, spaces, hyphens or underscores.');
    return area;
  }
  function qualificationOptions():string {
    if(!draft)return '';
    const skills=[...new Set([...draft.weekly.flatMap(row=>row.bands.flatMap(band=>band.required_skills)),...draft.exceptions.flatMap(row=>row.bands.flatMap(band=>band.required_skills)),...(draft.qualification_bindings??[]).map(binding=>binding.skill_key)])].sort();
    if(!skills.length)return '<p>No skill codes are required by this draft. Add a reviewed skill code to a role before binding it.</p>';
    if(!groupsLoaded)return '<p>Load the canonical eligibility groups to review qualification bindings. Existing bindings are preserved until explicitly changed.</p>';
    return skills.map(skill=>`<fieldset><legend>${esc(skill)}</legend>${(draft!.qualification_bindings??[]).some(binding=>binding.skill_key===skill)?`<p>Current sources: ${(draft!.qualification_bindings??[]).find(binding=>binding.skill_key===skill)!.group_keys.map(key=>esc(areaLabel(key))).join(' or ')}</p><button type="button" data-ot="clear-qualification" data-skill="${esc(skill)}">Clear this skill binding</button>`:''}<div class="ot-levels">${qualificationGroups.filter(group=>group.active||(draft!.qualification_bindings??[]).some(binding=>binding.skill_key===skill&&binding.group_keys.includes(group.key))).map(group=>`<label class="ot-check"><input type="checkbox" data-ot-skill="${esc(skill)}" data-ot-group="${esc(group.key)}" ${(draft!.qualification_bindings??[]).some(binding=>binding.skill_key===skill&&binding.group_keys.includes(group.key))?'checked':''}>${esc(group.name)} (${esc(levelLabel(group.call_level))})${group.active?'':' - inactive; remove this binding'}</label>`).join('')||'<p>No active qualification source groups are available.</p>'}</div></fieldset>`).join('');
  }
  function draw(){
    disposeMonth();
    disposeTransfer();
    if(!current()||!saved||!draft)return;
    const row=editWeekly?draft.weekly.find(row=>row.id===editWeekly!.id):undefined;
    const band=row?.bands.find(b=>b.key===editWeekly?.key);
    const exception=editException?draft.exceptions.find(row=>row.id===editException):undefined;
    const exceptionBand=editExceptionRole===''?undefined:exception?.bands.find(b=>b.key===(editExceptionRole??exception.bands[0]?.key));
    host.innerHTML=`<div class="ot-page"><section class="panel"><div class="ot-toolbar"><div><p class="eyebrow">Admin tools</p><h2>Unit OT calendars</h2><p>Keep elective areas staffed when allocating duties. Missing dates are unknown, not automatically closed.</p></div><label>Unit<select data-ot-unit aria-label="Unit">${units.map(u=>`<option value="${esc(u.id)}" ${u.id===unit?'selected':''}>${esc(u.name)}</option>`).join('')}</select></label></div><div class="ot-counts"><div><strong>${draft.weekly.length}</strong>weekly area schedules</div><div><strong>${draft.exceptions.length}</strong>date exceptions</div><div><strong>${new Set(draft.weekly.map(r=>r.weekday)).size}/7</strong>weekdays defined</div></div></section>
      <div class="ot-message" data-ot-message role="alert">${esc(message)}</div><section class="panel"><h3>Staffing reserve</h3><label>How does the existing unit minimum relate to OT staffing?<select data-ot-reserve required><option value="">Choose the reviewed policy</option><option value="included" ${reserveChoice==='included'?'selected':''}>OT staffing is included within the existing reserve</option><option value="additional" ${reserveChoice==='additional'?'selected':''}>OT staffing is additional to the existing reserve</option></select></label><p class="ot-muted">Mandatory minima protect coverage. Preferred targets describe extra capacity to aim for. Selecting either option does not change saved rules until review and save.</p></section>
      <section class="panel"><h3>Weekly OT demand</h3><div class="ot-days" aria-label="Choose weekday">${OT_DAYS.map(d=>`<button type="button" data-ot="day" data-day="${d}" aria-pressed="${d===day}">${dayLabel(d)}</button>`).join('')}</div><div aria-live="polite"><h4>${dayLabel(day)}</h4>${draft.weekly.filter(r=>r.weekday===day).map(r=>`<article class="ot-area"><strong>${esc(areaLabel(r.area_key))}</strong><p class="ot-muted">${esc(r.effective_from)} to ${esc(r.effective_to??'ongoing')}</p>${r.bands.map(b=>`<div class="ot-band"><p>${esc(bandText(b))}</p><div class="ot-actions"><button type="button" data-ot="edit-weekly" data-id="${esc(r.id)}" data-key="${esc(b.key)}">Edit role</button><button type="button" data-ot="remove-weekly" data-id="${esc(r.id)}" data-key="${esc(b.key)}">Remove role</button></div></div>`).join('')}</article>`).join('')||'<p>No reviewed area schedule for this weekday. Add explicit demand or a dated closure as appropriate.</p>'}</div>
      <details ${editWeekly?'open':''}><summary>${editWeekly?'Edit area / role':'Add an area or staffing role'}</summary><form data-ot-form="weekly"><p class="ot-muted">Area and effective dates apply to the whole area schedule. Roles in the same area may have different call pools.</p><div class="ot-grid"><label>OT area<input name="area" required maxlength="80" value="${esc(row?.area_key??'')}"></label><label>Effective from<input name="from" type="date" required value="${esc(row?.effective_from??'')}"></label><label>Effective to (optional)<input name="to" type="date" value="${esc(row?.effective_to??'')}"></label></div>${bandFields('weekly',band)}<div class="ot-actions"><button type="submit">${editWeekly?'Update draft role':'Add role to draft'}</button><button type="button" data-ot="clear-form">Clear editor</button></div></form></details>
      <details><summary>Copy this weekday’s schedules</summary><p>Copy adds new draft schedules; existing destination schedules will not be overwritten.</p><label>Destination weekday<select data-ot-copy-day>${OT_DAYS.filter(d=>d!==day).map(d=>`<option value="${d}">${dayLabel(d)}</option>`).join('')}</select></label><button type="button" data-ot="copy">Preview copies</button></details></section>
      <section class="panel"><h3>Dated closures and replacement lists</h3><p>A dated exception replaces that area’s weekly definition for the date. Holidays require an explicit closure or replacement.</p>${draft.exceptions.map(r=>`<article class="ot-area"><strong>${esc(r.day)} · ${esc(areaLabel(r.area_key))}</strong><p>${r.closed?'Area closed':r.bands.map(b=>esc(bandText(b))).join('<br>')}</p>${!r.closed?r.bands.map(b=>`<button type="button" data-ot="edit-exception" data-id="${esc(r.id)}" data-key="${esc(b.key)}">Edit ${esc(areaLabel(b.key))} role</button>`).join(''):''}<div class="ot-actions">${!r.closed?`<button type="button" data-ot="edit-exception" data-id="${esc(r.id)}" data-key="">Add replacement role</button>`:''}<button type="button" data-ot="edit-exception" data-id="${esc(r.id)}">Edit exception</button><button type="button" data-ot="remove-exception" data-id="${esc(r.id)}">Remove exception</button></div></article>`).join('')||'<p>No dated exceptions.</p>'}<details ${exception?'open':''}><summary>${exception?(editExceptionRole===''?'Add a role to dated exception':'Edit dated exception'):'Add dated exception'}</summary><form data-ot-form="exception"><div class="ot-grid"><label>OT area<input name="area" required maxlength="80" value="${esc(exception?.area_key??'')}"></label><label>Date<input name="date" type="date" required value="${esc(exception?.day??'')}"></label><label>Action<select name="mode" aria-label="Action"><option value="closed" ${!exception||exception.closed?'selected':''}>Close this area</option><option value="replace" ${exception&&!exception.closed?'selected':''}>Replace staffing for this date</option></select></label></div><fieldset data-ot-replacement ${!exception||exception.closed?'disabled':''}><legend>Replacement staffing role</legend>${bandFields('exception',exceptionBand)}${exception&&!exception.closed?'<p>Other staffing roles on this exception are preserved. Area and date changes apply to the entire exception.</p>':''}</fieldset><button type="submit">${exception?(editExceptionRole===''?'Add role to dated exception':'Update draft exception'):'Add exception to draft'}</button></form></details></section>
      <section class="panel"><h3>Reviewed qualifications</h3><p>Explicitly bind each skill code to approved eligibility groups. Active dated membership in any selected group satisfies that skill; the OT call-level pool still applies. A group name alone never grants a skill.</p><button type="button" data-ot="qualification-groups">Load qualification source groups</button><div data-ot-qualifications>${qualificationOptions()}</div></section>
      <section class="panel"><h3>Check saved OT and reserve coverage</h3><p>Compare saved demand with dated postings, approved leave and duty/rest intervals. Unsaved edits are excluded.</p><form data-ot-form="capacity"><div class="ot-grid"><label>Date to check<input name="capacity_date" type="date" required></label></div><label class="ot-check"><input name="include_pending" type="checkbox">Stress-test pending leave as unavailable</label><button type="submit">Check saved capacity</button></form><div data-ot-capacity aria-live="polite"></div></section>
      <section class="panel"><h3>Saved history</h3><p>Changes remain attributable to the administrator and source version.</p><button type="button" data-ot="history">Load saved history</button><div data-ot-history></div></section>
      <section class="ot-sticky ot-toolbar" aria-label="Save OT calendar"><span data-ot-dirty role="status"></span><div class="ot-actions"><button type="button" data-ot="reset">Discard draft</button><button type="button" class="primary" data-ot="review">Review changes</button></div></section><section class="panel" data-ot-conflict ${remote?'':'hidden'}><h3>Saved calendar changed</h3><p>Your draft is preserved. Compare the saved calendar before choosing which version to use.</p><div data-ot-remote>${remote?summaryHtml(remote.configuration):''}</div><div class="ot-actions"><button type="button" data-ot="compare">Read latest saved version</button><button type="button" data-ot="use-saved" ${remote?'':'disabled'}>Use saved version</button><button type="button" data-ot="review-overwrite" ${remote?'':'disabled'}>Review replacing latest with my draft</button></div></section><dialog aria-labelledby="ot-dialog-title"></dialog></div>`;
    const monthPanel=document.createElement('section');monthPanel.className='panel';
    host.querySelector('.ot-page')?.append(monthPanel);
    disposeMonth=mountOtMonthCapacity(monthPanel,unit,saved?.revision??'');
    const transferPanel=document.createElement('section');transferPanel.className='panel';
    host.querySelector('.ot-page')?.append(transferPanel);
    disposeTransfer=mountOtCalendarTransfer(transferPanel,unit,saved?.revision??'',()=>!dirty()&&!saving,value=>{saving=value;if(value){confirmedImportUnit='';notify('');}status();},outcome=>{confirmedImportUnit=outcome==='confirmed'&&current()?unit:'';return loadUnit(unit);});
    status();
  }
  function showDialog(title:string,body:string){const dialog=host.querySelector<HTMLDialogElement>('dialog')!;dialog.innerHTML=`<h2 id="ot-dialog-title">${esc(title)}</h2>${body}`;dialog.oncancel=event=>{if(saving)event.preventDefault();};dialog.showModal();return dialog;}
  function closeDialog(){host.querySelector<HTMLDialogElement>('dialog')?.close();preview=null;copy=null;}
  function adopt(value:OtSaved){saved=value;draft=structuredClone(value.configuration??{schema_version:1,reserve_mode:'included',weekly:[],exceptions:[]});reserveChoice=value.configuration?.reserve_mode??'';cleanReserve=reserveChoice;cleanKey=configurationKey(draft);needsRead=false;formDirty=false;editWeekly=null;editException=null;editExceptionRole=null;remote=null;versions=[];groupsLoaded=false;qualificationGroups=[];}
  async function loadUnit(value:string){
    if(!current())return;
    if(confirmedImportUnit!==value)confirmedImportUnit='';
    const confirmed=confirmedImportUnit===value?'Reviewed monthly import saved.':'';
    const sequence=++readSequence;unit=value;host.innerHTML='<section class="panel" aria-busy="true"><p role="status">Loading OT calendar…</p></section>';
    try{const result=await request<OtSaved>(`${API}/${encodeURIComponent(value)}`);if(!current()||sequence!==readSequence)return;adopt(result);message=confirmed;draw();}
    catch(error){if(!current()||sequence!==readSequence)return;host.innerHTML=`<section class="panel"><h2>OT calendar unavailable</h2>${confirmed?`<p role="status">${esc(confirmed)}</p>`:''}<p role="alert">${esc(error instanceof Error?error.message:'Unable to load calendar.')}</p><p>The OT calendar could not be loaded. Choose Try again to load it, or ask your system administrator to check access and setup.</p><button type="button" data-ot="retry">Try again</button></section>`;}
  }
  async function readLatest(){
    const sequence=readSequence,requestedUnit=unit;notify('Reading the latest saved calendar; your draft is preserved.');
    try{const result=await request<OtSaved>(`${API}/${encodeURIComponent(unit)}`);if(!current()||sequence!==readSequence||unit!==requestedUnit)return;remote=result;needsRead=false;const section=host.querySelector<HTMLElement>('[data-ot-conflict]')!;section.hidden=false;section.querySelector('[data-ot-remote]')!.innerHTML=summaryHtml(result.configuration);section.querySelectorAll<HTMLButtonElement>('button').forEach(b=>b.disabled=false);notify('Latest saved calendar loaded below. Your draft has not been replaced.');}
    catch(error){if(current()&&sequence===readSequence)notify(`Could not read the saved calendar. Your draft remains: ${error instanceof Error?error.message:'try again'}`);}
  }
  async function review(base=saved?.revision,before?:OtConfig|null){
    if(!draft||!saved||!base)return;
    if(needsRead){notify('Read the latest saved calendar before reviewing another save. Your previous save outcome is still uncertain.');return;}
    if(formDirty){notify('Add or update your unfinished form entries before reviewing the calendar.');return;}
    if(!reserveChoice){notify('Choose the reviewed relationship between OT staffing and the existing reserve.');return;}
    if(reviewing)return;reviewing=true;
    const candidate=structuredClone(draft),sequence=readSequence,revision=editRevision;notify('Validating this draft for review…');
    try{const result=await request<OtPreview>(`${API}/${unit}/preview`,{method:'POST',body:JSON.stringify({base_revision:base,configuration:candidate}),signal:AbortSignal.timeout(15000)});if(!current()||sequence!==readSequence)return;if(revision!==editRevision){notify('The draft changed while validation was running. Review the updated draft again.');return;}preview=result;showDialog(before!==undefined?'Review replacing the latest saved calendar':'Review OT calendar changes',`<p>Only this unit’s OT demand changes. Review both versions before saving.</p><div class="ot-review-columns"><div><h3>Currently saved</h3>${summaryHtml(result.before)}</div><div><h3>Proposed</h3>${summaryHtml(result.proposed)}</div></div><form data-ot-form="save"><label>Change note (optional)<textarea name="note" maxlength="1000">${esc(note)}</textarea></label><label class="ot-check"><input type="checkbox" name="confirmed" required>I reviewed the areas, staffing counts, date exceptions and reserve policy.</label><div class="ot-actions"><button type="button" data-ot="close-dialog">Keep editing</button><button type="submit" class="primary">Save reviewed calendar</button></div><p data-ot-save-status role="status"></p></form>`);notify('');}
    catch(error){if(!current()||sequence!==readSequence)return;notify(error instanceof Error?error.message:'Draft validation failed.');if(error instanceof ApiRequestError&&error.status===409){host.querySelector<HTMLElement>('[data-ot-conflict]')!.hidden=false;}}
    finally{reviewing=false;}
  }
  async function saveReviewed(form:HTMLFormElement){
    if(!preview||saving)return;
    const submitted=structuredClone(preview),data=new FormData(form),sequence=readSequence,requestedUnit=unit;
    if(!data.has('confirmed'))return;note=formValue(data,'note');saving=true;status();
    const dialog=host.querySelector<HTMLDialogElement>('dialog')!;dialog.querySelectorAll<HTMLInputElement|HTMLButtonElement|HTMLTextAreaElement>('input,button,textarea').forEach(control=>control.disabled=true);
    const indicate=(value:string)=>{const target=dialog.querySelector('[data-ot-save-status]');if(target)target.textContent=value;};indicate('Saving reviewed calendar…');
    try{
      const result=await request<OtSaved>(`${API}/${requestedUnit}`,{method:'PUT',body:JSON.stringify({base_revision:submitted.base_revision,configuration:submitted.proposed,note}),signal:AbortSignal.timeout(30000)});
      if(!current()||sequence!==readSequence)return;closeDialog();adopt(result);message='Reviewed OT calendar saved.';draw();
    }catch(error){
      if(!current()||sequence!==readSequence)return;
      const uncertain=!(error instanceof ApiRequestError)||!error.status||error.status>=500;
      if(uncertain){
        needsRead=true;
        indicate('The save response is uncertain. Checking the saved record before any further action…');
        try{const actual=await request<OtSaved>(`${API}/${requestedUnit}`);if(!current()||sequence!==readSequence)return;
          if(configurationKey(actual.configuration)===configurationKey(submitted.proposed)){closeDialog();adopt(actual);message='The saved record confirms your reviewed calendar was saved.';draw();return;}
          remote=actual;needsRead=false;
        }catch{/* Keep draft and require an explicit read; never replay a mutation. */}
      }
      closeDialog();message=`${uncertain?'Save outcome not confirmed. Read the latest saved calendar before submitting again.':error instanceof Error?error.message:'Save refused.'} Your draft is preserved.`;draw();host.querySelector<HTMLElement>('[data-ot-conflict]')!.hidden=false;
    }finally{saving=false;if(current()){status();host.querySelector<HTMLButtonElement>('[data-ot="review"]')?.focus();}}
  }
  async function click(event:MouseEvent){
    const button=(event.target as HTMLElement).closest<HTMLButtonElement>('button[data-ot]');if(!button)return;event.preventDefault();event.stopPropagation();if(saving)return;
    const action=button.dataset.ot;editRevision++;
    try{
      if(action==='retry'){if(unit)await loadUnit(unit);else await start();return;}
      if(action==='close-dialog'){closeDialog();return;}
      if(!draft||!saved)return;
      if(action==='day'){if(!confirmDiscard())return;day=button.dataset.day!;formDirty=false;editWeekly=null;editException=null;draw();host.querySelector<HTMLButtonElement>(`[data-ot="day"][data-day="${day}"]`)?.focus();}
      if(action==='clear-form'){if(!confirmDiscard())return;formDirty=false;editWeekly=null;editException=null;draw();}
      if(action==='edit-weekly'){if(!confirmDiscard())return;editWeekly={id:button.dataset.id!,key:button.dataset.key!};editException=null;formDirty=false;draw();host.querySelector<HTMLInputElement>('form[data-ot-form="weekly"] input[name="area"]')?.focus();}
      if(action==='remove-weekly'){if(!confirmDiscard())return;draft.weekly=draft.weekly.flatMap(row=>row.id!==button.dataset.id?[row]:row.bands.length===1?[]:[{...row,bands:row.bands.filter(b=>b.key!==button.dataset.key)}]);formDirty=false;editWeekly=null;draw();}
      if(action==='edit-exception'){if(!confirmDiscard())return;editException=button.dataset.id!;editExceptionRole=button.dataset.key??null;editWeekly=null;formDirty=false;draw();host.querySelector<HTMLInputElement>('form[data-ot-form="exception"] input[name="area"]')?.focus();}
      if(action==='remove-exception'){if(!confirmDiscard())return;draft.exceptions=draft.exceptions.filter(row=>row.id!==button.dataset.id);formDirty=false;editException=null;draw();}
      if(action==='reset'&&window.confirm('Discard this unit’s unsaved OT draft and unfinished form entries?')){adopt(saved);message='Draft discarded; saved configuration retained.';draw();}
      if(action==='review')await review();
      if(action==='compare')await readLatest();
      if(action==='use-saved'&&remote&&window.confirm('Replace your unsaved OT draft with the latest saved calendar?')){adopt(remote);message='Latest saved calendar loaded.';draw();}
      if(action==='review-overwrite'&&remote){if(!confirmDiscard())return;formDirty=false;await review(remote.revision,remote.configuration);}
      if(action==='copy'){if(!confirmDiscard())return;const destination=host.querySelector<HTMLSelectElement>('[data-ot-copy-day]')!.value;copy=copyWeekday(draft,day,destination);showDialog('Review weekday copies',`<p>Add ${draft.weekly.filter(row=>row.weekday===day).length} area schedules from ${esc(dayLabel(day))} to ${esc(dayLabel(destination))} in this unit’s draft. Existing destination schedules are preserved. Nothing is saved yet.</p><div class="ot-actions"><button type="button" data-ot="close-dialog">Cancel</button><button type="button" data-ot="apply-copy">Add copies to draft</button></div>`);}
      if(action==='apply-copy'&&copy){draft=copy;formDirty=false;closeDialog();message='Weekday copies added to draft. Review and save to activate them.';draw();}
      if(action==='clear-qualification'){draft.qualification_bindings=(draft.qualification_bindings??[]).filter(binding=>binding.skill_key!==button.dataset.skill);host.querySelector<HTMLElement>('[data-ot-qualifications]')!.innerHTML=qualificationOptions();status();notify('Binding removed from the draft. Choose a reviewed source before claiming skill-dependent coverage.');}
      if(action==='qualification-groups'){
        const sequence=readSequence,region=host.querySelector<HTMLElement>('[data-ot-qualifications]')!;region.textContent='Reading canonical groups...';
        try{const groups=await request<typeof qualificationGroups>('/api/v1/admin/call-clusters');if(!current()||sequence!==readSequence)return;qualificationGroups=groups;groupsLoaded=true;if(region.isConnected)region.innerHTML=qualificationOptions();}
        catch(error){if(current()&&sequence===readSequence&&region.isConnected)region.textContent=`Groups unavailable; existing bindings remain unchanged: ${error instanceof Error?error.message:'try again'}`;}
      }
      if(action==='history'){
        const sequence=readSequence,region=host.querySelector<HTMLElement>('[data-ot-history]')!;region.textContent='Reading saved history…';
        try{const result=await request<{versions:OtVersion[]}>(`${API}/${unit}/versions`);if(!current()||sequence!==readSequence)return;versions=result.versions;region.innerHTML=`<ul class="ot-history">${versions.map((v,i)=>`<li>${esc(formatAuditTimestamp(v.saved_at))} · ${esc(v.saved_by)}<p>${esc(v.note||'No change note')}</p><button type="button" data-ot="inspect-history" data-index="${i}">Inspect saved version</button></li>`).join('')}</ul>${!versions.length?'<p>No saved versions yet.</p>':''}`;}
        catch(error){if(current()&&sequence===readSequence)region.textContent=`History unavailable: ${error instanceof Error?error.message:'try again'}`;}
      }
      if(action==='inspect-history'){const version=versions[Number(button.dataset.index)];if(version)showDialog('Saved OT calendar',`${summaryHtml(version.configuration)}<button type="button" data-ot="close-dialog">Close</button>`);}
    }catch(error){notify(error instanceof Error?error.message:'Action could not complete.');}
  }
  async function checkCapacity(form:HTMLFormElement){
    const data=new FormData(form),date=formValue(data,'capacity_date'),pending=data.has('include_pending');
    if(!date)return;const sequence=readSequence,capacityTicket=++capacitySequence,region=host.querySelector<HTMLElement>('[data-ot-capacity]')!;
    region.textContent='Reading saved staffing demand and availability...';
    try{
      const result=await request<{revision:string;status:string;pending_stress:boolean;scope_note:string;reserve_evaluated:boolean;counts?:Record<string,number>;warnings:(string|{code:string})[];capacity:null|{reserves?:{call_levels:string[];minimum:number;minimum_shortage:number;mode:string}[];mandatory_required:number;mandatory_covered:number;requirements:{area_key:string;band_key:string;minimum_shortage:number;target_shortage:number;eligible_person_ids:string[]}[]}}>(`${API}/${unit}/capacity?day=${encodeURIComponent(date)}&include_pending=${pending}`);
      if(!current()||sequence!==readSequence||capacityTicket!==capacitySequence||!region.isConnected)return;
      const labels:Record<string,string>={feasible:'Mandatory OT roles can be covered',infeasible:'Mandatory OT role shortage',closed:'Reviewed OT closure',partially_configured:'Some OT areas lack reviewed demand for this date',not_evaluated:'Coverage not evaluated',time_limited:'Search time limit reached; coverage unresolved'};
      const warnings:Record<string,string>={ot_call_context_unresolved:'A dated call-level context is ambiguous. Review dated postings and call history.',ot_qualification_sources_unavailable:'Some qualification source groups are missing or inactive. Review the saved bindings.',ot_unknown_leave_slot:'An unknown leave slot was conservatively treated as full-day absence.',ot_qualifications_unconfigured:'Required skills have not been mapped to verified member qualifications. Coverage is not confirmed.'};
      const title=result.reserve_evaluated?(result.status==='feasible'?'OT roles and configured reserves can be covered':result.status==='infeasible'?'OT or staffing reserve shortage':labels[result.status]):labels[result.status];
      region.innerHTML=`<h4>${esc(title??result.status)}</h4><p>Saved OT demand on ${esc(date)}.</p><p>${result.pending_stress?'Pending-leave stress scenario.':'Approved-leave scenario; pending requests are reported separately.'} ${esc(result.scope_note)}</p>${result.revision!==saved?.revision?'<p>The saved calendar changed after this editor loaded. Results use that newer saved version; your draft is preserved.</p>':''}${result.counts?`<div class="ot-counts">${[['posted_people','Dated posted members'],['compatible_available_people','Compatible and available'],['approved_leave_people','With approved leave'],['pending_leave_people','With pending leave'],['duty_or_rest_people','On duty or post-duty rest']].map(([key,label])=>`<div><strong>${result.counts![key]??0}</strong>${label}</div>`).join('')}</div><p class="ot-muted">Leave and rest counts may overlap. A person contributes only once to simultaneous staffing capacity.</p>`:''}${result.capacity?`<p>${result.capacity.mandatory_covered} of ${result.capacity.mandatory_required} mandatory OT positions covered.</p><ul>${result.capacity.requirements.map(row=>`<li>${esc(areaLabel(row.area_key))} / ${esc(areaLabel(row.band_key))}: mandatory shortage ${row.minimum_shortage}, target shortage ${row.target_shortage}; ${row.eligible_person_ids.length} compatible available members.</li>`).join('')}</ul>${result.reserve_evaluated?`<h4>Configured pool reserves</h4><ul>${(result.capacity.reserves??[]).map(row=>`<li>${row.call_levels.map(level=>esc(levelLabel(level))).join(' / ')}: minimum ${row.minimum}, worst interval shortage ${row.minimum_shortage}; ${row.mode==='included'?'OT staff may count toward this reserve':'reserve staff are additional to OT'}.</li>`).join('')}</ul><p class="ot-muted">Overlapping reserve counts within one unit are not blindly added together.</p>`:''}`:''}${result.warnings.length?`<ul>${result.warnings.map(w=>`<li>${esc(typeof w==='string'?w:warnings[w.code]??w.code)}</li>`).join('')}</ul>`:''}`;
    }catch(error){if(current()&&sequence===readSequence&&capacityTicket===capacitySequence&&region.isConnected)region.textContent=`Capacity could not be checked: ${error instanceof Error?error.message:'try again'}`;}
  }
  async function submit(event:SubmitEvent){
    const form=event.target as HTMLFormElement,kind=form.dataset.otForm;if(!kind)return;event.preventDefault();event.stopPropagation();if(saving)return;
    if(kind==='save'){await saveReviewed(form);return;}
    if(kind==='capacity'){await checkCapacity(form);return;}
    if(!draft)return;
    try{
      const data=new FormData(form),area=areaKey(data);
      if(kind==='weekly'){
        const b=readBand(data),from=formValue(data,'from'),to=formValue(data,'to')||null;
        if(!from||to&&to<from)throw Error('Choose an effective start date and an end date on or after it.');
        const existing=editWeekly?draft.weekly.find(row=>row.id===editWeekly!.id):draft.weekly.find(row=>row.area_key===area&&row.weekday===day&&row.effective_from===from&&row.effective_to===to);
        if(existing?.bands.some(value=>value.key===b.key&&value.key!==editWeekly?.key))throw Error('That role already exists in this area schedule. Edit its role instead.');
        const bands=existing?existing.bands.filter(value=>value.key!==editWeekly?.key):[];
        const record:OtWeekly={id:existing?.id??crypto.randomUUID(),unit_id:unit,area_key:area,weekday:day,effective_from:from,effective_to:to,bands:[...bands,b],source_reference:'admin'};
        draft.weekly=[...draft.weekly.filter(row=>row.id!==record.id),record];editWeekly=null;
      }else{
        const date=formValue(data,'date'),closed=formValue(data,'mode')==='closed';if(!date)throw Error('Choose the exception date.');
        const existing=editException?draft.exceptions.find(row=>row.id===editException):undefined;
        if(draft.exceptions.some(row=>row.area_key===area&&row.day===date&&row.id!==existing?.id))throw Error('An exception already exists for this area/date. Edit that exception explicitly.');
        const replacement=closed?null:readBand(data),previousKey=editExceptionRole??existing?.bands[0]?.key;
        if(replacement&&existing?.bands.some(b=>b.key===replacement.key&&(editExceptionRole===''||b.key!==previousKey)))throw Error('That replacement role already exists. Edit its role explicitly.');
        const bands=closed?[]:[...(existing?.bands.filter(b=>editExceptionRole===''||b.key!==previousKey)??[]),replacement!];
        const record:OtException={id:existing?.id??crypto.randomUUID(),unit_id:unit,area_key:area,day:date,closed,bands,source_reference:'admin'};
        draft.exceptions=[...draft.exceptions.filter(row=>row.id!==record.id),record];editException=null;
      }
      editRevision++;formDirty=false;message='Changes added to the draft. Review before saving.';draw();host.querySelector<HTMLButtonElement>('[data-ot="review"]')?.focus();
    }catch(error){notify(error instanceof Error?error.message:'Check the form entries.');}
  }
  function input(event:Event){
    const target=event.target as HTMLInputElement|HTMLSelectElement;
    if(target.matches('[data-ot-skill]')&&draft){
      const skill=target.dataset.otSkill!;
      const selected=[...host.querySelectorAll<HTMLInputElement>('input[data-ot-skill]')].filter(input=>input.dataset.otSkill===skill&&input.checked).map(input=>input.dataset.otGroup!);
      draft.qualification_bindings=[...(draft.qualification_bindings??[]).filter(binding=>binding.skill_key!==skill),...(selected.length?[{skill_key:skill,group_keys:selected}]:[])];editRevision++;
    }
    if(target.closest('form[data-ot-form="weekly"], form[data-ot-form="exception"]')){formDirty=true;editRevision++;}
    if(target.matches('[data-ot-reserve]')&&draft){editRevision++;reserveChoice=target.value;if(reserveChoice)draft.reserve_mode=reserveChoice as OtConfig['reserve_mode'];}
    if(target.name==='mode')target.closest('form')!.querySelector<HTMLFieldSetElement>('[data-ot-replacement]')!.disabled=target.value==='closed';
    status();
  }
  async function change(event:Event){const target=event.target as HTMLSelectElement;if(!target.matches('[data-ot-unit]'))return;if(saving||dirty()&&!window.confirm('Changing unit will discard this unit’s unsaved OT draft. Continue?')){target.value=unit;return;}await loadUnit(target.value);}
  host.addEventListener('click',click);host.addEventListener('submit',submit);host.addEventListener('input',input);host.addEventListener('change',input);host.addEventListener('change',change);
  const priorDispose=disposeCurrent;disposeCurrent=()=>{priorDispose();host.removeEventListener('click',click);host.removeEventListener('submit',submit);host.removeEventListener('input',input);host.removeEventListener('change',input);host.removeEventListener('change',change);};
  async function start(){host.innerHTML='<section class="panel" aria-busy="true"><p role="status">Loading units…</p></section>';try{units=await getUnits();if(!current())return;if(!units.length){host.innerHTML='<section class="panel"><h2>Unit OT calendars</h2><p>No active units are available. Add units in Unit Management first.</p></section>';return;}await loadUnit(units[0].id);}catch(error){if(current())host.innerHTML=`<section class="panel"><h2>Units unavailable</h2><p role="alert">${esc(error instanceof Error?error.message:'Unable to load units.')}</p><button type="button" data-ot="retry">Try again</button></section>`;}}
  await start();
}
