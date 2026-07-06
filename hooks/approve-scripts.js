// hooks/approve-scripts.js — PreToolUse hook: auto-approve Bash calls that
// invoke THIS plugin install's own scripts, so users get zero permission
// prompts without ever allowlisting `node` globally.
//
// Approves ONLY:
//   node <this plugin root>/scripts/{fetch,store,list,search,delete,init}.js <safe args>
//   node <this plugin root>/scripts/store.js <<'ENTRY_JSON' … ENTRY_JSON
// Everything else (other paths, shell chaining, substitutions, redirections)
// gets NO opinion — the normal permission flow applies. The hook never blocks.
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// `node "<root>/scripts/<name>.js"` — same optional quote on both sides
const HEAD = new RegExp(`^node ("?)${escRe(ROOT)}/scripts/(?:fetch|store|list|search|delete|init)\\.js\\1`);

// Shell-safety scan of an argument string: no metacharacter may reach the
// shell unquoted, and no expansion may happen inside double quotes.
function safeArgs(s) {
  let quote = null; // null | "'" | '"'
  for (const ch of s) {
    if (quote === "'") {
      if (ch === "'") quote = null;
      continue; // single-quoted: everything is literal
    }
    if (quote === '"') {
      if (ch === '"') { quote = null; continue; }
      if (ch === '$' || ch === '`' || ch === '\\') return false; // expansions still work in ""
      continue;
    }
    if (ch === "'" || ch === '"') { quote = ch; continue; }
    if (!/[A-Za-z0-9_\-./ =:%+,@~]/.test(ch)) return false; // ; & | ` $ ( ) < > * ? ! \n …
  }
  return quote === null; // no unterminated quote
}

function decide(cmd) {
  const lines = cmd.replace(/\r/g, '').split('\n');
  const head = HEAD.exec(lines[0]);
  if (!head) return false;
  const rest = lines[0].slice(head[0].length);
  // token boundary: nothing may be glued to the script path
  // (blocks `…/scripts/fetch.js/../../evil.js`-style traversal)
  if (rest !== '' && !rest.startsWith(' ')) return false;

  if (lines.length === 1) return safeArgs(rest);

  // multi-line: only the store.js quoted heredoc is allowed. The quoted
  // delimiter ('ENTRY_JSON') makes the body literal — never shell-expanded —
  // so the body needs no inspection; nothing may follow the closing delimiter.
  if (!/^ <<'ENTRY_JSON'\s*$/.test(rest)) return false;
  const close = lines.indexOf('ENTRY_JSON', 1);
  if (close === -1) return false;
  return lines.slice(close + 1).every((l) => l.trim() === '');
}

let input = '';
for await (const chunk of process.stdin) input += chunk;
try {
  const j = JSON.parse(input);
  if (j.tool_name === 'Bash' && decide(String(j.tool_input?.command ?? '').trim())) {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'allow',
        permissionDecisionReason: 'lookout plugin script (auto-approved by the plugin hook)',
      },
    }));
  }
} catch { /* malformed input → no opinion */ }
process.exit(0);
