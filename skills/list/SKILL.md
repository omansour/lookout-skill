---
description: List recent entries of the personal tech-watch knowledge base, optionally filtered by tag or project. Use when the user wants to browse their saved tech-watch resources or see the tag list.
allowed-tools: Bash(node:*)
---

# lookout — list

`<PLUGIN_ROOT>` = the plugin root directory, i.e. two levels above this skill's base directory
(the skill lives at `<plugin-root>/skills/list/`). Substitute the resolved absolute path in the commands below.

List recent entries of the tech-watch base. Arguments (optional): `$ARGUMENTS` — a tag, a count, `all`, or `tags` for the tag list.

Run `node "<PLUGIN_ROOT>/scripts/list.js" --limit 15`:
- Add `--tag <t>` if a tag is given; use `--tags` if the user asks for the tag list.
- If the user gives a number or asks for more/all, adjust `--limit` (use `--limit 100000` for "all").
- Listing is **global by default**; if the user scopes to a project, add `--project <name>` (`--project .` = basename of the cwd).

The script returns only **top-level entries** (standalone saves, and the root of each `/lookout:add` crawl —
not the individual pages it crawled), newest first. Render a plain markdown table (title linked to URL, tags,
date) — one row per entry, no grouping or nesting. If the user wants the pages crawled under one of these
entries, use `/lookout:find` to search across everything, or `/lookout:delete --origin <url> --list` to preview
a whole crawl batch.

Output contract: JSON on stdout (exit 0) or `{"error":{code,message,hint}}` on stderr (exit 2 = repairable, follow the hint; exit 1 = show raw stderr, don't retry blindly).
