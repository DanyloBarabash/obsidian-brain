# Obsidian Brain — AI Memory System via Obsidian

A persistent, structured memory layer for Claude, Codex, and other AI assistants, built on Obsidian vaults.

---

## Concept

One Obsidian vault = one "brain." Each project gets its own vault. There is also a global personal memory vault shared across all projects. Any project vault can be connected to the global vault, so accumulated knowledge is always available.

---

## Memory Model

The architecture maps directly to how biological memory works. Each principle has a concrete implication for this system.

### Attention filter

The brain receives ~11M bits/s but only ~50 bits reach conscious awareness. Most is discarded before you notice. Only contextually significant input, repeated patterns, and things that connect to existing knowledge are encoded.

**Implication:** saving is filtered, not wholesale. `/save-session` extracts decisions, outcomes, and open questions — not the full transcript. `/ingest` extracts key facts and concepts — not the raw document.

### Working memory = context window

Working memory (~4–7 slots) is not storage — it is the active processing space. The brain does not "load memories" — it reconstructs them into working memory on demand.

**Implication:** the context window is working memory. `MEMORY.md` is not knowledge — it is an **instruction set for what to reconstruct**. Loading a session is reconstruction from pointers, not playback of a recording.

### Hippocampus = index, not storage

The hippocampus does not store memories — it stores **pointers** to distributed patterns across the cortex. Recall = reconstruction from a pointer, not retrieval of a stored record.

**Implication:** `_index/INDEX.md` is the hippocampus. It holds only pointers and summaries, never content. Recall navigates the index first, then pulls only the matched files.

### Spreading activation

One memory activates adjacent ones along association edges. Thinking about "coffee" automatically warms up "morning", "office", "deadline". Activation spreads through links, not categories.

**Implication:** when `/recall` finds a note, it surfaces the **first layer of its `related` links** as named candidates — not loaded. The user decides what to pull next. This avoids a full vault dump while making connections visible.

### Consolidation

During sleep the brain replays experiences in the background, strips details, and extracts patterns. Specific episodes fade; abstract schemas remain.

**Implication:** `/consolidate` reads old sessions, extracts recurring patterns and decisions, updates `MEMORY.md` with schemas rather than episodes, and moves raw sessions to `sessions/archive/`.

### Context-dependent retrieval

Memories are easier to access in the same context they were encoded in. Recall is biased by the current environment.

**Implication:** recall searches the **active vault first**, then the global vault. A query in `project-alpha` surfaces `project-alpha` notes before global ones, even if global notes are a closer lexical match.

### Predictive pre-loading

The brain continuously predicts what will be needed and "warms" relevant memories before they are consciously requested.

**Implication:** on session start, `MEMORY.md` contains pointers to what was relevant last time. The user reads them and decides what to load via `/recall`. No automatic scan — token cost stays zero until the user initiates it.

### Brain → System mapping

| Brain mechanism | System equivalent |
|---|---|
| Attention filter | Significance filter during `/save-session` and `/ingest` |
| Working memory | Active context window |
| `MEMORY.md` | Reconstruction instruction, not knowledge store |
| Hippocampus | `_index/INDEX.md` — pointers only, per vault |
| Spreading activation | `/recall` returns note + named first-layer links |
| Consolidation | `/consolidate` — patterns from episodes → `MEMORY.md` |
| Context-dependent retrieval | Active vault searched before global vault |
| Predictive pre-loading | Session-start proposal based on recent sessions |

---

## Vault Structure

There is a single Obsidian vault rooted at `brain/`. Inside it, `_global/` holds the persistent personal brain and `projects/` holds one sub-folder per project. Every workspace — global or project — has the same internal layout.

```text
brain/                        ← single Obsidian vault root
├── _global/                  ← global memory
│   ├── _index/
│   │   └── INDEX.md          # Hippocampus: pointers + summaries for everything global
│   ├── memory/
│   │   ├── MEMORY.md         # Tier 0 core: reconstruction instructions, ≤ 1 500 tokens
│   │   └── context/          # Tier 2 blocks: one file per topic, loaded on demand
│   │       ├── <topic-a>.md
│   │       └── <topic-b>.md
│   ├── sessions/
│   │   ├── YYYY-MM-DD-<title>.md
│   │   └── archive/          # Consolidated sessions (summary only, originals compressed)
│   ├── documents/
│   │   ├── originals/        # Raw files / cached URLs, never modified
│   │   └── processed/        # Summarized, key-facts extracted, linked
│   └── notes/                # Ad-hoc saves: summarized, linked, indexed
│
└── projects/
    ├── project-alpha/        ← project workspace (same internal structure as _global/)
    │   ├── _index/INDEX.md
    │   ├── memory/MEMORY.md
    │   ├── memory/context/
    │   ├── sessions/
    │   ├── documents/
    │   └── notes/
    └── project-beta/
        └── ...
```

