Save a passing idea to the Mountain of Ideas before it is forgotten.

Usage: /idea <text>

$ARGUMENTS is the idea — one line or several paragraphs. It belongs to no project.

## Steps

### 1. Setup

Read `~/.claude/settings.json`; a project `.claude/settings.json` with a non-empty `vaults.root` overrides it.
Extract `vaults.root`. If it is empty, stop: "No root vault configured."
Get today's date in YYYY-MM-DD format.

### 2. Shape the idea

a. Title: the idea in at most 80 characters, in the user's language. Use the first line if it already reads as a title.
b. Body: the user's words, lightly cleaned; keep every detail. Do not expand or judge the idea.
c. Slug: 3–6 distinctive words, lowercase kebab-case ASCII (transliterate Ukrainian).

### 3. Write the idea

Path: `{vaults.root}/_global/ideas/idea-{date}-{slug}.md` (add `-2`, `-3`… if it exists).

```markdown
---
id: global/ideas/idea-{date}-{slug}
type: idea
title: "{title}"
status: seed
created: {date}
knowledge_scope: global
tags: [idea]
related: ["[[_global/ideas]]"]
---

# {title}

{body}
```

Do not add the idea to any hub list: Brain City and `_global/ideas.md` find ideas by folder.

### 4. Confirm

"Idea saved to the Mountain of Ideas: _global/ideas/idea-{date}-{slug}.md"
