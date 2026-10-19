use super::*;
use std::{error::Error, fs};
#[test]
fn submission_rejects_untrusted_routing_dates_and_urls() {
    for value in [
        serde_json::json!({"idempotencyKey":"abcdefghijklmnop","text":"fact","path":"outside.md"}),
        serde_json::json!({"idempotencyKey":"short","text":"fact"}),
        serde_json::json!({"idempotencyKey":"abcdefghijklmnop","text":"fact","sources":[{"url":"http://example.com"}]}),
        serde_json::json!({"idempotencyKey":"abcdefghijklmnop","text":"fact","sources":[{"url":"https://user:secret@example.com/"}]}),
        serde_json::json!({"idempotencyKey":"abcdefghijklmnop","text":"fact","sources":[{"url":"https://example.com/#fragment"}]}),
        serde_json::json!({"idempotencyKey":"abcdefghijklmnop","text":"fact","sources":[{"url":"https://example.com/","accessedOn":"2026-02-30"}]}),
    ] {
        assert!(
            serde_json::from_value::<Submission>(value)
                .and_then(|s| s
                    .validate()
                    .map_err(|_| serde::de::Error::custom("invalid")))
                .is_err()
        );
    }
    assert!(crate::strict_json::parse(br#"{"text":"one","text":"two"}"#).is_err());
    assert!(crate::strict_json::parse(br#"{"safe":1} trailing"#).is_err());
}
#[test]
fn receipt_child() -> Result<(), Box<dyn Error>> {
    let Some(root) = std::env::var_os("SYNAPSE_RECEIPT_FIXTURE") else {
        return Ok(());
    };
    let root = std::path::PathBuf::from(root);
    let reader = CanonicalWorkspace::open(&root).map_err(|_| "root")?;
    let store = DiskStateStore::open(&reader).map_err(|_| "store")?;
    let token = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    let grant_value = serde_json::json!({"id":"0123456789abcdef0123456789abcdef","query":false,"submit":true,"digest":ContentHash::of(token.as_bytes()),"policy":synapse_core::policy_fingerprint(reader.access_policy())});
    let grant: ClientGrant = serde_json::from_value(grant_value.clone())?;
    store
        .write_state(
            StateFile::Grants,
            &serde_json::to_vec(&serde_json::json!({"version":1,"clients":[grant_value]}))?,
        )
        .map_err(|_| "grant")?;
    for phase in ["before", "after"] {
        let input = || Submission {
            idempotency_key: format!("crash-receipt-key-{phase}"),
            text: "Synthetic unverified source".into(),
            sources: vec![],
        };
        let before = fs::read_to_string(root.join("Research.md"))?;
        let after = format!("{before}\nAlready appended in the crash fixture\n");
        let ledger = Receipts {
            version: 1,
            records: vec![Receipt {
                client: grant.id.clone(),
                key: ContentHash::of(input().idempotency_key.as_bytes()),
                payload: ContentHash::of(&serde_json::to_vec(&input())?),
                id: format!("receipt-{phase}"),
                created: reader.unix_seconds().map_err(|_| "clock")?,
                before: ContentHash::of(before.as_bytes()),
                after: ContentHash::of(after.as_bytes()),
                outcome: 0,
            }],
        };
        store
            .write_state(StateFile::Receipts, &serde_json::to_vec(&ledger)?)
            .map_err(|_| "intent")?;
        if phase == "after" {
            fs::write(root.join("Research.md"), &after)?;
        }
        let result = store.submit(&reader, &grant, input());
        if phase == "after" {
            assert_eq!(result.map_err(|_| "retry")?, "receipt-after");
            assert_eq!(fs::read_to_string(root.join("Research.md"))?, after);
        } else {
            assert!(matches!(result, Err(PublicError::RecoveryRequired)));
            assert_eq!(fs::read_to_string(root.join("Research.md"))?, before);
        }
    }
    let before_capacity = fs::read(root.join("Research.md"))?;
    let now = reader.unix_seconds().map_err(|_| "clock")?;
    let mut full = Receipts {
        version: 1,
        records: (0..1000)
            .map(|n| Receipt {
                client: grant.id.clone(),
                key: ContentHash::of(n.to_string().as_bytes()),
                payload: ContentHash::of(b"old"),
                id: format!("fixture-{n}"),
                created: now,
                before: ContentHash::of(b"before"),
                after: ContentHash::of(b"after"),
                outcome: 1,
            })
            .collect(),
    };
    store
        .write_state(StateFile::Receipts, &serde_json::to_vec(&full)?)
        .map_err(|_| "capacity ledger")?;
    let new_input = || Submission {
        idempotency_key: "capacity-new-key-0001".into(),
        text: "New fact".into(),
        sources: vec![],
    };
    assert!(matches!(
        store.submit(&reader, &grant, new_input()),
        Err(PublicError::CapacityExceeded)
    ));
    assert_eq!(fs::read(root.join("Research.md"))?, before_capacity);
    for record in &mut full.records {
        record.created = now.saturating_sub(TTL + 1);
    }
    store
        .write_state(StateFile::Receipts, &serde_json::to_vec(&full)?)
        .map_err(|_| "expired ledger")?;
    assert!(store.submit(&reader, &grant, new_input()).is_ok());
    store.revoke_client(&grant.id).map_err(|_| "revoke")?;
    assert!(store.authenticate(token).is_err());
    assert!(!store.grant_current(&grant));
    assert!(
        store
            .submit(
                &reader,
                &grant,
                Submission {
                    idempotency_key: "revoked-key-0001".into(),
                    text: "Refused".into(),
                    sources: vec![]
                }
            )
            .is_err()
    );
    Ok(())
}
#[test]
fn receipt_reconciliation_and_revocation() -> Result<(), Box<dyn Error>> {
    let base = std::env::temp_dir().join(format!("synapse-receipt-{}", std::process::id()));
    fs::create_dir(&base)?;
    let base = base.canonicalize()?;
    fs::create_dir(base.join("home"))?;
    fs::create_dir(base.join("workspace"))?;
    fs::write(base.join("workspace/Research.md"), "Inbox\n")?;
    let output = std::process::Command::new(std::env::current_exe()?)
        .args(["--exact", "mcp_submit::tests::receipt_child", "--nocapture"])
        .env("HOME", base.join("home"))
        .env_remove("XDG_STATE_HOME")
        .env("SYNAPSE_RECEIPT_FIXTURE", base.join("workspace"))
        .output()?;
    assert!(
        output.status.success(),
        "receipt child failed: {} {}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    fs::remove_dir_all(base)?;
    Ok(())
}