---

## Memory Blocks

### Sessions (`sessions/`)

Every saved AI session is:

- Summarized: key decisions, outcomes, code produced — not the full transcript
- Analyzed for topics, entities, open questions
- Linked to related documents, notes, and previous sessions
- Tagged and indexed in this vault's `_index/INDEX.md`

Sessions older than 90 days that have not been referenced are moved to `sessions/archive/` by `/consolidate` and replaced with a 3–5 line summary in the index. `MEMORY.md` is unaffected unless the session contained a core decision.

### Documents (`documents/`)

Any file or URL dropped via `/ingest` is:

- Stored as-is in `originals/` — never modified
- Processed into `processed/`: summary, key facts, extracted concepts, links
- Indexed in `_index/INDEX.md`

Documents scoped to one project live in the project vault. Documents useful across projects go in the global vault.

### Index (`_index/INDEX.md`)

**Every vault has its own index.** It is the hippocampus of that vault — pointers and summaries only, never content.

- One entry per note: `summary` field + file path
- Grouped by type: sessions, documents, notes, context blocks
- Updated automatically on every save, ingest, or note operation
- Searched first by `/recall` (Tier 1, cheap); full files pulled only on match (Tier 2–3)

During cross-vault recall, both the project index and global index are searched — project results ranked first.

### Core Memory (`memory/MEMORY.md`)

**Every vault has its own `MEMORY.md`** — a reconstruction instruction set loaded automatically at session start (Tier 0, ≤ 1 500 tokens):

- What this vault/project is about
- Key decisions and current state
- Pointers to context blocks: `→ [[context/topic]]`
- Open questions and next steps
- For project vaults: a pointer to `_global/memory/MEMORY.md`

The project `MEMORY.md` loads first. The global core is pulled only when the session explicitly needs cross-project context.

### Context Blocks (`memory/context/`)

Topic-specific detail files, each ≤ 1 000 tokens. Overflow from `MEMORY.md` lands here. Loaded on demand (Tier 2) when a topic is directly relevant.

### Notes (`notes/`)

Ad-hoc knowledge saved via `/note`:

- Summarized and condensed before saving
- Auto-linked to related sessions, documents, and other notes
- Indexed immediately

---

## Vault Architecture

One Obsidian vault (`brain/`) contains everything — the global brain and all project workspaces. Backlinks, graph view, and MCP are configured once for the root and see every note automatically.

```text
brain/                        ← Obsidian vault root (open this in Obsidian)
│
├── _global/                  ← persistent personal brain
│   ├── _index/INDEX.md       ← global hippocampus
│   ├── memory/MEMORY.md      ← global Tier 0 core
│   ├── memory/context/       ← global Tier 2 blocks
│   ├── sessions/             ← cross-project history
│   ├── documents/            ← personal knowledge base
│   └── notes/
│
└── projects/
    ├── project-alpha/        ← each project has the same internal structure
    │   ├── _index/INDEX.md   ← project hippocampus
    │   ├── memory/MEMORY.md  ← project Tier 0 core (pointer to _global MEMORY.md)
    │   ├── memory/context/
    │   ├── sessions/
    │   ├── documents/
    │   └── notes/
    └── project-beta/
        └── ...
```

### How recall works across workspaces

```text
/recall <query>  (inside projects/project-alpha)
    │
    ▼
1. Search projects/project-alpha/_index/INDEX.md    ← project context first
    │
    ▼
2. Search _global/_index/INDEX.md                   ← global context second
    │
    ▼
3. Merge, score, return top N + first-layer links
```

Project results rank above global results for the same relevance score. Global results are always available but never override local context.

### What lives where

