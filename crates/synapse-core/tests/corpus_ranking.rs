mod support;

use std::fmt::Write;
use support::Workspace;
use synapse_core::{AccessPolicy, Corpus, Evidence, NoteReadPort, verify_evidence};

fn query(reader: &Workspace, question: &str) -> Vec<Evidence> {
    let policy = AccessPolicy::default();
    let corpus = Corpus::build(reader, policy.clone()).unwrap_or_else(|e| panic!("fixture: {e:?}"));
    let evidence = corpus.query(question, reader, &policy);
    for source in &evidence {
        assert!(verify_evidence(reader, &policy, source));
        let bytes = reader
            .read_note(&source.path)
            .unwrap_or_else(|e| panic!("fixture: {e:?}"));
        assert_eq!(
            source.text,
            bytes
                .lines()
                .skip(source.start_line - 1)
                .take(source.end_line - source.start_line + 1)
                .collect::<Vec<_>>()
                .join("\n")
        );
        assert!(source.text.chars().count() <= 1200);
    }
    evidence
}

#[test]
fn first_person_inflected_heading_keeps_complete_equipment_block() {
    let reader = Workspace::new(&[
        (
            "kit.md",
            "# Hiking inventory\n\nSupplies for an outing follow.\n\n- Beacon\n- Permit\n- Thermos\n- Notebook\n- Cord\n- Signal flag\n\n## Storage\nKeep equipment dry.",
        ),
        (
            "distractor.md",
            "# Classification\nCalibration minimizes instability in classification.",
        ),
    ]);
    let evidence = query(&reader, "What should I pack for a hike?");
    let first = evidence
        .first()
        .unwrap_or_else(|| panic!("equipment evidence"));
    assert_eq!(first.path.as_str(), "kit.md");
    assert!(first.text.contains("- Beacon"));
    assert!(first.text.contains("- Signal flag"));
    assert!(!evidence.iter().any(|e| e.path.as_str() == "distractor.md"));
}

#[test]
fn mixed_question_table_does_not_outrank_declarative_comparison() {
    let reader = Workspace::new(&[
        (
            "questions.md",
            "# Exercises\nThese practice prompts exercise evaluation.\n\n| Prompt | Notes |\n| --- | --- |\n| Compare amber scoring and violet forests. | [[Amber scoring]], [[Violet forests]] |",
        ),
        (
            "amber.md",
            "# Amber scoring\nAmber scoring sets a threshold of 0.4.\n\nCompare [[Violet forests]].",
        ),
        (
            "violet.md",
            "# Violet forests\nA violet forest averages randomized predictors.\n\nViolet forests capture nonlinear interactions.\n\n## Limits\nLarge forests consume memory.\n\nCompare [[Amber scoring]] and [[Violet forests]].",
        ),
    ]);
    let evidence = query(&reader, "Compare amber scoring and violet forests.");
    assert_ne!(evidence[0].path.as_str(), "questions.md");
    if let Some(decoy) = evidence
        .iter()
        .position(|e| e.path.as_str() == "questions.md")
    {
        for path in ["amber.md", "violet.md"] {
            assert!(
                evidence
                    .iter()
                    .position(|e| e.path.as_str() == path)
                    .is_some_and(|position| position < decoy),
                "declarative comparison evidence must outrank the prompt table"
            );
        }
    }
    assert!(
        evidence
            .iter()
            .any(|e| e.path.as_str() == "amber.md" && e.text.contains("threshold"))
    );
    let violet = evidence
        .iter()
        .find(|e| e.path.as_str() == "violet.md")
        .unwrap_or_else(|| panic!("violet evidence"));
    assert!(
        violet.text.contains("nonlinear"),
        "navigation displaced declarative evidence: {}",
        violet.text
    );
}

