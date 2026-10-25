use rustix::fs::{self, AtFlags, FileType, Mode, OFlags};
use std::{
    fs::File,
    io::Read,
    os::fd::OwnedFd,
    path::{Path, PathBuf},
};
use synapse_core::{
    AccessPolicy, Cancellation, Clock, MAX_DEPTH, MAX_FILES, MAX_NOTE_BYTES, NotePath, NoteReadPort,
};
use synapse_core::{PublicError, WorkspaceIdentity, WorkspaceReadPort};

fn absolute_directory(path: &Path) -> rustix::io::Result<OwnedFd> {
    let mut fd = fs::open(
        "/",
        OFlags::RDONLY | OFlags::DIRECTORY | OFlags::CLOEXEC,
        Mode::empty(),
    )?;
    for part in path.components() {
        match part {
            std::path::Component::RootDir => (),
            std::path::Component::Normal(name) => {
                fd = fs::openat(
                    &fd,
                    name,
                    OFlags::RDONLY | OFlags::DIRECTORY | OFlags::NOFOLLOW | OFlags::CLOEXEC,
                    Mode::empty(),
                )?
            }
            _ => return Err(rustix::io::Errno::INVAL),
        }
    }
    Ok(fd)
}
struct ScanFilter {
    controls: Vec<String>,
    folders: Vec<String>,
}
fn file_identity(stat: &fs::Stat) -> String {
    format!("{}:{}", stat.st_dev, stat.st_ino)
}
pub struct CanonicalWorkspace {
    root: PathBuf,
    handle: OwnedFd,
    policy: AccessPolicy,
    started: std::time::Instant,
    cancel: Cancellation,
    identity: WorkspaceIdentity,
}
impl CanonicalWorkspace {
    pub fn open(root: &Path) -> Result<Self, PublicError> {
        let root = root
            .canonicalize()
            .map_err(|_| PublicError::WorkspaceUnavailable)?;
        crate::reject_overlap(&root, &crate::state_location()?)?;
        if !root.is_dir() {
            return Err(PublicError::WorkspaceUnavailable);
        }
        let display = root
            .to_str()
            .ok_or(PublicError::WorkspaceUnavailable)?
            .to_owned();
        let handle = absolute_directory(&root).map_err(|_| PublicError::WorkspaceUnavailable)?;
        Ok(Self {
            handle,
            policy: AccessPolicy::default(),
            started: std::time::Instant::now(),
            cancel: Cancellation::default(),
            root,
            identity: WorkspaceIdentity::from_canonical_display(display),
        })
    }
    fn root_current(&self) -> Result<(), PublicError> {
        let current = absolute_directory(&self.root).map_err(|_| PublicError::AccessRefused)?;
        let current = fs::fstat(&current).map_err(|_| PublicError::AccessRefused)?;
        let held = fs::fstat(&self.handle).map_err(|_| PublicError::AccessRefused)?;
        if file_identity(&current) != file_identity(&held) {
            return Err(PublicError::AccessRefused);
        }
        Ok(())
    }
    pub fn with_cancellation(mut self, cancel: Cancellation) -> Self {
        self.cancel = cancel;
        self
    }
    pub fn with_policy(mut self, policy: AccessPolicy) -> Result<Self, PublicError> {
        policy.validate()?;
        self.policy = policy;
        Ok(self)
    }
    pub fn access_policy(&self) -> &AccessPolicy {
        &self.policy
    }
    pub(crate) fn cancellation(&self) -> Cancellation {
        self.cancel.clone()
    }
    pub(crate) fn state_key(&self) -> Result<synapse_core::ContentHash, PublicError> {
        self.root_current()?;
        let id = file_identity(&fs::fstat(&self.handle).map_err(|_| PublicError::AccessRefused)?);
        Ok(synapse_core::ContentHash::combined(&[
            self.identity.display().as_bytes(),
            id.as_bytes(),
        ]))
    }
    fn note_handle(&self, note: &NotePath) -> Result<File, PublicError> {
        if self.cancel.is_cancelled() {
            return Err(PublicError::Cancelled);
        }
        self.root_current()?;
        if !self.policy.permits_path(note) {
            return Err(PublicError::AccessRefused);
        }
        let parts: Vec<_> = note.as_str().split('/').collect();
        let (name, parents) = parts.split_last().ok_or(PublicError::AccessRefused)?;
        let parent = self.directory(parents)?;
        let fd = fs::openat(
            &parent,
            *name,
            OFlags::RDONLY | OFlags::NOFOLLOW | OFlags::NONBLOCK | OFlags::CLOEXEC,
            Mode::empty(),
        )
        .map_err(|_| PublicError::AccessRefused)?;
        let stat = fs::fstat(&fd).map_err(|_| PublicError::AccessRefused)?;
        if FileType::from_raw_mode(stat.st_mode) != FileType::RegularFile {
            return Err(PublicError::AccessRefused);
        }
        if self.control_ids()?.contains(&file_identity(&stat)) {
            return Err(PublicError::AccessRefused);
        }
        if stat.st_size < 0 || stat.st_size as u64 > MAX_NOTE_BYTES {
            return Err(PublicError::ResourceLimit);
        }
        Ok(File::from(fd))
    }

