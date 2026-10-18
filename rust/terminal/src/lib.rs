mod strings;

use std::io::{self, IsTerminal, Write};
use synapse_application::open_workspace;
use synapse_core::{PublicError, WorkspaceReadPort};

/// No terminal mode is changed by this scaffold. Ctrl-C uses the OS default.
pub fn run(reader: &dyn WorkspaceReadPort) -> u8 {
    let args: Result<Vec<String>, _> = std::env::args_os()
        .skip(1)
        .map(|a| a.into_string())
        .collect();
    let result = args.map_err(|_| PublicError::Usage).and_then(|args| {
        execute(
            reader,
            &args,
            io::stdin().is_terminal() && io::stdout().is_terminal(),
        )
    });
    match result {
        Ok(()) => 0,
        Err(error) => {
            // Fixed diagnostics only: never print an OS error, argument or selected path.
            let _ = writeln!(io::stderr().lock(), "{}", error.code());
            error.exit_code()
        }
    }
}

fn execute(reader: &dyn WorkspaceReadPort, args: &[String], tty: bool) -> Result<(), PublicError> {
    match args {
        [flag] if flag == "--help" || flag == "-h" => output(strings::HELP),
        [flag] if flag == "--version" || flag == "-V" => output(strings::VERSION),
        [flag, selected] if flag == "--workspace" && !selected.starts_with('-') => {
            if !tty {
                return Err(PublicError::InteractiveRequired);
            }
            let workspace = open_workspace(reader, selected)?;
            output(&format!(
                "{}{}",
                strings::ROOT_LABEL,
                sanitize(&workspace.canonical_display)
            ))?;
            output(strings::FOUNDATION_NOTICE)?;
            Err(PublicError::NotImplemented)
        }
        _ => Err(PublicError::Usage),
    }
}

fn output(text: &str) -> Result<(), PublicError> {
    writeln!(io::stdout().lock(), "{text}").map_err(|_| PublicError::Output)
}

/// Escape controls and Unicode direction/format controls in intentional displays.
/// Application-owned line breaks and styling are emitted separately.
pub fn sanitize(text: &str) -> String {
    let mut safe = String::new();
    for c in text.chars() {
        if c.is_control()
            || matches!(c, '\u{061c}' | '\u{200b}'..='\u{200f}'
            | '\u{2028}'..='\u{202e}' | '\u{2060}'..='\u{206f}' | '\u{feff}')
        {
            safe.push_str(&format!("\\u{{{:x}}}", c as u32));
        } else {
            safe.push(c);
        }
    }
    safe
}

#[cfg(test)]
mod tests {
    use super::sanitize;

    #[test]
    fn neutralizes_terminal_and_direction_controls_without_losing_unicode() {
        let raw = "研究\x1b]8;;evil\x07\r\n\u{009b}31m\u{202e}md";
        let safe = sanitize(raw);
        assert!(!safe.chars().any(char::is_control));
        assert!(!safe.contains('\u{202e}'));
        assert!(safe.starts_with("研究\\u{1b}]8;;evil"));
        assert!(safe.contains("\\u{a}"));
    }
}
