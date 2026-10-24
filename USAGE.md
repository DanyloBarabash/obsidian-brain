# Claude Brain — Usage Guide

---

## How it works

Claude Brain stores everything as plain Markdown files in a single folder called the **brain vault**.
Claude Code skills read and write those files directly using standard file tools.

Obsidian is optional — it is just a viewer for the same folder.
Open the `brain/` root in Obsidian and you get graph view, backlinks, and search on top
of everything Claude Brain writes. Nothing special to configure — it just works because
both tools use the same files.

```text
brain/  (plain Markdown files, single Obsidian vault)
├── Claude Brain reads/writes here via skills
└── Obsidian opens brain/ as a vault — sees everything
```

You do not need Obsidian running for Claude Brain to work.
You do not need Claude Brain running for Obsidian to work.
They coexist on the same files.

---

## Installation

```bash
git clone <repo>
cd obsidian-brain

# Install globally + initialize the root brain vault
./install.sh --vault ~/brain
```

**Flags:**

| Flag | Description |
|---|---|
| `--vault <path>` | Initialize the root brain vault at this path and register it |
| `--local` | Install commands to `./.claude/commands/` instead of `~/.claude/commands/` |
| `--force` | Overwrite existing command files |

The `--vault` flag creates the root `brain/` folder (or whatever path you choose) and writes
the `vaults.root` entry in `.claude/settings.json`. There is no `--type global` flag —
the single vault contains both global memory and all projects.

After install, open a Claude Code session in any project — all commands are available.

---

## Opening the vault in Obsidian

1. Open Obsidian
2. **Open folder as vault** → select the root brain path (e.g. `~/brain`)
3. Done — Obsidian shows all notes, graph, and backlinks immediately

Because everything lives inside one vault root, backlinks work across global and project notes,
the graph view shows the full picture, and MCP is configured once for `brain/`.

Every time Claude Brain writes a note, it appears in Obsidian automatically.
No plugins or sync required for basic use.

---

## Quick Start

```text
1. Initialize root vault  →  /add-vault --root ~/brain
2. Create first project   →  /add-vault my-project
3. Load core memory       →  /memory
4. Work on your project
5. Save the session       →  /save-session
6. Next session: start from step 3
```

---

## Commands

### `/memory`

Load the active project's core memory into the current session.

```text
/memory           — load active project MEMORY.md (Tier 0, ≤ 1 500 tokens)
/memory global    — load the global _global/memory/MEMORY.md
```

Run this at the start of every session to restore context.

---

### `/save-session`

Summarize and save the current session to the vault.

```text
/save-session
```

Claude reads the current conversation from context and extracts:

- **Goal** — what the session set out to do
- **Key decisions** — explicit decisions only, not activity
- **Outcomes** — what was produced or solved
- **Open questions** — what is still unresolved

Saves to `projects/<name>/sessions/YYYY-MM-DD-<title>.md` and updates the index.
If any decision seems significant, you are prompted to add it to `MEMORY.md` — you decide.

The Stop hook reminds you once per day if you haven't saved yet.

---

### `/recall <query>`

Search the vault and load relevant notes into context.

```text
/recall authentication flow
/recall what we decided about the database schema
/recall react state management
```

How it works:

1. Reads the active project's `_index/INDEX.md` — cheap scan, discarded after scoring
2. Also reads `_global/_index/INDEX.md` — project results ranked first
3. Scores entries against your query
4. Loads top matches into context
5. Shows names of linked notes without loading them

You then decide whether to go deeper:

```text
/recall <linked note title>
```

---

### `/ingest <file|url>`

Add an external document to the vault.

```text
/ingest ~/Downloads/architecture.pdf
/ingest https://docs.example.com/api-reference
/ingest ./meeting-notes.md
```

What happens:

1. File is copied to `documents/originals/` inside the active project (URL content saved there too)
2. Claude summarizes it, extracts key facts, entities, and tags
3. Links it to related existing notes
4. Writes a processed note to `documents/processed/`
5. Updates the index

**Auto-detection:** drop a file into `documents/originals/` directly — the Stop hook
will notice and remind you to run `/ingest` on it.

---

### `/note <text>`

Save a quick note mid-session.

```text
/note use postgres jsonb for flexible schema instead of separate tables
/note team decided: no feature flags — ship or don't ship
/note good CRDT resource: https://crdt.tech
```

The note is summarized, tagged, linked to related content, and saved to `notes/`.
Useful for capturing things without running a full `/save-session`.

