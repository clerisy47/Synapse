---
{
  "version": 1,
  "timezone": "UTC",
  "destinations": [],
  "daily": { "id": "daily-log", "folder": "Daily", "filename": "YYYY-MM-DD.md", "heading": "## Log" }
}
---
# Synapse instructions

The frontmatter uses JSON syntax within YAML frontmatter. Set `timezone` to your
IANA timezone (for example `Asia/Kathmandu`). Routing settings are deterministic;
style prose never grants permissions or overrides Security.md.

For daily-log research, resolve an explicit calendar date in the configured
timezone before proposing `Daily/YYYY-MM-DD.md`. Ask for a date when ambiguous.
Append concise entries under `## Log`, preserve unrelated sections/frontmatter,
and avoid duplicate entries. Show the complete proposed diff for local review.

Other destinations use configured IDs and canonical Markdown paths, for example:

```json
{"id":"project-summary","path":"Projects/Summary.md"}
```

The plugin resolves paths. Research and model output cannot introduce arbitrary
destinations, edit control files, approve changes, delete notes, or rename files.
Synapse never overwrites this file during setup.
