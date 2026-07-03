// search.js — hybrid search: vector full-scan + LIKE keyword, merged with RRF.
//
// usage: node search.js "<question>" [--limit 8] [--tag <t>] [--project <name|.>] [--mode hybrid|vector|keyword]
//        --project . resolves to the basename of the current directory
// output: {"results":[{id,url,title,summary,tags,added_at,score,best_chunk}], "warning"?}
import { basename } from 'node:path';
import { ok, fail, unexpected } from './lib/cli.js';
import { openDb, vectorSearch, keywordSearch } from './lib/db.js';
import { embed, checkOllama, hasModel, OllamaDownError } from './lib/ollama.js';

const RRF_K = 60;

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i !== -1 ? process.argv[i + 1] : fallback;
}

try {
  const query = process.argv[2];
  if (!query || query.startsWith('--')) {
    fail('BAD_INPUT', 'missing query', 'usage: node search.js "<question>" [--limit 8] [--tag t] [--project name|.] [--mode hybrid|vector|keyword]');
  }
  const limit = Number(arg('--limit', 8));
  const tag = arg('--tag', null);
  const projectRaw = arg('--project', null);
  const project = projectRaw === '.' ? basename(process.cwd()) : projectRaw;
  const mode = arg('--mode', 'hybrid');

  const db = await openDb();
  let warning;

  // vector leg
  let vectorResults = [];
  if (mode !== 'keyword') {
    const { up, models } = await checkOllama();
    if (up && hasModel(models)) {
      try {
        const [qv] = await embed([query], { isQuery: true });
        vectorResults = await vectorSearch(db, qv, { tag, project });
      } catch (e) {
        if (!(e instanceof OllamaDownError)) throw e;
        warning = 'vector disabled (ollama down)';
      }
    } else if (mode === 'vector') {
      fail('OLLAMA_DOWN', 'vector mode requested but Ollama daemon/model unavailable',
        "run 'ollama serve' and 'ollama pull nomic-embed-text'");
    } else {
      warning = 'vector disabled (ollama down)';
    }
  }

  // keyword leg
  const keywordResults = mode !== 'vector' ? await keywordSearch(db, query, { tag, project }) : [];

  // RRF merge: score(entry) = sum over lists of 1/(K + rank)
  const scores = new Map(); // id -> {score, entry, best_chunk?}
  for (const [rank, r] of vectorResults.entries()) {
    const s = scores.get(r.id) ?? { score: 0, entry: r };
    s.score += 1 / (RRF_K + rank + 1);
    s.best_chunk = r.best_chunk;
    scores.set(r.id, s);
  }
  for (const [rank, r] of keywordResults.entries()) {
    const s = scores.get(r.id) ?? { score: 0, entry: r };
    s.score += 1 / (RRF_K + rank + 1);
    scores.set(r.id, s);
  }

  const results = [...scores.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ score, entry, best_chunk }) => ({
      id: entry.id,
      url: entry.url,
      title: entry.title,
      summary: entry.summary,
      tags: entry.tags,
      added_at: entry.added_at,
      score: Number(score.toFixed(5)),
      best_chunk: best_chunk ?? null,
    }));

  await db.close?.();
  ok({ results, ...(warning ? { warning } : {}) });
} catch (e) {
  unexpected(e);
}