    /// Bounded notification handles acquired through the same no-follow
    /// directory capability as source reads. Missing hints are safe because
    /// reconciliation is authoritative before every query.
    pub(crate) fn watch_handles(&self, limit: usize) -> Result<Vec<File>, PublicError> {
        self.root_current()?;
        let mut handles = vec![File::from(
            self.raw_directory(&[])
                .map_err(|_| PublicError::AccessRefused)?,
        )];
        for path in self.list_notes()?.into_iter().take(limit) {
            match self.note_handle(&path) {
                Ok(file) => handles.push(file),
                Err(PublicError::Cancelled) => return Err(PublicError::Cancelled),
                Err(_) => (),
            }
        }
        Ok(handles)
    }
    pub fn canonical_root(&self) -> &Path {
        &self.root
    }
}
impl WorkspaceReadPort for CanonicalWorkspace {
    fn identity(&self) -> &WorkspaceIdentity {
        &self.identity
    }
}

impl CanonicalWorkspace {
    // Every open is relative to an already held descriptor. Never resolve a
    // slash-containing descendant with ambient authority. Reject symlinks at
    // each component, including replacement races; no check-then-path-open.
    fn raw_directory(&self, parts: &[&str]) -> rustix::io::Result<OwnedFd> {
        let mut fd = fs::openat(
            &self.handle,
            ".",
            OFlags::RDONLY | OFlags::DIRECTORY | OFlags::CLOEXEC,
            Mode::empty(),
        )?;
        for part in parts {
            fd = fs::openat(
                &fd,
                *part,
                OFlags::RDONLY | OFlags::DIRECTORY | OFlags::NOFOLLOW | OFlags::CLOEXEC,
                Mode::empty(),
            )?;
        }
        Ok(fd)
    }
    fn control_ids(&self) -> Result<Vec<String>, PublicError> {
        let mut ids = Vec::new();
        for path in [&self.policy.instructions, &self.policy.research] {
            let parts: Vec<_> = path.as_str().split('/').collect();
            let (name, parents) = parts.split_last().ok_or(PublicError::AccessRefused)?;
            let stat = (|| {
                let parent = self.raw_directory(parents)?;
                let fd = fs::openat(
                    &parent,
                    *name,
                    OFlags::RDONLY | OFlags::NONBLOCK | OFlags::NOFOLLOW | OFlags::CLOEXEC,
                    Mode::empty(),
                )?;
                fs::fstat(&fd)
            })();
            match stat {
                Ok(stat) if FileType::from_raw_mode(stat.st_mode) == FileType::RegularFile => {
                    let id = file_identity(&stat);
                    if ids.contains(&id) {
                        return Err(PublicError::AccessRefused);
                    }
                    ids.push(id);
                }
                Err(rustix::io::Errno::NOENT) => (),
                _ => return Err(PublicError::AccessRefused),
            }
        }
        Ok(ids)
    }
    fn folder_ids(&self) -> Result<Vec<String>, PublicError> {
        let mut ids = Vec::new();
        for folder in &self.policy.folders {
            match self.raw_directory(&folder.split('/').collect::<Vec<_>>()) {
                Ok(fd) => ids.push(file_identity(
                    &fs::fstat(&fd).map_err(|_| PublicError::AccessRefused)?,
                )),
                Err(
                    rustix::io::Errno::NOENT | rustix::io::Errno::NOTDIR | rustix::io::Errno::LOOP,
                ) => (),
                Err(_) => return Err(PublicError::AccessRefused),
            }
        }
        Ok(ids)
    }
    fn directory(&self, parts: &[&str]) -> Result<OwnedFd, PublicError> {
        let excluded = self.folder_ids()?;
        let mut fd = self
            .raw_directory(&[])
            .map_err(|_| PublicError::AccessRefused)?;
        for part in parts {
            fd = fs::openat(
                &fd,
                *part,
                OFlags::RDONLY | OFlags::DIRECTORY | OFlags::NOFOLLOW | OFlags::CLOEXEC,
                Mode::empty(),
            )
            .map_err(|_| PublicError::AccessRefused)?;
            if excluded.contains(&file_identity(
                &fs::fstat(&fd).map_err(|_| PublicError::AccessRefused)?,
            )) {
                return Err(PublicError::AccessRefused);
            }
        }
        Ok(fd)
    }
    fn walk(
        &self,
        fd: &OwnedFd,
        prefix: &str,
        depth: usize,
        visited: &mut usize,
        result: &mut Vec<NotePath>,
        filter: &ScanFilter,
    ) -> Result<(), PublicError> {
        if depth > MAX_DEPTH {
            return Err(PublicError::ResourceLimit);
        }
        let mut entries = fs::Dir::read_from(fd).map_err(|_| PublicError::AccessRefused)?;
        while let Some(entry) = entries.read() {
            if self.cancel.is_cancelled() {
                return Err(PublicError::Cancelled);
            }
            let entry = entry.map_err(|_| PublicError::AccessRefused)?;
            let Ok(name) = entry.file_name().to_str() else {
                continue;
            };
            if name == "." || name == ".." {
                continue;
            }
            *visited += 1;
            if *visited > MAX_FILES {
                return Err(PublicError::ResourceLimit);
            }
            if name.starts_with('.') {
                continue;
            }
            let path = format!("{prefix}{name}");
            if !self.policy.permits_directory(&path) {
                continue;
            }
            let stat = fs::statat(fd, name, AtFlags::SYMLINK_NOFOLLOW)
                .map_err(|_| PublicError::AccessRefused)?;
            match FileType::from_raw_mode(stat.st_mode) {
                FileType::Directory => {
                    if filter.folders.contains(&file_identity(&stat)) {
                        continue;
                    }
                    let child = fs::openat(
                        fd,
                        name,
                        OFlags::RDONLY | OFlags::DIRECTORY | OFlags::NOFOLLOW | OFlags::CLOEXEC,
                        Mode::empty(),
                    )
                    .map_err(|_| PublicError::AccessRefused)?;
                    if filter.folders.contains(&file_identity(
                        &fs::fstat(&child).map_err(|_| PublicError::AccessRefused)?,
                    )) {
                        continue;
                    }
                    self.walk(
                        &child,
                        &format!("{path}/"),
                        depth + 1,
                        visited,
                        result,
                        filter,
                    )?;
                }
                FileType::RegularFile if name.ends_with(".md") => {
                    if filter.controls.contains(&file_identity(&stat)) {
                        continue;
                    }
                    let note = NotePath::parse(&path)?;
                    if self.policy.permits_path(&note) {
                        result.push(note);
                    }
                }
                _ => (),
            }
        }
        Ok(())
    }
}
impl NoteReadPort for CanonicalWorkspace {
    fn modified_note(&self, note: &NotePath) -> Result<u64, PublicError> {
        if self.cancel.is_cancelled() {
            return Err(PublicError::Cancelled);
        }
        self.root_current()?;
        if !self.policy.permits_path(note) {
            return Err(PublicError::AccessRefused);
        }
        let parts: Vec<_> = note.as_str().split('/').collect();
        let (name, parents) = parts.split_last().ok_or(PublicError::AccessRefused)?;
        let parent = self.directory(parents)?;
        let fd = fs::openat(
            &parent,
            *name,
            OFlags::RDONLY | OFlags::NOFOLLOW | OFlags::NONBLOCK | OFlags::CLOEXEC,
            Mode::empty(),
        )
        .map_err(|_| PublicError::AccessRefused)?;
        if self.control_ids()?.contains(&file_identity(
            &fs::fstat(&fd).map_err(|_| PublicError::AccessRefused)?,
        )) {
            return Err(PublicError::AccessRefused);
        }
        let metadata = File::from(fd)
            .metadata()
            .map_err(|_| PublicError::AccessRefused)?;
        if !metadata.is_file() {
            return Err(PublicError::AccessRefused);
        }
        metadata
            .modified()
            .map_err(|_| PublicError::AccessRefused)?
            .duration_since(std::time::UNIX_EPOCH)
            .map(|value| value.as_secs())
            .map_err(|_| PublicError::AccessRefused)
    }

