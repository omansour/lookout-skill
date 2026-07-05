// lib/chunk.js — split entry content into embeddable chunks.
// Chunk 0 is always the header (title + summary + tags); content chunks follow,
// split at paragraph boundaries, ~1500 chars with 200 overlap, max 30 chunks.

const CHUNK_SIZE = 1500;
const OVERLAP = 200;
const MAX_CHUNKS = 30;

// Max stored content length; fetch.js caps its output to the same value so
// nothing that reaches the model is silently lost at store time.
export const CONTENT_CAP = 40_000;

// entry: {title, summary, tags[], content} → [{seq, text}]
export function buildChunks(entry) {
  const header = `${entry.title}\n${entry.summary}\ntags: ${entry.tags.join(', ')}`;
  const chunks = [{ seq: 0, text: header }];
  for (const [i, text] of splitText(entry.content ?? '').entries()) {
    if (chunks.length >= MAX_CHUNKS) break;
    chunks.push({ seq: i + 1, text });
  }
  return chunks;
}

function splitText(content) {
  const text = content.trim();
  if (!text) return [];
  const paragraphs = text.split(/\n{2,}/);
  const pieces = [];
  let current = '';
  for (const p of paragraphs) {
    const para = p.trim();
    if (!para) continue;
    if (current && current.length + para.length + 2 > CHUNK_SIZE) {
      pieces.push(current);
      // start next chunk with the tail of the previous one for context overlap
      current = current.slice(-OVERLAP) + '\n\n' + para;
    } else {
      current = current ? current + '\n\n' + para : para;
    }
    // hard-split paragraphs longer than a whole chunk
    while (current.length > CHUNK_SIZE * 1.5) {
      pieces.push(current.slice(0, CHUNK_SIZE));
      current = current.slice(CHUNK_SIZE - OVERLAP);
    }
  }
  if (current) pieces.push(current);
  return pieces;
}
