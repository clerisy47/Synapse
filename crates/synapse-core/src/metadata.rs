use crate::{
    AccessPolicy, ControlFile, FileSnapshot, Proposal, ProposalKind, ProposalReadPort, PublicError,
};
use serde_yaml_ng::{Mapping, Value};

pub const MAX_REPAIR_CHARS: usize = 6000;
pub const MAX_REPAIR_EXCERPT_BYTES: usize = 1200;
#[derive(Clone, PartialEq, Eq)]
pub struct MissingFields {
    pub description: bool,
    pub tags: bool,
    pub aliases: bool,
}
#[derive(Clone)]
pub struct MetadataInput {
    pub snapshot: FileSnapshot,
    pub missing: MissingFields,
    pub excerpt: String,
}
#[derive(Clone)]
pub struct MetadataFields {
    pub description: String,
    pub tags: Vec<String>,
    pub aliases: Vec<String>,
}
pub fn plain_model_text(value: &str, chars: usize, bytes: usize) -> bool {
    !value.trim().is_empty() && value.chars().count() <= chars && value.len() <= bytes && !value.chars().any(|c| c.is_control() || matches!(c,'\u{061c}'|'\u{200e}'|'\u{200f}'|'\u{2028}'..='\u{202e}'|'\u{2066}'..='\u{2069}'))
}
impl MetadataFields {
    pub fn validate(&self) -> bool {
        plain_model_text(&self.description, 240, 960)
            && !self.tags.is_empty()
            && self.tags.len() <= 12
            && self.tags.iter().all(|tag| plain_model_text(tag, 64, 256))
            && self.aliases.len() <= 12
            && self
                .aliases
                .iter()
                .all(|alias| plain_model_text(alias, 80, 320))
    }
}
pub fn ordinary_content(bytes: &str, policy: &AccessPolicy) -> bool {
    crate::corpus::metadata(bytes).is_some_and(|(value, _)| {
        !crate::corpus::ignored(&value) && crate::corpus::discovery(&value, policy).is_some()
    })
}
pub fn metadata_input(
    snapshot: FileSnapshot,
    policy: &AccessPolicy,
) -> Result<Option<MetadataInput>, PublicError> {
    let before = snapshot.before.as_deref().ok_or(PublicError::Usage)?;
    if snapshot.links != Some(1) || !policy.permits_path(&snapshot.path) {
        return Err(PublicError::AccessRefused);
    }
    if before.chars().count() > MAX_REPAIR_CHARS {
        return Err(PublicError::ResourceLimit);
    }
    let value = if crate::research::has_frontmatter(before) {
        crate::research::frontmatter(before)
            .map(|(value, _, _)| value)
            .ok_or(PublicError::InvalidMetadata)?
    } else {
        Value::Mapping(Mapping::new())
    };
    let mapping = value.as_mapping().ok_or(PublicError::InvalidMetadata)?;
    if crate::corpus::ignored(&value) || crate::corpus::excluded_tags(&value, policy) {
        return Err(PublicError::AccessRefused);
    }
    let missing = MissingFields {
        description: !mapping.contains_key(Value::String("description".into())),
        tags: !mapping.contains_key(Value::String("tags".into())),
        aliases: !mapping.contains_key(Value::String("aliases".into())),
    };
    let valid_description = missing.description
        || value
            .get("description")
            .and_then(Value::as_str)
            .is_some_and(|value| !value.trim().is_empty() && value.chars().count() <= 240);
    let valid_tags = missing.tags
        || value
            .get("tags")
            .is_some_and(|value| crate::corpus::strings(value, 1, 12, 64).is_some());
    let valid_aliases = missing.aliases
        || value
            .get("aliases")
            .is_some_and(|value| crate::corpus::strings(value, 0, 12, 80).is_some());
    if !valid_description || !valid_tags || !valid_aliases {
        return Err(PublicError::InvalidMetadata);
    }
    if !missing.description && !missing.tags && !missing.aliases {
        return Ok(None);
    }
    let mut excerpt = String::new();
    let body_start = crate::research::frontmatter(before)
        .map(|(_, _, offset)| offset)
        .unwrap_or(0);
    for c in before[body_start..].chars() {
        if excerpt.len() + c.len_utf8() > MAX_REPAIR_EXCERPT_BYTES {
            break;
        }
        excerpt.push(c);
    }
    Ok(Some(MetadataInput {
        snapshot,
        missing,
        excerpt,
    }))
}
pub fn metadata_proposal(
    reader: &impl ProposalReadPort,
    input: MetadataInput,
    fields: MetadataFields,
) -> Result<Proposal, PublicError> {
    if !fields.validate() || reader.snapshot_note(&input.snapshot.path)? != input.snapshot {
        return Err(PublicError::Conflict);
    }
    let current = metadata_input(input.snapshot.clone(), reader.access_policy())?
        .ok_or(PublicError::Conflict)?;
    if current.missing != input.missing {
        return Err(PublicError::Conflict);
    }
    let before = input.snapshot.before.as_deref().ok_or(PublicError::Usage)?;
    let mut mapping = Mapping::new();
    if input.missing.description {
        mapping.insert(
            Value::String("description".into()),
            Value::String(fields.description),
        );
    }
    if input.missing.tags {
        mapping.insert(
            Value::String("tags".into()),
            Value::Sequence(fields.tags.into_iter().map(Value::String).collect()),
        );
    }
    if input.missing.aliases {
        mapping.insert(
            Value::String("aliases".into()),
            Value::Sequence(fields.aliases.into_iter().map(Value::String).collect()),
        );
    }
    let yaml = serde_yaml_ng::to_string(&Value::Mapping(mapping))
        .map_err(|_| PublicError::InvalidModelOutput)?;
    let newline = if before.contains("\r\n") {
        "\r\n"
    } else {
        "\n"
    };
    let yaml = yaml.replace('\n', newline);
    let after = if crate::research::has_frontmatter(before) {
        let (_, close, _) =
            crate::research::frontmatter(before).ok_or(PublicError::InvalidMetadata)?;
        format!("{}{}{}", &before[..close], yaml, &before[close..])
    } else {
        let (bom, body) = if let Some(body) = before.strip_prefix('\u{feff}') {
            ("\u{feff}", body)
        } else {
            ("", before)
        };
        format!("{bom}---{newline}{yaml}---{newline}{body}")
    };
    if !ordinary_content(&after, reader.access_policy()) {
        return Err(PublicError::InvalidModelOutput);
    }
    let sources = vec![
        input.snapshot.clone(),
        reader.snapshot_control(ControlFile::Instructions)?,
    ];
    Ok(Proposal {
        kind: ProposalKind::Metadata,
        target: input.snapshot,
        after,
        rename_to: None,
        sources,
        capture: None,
    })
}
