// lib/db.js — the ONLY module that touches the database.
// Engine: @tursodatabase/database (Turso Rust rewrite, beta). Swapping engines
// (e.g. to @libsql/client) means rewriting this file only — the schema is
// plain SQLite and embeddings are stored via vector32().
import { connect } from '@tursodatabase/database';
import { homedir } from 'node:os';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';

export const EMBEDDING_MODEL = 'nomic-embed-text';
export const DIMS = 768;
export const SCHEMA_VERSION = '1';

export const DB_PATH = process.env.LOOKOUT_DB || join(homedir(), '.lookout', 'lookout.db');

const DDL = [
  `CREATE TABLE IF NOT EXISTS entries (
    id            INTEGER PRIMARY KEY,
    url           TEXT UNIQUE,
    kind          TEXT NOT NULL DEFAULT 'url',
    title         TEXT NOT NULL,
    summary       TEXT NOT NULL,
    tags          TEXT NOT NULL DEFAULT '[]',
    source_domain TEXT,
    content       TEXT NOT NULL,
    project       TEXT,
    origin        TEXT,
    added_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS chunks (
    id        INTEGER PRIMARY KEY,
    entry_id  INTEGER NOT NULL,
    seq       INTEGER NOT NULL,
    text      TEXT NOT NULL,
    embedding BLOB NOT NULL,
    UNIQUE(entry_id, seq)
  )`,
  `CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`,
];

// created after the origin migration — an old DB gains the column first
const INDEXES = [
  `CREATE INDEX IF NOT EXISTS idx_entries_origin ON entries(origin)`,
  `CREATE INDEX IF NOT EXISTS idx_entries_added_at ON entries(added_at)`,
];

export async function openDb() {
  mkdirSync(dirname(DB_PATH), { recursive: true });
  const db = await connect(DB_PATH);
  await db.exec('PRAGMA busy_timeout = 5000');
  await ensureSchema(db);
  return db;
}

async function ensureSchema(db) {
  for (const ddl of DDL) await db.exec(ddl);
  // migration for DBs created before the origin column existed
  try {
    await db.exec('ALTER TABLE entries ADD COLUMN origin TEXT');
  } catch (e) {
    if (!/duplicate column/i.test(e?.message ?? '')) throw e;
  }
  for (const idx of INDEXES) await db.exec(idx);
  const get = db.prepare('SELECT value FROM meta WHERE key = ?');
  const set = db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING');
  await set.run('schema_version', SCHEMA_VERSION);
  await set.run('embedding_model', EMBEDDING_MODEL);
  await set.run('dims', String(DIMS));
  const model = (await get.get('embedding_model'))?.value;
  const dims = (await get.get('dims'))?.value;
  if (model !== EMBEDDING_MODEL || dims !== String(DIMS)) {
    throw new Error(
      `Embedding model mismatch: DB was built with ${model}/${dims} dims, ` +
      `scripts expect ${EMBEDDING_MODEL}/${DIMS}. Rebuild the DB or migrate embeddings.`
    );
  }
}

export async function getEntryByUrl(db, url) {
  return db.prepare('SELECT id, added_at, updated_at FROM entries WHERE url = ?').get(url) ?? null;
}

