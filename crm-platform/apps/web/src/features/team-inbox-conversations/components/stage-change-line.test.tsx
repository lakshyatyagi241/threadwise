import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NextIntlClientProvider } from 'next-intl';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { message } from '../lib/fixtures';
import { MessageBubble } from './message-bubble';

const can = vi.hoisted(() => ({ allowed: true }));
vi.mock('@/features/auth-registration-security/shared/session-context', () => ({
  useCan: () => can.allowed,
}));
vi.mock('../api/stage-undo', () => ({
  useUndoStageChange: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('@crm/ui', async (orig) => ({
  ...(await orig<typeof import('@crm/ui')>()),
  useToast: () => ({ toast: vi.fn() }),
}));

const load = (locale: string) =>
  JSON.parse(
    readFileSync(join(process.cwd(), 'messages', locale, 'team-inbox-conversations.json'), 'utf8'),
  ) as Record<string, unknown>;

const render = (action: 'auto' | 'undone', stageUndone = false, locale = 'en') =>
  renderToStaticMarkup(
    <NextIntlClientProvider locale={locale} messages={load(locale)} timeZone="UTC">
      <ul>
        <MessageBubble
          message={message(9, {
            kind: 'system',
            direction: 'in',
            body: 'english fallback',
            systemEvent: {
              event: 'stage_change',
              action,
              suggestionId: '6f1c2f6e-3b0a-4a39-9d5e-0d1c5b3f7a11',
              fromStage: 'Lead',
              toStage: 'Ready to buy',
            },
          })}
          quoted={null}
          onRetry={async () => undefined}
          stageUndone={stageUndone}
        />
      </ul>
    </NextIntlClientProvider>,
  );

describe('the stage change line in the thread', () => {
  beforeEach(() => {
    can.allowed = true;
  });

  it('tells the thread the AI moved the contact, with an Undo', () => {
    const out = render('auto');
    expect(out).toContain('data-testid="inbox-stage-line"');
    expect(out).toContain('moved this contact from Lead to Ready to buy');
    expect(out).toContain('data-testid="inbox-stage-undo"');
  });

  it('drops the Undo once a later line says it was undone', () => {
    const out = render('auto', true);
    expect(out).not.toContain('inbox-stage-undo');
    expect(out).toContain('Undone');
  });

  it('shows no Undo to someone who may not decide stage changes', () => {
    can.allowed = false;
    const out = render('auto');
    expect(out).toContain('moved this contact from Lead to Ready to buy');
    expect(out).not.toContain('inbox-stage-undo');
  });

  it('says the change was undone, with no button', () => {
    const out = render('undone');
    expect(out).toContain('Stage change undone: back to Ready to buy.');
    expect(out).not.toContain('inbox-stage-undo');
  });

  it('is worded in the reader’s language (German)', () => {
    const out = render('auto', false, 'de');
    expect(out).toContain('Die KI hat den Chat gelesen');
    expect(out).not.toContain('english fallback');
  });
});
