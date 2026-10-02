import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NextIntlClientProvider, createTranslator } from 'next-intl';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { tplMetaCategorySchema, tplStatusSchema, tplLintIssueSchema } from '@crm/contracts';
import { newRow } from '../lib/buttons';
import { initialState, previewOf, withBody, type PreviewModel } from '../lib/form-model';
import { CategoryBadge, QualityBadge, StatusBadge } from './badges';
import { ButtonsEditor } from './buttons-editor';
import { LintPanel } from './lint-panel';
import { MessageBubble, PhonePreview } from './message-bubble';
import { VariablesPanel } from './variables-panel';

const messages = JSON.parse(
  readFileSync(join(process.cwd(), 'messages', 'en', 'message-templates.json'), 'utf8'),
) as Record<string, Record<string, unknown>>;

const noop = () => undefined;

const html = (el: ReactElement) =>
  renderToStaticMarkup(
    <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
      {el}
    </NextIntlClientProvider>,
  );

const model = (over: Partial<PreviewModel> = {}): PreviewModel => ({
  auth: false,
  language: 'en_US',
  headerKind: 'none',
  headerText: '',
  headerImageUrl: null,
  body: 'Hello',
  footer: '',
  buttons: [],
  expiry: null,
  ...over,
});

describe('status, category and quality badges', () => {
  it('shows a translated label and the status for every status the contract has', () => {
    for (const s of tplStatusSchema.options) {
      const out = html(<StatusBadge status={s} />);
      expect(out).toContain(`data-status="${s}"`);
      expect(out).not.toContain('message-templates.status');
    }
    expect(html(<StatusBadge status="pending" />)).toContain('In review');
    expect(html(<StatusBadge status="approved" />)).toContain('text-success');
    expect(html(<StatusBadge status="rejected" />)).toContain('text-danger');
  });

  it('labels every category and renders nothing without one', () => {
    for (const c of tplMetaCategorySchema.options) {
      expect(html(<CategoryBadge category={c} />)).not.toContain('message-templates.category');
    }
    expect(html(<CategoryBadge category={null} />)).toBe('');
  });

  it('shows the quality score only when there is one', () => {
    expect(html(<QualityBadge score="GREEN" />)).toContain('High quality');
    expect(html(<QualityBadge score={null} />)).toBe('');
  });
});

describe('message bubble', () => {
  it('renders markup as elements and variables as pills', () => {
    const out = html(<MessageBubble model={model({ body: '*Hi* {{name}}\nsecond line' })} />);
    expect(out).toMatch(/<strong>.*Hi.*<\/strong>/);
    expect(out).toContain('{{name}}');
    expect(out).toContain('<br/>');
  });

  it('never injects html from the body', () => {
    const out = html(<MessageBubble model={model({ body: '<img src=x onerror=alert(1)>' })} />);
    expect(out).not.toContain('<img');
    expect(out).toContain('&lt;img');
  });

  it('shows header text, footer and a media placeholder', () => {
    const text = html(
      <MessageBubble
        model={model({ headerKind: 'text', headerText: 'Order shipped', footer: 'Reply STOP' })}
      />,
    );
    expect(text).toContain('Order shipped');
    expect(text).toContain('Reply STOP');
    expect(html(<MessageBubble model={model({ headerKind: 'video' })} />)).toContain(
      'data-testid="bubble-media"',
    );
  });

  it('lists the buttons and folds the rest into "+N more"', () => {
    const buttons = ['a', 'b', 'c', 'd', 'e'].map((text) => ({
      kind: 'quick_reply' as const,
      text,
    }));
    const out = html(<MessageBubble model={model({ buttons })} maxButtons={3} />);
    expect(out).toContain('+2 more buttons');
    expect(out).not.toContain('>d<');
    expect(html(<MessageBubble model={model({ buttons })} />)).toContain('>e<');
  });

  it('swaps to the fixed layout for an authentication template', () => {
    const out = html(<MessageBubble model={model({ auth: true, expiry: 10 })} />);
    expect(out).toContain('is your verification code');
    expect(out).toContain('expires in 10 minutes');
    expect(out).toContain('Copy code');
  });

  it('says when there is no body yet', () => {
    expect(html(<MessageBubble model={model({ body: '' })} />)).toContain(
      'Your message text appears here.',
    );
  });

  it('wraps the bubble in a labelled phone frame with the language', () => {
    const out = html(<PhonePreview model={model({ language: 'fr' })} />);
    expect(out).toContain('aria-label="Preview"');
    expect(out).toContain('fr');
  });

  it('previews form state with sample values', () => {
    const s = withBody(initialState('c'), 'Hi {{first_name}}');
    expect(html(<PhonePreview model={previewOf(s)} />)).toContain('Hi John');
  });
});

