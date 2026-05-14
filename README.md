# Claude Brain — AI Memory System via Obsidian

A persistent, structured memory layer for Claude, Codex, and other AI assistants, built on Obsidian vaults.

---

## Concept

One Obsidian vault = one "brain." Each project gets its own vault. There is also a global personal memory vault shared across all projects. Any project vault can be connected to the global vault, so accumulated knowledge is always available.

---

## Vault Structure

```
vault/
├── _index/              # Master index — table of contents for the entire vault
│   └── INDEX.md         # Short descriptions of every note, project, document, topic
│
├── memory/              # Core memory — loaded into every new session
│   ├── MEMORY.md        # What exists, where it lives, key facts, project state
│   └── context/         # Supplementary context blocks (loaded on demand)
│
├── sessions/            # Claude / AI session logs
│   ├── YYYY-MM-DD-<title>.md
│   └── ...
│
├── documents/           # Ingested external documents
│   ├── originals/       # Raw files or cached content
│   └── processed/       # Summarized, linked, key-facts extracted
│
└── notes/               # User-requested saves and ad-hoc knowledge
```

---

## Memory Blocks

### 1. Sessions (`sessions/`)
Every AI session that the user saves is:
- Summarized (key decisions, outcomes, code produced)
- Analyzed for topics, entities, open questions
- Linked to relevant documents, notes, and previous sessions
- Tagged with project, date, and participants

### 2. Documents (`documents/`)
Any file or URL the user drops in is:
- Parsed and stored as-is in `originals/`
- Processed in `processed/`: summary, key facts, extracted concepts
- Linked to everything relevant already in the vault
- Indexed in `_index/INDEX.md`

### 3. Index (`_index/INDEX.md`)
A single navigable table of contents for the entire vault:
- Short (1–3 line) description per note
- Grouped by type: sessions, documents, notes, projects
- Updated automatically whenever new content is added
- The first thing to load when orienting in a new session

### 4. Core Memory (`memory/MEMORY.md`)
A compact, always-current snapshot of:
- What this vault/project is about
- Key decisions and current state
- Where to find things (pointers, not content)
- Open questions and next steps
- Links to connected vaults

This file is designed to be injected at the start of any AI session to restore full context instantly.

### 5. Notes (`notes/`)
Ad-hoc knowledge the user asks to save:
- Summarized and condensed
- Linked to related sessions, documents, and other notes
- Indexed

---

## Multi-Vault Architecture

```
global-memory/          ← personal memory, always available
    memory/MEMORY.md
    sessions/
    documents/
    notes/

project-alpha/          ← project-specific vault
    memory/MEMORY.md    ← references global-memory
    sessions/
    ...

project-beta/
    ...
```

A project vault can **import** (link to) the global memory vault so that global context is available within the project without duplication. The global vault accumulates knowledge across all projects.

---

## Commands (Claude Code Skills)

| Command | Description |
|---|---|
| `/save-session` | Summarize, analyze, and save the current Claude session |
| `/ingest <file\|url>` | Add an external document, process, and link it |
| `/recall [query]` | Search memory and return relevant context |
| `/memory` | Load core memory into the current session |
| `/index` | Rebuild `_index/INDEX.md` from vault contents |
| `/note <text>` | Save an ad-hoc note to `notes/`, linked and indexed |
| `/add-vault <path>` | Register a new vault (project or global) |
| `/switch-vault <name>` | Switch active vault for this session |

---

## Processing Pipeline

```
Input (session / file / url / note)
    │
    ▼
Parse & store original
    │
    ▼
Summarize  →  Extract key facts  →  Identify entities & topics
    │
    ▼
Link to existing memory (sessions, docs, notes)
    │
    ▼
Update _index/INDEX.md
    │
    ▼
Update memory/MEMORY.md (if significant)
```

---

## Token Budget & Tiered Memory Loading

Memory is never loaded all at once. Loading is demand-driven and strictly budget-controlled.

### Tiers

| Tier | File | Max tokens | When loaded |
|---|---|---|---|
| 0 — Always | `memory/MEMORY.md` | 1 500 | Every session, automatically |
| 1 — On demand | `_index/INDEX.md` | 2 000 | When navigating or searching the vault |
| 2 — Contextual | `memory/context/*.md` | 1 000 each | When a topic is explicitly relevant |
| 3 — Full detail | `sessions/`, `documents/processed/`, `notes/` | unlimited | Only when the user or AI explicitly requests a specific file |

**Tier 0 is the only automatic load.** Everything else is pulled in by `/recall`, explicit `/memory context:<topic>`, or direct user request.

### MEMORY.md overflow handling

