"""Production composition semantics; fictional identities, no database access."""
from copy import deepcopy
import itertools
import pytest

from app.services.allocation_net_moves import compose


def move(aid, before, after, unit_before='unit1', unit_after='unit1'):
    return dict(assignment_id=aid, slot_id='slot-'+aid, from_person_id=before, from_person=before,
                to_person_id=after, to_person=after, from_unit_id=unit_before, from_unit=unit_before,
                to_unit_id=unit_after, to_unit=unit_after, extra_duty=False, record_id=None,
                kind='swap', swap_with=[], swap_duty_date='2026-11-10', swap_duty_label='Night')


def test_chain_keeps_real_original_holder_and_unit_and_does_not_mutate_sources():
    base=[move('a','Alice','Bob')]
    later=[move('a','Bob','Cara',unit_after='unit2')]
    original=deepcopy((base,later))
    result=compose(base,later)
    assert (base,later)==original
    assert [(m['from_person_id'],m['to_person_id'],m['from_unit_id'],m['to_unit_id']) for m in result]==[
        ('Alice','Cara','unit1','unit2')]
    assert result[0]['kind']=='move' and result[0]['cross_unit']


@pytest.mark.parametrize('bad', ['holder','unit','slot','extra_base','extra_later','duplicate'])
def test_discontinuous_or_ledger_bearing_changes_refuse(bad):
    base=[move('a','Alice','Bob')];later=[move('a','Bob','Cara')]
    if bad=='holder':later[0]['from_person_id']='Wrong'
    elif bad=='unit':later[0]['from_unit_id']='Wrong'
    elif bad=='slot':later[0]['slot_id']='Wrong'
    elif bad=='extra_base':base[0]['extra_duty']=True
    elif bad=='extra_later':later[0]['record_id']='ledger'
    else:base.append(deepcopy(base[0]))
    with pytest.raises(ValueError):compose(base,later)


def test_round_trip_is_omitted_and_original_swap_partner_link_is_removed():
    base=[move('a','Alice','Bob'),move('b','Bob','Alice')]
    base[0]['swap_with']=['slot-b'];base[1]['swap_with']=['slot-a']
    result=compose(base,[move('a','Bob','Alice')])
    assert len(result)==1 and result[0]['assignment_id']=='b'
    assert result[0]['kind']=='move' and result[0]['swap_with']==[]


def test_every_short_chain_has_same_final_effect_and_exact_original_undo():
    for chain in itertools.product(('Alice','Bob','Cara'),repeat=4):
        steps=[move('a',a,b) for a,b in zip(chain,chain[1:])]
        result=compose(steps[:1],steps[1:])
        final=chain[0]
        before_image=[]
        for row in result:
            assert final==row['from_person_id']
            before_image.append(row['from_person_id'])
            final=row['to_person_id']
        assert final==chain[-1]
        for original in reversed(before_image):final=original
        assert final==chain[0]
