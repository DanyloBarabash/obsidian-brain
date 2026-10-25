---
name: obsidian-brain
description: Read, search, create, and update durable knowledge in the user's local Obsidian Brain. Use when the user asks to remember, save, recall, search, document, consolidate, or update project knowledge, or when substantial completed work produces durable project context worth preserving. Do not use for disposable logs, secrets, or unrelated file editing.
---

# Obsidian Brain

Work with the vault at `{{VAULT_ROOT}}` as the shared memory system for Codex, Claude Code, and other local agents.

## Recall context

1. Read `global.md` for the vault map and global rules.
2. Route through the matching hub under `classes/`; use its project list to confirm the broad classification.
3. Resolve the project from an explicit user name first, then the current working directory or repository name. Match it to a hub under `projects/`.
4. Read the matching project hub before deeper files. Follow its `Load if needed`, `Documents`, `Notes`, and recent `Sessions` links only as far as the current task requires.
5. Search with `rg` across Markdown files while excluding `.obsidian/` and `_global/templates/`. Prefer filenames, headings, frontmatter, and recent canonical notes over raw session history.
6. Report which vault notes materially informed the answer. Do not treat old session state as current when a newer hub or canonical note supersedes it.

If no project matches, search globally. Do not create a new project merely because a name resembles one.

## Save durable knowledge

- Create reports, separate artifacts, exports, presentations, visualizations, and session summaries only when the user explicitly asks. Do not create or open extra deliverables automatically after a task; give a brief result in chat. This does not prevent changes to the requested product or necessary updates to existing canonical rules and project knowledge.

Save only information that will improve a future task: confirmed decisions and rationale, verified fixes, current project state, stable architecture or contracts, reusable procedures, non-obvious lessons, and explicit open work. Do not store secrets, credentials, personal data, raw transcripts, speculative claims as facts, or large disposable outputs.

Before writing:

- Search for a canonical note covering the same topic.
- Prefer updating that note and its `updated` date over creating a duplicate.
- Re-check facts against the current task artifacts. Mark uncertainty or conflicts explicitly.
- Read [the vault schema](references/vault-schema.md) when creating a note, session, document, hub, or project mapping.

Write behavior:

- Use `apply_patch` for Markdown and `.base` edits.
- Preserve neighboring formatting, language, frontmatter keys, and the hub-and-spoke link direction.
- Create task history in `sessions/` only when explicitly requested; put durable topic knowledge in existing canonical `notes/` and maintained reference material in `documents/`.
- Use filenames in lowercase kebab-case. Session filenames are `<project>-YYYY-MM-DD-<topic>.md`.
- Classify every project/org hub with `class`, `domain`, `stage`, and `engagement`. Add a new top-level project to exactly one class hub; do not bypass the class level with a direct global project index.
- Link a new content note to its own hub with `related`, then add a downward link from the hub under the matching section.
- Update `global.md` only for a new top-level project, a global protocol change, or a new vault-wide view.
- Never edit `.obsidian/`, attachments, or generated application state. Never delete, move, commit, or sync notes unless the user explicitly asks.
- When concurrent work may touch the same note, re-read it immediately before patching and merge rather than overwriting.

After writing, verify that the file exists, frontmatter is closed and parseable, links use vault-relative paths, the relevant hub points to the new note, and no file under `.obsidian/` changed. State exactly which notes were created or updated.

## Common requests

- **"Запиши/збережи в Brain"**: update canonical knowledge; add a concise session note only when the user explicitly requests saving the session.
- **"Що ми знаємо про ...?"**: search, rank current sources, and synthesize with vault-relative citations.
- **"Онови стан проєкту"**: update the hub and any canonical current-state document; move stale claims into historical context rather than silently preserving contradictions.
- **"Збережи сесію"**: capture goal, outcomes, decisions, verification, files changed, open tasks, and key learnings; omit raw chat.
- **"Додай проєкт"**: select or create its class, create the hub and folders from the schema, link it from the class hub or parent project, and avoid duplicates.
- **"Консолідуй"**: merge overlapping notes into a canonical note, repair hub links, and propose deletions rather than deleting automatically.

Direct filesystem access is the primary path. If it is unavailable and an `obsidian-brain` MCP server is connected, use its read/search/write tools with the same rules.
