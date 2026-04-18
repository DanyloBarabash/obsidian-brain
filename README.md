# Claude + Obsidian Kit

Система для роботи з Claude Code та Obsidian як єдиним "другим мозком".
Зберігай сесії, додавай зовнішні документи, відновлюй контекст між сесіями — все через прості slash-команди.

---

## Що це і навіщо

Claude Code не має пам'яті між сесіями. Кожного разу — чистий аркуш.
Obsidian — локальна база знань у вигляді markdown файлів з двосторонніми посиланнями.

Цей kit поєднує їх: Claude Code отримує доступ до vault через MCP сервер і може читати, писати і шукати у твоїх нотатках. Чотири slash-команди покривають весь workflow.

---

## Як це працює

### Slash-команди

Slash-команда — це `.md` файл у папці `~/.claude/commands/`. Назва файлу стає командою. Всередині — інструкції для Claude написані звичайною мовою. Ніякого коду.

Коли ти пишеш `/resume project-api` у Claude Code — він відкриває `resume.md` і виконує кроки описані там: читає проєктні документи з vault через MCP, знаходить останні сесії, формує зведення контексту.

### CLAUDE.md

Файл `CLAUDE.md` у корені vault читається Claude автоматично при кожному старті сесії. Він описує структуру vault, конвенції тегів і правила поведінки. Не треба нічого пояснювати вручну щоразу.

### MCP сервер

`obsidian-mcp` — це міст між Claude Code і vault. Без нього Claude бачить тільки папку з якої запущений. З ним — має повний доступ до vault незалежно від того де ти в терміналі.

---

## Структура репозиторію

```
claude-obsidian-kit/
├── README.md
├── install.sh                       ← встановлює все одною командою
├── commands/                        ← slash-команди, копіюються в ~/.claude/commands/
│   ├── resume.md                    /resume [project]
│   ├── save-to-obsidian.md          /save-to-obsidian
│   ├── ingest.md                    /ingest [file-or-url]
│   └── search.md                    /search <query>
└── vault-template/                  ← шаблон структури vault
    ├── CLAUDE.md                    головний конфіг який Claude читає автоматично
    ├── Projects/
    │   └── README-template.md       шаблон для нового проєкту
    ├── Claude-Sessions/             збережені сесії Claude Code
    ├── Resources/                   інгестовані зовнішні документи
    │   └── originals/               оригінали файлів з Inbox після обробки
    ├── Notes/                       особисті нотатки
    └── Inbox/                       сюди кидаєш файли для /ingest
```

---

## Команди

### `/resume [project]`

Завантажує контекст на початку сесії.

```
/resume project-api
```

Claude знаходить `Projects/project-api/`, читає `README.md` і `decisions.md`, підтягує останні 3 сесії з відповідними тегами і релевантні ресурси. Виводить зведення: стек, відкриті рішення, останні сесії, наступні кроки.

Без аргументу — показує список доступних проєктів і питає який завантажити.

---

### `/save-to-obsidian`

Зберігає поточну сесію у vault.

Claude аналізує розмову, формує чернетку і показує її перед збереженням:

```
Ready to save session to Obsidian:

File: Claude-Sessions/2026-04-18-auth-refactor.md
Tags: #session #project-api #auth #jwt

Links to propose:
  [1] Projects/project-api/decisions.md — додано рішення про JWT  (high)
  [2] Resources/2026-04-01-jwt-handbook.md — використовували як референс  (high)
  [3] Notes/system-design.md — пов'язана тема  (medium)

Accept all [enter], remove links [type numbers to skip], or edit topic [t]:
```

Ти підтверджуєш або прибираєш зайві лінки. Claude записує файл і оновлює пов'язані нотатки — додає зворотні посилання.

Структура збереженої сесії:
```markdown
---
date: 2026-04-18 17:30
project: project-api
tags: [#session, #project-api, #auth]
---

# Session: auth-refactor

## Quick summary
## Decisions made
## Solutions & fixes
## Files modified
## Open tasks
## Key learnings
## Links

---
## Raw session log
(повний текст сесії — не завантажується автоматично, тільки для пошуку)
```

---

### `/ingest [file-or-url]`

Додає зовнішній документ у vault і прив'язує його до існуючих нотаток.

Підтримує:
- URL статті або документації
- Локальний PDF або текстовий файл
- Без аргументу — обробляє всі файли з папки `Inbox/`

```
/ingest https://martinfowler.com/articles/microservices.html
/ingest ~/Downloads/architecture-patterns.pdf
/ingest
```

Claude витягує суть документа, шукає по vault що пов'язано, пропонує лінки з поясненням і рівнем впевненості (high / medium / low). Ти підтверджуєш які залишити.

