"""Canonicalize disposable-test request payloads; file bytes are never normalized."""
from email import policy
from email.parser import BytesParser
import hashlib
import json


def payload_snapshot(content_type, body):
    if content_type.startswith("multipart/form-data"):
        message = BytesParser(policy=policy.default).parsebytes(
            b"Content-Type: " + content_type.encode("ascii") + b"\r\nMIME-Version: 1.0\r\n\r\n" + body)
        if not message.is_multipart() or message.defects:
            raise ValueError("Invalid multipart test capture")
        parts = []
        for part in message.iter_parts():
            name = part.get_param("name", header="content-disposition")
            if not name or part.defects:
                raise ValueError("Unnamed or malformed multipart part")
            data = part.get_payload(decode=True)
            if data is None:
                raise ValueError("Missing multipart payload")
            filename = part.get_filename()
            parts.append({"name": name, **({"filename": filename, "bytes": len(data),
                          "sha256": hashlib.sha256(data).hexdigest(), "type": part.get_content_type()}
                         if filename is not None else {"value": data.decode(part.get_content_charset() or "utf-8")})})
        return {"format": "multipart", "parts": parts}
    if content_type.startswith("application/json"):
        return {"format": "json", "value": json.loads(body)}
    return {"format": "raw", "bytes": len(body), "sha256": hashlib.sha256(body).hexdigest()}
