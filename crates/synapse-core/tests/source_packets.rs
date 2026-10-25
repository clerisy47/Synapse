mod support;
use sha2::{Digest, Sha256};
use support::Workspace;
use synapse_core::{
    AccessPolicy, BlockKind, Corpus, MAX_CANDIDATE_PACKETS, source_blocks, verify_evidence,
};

#[test]
fn offsets_hashes_and_ancestry_preserve_unicode_crlf_and_structures() {
    let source = "---\r\ndescription: fixture\r\n---\r\n# Root λ\r\n\r\n## Child\r\n\r\nText [[Other|label]] café.\r\n\r\n- outer\r\n  - inner\r\n\r\n| Field | Value |\r\n| --- | --- |\r\n| x | 0 |\r\n\r\n```rust\r\n# not a heading\r\n```\r\n";
    let blocks = source_blocks(source, 3);
    assert_eq!(blocks.len(), 6);
    assert_eq!(
        blocks.iter().map(|b| b.kind).collect::<Vec<_>>(),
        [
            BlockKind::Heading,
            BlockKind::Heading,
            BlockKind::Paragraph,
            BlockKind::List,
            BlockKind::Table,
            BlockKind::Code
        ]
    );
    for block in &blocks {
        let raw = &source[block.bytes.clone()];
        assert_eq!(block.hash, <[u8; 32]>::from(Sha256::digest(raw.as_bytes())));
        assert!(!raw.ends_with(['\r', '\n']));
        assert_eq!(
            source[..block.bytes.start]
                .bytes()
                .filter(|b| *b == b'\n')
                .count()
                + 1,
            block.start_line
        );
        assert_eq!(
            source[..block.bytes.end]
                .bytes()
                .filter(|b| *b == b'\n')
                .count()
                + 1,
            block.end_line
        );
    }
    assert_eq!(blocks[1].headings, [0]);
    for block in &blocks[2..] {
        assert_eq!(block.headings, [0, 1]);
    }
    assert!(source[blocks[3].bytes.clone()].contains("inner"));
    assert!(source[blocks[5].bytes.clone()].contains("# not a heading"));
}

#[test]
fn complementary_ranges_survive_crowding_without_merging_gaps() {
    let fixtures = [
        (
            "Does Willow quarantine at exactly 7 percent?",
            "# Willow quality\nWillow quarantines above 7 percent.\n\n## Audit\nThe operator records the decision.\n\n## Boundary\nExactly 7 percent remains eligible with warning.",
            vec!["Exactly 7 percent"],
        ),
        (
            "What was the Harbor incident duration and mitigation?",
            "# Harbor incident\nHarbor duration was 24 minutes.\n\n## Uncertainty\nThe long-term effect is uncertain.\n\n## Intervention\nConcurrency was reduced from 20 to 4.",
            vec!["24 minutes", "20 to 4"],
        ),
        (
            "What changed between Orchard trials and what are the limits?",
            "# Orchard trials\nOrchard trial A used 20 degrees for six hours.\n\n## Trial B\nTrial B used 24 degrees for four hours.\n\n## Interpretation\nChanging temperature and time together cannot isolate either effect.",
            vec!["20 degrees", "24 degrees", "cannot isolate either effect"],
        ),
    ];
    for (question, body, facts) in fixtures {
        let noise: Vec<_> = (0..12)
            .map(|i| {
                (
                    format!("noise-{i}.md"),
                    format!(
                        "# Related\n{} Staffing review number {i}.",
                        question.trim_end_matches('?')
                    ),
                )
            })
            .collect();
        let mut notes = vec![("renamed.md", body)];
        notes.extend(
            noise
                .iter()
                .map(|(path, body)| (path.as_str(), body.as_str())),
        );
        let reader = Workspace::new(&notes);
        let policy = AccessPolicy::default();
        let corpus = Corpus::build(&reader, policy.clone()).unwrap_or_else(|e| panic!("{e:?}"));
        let packets = corpus
            .query_packets(question, &reader, &policy)
            .unwrap_or_else(|e| panic!("{e:?}"));
        assert!(packets.len() <= MAX_CANDIDATE_PACKETS);
        assert!(packets.iter().all(|p| p.companions.len() <= 2));
        let ranges = corpus
            .resolve_packets(&packets, &reader, &policy)
            .unwrap_or_else(|e| panic!("{e:?}"));
        for fact in facts {
            assert!(ranges.iter().any(|r| r.text.contains(fact)), "{fact}");
        }
        assert!(ranges.iter().all(|r| verify_evidence(&reader, &policy, r)));
        for (i, range) in ranges.iter().enumerate() {
            assert_eq!(range.id, i + 1);
        }
        for (i, left) in ranges.iter().enumerate() {
            assert!(!ranges[i + 1..].iter().any(|right| left.path == right.path
                && left.start_line == right.start_line
                && left.end_line == right.end_line));
        }
    }
}

