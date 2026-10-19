/**
 * knowledge-base: the search behind every AI agent's knowledge. Constants only; no screen reads or sets any of them (the people who
 * use agents do not tune search), and the platform operator changes the model by the stored `faq.config` document if ever needed.
 */

/**
 * The embedding models the platform accepts. Every one answers in KB_EMBEDDING_DIMENSIONS (3072) dimensions, the width of
 * `ai_training_chunks.embedding`.
 */
export const KB_EMBEDDING_DIMENSIONS = 3072;
export const KB_EMBEDDING_MODELS = [
  { id: 'openai/text-embedding-3-large', dimensions: KB_EMBEDDING_DIMENSIONS },
  { id: 'google/gemini-embedding-2', dimensions: KB_EMBEDDING_DIMENSIONS },
] as const;
export type KbEmbeddingModelId = (typeof KB_EMBEDDING_MODELS)[number]['id'];
export const KB_DEFAULT_EMBEDDING_MODEL: KbEmbeddingModelId = 'openai/text-embedding-3-large';

/**
 * How an agent reads its knowledge for one customer message (the trade-off written down so a change is a decision, not an accident):
 * a few passages, not one and not the whole base. One passage misses answers that span two; the whole base drowns the model.
 * Combining passages raises the chance the model blends two of them into a wrong answer, so three guards apply:
 *   - at most `topK` passages;
 *   - a passage must score at least `floor` (cosine) and within `band` of the best one, so a weak passage never rides along;
 *   - the model is told to answer only from the passages and to say it does not know otherwise.
 * Scores differ by model; each model has its own floor.
 */
export const KB_RETRIEVAL = {
  topK: 3,
  band: 0.12,
  /** Passages the vector query reads before the floor and the band cut them (an exact scan, so cheap). */
  fetch: 8,
  floorByModel: {
    'openai/text-embedding-3-large': 0.3,
    'google/gemini-embedding-2': 0.55,
  } as Readonly<Record<string, number>>,
  defaultFloor: 0.4,
  /** A passage is cut at about this many characters, on a paragraph or sentence edge where it can. */
  chunkChars: 900,
  /** Neighbouring passages of one long entry share this much text, so an answer that sits on a boundary is still whole in one. */
  chunkOverlap: 120,
} as const;

export const kbFloorFor = (modelId: string): number =>
  KB_RETRIEVAL.floorByModel[modelId] ?? KB_RETRIEVAL.defaultFloor;
