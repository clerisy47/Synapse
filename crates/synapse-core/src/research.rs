use crate::{
    CapturedResearch, ContentHash, ControlFile, MAX_CAPTURE_BYTES, NotePath, Proposal,
    ProposalKind, ProposalReadPort, PublicError, ReviewPlan, StateStore, policy_fingerprint,
};
use chrono::NaiveDate;
use serde_yaml_ng::Value;

const MAX_DESTINATIONS: usize = 12;
#[derive(Clone, PartialEq, Eq)]
pub struct DailyDate(String);
impl DailyDate {
    pub fn parse(value: &str) -> Result<Self, PublicError> {
        if value.len() != 10
            || value.as_bytes()[4] != b'-'
            || value.as_bytes()[7] != b'-'
            || !value
                .bytes()
                .enumerate()
                .all(|(index, byte)| index == 4 || index == 7 || byte.is_ascii_digit())
            || value.starts_with("0000")
            || NaiveDate::parse_from_str(value, "%Y-%m-%d").is_err()
        {
            return Err(PublicError::DateRequired);
        }
        Ok(Self(value.to_owned()))
    }
    pub fn as_str(&self) -> &str {
        &self.0
    }
}
#[derive(Clone, PartialEq, Eq)]
pub struct Destination {
    pub id: String,
    pub path: NotePath,
}
#[derive(Clone, PartialEq, Eq)]
pub struct DailyRoute {
    pub id: String,
    pub folder: String,
    pub name: String,
    pub heading: String,
}
#[derive(Clone, PartialEq, Eq)]
pub struct Instructions {
    pub timezone: String,
    pub destinations: Vec<Destination>,
    pub daily: Option<DailyRoute>,
    pub prose: String,
}
fn identifier(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 32
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
}
fn text(value: &Value, key: &str) -> Result<String, PublicError> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(str::to_owned)
        .ok_or(PublicError::InvalidInstructions)
}
pub(crate) fn has_frontmatter(bytes: &str) -> bool {
    bytes.lines().next().is_some_and(|line| {
        line.strip_prefix('\u{feff}')
            .unwrap_or(line)
            .trim_end_matches([' ', '\t'])
            == "---"
    })
}
pub(crate) fn frontmatter(bytes: &str) -> Option<(Value, usize, usize)> {
    let mut lines = bytes.split_inclusive('\n');
    if lines
        .next()?
        .strip_prefix('\u{feff}')
        .unwrap_or(bytes.split_inclusive('\n').next()?)
        .trim_end_matches(['\r', '\n', ' ', '\t'])
        != "---"
    {
        return None;
    }
    let mut offset = bytes.split_inclusive('\n').next()?.len();
    let mut yaml = String::new();
    for line in lines {
        if line.trim_end_matches(['\r', '\n', ' ', '\t']) == "---" {
            return Some((
                crate::bounded_yaml::parse(&yaml)?,
                offset,
                offset + line.len(),
            ));
        }
        yaml.push_str(line);
        offset += line.len();
    }
    None
}
pub fn parse_instructions(
    bytes: &str,
    policy: &crate::AccessPolicy,
) -> Result<Instructions, PublicError> {
    if bytes.len() > crate::MAX_INSTRUCTION_BYTES {
        return Err(PublicError::ResourceLimit);
    }
    let (value, _, body_start) = frontmatter(bytes).ok_or(PublicError::InvalidInstructions)?;
    let mapping = value.as_mapping().ok_or(PublicError::InvalidInstructions)?;
    if mapping.keys().any(|key| {
        !matches!(
            key.as_str(),
            Some("synapse-instructions" | "timezone" | "destinations" | "daily")
        )
    }) || value.get("synapse-instructions").and_then(Value::as_u64) != Some(1)
    {
        return Err(PublicError::InvalidInstructions);
    }
    let timezone = text(&value, "timezone")?;
    if timezone.parse::<chrono_tz::Tz>().is_err() {
        return Err(PublicError::InvalidInstructions);
    }
    let entries = value
        .get("destinations")
        .and_then(Value::as_sequence)
        .filter(|entries| entries.len() <= MAX_DESTINATIONS)
        .ok_or(PublicError::InvalidInstructions)?;
    let mut destinations = Vec::new();
    for entry in entries {
        if entry.as_mapping().is_none_or(|mapping| mapping.len() != 2) {
            return Err(PublicError::InvalidInstructions);
        }
        let id = text(entry, "id")?;
        let path =
            NotePath::parse(&text(entry, "path")?).map_err(|_| PublicError::InvalidInstructions)?;
        if !identifier(&id)
            || !policy.permits_path(&path)
            || destinations
                .iter()
                .any(|prior: &Destination| prior.id == id || prior.path == path)
        {
            return Err(PublicError::InvalidInstructions);
        }
        destinations.push(Destination { id, path });
    }
    let daily = match value.get("daily") {
        None | Some(Value::Null) => None,
        Some(value) => {
            if value.as_mapping().is_none_or(|mapping| mapping.len() != 4) {
                return Err(PublicError::InvalidInstructions);
            }
            let route = DailyRoute {
                id: text(value, "id")?,
                folder: text(value, "folder")?,
                name: text(value, "name")?,
                heading: text(value, "heading")?,
            };
            if !identifier(&route.id)
                || destinations
                    .iter()
                    .any(|destination| destination.id == route.id)
                || route.name.len() > 128
                || route.name.matches("{date}").count() != 1
                || route.name.contains(['/', '\\', '\n', '\r'])
                || route.heading.trim().is_empty()
                || route.heading.chars().count() > 80
                || route.heading.chars().any(char::is_control)
            {
                return Err(PublicError::InvalidInstructions);
            }
            let sample = NotePath::parse(&format!(
                "{}/{}",
                route.folder,
                route.name.replace("{date}", "2000-01-01")
            ))
            .map_err(|_| PublicError::InvalidInstructions)?;
            if !policy.permits_path(&sample) {
                return Err(PublicError::InvalidInstructions);
            }
            Some(route)
        }
    };
    if destinations.is_empty() && daily.is_none() {
        return Err(PublicError::InvalidInstructions);
    }
    Ok(Instructions {
        timezone,
        destinations,
        daily,
        prose: bytes[body_start..].to_owned(),
    })
}
impl Instructions {
    pub fn resolve(
        &self,
        id: &str,
        date: Option<&DailyDate>,
        policy: &crate::AccessPolicy,
    ) -> Result<(NotePath, Option<String>), PublicError> {
        if let Some(destination) = self
            .destinations
            .iter()
            .find(|destination| destination.id == id)
        {
            return Ok((destination.path.clone(), None));
        }
        let daily = self
            .daily
            .as_ref()
            .filter(|daily| daily.id == id)
            .ok_or(PublicError::InvalidModelOutput)?;
        let date = date.ok_or(PublicError::DateRequired)?;
        let path = NotePath::parse(&format!(
            "{}/{}",
            daily.folder,
            daily.name.replace("{date}", date.as_str())
        ))?;
        if !policy.permits_path(&path) {
            return Err(PublicError::AccessRefused);
        }
        Ok((path, Some(daily.heading.clone())))
    }
}
pub fn capture_research(
    reader: &impl ProposalReadPort,
    store: &dyn StateStore,
    file: &NotePath,
    range: Option<(usize, usize)>,
) -> Result<ContentHash, PublicError> {
    if file != &reader.access_policy().research || &reader.workspace_id()? != store.workspace_id() {
        return Err(PublicError::AccessRefused);
    }
    let source = reader.inbox()?.ok_or(PublicError::Usage)?;
    if source_excluded(&source, reader.access_policy()) {
        return Err(PublicError::AccessRefused);
    }
    let lines: Vec<_> = source.split_inclusive('\n').collect();
    let (start, end) = range.unwrap_or((1, lines.len()));
    if start == 0 || end < start || end > lines.len() {
        return Err(PublicError::Usage);
    }
    let text = lines[start - 1..end].concat();
    if text.trim().is_empty() || text.len() > MAX_CAPTURE_BYTES {
        return Err(PublicError::ResourceLimit);
    }
    let mut capture = CapturedResearch {
        id: ContentHash::of(&[]),
        source: file.clone(),
        source_hash: ContentHash::of(source.as_bytes()),
        selection_hash: ContentHash::of(text.as_bytes()),
        start_line: start,
        end_line: end,
        text,
        captured_at: reader.unix_seconds()?,
    };
    capture.id = capture.expected_id(store.workspace_id());
    store.save_capture(capture)
}
pub fn setup_preview(
    reader: &impl ProposalReadPort,
    provider: ContentHash,
) -> Result<ReviewPlan, PublicError> {
    let instructions = reader.snapshot_control(ControlFile::Instructions)?;
    let research = reader.snapshot_control(ControlFile::Research)?;
    let sources = vec![instructions.clone(), research.clone()];
    let mut proposals = Vec::new();
    for (target, after) in [
        (instructions, crate::starters::INSTRUCTIONS_STARTER),
        (research, crate::starters::RESEARCH_STARTER),
    ] {
        if target.before.is_none() {
            proposals.push(Proposal {
                kind: ProposalKind::Setup,
                target,
                after: after.to_owned(),
                sources: sources.clone(),
                capture: None,
            });
        }
    }
    Ok(ReviewPlan {
        proposals,
        policy: policy_fingerprint(reader.access_policy()),
        provider,
    })
}

