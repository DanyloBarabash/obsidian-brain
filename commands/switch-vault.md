Switch the active Obsidian vault for this session.

All subsequent /resume, /save-to-obsidian, /ingest, and /search commands will use the selected vault until you run /switch-vault again or end the session.

## Steps

1. Check the argument passed by the user: `/switch-vault <name>`.
   - `<name>` is the short name of a registered vault (e.g. `work`, `personal`).
   - If no argument is given, go to step 2. If an argument is given, skip to step 3.

2. List all available vaults by checking which MCP servers named `obsidian-*` are connected. Display them as a numbered list:

```
Available vaults:
  [1] work       → obsidian-work
  [2] personal   → obsidian-personal
  ...

Which vault? (type name or number):
```

Wait for user input before continuing.

3. Resolve the selection to a vault name and its MCP server:
   - If the user typed a number, pick that entry from the list.
   - If the user typed a name, match it to an `obsidian-{name}` MCP server.
   - If no match found, say: "No vault named '{input}' found. Run /switch-vault to see the list." and stop.

4. Set the active vault for this session:
   - Remember: active vault name = `{name}`, active MCP = `obsidian-{name}`.
   - All subsequent commands in this session must use this MCP when reading or writing vault files.

5. Confirm:

```
Switched to vault: {name}
MCP: obsidian-{name}

You can now use /resume, /search, /save-to-obsidian, /ingest — they will all read and write to this vault.
```

## Notes for other commands

When /resume, /save-to-obsidian, /ingest, or /search run in the same session:
- If /switch-vault was already called, use the active vault MCP without asking.
- If /switch-vault was NOT called and more than one `obsidian-*` MCP is connected, ask the user which vault to use before proceeding (one-time prompt, then remember for the session).
- If only one `obsidian-*` MCP is connected, use it automatically.
