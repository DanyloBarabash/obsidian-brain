Load core memory into the current session.

Usage:
  /memory           — load active project MEMORY.md
  /memory global    — load global memory MEMORY.md

## Steps

### 1. Setup

Read `~/.claude/settings.json`; a project `.claude/settings.json` with a non-empty `vaults.root` overrides it.
Extract `vaults.root` and `vaults.active`.

If `vaults.root` is empty, stop:
"No vault configured. Run /add-vault --root <path> to initialize."

### 2. Determine what to load

If $ARGUMENTS is "global":
  Path: `{vaults.root}/global.md`
  Heading: "Global memory loaded"
Else:
  If `vaults.active` is empty, stop:
  "No active project. Run /add-vault <name> to create one, or /switch-vault <name>."
  Get project name (last path segment of `vaults.active`).
  Path: `{vaults.active}.md`
  Read its `class` frontmatter field, then also read `{vaults.root}/classes/{class}.md`.
  Heading: "Project memory loaded ({project-name})"

### 3. Read and present

Read the file at the resolved path.
For project memory, present the class hub first as compact routing context, then the full project hub.
For global memory, present the full global hub.

### 4. Offer global memory if not already loaded

Only when loading project memory (not global):
Read the first line of `{vaults.root}/global.md` to check if it has content.
If it does, tell the user:
"Global memory available. Run /memory global to load it."
