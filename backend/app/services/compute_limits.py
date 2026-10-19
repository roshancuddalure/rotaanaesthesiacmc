"""Per-process admission control, layered over durable DB job locks and quotas.

Multi-worker deployments should enforce aggregate limits at their reverse proxy.
Cancel/read remain available when a computation budget is exhausted.
"""

from collections import OrderedDict
from math import ceil
from threading import Lock
from time import monotonic

from fastapi import HTTPException


class ComputeLimiter:
    def __init__(self, clock=monotonic):
        self.clock = clock
        self.lock = Lock()
        self.buckets = OrderedDict()

    def check(self, operator_id, kind):
        capacity, rate = (12, 12 / 300) if kind == "start" else (60, 10)
        now = self.clock()
        key = (str(operator_id), kind)
        with self.lock:
            while self.buckets:
                first = next(iter(self.buckets))
                if now - self.buckets[first][1] <= 600:
                    break
                self.buckets.popitem(last=False)
            tokens, previous = self.buckets.pop(key, (capacity, now))
            tokens = min(capacity, tokens + max(0, now - previous) * rate)
            allowed = tokens >= 1
            self.buckets[key] = (tokens - 1 if allowed else tokens, now)
            if len(self.buckets) > 10000:
                self.buckets.popitem(last=False)
        if not allowed:
            raise HTTPException(
                429,
                "Compute request budget exhausted. Wait briefly, then resume your proposal.",
                headers={"Retry-After": str(max(1, ceil((1 - tokens) / rate)))},
            )
