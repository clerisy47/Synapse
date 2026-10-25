use std::{
    collections::VecDeque,
    sync::{Condvar, Mutex},
    time::{Duration, Instant},
};
use synapse_core::{Cancellation, ModelJob, ModelResult, ModelService, Priority, PublicError};

pub const MAX_QUEUE_DEPTH: usize = 16;
pub const QUEUE_WAIT: Duration = Duration::from_secs(30);
const INTERACTIVE_BURST: usize = 4;
pub(crate) trait QueuedTransport: Send + Sync {
    fn budget(&self) -> synapse_core::ModelBudget {
        synapse_core::ModelBudget::Local
    }
    fn perform(&self, job: ModelJob, cancel: &Cancellation) -> Result<ModelResult, PublicError>;
}
struct State {
    waiting: VecDeque<(u64, Priority)>,
    next: u64,
    active: bool,
    burst: usize,
}
pub struct JobQueue<T> {
    transport: T,
    state: Mutex<State>,
    changed: Condvar,
}
impl<T> JobQueue<T> {
    pub(crate) fn new(transport: T) -> Self {
        Self {
            transport,
            state: Mutex::new(State {
                waiting: VecDeque::new(),
                next: 0,
                active: false,
                burst: 0,
            }),
            changed: Condvar::new(),
        }
    }
}
struct Active<'a, T>(&'a JobQueue<T>);
impl<T> Drop for Active<'_, T> {
    fn drop(&mut self) {
        if let Ok(mut state) = self.0.state.lock() {
            state.active = false;
            self.0.changed.notify_all();
        }
    }
}
impl<T: QueuedTransport> ModelService for JobQueue<T> {
    fn budget(&self) -> synapse_core::ModelBudget {
        self.transport.budget()
    }
    fn execute(
        &self,
        job: ModelJob,
        priority: Priority,
        cancel: &Cancellation,
    ) -> Result<ModelResult, PublicError> {
        let deadline = Instant::now() + QUEUE_WAIT;
        let mut state = self
            .state
            .lock()
            .map_err(|_| PublicError::ProviderUnavailable)?;
        if state.waiting.len() >= MAX_QUEUE_DEPTH {
            return Err(PublicError::QueueFull);
        }
        let ticket = state.next;
        state.next = state
            .next
            .checked_add(1)
            .ok_or(PublicError::ResourceLimit)?;
        state.waiting.push_back((ticket, priority));
        loop {
            if cancel.is_cancelled() || Instant::now() >= deadline {
                state.waiting.retain(|(id, _)| *id != ticket);
                self.changed.notify_all();
                return Err(if cancel.is_cancelled() {
                    PublicError::Cancelled
                } else {
                    PublicError::ProviderUnavailable
                });
            }
            let background = state
                .waiting
                .iter()
                .position(|(_, p)| *p == Priority::Background);
            let interactive = state
                .waiting
                .iter()
                .position(|(_, p)| *p == Priority::Interactive);
            let selected = if state.burst >= INTERACTIVE_BURST {
                background.or(interactive)
            } else {
                interactive.or(background)
            };
            if !state.active && selected.is_some_and(|index| state.waiting[index].0 == ticket) {
                state.waiting.retain(|(id, _)| *id != ticket);
                state.active = true;
                state.burst = if priority == Priority::Interactive {
                    state.burst.saturating_add(1)
                } else {
                    0
                };
                break;
            }
            state = self
                .changed
                .wait_timeout(state, Duration::from_millis(25))
                .map_err(|_| PublicError::ProviderUnavailable)?
                .0;
        }
        drop(state);
        let _active = Active(self);
        let result = self.transport.perform(job, cancel);
        if cancel.is_cancelled() {
            Err(PublicError::Cancelled)
        } else {
            result
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    };
    struct Transport {
        active: Arc<AtomicUsize>,
        maximum: Arc<AtomicUsize>,
        calls: Arc<AtomicUsize>,
    }
    impl QueuedTransport for Transport {
        fn perform(&self, _: ModelJob, _: &Cancellation) -> Result<ModelResult, PublicError> {
            self.calls.fetch_add(1, Ordering::SeqCst);
            let active = self.active.fetch_add(1, Ordering::SeqCst) + 1;
            self.maximum.fetch_max(active, Ordering::SeqCst);
            std::thread::sleep(Duration::from_millis(10));
            self.active.fetch_sub(1, Ordering::SeqCst);
            Ok(ModelResult::Healthy)
        }
    }
    #[test]
    fn serializes_concurrent_calls_and_refuses_cancelled_work() {
        let active = Arc::new(AtomicUsize::new(0));
        let maximum = Arc::new(AtomicUsize::new(0));
        let calls = Arc::new(AtomicUsize::new(0));
        let queue = Arc::new(JobQueue::new(Transport {
            active,
            maximum: maximum.clone(),
            calls: calls.clone(),
        }));
        let threads: Vec<_> = (0..8)
            .map(|_| {
                let queue = queue.clone();
                std::thread::spawn(move || {
                    assert!(
                        queue
                            .execute(
                                ModelJob::Health,
                                Priority::Interactive,
                                &Cancellation::default()
                            )
                            .is_ok()
                    )
                })
            })
            .collect();
        for thread in threads {
            assert!(thread.join().is_ok());
        }
        assert_eq!(maximum.load(Ordering::SeqCst), 1);
        assert_eq!(calls.load(Ordering::SeqCst), 8);
        let cancel = Cancellation::default();
        cancel.cancel();
        assert!(matches!(
            queue.execute(ModelJob::Health, Priority::Interactive, &cancel),
            Err(PublicError::Cancelled)
        ));
        assert_eq!(calls.load(Ordering::SeqCst), 8);
    }
    struct LateTransport {
        entered: std::sync::mpsc::SyncSender<()>,
        release: Mutex<std::sync::mpsc::Receiver<()>>,
    }
    impl QueuedTransport for LateTransport {
        fn perform(&self, _: ModelJob, _: &Cancellation) -> Result<ModelResult, PublicError> {
            self.entered
                .send(())
                .map_err(|_| PublicError::ProviderUnavailable)?;
            self.release
                .lock()
                .map_err(|_| PublicError::ProviderUnavailable)?
                .recv_timeout(Duration::from_secs(2))
                .map_err(|_| PublicError::ProviderUnavailable)?;
            Ok(ModelResult::Healthy)
        }
    }
    #[test]
    fn cancellation_suppresses_an_active_late_result() {
        let (entered_tx, entered_rx) = std::sync::mpsc::sync_channel(1);
        let (release_tx, release_rx) = std::sync::mpsc::sync_channel(1);
        let queue = Arc::new(JobQueue::new(LateTransport {
            entered: entered_tx,
            release: Mutex::new(release_rx),
        }));
        let cancel = Cancellation::default();
        let worker_cancel = cancel.clone();
        let worker = std::thread::spawn(move || {
            queue.execute(ModelJob::Health, Priority::Background, &worker_cancel)
        });
        assert!(entered_rx.recv_timeout(Duration::from_secs(2)).is_ok());
        cancel.cancel();
        assert!(release_tx.send(()).is_ok());
        assert!(matches!(worker.join(), Ok(Err(PublicError::Cancelled))));
    }
}
