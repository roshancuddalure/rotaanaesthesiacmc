"""Bounded offline three-person night exchanges; no persistence or Apply token."""
from collections import Counter


def study(state, max_trials=128, max_inspections=20000):
    from app.services import balance_duties as bd
    planner=bd._Planner(state,bd.MAX_WORK)
    counts,credits=dict(state.duties),dict(state.extra_count)
    def night(slot):
        return int(slot.is_24hr or slot.starts_at.hour>=18 or slot.ends_at.date()>slot.starts_at.date())
    def measures():
        hours,nights,weekends=Counter(),Counter(),Counter()
        for row in state.rows.values():
            p,s=row['person'],row['slot']
            hours[p]+=int((s.ends_at-s.starts_at).total_seconds())
            nights[p]+=night(s);weekends[p]+=int(s.duty_date.weekday()>=5)
        return hours,nights,weekends
    before_hours,before_nights,before_weekends=measures()
    trials=inspections=cycles=0;refused=Counter()
    def finish():
        hours,nights,weekends=measures()
        return dict(status='offline_study_only',cycles=cycles,trials=trials,trial_limit=max_trials,
            inspections=inspections,inspection_limit=max_inspections,refusals=dict(refused),
            duty_counts_preserved=dict(state.duties)==counts,extra_credits_preserved=dict(state.extra_count)==credits,
            weekends_preserved=weekends==before_weekends,
            limit_reached=trials>=max_trials or inspections>=max_inspections or planner.exhausted,
            levels=[dict(call_level=level,before_night_gap=max(before_nights[p] for p in people)-min(before_nights[p] for p in people),
                after_night_gap=max(nights[p] for p in people)-min(nights[p] for p in people),
                before_hour_gap=(max(before_hours[p] for p in people)-min(before_hours[p] for p in people))/3600,
                after_hour_gap=(max(hours[p] for p in people)-min(hours[p] for p in people))/3600)
                for level,people in state.members_by_level.items()])
    while trials<max_trials and inspections<max_inspections and not planner.exhausted:
        hours,nights,_=measures();improved=False
        movable={p:[aid for aid in state.movable_rows(p,planner.touched) if not state.rows[aid]['extra']]
                 for people in state.members_by_level.values() for p in people}
        for level in state.levels():
            people=state.members_by_level[level]
            high,low=max(nights[p] for p in people),min(nights[p] for p in people)
            if high-low<=2:continue
            for donor in sorted((p for p in people if nights[p]==high),key=state.person_key):
                for recipient in sorted((p for p in people if nights[p]==low),key=state.person_key):
                    for first in movable[donor]:
                        a=state.rows[first]['slot']
                        if not night(a):continue
                        for second in movable[recipient]:
                            b=state.rows[second]['slot']
                            if night(b) or (a.duty_date.weekday()>=5)!=(b.duty_date.weekday()>=5):continue
                            duration=lambda s:int((s.ends_at-s.starts_at).total_seconds())
                            delta=duration(a)-duration(b)
                            if (hours[donor]-delta)**2+(hours[recipient]+delta)**2>hours[donor]**2+hours[recipient]**2:continue
                            proposed=[hours[p] for p in people if p not in (donor,recipient)]
                            proposed += [hours[donor]-delta,hours[recipient]+delta]
                            if max(proposed)-min(proposed)>max(hours[p] for p in people)-min(hours[p] for p in people):continue
                            code=planner.structural_ok(donor,second)
                            if code:
                                refused['day_to_donor:'+code]+=1
                                continue
                            for middle in sorted((p for p in people if p not in (donor,recipient)),key=state.person_key):
                                code=planner.structural_ok(middle,first)
                                if code:
                                    refused['night_to_middle:'+code]+=1
                                    continue
                                for third in movable[middle]:
                                    if inspections>=max_inspections or trials>=max_trials or planner.exhausted:return finish()
                                    inspections+=1;c=state.rows[third]['slot']
                                    if not night(c) or (a.duty_date.weekday()>=5)!=(c.duty_date.weekday()>=5):continue
                                    if duration(a)!=duration(c):continue
                                    code=planner.structural_ok(recipient,third)
                                    if code:
                                        refused['night_to_recipient:'+code]+=1
                                        continue
                                    pairs=[(first,middle),(third,recipient),(second,donor)]
                                    trials+=1;ok,code,placed=planner.transfer(pairs)
                                    if not ok:refused[code or 'no_safe_cycle']+=1;continue
                                    planner.touched.update(state.rows[aid]['slot'].id for aid,*_ in placed)
                                    cycles+=1;improved=True
                                    ah,an,aw=measures()
                                    assert dict(state.duties)==counts and dict(state.extra_count)==credits and aw==before_weekends
                                    assert sum(v*v for v in an.values())<sum(v*v for v in nights.values())
                                    assert sum(v*v for v in ah.values())<=sum(v*v for v in hours.values())
                                    break
                                if improved:break
                            if improved:break
                        if improved:break
                    if improved:break
                if improved:break
            if improved:break
        if not improved:break
    return finish()
