---
{
  "version": 1,
  "defaults": { "internal": "allow", "remote-model": "deny", "external-client": "deny" },
  "rules": []
}
---
# Synapse security

The frontmatter above is JSON syntax within YAML frontmatter. Edit structured
rules to grant access; prose does not grant permissions. Internal reads remain
subject to exclusions. Remote disclosure, client access, and note creation or
updates require explicit grants. Provider opt-in and client capabilities are
additional requirements. Missing or invalid policy blocks disclosure and writes.

Example rule (add to `rules` only if intended):

```json
{"id":"share-project","recipient":"remote-model","operation":"read","effect":"allow","selector":{"folder":"Projects"}}
```

A deny wins over every allow. A mask never grants access on its own. Mask actions
can remove `title`, `path`, `tags`, `frontmatter`, or `aliases`, or replace exact
case-sensitive literals. Replacements apply in rule/action order; field removals
are combined. Regex and model assurances cannot establish safe disclosure.

Control files and the research inbox are hidden from ordinary search and
sharing. A separately authorized client may append only to the configured
research inbox; this requires an explicit `append-research` allow rule and
`submit-research` capability. It cannot approve or apply destination-note edits.

Synapse never overwrites this file during setup or research processing.
