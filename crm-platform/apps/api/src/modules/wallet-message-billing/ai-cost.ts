import { LSC_MODELS } from '@crm/contracts';

/**
 * What an AI call cost the platform, in US dollars, when the vendor did not say. Pure: nothing here reads a database.
 *
 * Order of trust: the vendor's own figure (OpenRouter returns `usage.cost`), then the price of the exact model when it is known,
 * then the price of its family. Those two are ESTIMATES and the operator's markup sits on top. A model the table does not know is
 * priced at the dearest rate in it (`UNKNOWN_MODEL`): several call sites take the model name from the caller, so a name nobody priced
 * must never be the cheap way to run an expensive model on the platform's key. A blended provider rate applies only when no model is
 * named at all. A zero-token call costs nothing.
 */

export interface AiCostInput {
  provider: string | null | undefined;
  model: string | null | undefined;
  promptTokens: number;
  completionTokens: number;
  /** What the vendor reported for this call, in US dollars. Wins over every estimate when it is above 0. */
  reportedCostUsd?: number | null;
}

/** Dollars per million tokens. The first matching pattern wins, so list the narrower model before its family. */
const MODEL_FAMILIES: ReadonlyArray<{
  match: RegExp;
  inputPerMillion: number;
  outputPerMillion: number;
}> = [
  // The dear models first: a name that contains a cheaper family's name must not be priced as that family.
  { match: /o1-pro|o3-pro/i, inputPerMillion: 150, outputPerMillion: 600 },
  { match: /gpt-4\.5/i, inputPerMillion: 75, outputPerMillion: 150 },
  { match: /gpt-4-32k/i, inputPerMillion: 60, outputPerMillion: 120 },
  { match: /o[134]-mini/i, inputPerMillion: 1.1, outputPerMillion: 4.4 },
  { match: /(^|[/:-])o[13]($|[-:.])/i, inputPerMillion: 15, outputPerMillion: 60 },
  { match: /gpt-4-turbo|gpt-4-(0[0-9]+|vision)/i, inputPerMillion: 10, outputPerMillion: 30 },
  {
    match: /gpt-4o-mini|gpt-4\.1-mini|gpt-5-mini|o4-mini/i,
    inputPerMillion: 0.4,
    outputPerMillion: 1.6,
  },
  { match: /gpt-4\.1-nano|gpt-5-nano/i, inputPerMillion: 0.1, outputPerMillion: 0.4 },
  { match: /gpt-4o|gpt-4\.1|gpt-5/i, inputPerMillion: 2.5, outputPerMillion: 10 },
  { match: /claude.*haiku/i, inputPerMillion: 1, outputPerMillion: 5 },
  { match: /claude.*opus/i, inputPerMillion: 15, outputPerMillion: 75 },
  { match: /claude/i, inputPerMillion: 3, outputPerMillion: 15 },
  { match: /gemini.*flash/i, inputPerMillion: 0.3, outputPerMillion: 2.5 },
  { match: /gemini/i, inputPerMillion: 1.25, outputPerMillion: 10 },
  { match: /mistral.*(small|nemo)|ministral/i, inputPerMillion: 0.2, outputPerMillion: 0.6 },
  { match: /mistral|mixtral|codestral/i, inputPerMillion: 2, outputPerMillion: 6 },
  { match: /deepseek/i, inputPerMillion: 0.3, outputPerMillion: 1.2 },
  { match: /grok/i, inputPerMillion: 3, outputPerMillion: 15 },
  { match: /llama|gpt-oss|qwen/i, inputPerMillion: 0.2, outputPerMillion: 0.8 },
  { match: /embed/i, inputPerMillion: 0.1, outputPerMillion: 0 },
];

/** What a model nobody priced costs per million tokens: the dearest rate above (Claude Opus), so an unknown name is never the cheap way in. */
const UNKNOWN_MODEL = { inputPerMillion: 15, outputPerMillion: 75 } as const;

/** Blended dollars per million tokens when no model is named at all: the rate the admin usage page estimates with. */
const BLENDED_PER_MILLION: Record<string, number> = {
  openai: 5,
  anthropic: 6,
  gemini: 1,
  google: 1,
  deepseek: 0.8,
  grok: 5,
  xai: 5,
  mistral: 2,
};
const DEFAULT_BLENDED_PER_MILLION = 4;

const tokens = (n: number): number => (Number.isFinite(n) && n > 0 ? n : 0);

export function aiCostUsd(i: AiCostInput): number {
  const reported = i.reportedCostUsd ?? 0;
  if (reported > 0) return reported;
  const prompt = tokens(i.promptTokens);
  const completion = tokens(i.completionTokens);
  if (prompt + completion === 0) return 0;

  const model = (i.model ?? '').trim();
  const known = model ? LSC_MODELS.find((m) => m.id === model) : undefined;
  const price =
    known ??
    (model ? (MODEL_FAMILIES.find((f) => f.match.test(model)) ?? UNKNOWN_MODEL) : undefined);
  if (price) {
    return (prompt * price.inputPerMillion + completion * price.outputPerMillion) / 1_000_000;
  }
  const rate =
    BLENDED_PER_MILLION[(i.provider ?? '').trim().toLowerCase()] ?? DEFAULT_BLENDED_PER_MILLION;
  return ((prompt + completion) * rate) / 1_000_000;
}
