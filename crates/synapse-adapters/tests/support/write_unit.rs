// Included as adapter unit tests to exercise the restricted writer without
// introducing a production approval bypass or crash-control environment flag.
use super::*;
use std::{error::Error, fs};
use synapse_core::{Cancellation, NotePath};
#[test]
fn writer_child() -> Result<(), Box<dyn Error>> {
    let Some(root) = std::env::var_os("SYNAPSE_WRITE_FIXTURE") else {
        return Ok(());
    };
    let root = std::path::PathBuf::from(root);
    let reader = CanonicalWorkspace::open(&root).map_err(|_| "root")?;
    let store = DiskStateStore::open(&reader).map_err(|_| "state")?;
    let path = NotePath::parse("note.md").map_err(|_| "path")?;
    let before = reader.snapshot_note(&path).map_err(|_| "snapshot")?;
    let after = "---\ndescription: Synthetic\ntags: [test]\naliases: []\n---\nAfter\n";
    let proposal = Proposal {
        kind: ProposalKind::Metadata,
        target: before.clone(),
        after: after.into(),
        sources: vec![],
        capture: None,
    };
    // Current exclusions apply to both halves of a retained diff, including
    // revert content which was eligible under an earlier configuration.
    let mut excluded = reader.access_policy().clone();
    excluded.tags.push("test".into());
    assert!(!synapse_core::proposal_access(&excluded, &proposal));
    let mut old_excluded = proposal.clone();
    old_excluded.target.before = Some(after.into());
    old_excluded.after = "Old untagged bytes".into();
    old_excluded.kind = ProposalKind::Revert;
    assert!(!synapse_core::proposal_access(&excluded, &old_excluded));
    // Durable intent with no attempt reconciles as refused, never replays.
    let mut journal = store.journal(&reader).map_err(|_| "journal")?;
    journal.records = vec![JournalRecord {
        id: ContentHash::of(b"synthetic"),
        created: reader.unix_seconds().map_err(|_| "time")?,
        proposal: proposal.clone(),
        outcome: WriteOutcome::Intent,
    }];
    store.save_journal(&journal).map_err(|_| "intent")?;
    assert!(store.history(&reader).map_err(|_| "recover")?[0].outcome == WriteOutcome::Refused);
    // Simulated process loss after atomic write but before outcome persistence.
    journal.records[0].outcome = WriteOutcome::Intent;
    store.save_journal(&journal).map_err(|_| "intent")?;
    reader
        .replace_reviewed(&before, after, ProposalKind::Metadata)
        .map_err(|_| "write")?;
    assert!(store.history(&reader).map_err(|_| "recover")?[0].outcome == WriteOutcome::Applied);
    assert_eq!(fs::read_to_string(root.join("note.md"))?, after);
    assert!(matches!(
        reader.replace_reviewed(&before, "wrong", ProposalKind::Metadata),
        Err(PublicError::Conflict)
    ));
    // Divergent bytes cannot be replayed or considered a successful write.
    fs::write(root.join("note.md"), "External edit\n")?;
    journal.records[0].outcome = WriteOutcome::Intent;
    store.save_journal(&journal).map_err(|_| "intent")?;
    assert!(store.history(&reader).map_err(|_| "recover")?[0].outcome == WriteOutcome::Unknown);
    assert_eq!(fs::read_to_string(root.join("note.md"))?, "External edit\n");
    // Resolved records expire on access; uncertain records are retained.
    journal.records[0].created = reader
        .unix_seconds()
        .map_err(|_| "clock")?
        .saturating_sub(RETAIN_SECONDS + 1);
    journal.records[0].outcome = WriteOutcome::Applied;
    store
        .save_journal(&journal)
        .map_err(|_| "expired journal")?;
    assert!(store.history(&reader).map_err(|_| "prune")?.is_empty());
    journal.records[0].outcome = WriteOutcome::Unknown;
    store
        .save_journal(&journal)
        .map_err(|_| "uncertain journal")?;
    assert_eq!(store.history(&reader).map_err(|_| "retain")?.len(), 1);
    let mut oversized = journal.records[0].clone();
    oversized.proposal.target.before = Some("x".repeat(128_000));
    oversized.proposal.after = "y".repeat(128_000);
    let large = Journal {
        version: 1,
        workspace: reader.workspace_id().map_err(|_| "root")?,
        epoch: 0,
        records: vec![oversized; 20],
    };
    assert!(matches!(
        store.save_journal(&large),
        Err(PublicError::CapacityExceeded)
    ));
    // Symlink descendants and protected controls never become write targets.
    let missing = reader
        .snapshot_note(&NotePath::parse("new.md").map_err(|_| "path")?)
        .map_err(|_| "new")?;
    std::os::unix::fs::symlink(root.join("note.md"), root.join("new.md"))?;
    assert!(
        reader
            .replace_reviewed(&missing, after, ProposalKind::Research)
            .is_err()
    );
    let control = reader
        .snapshot_control(ControlFile::Research)
        .map_err(|_| "inbox")?;
    assert!(
        reader
            .replace_reviewed(&control, after, ProposalKind::Metadata)
            .is_err()
    );
    // Cancellation suppresses a write before staging.
    let cancel = Cancellation::default();
    let cancelled = CanonicalWorkspace::open(&root)
        .map_err(|_| "root")?
        .with_cancellation(cancel.clone());
    cancel.cancel();
    assert!(
        cancelled
            .replace_reviewed(&before, after, ProposalKind::Metadata)
            .is_err()
    );
    Ok(())
}
#[test]
fn crash_reconciliation_and_restricted_writer() -> Result<(), Box<dyn Error>> {
    let base = std::env::temp_dir().join(format!("synapse-write-{}", std::process::id()));
    fs::create_dir(&base)?;
    let base = base.canonicalize()?;
    fs::create_dir(base.join("home"))?;
    fs::create_dir(base.join("workspace"))?;
    fs::write(base.join("workspace/note.md"), "Before\n")?;
    fs::write(base.join("workspace/Research.md"), "Unverified\n")?;
    let child = std::process::Command::new(std::env::current_exe()?)
        .args([
            "--exact",
            "approved_write::tests::writer_child",
            "--nocapture",
        ])
        .env("HOME", base.join("home"))
        .env_remove("XDG_STATE_HOME")
        .env("SYNAPSE_WRITE_FIXTURE", base.join("workspace"))
        .output()?;
    assert!(
        child.status.success(),
        "synthetic write child failed: {} {}",
        String::from_utf8_lossy(&child.stdout),
        String::from_utf8_lossy(&child.stderr)
    );
    fs::remove_dir_all(base)?;
    Ok(())
}

