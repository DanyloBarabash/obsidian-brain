#!/usr/bin/env bash
# Install Claude Brain for every local agent — all Claude Code configs and Codex.
#
# Usage:
#   ./install.sh --vault ~/brain        — full install and vault initialization
#   ./install.sh                        — install into every detected agent config
#   ./install.sh --config-dir <dir>     — install only into this Claude config (repeatable)
#   ./install.sh --no-codex             — skip Codex
#   ./install.sh --force                — overwrite existing command files

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Vault config is shared by all agents and always lives here.
SHARED_SETTINGS="$HOME/.claude/settings.json"
CODEX_DIR="$HOME/.codex"

VAULT_PATH=""
FORCE=false
CODEX=true
CONFIG_DIRS=()

while [[ $# -gt 0 ]]; do
  case $1 in
    --vault)      VAULT_PATH="$2"; shift 2 ;;
    --config-dir) CONFIG_DIRS+=("$2"); shift 2 ;;
    --no-codex)   CODEX=false; shift ;;
    --force)      FORCE=true; shift ;;
    -h|--help)
      echo "Usage: ./install.sh [--vault <path>] [--config-dir <dir>]... [--no-codex] [--force]"
      exit 0 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

success() { echo "  ✓ $*"; }
warn()    { echo "  ! $*"; }

expand_path() { echo "$1" | sed "s|^~|$HOME|"; }

# Detect Claude configs: ~/.claude, ~/.claude-*, and ~/.claude-envs/*/.claude.
if [ ${#CONFIG_DIRS[@]} -eq 0 ]; then
  CONFIG_DIRS=("$HOME/.claude")
  for d in "$HOME"/.claude-* "$HOME"/.claude-envs/*/.claude; do
    [ -d "$d" ] || continue
    [ "$d" = "$HOME/.claude-envs" ] && continue
    CONFIG_DIRS+=("$d")
  done
fi

# ── 1. Initialize vault ───────────────────────────────────────────────────────
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

  mkdir -p "$(dirname "$SHARED_SETTINGS")"
  [ -f "$SHARED_SETTINGS" ] || echo "{}" > "$SHARED_SETTINGS"

  VAULT_ABS="$VAULT_ABS" SHARED_SETTINGS="$SHARED_SETTINGS" python3 - <<'PYEOF'
import json, os

vault_abs     = os.environ['VAULT_ABS']
settings_path = os.environ['SHARED_SETTINGS']

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

VAULT_ROOT=""
[ -f "$SHARED_SETTINGS" ] && VAULT_ROOT=$(python3 -c \
  "import json,sys; print(json.load(open(sys.argv[1])).get('vaults',{}).get('root',''))" "$SHARED_SETTINGS")

# ── 2. Claude Code configs ────────────────────────────────────────────────────
install_claude() {
  local CLAUDE_DIR="$1"
  echo ""
  echo "── Claude config: $CLAUDE_DIR"

  mkdir -p "$CLAUDE_DIR/commands" "$CLAUDE_DIR/scripts" "$CLAUDE_DIR/skills"

  for f in "$SCRIPT_DIR/.claude/commands/"*.md; do
    name=$(basename "$f")
    dest="$CLAUDE_DIR/commands/$name"
    if [ -f "$dest" ] && [ "$FORCE" = false ]; then
      warn "$name already exists — skipping (use --force to overwrite)"
    else
      cp "$f" "$dest"
      success "command $name"
    fi
  done

  for f in "$SCRIPT_DIR/.claude/scripts/"*.sh; do
    name=$(basename "$f")
    cp "$f" "$CLAUDE_DIR/scripts/$name"
    chmod +x "$CLAUDE_DIR/scripts/$name"
    success "script $name"
  done

  for d in "$SCRIPT_DIR/.claude/skills/"*/; do
    name=$(basename "$d")
    mkdir -p "$CLAUDE_DIR/skills/$name"
    cp "$d"* "$CLAUDE_DIR/skills/$name/"
    success "skill $name"
  done

  CLAUDE_DIR="$CLAUDE_DIR" python3 - <<'PYEOF'
import json, os

claude_dir    = os.environ['CLAUDE_DIR']
settings_path = os.path.join(claude_dir, 'settings.json')

existing = {}
if os.path.exists(settings_path):
    with open(settings_path) as f:
        existing = json.load(f)

new_commands = [
    f"bash {claude_dir}/scripts/check-originals.sh",
    f"bash {claude_dir}/scripts/remind-save-session.sh",
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

print(f"  ✓ {added} hook(s) added to settings.json")
PYEOF

  CLAUDE_DIR="$CLAUDE_DIR" python3 - <<'PYEOF'
import os

claude_md = os.path.join(os.environ['CLAUDE_DIR'], 'CLAUDE.md')
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
}

for dir in "${CONFIG_DIRS[@]}"; do
  install_claude "$(expand_path "$dir")"
done

# ── 3. Codex ──────────────────────────────────────────────────────────────────
if [ "$CODEX" = true ] && [ -d "$CODEX_DIR" ]; then
  echo ""
  echo "── Codex: $CODEX_DIR"

  if [ -z "$VAULT_ROOT" ]; then
    warn "vaults.root is not set — skipping Codex (run with --vault <path>)"
  else
    for d in "$SCRIPT_DIR/codex/skills/"*/; do
      name=$(basename "$d")
      dest="$CODEX_DIR/skills/$name"
      mkdir -p "$dest"
      cp -R "$d". "$dest/"
      find "$dest" -type f -name '*.md' -exec sed -i.bak "s|{{VAULT_ROOT}}|$VAULT_ROOT|g" {} +
      find "$dest" -type f -name '*.bak' -delete
      success "skill $name"
    done

    AGENTS_MD="$CODEX_DIR/AGENTS.md"
    if [ -f "$AGENTS_MD" ] && grep -q '^## Obsidian Brain' "$AGENTS_MD"; then
      warn "Obsidian Brain section already in AGENTS.md — skipping"
    else
      { echo ""; sed "s|{{VAULT_ROOT}}|$VAULT_ROOT|g" "$SCRIPT_DIR/codex/AGENTS.md"; } >> "$AGENTS_MD"
      success "Obsidian Brain section appended to AGENTS.md"
    fi
  fi
fi

# ── 4. Summary ────────────────────────────────────────────────────────────────
echo ""
echo "Done. Claude Brain is installed for ${#CONFIG_DIRS[@]} Claude config(s)$([ "$CODEX" = true ] && [ -d "$CODEX_DIR" ] && echo " and Codex")."
echo ""
echo "Vault:  ${VAULT_ROOT:-not configured}"
echo "Config: $SHARED_SETTINGS"
echo ""
if [ -n "$VAULT_ROOT" ]; then
  echo "Next: /add-vault <project-name> --class <class-id>, then /memory"
else
  echo "Next: ./install.sh --vault <path>  — initialize a brain vault"
fi
echo ""
