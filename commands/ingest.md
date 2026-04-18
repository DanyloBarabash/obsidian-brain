Add an external document to the Obsidian vault and link it to existing notes.

## Steps

1. Check the argument provided by the user:
   - **URL** (starts with `http://` or `https://`): fetch the page content.
   - **Local file path**: read the file from the filesystem. Supported: `.pdf`, `.txt`, `.md`, `.html`.
   - **No argument**: use the MCP obsidian tool to list all files in `Inbox/`. If the inbox is empty, tell the user and stop. If files are found, process each one in sequence using the steps below.

2. For each document:
   a. Extract: title, source (URL or original filename), document type (article / paper / docs / book / other).
   b. Summarize: 3–6 bullet points capturing the core ideas.
   c. Write a "Що релевантно для мене" section: infer from vault context what parts are most applicable to the user's projects or notes.
   d. Extract 3–5 key quotes (verbatim, with enough context to be meaningful).

3. Use the MCP obsidian tool to search the vault for related notes (search by key terms from the document). Propose links with one-line explanations and confidence levels (high / medium / low).

4. Show a preview before writing:

```
Ready to ingest: {title}

File: Resources/{YYYY-MM-DD}-{slug}.md
Tags: #resource + {up to 3 topic tags}

Proposed links:
  [1] {path} — {reason}  ({confidence})
  [2] ...

Accept all [enter] or remove links [type numbers to skip]:
```

Wait for user input. Remove any rejected links.

5. Build the resource file:

```markdown
---
source: {URL or filename}
type: {article | paper | docs | book | other}
date-added: {YYYY-MM-DD}
tags: [#resource, {topic tags}]
---

# {Title}

## Суть
{bullet points summary}

## Що релевантно для мене
{bullet points — project-specific applicability}

## Key quotes
> {quote 1}

> {quote 2}

## Links
{markdown links to confirmed related notes}

---
## Full content
{full extracted text of the document}
```

6. Use the MCP obsidian tool to write the file to `Resources/`.

7. If the source was a local file from `Inbox/`, use the MCP obsidian tool to move it to `Resources/originals/`.

8. For each confirmed link, read the target note, append a backlink under its `## Links` section:
   `- [[Resources/{resource-filename}]] — {one-line context}`
   Write the updated note back.

9. Confirm: "Ingested: Resources/{filename}. Backlinks added to {N} notes."
   If processing multiple inbox files, print a summary line for each.