describe('buttons editor', () => {
  it('disables an add button once its limit is reached', () => {
    const rows = [{ ...newRow('phone'), text: 'Call', phone: '+1555' }];
    const out = html(<ButtonsEditor rows={rows} onChange={noop} />);
    const phoneAdd = out.match(/<button[^>]*>(?:(?!<\/button>).)*Call phone<\/button>/s)?.[0] ?? '';
    expect(phoneAdd).toContain('disabled=""');
    const quickAdd =
      out.match(/<button[^>]*>(?:(?!<\/button>).)*Quick reply<\/button>/s)?.[0] ?? '';
    expect(quickAdd).not.toContain('disabled=""');
    expect(out).toContain('1/10 buttons');
  });

  it('labels every row control and shows row problems', () => {
    const out = html(<ButtonsEditor rows={[newRow('url')]} onChange={noop} />);
    expect(out).toContain('aria-label="Remove button 1"');
    expect(out).toContain('Enter the button text.');
    expect(out).toContain('Enter the URL.');
  });

  it('has an empty state', () => {
    expect(html(<ButtonsEditor rows={[]} onChange={noop} />)).toContain('No buttons.');
  });
});

describe('variables panel', () => {
  it('has one row per distinct token with labelled inputs', () => {
    const body = 'Hi {{name}} and {{order}} and {{name}}';
    const s = withBody(initialState('c'), body);
    const out = html(
      <VariablesPanel
        headerText=""
        headerSlots={{}}
        body={body}
        bodySlots={s.bodySlots}
        onHeader={noop}
        onBody={noop}
      />,
    );
    expect(out.match(/data-testid="variable-row"/g)).toHaveLength(2);
    expect(out).toContain('Contact attribute');
    expect(out).toContain('Sample value');
  });

  it('explains itself when there are no variables', () => {
    const out = html(
      <VariablesPanel
        headerText=""
        headerSlots={{}}
        body="plain"
        bodySlots={{}}
        onHeader={noop}
        onBody={noop}
      />,
    );
    expect(out).toContain('No variables yet');
  });
});

describe('lint panel', () => {
  const issue = (severity: 'error' | 'warning', field: 'body' | 'name', message: string) =>
    tplLintIssueSchema.parse({ code: 'x', severity, field, message });

  it('lists issues by field with their severity', () => {
    const out = html(
      <LintPanel
        issues={[issue('warning', 'body', 'Body is long'), issue('error', 'name', 'Name needed')]}
        checking={false}
        failed={false}
      />,
    );
    expect(out).toContain('1 error, 1 warning');
    expect(out.indexOf('Name needed')).toBeLessThan(out.indexOf('Body is long'));
  });

  it('says so when clean, while checking and when the check could not run', () => {
    expect(html(<LintPanel issues={[]} checking={false} failed={false} />)).toContain(
      'No problems found.',
    );
    expect(html(<LintPanel issues={[]} checking failed={false} />)).toContain('Checking');
    expect(html(<LintPanel issues={[]} checking={false} failed />)).toContain('could not run');
  });
});

describe('messages', () => {
  it('are valid ICU, so no screen throws while formatting', () => {
    const bad: string[] = [];
    const t = createTranslator({
      locale: 'en',
      messages,
      onError: (e) => {
        if (e.code === 'INVALID_MESSAGE') bad.push(e.message);
      },
    });
    const walk = (o: Record<string, unknown>, path: string) => {
      for (const [k, v] of Object.entries(o)) {
        if (typeof v === 'string') (t as (key: string, values?: object) => string)(path + k, {});
        else walk(v as Record<string, unknown>, `${path}${k}.`);
      }
    };
    walk(messages, '');
    expect(bad).toEqual([]);
  });
});
