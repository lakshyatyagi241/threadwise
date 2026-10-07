import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@crm/ui';
import type { AiModelOption, SessionResponse } from '@crm/contracts';
import { SessionProvider } from '@/features/auth-registration-security/shared/session-context';
import { newState } from '../lib/builder-model';
import { BrainStep, IdentityStep, PersonaStep, SafetyStep } from './builder-steps';
import { KnowledgeStep } from './knowledge-step';
import { PlanPaywall } from './plan-paywall';
import { ResponderCard } from './responder-card';
import { TrainingScreen } from './training-screen';

// The list screen reads the app router for its redirect after a duplicate; there is no router in a string render.
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => undefined }) }));

const messages = JSON.parse(
  readFileSync(join(process.cwd(), 'messages', 'en', 'ai-agents-training.json'), 'utf8'),
) as Record<string, unknown>;

const session = (permissions: string[]) =>
  ({
    user: { id: 'u1', fullName: 'Asha Rao', displayName: null },
    org: { name: 'Acme', timezone: null },
    permissions: Object.fromEntries(permissions.map((p) => [p, 'all'])),
  }) as unknown as SessionResponse;

const html = (el: ReactElement, permissions: string[] = []) =>
  renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <SessionProvider session={session(permissions)}>
        <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
          <ToastProvider dismissLabel="Dismiss">{el}</ToastProvider>
        </NextIntlClientProvider>
      </SessionProvider>
    </QueryClientProvider>,
  );

const noop = () => undefined;
const step = { s: newState(), set: noop, flash: null, disabled: false };

describe('builder steps (TW-AIAG-002)', () => {
  it('Identity: a required name, the status choices, the four tones', () => {
    const out = html(<IdentityStep {...step} />);
    expect(out).toContain('Agent display name');
    expect(out).toMatch(/id="aiag-f-name"[^>]*aria-required="true"/);
    expect(out).toContain('Live: pick this agent in widgets and flows');
    expect(out).toContain('Paused: hide from pickers');
    for (const tone of ['Helpful', 'Friendly', 'Formal', 'Playful']) expect(out).toContain(tone);
  });

  it('a failed check flashes the field and marks it invalid', () => {
    const out = html(<IdentityStep {...step} flash="name" />);
    expect(out).toMatch(/aria-invalid="true"[^>]*class="[^"]*border-danger/);
  });

  it('a tone saved outside the four stays selectable', () => {
    const out = html(<IdentityStep {...step} s={{ ...newState(), tone: 'pirate' }} />);
    expect(out).toContain('<option value="pirate"');
  });

  it('Persona: the opening line is required, the brief is not', () => {
    const out = html(<PersonaStep {...step} />);
    expect(out).toMatch(/id="aiag-f-greeting"[^>]*aria-required="true"/);
    expect(out).not.toMatch(/id="aiag-f-systemPrompt"[^>]*aria-required/);
    expect(out).toContain('Hi! How can I help today?');
  });

  const enabled: AiModelOption[] = [
    { value: 'claude-haiku', provider: 'anthropic', providerName: 'Anthropic', source: 'platform' },
    { value: 'gpt-5.4-mini', provider: 'openai', providerName: 'OpenAI', source: 'platform' },
  ];

  it('Brain: only enabled providers, the enabled models of the provider as suggestions, bounds on the numbers', () => {
    const out = html(<BrainStep {...step} enabled={enabled} modelsLoaded />);
    expect(out).toContain('>OpenAI<');
    expect(out).toContain('>Anthropic<');
    expect(out).not.toContain('>Mistral<');
    expect(out).toContain('<option value="gpt-5.4-mini"');
    expect(out).not.toContain('<option value="claude-haiku"');
    expect(out).toMatch(/type="number"[^>]*min="50"[^>]*max="4000"/);
    expect(out).toMatch(/type="number"[^>]*min="0"[^>]*max="2"/);
  });

  it('Brain: with no enabled model every provider is offered and the person is told why the list is empty', () => {
    const out = html(<BrainStep {...step} enabled={[]} modelsLoaded />);
    expect(out).toContain('>Mistral<');
    expect(out).toContain('No AI model is enabled for your workspace yet');
  });

  it('Brain: nothing is claimed about the models while they are still loading', () => {
    const out = html(<BrainStep {...step} enabled={[]} modelsLoaded={false} />);
    expect(out).not.toContain('No AI model is enabled');
  });

  it('Brain: a saved provider that is no longer enabled stays visible, marked as such', () => {
    const out = html(
      <BrainStep
        {...step}
        s={{ ...newState(), aiProvider: 'mistral' }}
        enabled={enabled}
        modelsLoaded
      />,
    );
    expect(out).toContain('mistral (not enabled)');
  });

  it('Safety: the handoff switch, its phrase and acknowledgement, and the fallback', () => {
    const out = html(<SafetyStep s={newState()} set={noop} disabled={false} />);
    expect(out).toContain('Enable handoff to a person');
    expect(out).toContain('value="talk to human"');
    expect(out).toContain('value="Sure — pulling in a teammate now."');
    expect(out).toMatch(/type="checkbox"[^>]*checked/);
  });

  it('every control is disabled for a person who may not save', () => {
    const out = html(<IdentityStep {...step} disabled />);
    expect(out.match(/disabled=""/g)?.length).toBeGreaterThanOrEqual(4);
  });
});

describe('knowledge step (TW-AIAG-005..010)', () => {
  it('before the first save it says to save first and offers no add buttons', () => {
    const out = html(<KnowledgeStep assistantId={null} canEdit />);
    expect(out).toContain('Save the agent first');
    expect(out).not.toContain('Live URL');
  });

  it('a saved assistant offers the four kinds, each a labelled toggle', () => {
    const out = html(<KnowledgeStep assistantId="a1" canEdit />);
    for (const k of ['Live URL', 'Free text', 'Q&amp;A pair', 'PDF, DOCX, TXT &amp; more'])
      expect(out).toContain(k);
    expect(out.match(/aria-pressed="false"/g)).toHaveLength(4);
    expect(out).toContain('Loading entries');
  });

  it('a person who cannot edit sees the list but not the add buttons', () => {
    const out = html(<KnowledgeStep assistantId="a1" canEdit={false} />);
    expect(out).not.toContain('Live URL');
  });
});

describe('screens', () => {
  it('the list page: the responder card, the rails, the empty-table frame and the create button for people who may create', () => {
    const out = html(<TrainingScreen />, ['aiag.training.read', 'aiag.training.create']);
    expect(out).toContain('Who answers your WhatsApp?');
    expect(out).toContain('Agent status');
    expect(out).toContain('New smart agent');
    expect(out).toContain('href="/ai-training/create"');
    expect(out).toContain('Loading agents');
  });

  it('the create button is absent without the create key', () => {
    const out = html(<TrainingScreen />, ['aiag.training.read']);
    expect(out).not.toContain('New smart agent');
  });

  it('the responder card shows a spinner until the setting loads (never a guess)', () => {
    const out = html(<ResponderCard />, ['aiag.responder.manage']);
    expect(out).toContain('aria-busy="true"');
    expect(out).not.toContain('Our AI answers');
  });

  it('the paywall explains the plan and links to the plans', () => {
    const out = html(<PlanPaywall />);
    expect(out).toContain('AI Training is not in your plan');
    expect(out).toContain('See plans');
  });
});
