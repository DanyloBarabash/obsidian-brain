"""Separate knowledge ownership, document type and the city's functional view."""

from pathlib import PurePosixPath
import re


CIVIC_ROLES = {
    "town-hall": "Ратуша",
    "council": "Рада правил",
    "registry": "Палата реєстрів",
    "city-archive": "Міський архів",
    "planning-office": "Бюро містобудування",
    "infrastructure-office": "Управління інфраструктури",
    "knowledge-library": "Бібліотека знань",
    "library-item": "Матеріал бібліотеки",
}

TOPICS = {
    "sports": ("Спорт і тренування", "#efb15f", "sports"),
    "science": ("Наука й лабораторії", "#83c9ec", "academy"),
    "technology": ("Технології й системи", "#b6a0ff", "observatory"),
    "energy": ("Енергетика", "#99d5ad", "garden"),
    "media": ("Медіа й комунікації", "#ddb4c8", "studio"),
    "games": ("Ігри й творчість", "#f396bc", "studio"),
    "ideas": ("Гора ідей", "#f2c14e", "garden"),
}

# These are product categories, not scientific or municipal standards.
SUBJECTS = {
    "swimming": ("sports", "swimming-pool", "Басейн", ("swimming", "aquatics", "плавання", "плаван")),
    "football": ("sports", "football-centre", "Футбольний центр", ("football", "soccer", "футбол")),
    "cycling": ("sports", "velodrome", "Велодром", ("cycling", "велоспорт", "велосипед")),
    "astronomy": ("science", "observatory", "Обсерваторія", ("astronomy", "астроном")),
    "medicine": ("health", "medical-centre", "Медичний центр", ("medicine", "medical", "медицин", "медич")),
    "music": ("culture", "concert-hall", "Концертний зал", ("music", "музик")),
    "solar": ("energy", "solar-centre", "Сонячна станція", ("solar", "сонячн")),
    "lubrication": ("science", "tribology-lab", "Лабораторія мастил і бульбашок", ("lubric", "мастил", "tribolog", "bubble", "бульбаш")),
    "motion-analysis": ("sports", "motion-lab", "Лабораторія аналізу рухів", ("computer-vision", "computer vision", "pose-estimation", "аналіз рух")),
    "practice-planning": ("sports", "practice-centre", "Центр тренувальних планів", ("sports-ai", "practice plan", "тренувальн план")),
    "knowledge-memory": ("technology", "memory-vault", "Сховище пам’яті", ("knowledge-management", "memory system", "пам’ят")),
    "lab-operations": ("technology", "lab-depot", "Лабораторний склад обліку", ("lab-operations", "inventory", "інвентар")),
    "sports-science": ("sports", "sports-lab", "Лабораторія спортивної науки", ("sports-technology", "sports science", "biomechan", "біомехан")),
}
TOPICS.update({"health": ("Здоров’я й медицина", "#9ed6cb", "academy"),
               "culture": ("Культура й мистецтво", "#deb0cd", "studio")})
CLASS_TOPICS = {"systems-and-agents": "technology", "education-and-research": "science",
                "personal-tools": "technology"}
# Topics with a landmark complex give projects a bay inside it (simulation/facilities.py); others keep own buildings.
DEFAULT_LANDMARKS = {"sports": "sports-lab", "science": "research-lab", "technology": "innovation-centre",
                     "energy": "energy-lab", "media": "media-centre", "games": "arts-centre",
                     "health": "medical-centre", "culture": "concert-hall"}
TOPIC_TERMS = {"sports": ("sport", "спорт", "тренув", "fitness"), "science": ("science", "research", "наук", "дослідж"),
               "technology": ("technology", "software", "технолог", "програм"), "energy": ("energy", "power", "енергет"),
               "media": ("media", "медіа"), "games": ("game", "ігри", "ігров"),
               "health": ("health", "здоров"), "culture": ("culture", "art", "культур", "мистец" )}


def project_profile(path, note, parents, previous=None, established=False):
    """Resolve broad theme separately from the project's own subject and quarter."""
    meta = note["meta"]
    inherited = next((p for p in parents if p.get("topic")), {})
    subject = meta.get("city_subject", "")
    text = " ".join((subject, meta.get("domain", ""), note["title"])).casefold()
    if not subject:
        subject = next((key for key, (_, _, _, terms) in SUBJECTS.items()
                        if any(re.search(r"(?<!\w)"+re.escape(term), text) for term in terms)), "")
    category = SUBJECTS.get(subject)
    inferred = next((key for key,terms in TOPIC_TERMS.items() if any(re.search(r"(?<!\w)"+re.escape(term),text) for term in terms)), "")
    topic = meta.get("city_topic") or (category[0] if category else "") or inferred or inherited.get("topic")
    topic = topic or CLASS_TOPICS.get(meta.get("class"), meta.get("class", "commons"))
    if not re.fullmatch(r"[a-z][a-z0-9]*(?:-[a-z0-9]+)*", topic):
        raise ValueError(f"Invalid city_topic for {path}: {topic}")
    # `city_quarter` explicitly groups a nested hub into another quarter; otherwise the quarter is never moved.
    quarter = meta.get("city_quarter") or (previous or {}).get("cityQuarter") or path.removesuffix(".md")
    function = meta.get("city_landmark") or (category[1] if category and category[0] == topic else DEFAULT_LANDMARKS.get(topic, "district-hall"))
    # `city_landmark: none` opts a project hub out of its own landmark.
    function = "" if function == "none" else function
    return {"topic": topic, "subject": subject, "quarter": quarter, "landmark": function,
            "landmarkTitle": meta.get("city_landmark_title") or (category[2] if category and category[0] == topic else note["title"]),
            "topicTitle": meta.get("city_topic_title") or TOPICS.get(topic, (topic.replace("-", " ").title(),))[0]}


