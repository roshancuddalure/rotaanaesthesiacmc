/** Saved monthly unit capacity: each number refers to one interval and a witness. */
import {request} from './services/api';
import {esc} from './ui';

type Interval={starts_at:string;ends_at:string;posted_person_ids:string[];available_person_ids:string[];unavailable_person_ids:string[];reserved_person_ids:string[]|null;unreserved_person_ids:string[]|null;ot_required:number|null};
type Day={day:string;status:string;configured:boolean;missing_areas:string[];intervals:Interval[];requirements:{area_key:string;band_key:string;minimum:number;target:number}[]};
type Fact={code:string;person_id:string;source_id:string;blocking:boolean;starts_at?:string;ends_at?:string;intervals?:{starts_at:string;ends_at:string}[]};
type Month={unit_id:string;month:string;revision:string;pending_stress:boolean;scope_note:string;people:Record<string,string>;days:Day[];facts:Fact[];warnings:{code:string}[]};
const labels:Record<string,string>={feasible:'Covered',infeasible:'Shortage',closed:'Closed',time_limited:'Unproven',not_evaluated:'Unknown'};
const time=(s:string)=>s.slice(11,16);

export function mountOtMonthCapacity(host:HTMLElement,unit:string,revision:string):()=>void {
 host.dataset.otMonthPanel='';
 let alive=true,ticket=0,result:Month|null=null;
 const initial=localStorage.getItem('duty_rota_working_month')??new Date().toISOString().slice(0,7);
 host.innerHTML=`<h3>Monthly OT capacity</h3><p>Saved calendar and dated availability. Your unsaved calendar edits are excluded.</p><form data-month-form><div class="ot-grid"><label>Capacity month<input name="month" type="month" required value="${esc(initial)}"></label></div><label class="ot-check"><input name="stress" type="checkbox">Stress-test pending leave as unavailable</label><button type="submit">Load monthly capacity</button></form><p data-month-message role="status" aria-live="polite"></p><div data-month-result></div>`;
 const form=host.querySelector<HTMLFormElement>('form')!,message=host.querySelector<HTMLElement>('[data-month-message]')!,region=host.querySelector<HTMLElement>('[data-month-result]')!;
 function current(n:number){return alive&&n===ticket&&host.isConnected;}
 function detail(day:Day,index:number){
  if(!result)return;
  const interval=day.intervals[index];if(!interval)return;
  const fields:[string,string[]|null][]=[['Posted',interval.posted_person_ids],['Available',interval.available_person_ids],['Unavailable',interval.unavailable_person_ids],['Witness reserved',interval.reserved_person_ids],['Unreserved',interval.unreserved_person_ids]];
  const target=region.querySelector<HTMLElement>('[data-month-detail]')!;
  target.innerHTML=`<h4 tabindex="-1">${esc(day.day)} · ${esc(labels[day.status]??day.status)}</h4><label>Interval<select data-month-interval>${day.intervals.map((r,i)=>`<option value="${i}" ${i===index?'selected':''}>${esc(time(r.starts_at))}–${esc(time(r.ends_at))}${r.ends_at.slice(0,10)!==day.day?' next day':''}</option>`).join('')}</select></label><p>OT mandatory roles in this interval: <strong>${interval.ot_required??'Unknown'}</strong>. Counts below refer only to this interval.</p><div class="ot-counts">${fields.map(([label,ids])=>`<div><strong>${ids?.length??'Unknown'}</strong>${label}</div>`).join('')}</div><p class="ot-muted">Witness reservations are one feasible or partial diagnostic staffing selection, not saved allocations. Unreserved people still require normal duty eligibility and rest checks.</p>${day.missing_areas.length?`<p>Missing reviewed areas: ${day.missing_areas.map(esc).join(', ')}</p>`:''}<details><summary>Role requirements</summary><ul>${day.requirements.map(r=>`<li>${esc(r.area_key)} / ${esc(r.band_key)}: minimum ${r.minimum}, target ${r.target}</li>`).join('')||'<li>No role bands recorded for this date. Check the configured status above.</li>'}</ul></details>${fields.map(([label,ids])=>`<details><summary>${label} people (${ids?.length??'unknown'})</summary>${ids===null?'<p>No reservation proof is available.</p>':`<ul>${ids.map(id=>{
    const facts=result!.facts.filter(f=>f.person_id===id&&(f.intervals??(f.starts_at&&f.ends_at?[{starts_at:f.starts_at,ends_at:f.ends_at}]:[])).some(span=>span.starts_at<interval.ends_at&&span.ends_at>interval.starts_at));
    return `<li>${esc(result!.people[id]??id)}${facts.length?`<ul>${facts.map(f=>`<li>${esc(f.code.replace(/_/g,' '))} · ${f.blocking?'blocking':'reported only'} · source ${esc(f.source_id)}</li>`).join('')}</ul>`:''}</li>`;
   }).join('')||'<li>None</li>'}</ul>`}</details>`).join('')}`;
  target.querySelector('select')!.onchange=e=>detail(day,Number((e.target as HTMLSelectElement).value));
  target.insertAdjacentHTML('beforeend','<section><h5>Actual duty eligibility</h5><p>Check normal assignment eligibility for saved unfilled duties on this date. Reservation headcounts alone do not determine this count.</p><button type="button" data-check-duty>Check duty-eligible people</button><div data-duty-result aria-live="polite"></div></section>');
  const dutyResult=target.querySelector<HTMLElement>('[data-duty-result]')!,button=target.querySelector<HTMLButtonElement>('[data-check-duty]')!,n=ticket,stress=result.pending_stress;
  button.onclick=async()=>{
   button.disabled=true;dutyResult.textContent='Checking saved duties…';
   try{
    const data=await request<{unit_id:string;day:string;status:string;reason?:string;scope_note:string;duties:{slot_id:string;duty_type:string;label:string;status:string;reason?:string;eligible_count:number|null;eligible_people:{person_id:string;name:string}[];blocked_people:{name:string;issues:{code:string;message:string}[]}[]}[]}>(`/api/v1/admin/ot-calendars/${encodeURIComponent(unit)}/duty-capacity?day=${encodeURIComponent(day.day)}&include_pending=${stress}`);
    if(!current(n)||!dutyResult.isConnected)return;
    if(data.unit_id!==unit||data.day!==day.day)throw Error('Duty response did not match the selected date.');
    dutyResult.innerHTML=`<p>${esc(data.scope_note)}</p>${data.reason?`<p>${esc(data.reason)}</p>`:''}${data.duties.map(d=>`<article><h6>${esc(d.label)} · ${esc(d.duty_type)}</h6><p>Duty-eligible people: <strong>${d.eligible_count??'Not evaluated'}</strong>${d.reason?` · ${esc(d.reason)}`:''}</p><ul>${d.eligible_people.map(p=>`<li>${esc(p.name)}</li>`).join('')}</ul><details><summary>Other checked people (${d.blocked_people.length})</summary><ul>${d.blocked_people.map(p=>`<li>${esc(p.name)}<ul>${p.issues.map(i=>`<li>${esc(i.message??i.code)}</li>`).join('')}</ul></li>`).join('')}</ul></details></article>`).join('')}`;
   }catch(error){if(current(n)&&dutyResult.isConnected)dutyResult.textContent=`Duty check unavailable: ${error instanceof Error?error.message:'Retry'}`;}
   finally{if(current(n)&&button.isConnected)button.disabled=false;}
  };
 }
 function paint(){
  if(!result)return;
  const data=result;
  region.innerHTML=`<p>${data.pending_stress?'Pending-leave stress scenario.':'Approved-leave scenario; pending requests reported separately.'}</p><p>${esc(data.scope_note)}</p>${data.revision!==revision?'<p role="status">The saved calendar changed after this editor loaded. These results use the newer saved calendar; your draft is preserved.</p>':''}${data.warnings.length?`<ul>${data.warnings.map(w=>`<li>${esc(w.code.replace(/_/g,' '))}</li>`).join('')}</ul>`:''}<p>Choose a date for interval counts and person/source details. Colours always have text labels.</p><div class="ot-month-days">${data.days.map(day=>`<button type="button" data-month-day="${esc(day.day)}" data-capacity-status="${esc(day.status)}" aria-label="${esc(day.day)}: ${esc(labels[day.status]??day.status)}"><strong>${esc(day.day.slice(8))}</strong><span>${esc(labels[day.status]??day.status)}</span></button>`).join('')}</div><section data-month-detail aria-live="polite"></section>`;
  region.querySelectorAll<HTMLButtonElement>('[data-month-day]').forEach(button=>button.onclick=()=>{
   region.querySelectorAll('[data-month-day]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));
   const day=data.days.find(d=>d.day===button.dataset.monthDay)!;
   const peak=Math.max(...day.intervals.map(i=>i.ot_required??0));
   detail(day,Math.max(0,day.intervals.findIndex(i=>(i.ot_required??0)===peak)));
   region.querySelector<HTMLElement>('[data-month-detail] h4')?.focus();
  });
 }
 async function load(event:SubmitEvent){
  event.preventDefault();event.stopPropagation();const n=++ticket,values=new FormData(form),month=String(values.get('month')??''),stress=values.has('stress');
  result=null;region.innerHTML='';message.textContent='Loading monthly capacity…';region.setAttribute('aria-busy','true');
  try{
   const data=await request<Month>(`/api/v1/admin/ot-calendars/${encodeURIComponent(unit)}/month-capacity?month=${encodeURIComponent(month)}&include_pending=${stress}`);
   if(!current(n))return;
   if(data.unit_id!==unit||data.month!==month||data.pending_stress!==stress||!Array.isArray(data.days))throw Error('Capacity response did not match the requested unit, month and scenario.');
   result=data;paint();message.textContent='Monthly capacity loaded.';
  }catch(error){if(current(n)){region.innerHTML='';message.textContent=`Monthly capacity unavailable: ${error instanceof Error?error.message:'Try again'}. Submit again to retry.`;}}
  finally{if(current(n))region.removeAttribute('aria-busy');}
 }
 function invalidate(){ticket++;result=null;region.innerHTML='';region.removeAttribute('aria-busy');message.textContent='Scenario changed. Load monthly capacity to refresh.';}
 form.addEventListener('submit',load);form.addEventListener('input',invalidate);form.addEventListener('change',invalidate);
 return ()=>{alive=false;ticket++;form.removeEventListener('submit',load);form.removeEventListener('input',invalidate);form.removeEventListener('change',invalidate);};
}
