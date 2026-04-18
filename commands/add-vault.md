Register a new Obsidian vault so it becomes available for /switch-vault.

## Steps

1. If the user provided arguments, parse them:
   - `/add-vault <name> <path>` — use both directly, skip prompts.
   - `/add-vault <name>` — ask for the path only.
   - `/add-vault` — ask for both.

2. Ask for any missing values:

```
Vault name (short, no spaces — e.g. work, personal, study):
```

Wait for input. Normalize: lowercase, replace spaces with hyphens.

```
Path to vault (absolute path):
```

Wait for input. Expand `~` to the home directory.

3. Check that the path exists. If it does not:

```
Directory does not exist: <path>
Create it? [y/N]
```

If yes — run `mkdir -p <path>`. If no — stop.

4. Run the registration command via Bash:

```bash
claude mcp add obsidian-<name> --scope user -- npx @bitbonsai/mcpvault <path>
```

5. If the vault directory is empty, offer to apply the template:

```
Vault '<name>' is empty. Apply the default folder structure (CLAUDE.md, Projects/, Claude-Sessions/, etc.)? [Y/n]
```

If yes — copy `vault-template/` contents into the vault. The template is located next to this kit's commands directory: look for it at `~/.claude/commands/../vault-template/` or ask the user for the kit path if not found.

6. Confirm:

```
✓ Vault registered: obsidian-<name> → <path>

To use it in a session:
  /switch-vault <name>
```

7. If registration fails (non-zero exit), show the raw error and suggest:

```
Registration failed. You can register manually:
  claude mcp add obsidian-<name> --scope user -- npx @bitbonsai/mcpvault <path>
```
