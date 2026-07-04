---
description: Search the personal tech-watch knowledge base (semantic + keyword) and answer with cited sources. Use when the user asks what their saved tech-watch resources say about a topic, or wants to retrieve previously saved articles/notes.
allowed-tools: Bash(node:*)
---

# lookout — find

`<PLUGIN_ROOT>` = the plugin root directory, i.e. two levels above this skill's base directory
(the skill lives at `<plugin-root>/skills/find/`). Substitute the resolved absolute path in the commands below.

Answer a question from the local tech-watch knowledge base (`~/.lookout/lookout.db`, Turso + Ollama embeddings).

The question: `$ARGUMENTS`

1. Run `node "<PLUGIN_ROOT>/scripts/search.js" "<question>" --limit 8`.
   - Add `--tag <t>` if the user filtered by tag.
   - Search is **global by default**. If the user scopes to a project ("in this project", "for project foo"…),
     add `--project <name>` — use `--project .` for "this project" (resolves to the basename of the cwd).
2. **Answer the user's question** using the results' `summary` and `best_chunk`, citing every source you use with its URL (markdown link).
3. If a `warning` is present (vector disabled), mention search ran in keyword-only mode.
4. If results are empty or clearly off-topic, say so honestly and suggest `/lookout:add <url>` to grow the base.

Output contract: scripts print JSON on stdout (exit 0) or `{"error":{code,message,hint}}` on stderr (exit 2 = repairable, follow the hint; exit 1 = show raw stderr, don't retry blindly).

| Error | What to do |
|---|---|
| `OLLAMA_DOWN` | Search degrades to keyword mode automatically; tell the user to start Ollama (`ollama serve` or the app) for semantic search. |
| `BAD_INPUT` | Fix the arguments per the message and retry. |