---

### `/add-vault --root <path>`

Initialize the root brain vault (first-time setup only).

```text
/add-vault --root ~/brain
```

Creates the `brain/` folder, writes the `_global/` sub-structure, and registers `vaults.root`
in `.claude/settings.json`. Run this once after installation.

---

### `/add-vault <project-name>`

Create a new project workspace inside the root vault.

```text
/add-vault my-app
/add-vault project-x
```

Creates `brain/projects/<project-name>/` with the full internal structure and registers it
in `vaults.aliases`. If no active project is set, the new one becomes active automatically.

---

### `/switch-vault <name>`

Switch the active project workspace for this session.

```text
/switch-vault my-app
/switch-vault global
/switch-vault project-x
```

Updates `vaults.active` in `settings.json`.
After switching, run `/memory` to load the new project's context.

---

### `/index`

Rebuild `_index/INDEX.md` from scratch by scanning all vault files.

```text
/index          — rebuild index for active project
/index global   — rebuild index for _global/
```

Use this when:

- You cloned the vault and the index is missing
- You edited notes manually and the index is out of sync
- `/recall` is returning unexpected results

Reads only frontmatter from each file — fast even on large vaults.

---

### `/consolidate`

Extract patterns from old sessions, update core memory, archive processed sessions.

```text
/consolidate          — consolidate active project sessions
/consolidate global   — consolidate _global/ sessions
```

What it does:

1. Finds sessions older than 90 days
2. Shows the list — asks for confirmation before proceeding
3. Extracts recurring decisions, stable facts, repeated open questions
4. Proposes changes to `MEMORY.md` — you approve before anything is written
5. Archives originals (replaces each with a 3–5 line summary)

Run monthly, or when `MEMORY.md` is getting stale.

---

## Common Workflows

### First-time setup

```bash
/add-vault --root ~/brain
/add-vault my-first-project
/memory
```

Open `~/brain` in Obsidian to browse everything visually.

---

### Starting a new project

```text
/add-vault my-app
/memory
```

Work. At the end of the session:

```text
/save-session
```

---

### Picking up where you left off

```text
/memory
```

Read the output. If you need more context on a specific topic:

```text
/recall <topic you were working on>
```

---

### Adding reference material

```text
/ingest ~/Downloads/api-spec.pdf
/ingest https://docs.lib.dev/getting-started
```

---

### Loading global memory alongside project memory

```text
/memory global    ← loads _global/memory/MEMORY.md
```

Recall always searches both project and global indexes automatically — no extra step needed.

```text
/recall authentication    ← returns project + global results, project ranked first
```

---

### Keeping MEMORY.md lean

`MEMORY.md` has a hard limit of 1 500 tokens. When it is getting full, run:

```text
/consolidate
```

Or manually: open `memory/MEMORY.md` in Obsidian or any editor,
move detailed entries to `memory/context/<topic>.md`,
and replace them with a pointer line:

```text
→ [[context/topic]] — one line description
```

---

## Example Use Cases

---

### Use case 1: Solo developer across multiple projects

You work on several codebases. Each has its own project vault. Things like auth patterns,
preferred libraries, and architecture decisions live in global memory — available everywhere.

```text
# First time
/add-vault --root ~/brain
/add-vault backend-api
/add-vault mobile-app
```

Working on the API:

```text
/switch-vault backend-api
/memory
/recall jwt authentication
```

You find a relevant note from the mobile-app project in the global results.
You add a cross-project decision:

```text
/note use RS256 for JWT signing across all services — decided 2026-05-17
```

Because `/note` searches both indexes, it links automatically to the auth notes
in both projects. The note lands in `brain/projects/backend-api/notes/` and
appears in Obsidian's graph connected to everything related.

At the end of the day:

```text
/save-session
```

---

### Use case 2: Ingesting documentation and research

You are evaluating a new database and collect several resources.

```text
/ingest ~/Downloads/postgres-jsonb-guide.pdf
/ingest https://www.timescale.com/blog/timescaledb-vs-postgres
/ingest ~/Downloads/db-benchmark-results.csv
```

Each document is summarized, tagged, and linked to existing notes.
The index is updated automatically. You can now search across all of them:

```text
/recall query performance benchmarks
```

Claude loads the matched processed notes — not the raw PDFs — and shows
which other notes they link to. You find that the jsonb guide connects to
a session from last week where you discussed schema design.

