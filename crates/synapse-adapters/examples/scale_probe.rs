//! Synthetic qualification only; no application diagnostic or trace API.
use std::{error::Error, sync::Arc, time::Instant};
use synapse_adapters::{CanonicalWorkspace, SqliteSearchIndex};
use synapse_core::{AccessPolicy, Corpus, SearchIndexPort};
fn main() -> Result<(), Box<dyn Error>> {
    let root = std::env::args()
        .nth(1)
        .ok_or("explicit fixture root required")?;
    let reader =
        CanonicalWorkspace::open(std::path::Path::new(&root)).map_err(|e| e.code().to_string())?;
    let policy = AccessPolicy::default();
    let start = Instant::now();
    let index = Arc::new(SqliteSearchIndex::open(&reader).map_err(|e| e.code())?);
    let mut corpus = match Corpus::build_with_index(&reader, policy.clone(), Some(index.clone())) {
        Ok(corpus) => corpus,
        Err(e) => {
            println!(
                "{}",
                serde_json::json!({"status":"refused","code":e.code(),"seconds":start.elapsed().as_secs_f64()})
            );
            return Ok(());
        }
    };
    let cold = start.elapsed().as_secs_f64();
    let parsed = corpus.reconciliation_counts().0;
    let mut warm = Vec::new();
    let mut ranking = Vec::new();
    for _ in 0..5 {
        let start = Instant::now();
        corpus
            .refresh(&reader, policy.clone())
            .map_err(|e| e.code())?;
        assert_eq!(
            corpus.reconciliation_counts().0,
            0,
            "unchanged notes were reparsed"
        );
        let packets = corpus
            .query_packets("project duration limitation", &reader, &policy)
            .map_err(|e| e.code())?;
        let _ = corpus
            .resolve_packets(&packets, &reader, &policy)
            .map_err(|e| e.code())?;
        warm.push(start.elapsed().as_secs_f64());
    }
    for _ in 0..20 {
        let start = Instant::now();
        let _ = index
            .candidates(
                synapse_core::policy_fingerprint(&policy).as_str(),
                &["project".into(), "duration".into(), "limitation".into()],
            )
            .map_err(|e| e.code())?;
        ranking.push(start.elapsed().as_secs_f64());
    }
    warm.sort_by(f64::total_cmp);
    ranking.sort_by(f64::total_cmp);
    println!(
        "{}",
        serde_json::json!({"status":"indexed","notes":corpus.note_count(),"parsed_notes":parsed,"cold_seconds":cold,"warm_p95_seconds":warm[4],"ranking_p95_seconds":ranking[18],"warm_samples":warm,"ranking_samples":ranking})
    );
    Ok(())
}
