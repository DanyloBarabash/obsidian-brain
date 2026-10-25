"""Write Ukrainian descriptions of the top articles with `claude -p`; their text goes to the Claude API."""

import json
import shutil
import subprocess
from pathlib import Path

TEXT_CHARS = 3000
TIMEOUT_SECONDS = 300
MODEL = "sonnet"
FALLBACK_BINARY = Path.home() / ".local" / "bin" / "claude"
SYSTEM = ("Ти редактор ранкової добірки статей для одного читача. Пиши українською. Для кожної статті 3–4 речення: "
          "про що вона, що конкретно в ній є (метод, результат, цифри, інструменти) і кому чи для чого корисна. "
          "Не вигадуй того, чого немає в тексті; якщо тексту замало, так і скажи одним реченням. "
          "Назви моделей, бібліотек і продуктів лишай як є. Без вступів і оцінок на кшталт «цікава стаття».")
SCHEMA = {"type": "object", "required": ["items"], "properties": {"items": {"type": "array", "items": {
    "type": "object", "required": ["id", "about"], "properties": {"id": {"type": "string"}, "about": {"type": "string"}}}}}}


class Describer:
    """Run one structured `claude -p` call per batch, without tools, settings or session history."""

    def __init__(self, binary, workdir, run=subprocess.run):
        self.binary, self.workdir, self.run = str(binary), Path(workdir), run

    def __call__(self, articles):
        """Map article id to description for [{id, title, source, text}]."""
        payload = [{**a, "text": (a.get("text") or "")[:TEXT_CHARS]} for a in articles]
        self.workdir.mkdir(parents=True, exist_ok=True)
        result = self.run([self.binary, "-p", "--model", MODEL, "--tools", "", "--no-session-persistence",
                           "--setting-sources", "", "--strict-mcp-config", "--output-format", "json",
                           "--system-prompt", SYSTEM, "--json-schema", json.dumps(SCHEMA)],
                          input="Опиши кожну статтю зі списку:\n" + json.dumps(payload, ensure_ascii=False),
                          capture_output=True, text=True, timeout=TIMEOUT_SECONDS, cwd=self.workdir)
        if result.returncode != 0:
            raise RuntimeError((result.stderr or result.stdout or "claude failed").strip()[:200])
        reply = json.loads(result.stdout)
        if reply.get("is_error"):
            raise RuntimeError(str(reply.get("result"))[:200])
        known = {a["id"] for a in articles}
        return {x["id"]: x["about"].strip() for x in reply["structured_output"]["items"] if x["id"] in known and x["about"].strip()}


def load(workdir):
    """Return a Describer when the claude CLI is installed, else None."""
    binary = shutil.which("claude") or (FALLBACK_BINARY if FALLBACK_BINARY.exists() else None)
    return Describer(binary, workdir) if binary else None
