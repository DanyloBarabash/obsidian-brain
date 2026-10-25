Save the current Claude session to the active project vault.

Usage: /save-session

The current conversation is already in your context — no need to read it from anywhere.

## Steps

### 1. Setup

Read `~/.claude/settings.json`; a project `.claude/settings.json` with a non-empty `vaults.root` overrides it.
Extract `vaults.root` and `vaults.active`.

If `vaults.root` is empty, stop: "No root vault configured. Run /add-vault --root <path> first."
If `vaults.active` is empty, stop: "No active project. Run /add-vault <name> or /switch-vault <name>."

Get the project name (last path segment of `vaults.active`).
Get `{project-rel}`: `vaults.active` relative to `vaults.root` (e.g. `projects/client/sdk`).
Get today's date in YYYY-MM-DD format.

### 2. Generate a title

Look at what this session actually worked on.
Create a short kebab-case slug, 3–5 words max.
Examples: `auth-middleware-refactor`, `db-schema-design`, `recall-strategy-spec`

### 3. Summarize the session

Read the conversation from your context and extract:

**Goal** — what the session was trying to accomplish. One sentence.

**Key decisions** — what was explicitly decided, chosen, or agreed on.
Only decisions, not activity. Bullet points.

**Outcomes** — what was concretely produced: code written, files created, problems solved.
Bullet points.

**Open questions** — what is still unresolved or deferred.
Omit this section if nothing is open.

### 4. Find related notes

Read `{vaults.active}.md` and `{vaults.root}/global.md`.
Compare session topics and decisions against existing entries.
Pick the 3–5 most topically related notes as wikilinks relative to vault root.
Use `[[projects/...]]` for project notes and `[[_global/...]]` for global notes.

### 5. Write the session note

Path: `{vaults.active}/sessions/{project-name}-{date}-{slug}.md`

```markdown
---
id: {project-name}/sessions/{project-name}-{date}-{slug}
type: session
date: {date}
project: {project-name}
tags: [{topics as kebab-case tags}]
status: active
related:
  - "[[{project-rel}/sessions/{related-note-slug}]]"
summary: "{one sentence summary of what was accomplished}"
---

## Goal

{goal}

## Key Decisions

{bullet points}

## Outcomes

{bullet points}

## Open Questions

{bullet points — omit section if none}
```

### 6. Update the project hub

Read `{vaults.active}.md`.
Append under `## Sessions`:
`- [[{project-rel}/sessions/{project-name}-{date}-{slug}]] — {summary}`
Write it back.

### 7. Check for memory update

Read `{vaults.active}.md`.

If any key decision from this session is architectural or directional and is not already
in the hub file memory section, tell the user:

"Key decision to consider adding to core memory:
  {decision}
Edit {vaults.active}.md directly, or run /memory to review."

Do not automatically edit the hub memory section.

### 8. Confirm

"Session saved: {project-rel}/sessions/{project-name}-{date}-{slug}.md
{N} decisions · {N} outcomes
Index updated."
