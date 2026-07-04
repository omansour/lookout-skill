---
description: List recent entries of the personal tech-watch knowledge base, grouped by add-batch, optionally filtered by tag or project. Use when the user wants to browse their saved tech-watch resources or see the tag list.
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

The script returns entries **already grouped by add-batch** (`batches`, newest first; within a batch the root entry
comes first). Render a markdown table per batch (title linked to URL, tags, date): root as a plain row, children
with a `└` prefix on the title; single-entry batches render as plain rows. If a batch has `truncated: true`,
mention that the limit cut it.

Output contract: JSON on stdout (exit 0) or `{"error":{code,message,hint}}` on stderr (exit 2 = repairable, follow the hint; exit 1 = show raw stderr, don't retry blindly).
