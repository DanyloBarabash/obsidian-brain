Search the vault memory and load relevant notes into this session.

Usage: /recall <query>

## Steps

### 1. Setup

Read `~/.claude/settings.json`; a project `.claude/settings.json` with a non-empty `vaults.root` overrides it.
Extract `vaults.root` and `vaults.active`.

If `vaults.root` is empty, stop: "No root vault configured. Run /add-vault --root <path> first."
If `vaults.active` is empty, stop: "No active project. Run /switch-vault <name> first."

### 2. Read indexes (Tier 1)

Read both hub files:

- Project hub: `{vaults.active}.md`
- Global hub:  `{vaults.root}/global.md`

### 3. Score entries against the query

For every entry in both indexes, score relevance to $ARGUMENTS:

- Exact word match in summary → high score
- Topic / concept overlap → medium score
- Tangential mention → low score

Select top 5 matches total. Project results rank above global results at equal score.

If no matches score above "tangential":
"Nothing relevant found for: {query}" and stop.

### 4. Resolve file paths

Wikilinks are relative to the vault root for both project and global matches:
  `{vaults.root}/{wikilink_path}.md`

### 5. Load matched notes (Tier 2–3)

Read each matched file with the Read tool.

If the total content of all matched files exceeds ~3 000 tokens, summarize each note
to its key facts instead of loading full text, and tell the user.

### 6. Collect first-layer links

For each matched note, extract its `related:` frontmatter field.
Collect all referenced paths into a flat deduplicated list.
Do NOT load these — only name them.

### 7. Present results

Output each matched note's content under a heading showing its relative path from vault root.
Prefix global results with `[global]`.

Then output:

```
---
Also linked (not loaded):
- path/to/related-note-1
- path/to/related-note-2

To go deeper: /recall <topic>
```
