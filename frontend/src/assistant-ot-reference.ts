export type OtDemandReference={content:{unit_id:string;day:string;calendar_status:'configured'|'partially_configured'|'not_evaluated';demand_known:boolean;reserve_mode:'included'|'additional'|null;closed_area_count:number;missing_area_count:number;bands:{band_index:number;starts_at:string;ends_at:string;call_levels:string[];minimum:number;target:number;required_skill_count:number}[]};source:{kind:string;calendar_revision:string;content_version:string};retrieved_at:string};
const count=(value:unknown,max=2147483647):value is number=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0&&value<=max;
export function otDemandReference(value:unknown,unit:string,day:string):OtDemandReference|null{
 if(!value||typeof value!=='object')return null;
 const v=value as Record<string,any>,c=v.content,s=v.source;
 if(v.reference_contract!=='ot-demand-v1'||!c||!s||c.unit_id!==unit||c.day!==day||!/^\d{4}-\d{2}-\d{2}$/.test(day)
  ||!['configured','partially_configured','not_evaluated'].includes(c.calendar_status)||typeof c.demand_known!=='boolean'
  ||c.demand_known!==(c.calendar_status==='configured')||![null,'included','additional'].includes(c.reserve_mode)
  ||!count(c.closed_area_count)||!count(c.missing_area_count)||!Array.isArray(c.bands)||c.bands.length>64
  ||s.kind!=='resolved_unit_ot_calendar'||!['calendar_revision','content_version'].every(k=>typeof s[k]==='string'&&/^[a-f0-9]{64}$/.test(s[k]))
  ||typeof v.retrieved_at!=='string'||v.retrieved_at.length>50||!Number.isFinite(Date.parse(v.retrieved_at)))return null;
 for(const [index,b] of c.bands.entries())if(!b||b.band_index!==index||typeof b.starts_at!=='string'||typeof b.ends_at!=='string'||b.starts_at.length>32||b.ends_at.length>32
  ||!Number.isFinite(Date.parse(b.starts_at))||!Number.isFinite(Date.parse(b.ends_at))||Date.parse(b.ends_at)<=Date.parse(b.starts_at)
  ||!Array.isArray(b.call_levels)||b.call_levels.length<1||b.call_levels.length>6||new Set(b.call_levels).size!==b.call_levels.length
  ||!b.call_levels.every((level:unknown)=>typeof level==='string'&&['1ST_CALL','2ND_CALL','3RD_CALL','4TH_CALL','CO_4TH_CALL','5TH_CALL'].includes(level))
  ||!count(b.minimum,128)||!count(b.target,128)||b.target<b.minimum||!count(b.required_skill_count,64))return null;
 return {content:c,source:s,retrieved_at:v.retrieved_at};
}
