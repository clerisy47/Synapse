use crate::{sanitize, strings};
use serde_json::{Value, json};
use std::io::Write;
use synapse_core::{Answer, Evidence, PublicError};
use unicode_width::UnicodeWidthChar;

pub fn wrap(line: &str, width: usize) -> Vec<String> {
    let mut lines = Vec::new();
    let mut current = String::new();
    let mut used = 0;
    for character in sanitize(line).chars() {
        let size = character.width().unwrap_or(0);
        if used + size > width.max(8) && !current.is_empty() {
            lines.push(std::mem::take(&mut current));
            used = 0;
        }
        current.push(character);
        used += size;
    }
    lines.push(current);
    lines
}
pub fn source(output: &mut impl Write, source: &Evidence) -> Result<(), PublicError> {
    writeln!(
        output,
        "[{}] {}:{}-{}",
        source.id,
        sanitize(source.path.as_str()),
        source.start_line,
        source.end_line
    )
    .map_err(|_| PublicError::OutputUnavailable)?;
    for line in source.text.lines() {
        for wrapped in wrap(line, synapse_adapters::terminal_columns()) {
            writeln!(output, "{wrapped}").map_err(|_| PublicError::OutputUnavailable)?;
        }
    }
    Ok(())
}
pub fn answer(
    output: &mut impl Write,
    result: &Answer,
    json_mode: bool,
) -> Result<(), PublicError> {
    if json_mode {
        let sources: Vec<_> = result.sources.iter().map(|source| json!({"id":source.id,"path":source.path.as_str(),"start_line":source.start_line,"end_line":source.end_line,"text":source.text})).collect();
        return write_json(
            output,
            json!({"version":1,"status":if result.sufficient() { "answered" } else { "insufficient_evidence" },"answer":if result.sufficient() { Some(result.sources.iter().map(|source| source.text.as_str()).collect::<Vec<_>>().join("\n\n")) } else { None },"sources":sources}),
        );
    }
    if !result.sufficient() {
        writeln!(output, "{}", strings::INSUFFICIENT)
            .map_err(|_| PublicError::OutputUnavailable)?;
    }
    for passage in &result.sources {
        source(output, passage)?;
    }
    Ok(())
}
pub fn error_json(output: &mut impl Write, error: PublicError) -> Result<(), PublicError> {
    write_json(
        output,
        json!({"version":1,"status":"error","error":{"code":error.code()}}),
    )
}
fn write_json(output: &mut impl Write, value: Value) -> Result<(), PublicError> {
    // Preserve machine data while escaping Unicode format controls for TTY safety.
    let serialized = value.to_string();
    let mut safe = String::new();
    for c in serialized.chars() {
        if c.is_control()
            || matches!(c, '\u{061c}' | '\u{200b}'..='\u{200f}' | '\u{2028}'..='\u{202e}' | '\u{2060}'..='\u{206f}' | '\u{feff}')
        {
            safe.push_str(&format!("\\u{:04x}", u32::from(c)));
        } else {
            safe.push(c);
        }
    }
    writeln!(output, "{safe}").map_err(|_| PublicError::OutputUnavailable)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn wraps_wide_unicode_and_removes_controls() {
        let wrapped = wrap("界界界界界\x1b\u{202e}", 8);
        assert_eq!(wrapped, vec!["界界界界", "界"]);
    }
    #[test]
    fn json_escapes_controls_without_changing_machine_data() {
        let mut buffer = Vec::new();
        assert!(write_json(&mut buffer, json!({"text":"a\x1b\u{0085}\u{202e}b"})).is_ok());
        assert!(!buffer.contains(&27));
        assert!(!String::from_utf8_lossy(&buffer).contains('\u{202e}'));
        let Ok(value) = serde_json::from_slice::<Value>(&buffer) else {
            panic!("synthetic JSON")
        };
        assert_eq!(value["text"], "a\x1b\u{0085}\u{202e}b");
    }
}
