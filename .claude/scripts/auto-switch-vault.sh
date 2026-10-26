#!/usr/bin/env bash
# Sets vaults.active to the project whose hub lists the session's folder in `workdirs`.
# Runs on UserPromptSubmit; the deepest matching folder wins, and an unmapped folder changes nothing.

command -v python3 &>/dev/null || exit 0

HOOK_INPUT="$(cat)" python3 - <<'PYEOF'
import json, os, re, sys
from pathlib import Path

try:
    cwd = json.loads(os.environ.get("HOOK_INPUT") or "{}").get("cwd") or os.getcwd()
except ValueError:
    cwd = os.getcwd()
settings_path = Path.home() / ".claude" / "settings.json"
local = Path(cwd) / ".claude" / "settings.json"
try:
    settings = json.loads(settings_path.read_text())
    if local.is_file() and json.loads(local.read_text()).get("vaults", {}).get("root"):
        sys.exit(0)  # a project-level vault configuration is managed by hand
except (OSError, ValueError):
    sys.exit(0)
vaults = settings.get("vaults", {})
root = vaults.get("root")
if not root or not Path(root, "projects").is_dir():
    sys.exit(0)


def workdirs(hub):
    """Folders from a hub's frontmatter: `workdirs: [a, b]` or a block list."""
    text = hub.read_text(encoding="utf-8", errors="replace")
    match = re.match(r"\A---\s*\n(.*?)\n---", text, re.S)
    if not match:
        return []
    lines = match[1].split("\n")
    for i, line in enumerate(lines):
        if not line.startswith("workdirs:"):
            continue
        inline = line.split(":", 1)[1].strip()
        if inline.startswith("["):
            items = inline.strip("[]").split(",")
        else:
            items = [l.strip()[1:] for l in lines[i + 1:] if l.strip().startswith("- ")]
        return [os.path.expanduser(item.strip().strip("\"'")) for item in items if item.strip()]
    return []


cwd = os.path.realpath(cwd)
best = None
for hub in Path(root, "projects").rglob("*.md"):
    if {"sessions", "documents", "notes"} & set(hub.relative_to(root).parts):
        continue
    for folder in workdirs(hub):
        folder = os.path.realpath(folder)
        if (cwd == folder or cwd.startswith(folder + os.sep)) and (best is None or len(folder) > len(best[0])):
            best = (folder, str(hub.with_suffix("")))
if best is None or best[1] == vaults.get("active"):
    sys.exit(0)
vaults["active"] = best[1]
temporary = settings_path.with_name(settings_path.name + ".tmp")
temporary.write_text(json.dumps(settings, indent=2, ensure_ascii=False) + "\n")
os.replace(temporary, settings_path)
print(f"Brain: active project switched to {os.path.relpath(best[1], root)} (folder {best[0]}).")
PYEOF
