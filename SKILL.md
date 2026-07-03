---
name: lookout
description: Personal tech-watch knowledge base with local semantic search (Turso DB + Ollama embeddings). Use when the user wants to save an article/URL for later reference, search their saved tech-watch resources, add a free-text note, or prepare documentary research before starting a project. Subcommands - init, add <url>, find <question>, list, note <text>.
allowed-tools: Bash(node:*), Bash(npm install:*), Bash(ollama pull:*), WebFetch, Write, Read, Agent
---

# lookout — personal tech watch

Local knowledge base of articles and notes, stored in a Turso database (`~/.lookout/lookout.db`)
with vector embeddings (Ollama, nomic-embed-text) for semantic search.

Constants:
- `SKILL_DIR` = `~/.claude/skills/lookout`
- All script calls: `node $SKILL_DIR/scripts/<script>.js …`
- Scripts print JSON on stdout (success, exit 0) or `{"error":{code,message,hint}}` on stderr (exit 2 = repairable, follow the hint; exit 1 = unexpected, show raw stderr to the user).

## Routing

Route on the first argument:

| Argument | Action |
|---|---|
| `init` | System check & repair (see **init**) |
| `add <url>` | Fetch, summarize, tag, store (see **add**) |
| `find <question>` | Semantic + keyword search, answer with citations (see **find**) |
| `list [tag] [N|all]` | Recent entries, optionally filtered by tag and/or limited to N (see **list**) |
| `note <free text>` | Store a free-text note (see **note**) |
| `delete <id\|url>` | Delete an entry after confirmation (see **delete**) |
| none / unknown | Show a short help table of the subcommands above |

## init

1. Run `node $SKILL_DIR/scripts/init.js`.
2. For each check with `status:"fail"`, apply the safe fixes yourself:
   - npm deps → run the given `npm install --prefix …` command
   - embedding model → run `ollama pull nomic-embed-text`
   - Ollama daemon down → do NOT spawn it; tell the user to start the Ollama app or run `ollama serve`, then re-run init.
3. Re-run init.js after fixes, until `ok:true` (or only the daemon check blocks and the user has been told).
4. Present a recap table: check | status | detail.

## add `<url>`

**Run asynchronously in a subagent.** Do not execute the pipeline below in the main
conversation. Instead, launch it in the background so the user can keep working:

- Tool: Agent, `subagent_type: "general-purpose"`, `model: "sonnet"`, `run_in_background: true`
  (summarizing, tagging, and link triage are well within Sonnet — no need for a bigger model).
- The agent prompt must contain: the target URL, the full pipeline below (steps 1–7 including
  the crawl rules and caps), the script paths under `$SKILL_DIR/scripts/`, the entry JSON format,
  and the instruction to return the final tree recap (root → children → grandchildren, with
  skipped/failed links and reasons) as its final message.
- Exception — stay synchronous when the root URL already exists (`existing` not null): run
  step 1 inline first; if it reports `existing`, ask the user whether to update before spawning.
  If unsure, spawn anyway and let the agent skip existing URLs.
- After spawning, tell the user indexing started in the background and they'll get the recap
  when it finishes. When the agent completes, relay its tree recap.

### Pipeline (executed by the subagent)

1. Run `node $SKILL_DIR/scripts/fetch.js "<url>"`.
   - If `existing` is not null: ask the user whether to update the saved entry; on no, stop.
   - If exit 2 (`FETCH_BLOCKED` / `EXTRACT_EMPTY` / `UNSUPPORTED_TYPE`): fall back to **WebFetch** on the URL with prompt "Return the full readable text of this page, plus its title." Use that as title/content; keep the normalized URL from the error context or normalize yourself (strip fragment and utm_* params).
2. Run `node $SKILL_DIR/scripts/list.js --tags` to see existing tags.
3. Write a **3–5 sentence English summary** of the content and pick **3–6 tags**:
   reuse existing tags when relevant; new tags in kebab-case English.