#[test]
fn atomic_lists_and_tables_stay_inside_structural_and_character_caps() {
    for prefix in ["- ", "| "] {
        let mut body = String::from("# Inventory\n");
        for i in 0..25 {
            writeln!(body, "{prefix}Inventory item {i}")
                .unwrap_or_else(|e| panic!("fixture: {e:?}"));
        }
        let reader = Workspace::new(&[("long.md", &body)]);
        assert!(
            query(&reader, "inventory").is_empty(),
            "over-limit structural block was split"
        );
        let mut body = String::from("# Inventory\n");
        for i in 0..6 {
            writeln!(body, "{prefix}Inventory item {i} {}", "x".repeat(220))
                .unwrap_or_else(|e| panic!("fixture: {e:?}"));
        }
        let reader = Workspace::new(&[("wide.md", &body)]);
        assert!(
            query(&reader, "inventory").is_empty(),
            "over-limit character block was split"
        );
    }
}

#[test]
fn short_terms_do_not_match_inside_unrelated_words() {
    let reader = Workspace::new(&[(
        "decoy.md",
        "# Assumptions\nA separate category remains stable.",
    )]);
    assert!(query(&reader, "cat").is_empty());
}

#[test]
fn linked_prose_unicode_and_numeric_tables_preserve_exact_coordinates() {
    let reader = Workspace::new(&[(
        "cycling.md",
        "# Cycling measurements\nCycling recorded 0.42 after [[Calibration]]; café readings stayed stable.\n- Verify sensor\n\n| Sensor | Value |\n| --- | --- |\n| Café | 0.42 |\n| Δelta | 7 |",
    )]);
    let before = reader.notes[0].1.clone();
    let evidence = query(
        &reader,
        "Latest question: What cycling measurements were recorded?",
    );
    assert!(
        evidence
            .iter()
            .any(|e| e.text.contains("café") && e.text.contains("[[Calibration]]"))
    );
    assert!(
        evidence
            .iter()
            .any(|e| e.text.contains("| Café | 0.42 |") && e.text.contains("| Δelta | 7 |"))
    );
    assert_eq!(reader.notes[0].1, before);
}

#[test]
fn keyword_navigation_remains_discoverable_without_becoming_factual_support() {
    let reader = Workspace::new(&[("directions.md", "Search terms: compass, bearings.")]);
    let policy = AccessPolicy::default();
    let corpus =
        Corpus::build(&reader, policy.clone()).unwrap_or_else(|e| panic!("fixture: {e:?}"));
    assert!(corpus.query("compass", &reader, &policy).is_empty());
    let search = corpus.search("compass", &reader, &policy);
    assert_eq!(search.len(), 1);
    assert!(verify_evidence(&reader, &policy, &search[0]));

    let reader = Workspace::new(&[(
        "directions.md",
        "Mark the agreed route before leaving.\n\nSearch terms: compass, bearings.",
    )]);
    let evidence = query(&reader, "compass");
    assert!(
        evidence
            .iter()
            .any(|source| source.text.contains("Mark the agreed route")),
        "navigation terms should discover nearby substantive evidence"
    );
}

#[test]
fn action_questions_keep_same_note_remedies_before_unrelated_diversification() {
    let mut notes = vec![("chamber.md".to_owned(), "# Chamber pressure\nChamber pressure rises when inlet regulation drifts.\n\n## Mitigations\n- Close bleed port.\n- Reset regulator.\n- Inspect seal.\n- Cycle valve.".to_owned())];
    for index in 0..12 {
        notes.push((
            format!("gauge-{index}.md"),
            "# Gauge\nChamber pressure describes a gauge reading.".to_owned(),
        ));
    }
    let borrowed: Vec<_> = notes
        .iter()
        .map(|(path, body)| (path.as_str(), body.as_str()))
        .collect();
    let reader = Workspace::new(&borrowed);
    let evidence = query(&reader, "What can I try when chamber pressure rises?");
    assert!(
        evidence[..evidence.len().min(4)]
            .iter()
            .any(|e| e.path.as_str() == "chamber.md" && e.text.contains("Cycle valve")),
        "remedies were crowded out before the first bounded model batch"
    );
}
