// lib/extract.js — HTML → clean readable text via linkedom + Readability.
import { parseHTML } from 'linkedom';
import { Readability } from '@mozilla/readability';

// html: string, url: string → {title, byline, siteName, text, links:[{url,text}]}
export function extractReadable(html, url) {
  const { document } = parseHTML(html);
  // Readability wants a base URI for relative link resolution
  try {
    const base = document.createElement('base');
    base.setAttribute('href', url);
    document.head?.appendChild(base);
  } catch { /* non-fatal */ }

  const article = new Readability(document, { charThreshold: 100 }).parse();
  if (article?.textContent?.trim()) {
    return {
      title: article.title?.trim() || fallbackTitle(document),
      byline: article.byline?.trim() || null,
      siteName: article.siteName?.trim() || null,
      text: normalize(article.textContent),
      // links from the article body only (not nav/footer) — best relevance signal
      links: extractLinks(article.content, url),
    };
  }
  // fallback: strip scripts/styles/nav and take body text
  for (const sel of ['script', 'style', 'noscript', 'nav', 'header', 'footer', 'aside']) {
    for (const el of document.querySelectorAll(sel)) el.remove();
  }
  return {
    title: fallbackTitle(document),
    byline: null,
    siteName: null,
    text: normalize(document.body?.textContent ?? ''),
    links: extractLinks(document.body?.innerHTML ?? '', url),
  };
}

const SKIP_LINK = /^(mailto:|javascript:|tel:|#)|(twitter\.com|x\.com)\/(share|intent)|facebook\.com\/sharer|linkedin\.com\/share|\.(png|jpe?g|gif|svg|webp|css|js)(\?|$)/i;

// contentHtml: HTML string of the article body → [{url, text}] deduped, capped
function extractLinks(contentHtml, baseUrl) {
  if (!contentHtml) return [];
  const { document } = parseHTML(`<body>${contentHtml}</body>`);
  const seen = new Set();
  const links = [];
  for (const a of document.querySelectorAll('a[href]')) {
    const href = a.getAttribute('href') ?? '';
    if (SKIP_LINK.test(href)) continue;
    let abs;
    try {
      abs = new URL(href, baseUrl);
    } catch { continue; }
    if (abs.protocol !== 'http:' && abs.protocol !== 'https:') continue;
    abs.hash = '';
    const urlStr = abs.toString();
    if (urlStr === baseUrl || seen.has(urlStr)) continue;
    seen.add(urlStr);
    const text = (a.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 80);
    links.push({ url: urlStr, text });
    // 25 candidates is plenty: the add skill selects at most 5 per page
    if (links.length >= 25) break;
  }
  return links;
}

function fallbackTitle(document) {
  return document.querySelector('title')?.textContent?.trim()
    || document.querySelector('h1')?.textContent?.trim()
    || 'Untitled';
}

export function normalize(text) {
  return text
    .replace(/\r/g, '')
    .split('\n').map(l => l.trim()).join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
