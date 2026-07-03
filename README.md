# lookout — personal tech watch for Claude Code

A [Claude Code skill](https://docs.claude.com/en/docs/claude-code/skills) that turns saved articles and notes into a local, semantically searchable knowledge base. Everything runs on your machine: content is stored in a [Turso](https://turso.tech/) (SQLite-compatible) database and embedded with [Ollama](https://ollama.com/) — no cloud services, no API keys.

## What it does

- **Save an article** (`/lookout add <url>`) — fetches the page, extracts the readable text, writes a summary and tags, stores it, and automatically crawls the most relevant outbound links (up to 2 levels deep, 15 pages max per add).
- **Ask your knowledge base a question** (`/lookout find <question>`) — hybrid semantic + keyword search over everything you saved, answered with cited sources.
- **Jot down a note** (`/lookout note <text>`) — free-text notes get the same summary/tags/embedding treatment as articles.
- **Browse and prune** (`/lookout list`, `/lookout delete`) — list recent entries, filter by tag, delete a single entry or an entire crawl batch in one shot.

## Requirements

- [Claude Code](https://claude.com/claude-code)
- Node.js 20+ (scripts are ESM)
- [Ollama](https://ollama.com/) running locally, with the `nomic-embed-text` model pulled

## Installation

```bash
git clone <this repo> ~/.claude/skills/lookout
npm install --prefix ~/.claude/skills/lookout
ollama pull nomic-embed-text
```

Then, in Claude Code:

```
/lookout init
```

`init` checks each dependency (npm packages, Ollama daemon, embedding model, database) and repairs what it safely can.

## Usage

| Command | Action |
|---|---|
| `/lookout init` | System check & repair |
| `/lookout add <url>` | Fetch, summarize, tag, store — then crawl relevant links |
| `/lookout find <question>` | Semantic + keyword search, answer with citations |
| `/lookout list [tag] [N\|all]` | Recent entries, optionally filtered by tag |
| `/lookout note <free text>` | Store a free-text note |
| `/lookout delete <id\|url>` | Delete one entry, or a whole add-batch via its origin URL |

## How it works

```
add <url>
   │
   ▼
fetch.js ──► readable text + outbound links (Readability + linkedom)
   │
   ▼
Claude writes summary + tags (reusing your existing tag vocabulary)
   │
   ▼
store.js ──► chunk the content ──► embed each chunk (Ollama) ──► Turso DB
   │
   └──► follow up to 5 relevant links (depth 1), then 2 each (depth 2)

find <question>
   │
   ▼
search.js ──► embed the question ──► cosine similarity over chunks
              + keyword matching ──► top entries with best chunks
```

Link crawling is capped at 15 pages per `add` and never goes deeper than 2 levels. Crawled children are tagged `crawled` and share an `origin` (the root URL of the add command), so a whole batch can be deleted at once. If Ollama is down, `find` degrades gracefully to keyword-only search, and pending `add` payloads wait in `~/.lookout/tmp/` to be stored once it is back.

## Storage

Data lives in `~/.lookout/lookout.db` (outside this repo — your content is never committed). Three tables:

- **`entries`** — one row per saved resource: URL (unique), kind (`url` or `note`), title, summary, JSON tags, full extracted content, source domain, project (the directory you were working in when you saved it), origin (root URL of the add batch), timestamps.
- **`chunks`** — the semantic search index: each entry's content split into chunks, each with its embedding stored as a float32 BLOB (768 dimensions, `nomic-embed-text`).
- **`meta`** — key/value config: schema version, embedding model, vector dimensions. Storing the model name in the DB guarantees incompatible embeddings are never mixed.

## Project layout

```
SKILL.md            skill instructions (routing, pipelines, error handling)
scripts/
  init.js           dependency check & repair
  fetch.js          fetch a URL, extract readable text + links
  store.js          chunk, embed, and persist an entry
  search.js         hybrid semantic + keyword search
  list.js           list entries / tags
  delete.js         delete by id, url, or origin batch
  lib/
    db.js           Turso database access & schema
    ollama.js       embedding calls to the local Ollama daemon
    chunk.js        text chunking
    extract.js      readable-content extraction
    cli.js          shared CLI plumbing (JSON output, error codes)
```

All scripts print JSON on stdout and structured errors (`{"error":{code,message,hint}}`) on stderr, so the skill can repair known failures (Ollama down, blocked fetch, bad input) automatically.

## Notes

- `@tursodatabase/database` is pinned to `0.6.1` (beta engine) — bump deliberately.
- Summaries and tags are written by Claude at save time, in English, reusing your existing tag vocabulary to keep the taxonomy consistent.
