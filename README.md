# lookout — personal tech watch for Claude Code

A [Claude Code plugin](https://code.claude.com/docs/en/plugins) that turns saved articles and notes into a local, semantically searchable knowledge base. Everything runs on your machine: content is stored in a [Turso](https://turso.tech/) (SQLite-compatible) database and embedded with [Ollama](https://ollama.com/) — no cloud services, no API keys.

## What it does

- **Save an article** (`/lookout:add <url>`) — fetches the page, extracts the readable text, writes a summary and tags, stores it, and automatically crawls the most relevant outbound links (up to 2 levels deep, 15 pages max per add). The whole pipeline runs **asynchronously in a background subagent**: you keep working while it indexes, and get a tree recap (root → crawled children, with skipped/failed links) when it finishes.
- **Ask your knowledge base a question** (`/lookout:find <question>`) — hybrid semantic + keyword search over everything you saved, answered with cited sources.
- **Jot down a note** (`/lookout:note <text>`) — free-text notes get the same summary/tags/embedding treatment as articles.
- **Browse and prune** (`/lookout:list`, `/lookout:delete`) — list recent entries grouped by add-batch, filter by tag, delete a single entry or an entire crawl batch in one shot.

## Requirements

- [Claude Code](https://claude.com/claude-code)
- Node.js 20+ (scripts are ESM)
- [Ollama](https://ollama.com/) running locally, with the `nomic-embed-text` model pulled

## Installation

### Recommended: plugin marketplace

This repository is its own [plugin marketplace](https://code.claude.com/docs/en/plugin-marketplaces). In Claude Code:

```
/plugin marketplace add omansour/lookout-skill
/plugin install lookout@lookout
```

Then finish the setup (pulls the embedding model, installs the npm dependencies, creates the database):

```bash
ollama pull nomic-embed-text
```

```
/lookout:init
```

`init` checks each dependency (npm packages, Ollama daemon, embedding model, database) and repairs what it safely can — in particular it gives you the exact `npm install --prefix …` command for wherever the plugin is installed.

**Updating**: `/plugin update lookout` (new versions are published by bumping `version` in the plugin manifest). Re-run `/lookout:init` after an update if dependencies changed.

### Alternative: manual clone

```bash
git clone https://github.com/omansour/lookout-skill.git ~/.claude/skills/lookout
npm install --prefix ~/.claude/skills/lookout
ollama pull nomic-embed-text
```

Thanks to the plugin manifest, a clone in `~/.claude/skills/` is auto-loaded as a [skills-directory plugin](https://code.claude.com/docs/en/plugins-reference#skills-directory-plugins) with the same `/lookout:*` skill names. Updating: `git pull` (+ `npm install` if dependencies changed).

Both channels are **global, user-level installs**: the skills are available in every Claude Code session, whatever project you are working in — one plugin, one database (`~/.lookout/`), shared across all your projects.

> **Why no `npx skills add` channel?** The [skills CLI](https://github.com/vercel-labs/skills) copies individual skill folders (pure `SKILL.md` skills). lookout's skills drive shared Node scripts living at the plugin root (`scripts/`, `package.json`), which that channel would not carry along.

## Usage

| Command | Action |
|---|---|
| `/lookout:init` | System check & repair |
| `/lookout:add <url>` | Fetch, summarize, tag, store — then crawl relevant links |
| `/lookout:find <question>` | Semantic + keyword search, answer with citations |
| `/lookout:list [tag] [N\|all]` | Recent entries grouped by add-batch, optionally filtered by tag |
| `/lookout:note <free text>` | Store a free-text note |
| `/lookout:delete <id\|url>` | Delete one entry, or a whole add-batch via its origin URL |

You can also just talk to Claude ("save this article for my tech watch", "what did I save about MCP?") — the skills are picked automatically from context.

Every entry records the **project** (working directory) it was saved from. `find` and `list` query the whole base by default; scope them to a project in plain language — "find X *in this project*", "list my watch *for project foo*" — and the query is filtered in SQL via `--project` (with `--project .` resolving to the current directory's name).

`list` returns entries **already grouped by add-batch** (shared `origin`): the SQL query orders batches newest-first, puts the root entry before its crawled children, and flags batches cut by the limit (`truncated`) — no post-processing needed on the rendering side.

## Example session

Indexing an article — the add runs in the background and ends with a crawl recap:

```
> /lookout:add https://aws.amazon.com/blogs/machine-learning/build-generative-ui-for-ai-agents-on-amazon-bedrock-agentcore-with-the-ag-ui-protocol/

Indexing started in the background — you can keep working, I'll post the recap when it finishes.

[…later…]

Indexed 7 pages:
● Build generative UI for AI agents on Amazon Bedrock AgentCore with the AG-UI protocol (14 chunks)
├── AG-UI Overview - Agent User Interaction Protocol (5 chunks) [crawled]
│   └── AG-UI protocol contract - Amazon Bedrock AgentCore (4 chunks) [crawled]
├── Amazon Bedrock AgentCore Gateway (8 chunks) [crawled]
├── Add memory to your Amazon Bedrock AgentCore agent (6 chunks) [crawled]
│   └── fullstack-solution-template-for-agentcore/docs/DEPLOYMENT.md (9 chunks) [crawled]
└── skipped: https://modelcontextprotocol.io/docs/getting-started/intro (already saved)
```

Searching the knowledge base — semantic search, answered with citations:

```
> /lookout:find how do agents stream UI updates to the frontend?

Two saved resources cover this directly:

- [AG-UI Overview](https://docs.ag-ui.com/introduction) — AG-UI is an open, event-based
  protocol standardizing bi-directional connections between user-facing apps and any
  agentic backend, built on HTTP/WebSockets…
- [AG-UI protocol contract](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-agui-protocol-contract.html)
  — AgentCore Runtime implements the AG-UI contract: the agent emits TEXT_MESSAGE_*,
  TOOL_CALL_* and STATE_DELTA events consumed by the frontend…
```

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
.claude-plugin/
  plugin.json       plugin manifest (name, version — bump to publish an update)
  marketplace.json  this repo doubles as its own plugin marketplace
skills/
  init/SKILL.md     dependency check & repair
  add/SKILL.md      index a URL + crawl relevant links (async subagent pipeline)
  find/SKILL.md     answer a question with citations
  list/SKILL.md     browse entries grouped by add-batch
  note/SKILL.md     store a free-text note
  delete/SKILL.md   delete an entry or an origin batch (with confirmation)
scripts/
  init.js           diagnostics + safe repairs
  fetch.js          fetch a URL, extract readable text + links
  store.js          chunk, embed, and persist an entry
  search.js         hybrid semantic + keyword search
  list.js           entries grouped by add-batch / tag counts
  delete.js         delete by id, url, or origin batch
  lib/
    db.js           Turso database access & schema (all SQL lives here)
    ollama.js       embedding calls to the local Ollama daemon
    chunk.js        text chunking
    extract.js      readable-content extraction
    cli.js          shared CLI plumbing (JSON output, error codes)
```

All scripts print JSON on stdout and structured errors (`{"error":{code,message,hint}}`) on stderr, so the skills can repair known failures (Ollama down, blocked fetch, bad input) automatically. Skills locate the scripts through their plugin root (announced as each skill's base directory), so both install channels work unchanged.

## Development

```bash
git clone https://github.com/omansour/lookout-skill.git && cd lookout-skill
npm install
claude plugin validate .
claude --plugin-dir . # test your changes in a live session
```

## Notes

- `@tursodatabase/database` is pinned to `0.6.1` (beta engine) — bump deliberately.
- Summaries and tags are written by Claude at save time, in English, reusing your existing tag vocabulary to keep the taxonomy consistent.