| Content | Stored in |
|---|---|
| Work specific to a project | `projects/<name>/` |
| Personal knowledge, preferences, cross-project decisions | `_global/` |
| Session from a project | `projects/<name>/sessions/` |
| Document relevant to one project | `projects/<name>/documents/` |
| Document useful across projects | `_global/documents/` |
| Pattern extracted by `/consolidate` | `_global/memory/MEMORY.md` if cross-project; project if not |

### Creating a new project workspace

```bash
/add-vault project-alpha
```

This creates `brain/projects/project-alpha/` with the full internal structure and registers it in `.claude/settings.json`. All subsequent `/recall` calls in that project automatically include the global index in step 2.

---

## Commands (Claude Code Skills)

| Command | Description |
|---|---|
| `/save-session` | Summarize, analyze, and save the current Claude session |
| `/ingest <file\|url>` | Add an external document, process, and link it |
| `/recall [query]` | Search memory and return relevant context + first-layer links |
| `/memory` | Load core memory (`MEMORY.md`) into the current session |
| `/index` | Rebuild `_index/INDEX.md` from vault contents |
| `/note <text>` | Save an ad-hoc note to `notes/`, linked and indexed |
| `/consolidate` | Extract patterns from old sessions, compress into `MEMORY.md`, archive originals |
| `/add-vault --root <path>` | Initialize the root `brain/` vault (first-time setup) |
| `/add-vault <project-name>` | Create a new project inside `brain/projects/` |
| `/switch-vault <name>` | Switch active project workspace for this session |

---

## Processing Pipeline

### Ingestion (file / url / note)

```text
File dropped into documents/originals/   ←── automatic trigger (no command needed)
  OR  /ingest <file|url>
  OR  /note <text>
    │
    ▼
Parse & store original in documents/originals/   (skip if already there)
    │
    ▼
Summarize  →  Extract key facts  →  Identify entities & topics
    │
    ▼
Link to existing memory (sessions, docs, notes)
    │
    ▼
Write processed note to documents/processed/ or notes/
    │
    ▼
Update _index/INDEX.md  →  propagate to global index if cross-project
    │
    ▼
Update memory/MEMORY.md if significant  →  overflow to context/ if > 1 500 tokens
```

### Recall (manual)

```text
/recall <query>
    │
    ▼
Scan _index/INDEX.md  (Tier 1)
    │
    ├── match found → load file(s)  (Tier 2–3) + surface related[] names
    └── no match   → report nothing found
```

---

## Token Budget & Tiered Memory Loading

Memory is never loaded all at once. Loading is demand-driven and strictly budget-controlled.

### Tiers

| Tier | File | Max tokens | When loaded |
|---|---|---|---|
| 0 — Always | `memory/MEMORY.md` | 1 500 | Every session, automatically |
| 1 — On demand | `_index/INDEX.md` | 2 000 | Via `/recall` or `/index` |
| 2 — Contextual | `memory/context/*.md` | 1 000 each | When `/recall` finds a match or via `/memory context:<topic>` |
| 3 — Full detail | `sessions/`, `documents/processed/`, `notes/` | unlimited | When `/recall` finds a match or explicitly requested by name |

**Tier 0 is the only automatic load.** Everything else requires an explicit `/recall` or direct request. Token cost is always user-initiated.

### MEMORY.md overflow handling

`MEMORY.md` has a hard limit of **1 500 tokens**. When an update would exceed it:

1. Oldest or least-referenced entries are moved to `memory/context/<topic>.md`
2. `MEMORY.md` retains a one-line pointer: `→ [[context/topic]]`
3. The index entry for that context file is updated

This keeps Tier 0 lean while preserving full detail in lower tiers.

---

## Recall Strategy

All recall is manual and explicit — nothing loads beyond Tier 0 unless requested. This keeps token usage predictable.

`/recall <query>` resolves what to load using a three-step process:

```text
query
  │
  ▼
1. Scan INDEX.md for matching titles / descriptions     (Tier 1 only)
  │
  ▼
2. Score candidates → select top N file pointers
  │
  ▼
3. Load matched files + surface first-layer related[]   (Tier 2–3, named not loaded)
```

