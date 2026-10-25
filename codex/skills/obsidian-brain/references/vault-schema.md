# Vault schema

Read this reference when creating or structurally changing content in `{{VAULT_ROOT}}`.

## Topology

```text
global.md
├── _global/
│   ├── documents/
│   ├── notes/
│   ├── sessions/
│   └── templates/
├── classes/<class>.md
│   └── links to projects in that class
└── projects/<org-or-project>.md
    └── projects/<org-or-project>/<subproject>.md
        ├── documents/
        ├── notes/
        └── sessions/
```

Top-level and subproject hubs are files beside their same-named content folders. Preserve the existing organization and use the closest matching project as the owner.

## Routing

- `class`: stable group of projects with a scope and an explicit classification rule.
- `hub`: compact current context, state, durable decisions, open questions, and links.
- `document`: maintained technical or domain reference that may be updated over time.
- `article`: a library publication summary with a source URL when available, an independent subject `domain`, and no project owner.
- `note`: focused durable knowledge about one topic.
- `session`: concise history of completed work and verified outcomes.
- `_global`: cross-project protocols or knowledge only.
- Project-free articles and references: `_global/library.md` → `_global/library/articles/`, `documents/`, or `notes/`. Set `knowledge_scope: library`, `domain` for the subject, a stable `id`, and `source_url` when applicable. Link `related` to `[[_global/library]]` and add a downward hub link. Omit project ownership; optional `applies_to` links express reuse by projects. Do not move project documents, sessions or global rules into the library.

## Frontmatter

### Class

```yaml
---
id: class/<class-id>
type: class
class: <class-id>
updated: YYYY-MM-DD
tags: [class]
---
```

### Hub

```yaml
---
id: <project-id>
type: hub
project: <project-id>
client: <client-name>
parent: "[[projects/<parent-hub-path>]]"
class: <class-id>
domain: <domain-id>
stage: <lifecycle-stage>
engagement: <internal|client|education|personal>
updated: YYYY-MM-DD
tags: [<project-id>, hub]
---
```

Omit `client` and `parent` when they do not apply. Organization hubs may use `type: org`. Every project/org hub must include `class`, `domain`, `stage`, and `engagement`; child hubs inherit `class` and `engagement` from their parent while specifying their own `domain` and `stage`.

### Document

```yaml
---
id: <project-id>/documents/<topic>
type: document
vault: <project-id>
updated: YYYY-MM-DD
tags: [<topic>]
related:
  - "[[projects/<path-to-project-hub>]]"
---
```

### Note

```yaml
---
id: <project-id>/notes/<topic>
type: note
project: <project-id>
date: YYYY-MM-DD
updated: YYYY-MM-DD
tags: [<topic>]
related:
  - "[[projects/<path-to-project-hub>]]"
---
```

### Session

```yaml
---
id: <project-id>/sessions/<project-id>-YYYY-MM-DD-<topic>
type: session
project: <project-id>
date: YYYY-MM-DD
updated: YYYY-MM-DD
status: active
tags: [<project-id>, <topic>]
related:
  - "[[projects/<path-to-project-hub>]]"
summary: "<one-sentence verified outcome>"
---
```

Neighboring files sometimes use `vault` in documents and sessions. Preserve the local convention when updating them; new notes should follow the schemas above.

## Required sections

- Class: `Scope`, `Projects`, and `Classification rule`.
- Hub: `Project` or `Organisation`, `State`, `Key decisions`, `Open questions`, `Load if needed`, plus content link sections.
- Session: `Goal`, `Outcomes`, `Key decisions`, `Verification`, `Files changed`, `Open tasks`, and `Key learnings` as applicable. Omit empty boilerplate except `Open tasks`, which may say `None`.
- Document/note: use topic-specific headings; put the current authoritative conclusion near the top and label historical or superseded statements.

## Link invariants

- `global.md` links to class hubs and vault-wide resources.
- Each top-level project or organization appears in exactly one class hub.
- Organization hubs link to child hubs.
- Project hubs link to their own documents, sessions, and notes.
- Content files use `related` only for their owning hub and directly relevant peers.
- Do not add an upward `related` field to a hub when `parent` already expresses that relationship.

## Safety invariants

- Never touch `.obsidian/` through file-editing tools.
- Do not record API keys, access tokens, passwords, private customer data, or full raw conversations.
- Do not delete or archive automatically. Mark superseded material and let the user approve cleanup.
- Do not auto-commit or auto-sync.
