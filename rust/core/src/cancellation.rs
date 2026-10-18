use std::sync::atomic::{AtomicBool, Ordering};

/// Shared cooperative cancellation; signals and job scheduling belong to adapters.
#[derive(Default)]
pub struct Cancellation(AtomicBool);

impl Cancellation {
    pub fn cancel(&self) {
        self.0.store(true, Ordering::Release);
    }

    pub fn is_cancelled(&self) -> bool {
        self.0.load(Ordering::Acquire)
    }
}

#[cfg(test)]
mod tests {
    use super::Cancellation;

    #[test]
    fn cancellation_is_monotonic_and_shared_across_threads() {
        let token = Cancellation::default();
        assert!(!token.is_cancelled());
        std::thread::scope(|scope| {
            scope.spawn(|| token.cancel());
        });
        assert!(token.is_cancelled());
        token.cancel();
        assert!(token.is_cancelled());
    }
}
