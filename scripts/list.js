// list.js — recent entries grouped by add-batch (origin), optionally filtered
// by tag and/or project, or tag counts.
//
// usage: node list.js [--limit 15] [--tag <t>] [--project <name|.>] [--tags]
//        --project . resolves to the basename of the current directory
// output: {"batches":[{origin,truncated?,entries:[{id,url,kind,title,tags,project,origin,added_at}]}]}
//         newest batch first, root entry first within its batch;
//         truncated = batch cut by --limit
//         with --tags: {"tags":[{"tag","count"}]}
import { basename } from 'node:path';
import { ok, unexpected } from './lib/cli.js';
import { openDb, listEntries, tagCounts } from './lib/db.js';

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i !== -1 ? process.argv[i + 1] : fallback;
}

function projectArg() {
  const p = arg('--project', null);
  return p === '.' ? basename(process.cwd()) : p;
}

try {
  const db = await openDb();
  if (process.argv.includes('--tags')) {
    const tags = await tagCounts(db);
    await db.close?.();
    ok({ tags });
  }
  const batches = await listEntries(db, {
    limit: Number(arg('--limit', 15)),
    tag: arg('--tag', null),
    project: projectArg(),
  });
  await db.close?.();
  ok({ batches });
} catch (e) {
  unexpected(e);
}
