"""Loopback-only visual audit API with a synthetic superadmin and RAM database.

Uses existing test fixtures/services. Never opens the configured working database.
"""
import asyncio
from generation_smoke_server import app, engine, reset_data
import compute_smoke_server
from sqlalchemy.orm import Session
from app.models import UserAccount
import uvicorn

assert engine.url.drivername == 'sqlite+pysqlite' and engine.url.database == ':memory:'


class SerializedAuditRequests:
    def __init__(self, app):
        self.app = app
        self.lock = asyncio.Lock()

    async def __call__(self, scope, receive, send):
        if scope['type'] != 'http':
            return await self.app(scope, receive, send)
        async with self.lock:
            await self.app(scope, receive, send)


app.add_middleware(SerializedAuditRequests)
reset_data()
with Session(engine) as db:
    operator = db.get(UserAccount, compute_smoke_server.operator.id)
    operator.role = 'superadmin'
    operator.display_name = 'Synthetic visual audit admin'
    db.commit()
    db.refresh(operator)
    db.expunge(operator)
    compute_smoke_server.operator = operator

if __name__ == '__main__':
    uvicorn.run(app, host='127.0.0.1', port=8033, access_log=False)
