use crate::{CanonicalWorkspace, ClientGrant, DiskStateStore, state_store::StateFile};
use serde::{Deserialize, Serialize};
use synapse_core::{Clock, ContentHash, ControlFile, ProposalReadPort, PublicError};
const MAX_RECEIPTS: usize = 1000;
const MAX_RECEIPT_BYTES: u64 = 1_000_000;
const TTL: u64 = 30 * 24 * 60 * 60;
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(crate) struct Submission {
    pub idempotency_key: String,
    pub text: String,
    #[serde(default)]
    pub sources: Vec<Provenance>,
}
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(crate) struct Provenance {
    url: String,
    #[serde(default)]
    accessed_on: Option<String>,
}
impl Submission {
    fn validate(&self) -> Result<(), PublicError> {
        if !(16..=128).contains(&self.idempotency_key.len())
            || !self
                .idempotency_key
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'-'))
            || self.text.trim().is_empty()
            || self.text.chars().count() > 32_000
            || self.sources.len() > 10
        {
            return Err(PublicError::Usage);
        }
        for source in &self.sources {
            let uri: http::Uri = source.url.parse().map_err(|_| PublicError::Usage)?;
            if source.url.len() > 2048
                || source.url.contains(['@', '#'])
                || uri.scheme_str() != Some("https")
                || uri.host().is_none_or(str::is_empty)
            {
                return Err(PublicError::Usage);
            }
            if let Some(date) = &source.accessed_on {
                synapse_core::DailyDate::parse(date)?;
            }
        }
        Ok(())
    }
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Receipt {
    client: String,
    key: ContentHash,
    payload: ContentHash,
    id: String,
    created: u64,
    before: ContentHash,
    after: ContentHash,
    outcome: u8,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Receipts {
    version: u32,
    records: Vec<Receipt>,
}
impl DiskStateStore {
    pub(crate) fn submit(
        &self,
        reader: &CanonicalWorkspace,
        grant: &ClientGrant,
        input: Submission,
    ) -> Result<String, PublicError> {
        self.assert_workspace(reader)?;
        input.validate()?;
        let _lock = self.lock()?;
        if !grant.submit || !self.grant_current_locked(grant)? {
            return Err(PublicError::AccessRefused);
        }
        let now = reader.unix_seconds()?;
        let mut ledger = match self.read_state(StateFile::Receipts, MAX_RECEIPT_BYTES)? {
            Some(bytes) => serde_json::from_slice::<Receipts>(&bytes)
                .map_err(|_| PublicError::StateUnavailable)?,
            None => Receipts {
                version: 1,
                records: Vec::new(),
            },
        };
        if ledger.version != 1 || ledger.records.len() > MAX_RECEIPTS {
            return Err(PublicError::StateUnavailable);
        }
        let inbox = reader.snapshot_control(ControlFile::Research)?;
        let before = inbox.before.as_deref().unwrap_or("");
        let current = ContentHash::of(before.as_bytes());
        for record in &mut ledger.records {
            if record.outcome == 0 {
                record.outcome = if current == record.after {
                    1
                } else if current == record.before {
                    2
                } else {
                    0
                };
            }
        }
        ledger
            .records
            .retain(|r| r.outcome == 0 || now.saturating_sub(r.created) <= TTL);
        self.write_state(
            StateFile::Receipts,
            &serde_json::to_vec(&ledger).map_err(|_| PublicError::StateUnavailable)?,
        )?;
        let key = ContentHash::of(input.idempotency_key.as_bytes());
        let payload = ContentHash::of(&serde_json::to_vec(&input).map_err(|_| PublicError::Usage)?);
        if let Some(record) = ledger
            .records
            .iter()
            .find(|r| r.client == grant.id && r.key == key)
        {
            return if record.payload != payload {
                Err(PublicError::Conflict)
            } else if record.outcome == 1 {
                Ok(record.id.clone())
            } else {
                Err(PublicError::RecoveryRequired)
            };
        }
        if ledger.records.iter().any(|r| r.outcome == 0) {
            return Err(PublicError::RecoveryRequired);
        }
        if ledger.records.len() >= MAX_RECEIPTS {
            return Err(PublicError::CapacityExceeded);
        }
        let mut entropy = [0; 16];
        getrandom::getrandom(&mut entropy).map_err(|_| PublicError::StateUnavailable)?;
        let id = synapse_core::hex_encode(&entropy);
        let mut addition = format!(
            "\n<!-- synapse-receipt:{id} -->\n## Unverified research\nClient: {} | Received UTC seconds: {now}\n\n",
            grant.id
        );
        // Every client line is quoted and HTML/marker syntax escaped. Provenance
        // is inert text; URLs are never fetched.
        for line in input.text.lines() {
            addition.push_str("> ");
            addition.push_str(&quote(line));
            addition.push('\n');
        }
        for source in input.sources {
            addition.push_str(&format!(
                "> Source: {} {}\n",
                quote(&source.url),
                source.accessed_on.as_deref().unwrap_or("")
            ));
        }
        addition.push_str(&format!("<!-- /synapse-receipt:{id} -->\n"));
        let after = ContentHash::of(format!("{before}{addition}").as_bytes());
        ledger.records.push(Receipt {
            client: grant.id.clone(),
            key,
            payload,
            id: id.clone(),
            created: now,
            before: current,
            after,
            outcome: 0,
        });
        self.write_state(
            StateFile::Receipts,
            &serde_json::to_vec(&ledger).map_err(|_| PublicError::StateUnavailable)?,
        )?;
        let result = reader.append_scoped_inbox(&inbox, &addition);
        let fresh = reader.snapshot_control(ControlFile::Research)?;
        let hash = ContentHash::of(fresh.before.as_deref().unwrap_or("").as_bytes());
        let last = ledger
            .records
            .last_mut()
            .ok_or(PublicError::StateUnavailable)?;
        last.outcome = if hash == last.after {
            1
        } else if hash == last.before {
            2
        } else {
            0
        };
        self.write_state(
            StateFile::Receipts,
            &serde_json::to_vec(&ledger).map_err(|_| PublicError::StateUnavailable)?,
        )?;
        result?;
        Ok(id)
    }
}
fn quote(value: &str) -> String {
    value
        .chars()
        .flat_map(|c| match c {
            '<' => "&lt;".chars().collect::<Vec<_>>(),
            '>' => "&gt;".chars().collect(),
            '&' => "&amp;".chars().collect(),
            c if c.is_control() => format!("\\u{{{:x}}}", u32::from(c)).chars().collect(),
            c => vec![c],
        })
        .collect()
}

#[cfg(test)]
#[path = "../tests/support/mcp_unit.rs"]
mod tests;