4. Write (Write tool) the full entry JSON to `~/.lookout/tmp/entry-<epoch>.json`:
   ```json
   {"url": "<normalized url>", "kind": "url", "title": "…", "summary": "…",
    "tags": ["…"], "content": "<full extracted text>",
    "source_domain": "<hostname>", "project": "<basename of cwd>",
    "origin": "<normalized ROOT url of this add command>"}
   ```
   `origin` is the same for the root entry and every crawled child — it groups the whole
   add-batch so it can be deleted in one shot later.
5. Run `node $SKILL_DIR/scripts/store.js --file <that path>`. On success, delete the tmp file.
6. Confirm to the user: title, tags, `created`/`updated`, chunk count.
7. **Follow relevant links (automatic, max 2 levels deep).** fetch.js returns the article's
   outbound `links` ({url, text}). Select the ones genuinely relevant to the page's topic —
   substantive documentation/articles/references, NOT home pages, pricing, sign-up, social,
   or generic navigation. Then, without asking for approval:
   - **Depth 1**: index up to **5** selected links, each via the same pipeline (steps 1–6,
     skipping any URL whose fetch reports `existing` — count it as "skipped (already saved)").
   - **Depth 2**: from each depth-1 page, select and index up to **2** relevant links.
   - **Never go deeper than depth 2. Hard cap: 15 pages total per add** (the root counts as 1).
   - Keep summaries/tags per page as usual; add the tag `crawled` to depth-1/2 entries.
   - Finish with a tree recap: root → indexed children (and grandchildren), plus skipped/failed
     links with the reason. Failed child fetches are reported, not retried via WebFetch —
     the fallback is for the root URL only.

## find `<question>`

1. Run `node $SKILL_DIR/scripts/search.js "<question>" --limit 8` (add `--tag <t>` if the user filtered).
2. **Answer the user's question** using the results' `summary` and `best_chunk`, citing every source you use with its URL (markdown link).
3. If a `warning` is present (vector disabled), mention search ran in keyword-only mode.
4. If results are empty or clearly off-topic, say so honestly and suggest `/lookout add <url>` to grow the base.

## list

Run `node $SKILL_DIR/scripts/list.js --limit 15` (add `--tag <t>` if given, `--tags` if the user asks for the tag list).
If the user gives a number or asks for more/all, adjust `--limit` accordingly (use `--limit 100000` for "all").
Render a markdown table: title (linked to URL), tags, project, date.

## note `<free text>`

1. Derive a short title, a 1–3 sentence summary, and 3–6 tags from the text (reuse existing tags via `list.js --tags`).
2. Write the JSON to `~/.lookout/tmp/entry-<epoch>.json` with `"kind":"note","url":null` and the full text as `content`.
3. Run `store.js --file <path>`, delete the tmp file, confirm.

## delete `<id|url>` — single entry or whole add-batch

**Single entry:**
1. If the user gave a description instead of an id/url ("delete the limbo article"), find the entry first via `list.js` or `search.js` and identify its id.
2. Show the entry (title, url, tags) and **ask the user to confirm** before deleting.
3. Run `node $SKILL_DIR/scripts/delete.js <id|url>`. Confirm what was deleted.
   `NOT_FOUND` (exit 2) → show available entries via list.

**Whole add-batch** (user says "delete everything from the sli.dev add", "remove that whole crawl"…):
1. Preview: `node $SKILL_DIR/scripts/delete.js --origin <root-url> --list` — shows the batch without deleting.
2. Show the list (count + titles) and **ask the user to confirm**.
3. Run `node $SKILL_DIR/scripts/delete.js --origin <root-url>`. Report count + titles deleted.
   Note: entries saved before the origin column existed (origin null) can only be deleted by id.

## Errors

| Code | What to do |
|---|---|
| `OLLAMA_DOWN` | Tell the user to start Ollama (`ollama serve` or the app). For add: the transit JSON stays in `~/.lookout/tmp/` — re-run the same `store.js --file` after Ollama is up, no need to re-summarize. For find: search degrades to keyword mode automatically. |
| `FETCH_BLOCKED` / `EXTRACT_EMPTY` / `UNSUPPORTED_TYPE` | Fall back to WebFetch (see **add** step 1). |
| `BAD_INPUT` | Fix the JSON/arguments per the message and retry. |
| exit 1 | Show the raw stderr to the user; do not retry blindly. |
