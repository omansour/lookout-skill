// delete.js — delete an entry (and its chunks) by id or URL,
// or a whole add-batch by its origin (root URL of the add command).
//
// usage: node delete.js <id|url>
//        node delete.js --origin <root-url> [--list]   # --list = preview only, no delete
// output: {"deleted":{id,url,kind,title,tags}}
//         with --origin: {"origin","deleted":[{id,url,kind,title,tags}],"count":int}
import { ok, fail, unexpected } from './lib/cli.js';
import { openDb, getEntry, getEntryByUrl, deleteEntry, getEntriesByOrigin, deleteByOrigin } from './lib/db.js';

try {
  const originIdx = process.argv.indexOf('--origin');
  if (originIdx !== -1) {
    const origin = process.argv[originIdx + 1];
    if (!origin) fail('BAD_INPUT', 'missing origin url', 'usage: node delete.js --origin <root-url> [--list]');
    const db = await openDb();
    if (process.argv.includes('--list')) {
      const entries = await getEntriesByOrigin(db, origin);
      await db.close?.();
      ok({ origin, entries, count: entries.length });
    }
    const deleted = await deleteByOrigin(db, origin);
    await db.close?.();
    if (deleted.length === 0) {
      fail('NOT_FOUND', `no entries with origin '${origin}'`,
        'origin is the root URL of the add command; check list.js output');
    }
    ok({ origin, deleted, count: deleted.length });
  }

  const target = process.argv[2];
  if (!target) fail('BAD_INPUT', 'missing target', 'usage: node delete.js <id|url> | --origin <root-url>');

  const db = await openDb();
  let entry = null;
  if (/^\d+$/.test(target)) {
    entry = await getEntry(db, Number(target));
  } else {
    const byUrl = await getEntryByUrl(db, target);
    if (byUrl) entry = await getEntry(db, byUrl.id);
  }
  if (!entry) {
    await db.close?.();
    fail('NOT_FOUND', `no entry matches '${target}'`, 'run list.js to see ids and urls');
  }

  await deleteEntry(db, entry.id);
  await db.close?.();
  ok({ deleted: { id: entry.id, url: entry.url, kind: entry.kind, title: entry.title, tags: entry.tags } });
} catch (e) {
  unexpected(e);
}
