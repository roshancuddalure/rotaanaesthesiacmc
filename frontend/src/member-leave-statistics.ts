/** Read-only canonical leave statistics; reporting dates never confer approval. */
import { request } from "./services/api";
import { workspaceDialog } from "./member-workspace";

type Row = Record<string, unknown>;
const object = (value: unknown): value is Row => value!==null&&typeof value==="object"&&!Array.isArray(value);
const number = (value: unknown): value is number => typeof value==="number"&&Number.isFinite(value)&&value>=0;
const integer = (value: unknown): value is number => number(value)&&Number.isInteger(value);
const esc = (value: unknown) => String(value??"").replace(/[&<>"']/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[char]!);
type Measure = {precise:boolean;clock_hours:number|null;calendar_dates:number|null;
  known_clock_hours:number;known_calendar_dates:number;unresolved_record_ids:string[]};
type Timing = {whole_period:Measure;elapsed:Measure;future:Measure;in_progress_calendar_dates:number|null};
type Report = {year:number;month:number|null;as_of_local:string;starts_on:string;ends_on:string;
  approved:Timing;pending:Timing;coverage:{status_record_counts:Record<string,number>};
  by_type:{type:string;approved:Timing;status_record_counts:Record<string,number>}[];
  monthly:{month:string;approved:Timing}[]};
const counts = (value: unknown) => object(value)&&Object.values(value).every(integer);
function measure(value: unknown): value is Measure {
  return object(value)&&typeof value.precise==="boolean"&&number(value.known_clock_hours)&&integer(value.known_calendar_dates)
    &&Array.isArray(value.unresolved_record_ids)&&value.unresolved_record_ids.every(id=>typeof id==="string")
    &&(value.precise ? number(value.clock_hours)&&integer(value.calendar_dates)&&!value.unresolved_record_ids.length
        &&value.clock_hours===value.known_clock_hours&&value.calendar_dates===value.known_calendar_dates
      : value.clock_hours===null&&value.calendar_dates===null&&value.unresolved_record_ids.length>0);
}
function timing(value: unknown): value is Timing {
  return object(value)&&measure(value.whole_period)&&measure(value.elapsed)&&measure(value.future)
    &&(value.in_progress_calendar_dates===null||integer(value.in_progress_calendar_dates));
}
function parsed(value: unknown, id:string, year:number, month:number|null, asOf:string): Report {
  const yearText=String(year).padStart(4,"0"),firstMonth=String(month||1).padStart(2,"0"),lastMonth=String(month||12).padStart(2,"0");
  const ending=new Date(`${yearText}-${lastMonth}-01T00:00:00Z`);ending.setUTCMonth(ending.getUTCMonth()+1);ending.setUTCDate(0);
  const months=(month?[month]:Array.from({length:12},(_,index)=>index+1)).map(number=>`${yearText}-${String(number).padStart(2,"0")}`);
  if(!object(value)||value.version!==1||value.person_id!==id||value.year!==year||value.month!==month
    ||typeof value.as_of_local!=="string"||typeof value.starts_on!=="string"||typeof value.ends_on!=="string"
    ||value.starts_on!==`${yearText}-${firstMonth}-01`||value.ends_on!==ending.toISOString().slice(0,10)
    ||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?$/.test(value.as_of_local)
    ||(asOf&&value.as_of_local.slice(0,16)!==asOf.slice(0,16))
    ||!timing(value.approved)||!timing(value.pending)||!object(value.coverage)||!counts(value.coverage.status_record_counts)
    ||!Array.isArray(value.by_type)||!value.by_type.every(row=>object(row)&&typeof row.type==="string"&&timing(row.approved)&&counts(row.status_record_counts))
    ||!Array.isArray(value.monthly)||value.monthly.length!==months.length
    ||!value.monthly.every((row,index)=>object(row)&&row.month===months[index]&&timing(row.approved)))
    throw new Error("Leave statistics were incomplete. Retry this read; no totals have been assumed.");
  return value as unknown as Report;
}
const metric=(value:Measure)=>value.precise ? `${value.clock_hours} clock hours · ${value.calendar_dates} touched calendar dates`
  : `Exact total unknown (${value.unresolved_record_ids.length} unresolved records). Known coverage: ${value.known_clock_hours} clock hours · ${value.known_calendar_dates} touched dates`;

export function openMemberLeaveStatistics(id:string) {
  const opener=document.activeElement as HTMLElement|null,parent=opener?.closest("dialog");
  const dialog=workspaceDialog("Member leave statistics","mw-import");
  const year=new Intl.DateTimeFormat("en",{timeZone:"Asia/Kolkata",year:"numeric"}).format(new Date());
  let ticket=0;
  const alive=()=>dialog.isConnected&&dialog.open&&(!parent||(parent.isConnected&&parent.open));
  const close=()=>{ticket++;dialog.close();dialog.remove();if(opener?.isConnected)opener.focus();};
  const parentClosed=()=>close();parent?.addEventListener("close",parentClosed,{once:true});
  const observer=new MutationObserver(()=>{if(parent&&!parent.isConnected&&dialog.isConnected)close();});
  observer.observe(document.body,{childList:true});
  dialog.addEventListener("close",()=>{ticket++;observer.disconnect();parent?.removeEventListener("close",parentClosed);dialog.remove();},{once:true});
  dialog.innerHTML=`<header class="mw-header"><h2>Member leave statistics</h2><button type="button" data-stat-close>Close statistics</button></header>
    <div class="mw-content"><p>Recorded absence, not verified attendance or entitlement. Reporting clock: Asia/Kolkata hospital-local wall time.</p>
    <form data-stat-form><div class="mw-date-filter"><label>Report year<input type="number" name="year" min="1" max="9998" required value="${esc(year)}"></label>
    <label>Report month<select name="month"><option value="">Whole year</option>${Array.from({length:12},(_,index)=>`<option value="${index+1}">${String(index+1).padStart(2,"0")}</option>`).join("")}</select></label>
    <label>As of local date and time (optional)<input type="datetime-local" name="as_of"></label></div><p>Leave As of blank to use the facility's current time. Counts use current recorded approval states; they do not reconstruct what was approved at a historical date.</p>
    <button type="submit">Read leave statistics</button></form><p role="status" data-stat-status>Choose a period and read its recorded statistics.</p><div data-stat-result></div></div>`;
  dialog.querySelector<HTMLButtonElement>("[data-stat-close]")!.onclick=close;
  const form=dialog.querySelector<HTMLFormElement>("form")!,status=dialog.querySelector<HTMLElement>("[data-stat-status]")!,host=dialog.querySelector<HTMLElement>("[data-stat-result]")!;
  form.oninput=()=>{ticket++;host.replaceChildren();host.removeAttribute("aria-busy");status.textContent="Reporting controls changed. Read statistics for the selected values.";};
  form.onsubmit=async event=>{
    event.preventDefault();if(!form.reportValidity())return;
    const data=new FormData(form),year=Number(data.get("year")),month=data.get("month")?Number(data.get("month")):null;
    const asOf=String(data.get("as_of")||""),sequence=++ticket;
    const params=new URLSearchParams({year:String(year)});if(month)params.set("month",String(month));if(asOf)params.set("as_of",asOf);
    host.replaceChildren();host.setAttribute("aria-busy","true");status.textContent="Reading canonical leave statistics…";
    try{
      const result=parsed(await request<unknown>(`/api/v1/admin/member-workspace/${id}/leave-statistics?${params}`),id,year,month,asOf);
      if(!alive()||sequence!==ticket)return;
      const summary=(title:string,value:Timing,key:string)=>`<section class="panel"><h3>${title}</h3><dl>
       <div><dt>Whole reporting period</dt><dd data-stat-${key}-whole>${metric(value.whole_period)}</dd></div>
       <div><dt>Recorded absence elapsed</dt><dd data-stat-${key}-elapsed>${metric(value.elapsed)}</dd></div>
       <div><dt>Future recorded absence</dt><dd data-stat-${key}-future>${metric(value.future)}</dd></div>
       <div><dt>In-progress calendar dates</dt><dd>${value.in_progress_calendar_dates??"Unknown"}</dd></div></dl></section>`;
      const countList=(values:Record<string,number>)=>Object.entries(values).map(([key,count])=>`<div><dt>${esc(key.replace(/_/g," "))}</dt><dd>${count}</dd></div>`).join("");
      const max=Math.max(1,...result.monthly.map(row=>row.approved.whole_period.precise?row.approved.whole_period.clock_hours!:0));
      host.innerHTML=`<p data-stat-period>${esc(result.starts_on)} to ${esc(result.ends_on)} · As of ${esc(result.as_of_local)} (hospital-local)</p>
        ${summary("Approved records",result.approved,"approved")}${summary("Pending requests (separate risk)",result.pending,"pending")}
        <h3>Request records by status</h3><p>Only the canonical approved status contributes to approved coverage. Pending and unrecognized status records are not approved absence.</p><dl>${countList(result.coverage.status_record_counts)||"<p>No matching records.</p>"}</dl>
        <h3>Approved coverage by month</h3><p>Bars show known exact whole-period approved clock hours; unknown months have no bar.</p>
        ${result.monthly.map(row=>`<article class="mw-history"><h4>${esc(row.month)}</h4><p>${metric(row.approved.whole_period)}</p>${row.approved.whole_period.precise?`<meter min="0" max="${max}" value="${row.approved.whole_period.clock_hours}" aria-label="${esc(row.month)} approved covered clock hours"></meter>`:""}</article>`).join("")}
        <h3>Leave types</h3><p>Different types may overlap. Type hours and monthly record counts are not additive; the overall union is authoritative.</p>
        ${result.by_type.map(row=>`<article class="mw-history"><h4>${esc(row.type.replace(/_/g," "))}</h4><p>${metric(row.approved.whole_period)}</p><dl>${countList(row.status_record_counts)}</dl></article>`).join("")}
        <p data-stat-basis>Calendar counts are distinct touched dates including weekends/holidays. Partial dates are not full leave days. Elapsed and future date counts can share today's date.</p>
        <p data-stat-coverage>Historical coverage is incomplete; no matching records do not prove absence of historical leave. Working-day totals and entitlement balances are unavailable without an authoritative policy/calendar. Leave volume is not a disciplinary score.</p>`;
      status.textContent="Recorded statistics loaded. Existing duties and leave records were not changed.";
    }catch(error){if(alive()&&sequence===ticket){host.innerHTML=`<p role="alert">${esc(error instanceof Error?error.message:"Statistics could not load.")}</p>`;status.textContent="Read failed. Use Read leave statistics to retry; it only reads data.";}}
    finally{if(alive()&&sequence===ticket)host.removeAttribute("aria-busy");}
  };
}
