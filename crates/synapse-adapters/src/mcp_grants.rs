use crate::{DiskStateStore, state_store::StateFile};
use serde::{Deserialize, Serialize};
use synapse_core::{ContentHash, PublicError};
const MAX_CLIENTS: usize = 16;
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ClientGrant {
    pub id: String,
    pub query: bool,
    pub submit: bool,
    pub(crate) policy: ContentHash,
    digest: ContentHash,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Grants {
    version: u32,
    clients: Vec<ClientGrant>,
}
fn equal(a: &[u8], b: &[u8]) -> bool {
    let mut difference = a.len() ^ b.len();
    for i in 0..64 {
        difference |= usize::from(a.get(i).copied().unwrap_or(0) ^ b.get(i).copied().unwrap_or(0));
    }
    difference == 0
}
impl DiskStateStore {
    fn grants_locked(&self) -> Result<Vec<ClientGrant>, PublicError> {
        let Some(bytes) = self.read_state(StateFile::Grants, 32_000)? else {
            return Ok(Vec::new());
        };
        let grants: Grants =
            serde_json::from_slice(&bytes).map_err(|_| PublicError::StateUnavailable)?;
        if grants.version != 1
            || grants.clients.len() > MAX_CLIENTS
            || grants.clients.iter().any(|g| {
                g.id.len() != 32
                    || !g
                        .id
                        .bytes()
                        .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
                    || !(g.query || g.submit)
            })
        {
            return Err(PublicError::StateUnavailable);
        }
        Ok(grants.clients)
    }
    fn save_grants(&self, clients: Vec<ClientGrant>) -> Result<(), PublicError> {
        self.write_state(
            StateFile::Grants,
            &serde_json::to_vec(&Grants {
                version: 1,
                clients,
            })
            .map_err(|_| PublicError::StateUnavailable)?,
        )
    }
    /// Terminal boundary deliberately displays the returned secret exactly once.
    pub fn provision_client(
        &self,
        reader: &crate::CanonicalWorkspace,
        query: bool,
        submit: bool,
    ) -> Result<(String, String), PublicError> {
        self.assert_workspace(reader)?;
        use std::io::IsTerminal;
        if !std::io::stdin().is_terminal() || !std::io::stdout().is_terminal() || !(query || submit)
        {
            return Err(PublicError::TtyRequired);
        }
        let _lock = self.lock()?;
        let mut clients = self.grants_locked()?;
        if clients.len() >= MAX_CLIENTS {
            return Err(PublicError::CapacityExceeded);
        }
        let mut entropy = [0; 32];
        getrandom::getrandom(&mut entropy).map_err(|_| PublicError::StateUnavailable)?;
        let token = synapse_core::hex_encode(&entropy);
        getrandom::getrandom(&mut entropy).map_err(|_| PublicError::StateUnavailable)?;
        let id = synapse_core::hex_encode(&entropy[..16]);
        clients.push(ClientGrant {
            id: id.clone(),
            query,
            submit,
            policy: synapse_core::policy_fingerprint(reader.access_policy()),
            digest: ContentHash::of(token.as_bytes()),
        });
        self.save_grants(clients)?;
        Ok((id, token))
    }
    pub fn clients(&self) -> Result<Vec<ClientGrant>, PublicError> {
        let _lock = self.lock()?;
        self.grants_locked()
    }
    pub fn revoke_client(&self, id: &str) -> Result<(), PublicError> {
        let _lock = self.lock()?;
        let mut clients = self.grants_locked()?;
        clients.retain(|grant| grant.id != id);
        self.save_grants(clients)
    }
    pub(crate) fn authenticate(&self, token: &str) -> Result<ClientGrant, PublicError> {
        let _lock = self.lock()?;
        let digest = ContentHash::of(token.as_bytes());
        self.grants_locked()?
            .into_iter()
            .find(|grant| equal(grant.digest.as_str().as_bytes(), digest.as_str().as_bytes()))
            .ok_or(PublicError::AccessRefused)
    }
    pub(crate) fn grant_current_locked(&self, grant: &ClientGrant) -> Result<bool, PublicError> {
        Ok(self.grants_locked()?.iter().any(|current| {
            current.id == grant.id
                && current.query == grant.query
                && current.submit == grant.submit
                && equal(
                    current.digest.as_str().as_bytes(),
                    grant.digest.as_str().as_bytes(),
                )
        }))
    }
    pub(crate) fn grant_current(&self, grant: &ClientGrant) -> bool {
        let Ok(_lock) = self.lock() else {
            return false;
        };
        self.grant_current_locked(grant).unwrap_or(false)
    }
    pub(crate) fn revoke_all_locked(&self) -> Result<(), PublicError> {
        self.save_grants(Vec::new())
    }
}
