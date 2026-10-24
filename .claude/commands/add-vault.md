Create a new project vault inside the root vault, or initialize the root vault itself.

Usage:
  /add-vault <project-name> --class <class-id> — create a classified project inside the root vault
  /add-vault --root <path>         — initialize a new root vault (first-time setup)

## Case A: Initialize root vault (--root)

### A1. Parse path from $ARGUMENTS (after --root flag)

Resolve `~` to the home directory via Bash: `echo <path>`

### A2. Check if path exists

If not: ask "Create root vault at {path}? (yes/no)"
  yes → `mkdir -p {path}`
  no  → stop

If yes and already has `_global/` subdirectory: warn "Root vault already initialized at {path}."
  Continue to registration step.

### A3. Copy vault-template

```bash
cp -r vault-template/. {path}/
```

### A4. Update settings.json

Set `vaults.root` to the resolved absolute path.
Set `vaults.active` to `{path}/projects` (no active project yet — user must create one).

Actually set `vaults.active` to empty string — no project is active yet.

Write settings.json.

### A5. Confirm

"Root vault initialized at {path}
Structure:
  {path}/_global/       ← global memory
  {path}/classes/       ← project classes and grouping rules
  {path}/projects/      ← project vaults go here

Open {path} in Obsidian as a vault.
Next: /add-vault <project-name> --class <class-id> to create your first project."

---

## Case B: Create a new project

### B1. Parse project name and classification from $ARGUMENTS

Sanitize: lowercase, replace spaces with hyphens, strip special chars.

Read `{vaults.root}/classes/*.md` and parse `--class <class-id>`.
If `--class` is missing, list the available classes and ask the user to choose one.
If the class file does not exist, ask whether to create a new class first. Do not create an unclassified project.

Resolve these project metadata fields from explicit arguments or the user's description; ask when they are genuinely ambiguous:
- `domain` — narrow product or subject area;
- `stage` — e.g. `discovery`, `prototype`, `active`, `operational`;
- `engagement` — `internal`, `client`, `education`, or `personal`.

### B2. Check root vault

Read `~/.claude/settings.json` (a project `.claude/settings.json` with a non-empty `vaults.root` overrides it), extract `vaults.root`.
If empty, stop: "No root vault configured. Run /add-vault --root <path> first."

Project path: `{vaults.root}/projects/{project-name}`

### B3. Check if project already exists

If `{project-path}` already exists, stop:
"Project '{project-name}' already exists at {project-path}."

### B4. Create hub file and content directories

Create the hub file at `{vaults.active}.md`:

```markdown
---
id: {project-name}
type: hub
project: {project-name}
class: {class-id}
domain: {domain-id}
stage: {lifecycle-stage}
engagement: {relationship}
updated: {today}
tags: [{project-name}, hub]
---

## Project

{project-name}

## State

## Key decisions

## Open questions

## Load if needed

---

## Sessions

## Documents

## Notes
```

Create the content directories:

```bash
mkdir -p "{project-path}/sessions"
mkdir -p "{project-path}/notes"
mkdir -p "{project-path}/documents/originals"
mkdir -p "{project-path}/documents/processed"
```

### B5. Update settings.json

Add to `vaults.aliases`: `"{project-name}": "{project-path}"`
Set `vaults.active` to `{project-path}`.

Write settings.json.

### B6. Register in class hub

Read `{vaults.root}/classes/{class-id}.md`.
Append under `## Projects`:
```
- [[projects/{project-name}]] — {project-name} project
```
Write it back.

Do not add a direct project link to `global.md`; global links to classes.

### B7. Confirm

"Project created: {project-name}
  Path: {project-path}
  Set as active project.
  Registered in class: {class-id}.

Run /memory to load core memory for this project."
