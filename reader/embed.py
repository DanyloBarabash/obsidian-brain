"""Optional local sentence embeddings; without fastembed the reader ranks by terms only."""

import base64
import math
import struct
import threading
from pathlib import Path

MODEL = "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"
MODEL_DIR = Path.home() / ".cache" / "brain-reader" / "models"
TEXT_CHARS = 1000
BATCH = 64


def encode(values):
    """Pack a unit-normalised vector as base64 float16 to keep state.json small."""
    norm = math.sqrt(sum(v * v for v in values)) or 1.0
    return base64.b64encode(struct.pack(f"<{len(values)}e", *(v / norm for v in values))).decode()


def decode(text):
    raw = base64.b64decode(text)
    return list(struct.unpack(f"<{len(raw) // 2}e", raw))


def mean(encoded):
    """Unit-normalised mean of encoded vectors, or None."""
    vectors = [decode(v) for v in encoded if v]
    if not vectors:
        return None
    return decode(encode([sum(column) / len(vectors) for column in zip(*vectors)]))


def item_text(item):
    return " ".join([item["title"], item.get("summary") or "", *item.get("tags", [])])[:TEXT_CHARS]


class Embedder:
    """Lazy, thread-safe wrapper around one fastembed model."""

    def __init__(self, model=MODEL, cache_dir=MODEL_DIR):
        self.model_name, self.cache_dir = model, str(cache_dir)
        self.model = None
        self.lock = threading.Lock()

    def vectors(self, texts):
        with self.lock:
            if self.model is None:
                from fastembed import TextEmbedding
                self.model = TextEmbedding(self.model_name, cache_dir=self.cache_dir)
            return [encode([float(x) for x in v]) for v in self.model.embed(list(texts), batch_size=BATCH)]


def load():
    """Return an Embedder when fastembed is installed, else None."""
    try:
        import fastembed  # noqa: F401
    except ImportError:
        return None
    return Embedder()
