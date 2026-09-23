use std::time::{Duration, Instant};

const INITIAL_INTERRUPT_STRIDE: u64 = 64;
const MAX_STRIDE_GROWTH: u64 = 16;

/// Samples a wall-clock deadline without importing the clock on every QuickJS
/// interrupt. The stride is deliberately a soft target: callback frequency can
/// change, and finishing between samples does not trigger another clock read.
pub(super) struct ExecutionTimeoutSampler {
    deadline: Instant,
    target_interval: Duration,
    last_sample_at: Instant,
    stride: u64,
    interrupts_until_sample: u64,
    expired: bool,
}

impl ExecutionTimeoutSampler {
    pub(super) fn new(started_at: Instant, deadline: Instant, timeout: Duration) -> Self {
        Self {
            deadline,
            target_interval: timeout / 10,
            last_sample_at: started_at,
            stride: INITIAL_INTERRUPT_STRIDE,
            interrupts_until_sample: INITIAL_INTERRUPT_STRIDE,
            expired: false,
        }
    }

    /// Returns true only when a sampled clock value reaches the deadline.
    /// `clock` is never called on unsampled interrupts.
    pub(super) fn expired(&mut self, clock: impl FnOnce() -> Instant) -> bool {
        if self.expired {
            return true;
        }
        self.interrupts_until_sample -= 1;
        if self.interrupts_until_sample != 0 {
            return false;
        }

        let now = clock();
        if now >= self.deadline {
            self.expired = true;
            return true;
        }

        let elapsed_nanos = now
            .saturating_duration_since(self.last_sample_at)
            .as_nanos()
            .max(1);
        let estimated_stride = self
            .target_interval
            .as_nanos()
            .saturating_mul(u128::from(self.stride))
            / elapsed_nanos;
        let growth_limit = self.stride.saturating_mul(MAX_STRIDE_GROWTH);
        self.stride = estimated_stride
            .clamp(1, u128::from(growth_limit))
            .try_into()
            .unwrap_or(u64::MAX);
        self.interrupts_until_sample = self.stride;
        self.last_sample_at = now;
        false
    }
}
