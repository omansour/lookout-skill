---
description: Store a free-text note in the personal tech-watch knowledge base with summary, tags and embeddings. Use when the user wants to jot down a tech-watch note or idea without a URL.
allowed-tools: Bash(node:*)
---

# lookout — note

`<PLUGIN_ROOT>` = the plugin root directory, i.e. two levels above this skill's base directory
(the skill lives at `<plugin-root>/skills/note/`). Substitute the resolved absolute path in the commands below.

Store a free-text note in the tech-watch base. The note text: `$ARGUMENTS`

1. Derive a short title, a 1–3 sentence summary, and 3–6 tags from the text
   (reuse existing tags via `node "<PLUGIN_ROOT>/scripts/list.js" --tags`; new tags in kebab-case English).
2. Pipe the entry JSON to store.js on stdin via a quoted heredoc — no Write tool,
   no tmp files to manage:
   ```bash
   node "<PLUGIN_ROOT>/scripts/store.js" <<'ENTRY_JSON'
   {"url": null, "kind": "note", "title": "…", "summary": "…",
    "tags": ["…"], "content": "<the full note text>", "project": "<basename of cwd>"}
   ENTRY_JSON
   ```
   Confirm on success: title, tags, chunk count.

| Error | What to do |
|---|---|
| `OLLAMA_DOWN` | Tell the user to start Ollama. store.js persists the entry JSON itself and gives its path in the hint — once Ollama is up, rerun `store.js --file <that path>`. |
| `BAD_INPUT` | Fix the JSON per the message and retry. |