// Transactional upsert of an entry and its chunks.
// entry: {url|null, kind, title, summary, tags[], content, source_domain?, project?}
// embeddedChunks: [{seq, text, vector: number[]}]
export async function storeEntry(db, entry, embeddedChunks) {
  const existing = entry.url ? await getEntryByUrl(db, entry.url) : null;
  await db.exec('BEGIN');
  try {
    let id;
    if (existing) {
      id = existing.id;
      await db.prepare(
        `UPDATE entries SET kind=?, title=?, summary=?, tags=?, source_domain=?, content=?, project=?, origin=?,
         updated_at=datetime('now') WHERE id=?`
      ).run(entry.kind, entry.title, entry.summary, JSON.stringify(entry.tags),
            entry.source_domain ?? null, entry.content, entry.project ?? null, entry.origin ?? null, id);
      await db.prepare('DELETE FROM chunks WHERE entry_id = ?').run(id);
    } else {
      const r = await db.prepare(
        `INSERT INTO entries (url, kind, title, summary, tags, source_domain, content, project, origin)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(entry.url ?? null, entry.kind, entry.title, entry.summary, JSON.stringify(entry.tags),
            entry.source_domain ?? null, entry.content, entry.project ?? null, entry.origin ?? null);
      id = Number(r.lastInsertRowid);
    }
    const ins = db.prepare('INSERT INTO chunks (entry_id, seq, text, embedding) VALUES (?, ?, ?, vector32(?))');
    for (const c of embeddedChunks) {
      await ins.run(id, c.seq, c.text, JSON.stringify(c.vector));
    }
    await db.exec('COMMIT');
    return { id, action: existing ? 'updated' : 'created' };
  } catch (e) {
    await db.exec('ROLLBACK');
    throw e;
  }
}

// SQL WHERE fragments for the shared tag/project filters, on the entries
// table aliased as `alias`. Filtering happens in the engine, never in JS.
function entryFilters({ tag = null, project = null } = {}, alias = 'entries') {
  const clauses = [];
  const params = [];
  if (tag) {
    clauses.push(`EXISTS (SELECT 1 FROM json_each(${alias}.tags) WHERE json_each.value = ?)`);
    params.push(tag);
  }
  if (project) {
    clauses.push(`${alias}.project = ?`);
    params.push(project);
  }
  return { clauses, params };
}

// Columns every search result carries — must stay in sync with getEntry().
const ENTRY_COLS = 'id, url, kind, title, summary, tags, source_domain, project, added_at, updated_at';

// Full-scan cosine search over chunks, deduped by entry (best distance kept).
// tag/project filters apply before the topChunks cut, so a scoped search
// still gets a full candidate set.
export async function vectorSearch(db, queryVector, { topChunks = 40, tag = null, project = null } = {}) {
  const { clauses, params } = entryFilters({ tag, project }, 'e');
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const cols = ENTRY_COLS.split(', ').map(c => `e.${c}`).join(', ');
  const rows = await db.prepare(
    `SELECT ${cols}, c.seq, c.text, vector_distance_cos(c.embedding, vector32(?)) AS dist
     FROM chunks c JOIN entries e ON e.id = c.entry_id ${where}
     ORDER BY dist ASC LIMIT ?`
  ).all(JSON.stringify(queryVector), ...params, topChunks);
  const results = [];
  const seen = new Set(); // keep only each entry's best chunk (rows come sorted)
  for (const { seq, text, dist, ...e } of rows) {
    if (seen.has(e.id)) continue;
    seen.add(e.id);
    // chunk 0 is the title+summary+tags header — already in the result, pure duplicate
    results.push({ ...e, tags: JSON.parse(e.tags), distance: dist, best_chunk: seq === 0 ? null : text });
  }
  return results; // already ordered by distance
}

// Case-insensitive multi-term LIKE search; score = number of matching terms.
export async function keywordSearch(db, query, { limit = 40, tag = null, project = null } = {}) {
  const terms = query.toLowerCase().split(/\s+/).filter(t => t.length >= 3).slice(0, 8);
  if (terms.length === 0) return [];
  const clause = terms.map(() =>
    `(CASE WHEN lower(title) LIKE ? OR lower(summary) LIKE ? OR lower(tags) LIKE ? OR lower(content) LIKE ? THEN 1 ELSE 0 END)`
  ).join(' + ');
  const likeParams = terms.flatMap(t => Array(4).fill(`%${t}%`));
  const { clauses, params } = entryFilters({ tag, project });
  const where = ['(' + clause + ') > 0', ...clauses].join(' AND ');
  const rows = await db.prepare(
    `SELECT ${ENTRY_COLS}, (${clause}) AS hits FROM entries WHERE ${where} ORDER BY hits DESC, added_at DESC LIMIT ?`
  ).all(...likeParams, ...likeParams, ...params, limit);
  return rows.map(r => ({ ...r, tags: JSON.parse(r.tags) }));
}

// Transactional delete of an entry and its chunks (no FK cascade in the beta engine).
export async function deleteEntry(db, id) {
  await db.exec('BEGIN');
  try {
    await db.prepare('DELETE FROM chunks WHERE entry_id = ?').run(id);
    await db.prepare('DELETE FROM entries WHERE id = ?').run(id);
    await db.exec('COMMIT');
  } catch (e) {
    await db.exec('ROLLBACK');
    throw e;
  }
}

// All entries stored by one add command (root URL recorded as origin).
export async function getEntriesByOrigin(db, origin) {
  const rows = await db.prepare(
    'SELECT id, url, kind, title, tags FROM entries WHERE origin = ? ORDER BY id'
  ).all(origin);
  return rows.map(r => ({ ...r, tags: JSON.parse(r.tags) }));
}

export async function deleteByOrigin(db, origin) {
  const entries = await getEntriesByOrigin(db, origin);
  if (entries.length === 0) return [];
  await db.exec('BEGIN');
  try {
    const delChunks = db.prepare('DELETE FROM chunks WHERE entry_id = ?');
    const delEntry = db.prepare('DELETE FROM entries WHERE id = ?');
    for (const e of entries) {
      await delChunks.run(e.id);
      await delEntry.run(e.id);
    }
    await db.exec('COMMIT');
    return entries;
  } catch (e) {
    await db.exec('ROLLBACK');
    throw e;
  }
}

export async function getEntry(db, id) {
  const e = await db.prepare(
    'SELECT id, url, kind, title, summary, tags, source_domain, project, added_at, updated_at FROM entries WHERE id = ?'
  ).get(id);
  if (!e) return null;
  return { ...e, tags: JSON.parse(e.tags) };
}

// Top-level entries only (origin IS NULL, or this entry IS the batch root,
// i.e. url = origin) — newest first. Children of a crawl (origin set to a
// different entry's url) are intentionally excluded; use /lookout:find to
// search across all entries including children, or delete.js --origin to
// act on a whole crawl batch.
export async function listEntries(db, { limit = 15, tag = null, project = null } = {}) {
  const { clauses, params } = entryFilters({ tag, project }, 'e');
  const where = ['(e.origin IS NULL OR e.url = e.origin)', ...clauses].join(' AND ');
  const rows = await db.prepare(
    `SELECT e.id, e.url, e.kind, e.title, e.tags, e.project, e.added_at
     FROM entries e
     WHERE ${where}
     ORDER BY e.added_at DESC, e.id DESC
     LIMIT ?`
  ).all(...params, limit);
  return rows.map(r => ({ ...r, tags: JSON.parse(r.tags) }));
}

export async function tagCounts(db) {
  return db.prepare(
    `SELECT value AS tag, COUNT(*) AS count
     FROM entries, json_each(entries.tags)
     GROUP BY value
     ORDER BY count DESC, value ASC`
  ).all();
}
