// lib/url.js — canonical URL normalization, shared by fetch.js and store.js
// so the same page always maps to the same entries.url (UNIQUE key).

const TRACKING_PARAMS = /^(utm_|fbclid|gclid|mc_cid|mc_eid|ref_src)/;

// Throws TypeError on invalid URLs (same as `new URL`).
export function normalizeUrl(raw) {
  const u = new URL(raw);
  u.hash = '';
  for (const key of [...u.searchParams.keys()]) {
    if (TRACKING_PARAMS.test(key)) u.searchParams.delete(key);
  }
  return u.toString();
}
