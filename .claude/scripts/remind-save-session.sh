#!/usr/bin/env bash
# Reminds to save the session if today's session hasn't been saved yet.
# Reads global ~/.claude/settings.json; project .claude/settings.json overrides.

command -v jq &>/dev/null || exit 0

GLOBAL_SETTINGS="$HOME/.claude/settings.json"
LOCAL_SETTINGS=".claude/settings.json"

if [ -f "$LOCAL_SETTINGS" ] && jq -e '.vaults.active | select(. != "")' "$LOCAL_SETTINGS" &>/dev/null; then
  SETTINGS="$LOCAL_SETTINGS"
elif [ -f "$GLOBAL_SETTINGS" ] && jq -e '.vaults.active | select(. != "")' "$GLOBAL_SETTINGS" &>/dev/null; then
  SETTINGS="$GLOBAL_SETTINGS"
else
  exit 0
fi

VAULT=$(jq -r '.vaults.active // empty' "$SETTINGS")
[ -z "$VAULT" ] && exit 0

SESSIONS_DIR="$VAULT/sessions"
[ -d "$SESSIONS_DIR" ] || exit 0

TODAY=$(date +%Y-%m-%d)
ls "$SESSIONS_DIR"/"$(basename "$VAULT")"-${TODAY}-*.md "$SESSIONS_DIR"/${TODAY}-*.md 2>/dev/null | grep -q . && exit 0

SESSION_COUNT=$(find "$SESSIONS_DIR" -maxdepth 1 -name "*.md" | wc -l | tr -d ' ')
[ "$SESSION_COUNT" -eq 0 ] && exit 0

echo ""
echo "No session saved today. Run /save-session to save this session to memory."
