use std::collections::VecDeque;
use std::sync::{Condvar, Mutex};
use std::time::{Duration, Instant};
use synapse_core::{
    Cancellation, ModelError, ModelLeasePort, ModelRequest, ModelResponse, ModelTransport,
};

pub const MAX_PENDING_JOBS: usize = 8;
pub const QUEUE_TIMEOUT: Duration = Duration::from_secs(30);
const POLL: Duration = Duration::from_millis(20);
const INTERACTIVE_BURST: usize = 3;
#[derive(Clone, Copy, Eq, PartialEq)]
pub enum JobPriority {
    Interactive,
    Background,
}
#[derive(Default)]
struct State {
    running: bool,
    next: u64,
    waiting: VecDeque<(u64, JobPriority)>,
    burst: usize,
}
/// Synchronous cancellable facade: one lane for all model tasks. No detached worker
/// can outlive its lease. Interactive work has a bounded burst to prevent starvation.
#[derive(Default)]
pub struct JobQueue {
    state: Mutex<State>,
    changed: Condvar,
}
impl JobQueue {
    pub fn run(
        &self,
        transport: &dyn ModelTransport,
        lease: &dyn ModelLeasePort,
        request: &ModelRequest,
        priority: JobPriority,
        cancel: &Cancellation,
    ) -> Result<ModelResponse, ModelError> {
        let started = Instant::now();
        let mut state = self.state.lock().map_err(|_| ModelError::Busy)?;
        if cancel.is_cancelled() {
            return Err(ModelError::Cancelled);
        }
        if state.waiting.len() >= MAX_PENDING_JOBS {
            return Err(ModelError::Busy);
        }
        let id = state.next;
        state.next = state.next.checked_add(1).ok_or(ModelError::Busy)?;
        state.waiting.push_back((id, priority));
        loop {
            if cancel.is_cancelled() || started.elapsed() >= QUEUE_TIMEOUT {
                state.waiting.retain(|(ticket, _)| *ticket != id);
                self.changed.notify_all();
                return Err(if cancel.is_cancelled() {
                    ModelError::Cancelled
                } else {
                    ModelError::Timeout
                });
            }
            let preferred = if state.burst >= INTERACTIVE_BURST {
                JobPriority::Background
            } else {
                JobPriority::Interactive
            };
            let chosen = state
                .waiting
                .iter()
                .find(|(_, p)| *p == preferred)
                .or_else(|| state.waiting.front())
                .map(|(n, _)| *n);
            if !state.running && chosen == Some(id) {
                state.waiting.retain(|(ticket, _)| *ticket != id);
                state.running = true;
                state.burst = if priority == JobPriority::Interactive {
                    state.burst.saturating_add(1)
                } else {
                    0
                };
                break;
            }
            state = self
                .changed
                .wait_timeout(state, POLL)
                .map_err(|_| ModelError::Busy)?
                .0;
        }
        drop(state);
        let _lane = Lane(self);
        let _lease = lease.acquire(cancel)?;
        if cancel.is_cancelled() {
            return Err(ModelError::Cancelled);
        }
        let result = transport.complete(request, cancel);
        if cancel.is_cancelled() {
            Err(ModelError::Cancelled)
        } else {
            result
        }
    }
}
struct Lane<'a>(&'a JobQueue);
impl Drop for Lane<'_> {
    fn drop(&mut self) {
        if let Ok(mut state) = self.0.state.lock() {
            state.running = false;
        }
        self.0.changed.notify_all();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::{Arc, Barrier};
    use synapse_core::{ModelLease, Provider};
    struct Guard;
    impl ModelLease for Guard {}
    struct Lease;
    impl ModelLeasePort for Lease {
        fn acquire(&self, _: &Cancellation) -> Result<Box<dyn ModelLease>, ModelError> {
            Ok(Box::new(Guard))
        }
    }
    struct Transport {
        active: AtomicUsize,
        calls: AtomicUsize,
    }
    impl ModelTransport for Transport {
        fn complete(
            &self,
            _: &ModelRequest,
            _: &Cancellation,
        ) -> Result<ModelResponse, ModelError> {
            assert_eq!(self.active.fetch_add(1, Ordering::SeqCst), 0);
            self.calls.fetch_add(1, Ordering::SeqCst);
            std::thread::sleep(Duration::from_millis(5));
            self.active.fetch_sub(1, Ordering::SeqCst);
            Ok(ModelResponse::Healthy)
        }
    }
    #[test]
    fn competing_jobs_use_one_lane_and_cancelled_jobs_never_reach_transport() {
        let queue = JobQueue::default();
        let transport = Transport {
            active: AtomicUsize::new(0),
            calls: AtomicUsize::new(0),
        };
        let barrier = Barrier::new(7);
        std::thread::scope(|scope| {
            for _ in 0..6 {
                scope.spawn(|| {
                    barrier.wait();
                    assert_eq!(
                        queue.run(
                            &transport,
                            &Lease,
                            &ModelRequest::health(Provider::bonsai()),
                            JobPriority::Background,
                            &Cancellation::default()
                        ),
                        Ok(ModelResponse::Healthy)
                    );
                });
            }
            barrier.wait();
        });
        let cancel = Cancellation::default();
        cancel.cancel();
        assert_eq!(
            queue.run(
                &transport,
                &Lease,
                &ModelRequest::health(Provider::bonsai()),
                JobPriority::Interactive,
                &cancel
            ),
            Err(ModelError::Cancelled)
        );
        assert_eq!(transport.calls.load(Ordering::SeqCst), 6);
    }
    struct Blocking {
        entered: Arc<Barrier>,
        release: Arc<Barrier>,
    }
    impl ModelTransport for Blocking {
        fn complete(
            &self,
            _: &ModelRequest,
            _: &Cancellation,
        ) -> Result<ModelResponse, ModelError> {
            self.entered.wait();
            self.release.wait();
            Ok(ModelResponse::Healthy)
        }
    }
    #[test]
    fn cancelled_running_output_is_suppressed_and_lane_is_released() {
        let queue = JobQueue::default();
        let cancel = Cancellation::default();
        let entered = Arc::new(Barrier::new(2));
        let release = Arc::new(Barrier::new(2));
        let transport = Blocking {
            entered: entered.clone(),
            release: release.clone(),
        };
        std::thread::scope(|scope| {
            let worker = scope.spawn(|| {
                queue.run(
                    &transport,
                    &Lease,
                    &ModelRequest::health(Provider::bonsai()),
                    JobPriority::Background,
                    &cancel,
                )
            });
            entered.wait();
            cancel.cancel();
            release.wait();
            assert_eq!(
                worker
                    .join()
                    .unwrap_or_else(|_| panic!("synthetic fixture failed")),
                Err(ModelError::Cancelled)
            );
        });
        let transport = Transport {
            active: AtomicUsize::new(0),
            calls: AtomicUsize::new(0),
        };
        assert_eq!(
            queue.run(
                &transport,
                &Lease,
                &ModelRequest::health(Provider::bonsai()),
                JobPriority::Interactive,
                &Cancellation::default()
            ),
            Ok(ModelResponse::Healthy)
        );
    }
    #[test]
    fn bounded_pending_queue_and_wait_cancellation() {
        let queue = JobQueue::default();
        // Exercise admission against a busy lane with a full pending set.
        {
            let mut state = queue
                .state
                .lock()
                .unwrap_or_else(|_| panic!("synthetic fixture failed"));
            state.running = true;
            state.waiting = (0..MAX_PENDING_JOBS as u64)
                .map(|i| (i, JobPriority::Background))
                .collect();
        }
        let transport = Transport {
            active: AtomicUsize::new(0),
            calls: AtomicUsize::new(0),
        };
        let request = ModelRequest::health(Provider::bonsai());
        let cancel = Cancellation::default();
        assert_eq!(
            queue.run(
                &transport,
                &Lease,
                &request,
                JobPriority::Interactive,
                &cancel
            ),
            Err(ModelError::Busy)
        );
        queue
            .state
            .lock()
            .unwrap_or_else(|_| panic!("synthetic fixture failed"))
            .waiting
            .clear();
        std::thread::scope(|scope| {
            let waiter = scope.spawn(|| {
                queue.run(
                    &transport,
                    &Lease,
                    &request,
                    JobPriority::Interactive,
                    &cancel,
                )
            });
            loop {
                if !queue
                    .state
                    .lock()
                    .unwrap_or_else(|_| panic!("synthetic fixture failed"))
                    .waiting
                    .is_empty()
                {
                    break;
                }
                std::thread::yield_now();
            }
            cancel.cancel();
            assert_eq!(
                waiter
                    .join()
                    .unwrap_or_else(|_| panic!("synthetic fixture failed")),
                Err(ModelError::Cancelled)
            );
        });
        assert!(
            queue
                .state
                .lock()
                .unwrap_or_else(|_| panic!("synthetic fixture failed"))
                .waiting
                .is_empty()
        );
        assert_eq!(transport.calls.load(Ordering::SeqCst), 0);
    }
}
