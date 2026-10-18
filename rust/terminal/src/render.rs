use crate::strings;
use serde_json::{Value, json};
use std::io::{self, Write};
use synapse_application::{Answer, Passage};
use synapse_core::PublicError;
use unicode_width::UnicodeWidthChar;
const DEFAULT_COLUMNS: usize = 80;
const MIN_COLUMNS: usize = 8;
const MAX_COLUMNS: usize = 240;
const JSON_VERSION: usize = 1;
pub fn trusted(text: &str) -> Result<(), PublicError> {
    writeln!(io::stdout().lock(), "{text}").map_err(|_| PublicError::Output)
}
pub fn sanitize(text: &str) -> String {
    let mut safe = String::new();
    for c in text.chars() {
        if untrusted_control(c) {
            safe.push_str(&format!("\\u{{{:x}}}", c as u32));
        } else {
            safe.push(c);
        }
    }
    safe
}
fn untrusted_control(c: char) -> bool {
    c.is_control()
        || matches!(c,'\u{061c}' | '\u{200b}'..='\u{200f}' | '\u{2028}'..='\u{202e}' | '\u{2060}'..='\u{206f}' | '\u{feff}')
}
fn wrap(text: &str, columns: usize) -> String {
    let mut result = String::new();
    let mut width = 0;
    for c in text.chars() {
        let next = c.width().unwrap_or(0);
        if width + next > columns && width > 0 {
            result.push('\n');
            width = 0;
        }
        result.push(c);
        width += next;
    }
    result
}
pub fn passage(p: &Passage, id: usize) -> Result<(), PublicError> {
    let columns = std::env::var("COLUMNS")
        .ok()
        .and_then(|s| s.parse::<usize>().ok())
        .filter(|n| (MIN_COLUMNS..=MAX_COLUMNS).contains(n))
        .unwrap_or(DEFAULT_COLUMNS);
    trusted(&format!(
        "[{id}] {}:{}-{}",
        sanitize(p.path.as_str()),
        p.start_line,
        p.end_line
    ))?;
    trusted(&wrap(&sanitize(&p.text), columns))
}
pub fn answer(answer: &Answer) -> Result<(), PublicError> {
    if !answer.supported() {
        return trusted(strings::INSUFFICIENT);
    }
    trusted(strings::EVIDENCE)?;
    for (i, p) in answer.sources.iter().enumerate() {
        passage(p, i + 1)?;
    }
    Ok(())
}
fn emit_json(value: Value) -> Result<(), PublicError> {
    let encoded = serde_json::to_string(&value).map_err(|_| PublicError::Output)?;
    // Escaping format controls preserves the parsed JSON value while making even
    // JSON redirected to a terminal inert. C0 controls are already JSON-escaped.
    let mut safe = String::new();
    for c in encoded.chars() {
        if untrusted_control(c) {
            safe.push_str(&format!("\\u{:04x}", c as u32));
        } else {
            safe.push(c);
        }
    }
    trusted(&safe)
}
pub fn json_answer(answer: &Answer) -> Result<(), PublicError> {
    emit_json(
        json!({"version":JSON_VERSION,"status":if answer.supported(){"supported"}else{"insufficient_evidence"},"answer":answer.sources.iter().map(|p|p.text.as_str()).collect::<Vec<_>>().join("\n"),"sources":answer.sources.iter().enumerate().map(|(i,p)|json!({"id":i+1,"path":p.path.as_str(),"start_line":p.start_line,"end_line":p.end_line,"text":p.text})).collect::<Vec<_>>()}),
    )
}
pub fn json_error(code: &str) -> Result<(), PublicError> {
    emit_json(json!({"version":JSON_VERSION,"status":"error","code":code}))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn inert_unicode_and_narrow_columns() {
        let safe = sanitize("研究\x1b]8;;evil\x07\r\n\u{009b}31m\u{202e}md");
        assert!(!safe.chars().any(char::is_control));
        assert!(!safe.contains('\u{202e}'));
        assert!(safe.starts_with("研究\\u{1b}"));
        assert_eq!(wrap("研究abc", 4), "研究\nabc");
    }
}
