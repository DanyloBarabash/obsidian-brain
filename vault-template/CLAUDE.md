# Vault: Claude + Obsidian Kit

This file is read automatically by Claude Code at the start of every session via the obsidian-mcp server. It describes the vault structure, conventions, and rules of engagement.

---

## Vault structure

```
vault/
├── CLAUDE.md                    ← this file
├── Projects/                    active and archived projects
│   └── {project-name}/
│       ├── README.md            stack, goal, status, open questions
│       ├── decisions.md         architectural decision log
│       └── ...                  other project-specific notes
├── Claude-Sessions/             saved Claude Code sessions
│   └── YYYY-MM-DD-topic.md
├── Resources/                   ingested external documents
│   ├── YYYY-MM-DD-title.md
│   └── originals/               original files from Inbox after processing
├── Notes/                       personal notes not tied to a project
└── Inbox/                       drop files here; /ingest processes them
```

---

## Note conventions

### Frontmatter

Every note created by Claude must include frontmatter:

```yaml
---
date: YYYY-MM-DD HH:MM      # creation date
project: project-name        # omit if not project-specific
tags: [#tag1, #tag2]        # see tag taxonomy below
---
```

### Tag taxonomy

- `#session` — Claude Code session notes (always in Claude-Sessions/)
- `#resource` — ingested external documents (always in Resources/)
- `#decision` — architectural or design decisions
- `#note` — personal notes
- `#{project-name}` — project-specific tag (use the folder name)
- Topic tags: `#auth`, `#api`, `#database`, `#architecture`, `#performance`, etc.

### Links section

All notes may have a `## Links` section at the bottom. Claude appends backlinks here when creating connections between notes. Format:

```markdown
## Links
- [[path/to/note.md]] — one-line context for the connection
```

---

## Rules for Claude

1. **Never modify existing notes without showing a diff first.** Exception: appending to `## Links` section.
2. **Do not load `## Raw session log` or `## Full content` sections** unless the user explicitly asks for the raw content of a specific file.
3. **Prefer reading summary sections** (`## Суть`, `## Quick summary`, `## Decisions made`) for context-loading and search.
4. **File naming**: always `YYYY-MM-DD-kebab-case-topic.md`. Never use spaces in filenames.
5. **Tag discipline**: do not invent new tags. Use the taxonomy above. If a new tag is genuinely needed, note it in the session summary.
6. **When in doubt about which project a session belongs to**, ask the user before saving.

---

## Current projects

<!-- Update this list manually or ask Claude to update it after /resume -->

| Project | Status | Last session |
|---------|--------|-------------|
| (none yet — add your first project) | | |

---

## Preferences

- Language for session summaries: match the language of the conversation
- Backlink style: append, never prepend
- Confirmation before write: always (Claude must show preview before saving)
