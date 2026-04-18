Save the current Claude Code session to the Obsidian vault.

## Steps

1. Analyze the full conversation to extract:
   - Main topic (2–4 words, kebab-case, for use in filename)
   - Project name (if `/resume` was used earlier, use that project; otherwise infer from context)
   - Decisions made (architectural, design, or process choices)
   - Solutions and fixes (bugs fixed, approaches that worked)
   - Files modified (list with brief description of change)
   - Open tasks (things explicitly left for later)
   - Key learnings (non-obvious insights worth keeping)

2. Determine tags: always include `#session`; add `#{project-name}` if known; add up to 3 topic tags derived from the main subjects discussed.

3. Use the MCP obsidian tool to search the vault for notes that are semantically related to this session's content. Propose up to 5 links with a one-line explanation and confidence level (high / medium / low).

4. Show a preview before writing anything:

```
Ready to save session to Obsidian:

File: Claude-Sessions/{YYYY-MM-DD}-{topic}.md
Tags: {tags}

Links to propose:
  [1] {path} — {reason}  ({confidence})
  [2] ...

Accept all [enter], remove links [type numbers to skip, comma-separated], or edit topic [t]:
```

Wait for user input. If they type numbers (e.g. `1,3`), remove those links from the list. If they type `t`, ask for a new topic name and regenerate the filename. If they press enter (or type nothing), proceed with all links.

5. Build the session file content:

```markdown
---
date: {YYYY-MM-DD HH:MM}
project: {project-name or ""}
tags: [{tags}]
---

# Session: {topic}

## Quick summary
{2–4 sentences: what was attempted, what was achieved}

## Decisions made
{bullet list — each item: decision + brief rationale}

## Solutions & fixes
{bullet list — each item: problem → solution}

## Files modified
{bullet list — path: what changed}

## Open tasks
{bullet list}

## Key learnings
{bullet list — non-obvious insights only}

## Links
{markdown links to confirmed related notes}

---
## Raw session log
{full conversation text, condensed: remove filler, keep all technical content}
```

6. Use the MCP obsidian tool to write the file to `Claude-Sessions/`.

7. For each confirmed link, use the MCP obsidian tool to read the target note, append a backlink line under its `## Links` section (or create that section if absent):
   `- [[Claude-Sessions/{session-filename}]] — {one-line context}`
   Then write the updated note back.

8. Confirm: "Saved to Claude-Sessions/{filename}. Backlinks added to {N} notes."
