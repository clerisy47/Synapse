use std::{error::Error, fs, process::Command, sync::Arc};
use synapse_adapters::{CanonicalWorkspace, SqliteSearchIndex};
use synapse_core::{AccessPolicy, Corpus, NoteReadPort, PublicError, SearchIndexPort};
const NOTE: &str = "---\ndescription: Indexed fixture\ntags: [fixture]\naliases: []\n---\n# Battery\nBattery lifetime is 0 hours. zaphodcanary. Café safety checks are documented.\n";
#[test]
fn index_child() -> Result<(), Box<dyn Error>> {
    let Ok(base) = std::env::var("SYNAPSE_INDEX_FIXTURE") else {
        return Ok(());
    };
    let base = std::path::PathBuf::from(base);
    let root = base.join("workspace");
    assert!(
        synapse_adapters::state_location()
            .map_err(|_| "state")?
            .starts_with(&base)
    );
    let reader = CanonicalWorkspace::open(&root).map_err(|_| "reader")?;
    let policy = AccessPolicy::default();
    let fingerprint = synapse_core::policy_fingerprint(&policy);
    let index = Arc::new(SqliteSearchIndex::open(&reader).map_err(|e| format!("index {e:?}"))?);
    let mut corpus = Corpus::build_with_index(&reader, policy.clone(), Some(index.clone()))
        .map_err(|e| format!("build {e:?}"))?;
    assert_eq!(corpus.reconciliation_counts(), (1, 0));
    corpus
        .refresh(&reader, policy.clone())
        .map_err(|_| "warm refresh")?;
    assert_eq!(corpus.reconciliation_counts(), (0, 1));
    let hits = index
        .candidates(fingerprint.as_str(), &["battery".into()])
        .map_err(|e| format!("query {e:?}"))?;
    assert!(!hits.is_empty());
    assert!(
        !index
            .phrase_candidates(fingerprint.as_str(), &["battery".into(), "lifetim".into()])
            .map_err(|_| "phrase")?
            .is_empty()
    );
    assert!(
        index
            .phrase_candidates(fingerprint.as_str(), &["lifetim".into(), "battery".into()])
            .map_err(|_| "reverse phrase")?
            .is_empty()
    );
    let unicode = corpus
        .query_phrase_packets(
            "café safety",
            "What does café safety require?",
            &reader,
            &policy,
        )
        .map_err(|_| "unicode phrase")?;
    assert!(!unicode.is_empty());

    assert!(
        index
            .candidates(fingerprint.as_str(), &["x\" OR *".into()])
            .is_err()
    );
    let records = index.load(fingerprint.as_str()).map_err(|_| "load")?;
    assert_eq!(records.len(), 1);
    let root_copy = root.clone();
    let worker = std::thread::spawn(move || -> Result<(), PublicError> {
        let reader = CanonicalWorkspace::open(&root_copy)?;
        let index = Arc::new(SqliteSearchIndex::open(&reader)?);
        let corpus = Corpus::build_with_index(&reader, AccessPolicy::default(), Some(index))?;
        if corpus.note_count() != 1 {
            return Err(PublicError::StateUnavailable);
        }
        Ok(())
    });
    corpus
        .refresh(&reader, policy.clone())
        .map_err(|_| "concurrent refresh")?;
    worker
        .join()
        .map_err(|_| "worker")?
        .map_err(|_| "concurrent worker")?;

    let packets = corpus
        .query_packets("battery lifetime", &reader, &policy)
        .map_err(|_| "packets")?;
    assert!(
        !corpus
            .resolve_packets(&packets, &reader, &policy)
            .map_err(|_| "resolve")?
            .is_empty()
    );
    // Same-size edit with no watcher: the full-content hash still detects it.
    let original_modified = fs::metadata(root.join("note.md"))?.modified()?;
    fs::write(root.join("note.md"), NOTE.replace("0 hours", "9 hours"))?;
    fs::File::open(root.join("note.md"))?
        .set_times(fs::FileTimes::new().set_modified(original_modified))?;
    assert_eq!(
        fs::metadata(root.join("note.md"))?.modified()?,
        original_modified
    );
    assert!(corpus.resolve_packets(&packets, &reader, &policy).is_err());
    corpus
        .refresh(&reader, policy.clone())
        .map_err(|_| "refresh")?;
    let records2 = index.load(fingerprint.as_str()).map_err(|_| "reload")?;
    assert_ne!(records[0].hash, records2[0].hash);
    let denied = AccessPolicy {
        tags: vec!["fixture".into()],
        ..policy.clone()
    };
    corpus
        .refresh(&reader, denied.clone())
        .map_err(|_| "policy refresh")?;
    assert!(
        index
            .load(synapse_core::policy_fingerprint(&denied).as_str())
            .map_err(|_| "denied")?
            .is_empty()
    );
    assert!(
        index
            .candidates(fingerprint.as_str(), &["battery".into()])
            .is_err()
    );
    drop(corpus);
    drop(index);
    // Re-open and rebuild after an unknown format and corrupt bytes. Only
    // private index files are replaced; workspace bytes stay unchanged.
    let directories = fs::read_dir(
        synapse_adapters::state_location()
            .map_err(|_| "state")?
            .join("workspaces"),
    )?
    .collect::<Result<Vec<_>, _>>()?;
    let state = directories[0].path();
    let db = state.join("index-v1.sqlite3");
    assert!(
        !fs::read(&db)?
            .windows(b"zaphodcanary".len())
            .any(|window| window == b"zaphodcanary"),
        "excluded derived terms survived secure deletion"
    );
    fs::write(&db, b"corrupt synthetic index")?;
    let recovered =
        Arc::new(SqliteSearchIndex::open(&reader).map_err(|e| format!("rebuild {e:?}"))?);
    let corpus = Corpus::build_with_index(&reader, policy.clone(), Some(recovered.clone()))
        .map_err(|_| "rebuild corpus")?;
    assert_eq!(corpus.note_count(), 1);
    drop(corpus);
    drop(recovered);
    let process = Command::new(std::env::current_exe()?)
        .args(["--exact", "index_crash_child"])
        .env("SYNAPSE_INDEX_DB_PATH", &db)
        .status()?;
    assert_eq!(process.code(), Some(77));
    let recovered = Arc::new(SqliteSearchIndex::open(&reader).map_err(|_| "crash recovery")?);
    let corpus = Corpus::build_with_index(&reader, policy.clone(), Some(recovered.clone()))
        .map_err(|_| "crash corpus")?;
    assert_eq!(corpus.note_count(), 1);
    drop(corpus);
    drop(recovered);
    {
        let connection = rusqlite::Connection::open(&db)?;
        connection.execute(
            "UPDATE sources SET metadata='malformed synthetic metadata'",
            [],
        )?;
    }
    let repaired = Arc::new(SqliteSearchIndex::open(&reader).map_err(|_| "metadata open")?);
    let corpus = Corpus::build_with_index(&reader, policy.clone(), Some(repaired.clone()))
        .map_err(|_| "metadata rebuild")?;
    assert_eq!(corpus.reconciliation_counts(), (1, 0));
    drop(corpus);
    drop(repaired);

    {
        let connection = rusqlite::Connection::open(&db)?;
        connection.execute_batch("PRAGMA user_version=999; CREATE TABLE obsolete_cache(value TEXT); INSERT INTO obsolete_cache VALUES('obsoletecanary');")?;
    }
    let repaired = Arc::new(SqliteSearchIndex::open(&reader).map_err(|_| "unknown format open")?);
    let corpus = Corpus::build_with_index(&reader, policy.clone(), Some(repaired.clone()))
        .map_err(|_| "unknown format rebuild")?;
    assert_eq!(corpus.reconciliation_counts(), (1, 0));
    drop(corpus);
    drop(repaired);
    {
        let connection = rusqlite::Connection::open(&db)?;
        let count: i64 = connection.query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE name='obsolete_cache'",
            [],
            |r| r.get(0),
        )?;
        assert_eq!(
            count, 0,
            "unknown historical cache survived derived-index rebuild"
        );
    }
    {
        let connection = rusqlite::Connection::open(&db)?;
        connection.execute("DELETE FROM terms_data WHERE id > 1", [])?;
        let check: String = connection.query_row("PRAGMA quick_check(1)", [], |r| r.get(0))?;
        assert!(
            check.contains("fts5:"),
            "bundled SQLite must detect FTS shadow-table corruption"
        );
    }
    let repaired = Arc::new(SqliteSearchIndex::open(&reader).map_err(|_| "fts open")?);
    let corpus = Corpus::build_with_index(&reader, policy.clone(), Some(repaired.clone()))
        .map_err(|_| "fts rebuild")?;
    assert_eq!(corpus.reconciliation_counts(), (1, 0));
    assert!(
        !repaired
            .candidates(fingerprint.as_str(), &["battery".into()])
            .map_err(|_| "fts candidates")?
            .is_empty()
    );
    drop(corpus);
    drop(repaired);

    assert_eq!(reader.list_notes().map_err(|_| "inventory")?.len(), 1);
    assert_eq!(
        fs::read_to_string(root.join("note.md"))?,
        NOTE.replace("0 hours", "9 hours")
    );
    {
        let external = rusqlite::Connection::open(&db)?;
        external.execute_batch("BEGIN IMMEDIATE;")?;
        assert!(
            matches!(SqliteSearchIndex::open(&reader), Err(PublicError::Conflict)),
            "busy index was treated as corrupt"
        );
        external.execute_batch("ROLLBACK;")?;
        let count: i64 = external.query_row("SELECT COUNT(*) FROM sources", [], |r| r.get(0))?;
        assert_eq!(count, 1, "contention rebuilt healthy state");
    }

    // Private state refuses index symlinks, including existing sidecars.
    fs::remove_file(&db)?;
    std::os::unix::fs::symlink(root.join("note.md"), &db)?;
    assert!(SqliteSearchIndex::open(&reader).is_err());
    Ok(())
}
#[test]
fn persistent_index_lifecycle_is_private_and_rebuildable() -> Result<(), Box<dyn Error>> {
    let base = std::env::temp_dir().join(format!("synapse-index-{}", std::process::id()));
    fs::create_dir(&base)?;
    let base = base.canonicalize()?;
    fs::create_dir(base.join("workspace"))?;
    fs::create_dir(base.join("home"))?;
    fs::write(base.join("workspace/note.md"), NOTE)?;
    let output = Command::new(std::env::current_exe()?)
        .args(["--exact", "index_child", "--nocapture"])
        .env("SYNAPSE_INDEX_FIXTURE", &base)
        .env("HOME", base.join("home"))
        .env("XDG_STATE_HOME", base.join("state"))
        .output()?;
    let success = output.status.success();
    if !success {
        eprintln!("{}", String::from_utf8_lossy(&output.stdout));
        eprintln!("{}", String::from_utf8_lossy(&output.stderr));
    }
    fs::remove_dir_all(base)?;
    assert!(success);
    Ok(())
}

#[test]
fn index_crash_child() -> Result<(), Box<dyn Error>> {
    let Ok(path) = std::env::var("SYNAPSE_INDEX_DB_PATH") else {
        return Ok(());
    };
    let connection = rusqlite::Connection::open(path)?;
    connection.execute_batch("BEGIN IMMEDIATE; DELETE FROM sources;")?;
    std::process::exit(77)
}
