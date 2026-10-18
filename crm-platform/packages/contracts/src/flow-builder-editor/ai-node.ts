/**
 * The AI assistant step's setup (TW-FLB-AI): which AI agent (Settings, AI Training) answers, or a custom model and prompt.
 * Pure functions shared by the builder form, both validators (Advanced popup, Simple problems) and the runtime, so all of
 * them agree on what a node means.
 *
 * A node's data: `agentMode` ('agent' | 'custom'), `assistant` (the agent's uuid), and for a custom setup `model`, `prompt`.
 * A step saved before the modes existed has no `agentMode`: it keeps working as it always did, the node's own model and prompt
 * with the picked agent only lending its knowledge (a custom setup). A step with nothing filled in is a new one and reads as 'agent'.
 */
export const FLB_AI_SETUPS = ['agent', 'custom'] as const;
export type FlbAiSetup = (typeof FLB_AI_SETUPS)[number];

/** A saved field as text: a uuid or name, or an old step's numeric row id (0 = none). */
const text = (v: unknown): string =>
  typeof v === 'string' ? v.trim() : typeof v === 'number' && v > 0 ? String(v) : '';

export function flbAiSetup(data: Record<string, unknown> | null | undefined): FlbAiSetup {
  const d = data ?? {};
  if (d.agentMode === 'agent' || d.agentMode === 'custom') return d.agentMode;
  return text(d.assistant) || text(d.assistant_id) || text(d.prompt) || text(d.model)
    ? 'custom'
    : 'agent';
}

/**
 * Why the step cannot run, or null. An agent setup needs the agent. A custom setup needs a prompt; an old step that has only an
 * agent attached (no prompt) still runs on the default prompt, so it passes.
 */
export function flbAiNodeProblem(
  data: Record<string, unknown> | null | undefined,
): 'no_agent' | 'no_prompt' | null {
  const d = data ?? {};
  const hasAgent = text(d.assistant) !== '' || text(d.assistant_id) !== '';
  if (flbAiSetup(d) === 'agent') return hasAgent ? null : 'no_agent';
  return hasAgent || text(d.prompt) !== '' ? null : 'no_prompt';
}
