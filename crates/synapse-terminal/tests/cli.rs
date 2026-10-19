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
#[test]
fn empty_workspace_has_one_versioned_insufficient_result() -> Result<(), Box<dyn std::error::Error>>
{
    let root = std::env::temp_dir().join(format!("synapse-json-{}", std::process::id()));
    std::fs::create_dir(&root)?;
    let output = binary()
        .arg("ask")
        .arg("--workspace")
        .arg(&root)
        .args(["unknown synthetic question", "--json"])
        .output()?;
    std::fs::remove_dir(root)?;
    assert!(output.status.success());
    let value: serde_json::Value = serde_json::from_slice(&output.stdout)?;
    assert_eq!(value["version"], 1);
    assert_eq!(value["status"], "insufficient_evidence");
    assert!(value["answer"].is_null());
    assert_eq!(value["sources"], serde_json::json!([]));
    assert!(!String::from_utf8_lossy(&output.stderr).contains("unknown synthetic question"));
    Ok(())
}
#[test]
fn json_usage_errors_are_content_free_and_remote_requires_consent()
-> Result<(), Box<dyn std::error::Error>> {
    let output = binary()
        .args([
            "ask",
            "--workspace",
            "/private-sentinel",
            "secret-question-sentinel",
            "--json",
            "--provider",
            "openrouter",
            "--model",
            "example/model",
        ])
        .output()?;
    assert_eq!(output.status.code(), Some(3));
    let value: serde_json::Value = serde_json::from_slice(&output.stdout)?;
    assert_eq!(value["error"]["code"], "remote_consent_required");
    for bytes in [&output.stdout, &output.stderr] {
        assert!(!String::from_utf8_lossy(bytes).contains("private-sentinel"));
        assert!(!String::from_utf8_lossy(bytes).contains("secret-question-sentinel"));
    }
    Ok(())
}

#[test]
fn missing_metadata_explains_eligibility_without_disclosing_or_mutating_notes()
-> Result<(), Box<dyn std::error::Error>> {
    let root =
        std::env::temp_dir().join(format!("synapse-metadata-guidance-{}", std::process::id()));
    std::fs::create_dir(&root)?;
    let body = "# Private sentinel\nprivate-note-body-sentinel\n";
    std::fs::write(root.join("private-name-sentinel.md"), body)?;
    std::fs::write(root.join("Research.md"), "protected-control-sentinel")?;
    for command in ["search", "ask"] {
        let output = binary()
            .arg(command)
            .arg("--workspace")
            .arg(&root)
            .args(["unmatched", "--json"])
            .output()?;
        assert!(output.status.success());
        let value: serde_json::Value = serde_json::from_slice(&output.stdout)?;
        assert_eq!(value["version"], 1);
        assert_eq!(value["status"], "insufficient_evidence");
        let diagnostics = String::from_utf8_lossy(&output.stderr);
        assert!(diagnostics.contains("metadata attention count: 1"));
        assert!(diagnostics.contains("metadata review"));
        for forbidden in [
            "private-name-sentinel",
            "private-note-body-sentinel",
            "protected-control-sentinel",
        ] {
            assert!(!diagnostics.contains(forbidden));
        }
        assert_eq!(
            std::fs::read_to_string(root.join("private-name-sentinel.md"))?,
            body
        );
    }
    std::fs::remove_dir_all(root)?;
    Ok(())
}
