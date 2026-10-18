use std::process::ExitCode;
use synapse_adapters::{NativeSessions, NativeSignals, NativeWorkspace};
fn main() -> ExitCode {
    ExitCode::from(synapse_terminal::run(
        &NativeWorkspace,
        &NativeSessions,
        &NativeSignals,
    ))
}
