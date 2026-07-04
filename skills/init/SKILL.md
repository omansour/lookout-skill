---
description: Check and repair the lookout tech-watch system (npm deps, Ollama daemon, embedding model, database). Use after installing or updating the lookout plugin, or when lookout commands fail.
allowed-tools: Bash(node:*), Bash(npm install:*), Bash(ollama pull:*)
---

# lookout — init

`<PLUGIN_ROOT>` = the plugin root directory, i.e. two levels above this skill's base directory
(the skill lives at `<plugin-root>/skills/init/`). Substitute the resolved absolute path in the commands below.

System check & repair for the tech-watch knowledge base.

1. Run `node "<PLUGIN_ROOT>/scripts/init.js"`.
2. For each check with `status:"fail"`, apply the safe fixes yourself:
   - npm deps → run the `npm install --prefix …` command given in the `fix` field
   - embedding model → run `ollama pull nomic-embed-text`
   - Ollama daemon down → do NOT spawn it; tell the user to start the Ollama app or run `ollama serve`, then re-run init.
3. Re-run init.js after fixes, until `ok:true` (or only the daemon check blocks and the user has been told).
4. Present a recap table: check | status | detail.