The result is a focused context injection. Each named link in `related[]` is surfaced as a candidate for the next pull — not loaded automatically. The user decides whether to go deeper.

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
| File dropped into `documents/originals/` | Auto-process: summarize, extract facts, link, index — no `/ingest` needed |
| URL passed via `/ingest` | Auto-fetch, process, and save to `documents/` |
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
source: ""
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
| Global + project vaults | Each vault is its own repo; cross-vault links use configured aliases |
| Obsidian Sync | Compatible — vault folder structure is unchanged; Git and Obsidian Sync can coexist |

Cross-vault links are stored as configured aliases in `.claude/settings.json`, not hardcoded paths, so the system is portable across machines.

---

## Technical Implementation

### Stack

| Layer | Technology |
|---|---|
| Commands | Claude Code skills — `.md` files in `.claude/commands/` |
| Vault I/O | Obsidian MCP (`mcp__obsidian__*` tools) |
| Processing | Current Claude session — reads, reasons, writes via session tools |
| Auto-triggers | Claude Code hooks in `.claude/settings.json` |
| Config & aliases | `.claude/settings.json` — vault paths, cross-vault aliases |
| Storage | Plain Markdown files in Git repos |

---

### Skills (`.claude/commands/`)

Each command is a Markdown file that instructs Claude what to do. No separate runtime required.

```text
.claude/commands/
├── save-session.md     # summarize session → write to sessions/, update index
├── ingest.md           # fetch/read file → process → write to documents/, update index
├── recall.md           # read INDEX.md → score → load matched files + surface related[]
├── memory.md           # read memory/MEMORY.md → inject into context
├── index.md            # scan all vault files → rebuild _index/INDEX.md from frontmatter
├── note.md             # summarize input → write to notes/, link, update index
├── consolidate.md      # read old sessions → extract patterns → update MEMORY.md → archive
├── add-vault.md        # write vault alias to settings.json
└── switch-vault.md     # update active vault in settings.json
```

Each skill reads the active vault path from `.claude/settings.json`, uses MCP tools for all vault I/O, and calls the Claude API for processing steps.

---

### Obsidian MCP tools used

| MCP tool | Used for |
|---|---|
| `mcp__obsidian__write_note` | Save processed sessions, documents, notes |
| `mcp__obsidian__read_note` | Read MEMORY.md, INDEX.md, any note |
| `mcp__obsidian__read_multiple_notes` | Batch-read matched files during recall |
| `mcp__obsidian__search_notes` | Full-text fallback search inside `/recall` |
| `mcp__obsidian__patch_note` | Append to INDEX.md, update MEMORY.md entries |
| `mcp__obsidian__get_frontmatter` | Read note metadata without loading full content |
| `mcp__obsidian__update_frontmatter` | Update `related`, `status`, `summary` fields |
| `mcp__obsidian__move_note` | Archive sessions (`sessions/` → `sessions/archive/`) |
| `mcp__obsidian__list_directory` | Scan vault folders during `/index` rebuild |

---

### Processing model

All processing is done by the **current running session** — the same Claude instance the user is already talking to. Skills are Markdown instruction files that tell Claude what to do using the tools already available in the session (MCP, Read, Write, Bash).

No separate API calls, no model selection, no prompt caching setup. The session that invoked the skill does the work.

```text
User runs /ingest file.pdf
    │
    ▼
Claude reads the skill file (.claude/commands/ingest.md)
    │
    ▼
Claude executes the instructions using session tools:
  - mcp__obsidian__* for vault I/O
  - Read/Write for local files
  - Bash for any shell ops (e.g. detecting new files in originals/)
    │
    ▼
Result written back to vault via MCP
```

This means processing quality scales with whatever model is running the session — no separate infrastructure needed.

---

### Hooks (`.claude/settings.json`)

```json
{
  "hooks": {
    "stop": [
      {
        "command": "echo 'Session ended. Run /save-session to save to memory.'"
      }
    ],
    "post-tool-use": [
      {
        "matcher": "Bash",
        "command": "bash .claude/scripts/watch-originals.sh"
      }
    ]
  }
}
```

`watch-originals.sh` checks if any new file appeared in `documents/originals/` since the last run. If yes, it prints a message prompting the user to confirm auto-processing. The actual ingestion runs via the `ingest` skill — the hook only detects and prompts.

---

### Settings.json structure

