Process a file or URL and save it to the active project vault.

Usage: /ingest <file-path|url>

## Steps

### 1. Setup

Read `~/.claude/settings.json`; a project `.claude/settings.json` with a non-empty `vaults.root` overrides it.
Extract `vaults.root` and `vaults.active`.

If `vaults.root` is empty, stop: "No root vault configured. Run /add-vault --root <path> first."
If `vaults.active` is empty, stop: "No active project. Run /add-vault <name> or /switch-vault."

Get today's date in YYYY-MM-DD format.
Get the project name (last path segment of `vaults.active`).
Get `{project-rel}`: `vaults.active` relative to `vaults.root` (e.g. `projects/client/sdk`).

### 2. Determine input type from $ARGUMENTS

- Starts with `http://` or `https://` → URL
- Otherwise → local file path

### 3a. File input

Check the file exists. If not, stop with an error.

If the file is not already inside `{vaults.active}/documents/originals/`, copy it:

```bash
cp "$ARGUMENTS" "{vaults.active}/documents/originals/"
```

Read the file content with the Read tool.
For PDFs, extract text: `pdftotext "$ARGUMENTS" -`

### 3b. URL input

Fetch the page content.
Save raw text to `{vaults.active}/documents/originals/{date}-{domain-slug}.md`

### 4. Process the content

a. Write a 1–2 sentence summary for the `summary` frontmatter field.
b. Extract 5–10 key facts as bullet points.
c. Extract main concepts and entities as lowercase kebab-case tags.
d. Build the slug: filename or page title, lowercase, hyphens, no special chars.

### 5. Find related notes

Read `{vaults.active}.md` and `{vaults.root}/global.md`.
Compare summary and tags against existing entries.
Pick the top 3–5 most related notes as wikilinks relative to vault root.

### 6. Write the processed note

Path: `{vaults.active}/documents/processed/{project-name}-{date}-{slug}.md`

```markdown
---
id: {project-name}/documents/{project-name}-{date}-{slug}
type: document
date: {date}
project: {project-name}
tags: [{tags}]
status: active
related:
  - "[[{project-rel}/documents/processed/{related-note-slug}]]"
summary: "{summary}"
source: "{original file path or URL}"
---

## Summary

{2–3 sentence summary}

## Key Facts

{bullet points}

## Extracted Concepts

{bullet points}
```

### 7. Update the hub

Read `{vaults.active}.md`.
Append under `## Documents`:
`- [[{project-rel}/documents/processed/{project-name}-{date}-{slug}]] — {summary}`
Write it back.

### 8. Confirm

"Ingested: {filename or URL}
Processed: {project-rel}/documents/processed/{project-name}-{date}-{slug}.md
Related: {list of related note titles}"
