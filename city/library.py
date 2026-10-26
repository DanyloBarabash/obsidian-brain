"""Library shelves for liked market articles, kept beside the city state and outside the vault."""

import json
import os
from pathlib import Path
import re
import threading

SHELF_MAX_LENGTH = 40


def shelf_name(value):
    """A shelf label safe to store as one frontmatter scalar; empty means no shelf."""
    name = " ".join(str(value or "").split())
    if len(name) > SHELF_MAX_LENGTH or any(c in name for c in "\"\\:#[]{}"):
        raise ValueError("Invalid shelf name")
    return name


def shelf_class(value):
    """A city class id (district slug) a shelf belongs to; empty means none."""
    klass = str(value or "")
    if klass and not re.fullmatch(r"[a-z][a-z0-9-]{0,39}", klass):
        raise ValueError("Invalid shelf class")
    return klass


class Library:
    """Remember created shelves and the shelf of each liked article that is not yet in Brain."""

    def __init__(self, path):
        self.path = Path(path)
        self.lock = threading.Lock()
        try:
            self.state = json.loads(self.path.read_text(encoding="utf-8"))
        except (FileNotFoundError, ValueError):
            self.state = {"shelves": [], "liked": {}}
        self.state.setdefault("classes", {})

    def save(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.path.with_name(self.path.name + ".tmp")
        temporary.write_text(json.dumps(self.state, ensure_ascii=False, indent=1), encoding="utf-8")
        os.replace(temporary, self.path)

    def shelves(self):
        with self.lock:
            return list(self.state["shelves"])

    def classes(self):
        with self.lock:
            return dict(self.state["classes"])

    def liked_shelf(self, item_id):
        with self.lock:
            return self.state["liked"].get(item_id, "")

    def add_shelf(self, name, klass=None):
        """Create a shelf if new; a given `klass` sets the city class its books take, an empty one clears it."""
        name = shelf_name(name)
        klass = None if klass is None else shelf_class(klass)
        with self.lock:
            if name and name not in self.state["shelves"]:
                self.state["shelves"].append(name)
            if name and klass is not None:
                if klass:
                    self.state["classes"][name] = klass
                else:
                    self.state["classes"].pop(name, None)
            self.save()
        return name

    def shelve_liked(self, item_id, name):
        name = self.add_shelf(name)
        with self.lock:
            if name:
                self.state["liked"][str(item_id)] = name
            else:
                self.state["liked"].pop(str(item_id), None)
            self.save()
        return name

    def take(self, item_id):
        """Forget a liked article's shelf once it moves into Brain, returning that shelf."""
        with self.lock:
            name = self.state["liked"].pop(str(item_id), "")
            self.save()
        return name
