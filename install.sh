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

command -v node >/dev/null 2>&1 || die "Node.js is required but not found. Install from https://nodejs.org"
command -v npm  >/dev/null 2>&1 || die "npm is required but not found."
command -v claude >/dev/null 2>&1 || die "Claude Code CLI is required but not found. See https://docs.anthropic.com/en/docs/claude-code"

NODE_VERSION=$(node -e "process.stdout.write(process.versions.node)")
MAJOR="${NODE_VERSION%%.*}"
[[ "$MAJOR" -ge 18 ]] || die "Node.js 18+ required. Current version: $NODE_VERSION"

success "Dependencies OK (Node $NODE_VERSION)"

# --- Vault path ---

echo ""
echo "Where is your Obsidian vault? (absolute path)"
echo "Leave blank to create a new vault at ~/obsidian-vault"
echo ""
read -r -p "Vault path: " VAULT_PATH

if [[ -z "$VAULT_PATH" ]]; then
    VAULT_PATH="$HOME/obsidian-vault"
    info "Using $VAULT_PATH"
fi

VAULT_PATH="${VAULT_PATH/#\~/$HOME}"

if [[ ! -d "$VAULT_PATH" ]]; then
    info "Creating vault directory at $VAULT_PATH"
    mkdir -p "$VAULT_PATH"
fi

success "Vault: $VAULT_PATH"

# --- Install MCP server ---

echo ""
info "Installing obsidian-mcp..."
npm install -g @smithery/mcp-obsidian
success "obsidian-mcp installed"

# --- Configure MCP in Claude Code ---

info "Adding MCP server to Claude Code config..."
claude mcp add obsidian -- mcp-obsidian --vault "$VAULT_PATH"
success "MCP server configured"

# --- Copy slash commands ---

COMMANDS_DIR="$HOME/.claude/commands"
info "Copying slash commands to $COMMANDS_DIR..."
mkdir -p "$COMMANDS_DIR"
cp "$SCRIPT_DIR/commands/"*.md "$COMMANDS_DIR/"
success "Commands installed: resume, save-to-obsidian, ingest, search"

# --- Disable auto-compact ---

info "Disabling auto-compact..."
claude config set --global autoCompact false
success "Auto-compact disabled"

# --- Copy vault template (only empty dirs) ---

VAULT_FILES=$(ls -A "$VAULT_PATH" 2>/dev/null | wc -l | tr -d ' ')

if [[ "$VAULT_FILES" -eq 0 ]]; then
    info "Vault is empty — copying template structure..."
    cp -r "$SCRIPT_DIR/vault-template/"* "$VAULT_PATH/"
    success "Vault structure created"
else
    warn "Vault is not empty — skipping template copy to avoid overwriting your notes."
    warn "To copy manually: cp -r $SCRIPT_DIR/vault-template/* $VAULT_PATH/"
fi

# --- Done ---

echo ""
echo "=================================="
success "Installation complete!"
echo ""
echo "Next steps:"
echo "  1. Restart Claude Code"
echo "  2. Create your first project:"
echo "       cp vault-template/Projects/README-template.md $VAULT_PATH/Projects/my-project/README.md"
echo "  3. In Claude Code, run: /resume my-project"
echo ""
