/** Canonical evidence presentation. Unknown coverage is never rendered as zero. */
export const esc = (value: unknown) => String(value ?? '').replace(/[&<>"']/g,
  c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]!);
export const object = (value:unknown):value is Record<string,unknown> => !!value && typeof value==='object' && !Array.isArray(value);
export const integer = (value:unknown):value is number => Number.isSafeInteger(value) && Number(value)>=0;
export const id = (value:unknown):value is string => typeof value==='string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
export const digest = (value:unknown):value is string => typeof value==='string' && /^[a-f0-9]{64}$/.test(value);
export type DutyImpact = {id:string;slot_id:string;person_id:string;person_name:string;date:string;duty:string;
  month:string;period_status:string;protected_period:boolean;requires_authorized_resolution:boolean;
  reviewed_repair_candidate:boolean;reasons:string[]};
export function dutyImpacts(value:unknown,allowOt=false):DutyImpact[] {
  if(!Array.isArray(value)||value.length>2000||!value.every(row=>object(row)&&id(row.id)&&id(row.slot_id)
    &&id(row.person_id)&&typeof row.person_name==='string'&&typeof row.duty==='string'
    &&typeof row.date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(row.date)
    &&typeof row.month==='string'&&/^\d{4}-(0[1-9]|1[0-2])$/.test(row.month)&&typeof row.period_status==='string'
    &&typeof row.protected_period==='boolean'&&typeof row.requires_authorized_resolution==='boolean'
    &&typeof row.reviewed_repair_candidate==='boolean'&&Array.isArray(row.reasons)&&row.reasons.length>0
    &&row.reasons.every(reason=>['duty_date_policy_overlap','physical_interval_overlap',...(allowOt?['ot_reservation_component']:[])].includes(String(reason)))
    &&(!row.protected_period||row.requires_authorized_resolution&&!row.reviewed_repair_candidate)))
    throw new Error('Duty impact evidence was incomplete. Refresh the review before continuing.');
  if(new Set(value.map(row=>row.id)).size!==value.length)throw new Error('Duty impact evidence repeated an assignment. Refresh the review.');
  return value as DutyImpact[];
}
export function renderDutyImpact(row:DutyImpact):string {
  return `<strong>${esc(row.person_name)}</strong>: ${esc(row.date)} - ${esc(row.duty)}
    <p>${esc(row.month)} · ${esc(row.period_status)}. ${row.protected_period
      ? 'Protected period: an authorized administrator must arrange resolution.'
      : row.requires_authorized_resolution ? 'Requires authorized resolution outside the scoped repair workflow.'
      : 'Possible draft repair; current locks and full feasibility must still pass.'}</p>
    <small>${row.reasons.includes('duty_date_policy_overlap')?'Existing duty policy overlap. ':''}${row.reasons.includes('physical_interval_overlap')?'Actual time overlap, including overnight intervals.':''}${row.reasons.includes('ot_reservation_component')?'Duty or rest consumes a possible person in a deficient OT/staffing component touched by selected leave. A replacement still needs joint validation.':''}</small>`;
}
type Coverage = {status:'feasible'|'infeasible'|'not_evaluated';code?:string;reasons:string[];
  mandatory_required:number|null;mandatory_covered:number|null;requirements:{minimum_shortage:number}[];reserves:{minimum_shortage:number}[]};
type MonthImpact = {month:string;changed:boolean|null;before:Coverage;after:Coverage};
type OtImpact = {status:'disabled'|'evaluated'|'not_evaluated';basis:string;months:MonthImpact[];context_digest:string|null};
function coverage(value:unknown):value is Coverage {
  return object(value)&&['feasible','infeasible','not_evaluated'].includes(String(value.status))
    &&Array.isArray(value.reasons)&&value.reasons.every(row=>typeof row==='string')
    &&((integer(value.mandatory_required)&&integer(value.mandatory_covered)&&value.mandatory_covered<=value.mandatory_required)
      ||value.mandatory_required===null&&value.mandatory_covered===null)
    &&Array.isArray(value.requirements)&&value.requirements.length<=5000
    &&value.requirements.every(row=>object(row)&&integer(row.minimum_shortage))
    &&Array.isArray(value.reserves)&&value.reserves.length<=5000
    &&value.reserves.every(row=>object(row)&&integer(row.minimum_shortage));
}
export function otImpact(value:unknown):OtImpact {
  if(!object(value)||!['disabled','evaluated','not_evaluated'].includes(String(value.status))
    ||typeof value.basis!=='string'||!Array.isArray(value.months)||value.months.length>4
    ||!(value.status==='disabled'?value.context_digest===null&&value.months.length===0:digest(value.context_digest))
    ||!value.months.every(row=>object(row)&&typeof row.month==='string'&&/^\d{4}-(0[1-9]|1[0-2])$/.test(row.month)
      &&(typeof row.changed==='boolean'||row.changed===null)&&coverage(row.before)&&coverage(row.after)
      &&(value.status!=='evaluated'||row.changed!==null&&row.before.status!=='not_evaluated'&&row.after.status!=='not_evaluated')))
    throw new Error('OT impact evidence was incomplete. Refresh the review before continuing.');
  return value as unknown as OtImpact;
}
function renderCoverage(value:Coverage,label:string):string {
  const known=value.status!=='not_evaluated'&&value.mandatory_required!==null&&value.mandatory_covered!==null;
  return `<div><strong>${esc(label)}: ${value.status==='not_evaluated'?'Unknown':value.status==='feasible'?'Feasible':'Shortage'}</strong>
    ${known?`<p>${value.mandatory_covered} / ${value.mandatory_required} mandatory role-band slots covered</p>
      <meter min="0" max="${Math.max(1,value.mandatory_required!)}" low="${value.mandatory_required}" high="${value.mandatory_required}" optimum="${value.mandatory_required}" value="${value.mandatory_covered}" aria-label="${esc(label)} mandatory role-band coverage">${value.mandatory_covered} / ${value.mandatory_required}</meter>
      <p>${value.reserves.filter(row=>row.minimum_shortage>0).length} reserve rules with shortage.</p>`
      :`<p>${value.code==='ot_reviewed_zero'?'Reviewed zero demand.':'Coverage counts unavailable; no zero has been assumed.'}</p>`}
    ${value.reasons.length?`<ul>${value.reasons.slice(0,8).map(reason=>`<li>${esc(reason)}</li>`).join('')}</ul>${value.reasons.length>8?'<p>Additional unresolved inputs remain. Review OT configuration.</p>':''}`:''}</div>`;
}
export function renderOtImpact(value:OtImpact,before='Before approval',after='After proposed approval'):string {
  return `<section data-leave-ot-impact><h3>OT and staffing impact</h3><p>${esc(value.basis)}</p>
    ${value.status==='disabled'?'<p>OT impact was not evaluated because OT integration is disabled.</p>':''}
    ${value.status==='not_evaluated'?'<p>Some OT impact is unknown. This review does not certify adequate coverage.</p>':''}
    ${value.months.map(row=>`<article class="panel"><h4>${esc(row.month)}</h4>${renderCoverage(row.before,before)}${renderCoverage(row.after,after)}
      <p>${row.changed===null?'Change could not be established.':row.changed?'Leave availability changes; an existing duty or rest block may already cover the same time.':'No change in modeled leave availability.'}</p></article>`).join('')}
    <p>Role-band counts span the month and are not distinct people. Shared people and staffing reserves are checked together. These checks do not reassign duties or authorize an exception.</p></section>`;
}