#[test]
fn crash_phase_child() -> Result<(), Box<dyn Error>> {
    let Some(root) = std::env::var_os("SYNAPSE_CRASH_FIXTURE") else {
        return Ok(());
    };
    let root = std::path::PathBuf::from(root);
    let reader = CanonicalWorkspace::open(&root).map_err(|_| "root")?;
    let store = DiskStateStore::open(&reader).map_err(|_| "store")?;
    let path = NotePath::parse("note.md").map_err(|_| "path")?;
    let phase = std::env::var("SYNAPSE_CRASH_PHASE")?;
    if phase == "recover" {
        let history = store.history(&reader).map_err(|_| "reconcile")?;
        assert_eq!(history.len(), 1);
        let expected = std::env::var("SYNAPSE_EXPECT_AFTER")? == "1";
        assert!(
            history[0].outcome
                == if expected {
                    WriteOutcome::Applied
                } else {
                    WriteOutcome::Refused
                }
        );
        return Ok(());
    }
    let _lock = store.lock().map_err(|_| "lock")?;
    let before = reader.snapshot_note(&path).map_err(|_| "snapshot")?;
    let after = "---\ndescription: Synthetic\ntags: [test]\naliases: []\n---\nAfter\n";
    let journal = Journal {
        version: 1,
        workspace: reader.workspace_id().map_err(|_| "identity")?,
        epoch: 0,
        records: vec![JournalRecord {
            id: ContentHash::of(b"crash"),
            created: reader.unix_seconds().map_err(|_| "clock")?,
            proposal: Proposal {
                kind: ProposalKind::Metadata,
                target: before.clone(),
                after: after.into(),
                sources: Vec::new(),
                capture: None,
            },
            outcome: WriteOutcome::Intent,
        }],
    };
    store.save_journal(&journal).map_err(|_| "intent")?;
    if phase == "after" {
        reader
            .replace_reviewed(&before, after, ProposalKind::Metadata)
            .map_err(|_| "replace")?;
    }
    // Test executable only: exit without running Rust destructors or outcome code.
    std::process::exit(77);
}
#[test]
fn independent_restart_reconciles_both_crash_windows() -> Result<(), Box<dyn Error>> {
    for phase in ["before", "after"] {
        let base =
            std::env::temp_dir().join(format!("synapse-crash-{}-{phase}", std::process::id()));
        fs::create_dir(&base)?;
        let base = base.canonicalize()?;
        fs::create_dir(base.join("home"))?;
        fs::create_dir(base.join("workspace"))?;
        fs::write(base.join("workspace/note.md"), "Before\n")?;
        let run = |step: &str| -> Result<std::process::Output, std::io::Error> {
            std::process::Command::new(std::env::current_exe()?)
                .args([
                    "--exact",
                    "approved_write::tests::crash_phase_child",
                    "--nocapture",
                ])
                .env("HOME", base.join("home"))
                .env_remove("XDG_STATE_HOME")
                .env("SYNAPSE_CRASH_FIXTURE", base.join("workspace"))
                .env("SYNAPSE_CRASH_PHASE", step)
                .env(
                    "SYNAPSE_EXPECT_AFTER",
                    if phase == "after" { "1" } else { "0" },
                )
                .output()
        };
        assert_eq!(run(phase)?.status.code(), Some(77));
        let recovered = run("recover")?;
        assert!(
            recovered.status.success(),
            "restart reconciliation failed: {} {}",
            String::from_utf8_lossy(&recovered.stdout),
            String::from_utf8_lossy(&recovered.stderr)
        );
        if phase == "before" {
            assert_eq!(
                fs::read_to_string(base.join("workspace/note.md"))?,
                "Before\n"
            );
        }
        fs::remove_dir_all(base)?;
    }
    Ok(())
}