`MEMORY.md` has a hard limit of **1 500 tokens**. When an update would exceed it:
1. Oldest or least-referenced entries are moved to `memory/context/<topic>.md`
2. `MEMORY.md` retains a one-line pointer: `→ [[context/topic]]`
3. The index entry for that context file is updated

This keeps Tier 0 lean while preserving full detail in lower tiers.

### Session archiving

Sessions older than 90 days that have not been referenced are compressed:
- The full session note is moved to `sessions/archive/`
- A condensed 3–5 line summary replaces it in the index
- `MEMORY.md` is unaffected unless the session contained a core decision

---

## Recall Strategy

`/recall <query>` resolves what to load using a two-step process:

```
query
  │
  ▼
1. Scan INDEX.md for matching titles / descriptions   (cheap — Tier 1 only)
  │
  ▼
2. Score candidates → return top N file pointers
  │
  ▼
3. Load only the matched files (Tier 2–3)             (only what's needed)
```

The result is a focused context injection, not a full vault dump. The caller sees only the relevant notes plus their direct links.

---

## Note Frontmatter Schema

Every note uses consistent frontmatter so linking, indexing, and recall work reliably.

```yaml
---
id: <YYYY-MM-DD-slug>          # unique stable identifier
type: session | document | note | context | index
date: YYYY-MM-DD
project: <vault-name>          # which vault / project this belongs to
tags: []                       # topic tags, lowercase kebab-case
status: active | archived
related: []                    # [[wikilinks]] to connected notes
summary: ""                    # 1–2 sentence description (used by INDEX.md)
---
```

Rules:
- `summary` is mandatory — it is what INDEX.md renders and what recall scans first
- `related` is populated automatically during ingestion/save; can be edited manually
- `status: archived` removes a note from active recall but keeps it searchable

---

## Auto-Triggers (Hooks)

Automated behaviors that run without explicit commands:

| Trigger | Action |
|---|---|
| Session ends (Claude Code stops) | Prompt user: "Save this session to memory?" |
| `/ingest` completes | Auto-update `_index/INDEX.md` and check `MEMORY.md` for overflow |
| `/note` completes | Auto-link to related notes, auto-update index |
| `MEMORY.md` exceeds 1 500 tokens | Auto-compress: move overflow to `memory/context/` |
| New vault connected via `/add-vault` | Auto-import that vault's `MEMORY.md` as a context block |

Hooks are implemented as Claude Code `stop` and `post-tool-use` hooks in `.claude/settings.json`.

---

## Note Templates

### Session (`sessions/YYYY-MM-DD-<title>.md`)
```markdown
---
id: YYYY-MM-DD-title
type: session
date: YYYY-MM-DD
project: project-name
tags: []
status: active
related: []
summary: ""
---

## Goal
What this session set out to do.

## Key Decisions
- 

## Outcomes
Code written, problems solved, answers found.

## Open Questions
- 

## Links
```

### Document (`documents/processed/YYYY-MM-DD-<title>.md`)
```markdown
---
id: YYYY-MM-DD-title
type: document
date: YYYY-MM-DD
project: project-name
tags: []
status: active
related: []
summary: ""
source: ""          # original file path or URL
---

## Summary

## Key Facts
- 

## Extracted Concepts
- 
```

### Note (`notes/YYYY-MM-DD-<slug>.md`)
```markdown
---
id: YYYY-MM-DD-slug
type: note
date: YYYY-MM-DD
project: project-name
tags: []
status: active
related: []
summary: ""
---

(content)
```

---

## Sync Strategy

Each vault is a plain Git repository. No proprietary sync required.

| Scenario | Approach |
|---|---|
| Single device | Local Git only, optional remote backup |
| Multi-device | Git remote (GitHub / self-hosted), pull before session, push after `/save-session` |
| Global + project vaults | Each vault is its own repo; cross-vault links use absolute paths or a configured alias |
| Obsidian Sync | Compatible — vault folder structure is unchanged; Git and Obsidian Sync can coexist |

Cross-vault links are stored as configured aliases in `.claude/settings.json`, not hardcoded paths, so the system is portable across machines.

---

## Design Principles

- **Atomic notes** — one concept per file, dense links between them
- **Token efficiency** — only Tier 0 loads automatically; everything else is pulled on demand
- **Hard size limits** — `MEMORY.md` ≤ 1 500 tokens, enforced by auto-compression
- **No duplication** — originals stored once; processed notes reference them
- **Vault isolation** — each vault is self-contained; cross-vault links are explicit and aliased
- **Human-readable** — all files are plain Markdown, usable without AI tooling
- **Progressive disclosure** — broad context first (index), detail only when needed
