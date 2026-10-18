//! Argument parsing and plain-text terminal boundary.
mod strings;
use std::{
    ffi::OsString,
    io::{self, IsTerminal, Write},
    path::PathBuf,
    process::ExitCode,
};
use synapse_adapters::CanonicalWorkspace;
use synapse_core::{
    Cancellation, ModelJob, ModelService, Priority, PublicError, WorkspaceReadPort,
};

#[derive(Debug, PartialEq)]
enum Invocation {
    Help,
    Version,
    Doctor(PathBuf, bool),
    Interactive(PathBuf),
}
fn parse(args: Vec<OsString>) -> Result<Invocation, PublicError> {
    match args.as_slice() {
        [arg] if arg == "--help" || arg == "-h" => Ok(Invocation::Help),
        [arg] if arg == "--version" || arg == "-V" => Ok(Invocation::Version),
        [flag, root] if flag == "--workspace" => Ok(Invocation::Interactive(root.into())),
        [cmd, flag, root] if cmd == "doctor" && flag == "--workspace" => {
            Ok(Invocation::Doctor(root.into(), false))
        }
        [cmd, flag, root, offline]
            if cmd == "doctor" && flag == "--workspace" && offline == "--offline" =>
        {
            Ok(Invocation::Doctor(root.into(), true))
        }
        _ => Err(PublicError::Usage),
    }
}
/// Remove controls and Unicode direction/format controls from intentional display.
pub fn sanitize(value: &str) -> String {
    value.chars().filter(|c| !c.is_control() && !matches!(*c,
        '\u{061c}' | '\u{200b}'..='\u{200f}' | '\u{2028}'..='\u{202e}' | '\u{2060}'..='\u{206f}' | '\u{feff}'
    )).collect()
}
fn execute(args: Vec<OsString>) -> Result<(), PublicError> {
    let command = parse(args)?;
    let mut output = io::stdout().lock();
    let result = match command {
        Invocation::Help => write!(output, "{}", strings::HELP),
        Invocation::Version => writeln!(output, "synapse {}", env!("CARGO_PKG_VERSION")),
        Invocation::Doctor(root, offline) => {
            let _workspace = CanonicalWorkspace::open(&root)?;
            if offline {
                writeln!(output, "{}", strings::DOCTOR_OFFLINE)
            } else {
                let queue = synapse_adapters::local_queue();
                let _ = queue.execute(
                    ModelJob::Health,
                    Priority::Interactive,
                    &Cancellation::default(),
                )?;
                writeln!(output, "{}", strings::DOCTOR_READY)
            }
        }
        Invocation::Interactive(root) => {
            if !io::stdin().is_terminal() || !io::stdout().is_terminal() {
                return Err(PublicError::TtyRequired);
            }
            let workspace = CanonicalWorkspace::open(&root)?;
            writeln!(
                output,
                "{}{}",
                strings::ROOT,
                sanitize(workspace.identity().display())
            )
            .map_err(|_| PublicError::OutputUnavailable)?;
            output.flush().map_err(|_| PublicError::OutputUnavailable)?;
            return Err(PublicError::NotImplemented);
        }
    };
    result
        .and_then(|_| output.flush())
        .map_err(|_| PublicError::OutputUnavailable)
}

pub fn run(args: Vec<OsString>) -> ExitCode {
    match execute(args) {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            let _ = writeln!(io::stderr(), "synapse: {}", error.code());
            ExitCode::from(error.exit_code())
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn refuses_implicit_root_and_approval_flags() {
        for args in [
            vec![],
            vec!["--yes"],
            vec!["--workspace"],
            vec!["ask", "secret"],
        ] {
            assert_eq!(
                parse(args.into_iter().map(Into::into).collect()),
                Err(PublicError::Usage)
            );
        }
    }
    #[test]
    fn removes_terminal_controls_and_direction_overrides() {
        assert_eq!(sanitize("a\x1b[2J\r\n\u{202e}b"), "a[2Jb");
    }
}