```json
{
  "vaults": {
    "root": "/absolute/path/to/brain",
    "active": "/absolute/path/to/brain/projects/project-alpha",
    "aliases": {
      "global": "/absolute/path/to/brain/_global",
      "project-alpha": "/absolute/path/to/brain/projects/project-alpha",
      "project-beta": "/absolute/path/to/brain/projects/project-beta"
    }
  }
}
```

`root` points to the single `brain/` vault folder — used by MCP and by commands that operate across all workspaces. `active` points to the currently selected project workspace. Skills always resolve `active` at runtime, so switching via `/switch-vault` is a single field update — no paths are hardcoded in skill files.

---

### Key file formats

**`_index/INDEX.md`** — one line per note, built from `summary` frontmatter fields:

```markdown
---
id: index
type: index
vault: project-alpha
updated: YYYY-MM-DD
---

## Sessions
- [[sessions/2026-05-15-auth-refactor]] — Refactored auth to JWT; dropped session tokens
- [[sessions/2026-05-14-db-schema]] — Designed user table; open question on index strategy

## Documents
- [[documents/processed/2026-05-10-react-patterns]] — React patterns; key: composition over inheritance

## Notes
- [[notes/2026-05-12-deploy-checklist]] — Prod deployment checklist with rollback steps

## Context blocks
- [[memory/context/architecture]] — Detailed system architecture decisions
```

**`memory/MEMORY.md`** — reconstruction instructions, pointers only:

```markdown
---
id: memory
type: memory
vault: project-alpha
updated: YYYY-MM-DD
global: "brain/_global"
---

## Project
Claude Brain — AI memory system using Obsidian vaults.

## State
Spec complete. Implementation starting.

## Key decisions
- Manual recall only (token efficiency)
- Per-vault INDEX.md and MEMORY.md
- MEMORY.md hard limit 1 500 tokens

## Open questions
- Concurrent vault access handling

## Load if needed
→ [[context/architecture]] — detailed design decisions
→ [[context/api-integration]] — Claude API usage patterns
```

---

### Processing flow per skill

**`/ingest <file|url>`:**

1. Read or fetch the source → store in `documents/originals/`
2. Summarize, extract key facts, entities, topics (current session)
3. Compare against INDEX.md summaries to find related notes (current session)
4. Write processed note to `documents/processed/` with full frontmatter via MCP
5. Patch `_index/INDEX.md` with new entry via `mcp__obsidian__patch_note`
6. Check `MEMORY.md` token count; if overflow, move oldest pointer to `memory/context/`

**`/save-session`:**

1. Summarize current conversation: goal, key decisions, outcomes, open questions (current session — already in context)
2. Compare against INDEX.md to find related notes
3. Write session note to `sessions/YYYY-MM-DD-<title>.md` via MCP
4. Patch INDEX.md and check MEMORY.md overflow

**`/recall <query>`:**

1. Read `_index/INDEX.md` via MCP (Tier 1)
2. Score each index entry against the query (current session)
3. Read top-N matched files via `mcp__obsidian__read_multiple_notes` (Tier 2–3)
4. Return matched content + list of `related[]` names (not loaded)

**`/consolidate`:**

1. List sessions older than 90 days not referenced in the last 30 days
2. Read them in batches via `mcp__obsidian__read_multiple_notes`
3. Extract recurring patterns and decisions across all sessions (current session)
4. Update `MEMORY.md` with extracted schemas; replace episode entries
5. Move raw session files to `sessions/archive/` via `mcp__obsidian__move_note`
6. Update INDEX.md entries with condensed summaries

---

## Design Principles

- **Atomic notes** — one concept per file, dense links between them
- **Token efficiency** — only Tier 0 loads automatically; everything else is pulled on demand
- **Hard size limits** — `MEMORY.md` ≤ 1 500 tokens, enforced by auto-compression
- **No duplication** — originals stored once; processed notes reference them
- **Vault isolation** — each vault is self-contained; cross-vault links are explicit and aliased
- **Human-readable** — all files are plain Markdown, usable without AI tooling
- **Progressive disclosure** — broad context first (index), detail only when needed
- **Reconstruction, not retrieval** — context is rebuilt from pointers, not dumped from storage
- **Significance filter** — not everything is saved; saving is an act of curation, not logging
- **Associative traversal** — recall surfaces links, not just matches; the user drives depth
