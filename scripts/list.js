// list.js — recent entries, optionally filtered by tag, or tag counts.
//
// usage: node list.js [--limit 15] [--tag <t>] [--tags]
// output: {"entries":[{id,url,kind,title,tags,project,added_at}]}
//         with --tags: {"tags":[{"tag","count"}]}
import { ok, unexpected } from './lib/cli.js';
import { openDb, listEntries, tagCounts } from './lib/db.js';

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i !== -1 ? process.argv[i + 1] : fallback;
}

try {
  const db = await openDb();
  if (process.argv.includes('--tags')) {
    const tags = await tagCounts(db);
    await db.close?.();
    ok({ tags });
  }
  const entries = await listEntries(db, {
    limit: Number(arg('--limit', 15)),
    tag: arg('--tag', null),
  });
  await db.close?.();
  ok({ entries });
} catch (e) {
  unexpected(e);
}
