//! A deterministic token-bucket rate limiter (integer math, time injected).
//!
//! Pure and side-effect free so it is fully unit-testable: the caller supplies a
//! monotonic millisecond clock. The relay service holds one limiter per account.

/// A token-bucket rate limiter.
#[derive(Debug, Clone)]
pub struct RateLimiter {
    capacity: u64,
    refill_per_sec: u64,
    tokens: u64,
    last_ms: u64,
}

impl RateLimiter {
    /// A limiter holding up to `capacity` tokens, refilling `refill_per_sec`.
    #[must_use]
    pub fn new(capacity: u64, refill_per_sec: u64) -> Self {
        Self {
            capacity,
            refill_per_sec,
            tokens: capacity,
            last_ms: 0,
        }
    }

    /// Try to consume one token at `now_ms`. Returns `true` if allowed.
    pub fn try_acquire(&mut self, now_ms: u64) -> bool {
        let elapsed = now_ms.saturating_sub(self.last_ms);
        let refill = elapsed.saturating_mul(self.refill_per_sec) / 1000;
        if refill > 0 {
            self.tokens = self.tokens.saturating_add(refill).min(self.capacity);
            self.last_ms = now_ms;
        }
        if self.tokens > 0 {
            self.tokens -= 1;
            true
        } else {
            false
        }
    }

    /// Tokens currently available (for diagnostics).
    #[must_use]
    pub fn available(&self) -> u64 {
        self.tokens
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn burst_then_block_then_refill() {
        let mut rl = RateLimiter::new(3, 10); // 3 burst, 10/sec
                                              // Burst of 3 at t=0.
        assert!(rl.try_acquire(0));
        assert!(rl.try_acquire(0));
        assert!(rl.try_acquire(0));
        // Fourth is blocked.
        assert!(!rl.try_acquire(0));
        // After 100ms, 1 token refills (10/sec).
        assert!(rl.try_acquire(100));
        assert!(!rl.try_acquire(100));
        // After a full second from last refill, capped at capacity.
        assert!(rl.try_acquire(1100));
    }

    #[test]
    fn never_exceeds_capacity() {
        let mut rl = RateLimiter::new(2, 100);
        // Long idle should not overflow the bucket.
        assert!(rl.try_acquire(1_000_000));
        assert!(rl.try_acquire(1_000_000));
        assert!(!rl.try_acquire(1_000_000));
    }
}
