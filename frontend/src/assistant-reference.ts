export type AssistantReference = {month:string;generatedAt:string;rules:string;teaching:string;ot?:{unitId:string;day:string;version:string;calendarRevision:string}};

// References come from the authenticated backend, never from model output.
export function assistantReference(value:unknown):AssistantReference|null {
  if(!value || typeof value!=='object')return null;
  const v=value as Record<string,unknown>;
  const selected=v.source_contract===2;
  if((v.source_contract!==1 && !selected) || typeof v.month!=='string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(v.month)
    || typeof v.snapshot_generated_at!=='string' || v.snapshot_generated_at.length>50 || !Number.isFinite(Date.parse(v.snapshot_generated_at))
    || !Array.isArray(v.sources) || v.sources.length!==(selected?3:2))return null;
  const versions=new Map<string,string>();
  for(const source of v.sources){
    if(!source || typeof source!=='object')return null;
    const row=source as Record<string,unknown>;
    if(typeof row.source!=='string' || !['current_rule_constraints','approved_teaching_features',...(selected?['selected_unit_ot_demand']:[])].includes(row.source)
      || typeof row.content_version!=='string' || !/^[a-f0-9]{64}$/.test(row.content_version) || versions.has(row.source))return null;
    versions.set(row.source,row.content_version);
  }
  let ot:AssistantReference['ot'];
  if(selected){
    const demand=v.ot_demand as any,c=demand?.content;
    if(!c || typeof c.unit_id!=='string' || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(c.unit_id)
      || typeof c.day!=='string' || !/^\d{4}-\d{2}-\d{2}$/.test(c.day) || c.day.slice(0,7)!==v.month
      || !Number.isFinite(Date.parse(c.day)) || new Date(c.day).toISOString().slice(0,10)!==c.day
      || typeof demand.calendar_revision!=='string' || !/^[a-f0-9]{64}$/.test(demand.calendar_revision))return null;
    ot={unitId:c.unit_id,day:c.day,version:versions.get('selected_unit_ot_demand')!,calendarRevision:demand.calendar_revision};
  }
  return {month:v.month,generatedAt:v.snapshot_generated_at,rules:versions.get('current_rule_constraints')!,teaching:versions.get('approved_teaching_features')!,...(ot?{ot}:{})};
}

export function sameAssistantReference(before:AssistantReference|null,after:AssistantReference|null):boolean {
  return !!before && !!after && before.month===after.month && before.rules===after.rules && before.teaching===after.teaching
    && JSON.stringify(before.ot)===JSON.stringify(after.ot);
}
