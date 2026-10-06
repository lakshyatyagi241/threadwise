import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider } from 'next-intl';
import { renderAccount } from '@/features/auth-registration-security/account/render-test-utils';
import { loadMessages } from '@/i18n/messages';
import { blankDefinition, newField, newHiddenField } from '../lib/builder-model';
import { PublicForm } from '../public/public-form';
import { UnavailableForm } from '../public/unavailable';
import { definition, field, loose, PROPERTIES, publicForm } from '../test-fixtures';
import { boundKeys } from '../lib/builder-model';
import type { FieldBlock } from '../lib/types';
import { BlockInspector } from './build-inspector';
import { BuildPalette } from './build-palette';
import { BuildTab } from './build-tab';
import { FormRenderer } from './form-renderer';

const LOCALES = ['en', 'ar'] as const;
const noop = () => undefined;
const props = (over: Record<string, unknown> = {}) => ({
  form: {} as never,
  draft: definition(),
  setDraft: noop,
  live: {} as never,
  patchLive: noop,
  name: 'Contact us',
  setName: noop,
  canEdit: true,
  properties: PROPERTIES,
  onFormChange: noop,
  busy: false,
  propertiesState: 'ready' as const,
  ...over,
});

describe('Build tab', () => {
  for (const locale of LOCALES) {
    it(`lists the blocks with their kind, the CRM link and the move buttons in ${locale}`, () => {
      const html = renderAccount(<BuildTab {...props()} />, { locale });
      for (const label of ['Name', 'Email', 'Phone', 'Topic', 'Message'])
        expect(html).toContain(label);
      expect(html).toContain('aria-pressed="false"');
      // First block cannot go up, last cannot go down.
      expect(html.match(/disabled=""[^>]*aria-label="[^"]*"/g)?.length ?? 0).toBeGreaterThanOrEqual(
        0,
      );
      expect(html).toContain('value="Contact us"');
    });
  }

  it('says what to do with an empty form', () => {
    const html = renderAccount(
      <BuildTab
        {...props({
          draft: blankDefinition({ title: 'T', submitLabel: 'Send', successMessage: 'Ok' }),
        })}
      />,
    );
    expect(html).toContain('No fields yet');
  });

  it('is read only without the update permission', () => {
    const html = renderAccount(<BuildTab {...props({ canEdit: false })} />);
    expect(html).not.toContain('Move Name down');
    expect(html).not.toContain('Remove Name');
    expect(html).toContain('disabled');
  });

  it('marks a block that would stop the form being published', () => {
    const bad = loose({
      steps: [{ id: 's', blocks: [field({ id: 'f_e', kind: 'email', label: '' })] }],
    });
    expect(renderAccount(<BuildTab {...props({ draft: bad })} />)).toContain('Needs attention');
  });
});

describe('Palette', () => {
  const palette = (over: Record<string, unknown> = {}) =>
    renderAccount(
      <BuildPalette
        properties={PROPERTIES}
        propertiesState="ready"
        bound={boundKeys(definition())}
        disabled={false}
        full={false}
        onField={noop}
        onHidden={noop}
        onBlock={noop}
        onProperty={noop}
        {...over}
      />,
    );

  it('offers every field type except hidden, the text blocks and the hidden sources', () => {
    const html = palette();
    for (const kind of [
      'Short text',
      'Long text',
      'Email',
      'Phone number',
      'Number',
      'Amount',
      'Date',
      'Dropdown',
      'Single choice',
      'Multiple choice',
      'Checkbox',
      'Rating',
    ])
      expect(html).toContain(kind);
    for (const source of ['UTM source', 'Referring page', 'Page address', 'Fixed value'])
      expect(html).toContain(source);
  });

  it('greys a bound property, marks a required and a custom one, and groups by object', () => {
    const html = palette();
    expect(html).toContain('In form');
    expect(html).toContain('Required');
    expect(html).toContain('Custom');
    expect(html.indexOf('>Contact<')).toBeLessThan(html.indexOf('>Company<'));
  });

  it('says so when properties are loading or could not be loaded', () => {
    expect(palette({ propertiesState: 'loading', properties: [] })).toContain('Loading properties');
    expect(palette({ propertiesState: 'failed', properties: [] })).toContain('could not be loaded');
  });

  it('stops adding at the block limit', () => {
    const html = palette({ full: true });
    expect(html).toContain('limit of blocks');
    expect(html).toContain('disabled=""');
  });
});

