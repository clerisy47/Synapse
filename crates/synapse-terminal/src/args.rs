use std::{ffi::OsString, path::PathBuf};
use synapse_core::{AccessPolicy, DailyDate, NotePath, PublicError};
#[derive(Clone)]
pub enum ProviderChoice {
    Local,
    OpenRouter { model: String, consent: bool },
}
pub struct WorkspaceArgs {
    pub root: PathBuf,
    pub provider: ProviderChoice,
    pub policy: AccessPolicy,
    pub preview: bool,
}
pub enum Invocation {
    Mcp {
        workspace: WorkspaceArgs,
        action: String,
        query: bool,
        submit: bool,
        client: Option<String>,
    },
    Recovery {
        workspace: WorkspaceArgs,
        revert: Option<String>,
    },
    Clear {
        workspace: WorkspaceArgs,
    },
    Help,
    Version,
    Doctor {
        workspace: WorkspaceArgs,
        offline: bool,
    },
    Ask {
        workspace: WorkspaceArgs,
        question: String,
        json: bool,
    },
    Search {
        workspace: WorkspaceArgs,
        terms: String,
        json: bool,
    },
    Interactive {
        workspace: WorkspaceArgs,
    },
    Setup {
        workspace: WorkspaceArgs,
    },
    Capture {
        workspace: WorkspaceArgs,
        file: NotePath,
        range: Option<(usize, usize)>,
    },
    ResearchReview {
        workspace: WorkspaceArgs,
        capture: Option<usize>,
        date: Option<DailyDate>,
    },
    MetadataReview {
        workspace: WorkspaceArgs,
        file: Option<NotePath>,
    },
}
pub fn parse(args: Vec<OsString>) -> Result<Invocation, PublicError> {
    if args.len() == 1 {
        if args[0] == "--help" || args[0] == "-h" {
            return Ok(Invocation::Help);
        }
        if args[0] == "--version" || args[0] == "-V" {
            return Ok(Invocation::Version);
        }
    }
    let first = args
        .first()
        .and_then(|arg| arg.to_str())
        .ok_or(PublicError::Usage)?;
    let (mode, mut index) = match first {
        "ask" => (1, 1),
        "doctor" => (2, 1),
        "search" => (3, 1),
        "mcp"
            if args.get(1).is_some_and(|a| {
                matches!(a.to_str(), Some("serve" | "grant" | "revoke" | "list"))
            }) =>
        {
            (10, 2)
        }
        "setup" => (4, 1),
        "recovery" => (8, 1),
        "data" if args.get(1).is_some_and(|arg| arg == "clear") => (9, 2),
        "--workspace" => (0, 0),
        "research" => match args.get(1).and_then(|arg| arg.to_str()) {
            Some("capture") => (5, 2),
            Some("review") => (6, 2),
            _ => return Err(PublicError::Usage),
        },
        "metadata" if args.get(1).is_some_and(|arg| arg == "review") => (7, 2),
        _ => return Err(PublicError::Usage),
    };
    let (mut root, mut question, mut model, mut file, mut range, mut capture, mut date) =
        (None, None, None, None, None, None, None);
    let (mut json, mut offline, mut remote, mut consent) = (false, false, false, false);
    let mut policy = AccessPolicy::default();
    let mut preview = false;
    let mut revert = None;
    let (mut query_scope, mut submit_scope, mut client) = (false, false, None);
    while index < args.len() {
        let flag = args[index].to_str().ok_or(PublicError::Usage)?;
        let value = |index: usize| {
            args.get(index)
                .and_then(|value| value.to_str())
                .ok_or(PublicError::Usage)
        };
        match flag {
            "--query" if mode == 10 && args[1] == "grant" && !query_scope => query_scope = true,
            "--submit" if mode == 10 && args[1] == "grant" && !submit_scope => submit_scope = true,
            "--client" if mode == 10 && args[1] == "revoke" && client.is_none() => {
                index += 1;
                client = Some(value(index)?.to_owned());
            }

            "--revert" if mode == 8 && revert.is_none() => {
                index += 1;
                revert = Some(value(index)?.to_owned());
            }
            "--workspace" if root.is_none() => {
                index += 1;
                root = Some(PathBuf::from(args.get(index).ok_or(PublicError::Usage)?));
            }
            "--preview" if matches!(mode, 4 | 6 | 7 | 8) && !preview => preview = true,
            "--json" if matches!(mode, 1 | 3) && !json => json = true,
            "--offline" if mode == 2 && !offline => offline = true,
            "--provider" => {
                index += 1;
                remote = match value(index)? {
                    "local" => false,
                    "openrouter" => true,
                    _ => return Err(PublicError::Usage),
                };
            }
            "--model" if model.is_none() => {
                index += 1;
                model = Some(value(index)?.to_owned());
            }
            "--remote-consent" if !consent => consent = true,
            "--instructions" => {
                index += 1;
                policy.instructions = NotePath::parse(value(index)?)?;
            }
            "--research" => {
                index += 1;
                policy.research = NotePath::parse(value(index)?)?;
            }
            "--exclude-folder" => {
                index += 1;
                policy.folders.push(value(index)?.to_owned());
            }
            "--exclude-tag" => {
                index += 1;
                policy.tags.push(value(index)?.to_owned());
            }
            "--file" if matches!(mode, 5 | 7) && file.is_none() => {
                index += 1;
                file = Some(NotePath::parse(value(index)?)?);
            }
            "--lines" if mode == 5 && range.is_none() => {
                index += 1;
                let (start, end) = value(index)?.split_once(':').ok_or(PublicError::Usage)?;
                range = Some((
                    start.parse().map_err(|_| PublicError::Usage)?,
                    end.parse().map_err(|_| PublicError::Usage)?,
                ));
            }
            "--capture" if mode == 6 && capture.is_none() => {
                index += 1;
                capture = Some(value(index)?.parse().map_err(|_| PublicError::Usage)?);
            }
            "--date" if mode == 6 && date.is_none() => {
                index += 1;
                date = Some(DailyDate::parse(value(index)?)?);
            }
            value if matches!(mode, 1 | 3) && !value.starts_with('-') && question.is_none() => {
                question = Some(value.to_owned())
            }
            _ => return Err(PublicError::Usage),
        }
        index += 1;
    }
    policy.validate()?;
    let provider = if remote {
        if !consent {
            return Err(PublicError::RemoteConsentRequired);
        }
        ProviderChoice::OpenRouter {
            model: model.ok_or(PublicError::Usage)?,
            consent,
        }
    } else {
        if model.is_some() || consent {
            return Err(PublicError::Usage);
        }
        ProviderChoice::Local
    };
    let workspace = WorkspaceArgs {
        root: root.ok_or(PublicError::Usage)?,
        provider,
        policy,
        preview,
    };
    let bounded_question = |question: Option<String>| {
        question
            .filter(|question| !question.trim().is_empty() && question.len() <= 1024)
            .ok_or(PublicError::Usage)
    };
    match mode {
        0 => Ok(Invocation::Interactive { workspace }),
        1 => Ok(Invocation::Ask {
            workspace,
            question: bounded_question(question)?,
            json,
        }),
        2 => Ok(Invocation::Doctor { workspace, offline }),
        3 => Ok(Invocation::Search {
            workspace,
            terms: bounded_question(question)?,
            json,
        }),
        4 => Ok(Invocation::Setup { workspace }),
        5 => Ok(Invocation::Capture {
            workspace,
            file: file.ok_or(PublicError::Usage)?,
            range,
        }),
        6 => Ok(Invocation::ResearchReview {
            workspace,
            capture,
            date,
        }),
        7 => Ok(Invocation::MetadataReview { workspace, file }),
        8 => Ok(Invocation::Recovery { workspace, revert }),
        9 => Ok(Invocation::Clear { workspace }),
        _ => Ok(Invocation::Mcp {
            workspace,
            action: args[1].to_str().ok_or(PublicError::Usage)?.to_owned(),
            query: query_scope,
            submit: submit_scope,
            client,
        }),
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn refuses_implicit_root_and_write_approval_flags() {
        for args in [
            vec![],
            vec!["--yes"],
            vec!["--workspace"],
            vec!["ask", "secret"],
            vec!["ask", "--workspace", ".", "q", "--yes"],
        ] {
            assert!(matches!(
                parse(args.into_iter().map(Into::into).collect()),
                Err(PublicError::Usage)
            ));
        }
    }
    #[test]
    fn remote_selection_requires_separate_consent() {
        let args = [
            "ask",
            "--workspace",
            ".",
            "q",
            "--provider",
            "openrouter",
            "--model",
            "example/model",
        ];
        assert!(matches!(
            parse(args.into_iter().map(Into::into).collect()),
            Err(PublicError::RemoteConsentRequired)
        ));
    }
}
