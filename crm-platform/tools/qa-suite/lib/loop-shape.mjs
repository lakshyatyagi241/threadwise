// Loops that are NOT "one statement per item" even though they await a query: a chunked walk (one statement per chunk), a
// LIMIT-bounded drain, or a bounded retry. QA task 43 skips these; everything else that writes in a loop stays flagged.
const CHUNK_STEP = /;\s*\w+\s*\+=\s*[\w.]+\s*\)/; // for (let i = 0; i < n; i += CHUNK)
const PER_ITEM = /\bfor\s*(?:await\s*)?\(\s*(?:const|let|var)\s+[^;]*?\b(?:of|in)\b/; // for (const x of xs)
const RETRY = /\b(?:attempt|attempts|draw|retry|retries|tries)\b/i;

export function batchedLoop(header, body) {
  if (CHUNK_STEP.test(header)) return 'chunked';
  if (RETRY.test(header)) return 'retry';
  // a drain: no element iteration, and every pass is a statement bounded by LIMIT or a *_BATCH/*_CHUNK size
  if (!PER_ITEM.test(header) && /\bLIMIT\b|\b\w*(?:BATCH|CHUNK)\w*\b/.test(body)) return 'drain';
  return null;
}
