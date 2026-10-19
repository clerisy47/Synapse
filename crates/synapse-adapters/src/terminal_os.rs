use synapse_core::{Cancellation, PublicError};
const MAX_TERMINAL_READ_BYTES: usize = 1026;
const INPUT_POLL_NANOS: i64 = 25_000_000;
pub fn install_interrupt(cancel: Cancellation) -> Result<(), PublicError> {
    ctrlc::set_handler(move || cancel.cancel()).map_err(|_| PublicError::WorkspaceUnavailable)
}
pub fn terminal_columns() -> usize {
    rustix::termios::tcgetwinsize(std::io::stdout())
        .map(|size| usize::from(size.ws_col).clamp(8, 240))
        .unwrap_or(80)
}

/// Read only a ready cooked-terminal line; no detached blocking input worker.
pub fn terminal_input(cancel: &Cancellation) -> Result<Option<Vec<u8>>, PublicError> {
    let input = std::io::stdin();
    loop {
        if cancel.is_cancelled() {
            return Err(PublicError::Cancelled);
        }
        let mut fds = [rustix::event::PollFd::new(
            &input,
            rustix::event::PollFlags::IN,
        )];
        let timeout = rustix::event::Timespec {
            tv_sec: 0,
            tv_nsec: INPUT_POLL_NANOS,
        };
        match rustix::event::poll(&mut fds, Some(&timeout)) {
            Ok(0) => continue,
            Err(rustix::io::Errno::INTR) => continue,
            Err(_) => return Err(PublicError::TtyRequired),
            Ok(_) => (),
        }
        if cancel.is_cancelled() {
            return Err(PublicError::Cancelled);
        }
        let mut bytes = [0; MAX_TERMINAL_READ_BYTES];
        let count = match rustix::io::read(&input, &mut bytes) {
            Ok(count) => count,
            Err(rustix::io::Errno::INTR) => continue,
            Err(_) if cancel.is_cancelled() => return Err(PublicError::Cancelled),
            Err(_) => return Err(PublicError::TtyRequired),
        };
        if count == 0 {
            return Ok(None);
        }
        return Ok(Some(bytes[..count].to_vec()));
    }
}

pub fn terminal_rows() -> usize {
    rustix::termios::tcgetwinsize(std::io::stdout())
        .map(|size| usize::from(size.ws_row).clamp(8, 100))
        .unwrap_or(24)
}
