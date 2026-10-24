#!/usr/bin/env bash
# Install Claude Brain globally — commands, scripts, vault, and global settings.
#
# Usage:
#   ./install.sh --vault ~/brain   — full global install with vault
#   ./install.sh                   — install commands only (no vault)
#   ./install.sh --force           — overwrite existing command files

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

VAULT_PATH=""
FORCE=false

while [[ $# -gt 0 ]]; do
  case $1 in
    --vault)  VAULT_PATH="$2"; shift 2 ;;
    --force)  FORCE=true; shift ;;
    -h|--help)
      echo "Usage: ./install.sh [--vault <path>] [--force]"
      exit 0 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

success() { echo "  ✓ $*"; }
warn()    { echo "  ! $*"; }

expand_path() { echo "$1" | sed "s|^~|$HOME|"; }

# ── 1. Commands → ~/.claude/commands/ ────────────────────────────────────────
echo ""
echo "Installing commands to ~/.claude/commands/ ..."

COMMANDS_DIR="$HOME/.claude/commands"
mkdir -p "$COMMANDS_DIR"

for f in "$SCRIPT_DIR/.claude/commands/"*.md; do
  name=$(basename "$f")
  dest="$COMMANDS_DIR/$name"
  if [ -f "$dest" ] && [ "$FORCE" = false ]; then
    warn "$name already exists — skipping (use --force to overwrite)"
  else
    cp "$f" "$dest"
    success "$name"
  fi
done

# ── 2. Scripts → ~/.claude/scripts/ ──────────────────────────────────────────
echo ""
echo "Installing scripts to ~/.claude/scripts/ ..."

SCRIPTS_DIR="$HOME/.claude/scripts"
mkdir -p "$SCRIPTS_DIR"

for f in "$SCRIPT_DIR/.claude/scripts/"*.sh; do
  name=$(basename "$f")
  cp "$f" "$SCRIPTS_DIR/$name"
  chmod +x "$SCRIPTS_DIR/$name"
  success "$name"
done

# ── 2b. Skills → ~/.claude/skills/ ───────────────────────────────────────────
echo ""
echo "Installing skills to ~/.claude/skills/ ..."

SKILLS_DIR="$HOME/.claude/skills"
for d in "$SCRIPT_DIR/.claude/skills/"*/; do
  name=$(basename "$d")
  mkdir -p "$SKILLS_DIR/$name"
  cp "$d"* "$SKILLS_DIR/$name/"
  success "$name"
done

# ── 3. Global settings — hooks ────────────────────────────────────────────────
echo ""
echo "Configuring ~/.claude/settings.json ..."

GLOBAL_SETTINGS="$HOME/.claude/settings.json"

# Read or create
if [ -f "$GLOBAL_SETTINGS" ]; then
  EXISTING=$(cat "$GLOBAL_SETTINGS")
else
  EXISTING="{}"
fi

EXISTING="$EXISTING" python3 - <<'PYEOF'
import json, os

existing = json.loads(os.environ['EXISTING'])
settings_path = os.path.expanduser('~/.claude/settings.json')

home = os.path.expanduser('~')
new_commands = [
    f"bash {home}/.claude/scripts/check-originals.sh",
    f"bash {home}/.claude/scripts/remind-save-session.sh",
]

existing.setdefault('hooks', {})
existing['hooks'].setdefault('Stop', [])

# Find existing Claude Brain matcher block (matcher == "")
brain_block = next(
    (b for b in existing['hooks']['Stop']
     if isinstance(b, dict) and b.get('matcher') == '' and 'hooks' in b),
    None
)

if brain_block is None:
    brain_block = {'matcher': '', 'hooks': []}
    existing['hooks']['Stop'].append(brain_block)

existing_cmds = {h['command'] for h in brain_block['hooks'] if 'command' in h}
added = 0
for cmd in new_commands:
    if cmd not in existing_cmds:
        brain_block['hooks'].append({'type': 'command', 'command': cmd})
        added += 1

with open(settings_path, 'w') as f:
    json.dump(existing, f, indent=2)
    f.write('\n')

