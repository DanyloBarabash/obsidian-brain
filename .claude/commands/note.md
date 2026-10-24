Save a quick note to the active project vault.

Usage: /note <text>

$ARGUMENTS is the full note content — a sentence or several paragraphs.

## Steps

### 1. Setup

Read `~/.claude/settings.json`; a project `.claude/settings.json` with a non-empty `vaults.root` overrides it.
Extract `vaults.root` and `vaults.active`.

If `vaults.root` is empty, stop: "No root vault configured."
If `vaults.active` is empty, stop: "No active project. Run /switch-vault <name>."

Get the project name (last path segment of `vaults.active`).
Get `{project-rel}`: `vaults.active` relative to `vaults.root` (e.g. `projects/client/sdk`).
Get today's date in YYYY-MM-DD format.

### 2. Process the input

a. Write a 1-sentence summary for the `summary` field.
b. Condense the content: remove filler, keep the factual or actionable core.
   If the input is already concise (< 100 words), keep it as-is.
c. Extract 2–5 lowercase kebab-case tags.
d. Build a slug: 3–4 most distinctive words, lowercase, hyphens.

### 3. Find related notes

Read `{vaults.active}.md` and `{vaults.root}/global.md`.
Compare summary and tags against existing entries.
Pick the top 3 most related notes as wikilinks relative to vault root.

### 4. Write the note

Path: `{vaults.active}/notes/{project-name}-{date}-{slug}.md`

```markdown
---
id: {project-name}/notes/{project-name}-{date}-{slug}
type: note
date: {date}
project: {project-name}
tags: [{tags}]
status: active
related:
  - "[[{project-rel}/notes/{related-note-slug}]]"
summary: "{summary}"
---

{condensed content}
```

### 5. Update the hub

Read `{vaults.active}.md`.
Append under `## Notes`:
`- [[{project-rel}/notes/{project-name}-{date}-{slug}]] — {summary}`
Write it back.

### 6. Confirm

"Note saved: {project-rel}/notes/{project-name}-{date}-{slug}.md"
