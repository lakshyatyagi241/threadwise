import {
  AIAG_BUILDER_DEFAULTS,
  AIAG_LIMITS,
  AIAG_SOURCE_LIMITS,
  type AiagAssistant,
  type AiagAssistantStatus,
  type AiModelOption,
  type CreateAiagAssistantInput,
} from '@crm/contracts';

/** The wizard's five steps, in Reference's order. */
export const TOTAL_STEPS = 5;
export type StepNumber = 1 | 2 | 3 | 4 | 5;
export const STEP_KEYS = ['identity', 'persona', 'brain', 'safety', 'knowledge'] as const;

/** The builder's form. Numbers are text while typing, so an empty or half-typed box is not coerced under the person's fingers. */
export interface BuilderState {
  id: string | null;
  rowVersion: number | null;
  name: string;
  status: AiagAssistantStatus;
  greeting: string;
  systemPrompt: string;
  tone: string;
  language: string;
  aiProvider: string;
  aiModel: string;
  replyMaxTokens: string;
  temperature: string;
  fallbackMessage: string;
  handoffEnabled: boolean;
  handoffKeyword: string;
  handoffMessage: string;
}

export function newState(): BuilderState {
  const d = AIAG_BUILDER_DEFAULTS;
  return {
    id: null,
    rowVersion: null,
    name: d.name,
    status: d.status,
    greeting: d.greeting,
    systemPrompt: d.systemPrompt,
    tone: d.tone,
    language: d.language,
    aiProvider: d.aiProvider,
    aiModel: d.aiModel,
    replyMaxTokens: String(d.replyMaxTokens),
    temperature: String(d.temperature),
    fallbackMessage: d.fallbackMessage,
    handoffEnabled: d.handoffEnabled,
    handoffKeyword: d.handoffKeyword,
    handoffMessage: d.handoffMessage,
  };
}

export function fromAssistant(a: AiagAssistant): BuilderState {
  return {
    id: a.id,
    rowVersion: a.rowVersion,
    name: a.name,
    status: a.status,
    greeting: a.greeting ?? '',
    systemPrompt: a.systemPrompt ?? '',
    tone: a.tone,
    language: a.language,
    aiProvider: a.aiProvider,
    aiModel: a.aiModel,
    replyMaxTokens: String(a.replyMaxTokens),
    temperature: String(a.temperature),
    fallbackMessage: a.fallbackMessage ?? '',
    handoffEnabled: a.handoffEnabled,
    handoffKeyword: a.handoffKeyword ?? '',
    handoffMessage: a.handoffMessage ?? '',
  };
}

/** What the API takes. A blank optional text goes as null, so clearing a box clears the stored value. */
export function toPayload(s: BuilderState): CreateAiagAssistantInput {
  return {
    name: s.name.trim(),
    status: s.status,
    greeting: s.greeting,
    systemPrompt: s.systemPrompt,
    tone: s.tone.trim() || AIAG_BUILDER_DEFAULTS.tone,
    language: s.language.trim() || AIAG_BUILDER_DEFAULTS.language,
    aiProvider: s.aiProvider,
    aiModel: s.aiModel.trim(),
    replyMaxTokens: Number.parseInt(s.replyMaxTokens, 10),
    // Reference read `parseFloat(x) || 0.7`, so a creativity of 0 (strict) silently became 0.7. A 0 is kept here.
    temperature: Number.parseFloat(s.temperature),
    fallbackMessage: s.fallbackMessage,
    handoffEnabled: s.handoffEnabled,
    handoffKeyword: s.handoffKeyword,
    handoffMessage: s.handoffMessage,
  };
}

export type ProblemKey = 'name' | 'greeting' | 'model' | 'tokens' | 'temperature';
export type StepCheck = { ok: true } | { ok: false; key: ProblemKey; field: string };

/** The rules a step must pass before the wizard moves on (Reference's gate; steps 4 and 5 never block). */
export function validateStep(n: number, s: BuilderState): StepCheck {
  if (n === 1 && s.name.trim() === '') return { ok: false, key: 'name', field: 'name' };
  if (n === 2 && s.greeting.trim() === '') return { ok: false, key: 'greeting', field: 'greeting' };
  if (n === 3) {
    if (s.aiModel.trim() === '') return { ok: false, key: 'model', field: 'aiModel' };
    const tokens = Number(s.replyMaxTokens);
    if (
      s.replyMaxTokens.trim() === '' ||
      !Number.isInteger(tokens) ||
      tokens < AIAG_LIMITS.replyMaxTokensMin ||
      tokens > AIAG_LIMITS.replyMaxTokensMax
    ) {
      return { ok: false, key: 'tokens', field: 'replyMaxTokens' };
    }
    const temp = Number(s.temperature);
    if (
      s.temperature.trim() === '' ||
      Number.isNaN(temp) ||
      temp < AIAG_LIMITS.temperatureMin ||
      temp > AIAG_LIMITS.temperatureMax
    ) {
      return { ok: false, key: 'temperature', field: 'temperature' };
    }
  }
  return { ok: true };
}

/** The first failing step of 1..4, so a save can open it. */
export function firstProblem(
  s: BuilderState,
): { step: number; problem: ProblemKey; field: string } | null {
  for (let n = 1; n <= 4; n++) {
    const p = validateStep(n, s);
    if (!p.ok) return { step: n, problem: p.key, field: p.field };
  }
  return null;
}

/** Moving back, or to a step already reached, is free; moving ahead must pass the current step. */
export const canJump = (target: number, current: number, furthest: number): 'free' | 'gate' =>
  target <= current || target <= furthest ? 'free' : 'gate';

/** The knowledge step opens only once the assistant exists (entries attach to a saved row). */
export const knowledgeOpen = (s: BuilderState): boolean => s.id !== null;

/** Models offered for one provider: the enabled list first, de-duplicated. */
export function modelsFor(provider: string, enabled: readonly AiModelOption[]): string[] {
  return [...new Set(enabled.filter((m) => m.provider === provider).map((m) => m.value))];
}

/** The providers the picker offers: the enabled ones; every catalogue provider when none is enabled (the model box is free text). */
export function providersOffered(
  all: ReadonlyArray<{ slug: string; name: string }>,
  enabled: readonly AiModelOption[],
): Array<{ slug: string; name: string }> {
  const on = new Set(enabled.map((m) => m.provider as string));
  return on.size === 0 ? [...all] : all.filter((p) => on.has(p.slug));
}

export const FILE_ACCEPT = '.pdf,.docx,.txt,.md,.markdown,.csv,.html,.htm,.log';

/** A file the upload would take, judged in the browser first so a wrong pick fails before any bytes move. */
export function checkFile(
  file: { name: string; size: number },
  allowed: readonly string[],
): 'ok' | 'type' | 'legacyDoc' | 'size' | 'empty' {
  const dot = file.name.lastIndexOf('.');
  const ext = dot > 0 ? file.name.slice(dot + 1).toLowerCase() : '';
  if (ext === 'doc') return 'legacyDoc';
  if (!allowed.includes(ext)) return 'type';
  if (file.size === 0) return 'empty';
  if (file.size > AIAG_SOURCE_LIMITS.fileBytes) return 'size';
  return 'ok';
}
