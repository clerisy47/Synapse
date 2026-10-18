use std::process::ExitCode;
use synapse_adapters::NativeWorkspace;

fn main() -> ExitCode {
    ExitCode::from(synapse_terminal::run(&NativeWorkspace))
}
