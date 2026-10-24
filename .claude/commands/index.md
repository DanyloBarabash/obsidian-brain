Rebuild the hub file for the active project or for global memory.

Usage:
  /index            — rebuild hub file for the active project
  /index global     — rebuild global hub file

## Steps

### 1. Setup

Read `~/.claude/settings.json`; a project `.claude/settings.json` with a non-empty `vaults.root` overrides it.
Extract `vaults.root` and `vaults.active`.

If `vaults.root` is empty, stop: "No root vault configured."

If $ARGUMENTS is "global":
  target = `{vaults.root}/_global`
  label  = "global"
Else:
  If `vaults.active` is empty, stop: "No active project. Run /switch-vault first."
  target = `{vaults.active}`
  label  = project name (last path segment of `vaults.active`)
  project-rel = `vaults.active` relative to `vaults.root` (e.g. `projects/client/sdk`)

Get today's date in YYYY-MM-DD format.

### 2. Scan vault files

List files in these locations under `{target}`:

```bash
find "{target}/sessions"            -maxdepth 1 -name "*.md"
find "{target}/sessions/archive"    -maxdepth 1 -name "*.md"
find "{target}/documents/processed" -maxdepth 1 -name "*.md"
find "{target}/notes"               -maxdepth 1 -name "*.md"
find "{target}/memory/context"      -maxdepth 1 -name "*.md"
```

Skip files named `.gitkeep` or starting with `_` or `.`.

If rebuilding global (`label == "global"`), also scan projects:

```bash
find "{vaults.root}/classes" -maxdepth 1 -name "*.md"
find "{vaults.root}/projects" -maxdepth 1 -name "*.md"
```

Collect class files for the global `## Classes` section. Read every top-level project hub's
`class` field only to verify that it appears in exactly one matching class hub; do not create a
direct global project index.

### 3. Read frontmatter from each file

For each file, read only the frontmatter block (lines between the first `---` pair).
Extract: `id`, `type`, `summary`, `status`, `related`.

`id` is in the format `{project-name}/{type}/{date}-{slug}` — use it as-is.
`related` is a YAML list of `"[[wikilink]]"` strings — preserve them verbatim.

If a file has no `summary`, use the first non-empty body line as fallback
and tag the entry `[no frontmatter]`.

### 4. Build INDEX.md content

Group entries by type in this order:
1. Sessions (`type: session`, `status: active`)
2. Documents (`type: document`)
3. Notes (`type: note`)
4. Context blocks (`type: context`, from `memory/context/`)
5. Archived (`status: archived`, or from `sessions/archive/`)

Format each entry as a wikilink relative to the vault root:

For project content entries:
`- [[{project-rel}/{relative-path}]] — {summary}`

For global entries:
`- [[_global/{relative-path}]] — {summary}`

For class entries in global:
`- [[classes/{class-id}]] — {scope summary}`

Prefix archived entries with `[archived]`.

### 5. Write the new hub file

For global: write to `{vaults.root}/global.md`.
For project: write to `{vaults.active}.md`.

Update only the Sessions, Documents, Notes, Context blocks, and Archived sections below
the `---` divider. Preserve all memory content above the `---` divider unchanged.

If the hub file does not yet have a `---` divider, append it before writing the index sections.

The index sections use this format:

```markdown
---

## Classes

{class entries — global only; omit section for project hubs}

## Sessions

{entries}

## Documents

{entries}

## Notes

{entries}

## Context blocks

{entries}

## Archived

{entries}
```

Include all section headings even if empty.

### 6. Update overview.canvas (global only)

Only when `label == "global"`:

Read `{vaults.root}/overview.canvas` (JSON).
For each class found in step 2, ensure a node with `file` matching `classes/{class-id}.md`
and an edge `global hub → class hub` exist. For each top-level project, read its `class`
frontmatter field and ensure the edge is `class hub → project hub`. Never add a direct
`global → project` edge. Preserve existing project-specific colors and class grouping.
Write the updated canvas back.

### 7. Confirm

"Index rebuilt: {label}
  Classes:   {N for global, otherwise 0}
  Sessions:  {N}
  Documents: {N}
  Notes:     {N}
  Context:   {N}
  Archived:  {N}"
