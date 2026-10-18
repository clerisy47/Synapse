use synapse_core::{
    Cancellation, Evidence, ModelJob, ModelResult, ModelService, NotePath, Priority,
};
#[test]
#[ignore = "requires the user-managed Bonsai 9B PQ2 runtime on 127.0.0.1:18080"]
fn synthetic_bonsai_health_and_selection() -> Result<(), Box<dyn std::error::Error>> {
    if std::env::var_os("SYNAPSE_SYNTHETIC_CHILD").is_none() {
        let home = std::env::temp_dir().join(format!("synapse-provider-{}", std::process::id()));
        std::fs::create_dir(&home)?;
        let canonical = home.canonicalize()?;
        let output = std::process::Command::new(std::env::current_exe()?)
            .args([
                "--exact",
                "synthetic_bonsai_health_and_selection",
                "--ignored",
                "--nocapture",
            ])
            .env("HOME", &canonical)
            .env_remove("XDG_STATE_HOME")
            .env("SYNAPSE_SYNTHETIC_CHILD", "1")
            .output()?;
        std::fs::remove_dir_all(home)?;
        assert!(
            output.status.success(),
            "synthetic provider child failed: {} {}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        return Ok(());
    }
    let home = std::path::PathBuf::from(std::env::var_os("HOME").ok_or("fixture home")?);
    let workspace = home.join("workspace");
    std::fs::create_dir(&workspace)?;
    std::fs::write(
        workspace.join("synthetic.md"),
        "---\ndescription: Synthetic fixture\ntags: [fixture]\naliases: []\n---\nThe synthetic moon orbits at 42 units.\n",
    )?;
    let reader = std::sync::Arc::new(
        synapse_adapters::CanonicalWorkspace::open(&workspace).map_err(|_| "fixture root")?,
    );
    let queue =
        synapse_adapters::workspace_local_queue(reader, synapse_core::AccessPolicy::default());
    let cancel = Cancellation::default();
    assert!(matches!(
        queue.execute(ModelJob::Health, Priority::Interactive, &cancel),
        Ok(ModelResult::Healthy)
    ));
    let evidence = Evidence {
        id: 1,
        path: NotePath::parse("synthetic.md").map_err(|_| "fixture path")?,
        start_line: 6,
        end_line: 6,
        text: "The synthetic moon orbits at 42 units.".into(),
    };
    let result = queue.execute(
        ModelJob::SelectEvidence {
            question: "At what distance does the synthetic moon orbit?".into(),
            evidence: vec![evidence],
        },
        Priority::Interactive,
        &cancel,
    );
    match result {
        Ok(ModelResult::Selected(ids)) => assert_eq!(ids, vec![1]),
        Err(error) => panic!("selection failed: {}", error.code()),
        _ => panic!("unexpected synthetic selection"),
    }
    Ok(())
}
