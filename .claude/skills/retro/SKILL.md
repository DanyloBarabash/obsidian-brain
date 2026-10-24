---
name: retro
description: Periodic retrospective over all Claude Code sessions since the last run (or a given period) — finds recurring patterns and proposes updates to Claude memory, the Obsidian Brain vault (hubs, current-state, missing session notes), CLAUDE.md rules, new skills, hooks and permission allowlists, then applies only what the user approves. Use when the user asks to review recent chats, run a retro, refresh/clean up memory or the Brain, or find what to automate.
argument-hint: "[7d | since YYYY-MM-DD | project <substring>]"
---

# Retro

Analyze recent Claude Code transcripts across all projects and keep both memory
layers current: Claude auto-memory (`~/.claude/projects/*/memory/`) and the
Obsidian Brain vault (`settings.json → vaults.root`). Nothing changes without approval.

## Token budget

- Never read raw `.jsonl` transcripts. Work only from the digest.
- Load existing knowledge lazily: indexes and hubs first, individual files only
  when a finding concerns them.
- Extraction subagents run with `model: "sonnet"`; synthesis stays in this session.
- Digest size (from `index.md`) decides the mode:
  - ≤ 40k tokens → read the digests directly, no subagents;
  - 40k–200k → one subagent per project (split any project over 80k by sessions);
  - > 200k → stop and ask the user to narrow the window or pick projects.

## 1. Window

Parse `$ARGUMENTS`:
- `Nd` → `--days N`
- `since YYYY-MM-DD` → `--since YYYY-MM-DD`
- `project <s>` → `--project <s>` (combinable)
- empty → since the last retro (`state.json`), else the last 7 days.

## 2. Build the digest

```bash
python3 ~/.claude/skills/retro/digest.py --out <scratchpad>/retro [flags]
```

Output: `index.md` (sessions with cwd and size, total token estimate, counts of
commands, skills, tools, bash programs, rejections, errors) and one
`<project>__<session>.md` per session. A session digest holds user prompts, one
line per assistant turn summarizing its tool calls (Bash/Skill/Agent details
inline), the turn's final text clipped, rejections with the user's reason, and
interrupts. Ignore the current session.

Read `index.md`. No sessions → say so and stop.

## 3. Extract findings

Per the budget mode, read directly or launch the subagents in one message, each
given its digest paths and this brief:

> Read these session digests. Report terse, concrete findings, each with session
> file + timestamp as evidence:
> 1. **Corrections** — the user told Claude to stop/change something (rejections,
>    "ні / не треба / я ж казав", repeated instructions). Quote the user.
> 2. **Repeated requests** — the same kind of task or prompt in 2+ sessions.
> 3. **Repeated workflows** — recurring sequences of commands/tool calls that could
>    become a skill or script.
> 4. **Durable facts** — decisions, project state, conventions, external references
>    stated or confirmed by the user and not obvious from code.
> 5. **Superseded facts** — what changed in the window (plan replaced, task done,
>    branch merged, file renamed).
> 6. **Session outcomes** — per session: goal, outcome, key decisions, open tasks
>    (2–5 lines), for sessions that produced real results.
> 7. **Friction** — errors retried, misunderstandings, detours, permission prompts
>    on safe read-only commands.
> No speculation beyond the transcript. Max ~1.5k words.

## 4. Load what currently exists

For each project in the digest (map session `cwd` → project):

**Claude memory** — `~/.claude/projects/<project>/memory/MEMORY.md`; project
`CLAUDE.md` and `.claude/rules/` at the cwd (headings only unless relevant).

**Brain vault** — follow `{vaults.root}/AGENTS.md`: read `global.md`, then the
project hub. Find the hub through `vaults.aliases`; otherwise grep hubs under
`projects/` for the repo name. Read the hub, its `*-current-state.md` document, and
the list of `sessions/` filenames (not their bodies). No hub → note it as a finding.

**Automation** — `~/.claude/CLAUDE.md`, hooks and permissions in
`~/.claude/settings.json` and project `.claude/settings*.json`, names in
`~/.claude/skills/`, `~/.claude/commands/`, `<project>/.claude/skills|commands/`.

**Previous retro** — the newest report linked from `{vaults.root}/_global/retro.md`.
Items proposed before and seen again are stronger; items declined before are not
re-proposed without new evidence.

## 5. Verify staleness

For memory entries and hub/current-state statements that name a file, function,
flag, branch, commit, version or status, check them against the repo (`ls`,
`grep`, `git status`, `git log -1 -- <path>`) and the digests. Mark **stale** only
with concrete evidence. Flag contradictions between Claude memory and the vault.

## 6. Proposal

One numbered list, grouped; skip empty groups. Each item: what, the exact target
file, evidence (session + date; quote for user corrections), and the proposed text.

1. **Claude memory — add / update / remove**
2. **Brain — project state** — hub `## State` / `## Key decisions` and
   `documents/*-current-state.md` edits; superseded statements are rewritten with a
   note of what replaced them, never silently dropped
3. **Brain — session notes** — sessions in the window with real outcomes and no
   matching note in the project's `sessions/` (by date and topic); proposed note
   from the session template, linked from the hub
4. **Brain — durable notes** — knowledge spanning sessions that belongs in a
   `notes/` or `documents/` file (update the canonical one if it exists)
5. **Promote** — a repeated correction or stable memory that belongs in `CLAUDE.md`
   / `.claude/rules/`, or an outdated CLAUDE.md line
6. **Skills / commands** — name, trigger description, steps, sessions showing the need
7. **Hooks** — mechanical corrections the harness should enforce
8. **Permissions** — safe read-only commands that keep prompting (`/fewer-permission-prompts`)
9. **Observations** — friction with no direct fix

Evidence bar: a `feedback` memory needs an explicit user correction or the same
preference in 2+ sessions; a skill needs the workflow in 2+ sessions. Prefer
updating an existing memory, note, skill or hook over adding a new one. Keep a fact
in one canonical place: rules for Claude's behavior → Claude memory / CLAUDE.md;
project knowledge and history → Brain; cross-link instead of duplicating.

Ask once which items to apply (`all`, numbers, or `none`).

## 7. Apply

Only the selected items.
- Claude memory: the memory rules in the system prompt (one fact per file,
  frontmatter, pointer in `MEMORY.md`).
- Brain: `{vaults.root}/_global/notes/agent-writing-protocol.md` — templates from
  `_global/templates/`, re-read before editing, bump `updated:`, add new files to
  the owning hub, check frontmatter and wikilinks. Never delete or move vault notes;
  never touch `.obsidian/`.
- Skills: `~/.claude/skills/<name>/SKILL.md` (global) or
  `<project>/.claude/skills/<name>/SKILL.md`. Hooks/permissions via `update-config`.
- Never commit anything.

## 8. Record

Reports live in their own Brain node: hub `{vaults.root}/_global/retro.md`, files
in `{vaults.root}/_global/retro/`. Write `_global/retro/retro-YYYY-MM-DD.md` from the
session template (`id: global/retro/retro-YYYY-MM-DD`, `project: global`,
`tags: [retro, ...]`, `related: ["[[_global/retro]]"]`, `summary:` = window + counts)
with the window, findings, proposal, and what was applied and declined. Add it at
the top of the hub's `## Reports` with a one-line summary and bump the hub's
`updated:`. Then mark the run:

```bash
python3 ~/.claude/skills/retro/digest.py --out <scratchpad>/retro --mark --until <window end>
```

Finish with: window, sessions analyzed, digest size, items applied per group.
