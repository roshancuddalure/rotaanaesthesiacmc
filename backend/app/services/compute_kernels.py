"""Exact integer kernels for template allocation and optimizer assistance."""

from fastapi import HTTPException

VERSION = 3
MAX_ROWS = 100000
MAX_COLUMNS = 32
MAX_BATCH_ROWS = 4096


def ranks(rows, ties):
    if not rows or len(rows) > MAX_BATCH_ROWS or len(ties) != len(rows):
        raise HTTPException(422, "Invalid numeric ranking batch")
    width = len(rows[0])
    if not 1 <= width <= MAX_COLUMNS or len(set(ties)) != len(ties):
        raise HTTPException(422, "Invalid ranking dimensions or tie order")
    for row in rows:
        if len(row) != width or any(
            type(n) is not int or not -2147483648 <= n <= 2147483647 for n in row
        ):
            raise HTTPException(422, "Ranking values must be signed 32-bit integers")
    if any(type(n) is not int or not 0 <= n <= 2147483647 for n in ties):
        raise HTTPException(422, "Invalid numeric tie order")
    ordered = sorted(range(len(rows)), key=lambda i: (*rows[i], ties[i]))
    result = [0] * len(rows)
    for rank, index in enumerate(ordered):
        result[index] = rank
    return result


def frame(rows, ties, *, token=None):
    expected = ranks(rows, ties)
    return {
        "kernel": "lexicographic",
        "version": VERSION,
        "rows": rows,
        "ties": ties,
        **({"token": token} if token else {}),
    }, expected
