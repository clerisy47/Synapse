use std::{
    error::Error,
    fs,
    path::PathBuf,
    sync::atomic::{AtomicUsize, Ordering},
};
use synapse_adapters::CanonicalWorkspace;
use synapse_core::{AccessPolicy, Corpus, NotePath, NoteReadPort};
static NEXT: AtomicUsize = AtomicUsize::new(0);
struct Temp(PathBuf);
impl Temp {
    fn new() -> Result<Self, Box<dyn Error>> {
        let path = std::env::temp_dir().join(format!(
            "synapse-rust-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir(&path)?;
        Ok(Self(path))
    }
}
impl Drop for Temp {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}
const NOTE: &str = "---\ndescription: Synthetic astronomy\ntags: [science]\naliases: []\n---\n# Orbit\nSynthetic moon orbits at 42 units.\n";
#[test]
fn reads_coordinates_and_invalidates_changed_bytes() -> Result<(), Box<dyn Error>> {
    let root = Temp::new()?;
    fs::write(root.0.join("orbit.md"), NOTE)?;
    let reader = CanonicalWorkspace::open(&root.0).map_err(|_| "open")?;
    let policy = AccessPolicy::default();
    let corpus = Corpus::build(&reader, policy.clone()).map_err(|_| "corpus")?;
    let hits = corpus.query("moon", &reader, &policy);
    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].start_line, 7);
    assert_eq!(hits[0].end_line, 7);
    assert_eq!(hits[0].text, "Synthetic moon orbits at 42 units.");
    fs::write(root.0.join("orbit.md"), NOTE.replace("42", "99"))?;
    assert!(corpus.query("moon", &reader, &policy).is_empty());
    Ok(())
}
#[test]
fn exclusions_and_invalid_metadata_never_become_evidence() -> Result<(), Box<dyn Error>> {
    let root = Temp::new()?;
    fs::create_dir(root.0.join("private"))?;
    fs::create_dir(root.0.join(".git"))?;
    for path in [
        "Research.md",
        "private/a.md",
        ".git/secret.md",
        "visible.md",
    ] {
        fs::write(root.0.join(path), NOTE)?;
    }
    fs::write(
        root.0.join("ignored.md"),
        NOTE.replace(
            "description:",
            "vault-synapse: {ignore: true}\ndescription:",
        ),
    )?;
    for (name, marker) in [
        ("legacy-scalar.md", "vault-synapse: ignore"),
        ("native-scalar.md", "synapse: ignore"),
    ] {
        fs::write(
            root.0.join(name),
            NOTE.replace("description:", &format!("{marker}\ndescription:")),
        )?;
    }
    fs::write(
        root.0.join("broken.md"),
        "---\ntags: [\n---\nprivate marker",
    )?;
    let policy = AccessPolicy {
        folders: vec!["private".into()],
        ..AccessPolicy::default()
    };
    let reader = CanonicalWorkspace::open(&root.0)
        .map_err(|_| "open")?
        .with_policy(policy.clone())
        .map_err(|_| "policy")?;
    assert!(
        reader
            .read_note(&NotePath::parse("private/a.md").map_err(|_| "path")?)
            .is_err()
    );
    assert!(
        reader
            .read_note(&NotePath::parse("Research.md").map_err(|_| "path")?)
            .is_err()
    );
    let corpus = Corpus::build(&reader, policy.clone()).map_err(|_| "corpus")?;
    assert_eq!(corpus.note_count(), 1);
    assert_eq!(corpus.query("moon", &reader, &policy).len(), 1);
    let revoked = AccessPolicy {
        tags: vec!["science".into()],
        ..policy
    };
    assert!(corpus.query("moon", &reader, &revoked).is_empty());
    Ok(())
}
#[cfg(unix)]
#[test]
fn symlinks_and_replaced_ancestor_cannot_read_outside() -> Result<(), Box<dyn Error>> {
    use std::os::unix::fs::symlink;
    let root = Temp::new()?;
    let outside = Temp::new()?;
    fs::write(outside.0.join("secret.md"), "outside sentinel")?;
    fs::create_dir(root.0.join("nested"))?;
    fs::write(root.0.join("nested/secret.md"), NOTE)?;
    let reader = CanonicalWorkspace::open(&root.0).map_err(|_| "open")?;
    fs::rename(root.0.join("nested"), root.0.join("old"))?;
    symlink(&outside.0, root.0.join("nested"))?;
    symlink(outside.0.join("secret.md"), root.0.join("direct.md"))?;
    for path in ["nested/secret.md", "direct.md"] {
        assert!(
            reader
                .read_note(&NotePath::parse(path).map_err(|_| "path")?)
                .is_err()
        );
    }
    let listed = reader.list_notes().map_err(|_| "list")?;
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].as_str(), "old/secret.md");
    Ok(())
}
#[test]
fn rejects_traversal_and_oversized_or_non_utf8_files() -> Result<(), Box<dyn Error>> {
    for path in [
        "../x.md",
        "/x.md",
        "a/../x.md",
        "a//x.md",
        "C:\\x.md",
        "x.txt",
    ] {
        assert!(NotePath::parse(path).is_err());
    }
    let root = Temp::new()?;
    fs::write(root.0.join("large.md"), vec![b'a'; 131073])?;
    fs::write(root.0.join("invalid.md"), [0xff])?;
    let reader = CanonicalWorkspace::open(&root.0).map_err(|_| "open")?;
    for path in ["large.md", "invalid.md"] {
        assert!(
            reader
                .read_note(&NotePath::parse(path).map_err(|_| "path")?)
                .is_err()
        );
    }
    Ok(())
}