#[test]
fn competing_writer_child() -> Result<(), Box<dyn Error>> {
    let Some(base) = std::env::var_os("SYNAPSE_COMPETE_FIXTURE") else {
        return Ok(());
    };
    let base = std::path::PathBuf::from(base);
    let reader = CanonicalWorkspace::open(&base.join("workspace")).map_err(|_| "root")?;
    let store = DiskStateStore::open(&reader).map_err(|_| "state")?;
    let target = reader
        .snapshot_note(&NotePath::parse("note.md").map_err(|_| "path")?)
        .map_err(|_| "snapshot")?;
    let id = std::env::var("SYNAPSE_COMPETE_ID")?;
    fs::write(base.join(format!("ready-{id}")), b"ready")?;
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(3);
    while !(base.join("ready-1").exists() && base.join("ready-2").exists()) {
        assert!(std::time::Instant::now() < deadline, "barrier timeout");
        std::thread::sleep(std::time::Duration::from_millis(10));
    }
    let _lock = store.lock().map_err(|_| "lock")?;
    let result = reader.replace_reviewed(
        &target,
        "---\ndescription: Synthetic\ntags: [test]\naliases: []\n---\nWinner\n",
        ProposalKind::Metadata,
    );
    fs::write(
        base.join(format!("result-{id}")),
        match result {
            Ok(()) => "applied",
            Err(PublicError::Conflict) => "conflict",
            Err(_) => "unexpected",
        },
    )?;
    Ok(())
}
#[test]
fn competing_processes_cannot_both_apply_one_snapshot() -> Result<(), Box<dyn Error>> {
    let base = std::env::temp_dir().join(format!("synapse-compete-{}", std::process::id()));
    fs::create_dir(&base)?;
    let base = base.canonicalize()?;
    fs::create_dir(base.join("home"))?;
    fs::create_dir(base.join("workspace"))?;
    fs::write(base.join("workspace/note.md"), "Before\n")?;
    let mut children = Vec::new();
    for id in ["1", "2"] {
        children.push(
            std::process::Command::new(std::env::current_exe()?)
                .args(["--exact", "approved_write::tests::competing_writer_child"])
                .env("HOME", base.join("home"))
                .env_remove("XDG_STATE_HOME")
                .env("SYNAPSE_COMPETE_FIXTURE", &base)
                .env("SYNAPSE_COMPETE_ID", id)
                .stdout(std::process::Stdio::piped())
                .stderr(std::process::Stdio::piped())
                .spawn()?,
        );
    }
    for child in children {
        let output = child.wait_with_output()?;
        assert!(
            output.status.success(),
            "competing child failed: {} {}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
    }
    let mut results = vec![
        fs::read_to_string(base.join("result-1"))?,
        fs::read_to_string(base.join("result-2"))?,
    ];
    results.sort();
    assert_eq!(results, vec!["applied", "conflict"]);
    fs::remove_dir_all(base)?;
    Ok(())
}
