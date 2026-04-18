Load project context from Obsidian vault at the start of a session.

## Steps

1. The user may pass a project name as argument: `/resume project-name`. If no argument is given, use the MCP obsidian tool to list all folders inside `Projects/`, display them as a numbered list, and ask the user which one to load. Wait for their reply before continuing.

2. Once you have the project name, use the MCP obsidian tool to read these files from the vault (skip any that don't exist):
   - `Projects/{project-name}/README.md`
   - `Projects/{project-name}/decisions.md`

3. Use the MCP obsidian tool to search for notes tagged with the project name in `Claude-Sessions/`. Retrieve the 3 most recent session files (sorted by date in filename). Read only their front-matter and everything up to (but not including) the `## Raw session log` heading.

4. Use the MCP obsidian tool to search `Resources/` for notes whose tags or links match the project. Read only the `## Суть` and `## Що релевантно для мене` sections of up to 3 most relevant files.

5. Output a structured summary in this exact format:

```
## Context loaded: {project-name}

### Stack & goal
{1–3 sentences from README}

### Open decisions
{bullet list from decisions.md — unresolved items only}

### Last 3 sessions
- {date} — {title}: {one-line summary}
- ...

### Relevant resources
- {title} — {one-line relevance note}
- ...

### Suggested next steps
{1–3 actionable items inferred from open tasks and last sessions}
```

6. After the summary, say: "Context loaded. What are we working on today?"
