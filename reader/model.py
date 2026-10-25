"""Learn reading preferences from feedback and rank items."""

import math
import random
import re
from collections import Counter

from embed import decode

# Scenario parameters for one reader; see README "Параметри сценарію".
LEARNING_RATE = 0.6
L2 = 0.001
MIN_TOKEN_CHARS = 2
TITLE_WEIGHT = 2.0
TAG_WEIGHT = 2.0
SUMMARY_TOKENS = 120
SOURCE_FEATURE_WEIGHT = 0.5
PRIOR_WEIGHT = 0.4
PRIOR_TERMS = 200
TOPIC_WEIGHT = 1.5
FRESH_HALF_LIFE_HOURS = 36
FRESH_FLOOR = 0.25
SOURCE_REPEAT_PENALTY = 0.85
EXPLORE_EVERY = 5
EXPLAIN_TERMS = 3
# Embedding dimensions sit next to terms in one linear model; the vector is unit length like the terms.
EMBED_WEIGHT = 1.0
SEMANTIC = "e:"
SEMANTIC_LABEL = "схожий зміст"
# Below this the embedding pull is the common baseline every article gets, not a reason.
SEMANTIC_EXPLAIN_MIN = 0.25
SECONDS_PER_HOUR = 3600

TOKEN = re.compile(r"[a-zа-яіїєґ0-9][a-zа-яіїєґ0-9+#]*", re.I)
STOPWORDS = set("""
a about after again all also an and any are as at be been before being but by can could did do does
for from get got had has have how i if in into is it its just like make more most my new no not now of
on one only or other our out over so some than that the their them then there these they this to too up
us use used using via was we were he me am go yes what when where which who why will with would you your yours
amp http https www com reddit submitted comments link points day days week year years first best
і й та в у на з із до за що як це чи не від для по а але або ж ще так
""".split())
# Structural Brain tags that describe notes, not reading interests.
PRIOR_STOPWORDS = {"hub", "global", "class", "current", "state", "run", "audit", "client", "reference", "session",
                   "note", "document", "epoch", "inventory", "kpi", "thresholds"}


def tokens(text):
    """Lowercase content words, including Ukrainian, without stopwords or bare numbers."""
    result = []
    for word in TOKEN.findall((text or "").lower()):
        if len(word) >= MIN_TOKEN_CHARS and word not in STOPWORDS and not word.isdigit():
            result.append(word)
    return result


def features(item):
    """Return an L2-normalised sparse vector for one item."""
    counts = Counter()
    for word in tokens(item["title"]):
        counts[word] += TITLE_WEIGHT
    for word in tokens(item.get("summary", ""))[:SUMMARY_TOKENS]:
        counts[word] += 1
    for tag in item.get("tags", []):
        for word in tokens(tag.replace("-", " ")):
            counts[word] += TAG_WEIGHT
    norm = math.sqrt(sum(v * v for v in counts.values())) or 1.0
    vector = {k: v / norm for k, v in counts.items()}
    vector["src:" + item["source"]] = SOURCE_FEATURE_WEIGHT
    if item.get("vec"):
        vector.update(semantic(decode(item["vec"]), EMBED_WEIGHT))
    return vector


def semantic(values, weight):
    """Spread a dense vector over embedding feature keys."""
    return {f"{SEMANTIC}{i}": weight * x for i, x in enumerate(values)}


def sigmoid(value):
    return 1 / (1 + math.exp(-max(-30.0, min(30.0, value))))


def vault_prior(tag_counts):
    """Turn Brain tag counts into weak positive term weights."""
    words = Counter()
    for tag, count in tag_counts.items():
        for word in tokens(tag.replace("-", " ")):
            if word not in PRIOR_STOPWORDS:
                words[word] += count
    top = words.most_common(PRIOR_TERMS)
    peak = math.log1p(top[0][1]) if top else 1.0
    return {word: round(PRIOR_WEIGHT * math.log1p(count) / peak, 4) for word, count in top}


