#!/usr/bin/env bash
set -euo pipefail

BLUE='\033[0;34m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

info()    { echo -e "${BLUE}→${NC} $*"; }
success() { echo -e "${GREEN}✓${NC} $*"; }
warn()    { echo -e "${YELLOW}!${NC} $*"; }
die()     { echo -e "${RED}✗${NC} $*" >&2; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo ""
echo "Claude + Obsidian Kit — installer"
echo "=================================="
echo ""

# --- Check dependencies ---

command -v node   >/dev/null 2>&1 || die "Node.js is required but not found. Install from https://nodejs.org"
command -v npm    >/dev/null 2>&1 || die "npm is required but not found."
command -v claude >/dev/null 2>&1 || die "Claude Code CLI is required. See https://docs.anthropic.com/en/docs/claude-code"
command -v python3 >/dev/null 2>&1 || die "python3 is required but not found."

NODE_VERSION=$(node -e "process.stdout.write(process.versions.node)")
MAJOR="${NODE_VERSION%%.*}"
[[ "$MAJOR" -ge 18 ]] || die "Node.js 18+ required. Current version: $NODE_VERSION"

success "Dependencies OK (Node $NODE_VERSION)"

# --- Install MCP server ---

echo ""
info "Installing @bitbonsai/mcpvault..."
npm install -g @bitbonsai/mcpvault
success "@bitbonsai/mcpvault installed"

# --- Register vaults ---

echo ""
echo "Register your Obsidian vaults."
echo "Each vault gets a short name (e.g. 'work', 'personal') used in /switch-vault."
echo "Press Enter with an empty name when done."
echo ""

REGISTERED_VAULTS=()

while true; do
    read -r -p "Vault name (or Enter to finish): " VAULT_NAME
    [[ -z "$VAULT_NAME" ]] && break

    # Sanitize: lowercase, no spaces
    VAULT_NAME="${VAULT_NAME,,}"
    VAULT_NAME="${VAULT_NAME// /-}"

    read -r -p "Path to '$VAULT_NAME' vault: " VAULT_PATH
    VAULT_PATH="${VAULT_PATH/#\~/$HOME}"

    if [[ -z "$VAULT_PATH" ]]; then
        warn "Path cannot be empty, skipping '$VAULT_NAME'."
        continue
    fi

    if [[ ! -d "$VAULT_PATH" ]]; then
        read -r -p "  Directory does not exist. Create it? [y/N] " CONFIRM
        if [[ "${CONFIRM,,}" == "y" ]]; then
            mkdir -p "$VAULT_PATH"
            info "Created $VAULT_PATH"
        else
            warn "Skipping '$VAULT_NAME'."
            continue
        fi
    fi

    MCP_NAME="obsidian-${VAULT_NAME}"
    info "Registering MCP server '$MCP_NAME' → $VAULT_PATH"
    claude mcp add "$MCP_NAME" --scope user -- npx @bitbonsai/mcpvault "$VAULT_PATH"
    success "Registered: $MCP_NAME"
    REGISTERED_VAULTS+=("$VAULT_NAME:$VAULT_PATH")
    echo ""
done

if [[ ${#REGISTERED_VAULTS[@]} -eq 0 ]]; then
    warn "No vaults registered. You can add them later:"
    warn "  claude mcp add obsidian-<name> --scope user -- npx @bitbonsai/mcpvault /path/to/vault"
fi

# --- Copy slash commands ---

COMMANDS_DIR="$HOME/.claude/commands"
info "Copying slash commands to $COMMANDS_DIR..."
mkdir -p "$COMMANDS_DIR"
cp "$SCRIPT_DIR/commands/"*.md "$COMMANDS_DIR/"
success "Commands installed: resume, save-to-obsidian, ingest, search, switch-vault"

# --- Disable auto-compact ---

info "Disabling auto-compact in ~/.claude/settings.json..."
python3 - <<'PYEOF'
import json, os, sys

path = os.path.expanduser("~/.claude/settings.json")
settings = {}
if os.path.exists(path):
    try:
        with open(path) as f:
            settings = json.load(f)
    except (json.JSONDecodeError, OSError):
        pass

if settings.get("autoCompact") is False:
    print("  already disabled, skipping")
    sys.exit(0)

settings["autoCompact"] = False
os.makedirs(os.path.dirname(path), exist_ok=True)
with open(path, "w") as f:
    json.dump(settings, f, indent=2)
    f.write("\n")
PYEOF
success "Auto-compact disabled"

# --- Copy vault template to empty vaults ---

for ENTRY in "${REGISTERED_VAULTS[@]}"; do
    VAULT_NAME="${ENTRY%%:*}"
    VAULT_PATH="${ENTRY##*:}"
    VAULT_FILES=$(ls -A "$VAULT_PATH" 2>/dev/null | wc -l | tr -d ' ')

    if [[ "$VAULT_FILES" -eq 0 ]]; then
        info "Vault '$VAULT_NAME' is empty — copying template structure..."
        cp -r "$SCRIPT_DIR/vault-template/"* "$VAULT_PATH/"
        success "Template applied to '$VAULT_NAME'"
    else
        warn "Vault '$VAULT_NAME' is not empty — skipping template copy."
    fi
done

# --- Done ---

echo ""
echo "=================================="
success "Installation complete!"
echo ""
if [[ ${#REGISTERED_VAULTS[@]} -gt 0 ]]; then
    echo "Registered vaults:"
    for ENTRY in "${REGISTERED_VAULTS[@]}"; do
        VAULT_NAME="${ENTRY%%:*}"
        VAULT_PATH="${ENTRY##*:}"
        echo "  obsidian-${VAULT_NAME} → ${VAULT_PATH}"
    done
    echo ""
fi
echo "Next steps:"
echo "  1. Restart Claude Code"
echo "  2. Switch to a vault:       /switch-vault"
echo "  3. Start a project session: /resume my-project"
echo ""
