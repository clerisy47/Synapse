mod input;
mod render;
mod strings;

use input::Input;
pub use render::sanitize;
use std::io::{self, IsTerminal, Write};
use std::sync::Arc;
use synapse_application::{ChatError, SessionFactory, SessionOptions};
use synapse_core::{
    Cancellation, CorpusPolicy, Limits, MAX_QUESTION_BYTES, NotePath, Provider, PublicError,
    RemoteConsent, SignalPort, WorkspaceReadPort,
};

#[derive(Clone, Copy)]
enum Error {
    Public(PublicError),
    Chat(ChatError),
}
impl From<PublicError> for Error {
    fn from(e: PublicError) -> Self {
        Self::Public(e)
    }
}
impl From<ChatError> for Error {
    fn from(e: ChatError) -> Self {
        Self::Chat(e)
    }
}
impl Error {
    fn code(self) -> &'static str {
        match self {
            Self::Public(e) => e.code(),
            Self::Chat(e) => e.code(),
        }
    }
    fn exit_code(self) -> u8 {
        match self {
            Self::Public(e) => e.exit_code(),
            Self::Chat(e) => e.exit_code(),
        }
    }
}
const MAX_EXCLUSIONS: usize = 64;
struct Request {
    workspace: String,
    question: Option<String>,
    json: bool,
    remote: Option<String>,
    policy: CorpusPolicy,
}
enum Invocation {
    Help,
    Version,
    Session(Request),
}

