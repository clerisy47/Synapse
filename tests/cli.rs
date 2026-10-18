use std::process::{Command, Output};

fn run(args: &[&str]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_synapse"))
        .args(args)
        .output()
        .unwrap_or_else(|e| panic!("subprocess failed: {e}"))
}

#[test]
fn help_and_version_work_without_workspace() {
    let help = run(&["--help"]);
    assert!(help.status.success());
    assert!(help.stderr.is_empty());
    assert!(String::from_utf8_lossy(&help.stdout).contains("synapse ask --workspace"));
    let version = run(&["--version"]);
    assert!(version.status.success());
    assert_eq!(version.stdout, b"synapse 0.1.0\n");
}

#[test]
fn rejects_implicit_workspaces_and_unsupported_commands_without_argument_leaks() {
    for args in [
        vec![],
        vec!["--workspace"],
        vec!["ask", "secret-question"],
        vec!["--yes"],
        vec!["--workspace", "/secret", "--json"],
    ] {
        let result = run(&args);
        assert_eq!(result.status.code(), Some(2));
        assert!(result.stdout.is_empty());
        assert_eq!(result.stderr, b"USAGE\n");
    }
}

#[test]
fn redirected_input_never_starts_workspace_access_or_approves() {
    let result = run(&["--workspace", "/private/never-inspected"]);
    assert_eq!(result.status.code(), Some(3));
    assert!(result.stdout.is_empty());
    assert_eq!(result.stderr, b"INTERACTIVE_REQUIRED\n");
}
