/** OT input vocabulary. Validation and effective-date precedence remain server-owned. */
export const OT_DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] as const;
export const OT_LEVELS = ['1ST_CALL', '2ND_CALL', '3RD_CALL', '4TH_CALL', 'CO_4TH_CALL', '5TH_CALL'] as const;
export const dayLabel = (day: string) => ({SUN:'Sunday', MON:'Monday', TUE:'Tuesday', WED:'Wednesday', THU:'Thursday', FRI:'Friday', SAT:'Saturday'}[day] ?? day);
export const levelLabel = (level: string) => ({'1ST_CALL':'1st call','2ND_CALL':'2nd call','3RD_CALL':'3rd call','4TH_CALL':'4th call','CO_4TH_CALL':'Co-4th call','5TH_CALL':'5th call'}[level] ?? level);
export const areaLabel = (area: string) => area.replace(/[_-]+/g, ' ');
export interface OtBand {key:string; start_minute:number; end_minute:number; call_levels:string[]; minimum:number; target:number; required_skills:string[]}
export interface OtWeekly {id:string; unit_id:string; area_key:string; weekday:string; effective_from:string; effective_to:string|null; bands:OtBand[]; source_reference:string}
export interface OtException {id:string; unit_id:string; area_key:string; day:string; closed:boolean; bands:OtBand[]; source_reference:string}
export interface OtQualification {skill_key:string;group_keys:string[]}
export interface OtConfig {schema_version:1; reserve_mode:'included'|'additional'; weekly:OtWeekly[]; exceptions:OtException[];qualification_bindings?:OtQualification[]}
export interface OtSaved {unit_id:string; unit_name:string; revision:string; configuration:OtConfig|null; configured:boolean; updated_at:string|null}
export interface OtVersion {id:string; revision:string; saved_by:string; saved_at:string; note:string; configuration:OtConfig}
export interface OtPreview {unit_id:string; base_revision:string; before:OtConfig|null; proposed:OtConfig; changed:boolean}
export const clockText = (minute:number) => `${String(Math.floor(minute%1440/60)).padStart(2,'0')}:${String(minute%60).padStart(2,'0')}`;
export const bandText = (band:OtBand) => `${clockText(band.start_minute)}–${clockText(band.end_minute)}${band.end_minute>=1440?' next day':''} · ${band.call_levels.map(levelLabel).join(' / ')} · minimum ${band.minimum}, target ${band.target}${band.required_skills.length ? ` · skills: ${band.required_skills.join(', ')}` : ''}`;

/** Compare logical input, not object-property order or unordered pool/record order. */
export function configurationKey(value:OtConfig|null):string {
  if (!value) return 'null';
  const copy = structuredClone(value);
  if(copy.qualification_bindings?.length){copy.qualification_bindings.sort((a,b)=>a.skill_key.localeCompare(b.skill_key));for(const binding of copy.qualification_bindings)binding.group_keys.sort();}
  else delete copy.qualification_bindings;
  for (const rows of [copy.weekly, copy.exceptions]) {
    rows.sort((a,b)=>a.id.localeCompare(b.id));
    for (const row of rows) {
      row.bands.sort((a,b)=>a.key.localeCompare(b.key));
      for (const band of row.bands) {band.call_levels.sort(); band.required_skills.sort();}
    }
  }
  const sorted = (input:unknown):unknown => Array.isArray(input) ? input.map(sorted)
    : input && typeof input==='object' ? Object.fromEntries(Object.entries(input).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>[key,sorted(item)])) : input;
  return JSON.stringify(sorted(copy));
}

/** Copy is additive. Existing destination definitions are never silently replaced. */
export function copyWeekday(config:OtConfig, source:string, destination:string):OtConfig {
  if (source===destination) throw new Error('Choose a different destination day.');
  const rows=config.weekly.filter(row=>row.weekday===source);
  if (!rows.length) throw new Error('There are no area schedules to copy on this day.');
  const overlap=(a:OtWeekly,b:OtWeekly)=>a.area_key===b.area_key
    && a.effective_from <= (b.effective_to??'9999-12-31') && b.effective_from <= (a.effective_to??'9999-12-31');
  if (rows.some(row=>config.weekly.some(other=>other.weekday===destination&&overlap(row,other))))
    throw new Error('The destination already has overlapping area schedules. Edit those schedules explicitly; copying will not replace them.');
  return {...structuredClone(config), weekly:[...structuredClone(config.weekly), ...rows.map(row=>({...structuredClone(row),id:crypto.randomUUID(),weekday:destination}))]};
}
