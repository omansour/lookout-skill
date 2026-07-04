---
description: Store a free-text note in the personal tech-watch knowledge base with summary, tags and embeddings. Use when the user wants to jot down a tech-watch note or idea without a URL.
allowed-tools: Bash(node:*), Write
---

# lookout — note

`<PLUGIN_ROOT>` = the plugin root directory, i.e. two levels above this skill's base directory
(the skill lives at `<plugin-root>/skills/note/`). Substitute the resolved absolute path in the commands below.

Store a free-text note in the tech-watch base. The note text: `$ARGUMENTS`

1. Derive a short title, a 1–3 sentence summary, and 3–6 tags from the text
   (reuse existing tags via `node "<PLUGIN_ROOT>/scripts/list.js" --tags`; new tags in kebab-case English).
2. Write (Write tool) the JSON to `~/.lookout/tmp/entry-<epoch>.json`:
   ```json
   {"url": null, "kind": "note", "title": "…", "summary": "…",
    "tags": ["…"], "content": "<the full note text>", "project": "<basename of cwd>"}
   ```
3. Run `node "<PLUGIN_ROOT>/scripts/store.js" --file <that path>`. On success, delete the tmp file and confirm: title, tags, chunk count.

| Error | What to do |
|---|---|
| `OLLAMA_DOWN` | Tell the user to start Ollama. The transit JSON stays in `~/.lookout/tmp/` — re-run the same `store.js --file` after Ollama is up. |
| `BAD_INPUT` | Fix the JSON per the message and retry. |
