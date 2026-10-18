use std::{ffi::OsString, path::PathBuf};
use synapse_core::PublicError;
#[derive(Debug, PartialEq)]
pub enum ProviderChoice {
    Local,
    OpenRouter { model: String, consent: bool },
}
#[derive(Debug, PartialEq)]
pub enum Invocation {
    Help,
    Version,
    Doctor {
        root: PathBuf,
        offline: bool,
        provider: ProviderChoice,
    },
    Ask {
        root: PathBuf,
        question: String,
        json: bool,
        provider: ProviderChoice,
    },
    Interactive {
        root: PathBuf,
        provider: ProviderChoice,
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
    let mode = match args.first().and_then(|arg| arg.to_str()) {
        Some("ask") => 1,
        Some("doctor") => 2,
        Some("--workspace") => 0,
        _ => return Err(PublicError::Usage),
    };
    let mut index = usize::from(mode != 0);
    let (mut root, mut question, mut model) = (None, None, None);
    let (mut json, mut offline, mut remote, mut consent) = (false, false, false, false);
    while index < args.len() {
        match args[index].to_str() {
            Some("--workspace") if root.is_none() => {
                index += 1;
                root = Some(PathBuf::from(args.get(index).ok_or(PublicError::Usage)?));
            }
            Some("--json") if mode == 1 && !json => json = true,
            Some("--offline") if mode == 2 && !offline => offline = true,
            Some("--provider") => {
                index += 1;
                remote = match args.get(index).and_then(|value| value.to_str()) {
                    Some("local") => false,
                    Some("openrouter") => true,
                    _ => return Err(PublicError::Usage),
                };
            }
            Some("--model") if model.is_none() => {
                index += 1;
                model = Some(
                    args.get(index)
                        .and_then(|arg| arg.to_str())
                        .ok_or(PublicError::Usage)?
                        .to_owned(),
                );
            }
            Some("--remote-consent") if !consent => consent = true,
            Some(value) if mode == 1 && !value.starts_with('-') && question.is_none() => {
                question = Some(value.to_owned())
            }
            _ => return Err(PublicError::Usage),
        }
        index += 1;
    }
    let root = root.ok_or(PublicError::Usage)?;
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
    match mode {
        0 => Ok(Invocation::Interactive { root, provider }),
        1 => Ok(Invocation::Ask {
            root,
            question: question
                .filter(|question| !question.trim().is_empty() && question.len() <= 1024)
                .ok_or(PublicError::Usage)?,
            json,
            provider,
        }),
        _ => Ok(Invocation::Doctor {
            root,
            offline,
            provider,
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
            assert_eq!(
                parse(args.into_iter().map(Into::into).collect()),
                Err(PublicError::Usage)
            );
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
        assert_eq!(
            parse(args.into_iter().map(Into::into).collect()),
            Err(PublicError::RemoteConsentRequired)
        );
    }
}