Результат у `Resources/`:
```markdown
---
source: https://...
type: article
date-added: 2026-04-18
tags: [#resource, #microservices, #architecture]
---

# Microservices (Fowler)

## Суть
## Що релевантно для мене
## Key quotes
## Links

---
## Full content
(повний текст — не завантажується автоматично)
```

---

### `/search <query>`

Шукає по всьому vault.

```
/search JWT refresh tokens
/search як ми вирішили проблему з міграціями
/search project-api performance
```

Шукає по Projects, Claude-Sessions, Resources, Notes. Читає тільки summary-секції, не raw логи — тому швидко і без зайвих токенів. Повертає до 5 результатів на секцію з уривками.

---

## Workflow

### Звичайна сесія

```
# Початок
/resume project-api

# ... робота ...

# Кінець
/save-to-obsidian
/compact              ← вбудована команда Claude Code, завжди остання
```

### Додати документ

```
# Варіант 1: одразу з URL або шляху
/ingest https://docs.example.com/api-reference

# Варіант 2: кинути файл в Inbox/ і запустити без аргументів
/ingest
```

### Знайти щось зі старих сесій

```
/search авторизація
/search project-b рішення по базі даних
```

### Сумісність з CPR

Якщо також використовуєш [CPR (Compress, Preserve, Resume)](https://github.com/EliaAlberti/cpr-compress-preserve-resume):

```
/preserve             ← оновлює CLAUDE.md в проєкті (CPR)
/save-to-obsidian     ← зберігає в Obsidian vault (цей kit)
/compact              ← завжди останнє
```

---

## Встановлення

### Потрібно

- **Claude Code** — встановлений і залогінений (`claude --version` має працювати)
- **Node.js 18+** — перевір: `node --version`
- **npm** — йде разом з Node.js
- **Obsidian** — опціональний, але рекомендований для перегляду графу зв'язків

Якщо Claude Code ще не встановлений:

```bash
npm install -g @anthropic-ai/claude-code
claude login
```

---

### Крок 1 — Клонувати репо

```bash
git clone https://github.com/YOUR_USERNAME/claude-obsidian-kit.git
cd claude-obsidian-kit
```

---

### Крок 2 — Запустити install.sh

```bash
chmod +x install.sh
./install.sh
```

Скрипт інтерактивний — запитає шлях до vault і зробить все автоматично:

| Що робить | Деталі |
|-----------|--------|
| Встановлює MCP сервер | `npm install -g @bitbonsai/mcpvault` |
| Реєструє MCP сервер | `claude mcp add obsidian -- npx @bitbonsai/mcpvault <path>` |
| Копіює slash-команди | `~/.claude/commands/*.md` |
| Вимикає auto-compact | `claude config set --global autoCompact false` |
| Копіює шаблон vault | тільки якщо папка порожня |

Якщо vault ще не існує — залиш поле порожнім, скрипт створить `~/obsidian-vault/`.

---

### Крок 3 — Перевірити що MCP підключився

Перезапусти Claude Code і запусти:

```text
/mcp
```

Має з'явитись рядок з `obsidian` зі статусом `connected`. Якщо ні — дивись [Troubleshooting](#troubleshooting).

---

### Крок 4 — Перший проєкт

```bash
# Створи папку для проєкту у vault
mkdir -p ~/your-vault/Projects/my-project

# Скопіюй шаблон
cp vault-template/Projects/README-template.md ~/your-vault/Projects/my-project/README.md
```

Відредагуй `README.md` — заповни стек, ціль, перші питання. Потім у Claude Code:

```text
/resume my-project
```

---

## Перевірка після встановлення

Щоб переконатись що все працює:

#### 1. MCP підключений

```text
/mcp
```

→ `obsidian  connected`

#### 2. Команди доступні

```text
/resume
```

→ Claude має відповісти питанням про проєкт або списком Projects/

#### 3. MCP читає vault

```text
/search test
```

→ Claude має спробувати шукати (навіть якщо нічого не знайде)

#### 4. Збереження працює

```text
/save-to-obsidian
```

→ Claude покаже preview файлу перед збереженням

---

## Ручне встановлення (без install.sh)

```bash
# 1. Встановити MCP сервер
npm install -g @bitbonsai/mcpvault

# 2. Додати в конфіг Claude Code
claude mcp add obsidian -- npx @bitbonsai/mcpvault /absolute/path/to/your/vault

# 3. Скопіювати команди
mkdir -p ~/.claude/commands
cp commands/*.md ~/.claude/commands/

# 4. Вимкнути auto-compact
claude config set --global autoCompact false

# 5. Скопіювати структуру vault (якщо новий vault)
cp -r vault-template/* /path/to/your/vault/
```

---

## Конфігурація

### Де зберігаються налаштування

| Що | Шлях |
|----|------|
| Slash-команди | `~/.claude/commands/*.md` |
| MCP конфіг | `~/.claude/claude.json` (або `claude mcp list`) |
| Глобальні налаштування | `claude config list` |

### Змінити vault після встановлення

```bash
# Видалити старий MCP запис і додати новий
claude mcp remove obsidian
claude mcp add obsidian -- npx @bitbonsai/mcpvault /new/path/to/vault
```

### Кастомізувати команди

Команди — звичайні markdown файли. Відкрий будь-яку з `~/.claude/commands/*.md` і відредагуй інструкції. Зміни набирають чинності з наступного запуску Claude Code.

Додати нову команду:

```bash
# Наприклад, /standup для щоденного звіту
touch ~/.claude/commands/standup.md
# Відредагуй файл — опиши що має робити Claude
```

### CLAUDE.md у vault

`vault/CLAUDE.md` читається при кожній сесії де MCP підключений. Редагуй його щоб:

- Описати нові проєкти в таблиці
- Додати теги до таксономії
- Змінити мову зведень

---

## Troubleshooting

### `/mcp` не показує `obsidian`

```bash
# Перевір чи пакет встановлений
npm list -g @bitbonsai/mcpvault

# Якщо не знайдено:
npm install -g @bitbonsai/mcpvault

# Перевір список зареєстрованих MCP
claude mcp list

# Якщо obsidian відсутній — додай вручну
claude mcp add obsidian -- npx @bitbonsai/mcpvault /absolute/path/to/vault
```

### MCP показує `error` або `disconnected`

```bash
# Перевір чи шлях до vault правильний
claude mcp list
# Знайди рядок obsidian і перевір --vault аргумент

# Переконайся що папка існує
ls /path/to/your/vault

# Перезапусти Claude Code після виправлення
```

### Команди не з'являються (немає `/resume` тощо)

```bash
# Перевір чи файли скопійовані
ls ~/.claude/commands/

# Якщо папки немає або файли відсутні:
mkdir -p ~/.claude/commands
cp /path/to/claude-obsidian-kit/commands/*.md ~/.claude/commands/
```

Команди з'являються тільки після **перезапуску** Claude Code.

### Claude не бачить файли у vault

MCP сервер потребує **абсолютний** шлях. Перевір:

```bash
claude mcp list
# Рядок має виглядати так:
# obsidian: npx @bitbonsai/mcpvault /Users/you/your-vault
```

Відносні шляхи (`~/vault`, `./vault`) можуть не працювати — використовуй `$(pwd)` або повний шлях:

```bash
claude mcp remove obsidian
claude mcp add obsidian -- npx @bitbonsai/mcpvault "$HOME/your-vault"
```

### `auto-compact` не вимкнений

```bash
claude config list | grep autoCompact
# Якщо не false:
claude config set --global autoCompact false
```

---

## Структура vault детально

```text
vault/
├── CLAUDE.md                    ← читається автоматично при кожному старті
├── Projects/
│   └── my-project/
│       ├── README.md            стек, мета, статус, відкриті питання
│       ├── decisions.md         лог архітектурних рішень
│       └── ...
├── Claude-Sessions/
│   └── 2026-04-18-topic.md      збережені сесії з тегами і лінками
├── Resources/
│   ├── 2026-04-18-article.md    інгестовані зовнішні документи
│   └── originals/               оригінали файлів після обробки з Inbox
├── Notes/
│   └── ...                      особисті нотатки
└── Inbox/
    └── (кидаєш файли сюди)      /ingest без аргументу обробляє все тут
```

---

## FAQ

**Чи потрібен Obsidian app?**
Ні. Vault — це просто папка з markdown файлами. Claude Code працює з ними через MCP незалежно від того чи відкритий Obsidian. Але Obsidian дає граф зв'язків і зручний перегляд — варто мати.

**Що таке `/compact` і чому він завжди останній?**
Вбудована команда Claude Code яка стискає вікно контексту. Вона стирає деталі розмови — тому завжди після збереження, не до.

**Чи синхронізується vault між пристроями?**
Так, якщо vault у iCloud, Dropbox або git репо. Команди в `~/.claude/commands/` треба встановити окремо на кожному пристрої.

**Чи можна використовувати з існуючим vault?**
Так. Скопіюй тільки `CLAUDE.md` і папки яких не вистачає. Існуючі нотатки залишаться без змін.

**Raw session log і Full content ніколи не завантажуються автоматично — навіщо вони тоді?**
Для `/search` — grep по файлах знаходить контент навіть у цих секціях. І для ручного перегляду якщо треба відновити щось конкретне.

---

## Натхнення

- [CPR — Compress, Preserve, Resume](https://github.com/EliaAlberti/cpr-compress-preserve-resume) by Elia Alberti — ідея slash-команд для пам'яті Claude Code
- [Obsidian](https://obsidian.md) — локальна база знань
- [Model Context Protocol](https://modelcontextprotocol.io) — стандарт для підключення інструментів до LLM

---

## Ліцензія

MIT
