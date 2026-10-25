Extract patterns from old sessions, update core memory, and archive processed sessions.

Usage:
  /consolidate          — consolidate active project sessions
  /consolidate global   — consolidate global memory sessions

This is a heavy operation. Run it periodically, not every session.

## Steps

### 1. Setup

Read `~/.claude/settings.json`; a project `.claude/settings.json` with a non-empty `vaults.root` overrides it.
Extract `vaults.root` and `vaults.active`.

If `vaults.root` is empty, stop: "No root vault configured."

If $ARGUMENTS is "global":
  target = `{vaults.root}/_global`
  label  = "global"
Else:
  If `vaults.active` is empty, stop: "No active project."
  target = `{vaults.active}`
  label  = project name

Get today's date. Calculate cutoff: 90 days ago.

### 2. Find sessions to consolidate

```bash
find "{target}/sessions" -maxdepth 1 -name "*.md"
```

For each file, read its `date:` frontmatter.
Filter to files whose date is older than the cutoff.

If none: "No sessions older than 90 days in {label}. Nothing to consolidate." and stop.

Show the list and ask: "Consolidate these {N} sessions? (yes/no)"
Wait for confirmation.

### 3. Read all candidate sessions

Read each session file with the Read tool.
For large sets (> 10 files), read in batches of 5 and accumulate findings.

### 4. Extract patterns

Analyze the full set and identify:

**Recurring decisions** — the same type of decision made more than once.

**Stable facts** — things stated as true across sessions without contradiction.

**Repeated open questions** — unresolved questions appearing in multiple sessions.

**Resolved topics** — questions that were open earlier but resolved in later sessions.

### 5. Read current hub file

For global: read `{vaults.root}/global.md`.
For project: read `{vaults.active}.md`.
Count approximate tokens: characters ÷ 4.

### 6. Propose hub memory updates

Show the user a proposal:

```
Proposed changes to {label} hub file:

ADD to Key decisions:
  - {pattern 1}

ADD to Open questions:
  - {repeated question}

REMOVE (superseded):
  - {old episode-level entry}

Resulting size: ~{N} tokens (limit: 1 500)
```

Ask: "Apply? (yes / no / edit)"

- **yes** → apply
- **no** → skip
- **edit** → show full proposed text for user to modify before writing

If the proposed result exceeds 1 500 tokens, move lowest-priority entries to
`{target}/memory/context/{topic}.md` and replace with:
`→ [[context/{topic}]] — one line description`

### 7. Apply changes (if confirmed)

For global: write `{vaults.root}/global.md` with the Write tool.
For project: write `{vaults.active}.md` with the Write tool.
Write any new context block files.
Update the hub file with new context block entries.

### 8. Archive sessions

For each consolidated session:

a. Reduce to 3–5 lines: goal + key decision + outcome.
b. Write to `{target}/sessions/archive/{filename}` with the Write tool.
c. Delete original: `rm "{target}/sessions/{filename}"`
d. Update the hub file entry: prefix with `[archived]`, replace summary.

### 9. Confirm

"Consolidated {N} sessions in {label}.
Hub: {N} patterns added, {N} entries moved to context/.
Archived: {slugs}"
