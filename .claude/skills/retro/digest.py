"""Condense Claude Code transcripts from a time window into compact Markdown digests."""

import argparse
import collections
import glob
import json
import os
import re
from datetime import datetime, timedelta, timezone

CLAUDE_DIR = os.path.expanduser("~/.claude")
PROJECTS_DIR = os.path.join(CLAUDE_DIR, "projects")
STATE_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "state.json")

DEFAULT_WINDOW_DAYS = 7
USER_TEXT_LIMIT = 2000
ASSISTANT_TEXT_LIMIT = 500
TOOL_DETAIL_LIMIT = 100
TURN_DETAIL_LIMIT = 400
REJECTION_TEXT_LIMIT = 600
TOP_N = 25
CHARS_PER_TOKEN = 4

DETAILED_TOOLS = {"Bash", "Skill", "Agent", "Workflow", "WebFetch", "WebSearch"}
REJECTION_MARKER = "doesn't want to proceed with this tool use"
INTERRUPT_MARKER = "[Request interrupted by user"
SKIPPED_USER_PREFIXES = (
    "<local-command-caveat>",
    "<local-command-stdout>",
    "<task-notification>",
    "Caveat:",
)
REMINDER_RE = re.compile(r"<system-reminder>.*?</system-reminder>", re.S)
COMMAND_RE = re.compile(r"<command-name>(.*?)</command-name>.*?<command-args>(.*?)</command-args>", re.S)
ASSIGNMENT_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*=")
SKIPPED_PROGRAMS = {"cd", "export", "set", "source", "mkdir", "echo", "("}
BASH_INPUT_RE = re.compile(r"<bash-input>(.*?)</bash-input>", re.S)


def parse_ts(value):
    """Parse an ISO timestamp or YYYY-MM-DD date into an aware UTC datetime."""
    if len(value) == len("YYYY-MM-DD"):
        value += "T00:00:00"
    dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def load_state():
    """Return the persisted state dict, or an empty one."""
    try:
        with open(STATE_PATH) as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return {}


def clip(text, limit):
    """Collapse whitespace and truncate."""
    text = re.sub(r"\s+", " ", text).strip()
    return text if len(text) <= limit else text[:limit] + " …"


def project_label(dirname):
    """Turn an encoded project directory name into a readable label."""
    home = os.path.expanduser("~").replace("/", "-").replace(".", "-")
    label = dirname[len(home) :] if dirname.startswith(home) else dirname
    return label.strip("-") or dirname


def tool_detail(name, inp):
    """One-line summary of a tool call's input."""
    if not isinstance(inp, dict):
        return ""
    for key in ("command", "file_path", "skill", "pattern", "query", "url", "description"):
        if inp.get(key):
            return clip(str(inp[key]), TOOL_DETAIL_LIMIT)
    return ""


def bash_program(command):
    """First real program of a shell command, skipping `cd`, variable assignments and `&&` chains."""
    for segment in re.split(r"&&|\|\||;|\n", command):
        words = [w for w in segment.split() if not ASSIGNMENT_RE.match(w)]
        if words and words[0] not in SKIPPED_PROGRAMS:
            return os.path.basename(words[0])
    return None


def result_text(block):
    """Flatten a tool_result content payload to text."""
    content = block.get("content")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return " ".join(x.get("text", "") for x in content if isinstance(x, dict))
    return ""


def user_text(record):
    """Extract what the human actually typed, or None for meta/system records."""
    if record.get("isMeta"):
        return None
    content = record["message"].get("content")
    if isinstance(content, list):
        content = "\n".join(x.get("text", "") for x in content if isinstance(x, dict) and x.get("type") == "text")
    if not isinstance(content, str):
        return None
    content = REMINDER_RE.sub("", content).strip()
    cmd = COMMAND_RE.search(content)
    if cmd:
        return f"{cmd.group(1).strip()} {cmd.group(2).strip()}".strip()
    bash = BASH_INPUT_RE.search(content)
    if bash:
        return "! " + bash.group(1).strip()
    if not content or content.startswith(SKIPPED_USER_PREFIXES):
        return None
    return content


