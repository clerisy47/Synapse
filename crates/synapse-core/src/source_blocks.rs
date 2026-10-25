//! Source coordinates are authoritative; parsed relationships are discovery hints.
use crate::{Evidence, NotePath};
use pulldown_cmark::{Event, Options, Parser, Tag};
use sha2::{Digest, Sha256};
use std::ops::Range;

pub const MAX_CANDIDATE_PACKETS: usize = 64;
pub const MAX_PACKET_RANGES: usize = 3;
pub const MAX_CANDIDATE_RANGES: usize = MAX_CANDIDATE_PACKETS * MAX_PACKET_RANGES;

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum BlockKind {
    Paragraph,
    Heading,
    List,
    Table,
    Code,
    Other,
}
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SourceBlock {
    pub bytes: Range<usize>,
    pub start_line: usize,
    pub end_line: usize,
    pub kind: BlockKind,
    /// Indices into the same immutable source block collection.
    pub headings: Vec<usize>,
    pub hash: [u8; 32],
}
#[derive(Clone)]
pub struct EvidencePacket {
    pub path: NotePath,
    pub source_hash: [u8; 32],
    pub primary: SourceBlock,
    pub companions: Vec<SourceBlock>,
}
impl SourceBlock {
    pub(crate) fn evidence(&self, source: &str, path: &NotePath) -> Option<Evidence> {
        let text = source
            .lines()
            .skip(self.start_line.checked_sub(1)?)
            .take(self.end_line.checked_sub(self.start_line)? + 1)
            .collect::<Vec<_>>()
            .join("\n");
        if text.trim().is_empty()
            || text.chars().count() > crate::corpus::MAX_EXCERPT_CHARS
            || self.end_line - self.start_line + 1 > 24
        {
            return None;
        }
        Some(Evidence {
            id: 0,
            path: path.clone(),
            start_line: self.start_line,
            end_line: self.end_line,
            text,
        })
    }
}

/// Parse only eligible body bytes, retaining offsets into the original UTF-8
/// source. Public excerpts continue to use Rust lines()/LF normalization.
pub fn source_blocks(source: &str, body_start_line: usize) -> Vec<SourceBlock> {
    let mut line_starts = vec![0];
    line_starts.extend(source.match_indices('\n').map(|(offset, _)| offset + 1));
    let body_start = line_starts
        .get(body_start_line)
        .copied()
        .unwrap_or(source.len());
    let mut options = Options::empty();
    options.insert(Options::ENABLE_TABLES | Options::ENABLE_WIKILINKS);
    let mut blocks = Vec::new();
    let mut depth = 0usize;
    let mut current = None;
    let mut headings: Vec<(usize, usize)> = Vec::new();
    for (event, range) in Parser::new_ext(&source[body_start..], options).into_offset_iter() {
        match event {
            Event::Start(tag) => {
                if depth == 0 {
                    let (kind, level) = match tag {
                        Tag::Heading { level, .. } => (BlockKind::Heading, Some(level as usize)),
                        Tag::Paragraph => (BlockKind::Paragraph, None),
                        Tag::List(_) => (BlockKind::List, None),
                        Tag::Table(_) => (BlockKind::Table, None),
                        Tag::CodeBlock(_) => (BlockKind::Code, None),
                        _ => (BlockKind::Other, None),
                    };
                    if let Some(level) = level {
                        while headings.last().is_some_and(|(prior, _)| *prior >= level) {
                            headings.pop();
                        }
                    }
                    current = Some((
                        range.start + body_start,
                        range.end + body_start,
                        kind,
                        level,
                    ));
                }
                depth += 1;
            }
            Event::End(_) => {
                depth = depth.saturating_sub(1);
                if depth == 0 {
                    if let Some((start, initial_end, kind, level)) = current.take() {
                        let mut end = (range.end + body_start).max(initial_end);
                        // Offset events may include line endings. Do not attach
                        // a trailing blank line to the source block.
                        while end > start && matches!(source.as_bytes()[end - 1], b'\n' | b'\r') {
                            end -= 1;
                        }
                        if end <= start {
                            continue;
                        }
                        let block = SourceBlock {
                            bytes: start..end,
                            start_line: line_starts.partition_point(|offset| *offset <= start),
                            end_line: line_starts.partition_point(|offset| *offset < end),
                            kind,
                            headings: headings.iter().map(|(_, index)| *index).collect(),
                            hash: Sha256::digest(&source.as_bytes()[start..end]).into(),
                        };
                        let index = blocks.len();
                        blocks.push(block);
                        if let Some(level) = level {
                            headings.push((level, index));
                        }
                    }
                }
            }
            _ => {}
        }
    }
    blocks
}

pub(crate) fn packet(
    path: &NotePath,
    source_hash: [u8; 32],
    blocks: &[SourceBlock],
    source: &str,
    body_start: usize,
    primary: usize,
) -> EvidencePacket {
    let mut companions = Vec::new();
    let block = &blocks[primary];
    let lines: Vec<_> = source.split_inclusive('\n').collect();
    // Preserve complete contiguous framing when it fits; otherwise preserve
    // the nearest controlling heading as its own authentic range.
    let context_start = block
        .headings
        .first()
        .map(|i| blocks[*i].start_line - 1)
        .unwrap_or(body_start);
    let combined = source
        .lines()
        .skip(context_start)
        .take(block.end_line - context_start)
        .collect::<Vec<_>>()
        .join("\n");
    let whole_context_fits =
        block.end_line - context_start <= 24 && combined.chars().count() <= 1200;
    let context_start = if whole_context_fits {
        Some(context_start)
    } else {
        if let Some(heading) = block.headings.last() {
            companions.push(blocks[*heading].clone());
        }
        None
    };
    if let Some(start) = context_start {
        if start + 1 < block.start_line {
            let byte_start = lines.iter().take(start).map(|l| l.len()).sum();
            let mut byte_end = block.bytes.start;
            while byte_end > byte_start && matches!(source.as_bytes()[byte_end - 1], b'\r' | b'\n')
            {
                byte_end -= 1;
            }
            let end_line = source[..byte_end].bytes().filter(|b| *b == b'\n').count() + 1;
            companions.push(SourceBlock {
                bytes: byte_start..byte_end,
                start_line: start + 1,
                end_line,
                kind: BlockKind::Other,
                headings: Vec::new(),
                hash: Sha256::digest(&source.as_bytes()[byte_start..byte_end]).into(),
            });
        }
    }
    if let Some(next) = (primary + 1..blocks.len()).find(|i| blocks[*i].kind != BlockKind::Heading)
    {
        companions.push(blocks[next].clone());
    }
    companions.truncate(MAX_PACKET_RANGES - 1);
    EvidencePacket {
        path: path.clone(),
        source_hash,
        primary: block.clone(),
        companions,
    }
}
