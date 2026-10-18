"""Common source-row history and rejected-row exports for every upload pathway."""
import csv
import io
import json
from typing import Literal
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.orm import Session
from app.api.v1.auth import current_user
from app.db.session import get_db
from app.models import ImportBatch, ImportSourceRecord, UserAccount
from app.services.auth import ADMIN_ROLES

router = APIRouter(prefix="/imports", dependencies=[Depends(current_user)])
Kind = Literal['members','past','leave','units']
KINDS = {'members':'department_members','past':'past_duty_upload','leave':'leave_upload','units':'unit_upload'}


def authorize(kind: Kind, user: UserAccount):
    if kind in {'members','past'} and user.role not in ADMIN_ROLES:
        raise HTTPException(403,'Computer admin privilege required')


def batch_for(db: Session, kind: Kind, batch_id: UUID) -> ImportBatch:
    batch=db.get(ImportBatch,batch_id)
    if batch is None or batch.import_kind != KINDS[kind]:
        raise HTTPException(404,'Import batch not found')
    return batch


def decoded(value):
    try:
        return json.loads(value or '{}')
    except (TypeError, ValueError):
        return {'value':value}


@router.get('/{kind}/history')
def history(kind: Kind, month: str | None = None, offset: int = Query(0,ge=0), limit: int = Query(25,ge=1,le=100),
            db: Session = Depends(get_db), user: UserAccount = Depends(current_user)):
    authorize(kind,user)
    query=select(ImportBatch).where(ImportBatch.import_kind==KINDS[kind]).order_by(ImportBatch.created_at.desc(),ImportBatch.id.desc())
    if month:
        query=query.where(ImportBatch.source_metadata['month'].as_string()==month)
    rows=list(db.scalars(query.offset(offset).limit(limit+1)))
    batches=[]
    for batch in rows[:limit]:
        meta=batch.source_metadata
        try:
            actor=db.get(UserAccount,UUID(meta.get('actor_id','')))
        except (TypeError,ValueError):
            actor=None
        batches.append({'id':str(batch.id),'filename':batch.source_filename,'month':meta.get('month'),
                        'status':batch.status,'at':batch.completed_at,'actor':actor.display_name if actor else 'Internal import',
                        'counts':meta.get('counts',{})})
    return {'items':batches,'offset':offset,'has_more':len(rows)>limit}


@router.get('/{kind}/history/{batch_id}')
def detail(kind: Kind, batch_id: UUID, offset: int = Query(0,ge=0), limit: int = Query(50,ge=1,le=200),
           db: Session = Depends(get_db),user: UserAccount=Depends(current_user)):
    authorize(kind,user); batch=batch_for(db,kind,batch_id)
    records=list(db.scalars(select(ImportSourceRecord).where(ImportSourceRecord.batch_id==batch.id)
                           .order_by(ImportSourceRecord.row_index,ImportSourceRecord.id).offset(offset).limit(limit+1)))
    return {'filename':batch.source_filename,'offset':offset,'has_more':len(records)>limit,
            'rows':[{'sheet':r.sheet_name,'row':r.row_index,'raw':decoded(r.raw_value),
                     'normalized':decoded(r.cleaned_value),'outcome':decoded(r.notes),'record_id':str(r.normalized_id) if r.normalized_id else None}
                    for r in records[:limit]]}


@router.get('/{kind}/history/{batch_id}/rejected.csv')
def rejected(kind:Kind,batch_id:UUID,db:Session=Depends(get_db),user:UserAccount=Depends(current_user)):
    authorize(kind,user);batch=batch_for(db,kind,batch_id)
    stream=io.StringIO();writer=csv.writer(stream);writer.writerow(['Sheet','Source row','Action','Original','Normalized','Issues'])
    def safe(value):
        value=str(value)
        return "'"+value if value.lstrip().startswith(('=','+','-','@')) else value
    for record in db.scalars(select(ImportSourceRecord).where(ImportSourceRecord.batch_id==batch.id).order_by(ImportSourceRecord.row_index)):
        outcome=decoded(record.notes)
        action=outcome.get('action','')
        issues=outcome.get('issues') or outcome.get('errors') or []
        if action not in {'skipped','skip','needs_review'} and not issues:
            continue
        writer.writerow([safe(record.sheet_name or ''),record.row_index,action,safe(record.raw_value or ''),
                         safe(record.cleaned_value or ''),safe('; '.join(map(str,issues)))])
    return Response(('\ufeff'+stream.getvalue()).encode('utf-8'),media_type='text/csv',
                    headers={'Content-Disposition':f'attachment; filename="rejected_{kind}_{batch_id}.csv"','Cache-Control':'no-store'})