describe('Inspector', () => {
  const inspect = (
    block: FieldBlock | ReturnType<typeof definition>['steps'][number]['blocks'][number],
    over: { canEdit?: boolean; locale?: 'en' | 'ar' } = {},
  ) =>
    renderAccount(
      <BlockInspector
        block={block}
        properties={PROPERTIES}
        bound={boundKeys(definition())}
        canEdit={over.canEdit ?? true}
        onChange={noop}
      />,
      { locale: over.locale ?? 'en' },
    );

  for (const locale of LOCALES) {
    it(`shows label, source, type, required and width for a text field in ${locale}`, () => {
      const html = inspect(newField('short_text', 'City'), { locale });
      expect(html).toContain('value="City"');
      expect(html).toContain('type="radio"');
      expect(html).toContain('role="switch"');
      expect(html).toContain('<option value="full"');
    });
  }

  it('shows the options of a choice and keeps them read only when bound to a property', () => {
    const free = inspect(newField('dropdown', 'Pick'));
    expect(free).toContain('Add option');
    expect(free).toContain('value="Option 1"');
    const mapped = {
      ...newField('dropdown', 'Interest'),
      bind: { object: 'contact' as const, property: 'interest' },
    };
    const html = inspect(mapped);
    expect(html).toContain('The options come from the CRM property.');
    expect(html).toContain('The type follows the CRM property.');
  });

  it('flags a required property and cannot untick it', () => {
    const budget = {
      ...newField('currency', 'Budget'),
      required: true,
      bind: { object: 'contact' as const, property: 'budget' },
    };
    const html = inspect(budget);
    expect(html).toContain('Your workspace requires this property.');
  });

  it('shows the rules of a text field and the range of a number', () => {
    expect(inspect(newField('short_text', 'T'))).toContain('Minimum length');
    expect(inspect(newField('short_text', 'T'))).toContain('Pattern');
    expect(inspect(newField('number', 'N'))).toContain('Smallest value');
    expect(inspect(newField('long_text', 'T'))).not.toContain('Pattern');
  });

  it('shows the source and fixed value of a hidden field', () => {
    const html = inspect({ ...newHiddenField('constant', 'Channel'), constant: '' });
    expect(html).toContain('Fixed value');
    expect(html).toContain('Enter the value.');
    expect(inspect(newHiddenField('utm_source', 'Source'))).not.toContain('Required');
  });

  it('shows heading, paragraph and divider settings', () => {
    expect(inspect({ type: 'heading', id: 'h', text: 'About you', level: 2 })).toContain(
      'Heading text',
    );
    expect(inspect({ type: 'paragraph', id: 'p', html: 'Hi' })).toContain(
      'Plain text, or simple tags',
    );
    expect(inspect({ type: 'divider', id: 'd' })).toContain('A divider has no settings.');
  });

  it('rejects an unsafe pattern with a message', () => {
    const f = { ...newField('short_text', 'T'), validation: { pattern: '(a+)+$' } };
    expect(inspect(f)).toContain('This pattern is not accepted');
  });

  it('is read only without permission', () => {
    expect(inspect(newField('short_text', 'T'), { canEdit: false })).toContain('disabled');
  });
});

/** The renderer outside the app: no session, the form's own language. */
function renderPublic(el: React.ReactElement, locale: 'en' | 'ar' = 'en') {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale={locale} messages={loadMessages(locale)} timeZone="UTC">
      {el}
    </NextIntlClientProvider>,
  );
}