You then open `brain/` in Obsidian and use the graph view to see all three
documents connected to each other and to your schema session.

---

### Use case 3: Resuming a complex task after a week away

You return to a project after a week. You remember working on something with
caching but not the details.

```text
/memory
```

`MEMORY.md` shows the project state and an open question about cache invalidation.
You need more detail:

```text
/recall cache invalidation strategy
```

Claude loads the session note from last week plus a linked document about Redis patterns.
It also surfaces two related notes you hadn't thought of. You pick up exactly where you left off
without re-explaining context.

---

### Use case 4: Capturing decisions mid-session

You are deep in a debugging session and realize you just made an important architectural call.
You don't want to lose it but don't want to stop and run `/save-session` yet.

```text
/note decided to move rate limiting to the API gateway layer — keeping services stateless
```

The note is saved immediately with links to related notes about the API gateway and stateless
service design. You continue working. When you eventually run `/save-session`, the note
already exists and gets linked from the session automatically.

---

### Use case 5: Monthly memory maintenance

After a month, your project vault has 25 sessions. `MEMORY.md` is getting stale.

```text
/consolidate
```

Claude lists 12 sessions older than 90 days and asks for confirmation.
After you confirm, it reads all of them and shows a proposal:

```
ADD to Key decisions:
  - Always use database migrations over ORM auto-sync (appeared in 4 sessions)
  - Feature flags rejected — ship or don't ship (appeared in 2 sessions)

ADD to Open questions:
  - Background job queue choice still unresolved (appeared in 3 sessions)

REMOVE (superseded):
  - "Considering whether to use migrations" — resolved

Resulting size: ~980 tokens (limit: 1 500)
```

You approve. The 12 sessions are archived to 3–5 line summaries.
`MEMORY.md` now reflects patterns and decisions, not episode logs.
The Obsidian graph stays clean — archived notes are still there but compressed.

---

### Use case 6: Global knowledge that spans all projects

You learn something universally useful — a shell pattern, a debugging technique,
a team convention. You want it available in every project.

```text
/switch-vault global       ← switches active to _global/
/note always check ulimit -n before debugging connection pool exhaustion
/switch-vault my-project   ← back to current work
```

The note lands in `brain/_global/notes/`. From now on, any `/recall` query across
any project that touches connection issues will surface this note — ranked lower than
project-specific results, but always available.

---

## Vault Layout

```text
brain/                        ← single Obsidian vault root
├── _global/                  ← global memory
│   ├── _index/
│   │   └── INDEX.md          ← global table of contents, rebuilt by /index global
│   ├── memory/
│   │   ├── MEMORY.md         ← global core memory (≤ 1 500 tokens)
│   │   └── context/          ← overflow detail blocks, loaded on demand
│   ├── sessions/
│   │   ├── *.md              ← sessions saved across projects
│   │   └── archive/          ← consolidated sessions from /consolidate global
│   ├── documents/
│   │   ├── originals/        ← raw files and URLs
│   │   └── processed/        ← summarized and linked notes
│   └── notes/                ← quick notes relevant to all projects
│
└── projects/
    ├── project-alpha/        ← project workspace (same internal structure as _global/)
    │   ├── _index/
    │   │   └── INDEX.md      ← project table of contents
    │   ├── memory/
    │   │   ├── MEMORY.md     ← project core memory (≤ 1 500 tokens)
    │   │   └── context/
    │   ├── sessions/
    │   │   └── archive/
    │   ├── documents/
    │   │   ├── originals/
    │   │   └── processed/
    │   └── notes/
    └── project-beta/
        └── ...
```

Open `brain/` in Obsidian — that is all the Obsidian setup required.

---

## settings.json Reference

Located at `.claude/settings.json` in your project:

```json
{
  "vaults": {
    "root": "/absolute/path/to/brain",
    "active": "/absolute/path/to/brain/projects/my-app",
    "aliases": {
      "global":    "/absolute/path/to/brain/_global",
      "my-app":    "/absolute/path/to/brain/projects/my-app",
      "project-x": "/absolute/path/to/brain/projects/project-x"
    }
  },
  "hooks": {
    "Stop": [
      { "command": "bash .claude/scripts/check-originals.sh" },
      { "command": "bash .claude/scripts/remind-save-session.sh" }
    ]
  }
}
```

`root` is the single `brain/` folder — used by MCP and by commands that operate across all
workspaces. All other paths are absolute. Use consistent paths across machines for portability.