def topic_weights(phrases):
    """Give every word of a declared interest a fixed boost."""
    return {word: TOPIC_WEIGHT for phrase in phrases for word in tokens(phrase)}


class Profile:
    """Online logistic regression over item terms plus a Brain prior and declared topics."""

    def __init__(self, weights=None, bias=0.0, prior=None, topics=None):
        self.weights = dict(weights or {})
        self.bias = bias
        self.prior = dict(prior or {})
        self.topics = dict(topics or {})

    def fixed(self, key):
        return self.prior.get(key, 0.0) + self.topics.get(key, 0.0)

    def raw(self, vector):
        return self.bias + sum((self.weights.get(k, 0.0) + self.fixed(k)) * x for k, x in vector.items())

    def probability(self, vector):
        return sigmoid(self.raw(vector))

    def learn(self, vector, label):
        """Move the profile towards (label=1) or away from (label=0) one item."""
        gradient = label - self.probability(vector)
        for key, x in vector.items():
            weight = self.weights.get(key, 0.0)
            weight += LEARNING_RATE * (gradient * x - L2 * weight)
            self.weights[key] = round(weight, 5)
        self.bias = round(self.bias + LEARNING_RATE * gradient * 0.1, 5)

    def explain(self, vector):
        """Name the terms that pushed this item up the most."""
        parts = [(k, (self.weights.get(k, 0.0) + self.fixed(k)) * x) for k, x in vector.items() if not k.startswith(SEMANTIC)]
        meaning = sum((self.weights.get(k, 0.0) + self.fixed(k)) * x for k, x in vector.items() if k.startswith(SEMANTIC))
        if meaning >= SEMANTIC_EXPLAIN_MIN:
            parts.append((SEMANTIC_LABEL, meaning))
        return [k for k, v in sorted(parts, key=lambda p: -p[1]) if v > 0 and not k.startswith("src:")][:EXPLAIN_TERMS]

    def forget(self, term):
        self.weights.pop(term, None)
        self.prior.pop(term, None)

    def to_json(self):
        return {"weights": self.weights, "bias": self.bias, "prior": self.prior}


def freshness(published, now):
    if not published:
        return FRESH_FLOOR
    age_hours = max(0.0, now - published) / SECONDS_PER_HOUR
    return FRESH_FLOOR + (1 - FRESH_FLOOR) * 0.5 ** (age_hours / FRESH_HALF_LIFE_HOURS)


def rank(items, profile, now, seed, limit):
    """Order items by predicted interest with source diversity and exploration slots.

    Every EXPLORE_EVERY-th slot takes a random item from the lower half, so the feed
    keeps sampling outside the learnt profile. `seed` keeps the order stable within a day.
    """
    scored = []
    for item in items:
        vector = features(item)
        probability = profile.probability(vector)
        scored.append({**item, "score": round(probability, 3), "why": profile.explain(vector),
                       "_rank": probability * freshness(item.get("published"), now), "explore": False})
    scored.sort(key=lambda x: (-x["_rank"], x["id"]))
    explore_pool = scored[len(scored) // 2:]
    rng = random.Random(seed)
    rng.shuffle(explore_pool)
    picked, seen_sources, taken = [], Counter(), set()
    while scored and len(picked) < limit:
        if (len(picked) + 1) % EXPLORE_EVERY == 0:
            choice = next((x for x in explore_pool if x["id"] not in taken), None)
            if choice:
                choice["explore"] = True
        else:
            choice = None
        if choice is None:
            choice = max((x for x in scored if x["id"] not in taken),
                         key=lambda x: x["_rank"] * SOURCE_REPEAT_PENALTY ** seen_sources[x["source"]], default=None)
        if choice is None:
            break
        taken.add(choice["id"])
        seen_sources[choice["source"]] += 1
        picked.append(choice)
    for item in picked:
        item.pop("_rank", None)
    return picked
