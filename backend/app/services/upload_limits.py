"""Bound untrusted upload reads before passing them to workbook parsers."""
from fastapi import UploadFile

MAX_UPLOAD_BYTES = 5 * 1024 * 1024


async def read_bounded_upload(file: UploadFile) -> bytes:
    content = await file.read(MAX_UPLOAD_BYTES + 1)
    if len(content) > MAX_UPLOAD_BYTES:
        raise ValueError("File must be no larger than 5 MB.")
    if not content:
        raise ValueError("The selected file is empty.")
    return content
