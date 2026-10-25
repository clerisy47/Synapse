//! Opt-in source-bearing trace for synthetic qualification fixtures only.
use std::{
    error::Error,
    sync::{Arc, Mutex},
};
use synapse_core::{Cancellation, ModelJob, ModelResult, ModelService, Priority, PublicError};
struct Trace {
    inner: Arc<dyn ModelService>,
    stages: Mutex<Vec<serde_json::Value>>,
}
fn passages(evidence: &[synapse_core::Evidence]) -> serde_json::Value {
    serde_json::json!(evidence.iter().map(|e|serde_json::json!({"id":e.id,"path":e.path.as_str(),"start_line":e.start_line,"end_line":e.end_line,"text":e.text})).collect::<Vec<_>>())
}
impl ModelService for Trace {
    fn budget(&self) -> synapse_core::ModelBudget {
        self.inner.budget()
    }
    fn execute(
        &self,
        job: ModelJob,
        priority: Priority,
        cancel: &Cancellation,
    ) -> Result<ModelResult, PublicError> {
        let (operation, evidence) = match &job {
            ModelJob::PlanQuestion { evidence, .. } => ("plan", passages(evidence)),
            ModelJob::AssessEvidence {
                purpose, evidence, ..
            } => (
                if *purpose == synapse_core::AssessmentPurpose::Compact {
                    "compact"
                } else {
                    "assess"
                },
                passages(evidence),
            ),
            ModelJob::ConfirmCoverage { evidence, .. } => ("confirm", passages(evidence)),
            _ => ("other", serde_json::json!([])),
        };
        let started = std::time::Instant::now();
        let result = self.inner.execute(job, priority, cancel);
        let mut row = serde_json::json!({"operation":operation,"input":evidence,"elapsed_ms":started.elapsed().as_millis()});
        match &result {
            Ok(ModelResult::QuestionPlan(plan)) => {
                row["prompt_tokens"] = plan.prompt_tokens.into();
                row["completion_tokens"] = plan.completion_tokens.into();
                row["refinements"] = serde_json::to_value(&plan.refinements)
                    .map_err(|_| PublicError::ResourceLimit)?;
                row["hints"] =
                    serde_json::to_value(&plan.hints).map_err(|_| PublicError::ResourceLimit)?;
            }
            Ok(ModelResult::Assessment(value)) => {
                row["prompt_tokens"] = value.prompt_tokens.into();
                row["completion_tokens"] = value.completion_tokens.into();
                row["support"] =
                    serde_json::to_value(&value.support).map_err(|_| PublicError::ResourceLimit)?;
                row["served_ids"] = serde_json::json!(value.served_ids);
            }
            Err(error) => row["error"] = error.code().into(),
            _ => (),
        }
        self.stages
            .lock()
            .map_err(|_| PublicError::ResourceLimit)?
            .push(row);
        result
    }
}
fn main() -> Result<(), Box<dyn Error>> {
    let mut args = std::env::args().skip(1);
    if args.next().as_deref() != Some("--synthetic-source-trace") {
        return Err("explicit synthetic fixture trace opt-in required".into());
    }
    let root = args.next().ok_or("explicit fixture root required")?;
    let question = args.next().ok_or("question required")?;
    let remote = match args.next().as_deref() {
        None => false,
        Some("--openrouter")
            if args.next().as_deref() == Some("--remote-consent") && args.next().is_none() =>
        {
            true
        }
        _ => return Err("explicit remote selection/consent required".into()),
    };
    let reader = Arc::new(
        synapse_adapters::CanonicalWorkspace::open(std::path::Path::new(&root))
            .map_err(|e| e.code())?,
    );
    let policy = synapse_core::AccessPolicy::default();
    let initial_retrieval = {
        let index = Arc::new(
            synapse_adapters::SqliteSearchIndex::open(reader.as_ref()).map_err(|e| e.code())?,
        );
        let corpus =
            synapse_core::Corpus::build_with_index(reader.as_ref(), policy.clone(), Some(index))
                .map_err(|e| e.code())?;
        let packets = corpus
            .query_packets(&question, reader.as_ref(), &policy)
            .map_err(|e| e.code())?;
        passages(
            &corpus
                .resolve_packets(&packets, reader.as_ref(), &policy)
                .map_err(|e| e.code())?,
        )
    };
    let trace = Trace {
        inner: if remote {
            Arc::new(
                synapse_adapters::workspace_openrouter_queue(
                    "deepseek/deepseek-v4.1-flash".into(),
                    true,
                    reader.clone(),
                    policy.clone(),
                )
                .map_err(|e| e.code())?,
            )
        } else {
            Arc::new(synapse_adapters::workspace_local_queue(
                reader.clone(),
                policy.clone(),
            ))
        },
        stages: Mutex::new(Vec::new()),
    };
    let mut chat =
        synapse_adapters::query_session(reader.as_ref(), policy.clone()).map_err(|e| e.code())?;
    let result = chat.ask(
        &question,
        reader.as_ref(),
        &policy,
        &trace,
        &Cancellation::default(),
    );
    let answer = match result {
        Ok(answer) => {
            serde_json::json!({"status":if answer.sufficient(){"answered"}else{"insufficient_evidence"},"sources":passages(&answer.sources)})
        }
        Err(error) => serde_json::json!({"status":"error","error":error.code()}),
    };
    let usage = chat.stats();
    println!(
        "{}",
        serde_json::json!({"answer":answer,"initial_retrieval":initial_retrieval,"stages":trace.stages.lock().map_err(|_|"trace")?.as_slice(),"usage":{"calls":usage.calls,"prompt_tokens":usage.prompt_tokens,"completion_tokens":usage.completion_tokens,"candidate_ranges":usage.candidate_ranges,"served_ranges":usage.served_ranges,"final_ranges":usage.final_ranges}})
    );
    Ok(())
}