#[derive(Clone)]
pub struct ResearchDraft {
    pub destination_id: String,
    pub text: String,
    pub source_id: usize,
}
pub fn research_proposal(
    reader: &impl ProposalReadPort,
    capture: &CapturedResearch,
    instructions: &crate::FileSnapshot,
    draft: ResearchDraft,
    date: Option<&DailyDate>,
) -> Result<Proposal, PublicError> {
    if draft.source_id != 1 || !crate::plain_model_text(&draft.text, 800, 800) {
        return Err(PublicError::InvalidModelOutput);
    }
    if reader.snapshot_control(ControlFile::Instructions)? != *instructions {
        return Err(PublicError::Conflict);
    }
    let inbox = reader.snapshot_control(ControlFile::Research)?;
    let source = inbox.before.as_deref().ok_or(PublicError::Conflict)?;
    if capture.source != reader.access_policy().research
        || capture.source_hash != ContentHash::of(source.as_bytes())
        || source_excluded(source, reader.access_policy())
    {
        return Err(PublicError::Conflict);
    }
    let routes = parse_instructions(
        instructions
            .before
            .as_deref()
            .ok_or(PublicError::InvalidInstructions)?,
        reader.access_policy(),
    )?;
    let (path, heading) = routes.resolve(&draft.destination_id, date, reader.access_policy())?;
    let target = reader.snapshot_note(&path)?;
    if target
        .before
        .as_deref()
        .is_some_and(|before| !crate::ordinary_content(before, reader.access_policy()))
        || target.links.is_some_and(|links| links != 1)
    {
        return Err(PublicError::AccessRefused);
    }
    let newline = if target
        .before
        .as_deref()
        .is_some_and(|before| before.contains("\r\n"))
    {
        "\r\n"
    } else {
        "\n"
    };
    let addition = format!(
        "Unverified research (capture {}): {}",
        &capture.id.as_str()[..12],
        draft.text
    );
    let before = target.before.as_deref().unwrap_or("");
    let mut after = if before.is_empty() {
        let title = path
            .as_str()
            .rsplit('/')
            .next()
            .unwrap_or("Notes.md")
            .trim_end_matches(".md");
        format!(
            "---{newline}description: Reviewed research notes{newline}tags: [research]{newline}aliases: []{newline}---{newline}# {title}{newline}"
        )
    } else {
        before.to_owned()
    };
    if let Some(heading) = heading {
        let marker = format!("## {heading}");
        let body_start = frontmatter(&after)
            .map(|(_, _, offset)| offset)
            .unwrap_or(0);
        let mut offset = body_start;
        let mut found = None;
        let mut end = after.len();
        let mut fence: Option<(char, usize)> = None;
        for line in after[body_start..].split_inclusive('\n') {
            let text = line.trim_end_matches(['\r', '\n']);
            let trimmed = text.trim_start_matches(' ');
            let indentation = text.len() - trimmed.len();
            let marker_char = trimmed.chars().next().unwrap_or(' ');
            let fence_length = trimmed.chars().take_while(|c| *c == marker_char).count();
            if indentation <= 3 && matches!(marker_char, '`' | '~') && fence_length >= 3 {
                match fence {
                    None => fence = Some((marker_char, fence_length)),
                    Some((kind, length))
                        if kind == marker_char
                            && fence_length >= length
                            && trimmed[fence_length..].trim().is_empty() =>
                    {
                        fence = None
                    }
                    _ => (),
                }
                offset += line.len();
                continue;
            }
            if fence.is_none() {
                if text == marker {
                    if found.is_some() {
                        return Err(PublicError::Conflict);
                    }
                    found = Some(offset + line.len());
                } else if found.is_some()
                    && (text.starts_with("## ") || text.starts_with("# "))
                    && end == after.len()
                {
                    end = offset;
                }
            }
            offset += line.len();
        }
        if found.is_none() {
            after.push_str(&format!("{newline}{marker}{newline}"));
            end = after.len();
        }
        after.insert_str(end, &format!("{newline}{addition}{newline}{newline}"));
    } else {
        after.push_str(&format!("{newline}{addition}{newline}"));
    }
    if after.len() as u64 > crate::MAX_NOTE_BYTES
        || !crate::ordinary_content(&after, reader.access_policy())
    {
        return Err(PublicError::ResourceLimit);
    }
    let processed = ContentHash::combined(&[
        capture.selection_hash.as_str().as_bytes(),
        capture.source.as_str().as_bytes(),
        inbox.workspace.as_str().as_bytes(),
    ]);
    Ok(Proposal {
        kind: ProposalKind::Research,
        target,
        after,
        sources: vec![instructions.clone(), inbox],
        capture: Some(processed),
    })
}
pub fn source_excluded(bytes: &str, policy: &crate::AccessPolicy) -> bool {
    crate::corpus::metadata(bytes).is_some_and(|(value, _)| {
        crate::corpus::ignored(&value) || crate::corpus::excluded_tags(&value, policy)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn routing_is_versioned_and_dates_are_explicit() {
        let policy = crate::AccessPolicy::default();
        let Ok(instructions) = parse_instructions(crate::starters::INSTRUCTIONS_STARTER, &policy)
        else {
            panic!("starter")
        };
        assert!(matches!(
            instructions.resolve("daily", None, &policy),
            Err(PublicError::DateRequired)
        ));
        let Ok(date) = DailyDate::parse("2026-10-19") else {
            panic!("fixture date")
        };
        let Ok((path, _)) = instructions.resolve("daily", Some(&date), &policy) else {
            panic!("route")
        };
        assert_eq!(path.as_str(), "Daily/2026-10-19.md");
        for invalid in ["2026-2-3", "2026-02-30", "../note.md", "0000-01-01"] {
            assert!(DailyDate::parse(invalid).is_err());
        }
        assert!(
            parse_instructions(
                &crate::starters::INSTRUCTIONS_STARTER.replace("Notes.md", "Research.md"),
                &policy
            )
            .is_err()
        );
    }
}