def new_turn():
    """Empty accumulator for one assistant turn."""
    return {
        "text": None,
        "tools": collections.Counter(),
        "errors": collections.Counter(),
        "details": [],
    }


def flush_turn(turn, lines):
    """Emit one assistant turn as a tools summary plus its final text, then reset it."""
    if turn["tools"]:
        summary = ", ".join(f"{k}×{v}" if v > 1 else k for k, v in turn["tools"].most_common())
        details = "; ".join(dict.fromkeys(turn["details"]))
        lines.append(f"  - tools: {summary}" + (f" — {clip(details, TURN_DETAIL_LIMIT)}" if details else ""))
    if turn["errors"]:
        lines.append("  - errors: " + ", ".join(f"{k}×{v}" for k, v in turn["errors"].items()))
    if turn["text"]:
        lines.append(f"  - **A:** {clip(turn['text'], ASSISTANT_TEXT_LIMIT)}")
    turn.update(new_turn())


def digest_session(path, since, until, stats):
    """Return (meta, lines) for one transcript, or None if nothing falls in the window."""
    lines, first_ts, last_ts = [], None, None
    meta = {"cwd": None, "branch": None}
    tool_names = {}
    turn = new_turn()
    for raw in open(path, errors="replace"):
        try:
            rec = json.loads(raw)
        except ValueError:
            continue
        if rec.get("type") not in ("user", "assistant") or rec.get("isSidechain"):
            continue
        ts = rec.get("timestamp")
        if not ts:
            continue
        when = parse_ts(ts)
        if when < since or when > until:
            continue
        first_ts = first_ts or when
        last_ts = when
        meta["cwd"] = meta["cwd"] or rec.get("cwd")
        meta["branch"] = rec.get("gitBranch") or meta["branch"]
        stamp = when.strftime("%m-%d %H:%M")
        content = rec["message"].get("content")

        if rec["type"] == "assistant" and isinstance(content, list):
            for block in content:
                kind = block.get("type")
                if kind == "text" and block.get("text", "").strip():
                    turn["text"] = block["text"]
                elif kind == "tool_use":
                    name = block.get("name", "?")
                    tool_names[block.get("id")] = name
                    stats["tools"][name] += 1
                    detail = tool_detail(name, block.get("input"))
                    if name == "Bash" and detail:
                        program = bash_program(block["input"].get("command", ""))
                        if program:
                            stats["bash"][program] += 1
                    if name == "Skill" and detail:
                        stats["skills"][detail] += 1
                    turn["tools"][name] += 1
                    if name in DETAILED_TOOLS and detail:
                        turn["details"].append(detail)
            continue

        if isinstance(content, list) and any(isinstance(x, dict) and x.get("type") == "tool_result" for x in content):
            for block in content:
                if block.get("type") != "tool_result":
                    continue
                text = result_text(block)
                name = tool_names.get(block.get("tool_use_id"), "?")
                if REJECTION_MARKER in text:
                    stats["rejections"][name] += 1
                    flush_turn(turn, lines)
                    reason = text.split("the user said:", 1)[-1] if "the user said:" in text else ""
                    lines.append(f"- {stamp} **REJECTED `{name}`** {clip(reason, REJECTION_TEXT_LIMIT)}")
                elif block.get("is_error"):
                    stats["errors"][name] += 1
                    turn["errors"][name] += 1
            continue

        text = user_text(rec)
        if text is None:
            continue
        flush_turn(turn, lines)
        if text.startswith(INTERRUPT_MARKER):
            stats["interrupts"] += 1
            lines.append(f"- {stamp} **INTERRUPTED**")
            continue
        if text.startswith("/"):
            stats["commands"][text.split()[0]] += 1
        stats["prompts"] += 1
        lines.append(f"- {stamp} **U:** {clip(text, USER_TEXT_LIMIT)}")

    flush_turn(turn, lines)
    if not lines:
        return None
    meta.update(first=first_ts, last=last_ts)
    return meta, lines


def counter_md(title, counter):
    """Render a Counter as a short Markdown list."""
    if not counter:
        return ""
    rows = "\n".join(f"- {k}: {v}" for k, v in counter.most_common(TOP_N))
    return f"### {title}\n{rows}\n"