#[test]
fn forged_stale_and_revoked_packets_fail_closed() {
    let mut reader = Workspace::new(&[("note.md", "# Battery\nBattery lifetime is 0 hours.")]);
    let policy = AccessPolicy::default();
    let corpus = Corpus::build(&reader, policy.clone()).unwrap_or_else(|e| panic!("{e:?}"));
    let packets = corpus
        .query_packets("battery lifetime", &reader, &policy)
        .unwrap_or_else(|e| panic!("{e:?}"));
    assert!(!packets.is_empty());
    let mut forged = packets.clone();
    forged[0].primary.start_line += 1;
    assert!(corpus.resolve_packets(&forged, &reader, &policy).is_err());
    let denied = AccessPolicy {
        tags: vec!["fixture".into()],
        ..policy.clone()
    };
    assert!(corpus.resolve_packets(&packets, &reader, &denied).is_err());
    assert!(
        corpus
            .query_packets("battery", &reader, &denied)
            .unwrap_or_else(|e| panic!("{e:?}"))
            .is_empty()
    );
    reader.notes[0].1 = reader.notes[0].1.replace("0 hours", "9 hours");
    assert!(corpus.resolve_packets(&packets, &reader, &policy).is_err());
    assert!(
        corpus
            .query_packets("battery", &reader, &policy)
            .unwrap_or_else(|e| panic!("{e:?}"))
            .is_empty()
    );
}

#[test]
fn identical_source_ranges_deduplicate_across_note_names() {
    let reader = Workspace::new(&[
        ("a.md", "# Battery\nBattery lifetime is 0 hours."),
        ("b.md", "# Battery\nBattery lifetime is 0 hours."),
    ]);
    let policy = AccessPolicy::default();
    let corpus = Corpus::build(&reader, policy.clone()).unwrap_or_else(|e| panic!("{e:?}"));
    let packets = corpus
        .query_packets("battery lifetime", &reader, &policy)
        .unwrap_or_else(|e| panic!("{e:?}"));
    assert_eq!(packets.len(), 1);
    let resolved = corpus
        .resolve_packets(&packets, &reader, &policy)
        .unwrap_or_else(|e| panic!("{e:?}"));
    assert_eq!(resolved.len(), 2);
}

#[test]
fn oversized_and_malformed_markdown_do_not_create_truncated_sources() {
    let text = format!("# Device\n\n```\n{}", "device ".repeat(400));
    let blocks = source_blocks(&text, 0);
    assert_eq!(blocks.len(), 2);
    assert_eq!(blocks[1].kind, BlockKind::Code);
    assert_eq!(&text[blocks[1].bytes.clone()], &text[10..]);
    let reader = Workspace::new(&[("note.md", &text)]);
    let policy = AccessPolicy::default();
    let corpus = Corpus::build(&reader, policy.clone()).unwrap_or_else(|e| panic!("{e:?}"));
    assert!(
        corpus
            .query_packets("device", &reader, &policy)
            .unwrap_or_else(|e| panic!("{e:?}"))
            .is_empty()
    );
}

