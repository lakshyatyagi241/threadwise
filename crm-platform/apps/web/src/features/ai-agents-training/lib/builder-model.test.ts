import { describe, expect, it } from 'vitest';
import type { AiModelOption, AiagAssistant } from '@crm/contracts';
import {
  canJump,
  checkFile,
  firstProblem,
  fromAssistant,
  knowledgeOpen,
  modelsFor,
  newState,
  providersOffered,
  toPayload,
  validateStep,
  type BuilderState,
} from './builder-model';

const withState = (over: Partial<BuilderState>): BuilderState => ({
  ...newState(),
  name: 'Bot',
  ...over,
});

describe('the wizard defaults (WD-AIAG-002)', () => {
  it('starts with the reference values and no id', () => {
    const s = newState();
    expect(s).toMatchObject({
      id: null,
      rowVersion: null,
      name: '',
      status: 'active',
      greeting: 'Hi! How can I help today?',
      tone: 'helpful',
      language: 'en',
      aiProvider: 'openai',
      aiModel: 'gpt-4o-mini',
      replyMaxTokens: '400',
      temperature: '0.7',
      handoffEnabled: true,
      handoffKeyword: 'talk to human',
    });
    expect(s.systemPrompt).toMatch(/helpful website assistant/);
  });
});

describe('step rules (WD-AIAG-002: the gate before Next)', () => {
  it('step 1 needs a name that is not blank', () => {
    expect(validateStep(1, newState())).toMatchObject({ ok: false, key: 'name', field: 'name' });
    expect(validateStep(1, withState({ name: '   ' }))).toMatchObject({ ok: false, key: 'name' });
    expect(validateStep(1, withState({}))).toEqual({ ok: true });
  });

  it('step 2 needs an opening line', () => {
    expect(validateStep(2, withState({ greeting: ' ' }))).toMatchObject({
      ok: false,
      key: 'greeting',
    });
    expect(validateStep(2, withState({}))).toEqual({ ok: true });
  });

  it('step 3 needs a model, 50 to 4000 whole tokens and a creativity from 0 to 2', () => {
    expect(validateStep(3, withState({ aiModel: ' ' }))).toMatchObject({ ok: false, key: 'model' });
    for (const tokens of ['49', '4001', '', 'abc', '400.5']) {
      expect(validateStep(3, withState({ replyMaxTokens: tokens })), tokens).toMatchObject({
        ok: false,
        key: 'tokens',
      });
    }
    for (const tokens of ['50', '4000'])
      expect(validateStep(3, withState({ replyMaxTokens: tokens }))).toEqual({ ok: true });
    for (const t of ['-0.1', '2.1', '', 'x']) {
      expect(validateStep(3, withState({ temperature: t })), t).toMatchObject({
        ok: false,
        key: 'temperature',
      });
    }
    for (const t of ['0', '2', '1.25'])
      expect(validateStep(3, withState({ temperature: t }))).toEqual({ ok: true });
  });

  it('steps 4 and 5 never block', () => {
    expect(validateStep(4, withState({ handoffKeyword: '', fallbackMessage: '' }))).toEqual({
      ok: true,
    });
    expect(validateStep(5, newState())).toEqual({ ok: true });
  });

  it('a save opens the first failing step', () => {
    expect(firstProblem(newState())).toEqual({ step: 1, problem: 'name', field: 'name' });
    expect(firstProblem(withState({ greeting: '', replyMaxTokens: '1' }))).toMatchObject({
      step: 2,
    });
    expect(firstProblem(withState({ replyMaxTokens: '1' }))).toMatchObject({
      step: 3,
      problem: 'tokens',
    });
    expect(firstProblem(withState({}))).toBeNull();
  });

  it('moving back or to a reached step is free, ahead is gated', () => {
    expect(canJump(1, 3, 3)).toBe('free');
    expect(canJump(4, 2, 4)).toBe('free');
    expect(canJump(4, 2, 2)).toBe('gate');
  });

  it('Knowledge opens only once the agent is saved', () => {
    expect(knowledgeOpen(newState())).toBe(false);
    expect(knowledgeOpen({ ...newState(), id: 'x' })).toBe(true);
  });
});

