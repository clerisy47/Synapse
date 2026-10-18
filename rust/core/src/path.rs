use crate::PublicError;

/// Portable workspace-relative Markdown name. This is syntax validation only;
/// physical containment is the filesystem adapter's responsibility.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct NotePath(String);

impl NotePath {
    pub fn parse(value: &str) -> Result<Self, PublicError> {
        if !value.ends_with(".md")
            || value
                .chars()
                .any(|c| c.is_control() || matches!(c, '\\' | ':'))
            || value
                .split('/')
                .any(|part| part.is_empty() || part == "." || part == "..")
        {
            return Err(PublicError::Usage);
        }
        Ok(Self(value.to_owned()))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

#[cfg(test)]
mod tests {
    use super::NotePath;

    #[test]
    fn rejects_ambiguous_or_non_markdown_paths() {
        for value in [
            "",
            "/a.md",
            "../a.md",
            "a/../b.md",
            "a//b.md",
            "./a.md",
            "a.txt",
            "C:/a.md",
            "a\\b.md",
            "a\n.md",
        ] {
            assert!(NotePath::parse(value).is_err(), "{value:?}");
        }
        assert_eq!(
            NotePath::parse("研究/notes.md").map(|p| p.as_str().to_owned()),
            Ok("研究/notes.md".to_owned())
        );
    }
}
