use rustix::fs::{self, AtFlags, FileType, Mode, OFlags};
use std::{
    fs::File,
    io::Read,
    os::fd::OwnedFd,
    path::{Path, PathBuf},
};
use synapse_core::{AccessPolicy, MAX_DEPTH, MAX_FILES, MAX_NOTE_BYTES, NotePath, NoteReadPort};
use synapse_core::{PublicError, WorkspaceIdentity, WorkspaceReadPort};

pub struct CanonicalWorkspace {
    root: PathBuf,
    handle: OwnedFd,
    policy: AccessPolicy,
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
        let mut handle = fs::open(
            "/",
            OFlags::RDONLY | OFlags::DIRECTORY | OFlags::CLOEXEC,
            Mode::empty(),
        )
        .map_err(|_| PublicError::WorkspaceUnavailable)?;
        for part in root.components() {
            match part {
                std::path::Component::RootDir => (),
                std::path::Component::Normal(name) => {
                    handle = fs::openat(
                        &handle,
                        name,
                        OFlags::RDONLY | OFlags::DIRECTORY | OFlags::NOFOLLOW | OFlags::CLOEXEC,
                        Mode::empty(),
                    )
                    .map_err(|_| PublicError::WorkspaceUnavailable)?;
                }
                _ => return Err(PublicError::WorkspaceUnavailable),
            }
        }
        Ok(Self {
            handle,
            policy: AccessPolicy::default(),
            root,
            identity: WorkspaceIdentity::from_canonical_display(display),
        })
    }
    pub fn with_policy(mut self, policy: AccessPolicy) -> Result<Self, PublicError> {
        if policy.instructions == policy.research
            || policy.folders.len() > 128
            || policy.tags.len() > 128
            || policy
                .tags
                .iter()
                .any(|tag| tag.trim().is_empty() || tag.chars().count() > 64)
            || policy.folders.iter().any(|folder| {
                folder.is_empty()
                    || folder
                        .split('/')
                        .any(|part| part.is_empty() || part == "." || part == "..")
                    || folder.contains(['\\', ':'])
            })
        {
            return Err(PublicError::AccessRefused);
        }
        self.policy = policy;
        Ok(self)
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
    fn directory(&self, parts: &[&str]) -> Result<OwnedFd, PublicError> {
        let mut fd = fs::openat(
            &self.handle,
            ".",
            OFlags::RDONLY | OFlags::DIRECTORY | OFlags::CLOEXEC,
            Mode::empty(),
        )
        .map_err(|_| PublicError::AccessRefused)?;
        for part in parts {
            fd = fs::openat(
                &fd,
                *part,
                OFlags::RDONLY | OFlags::DIRECTORY | OFlags::NOFOLLOW | OFlags::CLOEXEC,
                Mode::empty(),
            )
            .map_err(|_| PublicError::AccessRefused)?;
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
    ) -> Result<(), PublicError> {
        if depth > MAX_DEPTH {
            return Err(PublicError::ResourceLimit);
        }
        let mut entries = fs::Dir::read_from(fd).map_err(|_| PublicError::AccessRefused)?;
        while let Some(entry) = entries.read() {
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
            if self
                .policy
                .folders
                .iter()
                .any(|folder| path == *folder || path.starts_with(&format!("{folder}/")))
            {
                continue;
            }
            let stat = fs::statat(fd, name, AtFlags::SYMLINK_NOFOLLOW)
                .map_err(|_| PublicError::AccessRefused)?;
            match FileType::from_raw_mode(stat.st_mode) {
                FileType::Directory => {
                    let child = fs::openat(
                        fd,
                        name,
                        OFlags::RDONLY | OFlags::DIRECTORY | OFlags::NOFOLLOW | OFlags::CLOEXEC,
                        Mode::empty(),
                    )
                    .map_err(|_| PublicError::AccessRefused)?;
                    self.walk(&child, &format!("{path}/"), depth + 1, visited, result)?;
                }
                FileType::RegularFile if name.ends_with(".md") => {
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
        if stat.st_size < 0 || stat.st_size as u64 > MAX_NOTE_BYTES {
            return Err(PublicError::ResourceLimit);
        }
        let file = File::from(fd);
        let mut bytes = Vec::new();
        file.take(MAX_NOTE_BYTES + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| PublicError::AccessRefused)?;
        if bytes.len() as u64 > MAX_NOTE_BYTES {
            return Err(PublicError::ResourceLimit);
        }
        String::from_utf8(bytes).map_err(|_| PublicError::AccessRefused)
    }
    fn list_notes(&self) -> Result<Vec<NotePath>, PublicError> {
        let mut result = Vec::new();
        self.walk(&self.handle, "", 0, &mut 0, &mut result)?;
        result.sort();
        Ok(result)
    }
}
