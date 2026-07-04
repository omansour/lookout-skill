---
description: Delete an entry from the personal tech-watch knowledge base (by id, URL or description), or a whole add-batch via its origin URL. Always confirms with the user before deleting.
allowed-tools: Bash(node:*)
---

# lookout — delete

`<PLUGIN_ROOT>` = the plugin root directory, i.e. two levels above this skill's base directory
(the skill lives at `<plugin-root>/skills/delete/`). Substitute the resolved absolute path in the commands below.

Delete a saved entry or a whole add-batch. Target: `$ARGUMENTS`

**Single entry:**
1. If the user gave a description instead of an id/url ("delete the limbo article"), find the entry first
   via `node "<PLUGIN_ROOT>/scripts/list.js"` or `…/scripts/search.js` and identify its id.
2. Show the entry (title, url, tags) and **ask the user to confirm** before deleting.
3. Run `node "<PLUGIN_ROOT>/scripts/delete.js" <id|url>`. Confirm what was deleted.
   `NOT_FOUND` (exit 2) → show available entries via list.

**Whole add-batch** (user says "delete everything from the sli.dev add", "remove that whole crawl"…):
1. Preview: `node "<PLUGIN_ROOT>/scripts/delete.js" --origin <root-url> --list` — shows the batch without deleting.
2. Show the list (count + titles) and **ask the user to confirm**.
3. Run `node "<PLUGIN_ROOT>/scripts/delete.js" --origin <root-url>`. Report count + titles deleted.
   Note: entries saved before the origin column existed (origin null) can only be deleted by id.

Output contract: JSON on stdout (exit 0) or `{"error":{code,message,hint}}` on stderr (exit 2 = repairable, follow the hint; exit 1 = show raw stderr, don't retry blindly).
