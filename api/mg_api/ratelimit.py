"""In-memory rate limiting: no Redis, no paid service.

On serverless hosts each warm instance keeps its own buckets, so limits are
approximate; the free LLM provider's quota (never attached to a card) is the
hard ceiling, and the daily budget keeps us below it.
"""

from __future__ import annotations

import hashlib
import time
from collections import OrderedDict
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Callable

Clock = Callable[[], float]


@dataclass
class TokenBucket:
    capacity: float
    refill_per_s: float
    tokens: float
    updated: float

    def take(self, now: float, cost: float = 1.0) -> float:
        """Consume; returns 0 when allowed, else seconds until a token is available."""
        self.tokens = min(self.capacity, self.tokens + (now - self.updated) * self.refill_per_s)
        self.updated = now
        if self.tokens >= cost:
            self.tokens -= cost
            return 0.0
        return (cost - self.tokens) / self.refill_per_s if self.refill_per_s > 0 else 3600.0


class RateLimiter:
    def __init__(self, *, clock: Clock = time.monotonic, wall: Callable[[], datetime] = lambda: datetime.now(timezone.utc), max_keys: int = 10_000):
        self.clock = clock
        self.wall = wall
        self.max_keys = max_keys
        self._buckets: OrderedDict[str, TokenBucket] = OrderedDict()
        self._daily: OrderedDict[str, tuple[str, int]] = OrderedDict()

    def _bucket(self, key: str, per_min: int, burst: int) -> TokenBucket:
        b = self._buckets.get(key)
        if b is None:
            now = self.clock()
            b = TokenBucket(capacity=burst, refill_per_s=per_min / 60.0, tokens=burst, updated=now)
            self._buckets[key] = b
            if len(self._buckets) > self.max_keys:
                self._buckets.popitem(last=False)
        else:
            self._buckets.move_to_end(key)
        return b

    def check(self, key: str, *, per_min: int, burst: int) -> float:
        return self._bucket(key, per_min, burst).take(self.clock())

    def daily(self, key: str, *, limit: int, cost: int = 1, commit: bool = True) -> bool:
        """True when `cost` more units fit in today's (UTC) allowance."""
        today = self.wall().strftime("%Y-%m-%d")
        day, used = self._daily.get(key, (today, 0))
        if day != today:
            used = 0
        if used + cost > limit:
            return False
        if commit:
            self._daily[key] = (today, used + cost)
            self._daily.move_to_end(key)
            # bounded like the buckets: oldest keys go first (they are also the most likely to be stale)
            while len(self._daily) > self.max_keys:
                self._daily.popitem(last=False)
        return True

    def seconds_to_midnight(self) -> int:
        now = self.wall()
        return int(86400 - (now.hour * 3600 + now.minute * 60 + now.second))


def client_ip(headers, peer: str | None, trust_proxy: bool) -> str:
    """Client address for rate limiting.

    Only consulted when TRUST_PROXY=1 (the Vercel default). Vercel sets x-vercel-forwarded-for itself.
    For X-Forwarded-For we take the RIGHTMOST entry: the one appended by the proxy directly in front of
    us. Leading entries are whatever the client sent and would let it mint a fresh bucket per request.
    Hosts without a trusted proxy (e.g. the Docker image exposed directly) must run with TRUST_PROXY=0.
    """
    if trust_proxy:
        v = headers.get("x-vercel-forwarded-for")
        if v:
            return v.split(",")[0].strip()
        v = headers.get("x-forwarded-for")
        if v:
            parts = [x.strip() for x in v.split(",") if x.strip()]
            if parts:
                return parts[-1]
        v = headers.get("x-real-ip")
        if v:
            return v.strip()
    return peer or "unknown"


def hashed(ip: str) -> str:
    return hashlib.sha256(ip.encode()).hexdigest()[:12]