    fn read_note(&self, note: &NotePath) -> Result<String, PublicError> {
        let file = self.note_handle(note)?;
        let mut bytes = Vec::new();
        file.take(MAX_NOTE_BYTES + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| PublicError::AccessRefused)?;
        if bytes.len() as u64 > MAX_NOTE_BYTES {
            return Err(PublicError::ResourceLimit);
        }
        String::from_utf8(bytes).map_err(|_| PublicError::InvalidMetadata)
    }
    fn list_notes(&self) -> Result<Vec<NotePath>, PublicError> {
        if self.cancel.is_cancelled() {
            return Err(PublicError::Cancelled);
        }
        self.root_current()?;
        let mut result = Vec::new();
        let filter = ScanFilter {
            controls: self.control_ids()?,
            folders: self.folder_ids()?,
        };
        self.walk(&self.handle, "", 0, &mut 0, &mut result, &filter)?;
        result.sort();
        Ok(result)
    }
}

impl Clock for CanonicalWorkspace {
    fn monotonic_millis(&self) -> u64 {
        u64::try_from(self.started.elapsed().as_millis()).unwrap_or(u64::MAX)
    }
    fn unix_seconds(&self) -> Result<u64, PublicError> {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|value| value.as_secs())
            .map_err(|_| PublicError::WorkspaceUnavailable)
    }
}

