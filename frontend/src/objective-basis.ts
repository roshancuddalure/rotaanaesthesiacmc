/** Describe the objective actually saved with a proposal; older evidence stays unknown. */
export function objectiveBasisText(value:unknown):string {
  if(!value||typeof value!=='object'||Array.isArray(value))return missing();
  const row=value as Record<string,unknown>;
  if(row.version===3&&row.equality==='availability_covered_v2'&&row.personal_prorata_optimized===true
    &&row.fixed_duties==='included_in_month_total'&&row.demand_basis==='covered_duties'
    &&row.availability_units==='fractional_days')return 'Availability-based fairness: personal targets use duties safely covered and fractional available posted days. '
      +'Worst and total target-deviation gaps precede squared count deviation, hours and extra burden. '
      +'Safety and coverage come first; raw duty counts can differ by more than two.';
  if(row.version===2&&row.equality==='availability_v1'&&row.personal_prorata_optimized===true
    &&row.fixed_duties==='included_in_month_total')return 'Availability-based fairness: personal targets reflect available posted days. '
      +'Worst and total target-deviation gaps precede squared count deviation, hours and extra burden. '
      +'Safety and coverage come first; raw duty counts can differ by more than two.';
  if(row.version!==1||row.equality!=='uniform_call_level_v1'||row.personal_prorata_optimized!==false
    ||row.fixed_duties!=='included_in_month_total'||typeof row.preferences_before_equality!=='boolean')return missing();
  return 'This proposal uses a shared target within each call level, with fixed duties included. '
    +'Dated eligibility limits assignments, but this objective does not minimize personal pro-rata deviation. '
    +'Safety and required coverage remain higher priorities.'
    +(row.worst_gap_optimized===true?' Worst call-level gap precedes squared count deviation; fairness precedes repair change count.':'')
    +(row.hours_and_extra_optimized===true?' Hours and extra-duty burden are included.':'')
    +(row.preferences_before_equality?' Explicit preferences precede equality in this proposal.':'');
}
function missing(){return 'The fairness objective basis was not recorded in this saved proposal. Review its original evidence before comparing targets.';}
