use std::io::{self, BufRead, Read};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError};
use std::thread;
use std::time::Duration;
use synapse_core::{Cancellation, PublicError};
const MAX_INPUT_BYTES: u64 = 1024;
const CANCEL_POLL: Duration = Duration::from_millis(20);
pub struct Input(Receiver<Result<Option<String>, PublicError>>);
impl Input {
    pub fn start() -> Result<Self, PublicError> {
        let (send, receive) = mpsc::sync_channel(1);
        // Canonical terminal input stays on a bounded reader thread. No terminal
        // modes change, so idle Ctrl-C can exit without waiting for read_line.
        let worker = thread::Builder::new()
            .name("synapse-input".to_owned())
            .spawn(move || {
                let mut input = io::stdin().lock();
                loop {
                    let mut bytes = Vec::new();
                    let line = match input
                        .by_ref()
                        .take(MAX_INPUT_BYTES + 1)
                        .read_until(b'\n', &mut bytes)
                    {
                        Ok(0) => Ok(None),
                        Ok(_) if bytes.len() as u64 <= MAX_INPUT_BYTES => String::from_utf8(bytes)
                            .map(|s| Some(s.trim_end_matches(['\r', '\n']).to_owned()))
                            .map_err(|_| PublicError::Usage),
                        Ok(_) => Err(PublicError::Usage),
                        Err(_) => Err(PublicError::Runtime),
                    };
                    let finished = !matches!(&line, Ok(Some(_)));
                    if send.send(line).is_err() || finished {
                        break;
                    }
                }
            })
            .map_err(|_| PublicError::Runtime)?;
        drop(worker);
        Ok(Self(receive))
    }
    pub fn next(&self, cancel: &Cancellation) -> Result<Option<String>, PublicError> {
        loop {
            if cancel.is_cancelled() {
                return Err(PublicError::Interrupted);
            }
            match self.0.recv_timeout(CANCEL_POLL) {
                Ok(line) => return line,
                Err(RecvTimeoutError::Timeout) => {}
                Err(RecvTimeoutError::Disconnected) => return Ok(None),
            }
        }
    }
}
