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

## Design Principles

- **Atomic notes** — one concept per file, dense links between them
- **Always-loadable core** — `MEMORY.md` must fit in a single context injection (~2000 tokens)
- **No duplication** — originals are stored once; processed notes reference them
- **Vault isolation** — each vault is self-contained; cross-vault links are explicit
- **Human-readable** — all files are plain Markdown, usable without AI tooling
