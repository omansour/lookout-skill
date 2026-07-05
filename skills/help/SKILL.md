---
description: Show an overview of all lookout tech-watch commands and how to use them. Use when the user asks for help with lookout, wants to know what lookout can do, or how to get started.
---

# lookout — help

Display the following overview to the user, translated into the conversation language if it is not English.

## lookout — personal tech-watch knowledge base

Local-first: Turso DB + Ollama embeddings, no cloud. Data lives in `~/.lookout/lookout.db`.

| Command | What it does |
|---|---|
| `/lookout:init` | Check & repair the system (npm deps, Ollama daemon, embedding model, database). Run this first, or when commands fail. |
| `/lookout:add <url>` | Save an article: fetch, summarize, tag, store, then auto-crawl relevant links. |
| `/lookout:note <text>` | Save a free-text note (no URL) with summary, tags and embeddings. |
| `/lookout:find <question>` | Search the knowledge base (semantic + keyword) and answer with cited sources. |
| `/lookout:list [tag]` | Browse recent top-level entries (newest first), filter by tag or project, see the tag list. |
| `/lookout:delete <id\|url>` | Delete an entry, or a whole add-batch via its origin URL. Always asks confirmation. |

**Getting started**: run `/lookout:init` once, then `/lookout:add <url>` to save your first article.