pub fn run(
    reader: &dyn WorkspaceReadPort,
    factory: &dyn SessionFactory,
    signals: &dyn SignalPort,
) -> u8 {
    let raw_args: Vec<_> = std::env::args_os().skip(1).collect();
    let json =
        raw_args.first().is_some_and(|s| s == "ask") && raw_args.iter().any(|s| s == "--json");
    let args: Result<Vec<String>, _> = raw_args.into_iter().map(|a| a.into_string()).collect();
    let result = args
        .map_err(|_| Error::from(PublicError::Usage))
        .and_then(|args| parse(&args).map_err(Error::from))
        .and_then(|invocation| execute(reader, factory, signals, invocation));
    match result {
        Ok(()) => 0,
        Err(error) => {
            let _ = writeln!(io::stderr().lock(), "{}", error.code());
            if json {
                let _ = render::json_error(error.code());
            }
            error.exit_code()
        }
    }
}
fn parse(args: &[String]) -> Result<Invocation, PublicError> {
    if args.len() == 1 && matches!(args[0].as_str(), "--help" | "-h") {
        return Ok(Invocation::Help);
    }
    if args.len() == 1 && matches!(args[0].as_str(), "--version" | "-V") {
        return Ok(Invocation::Version);
    }
    let ask = args.first().is_some_and(|s| s == "ask");
    let mut i = usize::from(ask);
    let mut workspace = None;
    let mut json = false;
    let mut provider = "bonsai".to_owned();
    let mut model = None;
    let mut words = Vec::new();
    let mut controls = [
        "Synapse/Instructions.md".to_owned(),
        "Research.md".to_owned(),
    ];
    let mut folders = Vec::new();
    let mut tags = Vec::new();
    while i < args.len() {
        let arg = &args[i];
        if arg == "--json" {
            if json || !ask {
                return Err(PublicError::Usage);
            }
            json = true;
            i += 1;
            continue;
        }
        if arg.starts_with('-') {
            let value = args
                .get(i + 1)
                .filter(|s| !s.starts_with('-'))
                .ok_or(PublicError::Usage)?;
            match arg.as_str() {
                "--workspace" if workspace.is_none() => workspace = Some(value.clone()),
                "--provider" => provider = value.clone(),
                "--model" if model.is_none() => model = Some(value.clone()),
                "--instructions" => controls[0] = value.clone(),
                "--research" => controls[1] = value.clone(),
                "--exclude-folder" if folders.len() < MAX_EXCLUSIONS => folders.push(value.clone()),
                "--exclude-tag" if tags.len() < MAX_EXCLUSIONS => tags.push(value.clone()),
                _ => return Err(PublicError::Usage),
            }
            i += 2;
        } else if ask {
            words.push(arg.clone());
            i += 1;
        } else {
            return Err(PublicError::Usage);
        }
    }
    let remote = match provider.as_str() {
        "bonsai" if model.is_none() => None,
        "openrouter" => Some(model.ok_or(PublicError::Usage)?),
        _ => return Err(PublicError::Usage),
    };
    let question = if ask {
        let q = words.join(" ");
        if q.trim().is_empty() || q.len() > MAX_QUESTION_BYTES {
            return Err(PublicError::Usage);
        }
        Some(q)
    } else {
        None
    };
    let policy = CorpusPolicy::new(
        controls
            .iter()
            .map(|p| NotePath::parse(p))
            .collect::<Result<Vec<_>, _>>()?,
        folders,
        tags,
        Limits::default(),
    )
    .map_err(|_| PublicError::Usage)?;
    Ok(Invocation::Session(Request {
        workspace: workspace
            .filter(|s| !s.is_empty())
            .ok_or(PublicError::Usage)?,
        question,
        json,
        remote,
        policy,
    }))
}
fn execute(
    reader: &dyn WorkspaceReadPort,
    factory: &dyn SessionFactory,
    signals: &dyn SignalPort,
    invocation: Invocation,
) -> Result<(), Error> {
    let request = match invocation {
        Invocation::Help => return render::trusted(strings::HELP).map_err(Error::from),
        Invocation::Version => return render::trusted(strings::VERSION).map_err(Error::from),
        Invocation::Session(request) => request,
    };
    let interactive = request.question.is_none();
    if interactive && !(io::stdin().is_terminal() && io::stdout().is_terminal()) {
        return Err(PublicError::InteractiveRequired.into());
    }
    if request.remote.is_some() && !(io::stdin().is_terminal() && io::stderr().is_terminal()) {
        return Err(ChatError::Model(synapse_core::ModelError::Consent).into());
    }
    let workspace = synapse_application::open_workspace(reader, &request.workspace)?;
    let cancel = Arc::new(Cancellation::default());
    signals.install(cancel.clone())?;
    let input = if interactive || request.remote.is_some() {
        Some(Input::start()?)
    } else {
        None
    };
    let provider = if let Some(model) = request.remote {
        writeln!(io::stderr().lock(), "{}", strings::REMOTE_DISCLOSURE)
            .map_err(|_| PublicError::Output)?;
        if input
            .as_ref()
            .ok_or(PublicError::Runtime)?
            .next(&cancel)?
            .as_deref()
            != Some("send")
        {
            return Err(ChatError::Model(synapse_core::ModelError::Consent).into());
        }
        Provider::openrouter(&model, &RemoteConsent::after_local_disclosure())
            .map_err(ChatError::from)?
    } else {
        Provider::bonsai()
    };
    let mut session = factory.open(
        &workspace.canonical_display,
        SessionOptions {
            policy: request.policy,
            provider,
        },
    )?;
    if let Some(question) = request.question {
        progress()?;
        let answer = session.ask(&question, &cancel)?;
        if cancel.is_cancelled() {
            return Err(PublicError::Interrupted.into());
        }
        if request.json {
            render::json_answer(&answer)?;
        } else {
            render::answer(&answer)?;
        }
        return Ok(());
    }
    render::trusted(&format!(
        "{}{}",
        strings::ROOT_LABEL,
        sanitize(&workspace.canonical_display)
    ))?;
    render::trusted(strings::SESSION_HELP)?;
    let input = input.ok_or(PublicError::Runtime)?;
    loop {
        if cancel.is_cancelled() {
            return Err(PublicError::Interrupted.into());
        }
        {
            let mut stdout = io::stdout().lock();
            write!(stdout, "{}", strings::PROMPT).map_err(|_| PublicError::Output)?;
            stdout.flush().map_err(|_| PublicError::Output)?;
        }
        let Some(line) = input.next(&cancel)? else {
            return Ok(());
        };
        let text = line.trim();
        if text.is_empty() {
            continue;
        }
        let result: Result<(), Error> = match text {
            "/quit" => return Ok(()),
            "/help" => render::trusted(strings::SESSION_HELP).map_err(Error::from),
            _ if text.starts_with("/source ") => {
                let ordinal = text[8..].parse::<usize>().map_err(|_| PublicError::Usage);
                ordinal.map_err(Error::from).and_then(|id| {
                    let passage = session.source(id)?;
                    render::passage(&passage, id).map_err(Error::from)
                })
            }
            _ if text.starts_with("/search ") => session
                .search(&text[8..], &cancel)
                .map_err(Error::from)
                .and_then(|a| render::answer(&a).map_err(Error::from)),
            _ if text.starts_with('/') => Err(PublicError::Usage.into()),
            _ => {
                progress()?;
                session
                    .ask(text, &cancel)
                    .map_err(Error::from)
                    .and_then(|a| {
                        if cancel.is_cancelled() {
                            Err(PublicError::Interrupted.into())
                        } else {
                            render::answer(&a).map_err(Error::from)
                        }
                    })
            }
        };
        if let Err(error) = result {
            if cancel.is_cancelled() || error.exit_code() == 130 {
                return Err(PublicError::Interrupted.into());
            }
            writeln!(io::stderr().lock(), "{}", error.code()).map_err(|_| PublicError::Output)?;
        }
    }
}
fn progress() -> Result<(), PublicError> {
    writeln!(io::stderr().lock(), "{}", strings::SEARCHING).map_err(|_| PublicError::Output)
}
