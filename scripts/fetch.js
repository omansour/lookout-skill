// fetch.js — fetch a URL, extract readable content, report duplicates. No DB writes.
//
// usage: node fetch.js <url>
// output: {"url":"<normalized>","title","byline","site_name","source_domain",
//          "content_file","excerpt","length":int,"truncated":bool,"links",
//          "existing":{id,added_at,updated_at}|null}
//         The full text (capped at CONTENT_CAP) is written to content_file in
//         ~/.lookout/tmp/ — pass that path to store.js as content_file so the
//         content never transits through the model. excerpt is the first
//         EXCERPT_LEN chars (enough to summarize/tag); length is the full
//         extracted size, truncated says whether the cap hit.
import { writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { ok, fail, unexpected } from './lib/cli.js';
import { openDb, getEntryByUrl } from './lib/db.js';
import { extractReadable } from './lib/extract.js';
import { normalizeUrl } from './lib/url.js';
import { CONTENT_CAP } from './lib/chunk.js';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const TMP_DIR = join(homedir(), '.lookout', 'tmp');
const EXCERPT_LEN = 6000;

try {
  const raw = process.argv[2];
  if (!raw) fail('BAD_INPUT', 'missing URL', 'usage: node fetch.js <url>');

  let url;
  try {
    url = normalizeUrl(raw);
  } catch {
    fail('BAD_INPUT', `not a valid URL: ${raw}`, 'pass a full http(s) URL');
  }

  let res;
  try {
    res = await fetch(url, {
      headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml' },
      redirect: 'follow',
      signal: AbortSignal.timeout(15_000),
    });
  } catch (e) {
    fail('FETCH_BLOCKED', `fetch failed: ${e.message}`,
      'fall back to WebFetch to get the page text, then call store.js directly');
  }
  if (!res.ok) {
    fail('FETCH_BLOCKED', `HTTP ${res.status} ${res.statusText}`,
      'fall back to WebFetch to get the page text, then call store.js directly');
  }
  const contentType = res.headers.get('content-type') ?? '';
  if (!contentType.includes('text/html') && !contentType.includes('xhtml')) {
    fail('UNSUPPORTED_TYPE', `content-type is '${contentType}', not HTML`,
      'fall back to WebFetch (it handles PDFs and other types), then call store.js directly');
  }

  const finalUrl = normalizeUrl(res.url || url);
  const html = await res.text();
  const { title, byline, siteName, text, links } = extractReadable(html, finalUrl);
  if (text.length < 200) {
    fail('EXTRACT_EMPTY', `extracted only ${text.length} chars (likely JS-rendered)`,
      'fall back to WebFetch to get the page text, then call store.js directly');
  }

  const db = await openDb();
  const existing = await getEntryByUrl(db, finalUrl);
  await db.close?.();

  const content = text.slice(0, CONTENT_CAP);
  mkdirSync(TMP_DIR, { recursive: true });
  const contentFile = join(TMP_DIR,
    `content-${Date.now()}-${createHash('sha1').update(finalUrl).digest('hex').slice(0, 8)}.txt`);
  writeFileSync(contentFile, content);

  ok({
    url: finalUrl,
    title,
    byline,
    site_name: siteName,
    source_domain: new URL(finalUrl).hostname,
    content_file: contentFile,
    excerpt: content.slice(0, EXCERPT_LEN),
    length: text.length,
    truncated: text.length > CONTENT_CAP,
    links,
    existing,
  });
} catch (e) {
  unexpected(e);
}
