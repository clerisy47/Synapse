use crate::{CanonicalWorkspace, reject_overlap, state_location};
use rustix::fs::{self, FileType, FlockOperation, Mode, OFlags};
use serde_json::{Value, json};
use std::{
    fs::File,
    io::{Read, Write},
    os::fd::OwnedFd,
    path::{Component, Path},
    time::{Duration, Instant},
};
use synapse_core::{
    Cancellation, CapturedResearch, ContentHash, ContradictionReport, MAX_CAPTURES,
    MAX_CONTRADICTION_REPORTS, NotePath, PublicError, StateStore,
};

#[derive(Clone, Copy)]
pub(crate) enum StateFile {
    Captures,
    Journal,
    Grants,
    Receipts,
    Contradictions,
}
impl StateFile {
    fn name(self) -> &'static str {
        match self {
            Self::Captures => "captures-v1.json",
            Self::Journal => "journal-v1.json",
            Self::Grants => "grants-v1.json",
            Self::Receipts => "receipts-v1.json",
            Self::Contradictions => "contradictions-v1.json",
        }
    }
}
const MAX_CAPTURE_STORE_BYTES: u64 = 1_000_000;
static PROCESS_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
pub(crate) struct WorkspaceLock {
    _fd: OwnedFd,
    _guard: std::sync::MutexGuard<'static, ()>,
}
const LOCK_WAIT: Duration = Duration::from_secs(5);
const LOCK_POLL: Duration = Duration::from_millis(25);
/// Only known state files are reachable; no workspace-note writer is exposed.
pub struct DiskStateStore {
    pub(crate) directory: OwnedFd,
    key: ContentHash,
    inbox: NotePath,
    cancel: Cancellation,
}
pub(crate) fn private_directory(path: &Path) -> Result<OwnedFd, PublicError> {
    if !path.is_absolute()
        || path
            .components()
            .any(|part| !matches!(part, Component::RootDir | Component::Normal(_)))
    {
        return Err(PublicError::StateUnavailable);
    }
    let mut fd = fs::open(
        "/",
        OFlags::RDONLY | OFlags::DIRECTORY | OFlags::CLOEXEC,
        Mode::empty(),
    )
    .map_err(|_| PublicError::StateUnavailable)?;
    for part in path.components() {
        match part {
            Component::RootDir => (),
            Component::Normal(name) => fd = private_child(&fd, name, false)?,
            _ => return Err(PublicError::StateUnavailable),
        }
    }
    verify_private_directory(&fd)?;
    Ok(fd)
}
pub(crate) fn private_child(
    parent: &OwnedFd,
    name: &std::ffi::OsStr,
    require_private: bool,
) -> Result<OwnedFd, PublicError> {
    match fs::mkdirat(parent, name, Mode::from_raw_mode(0o700)) {
        Ok(()) | Err(rustix::io::Errno::EXIST) => (),
        Err(_) => return Err(PublicError::StateUnavailable),
    }
    let fd = fs::openat(
        parent,
        name,
        OFlags::RDONLY | OFlags::DIRECTORY | OFlags::NOFOLLOW | OFlags::CLOEXEC,
        Mode::empty(),
    )
    .map_err(|_| PublicError::StateUnavailable)?;
    if require_private {
        verify_private_directory(&fd)?;
    }
    Ok(fd)
}
fn verify_private_directory(fd: &OwnedFd) -> Result<(), PublicError> {
    let stat = fs::fstat(fd).map_err(|_| PublicError::StateUnavailable)?;
    if stat.st_uid != rustix::process::getuid().as_raw() || stat.st_mode & 0o077 != 0 {
        return Err(PublicError::StateUnavailable);
    }
    Ok(())
}
pub(crate) fn verify_state_file(fd: &OwnedFd) -> Result<fs::Stat, PublicError> {
    let stat = fs::fstat(fd).map_err(|_| PublicError::StateUnavailable)?;
    if FileType::from_raw_mode(stat.st_mode) != FileType::RegularFile
        || stat.st_uid != rustix::process::getuid().as_raw()
        || stat.st_nlink != 1
        || stat.st_mode & 0o077 != 0
    {
        return Err(PublicError::StateUnavailable);
    }
    Ok(stat)
}
impl DiskStateStore {
    pub(crate) fn assert_workspace(&self, reader: &CanonicalWorkspace) -> Result<(), PublicError> {
        if reader.state_key()? == self.key {
            Ok(())
        } else {
            Err(PublicError::AccessRefused)
        }
    }
    pub fn open(reader: &CanonicalWorkspace) -> Result<Self, PublicError> {
        let location = state_location()?;
        reject_overlap(reader.canonical_root(), &location)?;
        let base = private_directory(&location)?;
        let namespaces = private_child(&base, std::ffi::OsStr::new("workspaces"), true)?;
        let key = reader.state_key()?;
        let directory = private_child(&namespaces, std::ffi::OsStr::new(key.as_str()), true)?;
        Ok(Self {
            directory,
            key,
            inbox: reader.access_policy().research.clone(),
            cancel: reader.cancellation(),
        })
    }
    pub(crate) fn lock(&self) -> Result<WorkspaceLock, PublicError> {
        let deadline = Instant::now() + LOCK_WAIT;
        let guard = loop {
            if self.cancel.is_cancelled() {
                return Err(PublicError::Cancelled);
            }
            match PROCESS_LOCK.try_lock() {
                Ok(guard) => break guard,
                Err(std::sync::TryLockError::WouldBlock) if Instant::now() < deadline => {
                    std::thread::sleep(LOCK_POLL)
                }
                Err(_) => return Err(PublicError::StateUnavailable),
            }
        };
        let fd = match fs::openat(
            &self.directory,
            "workspace.lock",
            OFlags::RDWR | OFlags::CREATE | OFlags::EXCL | OFlags::NOFOLLOW | OFlags::CLOEXEC,
            Mode::from_raw_mode(0o600),
        ) {
            Ok(fd) => fd,
            Err(rustix::io::Errno::EXIST) => fs::openat(
                &self.directory,
                "workspace.lock",
                OFlags::RDWR | OFlags::NOFOLLOW | OFlags::CLOEXEC,
                Mode::empty(),
            )
            .map_err(|_| PublicError::StateUnavailable)?,
            Err(_) => return Err(PublicError::StateUnavailable),
        };
        verify_state_file(&fd)?;
        let deadline = Instant::now() + LOCK_WAIT;
        loop {
            if self.cancel.is_cancelled() {
                return Err(PublicError::Cancelled);
            }
            match fs::flock(&fd, FlockOperation::NonBlockingLockExclusive) {
                Ok(()) => {
                    return Ok(WorkspaceLock {
                        _fd: fd,
                        _guard: guard,
                    });
                }
                Err(error)
                    if matches!(
                        error,
                        rustix::io::Errno::WOULDBLOCK | rustix::io::Errno::ACCESS
                    ) && Instant::now() < deadline =>
                {
                    std::thread::sleep(LOCK_POLL)
                }
                Err(_) => return Err(PublicError::StateUnavailable),
            }
        }
    }
    pub(crate) fn read_state(
        &self,
        file: StateFile,
        maximum: u64,
    ) -> Result<Option<Vec<u8>>, PublicError> {
        let name = file.name();
        let fd = match fs::openat(
            &self.directory,
            name,
            OFlags::RDONLY | OFlags::NONBLOCK | OFlags::NOFOLLOW | OFlags::CLOEXEC,
            Mode::empty(),
        ) {
            Ok(fd) => fd,
            Err(rustix::io::Errno::NOENT) => return Ok(None),
            Err(_) => return Err(PublicError::StateUnavailable),
        };
        let stat = verify_state_file(&fd)?;
        if stat.st_size < 0 || stat.st_size as u64 > maximum {
            return Err(PublicError::CapacityExceeded);
        }
        let mut bytes = Vec::new();
        File::from(fd)
            .take(maximum + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| PublicError::StateUnavailable)?;
        if bytes.len() as u64 > maximum {
            return Err(PublicError::CapacityExceeded);
        }
        Ok(Some(bytes))
    }
    pub(crate) fn write_state(&self, file: StateFile, bytes: &[u8]) -> Result<(), PublicError> {
        let name = file.name();
        match fs::openat(
            &self.directory,
            name,
            OFlags::RDONLY | OFlags::NONBLOCK | OFlags::NOFOLLOW | OFlags::CLOEXEC,
            Mode::empty(),
        ) {
            Ok(fd) => {
                verify_state_file(&fd)?;
            }
            Err(rustix::io::Errno::NOENT) => (),
            Err(_) => return Err(PublicError::StateUnavailable),
        }
        let mut random = [0; 16];
        getrandom::getrandom(&mut random).map_err(|_| PublicError::StateUnavailable)?;
        let nonce = synapse_core::hex_encode(&random);
        let staging = format!(".state-{nonce}.tmp");
        let fd = fs::openat(
            &self.directory,
            staging.as_str(),
            OFlags::WRONLY | OFlags::CREATE | OFlags::EXCL | OFlags::NOFOLLOW | OFlags::CLOEXEC,
            Mode::from_raw_mode(0o600),
        )
        .map_err(|_| PublicError::StateUnavailable)?;
        let mut file = File::from(fd);
        file.write_all(bytes)
            .and_then(|_| file.sync_all())
            .map_err(|_| PublicError::StateUnavailable)?;
        fs::renameat(&self.directory, staging.as_str(), &self.directory, name)
            .map_err(|_| PublicError::StateUnavailable)?;
        fs::fsync(&self.directory).map_err(|_| PublicError::StateUnavailable)
    }
    fn read_captures(&self) -> Result<Vec<CapturedResearch>, PublicError> {
        let Some(bytes) = self.read_state(StateFile::Captures, MAX_CAPTURE_STORE_BYTES)? else {
            return Ok(Vec::new());
        };
        let value: Value =
            serde_json::from_slice(&bytes).map_err(|_| PublicError::StateUnavailable)?;
        let object = value
            .as_object()
            .filter(|object| object.len() == 4)
            .ok_or(PublicError::StateUnavailable)?;
        if object.get("kind").and_then(Value::as_str) != Some("synapse-rust-captures")
            || object.get("version").and_then(Value::as_u64) != Some(1)
            || object.get("workspace").and_then(Value::as_str) != Some(self.key.as_str())
        {
            return Err(PublicError::StateUnavailable);
        }
        let entries = object
            .get("captures")
            .and_then(Value::as_array)
            .filter(|entries| entries.len() <= MAX_CAPTURES)
            .ok_or(PublicError::CapacityExceeded)?;
        let mut captures = Vec::new();
        for entry in entries {
            let capture: CapturedResearch =
                serde_json::from_value(entry.clone()).map_err(|_| PublicError::StateUnavailable)?;
            capture.validate()?;
            if capture.id != capture.expected_id(&self.key) {
                return Err(PublicError::StateUnavailable);
            }
            captures.push(capture);
        }
        Ok(captures)
    }
}
impl StateStore for DiskStateStore {
    fn workspace_id(&self) -> &ContentHash {
        &self.key
    }
    fn captures(&self) -> Result<Vec<CapturedResearch>, PublicError> {
        let _guard = self.lock()?;
        self.read_captures()
    }
    fn save_capture(&self, capture: CapturedResearch) -> Result<ContentHash, PublicError> {
        capture.validate()?;
        if capture.source != self.inbox || capture.id != capture.expected_id(&self.key) {
            return Err(PublicError::AccessRefused);
        }
        let _guard = self.lock()?;
        let mut captures = self.read_captures()?;
        if captures.iter().any(|prior| prior.id == capture.id) {
            return Ok(capture.id);
        }
        if captures.len() >= MAX_CAPTURES {
            return Err(PublicError::CapacityExceeded);
        }
        let id = capture.id.clone();
        captures.push(capture);
        let bytes = json!({"kind":"synapse-rust-captures","version":1,"workspace":self.key.as_str(),"captures":captures}).to_string().into_bytes();
        if bytes.len() as u64 > MAX_CAPTURE_STORE_BYTES {
            return Err(PublicError::CapacityExceeded);
        }
        self.write_state(StateFile::Captures, &bytes)?;
        Ok(id)
    }
    fn contradictions(&self) -> Result<Vec<ContradictionReport>, PublicError> {
        let _guard = self.lock()?;
        self.contradictions_locked()
    }
    fn save_contradiction(&self, report: ContradictionReport) -> Result<(), PublicError> {
        if report.severity != synapse_core::ContradictionSeverity::High
            || report.summary.is_empty()
            || report.summary.len() > synapse_core::MAX_CONTRADICTION_SUMMARY
        {
            return Err(PublicError::InvalidModelOutput);
        }
        let _guard = self.lock()?;
        let mut reports = self.contradictions_locked()?;
        if reports.iter().any(|prior| prior.id == report.id) {
            return Ok(());
        }
        if reports.len() >= MAX_CONTRADICTION_REPORTS {
            return Err(PublicError::CapacityExceeded);
        }
        reports.push(report);
        let bytes = json!({
            "kind": "synapse-rust-contradictions",
            "version": 1,
            "workspace": self.key.as_str(),
            "reports": reports
        })
        .to_string()
        .into_bytes();
        if bytes.len() as u64 > MAX_CAPTURE_STORE_BYTES {
            return Err(PublicError::CapacityExceeded);
        }
        self.write_state(StateFile::Contradictions, &bytes)
    }
}
impl DiskStateStore {
    fn contradictions_locked(&self) -> Result<Vec<ContradictionReport>, PublicError> {
        let Some(bytes) = self.read_state(StateFile::Contradictions, MAX_CAPTURE_STORE_BYTES)?
        else {
            return Ok(Vec::new());
        };
        let value: Value =
            serde_json::from_slice(&bytes).map_err(|_| PublicError::StateUnavailable)?;
        if value.get("kind").and_then(Value::as_str) != Some("synapse-rust-contradictions")
            || value.get("version").and_then(Value::as_u64) != Some(1)
            || value.get("workspace").and_then(Value::as_str) != Some(self.key.as_str())
        {
            return Err(PublicError::StateUnavailable);
        }
        let entries = value
            .get("reports")
            .and_then(Value::as_array)
            .ok_or(PublicError::StateUnavailable)?;
        if entries.len() > MAX_CONTRADICTION_REPORTS {
            return Err(PublicError::CapacityExceeded);
        }
        let mut reports = Vec::new();
        for entry in entries {
            reports.push(
                serde_json::from_value(entry.clone()).map_err(|_| PublicError::StateUnavailable)?,
            );
        }
        Ok(reports)
    }
}

