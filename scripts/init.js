// init.js — idempotent diagnostics + repair for the lookout skill.
// IMPORTANT: no top-level imports of npm dependencies — this script must be able
// to diagnose a missing node_modules instead of crashing on import.
import { existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SKILL_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
const LOOKOUT_DIR = join(homedir(), '.lookout');
const TMP_DIR = join(LOOKOUT_DIR, 'tmp');

const checks = [];
let ok = true;

function report(name, status, detail, fix) {
  checks.push({ name, status, detail, ...(fix ? { fix } : {}) });
  if (status === 'fail') ok = false;
}

// 1. node version
const major = Number(process.versions.node.split('.')[0]);
if (major >= 20) report('node', 'ok', `node ${process.versions.node}`);
else report('node', 'fail', `node ${process.versions.node} is too old`, 'install node >= 20 (e.g. via nvm)');

// 2. directories
for (const dir of [LOOKOUT_DIR, TMP_DIR]) {
  if (existsSync(dir)) report(`dir ${dir}`, 'ok', 'exists');
  else {
    mkdirSync(dir, { recursive: true });
    report(`dir ${dir}`, 'fixed', 'created');
  }
}

// 3. npm dependencies (dynamic import so we can diagnose instead of crash)
let deps = false;
try {
  await import('@tursodatabase/database');
  await import('@mozilla/readability');
  await import('linkedom');
  deps = true;
  report('npm deps', 'ok', '@tursodatabase/database, @mozilla/readability, linkedom');
} catch (e) {
  report('npm deps', 'fail', `import failed: ${e.message.split('\n')[0]}`,
    `npm install --prefix ${SKILL_DIR}`);
}

// 4-5. ollama daemon + model (only if deps are importable — ollama.js imports db.js)
let ollamaUp = false, modelPresent = false;
if (deps) {
  const { checkOllama, hasModel, OLLAMA_URL } = await import('./lib/ollama.js');
  const { EMBEDDING_MODEL } = await import('./lib/db.js');
  const { up, models } = await checkOllama();
  ollamaUp = up;
  if (up) report('ollama daemon', 'ok', `reachable at ${OLLAMA_URL}`);
  else report('ollama daemon', 'fail', `unreachable at ${OLLAMA_URL}`,
    "start the Ollama app or run 'ollama serve' in a separate terminal");
  if (up) {
    modelPresent = hasModel(models);
    if (modelPresent) report('embedding model', 'ok', EMBEDDING_MODEL);
    else report('embedding model', 'fail', `${EMBEDDING_MODEL} not pulled`,
      `ollama pull ${EMBEDDING_MODEL}`);
  } else {
    report('embedding model', 'fail', 'cannot check: daemon down', 'fix the daemon first');
  }
}

// 6. database + schema + meta
if (deps) {
  try {
    const { openDb, DB_PATH } = await import('./lib/db.js');
    const existed = existsSync(DB_PATH);
    const db = await openDb(); // creates + ensureSchema + meta check
    const n = await db.prepare('SELECT count(*) AS c FROM entries').get();
    await db.close?.();
    report('database', existed ? 'ok' : 'fixed',
      `${DB_PATH} (${n.c} entries)${existed ? '' : ' — created'}`);
  } catch (e) {
    report('database', 'fail', e.message.split('\n')[0], 'inspect ~/.lookout/lookout.db');
  }
}

// 7. embedding smoke test
if (deps && ollamaUp && modelPresent) {
  try {
    const { embed } = await import('./lib/ollama.js');
    const { DIMS } = await import('./lib/db.js');
    const [v] = await embed(['test'], { isQuery: true });
    if (v.length === DIMS) report('embed smoke test', 'ok', `${DIMS} dims`);
    else report('embed smoke test', 'fail', `got ${v.length} dims, expected ${DIMS}`);
  } catch (e) {
    report('embed smoke test', 'fail', e.message.split('\n')[0]);
  }
} else {
  report('embed smoke test', 'fail', 'skipped: prerequisites not met', 'fix the checks above first');
}

process.stdout.write(JSON.stringify({ ok, checks }, null, 1) + '\n');
process.exit(0); // diagnostics always exit 0; "ok" field carries the verdict