print(f"  ✓ {added} hook(s) added to ~/.claude/settings.json")
PYEOF

# ── 4. CLAUDE.md — Claude Brain hint ─────────────────────────────────────────
echo ""
echo "Updating ~/.claude/CLAUDE.md ..."

python3 - <<'PYEOF'
import os

claude_md = os.path.expanduser('~/.claude/CLAUDE.md')
marker = '# Claude Brain'

section = '''
# Claude Brain

Persistent memory system installed globally. Commands available in every Claude Code session:

| Command | What it does |
|---|---|
| `/memory` | Load active project core memory — run at the start of every session |
| `/save-session` | Save this session\'s decisions and outcomes to the vault |
| `/recall <query>` | Search vault and load relevant notes into context |
| `/note <text>` | Save a quick note mid-session |
| `/ingest <file\\|url>` | Add a document or webpage to the vault |
| `/add-vault <name>` | Create a new project workspace |
| `/switch-vault <name>` | Switch active project |
| `/consolidate` | Extract patterns from old sessions, update core memory |
| `/index` | Rebuild the project index |
| `/retro [7d\\|since DATE]` | Analyze recent sessions; propose memory, Brain, skill and hook updates |

Settings and vault paths live in `~/.claude/settings.json` under `vaults`.
At the start of any session: run `/memory` to restore project context.
'''

if os.path.exists(claude_md):
    content = open(claude_md).read()
    if marker in content:
        print('  ! Claude Brain section already in CLAUDE.md — skipping')
    else:
        with open(claude_md, 'a') as f:
            f.write(section)
        print('  ✓ Claude Brain section appended to CLAUDE.md')
else:
    with open(claude_md, 'w') as f:
        f.write(section.lstrip())
    print('  ✓ CLAUDE.md created with Claude Brain section')
PYEOF

# ── 5. Initialize vault ───────────────────────────────────────────────────────
if [ -n "$VAULT_PATH" ]; then
  echo ""
  echo "Initializing vault ..."

  VAULT_ABS="$(expand_path "$VAULT_PATH")"

  if [ -d "$VAULT_ABS/_global" ]; then
    warn "Vault already initialized at $VAULT_ABS — skipping template copy"
  else
    mkdir -p "$VAULT_ABS"
    cp -r "$SCRIPT_DIR/vault-template/." "$VAULT_ABS/"
    success "Vault created: $VAULT_ABS"
  fi

  # Write vault config to global settings
  VAULT_ABS="$VAULT_ABS" python3 - <<'PYEOF'
import json, os

vault_abs     = os.environ['VAULT_ABS']
settings_path = os.path.expanduser('~/.claude/settings.json')

with open(settings_path) as f:
    s = json.load(f)

s.setdefault('vaults', {})
s['vaults']['root']   = vault_abs
s['vaults']['active'] = ''
s['vaults'].setdefault('aliases', {})
s['vaults']['aliases']['global'] = vault_abs + '/_global'

with open(settings_path, 'w') as f:
    json.dump(s, f, indent=2)
    f.write('\n')

print(f"  ✓ vaults.root set: {vault_abs}")
print(f"  ✓ global alias:    {vault_abs}/_global")
PYEOF
fi

# ── 5. Summary ────────────────────────────────────────────────────────────────
echo ""
echo "Done. Claude Brain is installed globally."
echo ""

if [ -n "$VAULT_PATH" ]; then
  VAULT_ABS="$(expand_path "$VAULT_PATH")"
  echo "Vault:    $VAULT_ABS"
  echo "Commands: $COMMANDS_DIR"
  echo "Scripts:  $SCRIPTS_DIR"
  echo "Config:   $HOME/.claude/settings.json"
  echo ""
  echo "Next steps:"
  echo "  1. Open $VAULT_ABS in Obsidian as a vault"
  echo "  2. In any Claude Code session, run:"
  echo "       /add-vault <project-name>   — create your first project"
  echo "       /memory                     — load core memory"
else
  echo "Commands: $COMMANDS_DIR"
  echo ""
  echo "Next: /add-vault --root <path>  — initialize a brain vault"
fi
echo ""