def main():
    """Write one digest per session plus index.md into --out."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--since", help="ISO date/time; default: last retro run or 7 days ago")
    parser.add_argument("--until", help="ISO date/time; default: now")
    parser.add_argument("--days", type=int, help="window length ending now; overrides --since")
    parser.add_argument("--project", help="substring filter on project directory name")
    parser.add_argument("--out", required=True)
    parser.add_argument("--mark", action="store_true", help="record --until as the last run and exit")
    args = parser.parse_args()

    now = datetime.now(timezone.utc)
    until = parse_ts(args.until) if args.until else now
    state = load_state()

    if args.mark:
        state["last_run"] = until.isoformat()
        with open(STATE_PATH, "w") as fh:
            json.dump(state, fh, indent=2)
        print(f"last_run = {state['last_run']}")
        return

    if args.days:
        since = now - timedelta(days=args.days)
    elif args.since:
        since = parse_ts(args.since)
    elif state.get("last_run"):
        since = parse_ts(state["last_run"])
    else:
        since = now - timedelta(days=DEFAULT_WINDOW_DAYS)

    os.makedirs(args.out, exist_ok=True)
    stats = {
        "tools": collections.Counter(),
        "bash": collections.Counter(),
        "skills": collections.Counter(),
        "commands": collections.Counter(),
        "rejections": collections.Counter(),
        "errors": collections.Counter(),
        "interrupts": 0,
        "prompts": 0,
    }
    sessions = []
    for path in sorted(glob.glob(os.path.join(PROJECTS_DIR, "*", "*.jsonl"))):
        project_dir = os.path.basename(os.path.dirname(path))
        if args.project and args.project not in project_dir:
            continue
        if datetime.fromtimestamp(os.path.getmtime(path), timezone.utc) < since:
            continue
        result = digest_session(path, since, until, stats)
        if not result:
            continue
        meta, lines = result
        sid = os.path.basename(path)[: -len(".jsonl")]
        name = f"{project_label(project_dir)}__{sid[:8]}.md"
        header = (
            f"# {project_label(project_dir)} — {sid}\n"
            f"cwd: {meta['cwd']} · branch: {meta['branch']} · "
            f"{meta['first']:%Y-%m-%d %H:%M} → {meta['last']:%Y-%m-%d %H:%M} UTC\n\n"
        )
        body = header + "\n".join(lines) + "\n"
        with open(os.path.join(args.out, name), "w") as fh:
            fh.write(body)
        sessions.append((name, project_dir, meta, len(body)))

    index = [
        f"# Retro digest {since:%Y-%m-%d %H:%M} → {until:%Y-%m-%d %H:%M} UTC\n",
        f"Sessions: {len(sessions)} · user prompts: {stats['prompts']} · "
        f"interrupts: {stats['interrupts']} · rejections: {sum(stats['rejections'].values())} · "
        f"digest total: ~{sum(size for *_, size in sessions) // CHARS_PER_TOKEN} tokens\n",
        "## Sessions\n",
    ]
    index += [
        f"- {n} · {m['cwd']} · {m['first']:%m-%d} → {m['last']:%m-%d} · ~{size // CHARS_PER_TOKEN} tokens"
        for n, _, m, size in sessions
    ]
    index.append("\n## Stats\n")
    for title, key in (
        ("Slash commands", "commands"),
        ("Skills invoked", "skills"),
        ("Tools", "tools"),
        ("Bash programs", "bash"),
        ("Rejected tool calls", "rejections"),
        ("Tool errors", "errors"),
    ):
        index.append(counter_md(title, stats[key]))
    with open(os.path.join(args.out, "index.md"), "w") as fh:
        fh.write("\n".join(index))
    print(os.path.join(args.out, "index.md"))
    total = sum(size for *_, size in sessions) // CHARS_PER_TOKEN
    print(f"window: {since.isoformat()} → {until.isoformat()}; sessions: {len(sessions)}; ~{total} tokens")


if __name__ == "__main__":
    main()
