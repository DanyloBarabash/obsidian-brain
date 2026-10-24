#!/usr/bin/env bash
# Checks the active project's documents/originals/ for unprocessed files.
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

ORIGINALS="$VAULT/documents/originals"
PROCESSED="$VAULT/documents/processed"
[ -d "$ORIGINALS" ] || exit 0

unprocessed=()
for filepath in "$ORIGINALS"/*; do
  [ -f "$filepath" ] || continue
  filename=$(basename "$filepath")
  [[ "$filename" == ".gitkeep" ]] && continue
  if ! grep -rlF -- "$filename" "$PROCESSED" 2>/dev/null | grep -q .; then
    unprocessed+=("$filename")
  fi
done

if [ ${#unprocessed[@]} -gt 0 ]; then
  echo ""
  echo "Unprocessed files in documents/originals/:"
  for f in "${unprocessed[@]}"; do
    echo "  - $f"
  done
  echo "Run /ingest <file-path> to process."
fi
