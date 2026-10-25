//! Private, rebuildable lexical state. Source bodies and generated snippets are
//! never stored. SQL expressions are compiled from bounded lexical tokens.
use crate::{CanonicalWorkspace, DiskStateStore};
use rusqlite::{Connection, OptionalExtension, params};
use std::{path::PathBuf, sync::Mutex, time::Duration};
use synapse_core::{IndexHit, IndexTerms, IndexedSource, PublicError, SearchIndexPort};
const MAX_INDEX_STORAGE: u64 = 1024 * 1024 * 1024;
const MAX_INDEX_METADATA_BYTES: usize = 64 * 1024 * 1024;
const MAX_INDEX_VALUE_BYTES: i32 = 1024 * 1024;
const FORMAT: i64 = 2;
pub struct SqliteSearchIndex {
    connection: Mutex<Connection>,
    path: PathBuf,
    store: DiskStateStore,
}
fn failure(error: rusqlite::Error) -> PublicError {
    if matches!(
        error.sqlite_error_code(),
        Some(rusqlite::ErrorCode::DatabaseBusy | rusqlite::ErrorCode::DatabaseLocked)
    ) {
        PublicError::Conflict
    } else {
        PublicError::StateUnavailable
    }
}
fn rebuildable(error: &rusqlite::Error) -> bool {
    matches!(error, rusqlite::Error::InvalidQuery)
        || matches!(
            error.sqlite_error_code(),
            Some(rusqlite::ErrorCode::DatabaseCorrupt | rusqlite::ErrorCode::NotADatabase)
        )
}
impl SqliteSearchIndex {
    pub fn open(reader: &CanonicalWorkspace) -> Result<Self, PublicError> {
        let store = DiskStateStore::open(reader)?;
        let path = crate::state_location()?
            .join("workspaces")
            .join(reader.state_key()?.as_str())
            .join("index-v1.sqlite3");
        // Precreate/verify private regular single-link files through the state
        // directory capability before SQLite opens its fixed path.
        let _maintenance = store.index_lock()?;
        store.prepare_index_files()?;
        let connect = || -> rusqlite::Result<Connection> {
            let connection = Connection::open_with_flags(
                &path,
                rusqlite::OpenFlags::SQLITE_OPEN_READ_WRITE
                    | rusqlite::OpenFlags::SQLITE_OPEN_CREATE
                    | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX
                    | rusqlite::OpenFlags::SQLITE_OPEN_NOFOLLOW,
            )?;
            connection.busy_timeout(Duration::from_secs(5))?;
            connection.set_limit(
                rusqlite::limits::Limit::SQLITE_LIMIT_LENGTH,
                MAX_INDEX_VALUE_BYTES,
            )?;
            connection.execute_batch("PRAGMA secure_delete=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA temp_store=MEMORY; PRAGMA trusted_schema=OFF; PRAGMA max_page_count=262144;")?;
            let page_size: i64 = connection.query_row("PRAGMA page_size", [], |r| r.get(0))?;
            if page_size != 4096 {
                return Err(rusqlite::Error::InvalidQuery);
            }
            let version: i64 = connection.query_row("PRAGMA user_version", [], |r| r.get(0))?;
            if version != 0 && version != FORMAT {
                return Err(rusqlite::Error::InvalidQuery);
            }
            Self::initialize(&connection)?;
            Ok(connection)
        };
        let connection = match connect() {
            Ok(connection) => connection,
            Err(error) if rebuildable(&error) => {
                store.clear_index_locked()?;
                store.prepare_index_files()?;
                connect().map_err(failure)?
            }
            Err(error) => return Err(failure(error)),
        };
        Ok(Self {
            connection: Mutex::new(connection),
            path,
            store,
        })
    }
    fn initialize(connection: &Connection) -> rusqlite::Result<()> {
        connection.execute_batch("CREATE TABLE IF NOT EXISTS active_policy (id INTEGER PRIMARY KEY CHECK(id=1), fingerprint TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS sources(path TEXT PRIMARY KEY, hash BLOB NOT NULL, metadata TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS blocks(id INTEGER PRIMARY KEY, path TEXT NOT NULL, ordinal INTEGER NOT NULL, UNIQUE(path,ordinal));
            CREATE VIRTUAL TABLE IF NOT EXISTS terms USING fts5(tokens,content='',contentless_delete=1);
            INSERT INTO terms(terms,rank) VALUES('secure-delete',1);
            PRAGMA user_version=2;")?;
        let check: String = connection.query_row("PRAGMA quick_check(1)", [], |r| r.get(0))?;
        if check != "ok" {
            return Err(rusqlite::Error::InvalidQuery);
        }
        Ok(())
    }
    fn capacity(&self) -> Result<(), PublicError> {
        let mut bytes = 0;
        for suffix in ["", "-wal", "-shm"] {
            let mut path = self.path.as_os_str().to_os_string();
            path.push(suffix);
            match std::fs::symlink_metadata(PathBuf::from(path)) {
                Ok(meta) if meta.is_file() && !meta.file_type().is_symlink() => bytes += meta.len(),
                Ok(_) => return Err(PublicError::StateUnavailable),
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => (),
                Err(_) => return Err(PublicError::StateUnavailable),
            }
        }
        if bytes > MAX_INDEX_STORAGE {
            Err(PublicError::ResourceLimit)
        } else {
            Ok(())
        }
    }
}
fn purge_policy(connection: &Connection, policy: &str) -> Result<(), PublicError> {
    let old: Option<String> = connection
        .query_row(
            "SELECT fingerprint FROM active_policy WHERE id=1",
            [],
            |r| r.get(0),
        )
        .optional()
        .map_err(failure)?;
    if old.as_deref() != Some(policy) {
        connection.execute_batch("INSERT INTO terms(terms) VALUES('delete-all'); DELETE FROM blocks; DELETE FROM sources; DELETE FROM active_policy;").map_err(failure)?;
        connection
            .execute(
                "INSERT INTO active_policy(id,fingerprint) VALUES(1,?1)",
                [policy],
            )
            .map_err(failure)?;
    }
    Ok(())
}
impl SearchIndexPort for SqliteSearchIndex {
    fn load(&self, policy: &str) -> Result<Vec<IndexedSource>, PublicError> {
        self.capacity()?;
        let _lease = self.store.index_lock()?;
        let mut connection = self
            .connection
            .lock()
            .map_err(|_| PublicError::StateUnavailable)?;
        let tx = connection.transaction().map_err(failure)?;
        purge_policy(&tx, policy)?;
        let result = (|| -> Result<Vec<IndexedSource>, PublicError> {
            let mut statement = tx
                .prepare("SELECT sources.path,sources.hash,sources.metadata,COUNT(blocks.id),COALESCE(MAX(blocks.ordinal),-1) FROM sources LEFT JOIN blocks ON blocks.path=sources.path GROUP BY sources.path ORDER BY sources.path LIMIT 10001")
                .map_err(failure)?;
            let rows = statement
                .query_map([], |r| {
                    Ok((
                        r.get::<_, String>(0)?,
                        r.get::<_, Vec<u8>>(1)?,
                        r.get::<_, String>(2)?,
                        r.get::<_, i64>(3)?,
                        r.get::<_, i64>(4)?,
                    ))
                })
                .map_err(failure)?;
            let mut result = Vec::new();
            let mut metadata_bytes = 0usize;
            for row in rows {
                if result.len() == 10000 {
                    return Err(PublicError::ResourceLimit);
                }
                let (path, hash, metadata, count, last) = row.map_err(failure)?;
                metadata_bytes = metadata_bytes.saturating_add(metadata.len());
                if metadata_bytes > MAX_INDEX_METADATA_BYTES {
                    return Err(PublicError::ResourceLimit);
                }
                let value = crate::strict_json::parse(metadata.as_bytes())
                    .map_err(|_| PublicError::StateUnavailable)?;
                let source: IndexedSource =
                    serde_json::from_value(value).map_err(|_| PublicError::StateUnavailable)?;
                if source.path.as_str() != path
                    || source.hash.as_slice() != hash
                    || count != source.blocks.len() as i64
                    || last != count - 1
                {
                    return Err(PublicError::StateUnavailable);
                }
                result.push(source);
            }
            Ok(result)
        })();
        let result = match result {
            Ok(result) => result,
            Err(PublicError::StateUnavailable) => {
                tx.execute_batch("INSERT INTO terms(terms) VALUES('delete-all'); DELETE FROM blocks; DELETE FROM sources;")
                    .map_err(failure)?;
                Vec::new()
            }
            Err(error) => return Err(error),
        };
        tx.commit().map_err(failure)?;
        connection
            .execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")
            .map_err(failure)?;
        Ok(result)
    }
    fn publish(
        &self,
        policy: &str,
        sources: &[IndexedSource],
        changed: &[IndexTerms],
    ) -> Result<(), PublicError> {
        if sources.len() > 10000 {
            return Err(PublicError::ResourceLimit);
        }
        let _lease = self.store.index_lock()?;
        let mut connection = self
            .connection
            .lock()
            .map_err(|_| PublicError::StateUnavailable)?;
        let tx = connection.transaction().map_err(failure)?;
        purge_policy(&tx, policy)?;
        let old: Vec<String> = {
            let mut st = tx.prepare("SELECT path FROM sources").map_err(failure)?;
            st.query_map([], |r| r.get(0))
                .map_err(failure)?
                .collect::<Result<_, _>>()
                .map_err(failure)?
        };
        let mut removed = false;
        for path in old {
            if !sources.iter().any(|s| s.path.as_str() == path) {
                removed = true;
                tx.execute(
                    "DELETE FROM terms WHERE rowid IN (SELECT id FROM blocks WHERE path=?1)",
                    [&path],
                )
                .map_err(failure)?;
                tx.execute("DELETE FROM blocks WHERE path=?1", [&path])
                    .map_err(failure)?;
                tx.execute("DELETE FROM sources WHERE path=?1", [&path])
                    .map_err(failure)?;
            }
        }
        for update in changed {
            let source = sources
                .iter()
                .find(|s| s.path == update.path)
                .ok_or(PublicError::StateUnavailable)?;
            tx.execute(
                "DELETE FROM terms WHERE rowid IN (SELECT id FROM blocks WHERE path=?1)",
                [update.path.as_str()],
            )
            .map_err(failure)?;
            tx.execute("DELETE FROM blocks WHERE path=?1", [update.path.as_str()])
                .map_err(failure)?;
            let metadata =
                serde_json::to_string(source).map_err(|_| PublicError::StateUnavailable)?;
            tx.execute(
                "INSERT OR REPLACE INTO sources(path,hash,metadata) VALUES(?1,?2,?3)",
                params![source.path.as_str(), source.hash.as_slice(), metadata],
            )
            .map_err(failure)?;
            for (ordinal, terms) in &update.blocks {
                tx.execute(
                    "INSERT INTO blocks(path,ordinal) VALUES(?1,?2)",
                    params![source.path.as_str(), *ordinal as i64],
                )
                .map_err(failure)?;
                let id = tx.last_insert_rowid();
                tx.execute(
                    "INSERT INTO terms(rowid,tokens) VALUES(?1,?2)",
                    params![id, terms],
                )
                .map_err(failure)?;
            }
        }
        if removed || !changed.is_empty() {
            // Contentless-delete uses tombstones even when secure-delete is
            // configured. Merge them before publishing so old terms do not
            // remain in the persisted vocabulary.
            tx.execute_batch("INSERT INTO terms(terms) VALUES('optimize');")
                .map_err(failure)?;
        }
        tx.commit().map_err(failure)?;
        connection
            .execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")
            .map_err(failure)?;
        self.capacity()
    }
    fn candidates(&self, policy: &str, terms: &[String]) -> Result<Vec<IndexHit>, PublicError> {
        self.query_terms(policy, terms, false)
    }
    fn phrase_candidates(
        &self,
        policy: &str,
        terms: &[String],
    ) -> Result<Vec<IndexHit>, PublicError> {
        self.query_terms(policy, terms, true)
    }
}
impl SqliteSearchIndex {
    fn query_terms(
        &self,
        policy: &str,
        terms: &[String],
        phrase: bool,
    ) -> Result<Vec<IndexHit>, PublicError> {
        if terms.is_empty() {
            return Ok(Vec::new());
        }
        if terms.len() > 32
            || terms.iter().any(|t| {
                t.is_empty() || t.chars().count() > 64 || !t.chars().all(char::is_alphanumeric)
            })
        {
            return Err(PublicError::ResourceLimit);
        }
        let expression = if phrase {
            format!("\"{}\"", terms.join(" "))
        } else {
            terms
                .iter()
                .map(|t| format!("\"{t}\""))
                .collect::<Vec<_>>()
                .join(" OR ")
        };
        let connection = self
            .connection
            .lock()
            .map_err(|_| PublicError::StateUnavailable)?;
        let active: Option<String> = connection
            .query_row(
                "SELECT fingerprint FROM active_policy WHERE id=1",
                [],
                |r| r.get(0),
            )
            .optional()
            .map_err(failure)?;
        if active.as_deref() != Some(policy) {
            return Err(PublicError::Conflict);
        }
        let mut statement=connection.prepare("SELECT blocks.path,sources.hash,blocks.ordinal FROM (SELECT rowid,rank AS score FROM terms WHERE terms MATCH ?1 ORDER BY rank LIMIT 64) AS hits JOIN blocks ON blocks.id=hits.rowid JOIN sources ON sources.path=blocks.path ORDER BY hits.score,blocks.path,blocks.ordinal").map_err(failure)?;
        let rows = statement
            .query_map([expression], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, Vec<u8>>(1)?,
                    r.get::<_, i64>(2)?,
                ))
            })
            .map_err(failure)?;
        let mut result = Vec::new();
        for row in rows {
            let (path, hash, block) = row.map_err(failure)?;
            result.push(IndexHit {
                path: synapse_core::NotePath::parse(&path)?,
                hash: hash.try_into().map_err(|_| PublicError::StateUnavailable)?,
                block: usize::try_from(block).map_err(|_| PublicError::StateUnavailable)?,
            });
        }
        Ok(result)
    }
}
pub fn query_session(
    reader: &CanonicalWorkspace,
    policy: synapse_core::AccessPolicy,
) -> Result<synapse_core::ChatSession, PublicError> {
    synapse_core::ChatSession::with_index(
        reader,
        policy,
        Some(std::sync::Arc::new(SqliteSearchIndex::open(reader)?)),
    )
}