describe('the payload', () => {
  it('turns the text boxes into numbers and keeps a creativity of 0 (WaDesk turned it into 0.7)', () => {
    const p = toPayload(
      withState({ temperature: '0', replyMaxTokens: '250', name: '  Bot  ', aiModel: ' m ' }),
    );
    expect(p).toMatchObject({ temperature: 0, replyMaxTokens: 250, name: 'Bot', aiModel: 'm' });
  });

  it('an empty tone or language falls back to the defaults; blank optional text goes through for the API to clear', () => {
    const p = toPayload(
      withState({ tone: ' ', language: '', fallbackMessage: '', handoffKeyword: '' }),
    );
    expect(p).toMatchObject({
      tone: 'helpful',
      language: 'en',
      fallbackMessage: '',
      handoffKeyword: '',
    });
  });

  it('round-trips a saved assistant, null texts becoming empty boxes', () => {
    const a: AiagAssistant = {
      id: '00000000-0000-4000-8000-000000000001',
      name: 'FAQ',
      slug: 'faq',
      status: 'paused',
      greeting: null,
      systemPrompt: null,
      tone: 'formal',
      language: 'ar',
      aiProvider: 'anthropic',
      aiModel: 'claude-x',
      replyMaxTokens: 123,
      temperature: 1.5,
      fallbackMessage: null,
      handoffEnabled: false,
      handoffKeyword: null,
      handoffMessage: null,
      sourceCount: 2,
      createdAt: '2026-10-01T00:00:00.000Z',
      updatedAt: '2026-10-01T00:00:00.000Z',
      rowVersion: 4,
    };
    const s = fromAssistant(a);
    expect(s).toMatchObject({
      id: a.id,
      rowVersion: 4,
      greeting: '',
      replyMaxTokens: '123',
      temperature: '1.5',
      handoffEnabled: false,
    });
    expect(toPayload(s)).toMatchObject({
      aiProvider: 'anthropic',
      aiModel: 'claude-x',
      temperature: 1.5,
    });
  });
});

describe('the model picker (WD-AIAG-002, from the enabled-model list)', () => {
  const enabled: AiModelOption[] = [
    { value: 'gpt-5.4-mini', provider: 'openai', providerName: 'OpenAI', source: 'platform' },
    { value: 'gpt-5.4-mini', provider: 'openai', providerName: 'OpenAI', source: 'workspace' },
    { value: 'claude-haiku', provider: 'anthropic', providerName: 'Anthropic', source: 'platform' },
  ];
  const all = [
    { slug: 'openai', name: 'OpenAI' },
    { slug: 'anthropic', name: 'Anthropic' },
    { slug: 'mistral', name: 'Mistral' },
  ];

  it('lists the enabled models of one provider, once each', () => {
    expect(modelsFor('openai', enabled)).toEqual(['gpt-5.4-mini']);
    expect(modelsFor('mistral', enabled)).toEqual([]);
  });

  it('offers only the enabled providers, or all of them when none is enabled', () => {
    expect(providersOffered(all, enabled).map((p) => p.slug)).toEqual(['openai', 'anthropic']);
    expect(providersOffered(all, []).map((p) => p.slug)).toEqual([
      'openai',
      'anthropic',
      'mistral',
    ]);
  });
});

describe('the file check before an upload (WD-AIAG-008)', () => {
  const allowed = ['txt', 'md', 'pdf', 'docx'];
  it.each([
    [{ name: 'a.txt', size: 10 }, 'ok'],
    [{ name: 'A.PDF', size: 10 }, 'ok'],
    [{ name: 'old.doc', size: 10 }, 'legacyDoc'],
    [{ name: 'run.exe', size: 10 }, 'type'],
    [{ name: 'noext', size: 10 }, 'type'],
    [{ name: 'a.txt', size: 0 }, 'empty'],
    [{ name: 'a.txt', size: 10 * 1024 * 1024 }, 'ok'],
    [{ name: 'a.txt', size: 10 * 1024 * 1024 + 1 }, 'size'],
  ] as const)('%j is %s', (file, verdict) => expect(checkFile(file, allowed)).toBe(verdict));
});
