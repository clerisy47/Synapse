//! Unix descriptor-relative read capability. No path-based descendant opens.
//! NOFOLLOW is applied to every component; DIRECTORY pins ancestors and NONBLOCK
//! avoids hanging on a replaced FIFO. Every scan revalidates identities from the
//! root before publishing. Concurrent editors are not a filesystem transaction.
use rustix::fs::{AtFlags, Dir, FileType, Mode, OFlags, openat, statat};
use std::fs::{self, File};
use std::io::Read;
use std::os::unix::fs::MetadataExt;
use std::path::{Path, PathBuf};
use synapse_core::{
    Attention, CorpusError, CorpusPolicy, CorpusReadPort, NotePath, Scan, parse_document,
};

pub struct WorkspaceCorpus {
    root: File,
    root_path: PathBuf,
    identity: (u64, u64),
}
fn identity(file: &File) -> Result<(u64, u64), CorpusError> {
    let m = file.metadata().map_err(|_| CorpusError::Access)?;
    Ok((m.dev(), m.ino()))
}
impl WorkspaceCorpus {
    /// State is never created or imported here. Require an explicit external
    /// state location, resolving existing ancestors and rejecting symlinks.
    pub fn open(selected: &Path, state_root: &Path) -> Result<Self, CorpusError> {
        let root_path = fs::canonicalize(selected).map_err(|_| CorpusError::Access)?;
        let state = external_state(state_root)?;
        if state.starts_with(&root_path) || root_path.starts_with(&state) {
            return Err(CorpusError::Policy);
        }
        let fd = rustix::fs::open(
            &root_path,
            OFlags::RDONLY | OFlags::DIRECTORY | OFlags::NOFOLLOW | OFlags::CLOEXEC,
            Mode::empty(),
        )
        .map_err(|_| CorpusError::Access)?;
        let root = File::from(fd);
        let identity = identity(&root)?;
        let reader = Self {
            root,
            root_path,
            identity,
        };
        reader.check_root()?;
        Ok(reader)
    }
    pub fn canonical_root(&self) -> &Path {
        &self.root_path
    }
    fn check_root(&self) -> Result<(), CorpusError> {
        let m = fs::symlink_metadata(&self.root_path).map_err(|_| CorpusError::Stale)?;
        if !m.is_dir() || (m.dev(), m.ino()) != self.identity {
            return Err(CorpusError::Stale);
        }
        Ok(())
    }
    fn reopen(&self, path: &str) -> Result<File, CorpusError> {
        let mut current = self.root.try_clone().map_err(|_| CorpusError::Access)?;
        let parts: Vec<_> = path.split('/').collect();
        for (n, part) in parts.iter().enumerate() {
            let mut flags = OFlags::RDONLY | OFlags::NOFOLLOW | OFlags::CLOEXEC | OFlags::NONBLOCK;
            if n + 1 < parts.len() {
                flags |= OFlags::DIRECTORY;
            }
            current = File::from(
                openat(&current, *part, flags, Mode::empty()).map_err(|_| CorpusError::Stale)?,
            );
        }
        Ok(current)
    }
    fn walk(
        directory: &File,
        prefix: &str,
        policy: &CorpusPolicy,
        state: &mut ScanState,
        depth: usize,
    ) -> Result<(), CorpusError> {
        if depth > policy.limits().depth {
            return Err(CorpusError::Limit);
        }
        let entries = Dir::read_from(directory).map_err(|_| CorpusError::Access)?;
        let mut names = Vec::new();
        for entry in entries {
            let entry = entry.map_err(|_| CorpusError::Access)?;
            if matches!(entry.file_name().to_bytes(), b"." | b"..") {
                continue;
            }
            state.count += 1;
            if state.count > policy.limits().entries {
                return Err(CorpusError::Limit);
            }
            let name = match entry.file_name().to_str() {
                Ok(s) => s,
                Err(_) => continue,
            };
            names.push(name.to_owned());
        }
        names.sort();
        for name in names {
            let path = if prefix.is_empty() {
                name.clone()
            } else {
                format!("{prefix}/{name}")
            };
            if !policy.permits(&path) {
                continue;
            }
            let stat = statat(directory, name.as_str(), AtFlags::SYMLINK_NOFOLLOW)
                .map_err(|_| CorpusError::Stale)?;
            let kind = FileType::from_raw_mode(stat.st_mode);
            if kind == FileType::Symlink {
                continue;
            }
            if kind != FileType::Directory
                && (kind != FileType::RegularFile || !name.ends_with(".md"))
            {
                continue;
            }
            let mut flags = OFlags::RDONLY | OFlags::NOFOLLOW | OFlags::CLOEXEC | OFlags::NONBLOCK;
            if kind == FileType::Directory {
                flags |= OFlags::DIRECTORY;
            }
            let file = File::from(
                openat(directory, name.as_str(), flags, Mode::empty())
                    .map_err(|_| CorpusError::Stale)?,
            );
            let meta = file.metadata().map_err(|_| CorpusError::Access)?;
            let opened = rustix::fs::fstat(&file).map_err(|_| CorpusError::Access)?;
            if opened.st_dev != stat.st_dev || opened.st_ino != stat.st_ino {
                return Err(CorpusError::Stale);
            }
            state.identities.push((path.clone(), identity(&file)?));
            if kind == FileType::Directory {
                Self::walk(&file, &path, policy, state, depth + 1)?;
                continue;
            }
            if !meta.is_file() {
                return Err(CorpusError::Stale);
            }
            let note = match NotePath::parse(&path) {
                Ok(p) => p,
                Err(_) => continue,
            };
            if meta.len() > policy.limits().file_bytes as u64 {
                state.scan.attention.push(Attention { path: note });
                continue;
            }
            let mut bytes = Vec::new();
            file.take(policy.limits().file_bytes as u64 + 1)
                .read_to_end(&mut bytes)
                .map_err(|_| CorpusError::Access)?;
            state.bytes = state
                .bytes
                .checked_add(bytes.len())
                .ok_or(CorpusError::Limit)?;
            if state.bytes > policy.limits().total_bytes {
                return Err(CorpusError::Limit);
            }
            if bytes.len() > policy.limits().file_bytes {
                state.scan.attention.push(Attention { path: note });
                continue;
            }
            match String::from_utf8(bytes)
                .ok()
                .and_then(|text| parse_document(note.clone(), &text, policy).ok())
            {
                Some(Some(doc)) => state.scan.documents.push(doc),
                Some(None) => (),
                None => state.scan.attention.push(Attention { path: note }),
            }
        }
        Ok(())
    }
}
#[derive(Default)]
struct ScanState {
    scan: Scan,
    count: usize,
    bytes: usize,
    identities: Vec<(String, (u64, u64))>,
}
impl CorpusReadPort for WorkspaceCorpus {
    fn scan(&self, policy: &CorpusPolicy) -> Result<Scan, CorpusError> {
        self.check_root()?;
        let mut state = ScanState::default();
        Self::walk(&self.root, "", policy, &mut state, 0)?;
        for (path, expected) in state.identities {
            if identity(&self.reopen(&path)?)? != expected {
                return Err(CorpusError::Stale);
            }
        }
        self.check_root()?;
        state
            .scan
            .documents
            .sort_by(|a, b| a.path.as_str().cmp(b.path.as_str()));
        state
            .scan
            .attention
            .sort_by(|a, b| a.path.as_str().cmp(b.path.as_str()));
        Ok(state.scan)
    }
}
fn external_state(path: &Path) -> Result<PathBuf, CorpusError> {
    if !path.is_absolute() {
        return Err(CorpusError::Policy);
    }
    let mut result = PathBuf::new();
    for part in path.components() {
        match part {
            std::path::Component::RootDir => result.push("/"),
            std::path::Component::Normal(p) => result.push(p),
            _ => return Err(CorpusError::Policy),
        }
        match fs::symlink_metadata(&result) {
            Ok(m) if m.file_type().is_symlink() || !m.is_dir() => return Err(CorpusError::Policy),
            Ok(_) => (),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => (),
            Err(_) => return Err(CorpusError::Access),
        }
    }
    Ok(result)
}