impl CanonicalWorkspace {
    fn snapshot(
        &self,
        path: &NotePath,
        control: bool,
        maximum: u64,
    ) -> Result<synapse_core::FileSnapshot, PublicError> {
        use std::os::unix::fs::MetadataExt;
        use synapse_core::{FileSnapshot, ParentSnapshot};
        if self.cancel.is_cancelled() {
            return Err(PublicError::Cancelled);
        }
        self.root_current()?;
        if !self.policy.permits_directory(path.as_str())
            || (!control && !self.policy.permits_path(path))
        {
            return Err(PublicError::AccessRefused);
        }
        let controls = self.control_ids()?;
        let excluded = self.folder_ids()?;
        let parts: Vec<_> = path.as_str().split('/').collect();
        let (name, parent_parts) = parts.split_last().ok_or(PublicError::AccessRefused)?;
        let mut fd = self
            .raw_directory(&[])
            .map_err(|_| PublicError::AccessRefused)?;
        let mut parents = Vec::new();
        let mut prefix = String::new();
        let mut missing = false;
        for part in parent_parts {
            if !prefix.is_empty() {
                prefix.push('/');
            }
            prefix.push_str(part);
            if missing {
                parents.push(ParentSnapshot {
                    path: prefix.clone(),
                    identity: None,
                });
                continue;
            }
            match fs::openat(
                &fd,
                *part,
                OFlags::RDONLY | OFlags::DIRECTORY | OFlags::NOFOLLOW | OFlags::CLOEXEC,
                Mode::empty(),
            ) {
                Ok(child) => {
                    let id =
                        file_identity(&fs::fstat(&child).map_err(|_| PublicError::AccessRefused)?);
                    if part.starts_with('.') || excluded.contains(&id) {
                        return Err(PublicError::AccessRefused);
                    }
                    parents.push(ParentSnapshot {
                        path: prefix.clone(),
                        identity: Some(id),
                    });
                    fd = child;
                }
                Err(rustix::io::Errno::NOENT) => {
                    missing = true;
                    parents.push(ParentSnapshot {
                        path: prefix.clone(),
                        identity: None,
                    });
                }
                Err(_) => return Err(PublicError::AccessRefused),
            }
        }
        let mut snapshot = FileSnapshot {
            workspace: self.state_key()?,
            path: path.clone(),
            before: None,
            identity: None,
            mode: None,
            owner: None,
            links: None,
            parents,
        };
        if missing {
            return Ok(snapshot);
        }
        let file = match fs::openat(
            &fd,
            *name,
            OFlags::RDONLY | OFlags::NONBLOCK | OFlags::NOFOLLOW | OFlags::CLOEXEC,
            Mode::empty(),
        ) {
            Ok(file) => file,
            Err(rustix::io::Errno::NOENT) => return Ok(snapshot),
            Err(_) => return Err(PublicError::AccessRefused),
        };
        let stat = fs::fstat(&file).map_err(|_| PublicError::AccessRefused)?;
        if FileType::from_raw_mode(stat.st_mode) != FileType::RegularFile
            || (!control && controls.contains(&file_identity(&stat)))
        {
            return Err(PublicError::AccessRefused);
        }
        if stat.st_size < 0 || stat.st_size as u64 > maximum {
            return Err(PublicError::ResourceLimit);
        }
        let mut file = File::from(file);
        let metadata = file.metadata().map_err(|_| PublicError::AccessRefused)?;
        let mut bytes = Vec::new();
        (&mut file)
            .take(maximum + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| PublicError::AccessRefused)?;
        if bytes.len() as u64 > maximum {
            return Err(PublicError::ResourceLimit);
        }
        self.root_current()?;
        let fresh_parent = self.directory(parent_parts)?;
        if file_identity(&fs::fstat(&fresh_parent).map_err(|_| PublicError::AccessRefused)?)
            != file_identity(&fs::fstat(&fd).map_err(|_| PublicError::AccessRefused)?)
        {
            return Err(PublicError::Conflict);
        }
        let fresh = fs::statat(&fresh_parent, *name, AtFlags::SYMLINK_NOFOLLOW)
            .map_err(|_| PublicError::Conflict)?;
        if file_identity(&fresh) != file_identity(&stat)
            || file
                .metadata()
                .map_err(|_| PublicError::AccessRefused)?
                .modified()
                .ok()
                != metadata.modified().ok()
        {
            return Err(PublicError::Conflict);
        }
        if !control && self.control_ids()?.contains(&file_identity(&stat)) {
            return Err(PublicError::AccessRefused);
        }
        snapshot.before = Some(String::from_utf8(bytes).map_err(|_| PublicError::AccessRefused)?);
        snapshot.identity = Some(file_identity(&stat));
        snapshot.mode = Some(metadata.mode());
        snapshot.owner = Some(metadata.uid());
        snapshot.links = Some(metadata.nlink());
        Ok(snapshot)
    }
}
impl synapse_core::ControlReadPort for CanonicalWorkspace {
    fn instructions(&self) -> Result<Option<String>, PublicError> {
        Ok(self
            .snapshot(
                &self.policy.instructions,
                true,
                synapse_core::MAX_INSTRUCTION_BYTES as u64,
            )?
            .before)
    }
    fn inbox(&self) -> Result<Option<String>, PublicError> {
        Ok(self
            .snapshot(
                &self.policy.research,
                true,
                synapse_core::MAX_CONTROL_BYTES as u64,
            )?
            .before)
    }
}
impl synapse_core::ProposalReadPort for CanonicalWorkspace {
    fn access_policy(&self) -> &AccessPolicy {
        &self.policy
    }
    fn workspace_id(&self) -> Result<synapse_core::ContentHash, PublicError> {
        self.state_key()
    }
    fn snapshot_note(&self, path: &NotePath) -> Result<synapse_core::FileSnapshot, PublicError> {
        self.snapshot(path, false, MAX_NOTE_BYTES)
    }
    fn snapshot_control(
        &self,
        control: synapse_core::ControlFile,
    ) -> Result<synapse_core::FileSnapshot, PublicError> {
        match control {
            synapse_core::ControlFile::Instructions => self.snapshot(
                &self.policy.instructions,
                true,
                synapse_core::MAX_INSTRUCTION_BYTES as u64,
            ),
            synapse_core::ControlFile::Research => self.snapshot(
                &self.policy.research,
                true,
                synapse_core::MAX_CONTROL_BYTES as u64,
            ),
        }
    }
}

