Search across the entire Obsidian vault and return ranked, useful results.

## Steps

1. Take the full query string after `/search` as the search query. If no query is provided, ask the user what to search for and wait.

2. Use the MCP obsidian tool to search the vault. Run separate searches across these sections:
   - `Projects/` — README and decisions files
   - `Claude-Sessions/` — everything above `## Raw session log`
   - `Resources/` — everything above `## Full content`
   - `Notes/` — full content

3. For each section, select up to 5 most relevant matches. Relevance is determined by: term frequency, recency (newer is slightly preferred), and presence of the query terms in headings or tags.

4. For each match, read only the relevant portion (the section that contains the match, not the entire file). Extract a snippet of 2–4 lines around the match.

5. Output results grouped by section:

```
## Search: "{query}"

### Projects ({N} matches)
- **{project-name}** · `{file-path}`
  {2-line snippet with match highlighted in **bold**}

### Sessions ({N} matches)
- **{date} — {topic}** · `{file-path}`
  {2-line snippet}

### Resources ({N} matches)
- **{title}** · `{file-path}`
  {2-line snippet}

### Notes ({N} matches)
- **{note-title}** · `{file-path}`
  {2-line snippet}
```

6. If total matches across all sections exceed 15, add a note: "Showing top results. Refine your query for more specific results."

7. If no matches found anywhere: "Nothing found for '{query}'. Try different keywords or check spelling."

8. After results, offer: "Open a file? Type its number or path, or ask a follow-up question."