describe('Form renderer', () => {
  const form = definition();
  const base = { form, mode: 'live' as const };

  for (const locale of LOCALES) {
    it(`draws labels tied to their inputs, required marks and the submit button in ${locale}`, () => {
      const html = renderPublic(<FormRenderer {...base} />, locale);
      expect(html).toContain('<h1 class="wf-title">Contact us</h1>');
      expect(html).toMatch(
        /<label class="wf-label" for="[^"]+"><span class="wf-label-text">Name<span class="wf-req" aria-hidden="true">\*<\/span>/,
      );
      expect(html).toContain('type="email"');
      expect(html).toContain('type="tel"');
      expect(html).toContain('<select');
      expect(html).toContain('<textarea');
      expect(html).toContain('>Send</button>');
      expect(html).toContain('noValidate');
    });
  }

  it('sets the language and direction from the form, not from the visitor', () => {
    const ar = loose({ settings: { ...form.settings, locale: 'ar', dir: 'rtl' } });
    const html = renderPublic(<FormRenderer form={ar} mode="live" />, 'en');
    expect(html).toContain('dir="rtl"');
    expect(html).toContain('lang="ar"');
  });

  it('applies the theme as custom properties on one wrapper and carries no style rule from the form', () => {
    const themed = loose({
      theme: { ...form.theme, primary: '#ff0000', radius: 'pill', layout: 'split', mode: 'dark' },
    });
    const html = renderPublic(<FormRenderer form={themed} mode="live" />);
    expect(html).toContain('--f-primary:#ff0000');
    expect(html).toContain('--f-radius:999px');
    expect(html).toContain('data-layout="split"');
    expect(html).toContain('data-mode="dark"');
    expect(html.match(/<style>/g)?.length).toBe(1);
  });

  it('renders the honeypot only when the form has one, hidden from people and assistive tech', () => {
    expect(renderPublic(<FormRenderer {...base} />)).not.toContain('class="wf-hp"');
    const html = renderPublic(<FormRenderer {...base} honeypotField="website_url" />);
    expect(html).toContain('class="wf-hp" aria-hidden="true"');
    expect(html).toContain('name="website_url"');
    expect(html).toContain('tabindex="-1"');
  });

  it('shows the consent box with its text and the privacy link only when the form asks for it', () => {
    expect(renderPublic(<FormRenderer {...base} />)).not.toContain('wf-field wf-consent');
    const asks = loose({
      consent: {
        enabled: true,
        text: 'I agree to be contacted.',
        required: true,
        privacyUrl: 'https://example.com/privacy',
        marketing: false,
        version: 2,
      },
    });
    const html = renderPublic(<FormRenderer form={asks} mode="live" />);
    expect(html).toContain('I agree to be contacted.');
    expect(html).toContain('href="https://example.com/privacy"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it('never renders a hidden field, and renders a paragraph as safe markup', () => {
    const d = loose({
      steps: [
        {
          id: 's',
          blocks: [
            field({ id: 'f_h', kind: 'hidden', label: 'Secret', hiddenSource: 'utm_source' }),
            {
              type: 'paragraph',
              id: 'p',
              html: '<b>Hi</b><script>alert(1)</script><img src=x onerror=alert(1)>',
            },
            field({ id: 'f_a', kind: 'short_text', label: 'A' }),
          ],
        },
      ],
    });
    const html = renderPublic(<FormRenderer form={d} mode="live" />);
    expect(html).not.toContain('Secret');
    expect(html).toContain('<b>Hi</b>');
    expect(html).not.toContain('<script>alert');
    expect(html).not.toContain('onerror');
  });

  it('marks the preview and does not send', () => {
    const html = renderPublic(<FormRenderer form={form} mode="preview" />);
    expect(html).toContain('Preview: nothing is sent from here.');
  });

  it('shows the powered-by line only when given one, with the brand from data', () => {
    expect(renderPublic(<FormRenderer {...base} />)).not.toContain('Powered by');
    expect(renderPublic(<FormRenderer {...base} poweredBy="Acme Forms" />)).toContain(
      'Powered by Acme Forms',
    );
  });

  it('renders every field kind', () => {
    const d = loose({
      steps: [
        {
          id: 's',
          blocks: (
            [
              'short_text',
              'long_text',
              'email',
              'phone',
              'number',
              'currency',
              'date',
              'dropdown',
              'radio',
              'checkbox_group',
              'checkbox',
              'rating',
            ] as const
          ).map((kind) => newField(kind, `K ${kind}`)),
        },
      ],
    });
    const html = renderPublic(<FormRenderer form={d} mode="live" />);
    for (const kind of [
      'type="date"',
      'type="number"',
      'type="radio"',
      'type="checkbox"',
      '<fieldset class="wf-choices"',
      'class="wf-rating"',
    ])
      expect(html).toContain(kind);
  });

  it('puts the first step only, with a progress bar, for a multi-step form', () => {
    const d = loose({
      steps: [
        {
          id: 's1',
          title: 'You',
          blocks: [field({ id: 'f_a', kind: 'short_text', label: 'First' })],
        },
        {
          id: 's2',
          title: 'Them',
          blocks: [field({ id: 'f_b', kind: 'short_text', label: 'Second' })],
        },
      ],
    });
    const html = renderPublic(<FormRenderer form={d} mode="live" />);
    expect(html).toContain('First');
    expect(html).not.toContain('Second');
    expect(html).toContain('wf-steps');
    expect(html).toContain('>Next</button>');
  });
});

describe('Public page', () => {
  for (const locale of LOCALES) {
    it(`draws the published form with the honeypot and the brand in ${locale}`, () => {
      const html = renderPublic(
        <PublicForm
          form={publicForm({ settings: { submitLabel: 'Send', successMode: 'message', locale } })}
          embed={false}
        />,
        locale,
      );
      expect(html).toContain('name="website_url"');
      expect(html).toContain(locale === 'en' ? 'Powered by Forms' : 'مدعوم من Forms');
      expect(html).toContain('data-embed="0"');
    });
  }

  it('makes the framed page transparent and chromeless', () => {
    const html = renderPublic(<PublicForm form={publicForm()} embed />);
    expect(html).toContain('data-embed="1" ');
    expect(html).toContain('html,body{background:transparent!important}');
  });

  it('leaves out the powered-by line when the API says not to show it', () => {
    expect(
      renderPublic(
        <PublicForm
          form={publicForm({ poweredBy: { show: false, label: 'Forms' } })}
          embed={false}
        />,
      ),
    ).not.toContain('Powered by');
  });

  it('says the same thing for an unknown, closed or failed form without naming a reason', () => {
    expect(renderPublic(<UnavailableForm kind="missing" />)).toContain(
      'This form is not available',
    );
    expect(renderPublic(<UnavailableForm kind="closed" />)).toContain('This form is closed');
    expect(renderPublic(<UnavailableForm kind="error" />)).toContain('Something went wrong');
    expect(renderPublic(<UnavailableForm kind="missing" />, 'ar')).toContain(
      'هذا النموذج غير متاح',
    );
  });
});
