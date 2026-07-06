---
description: Save a URL into the personal tech-watch knowledge base - fetch, summarize, tag, store, then auto-crawl relevant links. Use when the user wants to save an article or URL for later reference.
allowed-tools: Bash(node:*), WebFetch, Agent
---

# lookout — add

`<PLUGIN_ROOT>` = the plugin root directory, i.e. two levels above this skill's base directory
(the skill lives at `<plugin-root>/skills/add/`). Substitute the resolved absolute path in the commands below.

Index a URL (and its relevant outbound links) into the tech-watch base. The URL: `$ARGUMENTS`

**Run asynchronously in a subagent.** Do not execute the pipeline below in the main
conversation. Instead, launch it in the background so the user can keep working:

- Tool: Agent, `subagent_type: "general-purpose"`, `model: "sonnet"`, `run_in_background: true`
  (summarizing, tagging, and link triage are well within Sonnet — no need for a bigger model).
- Inline the resolved absolute `<PLUGIN_ROOT>` everywhere in the agent prompt — the subagent
  does not see this skill's base directory.
- The agent prompt must contain: the target URL, the full pipeline below (steps 1–6 including
  the crawl rules and caps), the absolute script paths, the entry JSON format,
  and the instruction to return the final tree recap (root → children → grandchildren, with
  skipped/failed links and reasons) as its final message.
- Exception — stay synchronous when the root URL already exists (`existing` not null): run
  step 1 inline first; if it reports `existing`, ask the user whether to update before spawning.
  If unsure, spawn anyway and let the agent skip existing URLs.
- After spawning, tell the user indexing started in the background and they'll get the recap
  when it finishes. When the agent completes, relay its tree recap.

## Pipeline (executed by the subagent)

1. Run `node <PLUGIN_ROOT>/scripts/fetch.js "<url>"`.
   - If `existing` is not null: skip (already saved) — for the root URL, ask the user about updating first (see above).
   - If exit 2 (`FETCH_BLOCKED` / `EXTRACT_EMPTY` / `UNSUPPORTED_TYPE`): fall back to **WebFetch** on the URL with prompt "Return the full readable text of this page, plus its title." Use that as title/content; pass the URL as-is — store.js normalizes it (strips fragment and utm_* params).
   - **Never fetch a URL with curl/wget via Bash.** fetch.js handles HTML and raw text/markdown
     (including raw.githubusercontent.com); WebFetch is the only fallback (root URL only).
     If both fail, report the page as failed in the recap and move on.
2. Run `node <PLUGIN_ROOT>/scripts/list.js --tags` to see existing tags.
3. Write a **3–5 sentence English summary** based on the `excerpt` and pick **3–6 tags**:
   reuse existing tags when relevant; new tags in kebab-case English.
4. Pipe the entry JSON to store.js on stdin via a quoted heredoc — no Write tool,
   no tmp files to manage:
   ```bash
   node <PLUGIN_ROOT>/scripts/store.js <<'ENTRY_JSON'
   {"url": "<normalized url>", "kind": "url", "title": "…", "summary": "…",
    "tags": ["…"], "content_file": "<content_file path from fetch output>",
    "source_domain": "<hostname>", "project": "<basename of cwd>",
    "origin": "<normalized ROOT url of this add command>"}
   ENTRY_JSON
   ```
   Never copy the article text into the JSON — `content_file` points store.js at the
   transit file fetch.js wrote (store.js deletes it on success). Only the WebFetch
   fallback (step 1) uses an inline `"content"` field instead.
   `origin` is the same for the root entry and every crawled child — it groups the whole
   add-batch so it can be deleted in one shot later.
5. Note title, tags, `created`/`updated`, chunk count for the recap.
6. **Follow relevant links (automatic, max 2 levels deep).** fetch.js returns the article's
   outbound `links` ({url, text}). Select the ones genuinely relevant to the page's topic —
   substantive documentation/articles/references, NOT home pages, pricing, sign-up, social,
   or generic navigation. Then, without asking for approval:
   - **Depth 1**: index up to **5** selected links, each via the same pipeline (steps 1–5,
     skipping any URL whose fetch reports `existing` — count it as "skipped (already saved)").
   - **Depth 2**: from each depth-1 page, select and index up to **2** relevant links.
   - **Never go deeper than depth 2. Hard cap: 15 pages total per add** (the root counts as 1).
   - Keep summaries/tags per page as usual; add the tag `crawled` to depth-1/2 entries.
   - Finish with a tree recap: root → indexed children (and grandchildren), plus skipped/failed
     links with the reason. Failed child fetches are reported, not retried via WebFetch —
     the fallback is for the root URL only.

## Errors

| Code | What to do |
|---|---|
| `OLLAMA_DOWN` | Tell the user to start Ollama (`ollama serve` or the app). store.js persists the entry JSON itself and gives its path in the hint; the `content-*.txt` transit file also stays — once Ollama is up, rerun `store.js --file <that path>`, no need to re-summarize. |
| `FETCH_BLOCKED` / `EXTRACT_EMPTY` / `UNSUPPORTED_TYPE` | Fall back to WebFetch (root URL only, see step 1). |
| `BAD_INPUT` | Fix the JSON/arguments per the message and retry. |
| exit 1 | Show the raw stderr to the user; do not retry blindly. |
