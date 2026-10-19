"""Response protections and a streaming body bound for the small compute protocol."""

import asyncio

from starlette.responses import JSONResponse

from app.core.config import settings


class ComputeSecurityMiddleware:
    body_timeout = 10

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)

        async def secured_send(message):
            if message["type"] == "http.response.start":
                headers = list(message.get("headers", []))
                headers.extend(
                    [
                        (b"x-content-type-options", b"nosniff"),
                        (b"referrer-policy", b"same-origin"),
                        (b"x-frame-options", b"DENY"),
                    ]
                )
                if scope["path"].startswith("/api/v1/rota-compute"):
                    headers.append((b"cache-control", b"no-store"))
                if settings.app_env.lower() == "production":
                    # Same-origin frontend/API. Optional paired assistant is loopback-only.
                    csp = (
                        "default-src 'self'; script-src 'self'; worker-src 'self'; "
                        "style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; "
                        "font-src 'self'; connect-src 'self' http://127.0.0.1:*; "
                        "object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"
                    )
                    if scope["path"].startswith("/assets/compute-worker-") and scope[
                        "path"
                    ].endswith(".js"):
                        csp = "default-src 'none'; script-src 'self'; connect-src 'none'; object-src 'none'"
                    headers.append((b"content-security-policy", csp.encode("ascii")))
                    if scope["scheme"] == "https":
                        headers.append((b"strict-transport-security", b"max-age=31536000"))
                message = {**message, "headers": headers}
            await send(message)

        if scope["path"].startswith("/api/v1/rota-compute") and scope["method"] in {
            "POST",
            "PUT",
            "PATCH",
        }:

            async def read_body():
                body = bytearray()
                while True:
                    message = await receive()
                    if message["type"] == "http.disconnect":
                        return None
                    chunk = message.get("body", b"")
                    if len(body) + len(chunk) > 4096:
                        raise ValueError("Compute request body exceeds 4096 bytes")
                    body.extend(chunk)
                    if not message.get("more_body", False):
                        return bytes(body)

            try:
                body = await asyncio.wait_for(read_body(), timeout=self.body_timeout)
            except (TimeoutError, ValueError) as error:
                status = 408 if isinstance(error, TimeoutError) else 413
                detail = "Compute request body timed out" if status == 408 else str(error)
                return await JSONResponse({"detail": detail}, status_code=status)(
                    scope, receive, secured_send
                )
            if body is None:
                return
            delivered = False

            async def bounded_receive():
                nonlocal delivered
                if delivered:
                    return await receive()
                delivered = True
                return {"type": "http.request", "body": body, "more_body": False}

            return await self.app(scope, bounded_receive, secured_send)
        return await self.app(scope, receive, secured_send)