#[test]
fn links_backlinks_recent_and_polling_refresh_obey_current_policy() -> Result<(), Box<dyn Error>> {
    let root = Temp::new()?;
    fs::write(root.0.join("a.md"), format!("{NOTE}\n[[b]]"))?;
    fs::write(root.0.join("b.md"), NOTE)?;
    let reader = CanonicalWorkspace::open(&root.0).map_err(|_| "open")?;
    let policy = AccessPolicy::default();
    let mut corpus = Corpus::build(&reader, policy.clone()).map_err(|_| "corpus")?;
    let a = NotePath::parse("a.md").map_err(|_| "path")?;
    let b = NotePath::parse("b.md").map_err(|_| "path")?;
    assert_eq!(corpus.linked(&a, &reader, &policy), vec![b.clone()]);
    assert_eq!(corpus.linked(&b, &reader, &policy), vec![a.clone()]);
    assert_eq!(corpus.recent(&reader, &policy).len(), 2);
    let revoked = AccessPolicy {
        tags: vec!["science".into()],
        ..policy.clone()
    };
    assert!(corpus.linked(&a, &reader, &revoked).is_empty());
    assert!(corpus.recent(&reader, &revoked).is_empty());
    fs::write(root.0.join("b.md"), NOTE.replace("moon", "planet"))?;
    assert!(corpus.linked(&a, &reader, &policy).is_empty());
    corpus
        .refresh(&reader, policy.clone())
        .map_err(|_| "refresh")?;
    assert_eq!(corpus.query("planet", &reader, &policy).len(), 1);
    Ok(())
}
#[cfg(unix)]
#[test]
fn concurrent_ancestor_replacement_never_returns_outside_bytes() -> Result<(), Box<dyn Error>> {
    use std::os::unix::fs::symlink;
    let root = Temp::new()?;
    let outside = Temp::new()?;
    fs::create_dir(root.0.join("nested"))?;
    fs::write(root.0.join("nested/a.md"), "inside")?;
    fs::write(outside.0.join("a.md"), "outside sentinel")?;
    let reader = CanonicalWorkspace::open(&root.0).map_err(|_| "open")?;
    let target = NotePath::parse("nested/a.md").map_err(|_| "path")?;
    let base = root.0.clone();
    let escape = outside.0.clone();
    let writer = std::thread::spawn(move || -> std::io::Result<()> {
        for _ in 0..500 {
            fs::rename(base.join("nested"), base.join("parked"))?;
            symlink(&escape, base.join("nested"))?;
            fs::remove_file(base.join("nested"))?;
            fs::rename(base.join("parked"), base.join("nested"))?;
        }
        Ok(())
    });
    for _ in 0..2000 {
        if let Ok(bytes) = reader.read_note(&target) {
            assert_eq!(bytes, "inside");
        }
    }
    writer.join().map_err(|_| "writer panicked")??;
    Ok(())
}
#[test]
fn refuses_state_overlap() {
    use std::path::Path;
    assert!(
        synapse_adapters::reject_overlap(Path::new("/workspace"), Path::new("/workspace/state"))
            .is_err()
    );
    assert!(
        synapse_adapters::reject_overlap(Path::new("/state/workspace"), Path::new("/state"))
            .is_err()
    );
    assert!(synapse_adapters::reject_overlap(Path::new("/workspace"), Path::new("/state")).is_ok());
}
#[test]
fn traversal_and_index_budgets_fail_closed() -> Result<(), Box<dyn Error>> {
    let root = Temp::new()?;
    let mut folder = root.0.clone();
    for _ in 0..34 {
        folder.push("a");
        fs::create_dir(&folder)?;
    }
    let reader = CanonicalWorkspace::open(&root.0).map_err(|_| "open")?;
    assert!(reader.list_notes().is_err());
    let flat = Temp::new()?;
    let content = format!("{NOTE}{}", "x".repeat(130_000));
    for index in 0..130 {
        fs::write(flat.0.join(format!("{index}.md")), &content)?;
    }
    let reader = CanonicalWorkspace::open(&flat.0).map_err(|_| "open")?;
    assert!(Corpus::build(&reader, AccessPolicy::default()).is_err());
    Ok(())
}
#[test]
fn watcher_notices_same_size_changes_and_joins_on_drop() -> Result<(), Box<dyn Error>> {
    use std::{
        sync::Arc,
        time::{Duration, Instant},
    };
    let root = Temp::new()?;
    fs::write(root.0.join("a.md"), NOTE)?;
    let reader = Arc::new(CanonicalWorkspace::open(&root.0).map_err(|_| "open")?);
    let watcher = synapse_adapters::PollingWatcher::start(reader).map_err(|_| "watch")?;
    let generation = watcher.generation();
    fs::write(root.0.join("a.md"), NOTE.replace("42", "99"))?;
    let deadline = Instant::now() + Duration::from_secs(3);
    while watcher.generation() == generation && Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(10));
    }
    assert!(watcher.generation() > generation);
    let before = Instant::now();
    drop(watcher);
    assert!(before.elapsed() < Duration::from_secs(1));
    Ok(())
}
#[test]
fn model_boundary_rechecks_passage_bytes_coordinates_and_exclusions() -> Result<(), Box<dyn Error>>
{
    let root = Temp::new()?;
    fs::write(root.0.join("a.md"), NOTE)?;
    let reader = CanonicalWorkspace::open(&root.0).map_err(|_| "root")?;
    let policy = AccessPolicy::default();
    let corpus = Corpus::build(&reader, policy.clone()).map_err(|_| "corpus")?;
    let mut evidence = corpus.query("moon", &reader, &policy).remove(0);
    assert!(synapse_core::verify_evidence(&reader, &policy, &evidence));
    evidence.start_line -= 1;
    assert!(!synapse_core::verify_evidence(&reader, &policy, &evidence));
    evidence.start_line += 1;
    fs::write(root.0.join("a.md"), NOTE.replace("42", "99"))?;
    assert!(!synapse_core::verify_evidence(&reader, &policy, &evidence));
    fs::write(
        root.0.join("a.md"),
        NOTE.replace("description:", "synapse: {ignore: true}\ndescription:"),
    )?;
    assert!(!synapse_core::verify_evidence(&reader, &policy, &evidence));
    Ok(())
}
#[test]
fn cancelled_workspace_stops_traversal_and_reads() -> Result<(), Box<dyn Error>> {
    let root = Temp::new()?;
    fs::write(root.0.join("a.md"), NOTE)?;
    let cancel = synapse_core::Cancellation::default();
    let reader = CanonicalWorkspace::open(&root.0)
        .map_err(|_| "root")?
        .with_cancellation(cancel.clone());
    cancel.cancel();
    assert!(matches!(
        reader.list_notes(),
        Err(synapse_core::PublicError::Cancelled)
    ));
    assert!(matches!(
        reader.read_note(&NotePath::parse("a.md").map_err(|_| "path")?),
        Err(synapse_core::PublicError::Cancelled)
    ));
    Ok(())
}
#[test]
fn controls_and_excluded_folders_follow_native_case_identity() -> Result<(), Box<dyn Error>> {
    let root = Temp::new()?;
    fs::write(root.0.join("rEsEaRcH.md"), NOTE)?;
    fs::create_dir(root.0.join("Private"))?;
    fs::write(root.0.join("Private/a.md"), NOTE)?;
    let research_alias_exists = root.0.join("Research.md").exists();
    let folder_alias_exists = root.0.join("pRiVaTe").exists();
    let policy = AccessPolicy {
        folders: vec!["pRiVaTe".into()],
        ..AccessPolicy::default()
    };
    let reader = CanonicalWorkspace::open(&root.0)
        .map_err(|_| "root")?
        .with_policy(policy)
        .map_err(|_| "policy")?;
    let listed = reader.list_notes().map_err(|_| "list")?;
    assert_eq!(
        listed.iter().any(|path| path.as_str() == "rEsEaRcH.md"),
        !research_alias_exists
    );
    assert_eq!(
        listed.iter().any(|path| path.as_str() == "Private/a.md"),
        !folder_alias_exists
    );
    assert_eq!(
        reader
            .read_note(&NotePath::parse("rEsEaRcH.md").map_err(|_| "path")?)
            .is_ok(),
        !research_alias_exists
    );
    assert_eq!(
        reader
            .read_note(&NotePath::parse("Private/a.md").map_err(|_| "path")?)
            .is_ok(),
        !folder_alias_exists
    );
    Ok(())
}
#[test]
fn hard_linked_control_aliases_cannot_enter_retrieval() -> Result<(), Box<dyn Error>> {
    let root = Temp::new()?;
    fs::write(root.0.join("Research.md"), NOTE)?;
    fs::hard_link(root.0.join("Research.md"), root.0.join("ordinary.md"))?;
    let reader = CanonicalWorkspace::open(&root.0).map_err(|_| "root")?;
    assert!(reader.list_notes().map_err(|_| "list")?.is_empty());
    assert!(
        reader
            .read_note(&NotePath::parse("ordinary.md").map_err(|_| "path")?)
            .is_err()
    );
    fs::create_dir(root.0.join("Synapse"))?;
    fs::hard_link(
        root.0.join("Research.md"),
        root.0.join("Synapse/Instructions.md"),
    )?;
    assert!(
        reader.list_notes().is_err(),
        "canonical control identities must be distinct"
    );
    Ok(())
}
