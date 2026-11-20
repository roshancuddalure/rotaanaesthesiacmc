"""One monotonic admission budget across a local advisory request."""

from time import monotonic

from fastapi import HTTPException


class RequestDeadline:
    def __init__(self, seconds=90, clock=None):
        self.clock = clock or monotonic
        self.ends_at = self.clock() + seconds

    def remaining(self, stage):
        seconds = self.ends_at - self.clock()
        if seconds <= 0:
            raise HTTPException(504, f"Local assistant request time budget expired during {stage}. No suggestion was accepted. Shorten the request or use regular planning.")
        return min(90, seconds)
