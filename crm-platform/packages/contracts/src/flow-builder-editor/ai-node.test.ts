import { describe, expect, it } from 'vitest';
import { flbAiNodeProblem, flbAiSetup } from './ai-node';
import { flbDefaultNodeData } from './node-catalogue';
import { flbToRuntimeData } from './runtime-shape';
import { flbValidateGraph } from './validation';

describe('AI assistant step setup', () => {
  it('a new step is an agent setup and needs an agent', () => {
    const d = flbDefaultNodeData('ai');
    expect(flbAiSetup(d)).toBe('agent');
    expect(flbAiNodeProblem(d)).toBe('no_agent');
    expect(flbAiNodeProblem({ ...d, assistant: 'a-1' })).toBeNull();
  });

  it('a step saved before the choice existed is a custom setup, so it keeps its own model and prompt', () => {
    expect(flbAiSetup({ model: 'gpt-4o-mini', prompt: 'Be brief' })).toBe('custom');
    expect(flbAiSetup({ assistant: 'a-1' })).toBe('custom');
    expect(flbAiSetup({ assistant_id: 4 })).toBe('custom');
    expect(flbAiSetup({})).toBe('agent');
    expect(flbAiSetup(null)).toBe('agent');
  });

  it('an explicit choice wins over what the fields suggest', () => {
    expect(flbAiSetup({ agentMode: 'agent', prompt: 'x', model: 'm' })).toBe('agent');
    expect(flbAiSetup({ agentMode: 'custom' })).toBe('custom');
    expect(flbAiSetup({ agentMode: 'weird', prompt: 'x' })).toBe('custom');
  });

  it('a custom setup needs a prompt, or an agent lending its knowledge', () => {
    expect(flbAiNodeProblem({ agentMode: 'custom', prompt: '   ' })).toBe('no_prompt');
    expect(flbAiNodeProblem({ agentMode: 'custom', prompt: 'Be brief' })).toBeNull();
    expect(flbAiNodeProblem({ agentMode: 'custom', prompt: '', assistant: 'a-1' })).toBeNull();
  });

  it('an agent setup ignores a leftover prompt: the agent is what answers', () => {
    expect(flbAiNodeProblem({ agentMode: 'agent', prompt: 'Be brief', assistant: '' })).toBe(
      'no_agent',
    );
  });
});

describe('publishing an AI assistant step', () => {
  const run = (data: Record<string, unknown>) =>
    flbValidateGraph(
      [
        { id: 't', type: 'trigger', data: { deviceId: 'd' } },
        { id: 'a', type: 'ai', data },
      ],
      [{ source: 't', target: 'a' }],
      { mode: 'chat', senderAvailable: true },
    );

  it('refuses a step with no agent and no prompt, and outlines it', () => {
    const r = run({ agentMode: 'agent', assistant: '' });
    expect(r.ok).toBe(false);
    expect(r.badNodeIds).toEqual(['a']);
    expect(r.items).toEqual([
      '"AI assistant" has no AI agent and no prompt — pick an AI agent, or choose Custom setup and write the instructions.',
    ]);
  });

  it('accepts a chosen agent, a custom prompt and an old step that has a prompt', () => {
    expect(run({ agentMode: 'agent', assistant: 'a-1' }).ok).toBe(true);
    expect(run({ agentMode: 'custom', prompt: 'Be brief' }).ok).toBe(true);
    expect(run({ model: 'gpt-4o-mini', prompt: 'Be brief' }).ok).toBe(true);
  });
});

describe('the setup choice reaches the runtime', () => {
  it('the runtime shaper keeps agentMode and the agent beside the names it adds', () => {
    const shaped = flbToRuntimeData({
      type: 'ai',
      data: { agentMode: 'agent', assistant: 'a-1', save: 'answer' },
    });
    expect(shaped).toMatchObject({ agentMode: 'agent', assistant: 'a-1', variable: 'answer' });
    expect(flbAiSetup(shaped)).toBe('agent');
  });
});