/// One fixed global runtime-lock file; all persistent state creation stays here.
pub(crate) fn provider_lease_file() -> Result<OwnedFd, PublicError> {
    let directory = private_directory(&state_location()?)?;
    let fd = match fs::openat(
        &directory,
        "bonsai-18080.lock",
        OFlags::RDWR | OFlags::CREATE | OFlags::EXCL | OFlags::NOFOLLOW | OFlags::CLOEXEC,
        Mode::from_raw_mode(0o600),
    ) {
        Ok(fd) => fd,
        Err(rustix::io::Errno::EXIST) => fs::openat(
            &directory,
            "bonsai-18080.lock",
            OFlags::RDWR | OFlags::NOFOLLOW | OFlags::CLOEXEC,
            Mode::empty(),
        )
        .map_err(|_| PublicError::StateUnavailable)?,
        Err(_) => return Err(PublicError::StateUnavailable),
    };
    verify_state_file(&fd)?;
    Ok(fd)
}

impl DiskStateStore {
    pub(crate) fn prepare_index_files(&self) -> Result<(), PublicError> {
        for name in [
            "index-v1.sqlite3",
            "index-v1.sqlite3-wal",
            "index-v1.sqlite3-shm",
        ] {
            let fd = match fs::openat(
                &self.directory,
                name,
                OFlags::RDWR | OFlags::CREATE | OFlags::EXCL | OFlags::NOFOLLOW | OFlags::CLOEXEC,
                Mode::from_raw_mode(0o600),
            ) {
                Ok(fd) => fd,
                Err(rustix::io::Errno::EXIST) => fs::openat(
                    &self.directory,
                    name,
                    OFlags::RDWR | OFlags::NOFOLLOW | OFlags::CLOEXEC,
                    Mode::empty(),
                )
                .map_err(|_| PublicError::StateUnavailable)?,
                Err(_) => return Err(PublicError::StateUnavailable),
            };
            verify_state_file(&fd)?;
        }
        Ok(())
    }
    pub(crate) fn index_lock(&self) -> Result<IndexLock, PublicError> {
        let fd = match fs::openat(
            &self.directory,
            "index.lock",
            OFlags::RDWR | OFlags::CREATE | OFlags::EXCL | OFlags::NOFOLLOW | OFlags::CLOEXEC,
            Mode::from_raw_mode(0o600),
        ) {
            Ok(fd) => fd,
            Err(rustix::io::Errno::EXIST) => fs::openat(
                &self.directory,
                "index.lock",
                OFlags::RDWR | OFlags::NOFOLLOW | OFlags::CLOEXEC,
                Mode::empty(),
            )
            .map_err(|_| PublicError::StateUnavailable)?,
            Err(_) => return Err(PublicError::StateUnavailable),
        };
        verify_state_file(&fd)?;
        let deadline = Instant::now() + Duration::from_secs(30);
        loop {
            if self.cancel.is_cancelled() {
                return Err(PublicError::Cancelled);
            }
            match fs::flock(&fd, FlockOperation::NonBlockingLockExclusive) {
                Ok(()) => return Ok(IndexLock(fd)),
                Err(rustix::io::Errno::WOULDBLOCK) if Instant::now() < deadline => {
                    std::thread::sleep(LOCK_POLL)
                }
                Err(_) => return Err(PublicError::StateUnavailable),
            }
        }
    }
    pub(crate) fn clear_index(&self) -> Result<(), PublicError> {
        let _lock = self.index_lock()?;
        self.clear_index_locked()
    }
    pub(crate) fn clear_index_locked(&self) -> Result<(), PublicError> {
        for name in [
            "index-v1.sqlite3",
            "index-v1.sqlite3-wal",
            "index-v1.sqlite3-shm",
        ] {
            match fs::unlinkat(&self.directory, name, fs::AtFlags::empty()) {
                Ok(()) | Err(rustix::io::Errno::NOENT) => (),
                Err(_) => return Err(PublicError::StateUnavailable),
            }
        }
        fs::fsync(&self.directory).map_err(|_| PublicError::StateUnavailable)
    }
}
pub(crate) struct IndexLock(OwnedFd);
impl Drop for IndexLock {
    fn drop(&mut self) {
        let _ = fs::flock(&self.0, FlockOperation::Unlock);
    }
}
