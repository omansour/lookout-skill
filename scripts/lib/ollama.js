// lib/ollama.js — embedding calls against the local Ollama daemon.
import { EMBEDDING_MODEL, DIMS } from './db.js';

export const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';

export class OllamaDownError extends Error {
  constructor(message) {
    super(message);
    this.code = 'OLLAMA_DOWN';
  }
}

// → {up: bool, models: string[]}
export async function checkOllama({ timeoutMs = 2000 } = {}) {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return { up: false, models: [] };
    const data = await res.json();
    return { up: true, models: (data.models ?? []).map(m => m.name) };
  } catch {
    return { up: false, models: [] };
  }
}

export function hasModel(models, model = EMBEDDING_MODEL) {
  return models.some(m => m === model || m.startsWith(`${model}:`));
}

// Embed texts with the asymmetric nomic prefixes (added here only, never stored).
// texts: string[] → number[][] (768 dims each). Batched requests of 16.
export async function embed(texts, { isQuery = false } = {}) {
  const prefix = isQuery ? 'search_query: ' : 'search_document: ';
  const vectors = [];
  for (let i = 0; i < texts.length; i += 16) {
    const batch = texts.slice(i, i + 16).map(t => prefix + t);
    let res;
    try {
      res = await fetch(`${OLLAMA_URL}/api/embed`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: EMBEDDING_MODEL, input: batch }),
        signal: AbortSignal.timeout(120_000),
      });
    } catch {
      throw new OllamaDownError(`Ollama unreachable at ${OLLAMA_URL}`);
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new OllamaDownError(`Ollama /api/embed failed (${res.status}): ${body.slice(0, 200)}`);
    }
    const data = await res.json();
    for (const v of data.embeddings ?? []) {
      if (!Array.isArray(v) || v.length !== DIMS) {
        throw new Error(`Unexpected embedding dims: got ${v?.length}, expected ${DIMS}`);
      }
      vectors.push(v);
    }
  }
  if (vectors.length !== texts.length) {
    throw new Error(`Embedding count mismatch: sent ${texts.length}, got ${vectors.length}`);
  }
  return vectors;
}
