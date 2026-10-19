use std::{error::Error, fs, path::PathBuf};
use synapse_adapters::{CanonicalWorkspace, DiskStateStore};
use synapse_core::{
    ContentHash, ControlFile, MetadataFields, NotePath, ProposalReadPort, StateStore,
    capture_research, metadata_input, metadata_proposal, setup_preview,
};
fn fixture() -> Result<PathBuf, Box<dyn Error>> {
    let root = std::env::var_os("SYNAPSE_RESEARCH_FIXTURE").ok_or("fixture missing")?;
    Ok(PathBuf::from(root))
}
#[test]
fn state_child() -> Result<(), Box<dyn Error>> {
    if std::env::var_os("SYNAPSE_RESEARCH_FIXTURE").is_none() {
        return Ok(());
    }
    let root = fixture()?;
    let reader = CanonicalWorkspace::open(&root).map_err(|_| "root")?;
    let store = DiskStateStore::open(&reader).map_err(|_| "state")?;
    let path = NotePath::parse("Research.md").map_err(|_| "path")?;
    let before = fs::read(root.join("Research.md"))?;
    let first = capture_research(&reader, &store, &path, Some((1, 1))).map_err(|_| "capture")?;
    let second = capture_research(&reader, &store, &path, Some((1, 1))).map_err(|_| "capture")?;
    assert_eq!(first, second);
    assert_eq!(store.captures().map_err(|_| "ledger")?.len(), 1);
    assert_eq!(fs::read(root.join("Research.md"))?, before);
    let preview = setup_preview(&reader, ContentHash::of(b"local")).map_err(|_| "setup")?;
    assert_eq!(preview.proposals.len(), 1);
    assert_eq!(
        preview.proposals[0].target.path.as_str(),
        "Synapse/Instructions.md"
    );
    assert!(!root.join("Synapse").exists());
    let snapshot = reader
        .snapshot_note(&NotePath::parse("missing.md").map_err(|_| "path")?)
        .map_err(|_| "snapshot")?;
    let input = metadata_input(snapshot, reader.access_policy())
        .map_err(|_| "metadata")?
        .ok_or("missing fields")?;
    let fields = MetadataFields {
        description: "Synthetic body note".into(),
        tags: vec!["fixture".into()],
        aliases: Vec::new(),
    };
    let proposal = metadata_proposal(&reader, input, fields).map_err(|_| "proposal")?;
    assert!(proposal.after.ends_with("Body bytes remain exact.\r\n"));
    assert!(proposal.after.contains("existing: value\r\n"));
    assert_eq!(
        fs::read_to_string(root.join("missing.md"))?,
        "---\r\nexisting: value\r\n---\r\nBody bytes remain exact.\r\n"
    );
    assert!(
        reader
            .snapshot_control(ControlFile::Instructions)
            .map_err(|_| "control")?
            .before
            .is_none()
    );
    Ok(())
}
#[test]
fn capture_state_survives_restart_and_generation_never_writes_notes() -> Result<(), Box<dyn Error>>
{
    let base = std::env::temp_dir().join(format!("synapse-research-{}", std::process::id()));
    fs::create_dir(&base)?;
    let canonical = base.canonicalize()?;
    let home = canonical.join("home");
    fs::create_dir(&home)?;
    let root = canonical.join("workspace");
    fs::create_dir(&root)?;
    fs::write(
        root.join("Research.md"),
        "Synthetic research source.\nSecond selection.\n",
    )?;
    fs::write(
        root.join("missing.md"),
        "---\r\nexisting: value\r\n---\r\nBody bytes remain exact.\r\n",
    )?;
    for _ in 0..2 {
        let output = std::process::Command::new(std::env::current_exe()?)
            .args(["--exact", "state_child", "--nocapture"])
            .env("HOME", &home)
            .env_remove("XDG_STATE_HOME")
            .env("SYNAPSE_RESEARCH_FIXTURE", &root)
            .output()?;
        assert!(
            output.status.success(),
            "synthetic research child failed: {} {}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
    }
    fs::remove_dir_all(base)?;
    Ok(())
}

#[test]
fn capacity_child() -> Result<(), Box<dyn Error>> {
    let Some(root) = std::env::var_os("SYNAPSE_CAPACITY_FIXTURE") else {
        return Ok(());
    };
    let root = PathBuf::from(root);
    let reader = CanonicalWorkspace::open(&root).map_err(|_| "root")?;
    let store = DiskStateStore::open(&reader).map_err(|_| "state")?;
    let path = NotePath::parse("Research.md").map_err(|_| "path")?;
    let before = fs::read(root.join("Research.md"))?;
    for index in 1..=synapse_core::MAX_CAPTURES {
        capture_research(&reader, &store, &path, Some((index, index))).map_err(|_| "capture")?;
    }
    assert!(matches!(
        capture_research(&reader, &store, &path, Some((21, 21))),
        Err(synapse_core::PublicError::CapacityExceeded)
    ));
    assert_eq!(store.captures().map_err(|_| "state")?.len(), 20);
    assert_eq!(fs::read(root.join("Research.md"))?, before);
    Ok(())
}
#[test]
fn capture_capacity_refuses_without_eviction_or_inbox_mutation() -> Result<(), Box<dyn Error>> {
    let base = std::env::temp_dir().join(format!("synapse-capacity-{}", std::process::id()));
    fs::create_dir(&base)?;
    let base = base.canonicalize()?;
    fs::create_dir(base.join("home"))?;
    fs::create_dir(base.join("workspace"))?;
    fs::write(
        base.join("workspace/Research.md"),
        (1..=21).fold(String::new(), |mut text, n| {
            text.push_str("Synthetic capture ");
            text.push_str(&n.to_string());
            text.push('\n');
            text
        }),
    )?;
    let output = std::process::Command::new(std::env::current_exe()?)
        .args(["--exact", "capacity_child", "--nocapture"])
        .env("HOME", base.join("home"))
        .env_remove("XDG_STATE_HOME")
        .env("SYNAPSE_CAPACITY_FIXTURE", base.join("workspace"))
        .output()?;
    assert!(
        output.status.success(),
        "capacity child failed: {} {}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    fs::remove_dir_all(base)?;
    Ok(())
}
