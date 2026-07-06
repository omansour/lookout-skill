// store.js — the sole write path. Reads an entry JSON (stdin or --file),
// chunks it, embeds via Ollama, and upserts entry + chunks transactionally.
//
// input: {"url":string|null,"kind":"url"|"note","title","summary","tags":[...],
//         "content"|"content_file","source_domain"?,"project"?,"origin"?}
//         content_file = path to a transit text file written by fetch.js —
//         preferred, the content never transits through the model; inline
//         content is for notes and the WebFetch fallback. Exactly one of the two.
//         origin = root URL of the add command that produced this entry
//         (same value for the root and all crawled children → batch delete)
// on success the transit files (content_file and the --file JSON) are deleted;
// on OLLAMA_DOWN they are kept so the same store.js call can be retried.
// output: {"id":int,"action":"created"|"updated","chunks":int,"url"}
import { readFileSync, unlinkSync } from 'node:fs';
import { ok, fail, unexpected } from './lib/cli.js';
import { openDb, storeEntry } from './lib/db.js';
import { buildChunks, CONTENT_CAP } from './lib/chunk.js';
import { embed, OllamaDownError } from './lib/ollama.js';
import { normalizeUrl } from './lib/url.js';

try {
  const fileIdx = process.argv.indexOf('--file');
  const raw = fileIdx !== -1
    ? readFileSync(process.argv[fileIdx + 1], 'utf8')
    : readFileSync(0, 'utf8'); // stdin

  let entry;
  try {
    entry = JSON.parse(raw);
  } catch {
    fail('BAD_INPUT', 'input is not valid JSON', 'pass the entry JSON on stdin or via --file <path>');
  }

  // validation
  const problems = [];
  if (entry.kind !== 'url' && entry.kind !== 'note') problems.push("kind must be 'url' or 'note'");
  if (entry.kind === 'url' && typeof entry.url !== 'string') problems.push('url is required for kind=url');
  if (entry.kind === 'note') entry.url = null;
  for (const f of ['title', 'summary']) {
    if (typeof entry[f] !== 'string' || !entry[f].trim()) problems.push(`${f} must be a non-empty string`);
  }
  const hasInline = typeof entry.content === 'string' && entry.content.trim();
  const hasFile = typeof entry.content_file === 'string' && entry.content_file.trim();
  if (hasInline && hasFile) problems.push('pass either content or content_file, not both');
  if (!hasInline && !hasFile) problems.push('content or content_file must be a non-empty string');
  if (!Array.isArray(entry.tags) || entry.tags.some(t => typeof t !== 'string')) {
    problems.push('tags must be an array of strings');
  }
  if (problems.length) fail('BAD_INPUT', problems.join('; '), 'fix the entry JSON and retry');

  if (hasFile) {
    try {
      entry.content = readFileSync(entry.content_file, 'utf8');
    } catch (e) {
      fail('BAD_INPUT', `cannot read content_file: ${e.message}`,
        're-run fetch.js to regenerate the transit content file');
    }
    if (!entry.content.trim()) {
      fail('BAD_INPUT', `content_file is empty: ${entry.content_file}`, 're-run fetch.js');
    }
  }

  // normalize urls so dedup (UNIQUE on entries.url) and batch delete (origin
  // match) work whatever path produced the JSON — fetch.js or WebFetch fallback
  try {
    if (entry.url) entry.url = normalizeUrl(entry.url);
    if (entry.origin) entry.origin = normalizeUrl(entry.origin);
  } catch {
    fail('BAD_INPUT', `url or origin is not a valid URL: ${entry.url ?? entry.origin}`,
      'pass full http(s) URLs');
  }

  entry.content = entry.content.slice(0, CONTENT_CAP);
  if (entry.url && !entry.source_domain) {
    try { entry.source_domain = new URL(entry.url).hostname; } catch { /* keep null */ }
  }

  const chunks = buildChunks(entry);
  let vectors;
  try {
    vectors = await embed(chunks.map(c => c.text));
  } catch (e) {
    if (e instanceof OllamaDownError) {
      fail('OLLAMA_DOWN', e.message, fileIdx !== -1
        ? "the transit JSON is kept in ~/.lookout/tmp/ — start Ollama ('ollama serve') and rerun store.js with the same --file"
        : "start Ollama ('ollama serve') and rerun store.js with the same entry JSON");
    }
    throw e;
  }

  const db = await openDb();
  const { id, action } = await storeEntry(db, entry, chunks.map((c, i) => ({ ...c, vector: vectors[i] })));
  await db.close?.();
  // best-effort cleanup of the transit files — the agent never needs to rm them
  for (const f of [hasFile ? entry.content_file : null, fileIdx !== -1 ? process.argv[fileIdx + 1] : null]) {
    if (f) { try { unlinkSync(f); } catch { /* already gone */ } }
  }
  ok({ id, action, chunks: chunks.length, url: entry.url });
} catch (e) {
  unexpected(e);
}
