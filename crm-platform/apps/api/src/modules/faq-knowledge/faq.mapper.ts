import type {
  FaqAnswerType,
  FaqEmbedState,
  FaqEntry,
  FaqEntrySummary,
  FaqLogItem,
  FaqStatus,
  FaqVariation,
  FaqVariationSource,
} from '@crm/contracts';
import type { LogRow } from './faq-log.repository';
import type { EntryRow, VariationRow } from './faq.repository';

const PREVIEW = 160;

/** The only place an internal id becomes a uuid. */
export const toSummary = (r: EntryRow): FaqEntrySummary => ({
  id: r.uuid,
  question: r.question,
  answerType: r.answerType as FaqAnswerType,
  answerPreview: r.answerText === null ? null : Array.from(r.answerText).slice(0, PREVIEW).join(''),
  flowId: r.flowUuid,
  flowName: r.flowName,
  category: r.category,
  status: r.status as FaqStatus,
  thresholdOverride: r.thresholdOverride,
  hitCount: r.hitCount,
  lastHitAt: r.lastHitAt ? r.lastHitAt.toISOString() : null,
  variationCount: r.variationCount,
  readyCount: r.readyCount,
  failedCount: r.failedCount,
  pendingCount: Math.max(0, r.variationCount - r.readyCount - r.failedCount),
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
  rowVersion: r.rowVersion,
});

export const toVariation = (r: VariationRow): FaqVariation => ({
  id: r.uuid,
  text: r.text,
  source: r.source as FaqVariationSource,
  embedState: r.embedState as FaqEmbedState,
  embedError: r.embedError,
  createdAt: r.createdAt.toISOString(),
  rowVersion: r.rowVersion,
});

export const toEntry = (r: EntryRow, variations: VariationRow[]): FaqEntry => {
  const { answerPreview: _preview, ...rest } = toSummary(r);
  void _preview;
  return { ...rest, answerText: r.answerText, variations: variations.map(toVariation) };
};

export const toLogItem = (r: LogRow): FaqLogItem => ({
  id: r.uuid,
  createdAt: r.createdAt.toISOString(),
  origin: r.origin,
  query: r.query,
  queryLength: r.queryLength,
  outcome: r.outcome,
  tier: r.tier,
  faqId: r.faqUuid,
  faqQuestion: r.faqQuestion,
  score: r.score,
  secondScore: r.secondScore,
  matchedText: r.matchedText,
  candidates: r.candidates,
  embeddingModel: r.embeddingModel,
  latencyMs: r.latencyMs,
  error: r.error,
  resolved: r.resolved,
});
