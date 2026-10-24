# Getting Started with Claude Brain

Claude Brain gives Claude a persistent memory across all your sessions.
It stores everything in a folder of text files that you can also browse in Obsidian.

**Time to set up: ~5 minutes.**

---

## What you need

- [Claude Code](https://claude.ai/code) — installed and working
- [Obsidian](https://obsidian.md) — free download
- Terminal (built into Mac and Linux; on Windows use Git Bash)

---

## Step 1 — Download Claude Brain

Open your terminal and run:

```bash
git clone https://github.com/your-repo/claude_obsidian.git
cd claude_obsidian
```

> Don't have git? Download the ZIP from the repo page and unzip it.
> Then open your terminal, type `cd ` (with a space), drag the unzipped folder
> into the terminal window, and press Enter.

---

## Step 2 — Run the installer

```bash
./install.sh --vault ~/brain
```

This does three things:
- Installs the commands, hooks and skills into every Claude config it finds
  (`~/.claude`, `~/.claude-*`, `~/.claude-envs/*/.claude`) and the `obsidian-brain` skill into Codex
  (`--config-dir <dir>` limits Claude configs, `--no-codex` skips Codex)
- Creates a `brain` folder in your home directory — this is where all your memory lives
- Sets everything up so it works automatically

You should see a list of ✓ checkmarks. If you see any errors, check that you have
Python 3 installed (`python3 --version` in the terminal).

---

## Step 3 — Open your brain in Obsidian

1. Open the **Obsidian** app
2. Click **Open folder as vault**
3. Select the `brain` folder (it's in your home directory — same place as Desktop, Documents, etc.)
4. Click **Open**

You'll see the folder structure appear on the left. It looks empty now — that's normal.
Everything Claude Brain writes will appear here automatically.

---

## Step 4 — Create your first project

Open Claude Code (in your terminal or the desktop app).
In the chat, type:

```
/add-vault my-first-project
```

Replace `my-first-project` with whatever you're working on — `work`, `research`, `side-project`, anything.

Claude will confirm the project was created.

---

## Step 5 — Start using it

At the **start of any session**, load your memory:

```
/memory
```

At the **end of any session**, save it:

```
/save-session
```

That's it. Claude now remembers what you worked on.

---

## What the commands do

You don't need to memorize all of these — just `/memory` and `/save-session` to start.

| Command | What it does |
|---|---|
| `/memory` | Loads what Claude knows about your project |
| `/save-session` | Saves today's session to memory |
| `/recall what we decided about X` | Searches memory for something specific |
| `/ingest file-or-link` | Adds a document or webpage to your memory |
| `/note write something here` | Saves a quick note to memory |
| `/add-vault project-name` | Creates a new project workspace |
| `/switch-vault project-name` | Switches to a different project |

---

## Day-to-day usage

```
Open Claude Code
→ /memory
→ work, ask questions, build things
→ /save-session
Close Claude Code
```

Next time you open Claude Code:

```
→ /memory
→ Claude remembers everything from last time
```

---

## Where your data lives

Everything is stored in the `brain` folder you created in Step 2.
It's just text files — you can open them in any text editor, back them up, or sync them
with iCloud / Dropbox / Google Drive like any other folder.

Opening `brain` in Obsidian gives you a visual view of all your notes and how they connect.

---

## Troubleshooting

**"Command not found" when running a `/` command**
Run the installer again: `./install.sh --force` inside the `claude_obsidian` folder.

**"No active vault configured"**
Run `/add-vault your-project-name` to create a project first.

**The brain folder is empty in Obsidian**
Run `/add-vault your-project-name` in Claude Code and then `/save-session` after a session.
Notes only appear after Claude writes them.

**install.sh: permission denied**
Run `chmod +x install.sh` first, then try again.
