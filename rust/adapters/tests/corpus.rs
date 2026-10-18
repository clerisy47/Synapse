#![cfg(unix)]
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};
static NEXT_FIXTURE: AtomicUsize = AtomicUsize::new(0);
use synapse_adapters::WorkspaceCorpus;
use synapse_application::Corpus;
use synapse_core::{CorpusError, CorpusPolicy, CorpusReadPort, Limits, NotePath};

struct Fixture {
    base: PathBuf,
    root: PathBuf,
    state: PathBuf,
}
impl Fixture {
    fn new() -> Self {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let base = std::env::temp_dir().join(format!(
            "synapse-corpus-{}-{unique}-{}",
            std::process::id(),
            NEXT_FIXTURE.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir(&base).unwrap_or_else(|e| panic!("fixture: {e}"));
        let base = fs::canonicalize(base).unwrap_or_else(|e| panic!("fixture: {e}"));
        let root = base.join("workspace");
        fs::create_dir(&root).unwrap_or_else(|e| panic!("fixture: {e}"));
        Self {
            state: base.join("state"),
            base,
            root,
        }
    }
    fn put(&self, path: &str, text: &str) {
        let dest = self.root.join(path);
        fs::create_dir_all(dest.parent().unwrap_or(&self.root))
            .unwrap_or_else(|e| panic!("fixture: {e}"));
        fs::write(dest, text).unwrap_or_else(|e| panic!("fixture: {e}"));
    }
    fn reader(&self) -> WorkspaceCorpus {
        WorkspaceCorpus::open(&self.root, &self.state).unwrap_or_else(|e| panic!("reader: {e:?}"))
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.base);
    }
}
fn note(body: &str) -> String {
    format!(
        "---\ndescription: Synthetic description\ntags: [public]\naliases: [discovery]\n---\n{body}"
    )
}
fn path(s: &str) -> NotePath {
    NotePath::parse(s).unwrap_or_else(|_| panic!("path"))
}
fn policy(folders: &[&str], tags: &[&str], limits: Limits) -> CorpusPolicy {
    CorpusPolicy::new(
        vec![path("Synapse/Instructions.md"), path("Research.md")],
        folders.iter().map(|s| s.to_string()).collect(),
        tags.iter().map(|s| s.to_string()).collect(),
        limits,
    )
    .unwrap_or_else(|e| panic!("policy: {e:?}"))
}

#[test]
fn exclusions_invalid_metadata_and_symlinks_never_enter_retrieval() {
    let f = Fixture::new();
    f.put("Good.md", &note("# Title\npermitted evidence"));
    for name in [
        ".hidden/a.md",
        ".git/a.md",
        "Private/a.md",
        "Research.md",
        "Synapse/Instructions.md",
    ] {
        f.put(name, &note("EXCLUDED_SENTINEL"));
    }
    f.put(
        "Tag.md",
        &note("EXCLUDED_SENTINEL").replace("[public]", "[private]"),
    );
    f.put(
        "Ignore.md",
        &note("EXCLUDED_SENTINEL").replace("description:", "vault-synapse: ignore\ndescription:"),
    );
    f.put(
        "NewIgnore.md",
        &note("EXCLUDED_SENTINEL").replace("description:", "synapse: ignore\ndescription:"),
    );
    f.put("Invalid.md", "---\ntags: [public]\n---\nINVALID_SENTINEL");
    f.put("Broken.md", "---\ntags: [\n---\nINVALID_SENTINEL");
    f.put("Binary.md", "bad");
    fs::write(f.root.join("Binary.md"), [0xff]).unwrap_or_else(|e| panic!("fixture: {e}"));
    fs::write(f.base.join("Outside.md"), note("OUTSIDE_SENTINEL"))
        .unwrap_or_else(|e| panic!("fixture: {e}"));
    std::os::unix::fs::symlink(f.base.join("Outside.md"), f.root.join("Link.md"))
        .unwrap_or_else(|e| panic!("fixture: {e}"));
    std::os::unix::fs::symlink(&f.base, f.root.join("linked-folder"))
        .unwrap_or_else(|e| panic!("fixture: {e}"));
    let p = policy(&["Private"], &["private"], Limits::default());
    let scan = f
        .reader()
        .scan(&p)
        .unwrap_or_else(|e| panic!("scan: {e:?}"));
    assert_eq!(scan.documents.len(), 1);
    assert_eq!(scan.documents[0].path, path("Good.md"));
    assert_eq!(scan.attention.len(), 3);
    assert!(!format!("{scan:?}").contains("SENTINEL"));
}

#[test]
fn evidence_coordinates_links_and_all_output_boundaries_revalidate_current_bytes() {
    let f = Fixture::new();
    f.put(
        "A.md",
        &note("# Alpha\nexact body evidence\n[[B]] [B](B.md)"),
    );
    f.put("B.md", &note("# Beta\nsecond evidence"));
    let mut corpus = Corpus::new(f.reader(), CorpusPolicy::default());
    let hits = corpus.search("exact").unwrap_or_default();
    assert_eq!(hits.len(), 1);
    let evidence = &hits[0].evidence;
    let passage = corpus
        .resolve(evidence)
        .unwrap_or_else(|e| panic!("passage: {e:?}"));
    assert_eq!((passage.start_line, passage.end_line), (7, 7));
    assert_eq!(passage.text, "exact body evidence");
    assert_eq!(
        corpus.links(&path("A.md")).unwrap_or_default(),
        vec![path("B.md")]
    );
    assert_eq!(
        corpus.backlinks(&path("B.md")).unwrap_or_default(),
        vec![path("A.md")]
    );
    let mut other = Corpus::new(f.reader(), CorpusPolicy::default());
    other.refresh().unwrap_or_else(|e| panic!("refresh: {e:?}"));
    assert_eq!(other.resolve(evidence), Err(CorpusError::Stale));
    // Same byte length and no reliance on filesystem timestamp granularity.
    f.put(
        "A.md",
        &note("# Alpha\nother body evidence\n[[B]] [B](B.md)"),
    );
    assert_eq!(corpus.resolve(evidence), Err(CorpusError::Stale));
    let current = corpus.search("other").unwrap_or_default();
    assert_eq!(current.len(), 1);
    corpus
        .set_policy(policy(&[], &["public"], Limits::default()))
        .unwrap_or_else(|e| panic!("policy: {e:?}"));
    assert_eq!(
        corpus.resolve(&current[0].evidence),
        Err(CorpusError::Stale)
    );
    assert!(corpus.search("evidence").unwrap_or_default().is_empty());
}

#[test]
fn polling_invalidates_creates_deletes_metadata_and_root_replacement() {
    let f = Fixture::new();
    let mut corpus = Corpus::new(f.reader(), CorpusPolicy::default());
    assert!(corpus.refresh().unwrap_or(false));
    assert!(!corpus.refresh().unwrap_or(true));
    f.put("A.md", &note("original"));
    assert!(corpus.refresh().unwrap_or(false));
    let hits = corpus.search("original").unwrap_or_default();
    assert_eq!(hits.len(), 1);
    f.put(
        "A.md",
        &note("original").replace("description:", "extra: changed\ndescription:"),
    );
    assert_eq!(corpus.resolve(&hits[0].evidence), Err(CorpusError::Stale));
    let hits = corpus.search("original").unwrap_or_default();
    fs::remove_file(f.root.join("A.md")).unwrap_or_else(|e| panic!("fixture: {e}"));
    assert_eq!(corpus.resolve(&hits[0].evidence), Err(CorpusError::Stale));
    fs::rename(&f.root, f.base.join("detached")).unwrap_or_else(|e| panic!("fixture: {e}"));
    fs::create_dir(&f.root).unwrap_or_else(|e| panic!("fixture: {e}"));
    f.put("Outside.md", &note("OUTSIDE_SENTINEL"));
    assert_eq!(corpus.refresh(), Err(CorpusError::Stale));
}

#[test]
fn resource_limits_fail_without_partial_results_and_oversize_files_need_attention() {
    let f = Fixture::new();
    f.put("A.md", &note("good"));
    f.put("B.md", &"x".repeat(513));
    let limits = Limits {
        file_bytes: 512,
        total_bytes: 1024,
        ..Limits::default()
    };
    let scan = f
        .reader()
        .scan(&policy(&[], &[], limits.clone()))
        .unwrap_or_else(|e| panic!("scan: {e:?}"));
    assert_eq!(scan.documents.len(), 1);
    assert_eq!(scan.attention.len(), 1);
    assert_eq!(
        f.reader().scan(&policy(
            &[],
            &[],
            Limits {
                entries: 1,
                ..limits.clone()
            }
        )),
        Err(CorpusError::Limit)
    );
    f.put("C.md", &note(&"x".repeat(400)));
    f.put("D.md", &note(&"x".repeat(400)));
    f.put("E.md", &note(&"x".repeat(400)));
    assert_eq!(
        f.reader().scan(&policy(&[], &[], limits)),
        Err(CorpusError::Limit)
    );
}

#[test]
fn state_overlap_aliases_and_traversal_configuration_are_refused() {
    let f = Fixture::new();
    assert!(WorkspaceCorpus::open(&f.root, &f.root.join("state")).is_err());
    assert!(WorkspaceCorpus::open(&f.root, &f.base).is_err());
    std::os::unix::fs::symlink(&f.root, f.base.join("state-link"))
        .unwrap_or_else(|e| panic!("fixture: {e}"));
    assert!(WorkspaceCorpus::open(&f.root, &f.base.join("state-link/nested")).is_err());
    assert!(
        CorpusPolicy::new(
            vec![path("A.md"), path("B.md")],
            vec!["../outside".into()],
            vec![],
            Limits::default()
        )
        .is_err()
    );
    let alias = f.base.join("selected-root");
    std::os::unix::fs::symlink(&f.root, &alias).unwrap_or_else(|e| panic!("fixture: {e}"));
    assert!(WorkspaceCorpus::open(&alias, &f.state).is_ok());
}

#[test]
fn concurrent_ancestor_replacement_never_publishes_outside_bytes() {
    let f = Fixture::new();
    f.put("nested/A.md", &note("inside"));
    let outside = f.base.join("outside");
    fs::create_dir(&outside).unwrap_or_else(|e| panic!("fixture: {e}"));
    fs::write(outside.join("A.md"), note("OUTSIDE_SENTINEL"))
        .unwrap_or_else(|e| panic!("fixture: {e}"));
    let reader = f.reader();
    std::thread::scope(|scope| {
        let root = &f.root;
        let outside = &outside;
        scope.spawn(move || {
            for _ in 0..500 {
                let nested = root.join("nested");
                let parked = root.join("parked");
                fs::rename(&nested, &parked).unwrap_or_else(|e| panic!("fixture: {e}"));
                std::os::unix::fs::symlink(outside, &nested)
                    .unwrap_or_else(|e| panic!("fixture: {e}"));
                std::thread::yield_now();
                fs::remove_file(&nested).unwrap_or_else(|e| panic!("fixture: {e}"));
                fs::rename(&parked, &nested).unwrap_or_else(|e| panic!("fixture: {e}"));
            }
        });
        for _ in 0..500 {
            if let Ok(scan) = reader.scan(&CorpusPolicy::default()) {
                assert!(!format!("{scan:?}").contains("OUTSIDE_SENTINEL"));
            }
        }
    });
    let scan = reader
        .scan(&CorpusPolicy::default())
        .unwrap_or_else(|e| panic!("scan: {e:?}"));
    assert_eq!(scan.documents.len(), 1);
}

#[test]
fn graph_rejects_excluded_destinations_and_refuses_unbounded_link_inputs() {
    let f = Fixture::new();
    f.put("A.md",&note("# Title\n[[B#heading|label]] [local](./B.md#heading) [[Private/C]] [url](https://example.invalid/B.md) [[../Outside]]"));
    f.put("B.md", &note("permitted"));
    f.put("Private/C.md", &note("EXCLUDED_SENTINEL"));
    let mut corpus = Corpus::new(f.reader(), policy(&["Private"], &[], Limits::default()));
    assert_eq!(
        corpus.links(&path("A.md")).unwrap_or_default(),
        vec![path("B.md")]
    );
    assert_eq!(corpus.search("discovery").unwrap_or_default().len(), 2);
    assert_eq!(
        corpus.search("EXCLUDED_SENTINEL").unwrap_or_default().len(),
        0
    );
    assert_eq!(
        corpus.search(&"a ".repeat(17)).map(|_| ()),
        Err(CorpusError::Limit)
    );
    f.put("A.md", &note(&"[[B]]".repeat(257)));
    assert_eq!(
        corpus.search("permitted").map(|_| ()),
        Err(CorpusError::Limit)
    );
    assert!(!f.state.exists());
}

#[test]
fn depth_limits_and_overlong_passages_are_refused_without_changing_source() {
    let f = Fixture::new();
    let text = note(&"long evidence ".repeat(400));
    f.put("A.md", &text);
    let mut corpus = Corpus::new(f.reader(), CorpusPolicy::default());
    let hits = corpus.search("evidence").unwrap_or_default();
    assert_eq!(hits.len(), 1);
    assert_eq!(corpus.resolve(&hits[0].evidence), Err(CorpusError::Limit));
    assert_eq!(
        fs::read_to_string(f.root.join("A.md")).unwrap_or_default(),
        text
    );
    f.put("a/b/c.md", &note("deep"));
    assert_eq!(
        f.reader().scan(&policy(
            &[],
            &[],
            Limits {
                depth: 1,
                ..Limits::default()
            }
        )),
        Err(CorpusError::Limit)
    );
    assert!(!f.state.exists());
}