# Reference data of a project also farms a field outside the city (LANDSCAPE.md, LS-11). These are our editorial
# signals, not a standard: a catalogue of parallel entries, or KPI / dataset / contract / reference documents.
REFERENCE_TAGS = {"kpi", "dataset", "reference", "flags", "contract", "config", "procedure", "specification"}
REFERENCE_WORDS = ("reference", "contract", "routes", "specification", "довідник")
FIELD_CATALOGUE = 8


def reference_data(path, meta, title, siblings, role="library"):
    """Whether a project document is reference data; `city_field: true/false` overrides the editorial rule."""
    explicit = str(meta.get("city_field", "")).lower()
    if explicit in ("true", "false"):
        return explicit == "true"
    name = PurePosixPath(path).stem
    if role != "library" or not path.startswith("projects/") or "/documents/" not in path or name.endswith(("current-state", "project-overview")):
        return False
    tags = set(re.findall(r"[\w-]+", str(meta.get("tags", "")).casefold()))
    return siblings >= FIELD_CATALOGUE or bool(tags & REFERENCE_TAGS) or any(word in title.casefold() for word in REFERENCE_WORDS)


def classify(path, meta, owner, source_class, topic="", thematic=False):
    """Return independent facets without moving or duplicating a source note."""
    name = PurePosixPath(path).stem
    role = meta.get("city_role", "")
    scope = meta.get("knowledge_scope", "project" if owner else "class" if path.startswith("classes/") else "global")
    if owner and scope == 'library':
        scope = 'project'
    if owner and role in ('knowledge-library','library-item'):
        role = 'library'
    library = not owner and (path == '_global/library.md' or path.startswith('_global/library/') or scope == 'library'
        or (meta.get('type') in ('article','document') and not path.startswith(('_global/','classes/','projects/'))))
    if library:
        scope = 'library'
        role = 'knowledge-library' if path == '_global/library.md' else 'library-item'
    if not owner and (path == "_global/ideas.md" or path.startswith("_global/ideas/")):
        role = "idea-mountain" if path == "_global/ideas.md" else "idea"
        # Ideas are their own district at the city edge, not part of the full civic centre.
        topic = topic or "ideas"
    if not role:
        if path == "global.md":
            role = "town-hall"
        elif path == "AGENTS.md" or path.startswith("_global/notes/agent-"):
            role = "council"
        elif path.startswith("_global/templates"):
            role = "registry"
        elif path.startswith(("_global/retro", "_global/sessions/")):
            role = "city-archive"
        elif path.startswith("_global/"):
            role = "planning-office" if "map" in name else "infrastructure-office"
        elif path.startswith("projects/claude-brain/") and name == "brain-city-simulation-rules":
            role = "council"
        elif path.startswith("projects/claude-brain/") and (name.startswith("brain-city") or name == "brain-classification"):
            role = "planning-office"
        elif path.startswith("classes/"):
            role = "registry" if thematic else "district-hall"
        elif meta.get("type") in ("org", "hub"):
            role = "headquarters"
        elif "rules" in name or name in ("working-agreements", "repo-workflow"):
            role = "project-council"
        elif "/sessions/" in path:
            role = "project-archive"
        elif "/documents/" in path:
            role = "library"
        else:
            role = "house"
    civic = role in CIVIC_ROLES
    kind = meta.get("type") or ("session" if "/sessions/" in path or path.startswith("_global/retro/") else "document" if "/documents/" in path else "note")
    default = "core" if kind in ("hub", "org", "class") or role in ("town-hall", "council", "project-council") or name in ("current-state", "project-overview", "knowledge-index", "system-map") else "history" if kind == "session" else "reference" if kind in ("document","article") else "supporting"
    importance = meta.get("importance", default)
    rank = {"core": 3, "reference": 2, "supporting": 1, "history": 0}.get(importance)
    if rank is None:
        raise ValueError(f"Unknown importance for {path}: {importance}")
    if topic and not re.fullmatch(r"[a-z][a-z0-9]*(?:-[a-z0-9]+)*", topic):
        raise ValueError(f"Invalid city_topic for {path}: {topic}")
    return {"knowledgeScope": scope, "cityRole": role,
            "cityRoleTitle": CIVIC_ROLES.get(role, {"district-hall": "Районна управа", "headquarters": "Штаб проєкту",
                "project-council": "Правила проєкту", "project-archive": "Архів проєкту", "library": "Бібліотека", "house": "Дім знань",
                "idea-mountain": "Гора ідей", "idea": "Ідея"}.get(role, role)),
            "cityDistrict": "civic" if civic else topic or source_class,
            "cityTopic": topic, "cityImportance": rank, "importanceTitle": importance,
            "topicAnchor": meta.get("city_anchor") == "true",
            "ownerProject": owner or "",
            **({"libraryCategory":meta.get('domain','general'),"libraryShelf":meta.get("library_shelf",""),"librarySource":meta.get('source_url','') if meta.get('source_url','').startswith(('https://','http://')) else ''} if library else {})}
