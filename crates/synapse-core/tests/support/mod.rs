use synapse_core::{
    Clock, NotePath, NoteReadPort, PublicError, WorkspaceIdentity, WorkspaceReadPort,
};

pub struct Workspace {
    identity: WorkspaceIdentity,
    pub notes: Vec<(NotePath, String)>,
}
impl Workspace {
    pub fn new(notes: &[(&str, &str)]) -> Self {
        Self {
            identity: WorkspaceIdentity::from_canonical_display("synthetic".into()),
            notes: notes.iter().map(|(path, body)| (
                NotePath::parse(path).unwrap_or_else(|error| panic!("synthetic fixture: {error:?}")),
                format!("---\ndescription: Synthetic coverage fixture\ntags: [fixture]\naliases: []\n---\n{body}\n"),
            )).collect(),
        }
    }
}
impl Clock for Workspace {
    fn monotonic_millis(&self) -> u64 {
        0
    }
    fn unix_seconds(&self) -> Result<u64, PublicError> {
        Ok(0)
    }
}
impl WorkspaceReadPort for Workspace {
    fn identity(&self) -> &WorkspaceIdentity {
        &self.identity
    }
}
impl NoteReadPort for Workspace {
    fn list_notes(&self) -> Result<Vec<NotePath>, PublicError> {
        Ok(self.notes.iter().map(|(path, _)| path.clone()).collect())
    }
    fn read_note(&self, path: &NotePath) -> Result<String, PublicError> {
        self.notes
            .iter()
            .find(|(p, _)| p == path)
            .map(|(_, text)| text.clone())
            .ok_or(PublicError::AccessRefused)
    }
    fn modified_note(&self, _: &NotePath) -> Result<u64, PublicError> {
        Ok(0)
    }
}