#[test]
fn followup_in_represented_note_finds_differently_worded_support() {
    let mut reader = Workspace::new(&[
        (
            "incident.md",
            "# Harbor incident\nHarbor lasted 24 minutes.\n\n## Mitigation\nConcurrency was reduced from 20 to 4.",
        ),
        ("other.md", "# Concurrency\nConcurrency was set to 90."),
    ]);
    let policy = AccessPolicy::default();
    let corpus = Corpus::build(&reader, policy.clone()).unwrap_or_else(|e| panic!("{e:?}"));
    let first = corpus
        .query_packets("Harbor duration", &reader, &policy)
        .unwrap_or_else(|e| panic!("{e:?}"));
    let resolved = corpus
        .resolve_packets(&first, &reader, &policy)
        .unwrap_or_else(|e| panic!("{e:?}"));
    let represented = resolved
        .iter()
        .find(|e| e.text.contains("24 minutes"))
        .unwrap_or_else(|| panic!("primary"));
    let followup = corpus
        .followup_packets(represented, "concurrency", &reader, &policy)
        .unwrap_or_else(|e| panic!("{e:?}"));
    assert!(followup.iter().all(|p| p.path == represented.path));
    let ranges = corpus
        .resolve_packets(&followup, &reader, &policy)
        .unwrap_or_else(|e| panic!("{e:?}"));
    assert!(ranges.iter().any(|r| r.text.contains("20 to 4")));
    reader.notes[0].1 = reader.notes[0].1.replace("20 to 4", "20 to 8");
    assert!(
        corpus
            .followup_packets(represented, "concurrency", &reader, &policy)
            .is_err()
    );
}

#[test]
fn duplicate_notes_do_not_consume_the_candidate_budget_before_deduplication() {
    let duplicates: Vec<_> = (0..80)
        .map(|i| {
            (
                format!("duplicate-{i}.md"),
                "# Battery\nBattery lifetime is 0 hours.".to_string(),
            )
        })
        .collect();
    let mut notes = duplicates
        .iter()
        .map(|(path, body)| (path.as_str(), body.as_str()))
        .collect::<Vec<_>>();
    notes.push(("distinct.md", "# Battery\nBattery lifetime is 9 hours."));
    let reader = Workspace::new(&notes);
    let policy = AccessPolicy::default();
    let corpus = Corpus::build(&reader, policy.clone()).unwrap_or_else(|e| panic!("{e:?}"));
    let packets = corpus
        .query_packets("battery lifetime", &reader, &policy)
        .unwrap_or_else(|e| panic!("{e:?}"));
    assert_eq!(packets.len(), 2);
    let ranges = corpus
        .resolve_packets(&packets, &reader, &policy)
        .unwrap_or_else(|e| panic!("{e:?}"));
    assert!(ranges.iter().any(|e| e.text.contains("9 hours")));
}

#[test]
fn aggregate_block_cache_refuses_before_reading_the_entire_inventory() {
    use synapse_core::{
        Clock, NotePath, NoteReadPort, PublicError, WorkspaceIdentity, WorkspaceReadPort,
    };
    struct DenseBlocks {
        identity: WorkspaceIdentity,
        body: String,
        reads: std::sync::atomic::AtomicUsize,
    }
    impl Clock for DenseBlocks {
        fn monotonic_millis(&self) -> u64 {
            0
        }
        fn unix_seconds(&self) -> Result<u64, PublicError> {
            Ok(0)
        }
    }
    impl WorkspaceReadPort for DenseBlocks {
        fn identity(&self) -> &WorkspaceIdentity {
            &self.identity
        }
    }
    impl NoteReadPort for DenseBlocks {
        fn list_notes(&self) -> Result<Vec<NotePath>, PublicError> {
            (0..2000)
                .map(|i| NotePath::parse(&format!("note-{i}.md")))
                .collect()
        }
        fn read_note(&self, _: &NotePath) -> Result<String, PublicError> {
            self.reads
                .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
            Ok(self.body.clone())
        }
        fn modified_note(&self, _: &NotePath) -> Result<u64, PublicError> {
            Ok(0)
        }
    }
    let reader = DenseBlocks {
        identity: WorkspaceIdentity::from_canonical_display("dense synthetic fixture".into()),
        body: format!(
            "---\ndescription: Dense synthetic blocks\ntags: [fixture]\naliases: []\n---\n# Blocks\n\n{}",
            (0..512)
                .map(|i| format!("Recorded calibration block {i}.\n\n"))
                .collect::<Vec<_>>()
                .join("")
        ),
        reads: std::sync::atomic::AtomicUsize::new(0),
    };
    assert!(matches!(
        Corpus::build(&reader, AccessPolicy::default()),
        Err(PublicError::ResourceLimit)
    ));
    assert!(
        reader.reads.load(std::sync::atomic::Ordering::Relaxed) < 2000,
        "metadata must be bounded during ingestion, before allocating the whole corpus"
    );
}
