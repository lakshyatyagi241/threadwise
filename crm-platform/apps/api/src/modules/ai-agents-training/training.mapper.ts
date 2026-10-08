import type {
  AiagAssistant,
  AiagAssistantStatus,
  AiagPickerItem,
  AiagSource,
  AiagSourceKind,
  AiagSourceStatus,
} from '@crm/contracts';
import type { AssistantRow, PickerRow } from './assistants.repository';
import type { SourceRow } from './sources.repository';

/** The only place an internal id becomes a uuid (and a stored file key becomes a yes/no). */
export const toAssistant = (r: AssistantRow): AiagAssistant => ({
  id: r.uuid,
  name: r.name,
  slug: r.slug,
  status: r.status as AiagAssistantStatus,
  greeting: r.greeting,
  systemPrompt: r.systemPrompt,
  tone: r.tone,
  language: r.language,
  aiProvider: r.aiProvider,
  aiModel: r.aiModel,
  replyMaxTokens: r.replyMaxTokens,
  temperature: r.temperature,
  fallbackMessage: r.fallbackMessage,
  handoffEnabled: r.handoffEnabled,
  handoffKeyword: r.handoffKeyword,
  handoffMessage: r.handoffMessage,
  sourceCount: r.sourceCount,
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
  rowVersion: r.rowVersion,
});

export const toPickerItem = (r: PickerRow): AiagPickerItem => ({
  id: r.uuid,
  name: r.name,
  aiProvider: r.aiProvider,
  aiModel: r.aiModel,
  sources: r.sources,
});

export const toSource = (r: SourceRow): AiagSource => ({
  id: r.uuid,
  assistantId: r.assistantUuid,
  kind: r.kind as AiagSourceKind,
  label: r.label,
  url: r.url,
  status: r.status as AiagSourceStatus,
  tokensEstimate: r.tokensEstimate,
  error: r.error,
  hasFile: r.hasFile,
  createdAt: r.createdAt.toISOString(),
});