impl CanonicalWorkspace {
    /// Restricted atomic replacement. Caller holds the workspace journal lock and
    /// has durably recorded intent. A final snapshot check precedes replacement;
    /// POSIX provides no compare-and-swap against unrelated external editors.
    pub(crate) fn replace_reviewed(
        &self,
        expected: &synapse_core::FileSnapshot,
        after: &str,
        kind: synapse_core::ProposalKind,
    ) -> Result<(), PublicError> {
        use synapse_core::ProposalReadPort;
        let current = || {
            if expected.path == self.policy.instructions {
                self.snapshot_control(synapse_core::ControlFile::Instructions)
            } else if expected.path == self.policy.research {
                self.snapshot_control(synapse_core::ControlFile::Research)
            } else {
                self.snapshot_note(&expected.path)
            }
        };
        if current()? != *expected || after.len() as u64 > MAX_NOTE_BYTES {
            return Err(PublicError::Conflict);
        }
        if kind == synapse_core::ProposalKind::Setup {
            let starter = if expected.path == self.policy.instructions {
                synapse_core::setup_instruction_bytes()
            } else if expected.path == self.policy.research {
                synapse_core::setup_research_bytes()
            } else {
                return Err(PublicError::AccessRefused);
            };
            if expected.before.is_some() || after != starter {
                return Err(PublicError::AccessRefused);
            }
        } else if !self.policy.permits_path(&expected.path)
            || (kind != synapse_core::ProposalKind::Revert
                && !synapse_core::ordinary_content(after, &self.policy))
            || synapse_core::source_excluded(after, &self.policy)
            || expected.links.is_some_and(|links| links != 1)
            || expected
                .owner
                .is_some_and(|owner| owner != rustix::process::getuid().as_raw())
        {
            return Err(PublicError::AccessRefused);
        }
        self.write_snapshot(expected, after)
    }
    pub(crate) fn delete_reviewed(
        &self,
        expected: &synapse_core::FileSnapshot,
    ) -> Result<(), PublicError> {
        use synapse_core::ProposalReadPort;
        if expected.path == self.policy.instructions
            || expected.path == self.policy.research
            || !self.policy.permits_path(&expected.path)
            || expected.before.is_none()
            || expected.links.is_some_and(|links| links != 1)
            || expected
                .owner
                .is_some_and(|owner| owner != rustix::process::getuid().as_raw())
            || synapse_core::source_excluded(expected.before.as_deref().unwrap_or(""), &self.policy)
        {
            return Err(PublicError::AccessRefused);
        }
        if self.snapshot_note(&expected.path)? != *expected {
            return Err(PublicError::Conflict);
        }
        let parts: Vec<_> = expected.path.as_str().split('/').collect();
        let (name, parents) = parts.split_last().ok_or(PublicError::AccessRefused)?;
        let parent = self
            .raw_directory(parents)
            .map_err(|_| PublicError::AccessRefused)?;
        if self.cancel.is_cancelled() {
            return Err(PublicError::Cancelled);
        }
        if self.snapshot_note(&expected.path)? != *expected {
            return Err(PublicError::Conflict);
        }
        fs::unlinkat(&parent, *name, AtFlags::empty())
            .map_err(|_| PublicError::RecoveryRequired)?;
        fs::fsync(&parent).map_err(|_| PublicError::RecoveryRequired)
    }
    pub(crate) fn rename_reviewed(
        &self,
        expected: &synapse_core::FileSnapshot,
        dest: &NotePath,
    ) -> Result<(), PublicError> {
        use synapse_core::ProposalReadPort;
        if expected.path == self.policy.instructions
            || expected.path == self.policy.research
            || *dest == self.policy.instructions
            || *dest == self.policy.research
            || *dest == expected.path
            || !self.policy.permits_path(&expected.path)
            || !self.policy.permits_path(dest)
            || expected.before.is_none()
            || expected.links.is_some_and(|links| links != 1)
            || expected
                .owner
                .is_some_and(|owner| owner != rustix::process::getuid().as_raw())
            || synapse_core::source_excluded(expected.before.as_deref().unwrap_or(""), &self.policy)
        {
            return Err(PublicError::AccessRefused);
        }
        if self.snapshot_note(&expected.path)? != *expected {
            return Err(PublicError::Conflict);
        }
        if self.snapshot_note(dest)?.before.is_some() {
            return Err(PublicError::Conflict);
        }
        let src_parts: Vec<_> = expected.path.as_str().split('/').collect();
        let (src_name, src_parents) = src_parts.split_last().ok_or(PublicError::AccessRefused)?;
        let dest_parts: Vec<_> = dest.as_str().split('/').collect();
        let (dest_name, dest_parents) =
            dest_parts.split_last().ok_or(PublicError::AccessRefused)?;
        // Destination parents must already exist; rename never creates folders.
        let dest_parent = self
            .raw_directory(dest_parents)
            .map_err(|_| PublicError::AccessRefused)?;
        let src_parent = self
            .raw_directory(src_parents)
            .map_err(|_| PublicError::AccessRefused)?;
        if self.cancel.is_cancelled() {
            return Err(PublicError::Cancelled);
        }
        if self.snapshot_note(&expected.path)? != *expected {
            return Err(PublicError::Conflict);
        }
        fs::renameat_with(
            &src_parent,
            *src_name,
            &dest_parent,
            *dest_name,
            fs::RenameFlags::NOREPLACE,
        )
        .map_err(|_| PublicError::Conflict)?;
        fs::fsync(&src_parent).map_err(|_| PublicError::RecoveryRequired)?;
        fs::fsync(&dest_parent).map_err(|_| PublicError::RecoveryRequired)
    }
    pub(crate) fn append_scoped_inbox(
        &self,
        expected: &synapse_core::FileSnapshot,
        addition: &str,
    ) -> Result<(), PublicError> {
        use synapse_core::ProposalReadPort;
        if expected.path != self.policy.research
            || self.snapshot_control(synapse_core::ControlFile::Research)? != *expected
            || expected.links.is_some_and(|links| links != 1)
            || expected
                .owner
                .is_some_and(|owner| owner != rustix::process::getuid().as_raw())
            || synapse_core::source_excluded(expected.before.as_deref().unwrap_or(""), &self.policy)
            || expected
                .parents
                .iter()
                .any(|parent| parent.identity.is_none())
        {
            return Err(PublicError::AccessRefused);
        }
        let after = format!("{}{addition}", expected.before.as_deref().unwrap_or(""));
        if after.len() > synapse_core::MAX_CONTROL_BYTES {
            return Err(PublicError::CapacityExceeded);
        }
        self.write_snapshot(expected, &after)
    }
    fn write_snapshot(
        &self,
        expected: &synapse_core::FileSnapshot,
        after: &str,
    ) -> Result<(), PublicError> {
        use std::io::Write;
        use synapse_core::ProposalReadPort;
        let current = || {
            if expected.path == self.policy.instructions {
                self.snapshot_control(synapse_core::ControlFile::Instructions)
            } else if expected.path == self.policy.research {
                self.snapshot_control(synapse_core::ControlFile::Research)
            } else {
                self.snapshot_note(&expected.path)
            }
        };
        let parts: Vec<_> = expected.path.as_str().split('/').collect();
        let (name, parents) = parts.split_last().ok_or(PublicError::AccessRefused)?;
        let mut parent = self
            .raw_directory(&[])
            .map_err(|_| PublicError::AccessRefused)?;
        for part in parents {
            match fs::openat(
                &parent,
                *part,
                OFlags::RDONLY | OFlags::DIRECTORY | OFlags::NOFOLLOW | OFlags::CLOEXEC,
                Mode::empty(),
            ) {
                Ok(child) => parent = child,
                Err(rustix::io::Errno::NOENT)
                    if expected.parents.iter().any(|p| {
                        p.path.rsplit('/').next() == Some(*part) && p.identity.is_none()
                    }) =>
                {
                    fs::mkdirat(&parent, *part, Mode::from_raw_mode(0o700))
                        .map_err(|_| PublicError::Conflict)?;
                    fs::fsync(&parent).map_err(|_| PublicError::RecoveryRequired)?;
                    parent = fs::openat(
                        &parent,
                        *part,
                        OFlags::RDONLY | OFlags::DIRECTORY | OFlags::NOFOLLOW | OFlags::CLOEXEC,
                        Mode::empty(),
                    )
                    .map_err(|_| PublicError::Conflict)?;
                }
                Err(_) => return Err(PublicError::AccessRefused),
            }
        }
        // Parent creation changes only reviewed missing-parent identities.
        let adjusted = current()?;
        if adjusted.before != expected.before
            || adjusted.identity != expected.identity
            || adjusted.mode != expected.mode
            || adjusted.owner != expected.owner
            || adjusted.links != expected.links
            || adjusted
                .parents
                .iter()
                .zip(&expected.parents)
                .any(|(a, b)| b.identity.is_some() && a != b)
        {
            return Err(PublicError::Conflict);
        }
        let mut random = [0; 16];
        getrandom::getrandom(&mut random).map_err(|_| PublicError::StateUnavailable)?;
        let stage = format!(".synapse-stage-{}.tmp", synapse_core::hex_encode(&random));
        let fd = fs::openat(
            &parent,
            stage.as_str(),
            OFlags::WRONLY | OFlags::CREATE | OFlags::EXCL | OFlags::NOFOLLOW | OFlags::CLOEXEC,
            Mode::from_raw_mode(0o600),
        )
        .map_err(|_| PublicError::Conflict)?;
        let mut file = File::from(fd);
        file.write_all(after.as_bytes())
            .and_then(|_| file.sync_all())
            .map_err(|_| PublicError::RecoveryRequired)?;
        if let Some(mode) = expected.mode {
            fs::fchmod(&file, Mode::from_raw_mode((mode & 0o777) as _))
                .map_err(|_| PublicError::AccessRefused)?;
            file.sync_all().map_err(|_| PublicError::RecoveryRequired)?;
        }
        if self.cancel.is_cancelled() {
            return Err(PublicError::Cancelled);
        }
        if current()? != adjusted {
            return Err(PublicError::Conflict);
        }
        if expected.before.is_none() {
            fs::renameat_with(
                &parent,
                stage.as_str(),
                &parent,
                *name,
                fs::RenameFlags::NOREPLACE,
            )
            .map_err(|_| PublicError::Conflict)?;
        } else {
            fs::renameat(&parent, stage.as_str(), &parent, *name)
                .map_err(|_| PublicError::RecoveryRequired)?;
        }
        fs::fsync(&parent).map_err(|_| PublicError::RecoveryRequired)
    }
}
