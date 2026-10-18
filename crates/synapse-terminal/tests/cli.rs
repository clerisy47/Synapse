use std::process::Command;
fn binary() -> Command {
    Command::new(env!("CARGO_BIN_EXE_synapse"))
}
#[test]
fn help_and_version_do_not_require_workspace() -> Result<(), Box<dyn std::error::Error>> {
    for flag in ["--help", "--version"] {
        let output = binary().arg(flag).output()?;
        assert!(output.status.success());
        assert!(output.stderr.is_empty());
    }
    Ok(())
}
#[test]
fn invalid_root_has_content_free_diagnostic() -> Result<(), Box<dyn std::error::Error>> {
    let output = binary()
        .args([
            "doctor",
            "--workspace",
            "/nonexistent-private-note-sentinel",
        ])
        .output()?;
    assert_eq!(output.status.code(), Some(2));
    assert!(output.stdout.is_empty());
    assert_eq!(output.stderr, b"synapse: workspace_unavailable\n");
    Ok(())
}
#[test]
fn piped_input_cannot_open_interactive_session() -> Result<(), Box<dyn std::error::Error>> {
    let output = binary().args(["--workspace", "."]).output()?;
    assert_eq!(output.status.code(), Some(2));
    assert!(output.stdout.is_empty());
    assert_eq!(output.stderr, b"synapse: tty_required\n");
    Ok(())
}
