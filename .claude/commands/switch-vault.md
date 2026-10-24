Switch the active project vault.

Usage: /switch-vault <project-name|path>

## Steps

### 1. Read settings.json

Read `~/.claude/settings.json`; a project `.claude/settings.json` with a non-empty `vaults.root` overrides it.
Extract `vaults.root`, `vaults.active`, `vaults.aliases`.

If `vaults.root` is empty, stop:
"No root vault configured. Run /add-vault --root <path> first."

### 2. Resolve the target project

$ARGUMENTS can be:
- A project name (key in `vaults.aliases`) → resolve to its path
- A relative name → check `{vaults.root}/projects/{name}`
- An absolute path → use as-is

If nothing matches, list available projects:

```bash
ls {vaults.root}/projects/
```

Stop: "Project '{input}' not found. Available: {list}"

### 3. Verify the project

Check that the hub file `{path}.md` exists next to the project directory.

If it is missing, warn but continue:
"Warning: project at {path} has no hub file {path}.md. Run /index to rebuild."

### 4. Check if already active

If `vaults.active` already equals the target path:
"Already active: {name} ({path})" and stop.

### 5. Update settings.json

Set `vaults.active` to the resolved path.
Write settings.json.

### 6. Confirm

"Switched to: {project-name} ({path})

Run /memory to load core memory for this project."
