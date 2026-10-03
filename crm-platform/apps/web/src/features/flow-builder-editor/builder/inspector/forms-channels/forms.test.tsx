import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { FlbBuilderContext } from '@crm/contracts';
import { EMPTY_CONTEXT } from '../../../api/hooks';
import { NODE_FORMS } from '../registry';
import type { FormEnv, FormProps } from '../types';

// The two data hooks the forms use: Google files fail (the integration is not connected) and the product list is empty.
let googleFails = true;
vi.mock('../../../api/hooks', async (orig) => {
  const actual = await orig<typeof import('../../../api/hooks')>();
  return {
    ...actual,
    useGoogleFiles: () =>
      googleFails
        ? { isError: true, isPending: false, data: undefined }
        : {
            isError: false,
            isPending: false,
            data: { data: [{ id: 'sheet-1', name: 'Leads sheet' }] },
          },
    useCommerceProducts: () => ({
      isPending: false,
      isError: false,
      isSuccess: true,
      data: { data: [] },
    }),
  };
});

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function render(
  type: string,
  data: Record<string, unknown>,
  ctx: Partial<FlbBuilderContext> = {},
  env: Partial<FormEnv> = {},
) {
  const Form = NODE_FORMS[type]!;
  const props: FormProps = {
    node: { id: 'n1', type, x: 0, y: 0, data } as never,
    data,
    set: () => undefined,
    setMany: () => undefined,
    addOption: () => undefined,
    removeOption: () => undefined,
    env: {
      ctx: { ...EMPTY_CONTEXT, ...ctx },
      loading: false,
      mode: 'chat',
      openedAs: 'chat',
      channels: ['chat'],
      refresh: () => undefined,
      toast: () => undefined,
      uploadMedia: async () => ({ url: '', filename: '' }),
      nodes: [],
      flowId: null,
      ...env,
    },
  };
  // The text fields read the attribute-picker feed, so a query client must be present (no request is made while rendering to a string).
  return renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      {Form(props) as ReactNode}
    </QueryClientProvider>,
  );
}

const flows = [
  { id: U(1), name: 'Welcome', flowType: 'chat' as const, isPublished: true },
  { id: U(2), name: 'Drip', flowType: 'chat' as const, isPublished: false },
  { id: U(3), name: 'IG bot', flowType: 'instagram' as const, isPublished: true },
  { id: U(4), name: 'Voice', flowType: 'call' as const, isPublished: true },
  { id: U(5), name: 'LINE bot', flowType: 'line' as const, isPublished: true },
  { id: U(6), name: 'TG bot', flowType: 'telegram' as const, isPublished: true },
];

describe('registry (WD-FLB-046, 051)', () => {
  it('the Sub-flow and Chatbot forms of forms-channels replace the earlier ones', () => {
    expect(render('chatbot', { bot: '' })).toContain('Create new AI agent');
    expect(render('subflow', { flow: '' }, { flows })).toContain('Welcome · live');
  });
});

describe('Sub-flow form', () => {
  it('lists the other flows with live / draft, never the flow being edited', () => {
    const html = render('subflow', { flow: '' }, { flows }, { flowId: U(1) });
    expect(html).not.toContain('Welcome');
    expect(html).toContain('Drip · draft');
    expect(html).toContain('IG bot · live');
    expect(html).toContain('— pick flow —');
  });
  it('says Loading while the context loads, and keeps a flow that left the workspace selectable', () => {
    expect(render('subflow', { flow: '' }, {}, { loading: true })).toContain('Loading flows…');
    expect(render('subflow', { flow: U(9) }, { flows })).toContain('(not in workspace)');
  });
});

describe('Chatbot form', () => {
  it('shows each agent as name · provider/model and the disabled Create button with the reason', () => {
    const html = render(
      'chatbot',
      { bot: U(7) },
      { agents: [{ id: U(7), name: 'Triage', provider: 'openai', model: 'gpt-4o-mini' }] },
    );
    expect(html).toContain('Triage · openai/gpt-4o-mini');
    expect(html).toContain('— pick AI agent —');
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Create new AI agent<\/button>/);
    expect(html).toContain('not available yet');
  });
  it('with no agent it says so and points at the team inbox', () => {
    const html = render('chatbot', { bot: '' });
    expect(html).toContain('No agents yet');
    expect(html).toContain('/team-inbox');
  });
});

describe('Commerce forms (WD-FLB-052)', () => {
  it('labels stores with their currency and keeps the WaDesk empty-state copy per provider', () => {
    const html = render(
      'shopify',
      { storeId: U(1), productItems: [] },
      {
        stores: { ...EMPTY_CONTEXT.stores, shopify: [{ id: U(1), name: 'Acme', currency: 'USD' }] },
      },
    );
    expect(html).toContain('Acme · USD');
    expect(render('shopify', {})).toContain('No store connected — go to /shopify');
    expect(render('woocommerce', {})).toContain('No store connected — go to /woocommerce');
    expect(render('whatsapp_shop', {})).toContain('No catalog linked — go to /catalog');
  });
  it('says Loading stores while loading; the product button is off until a store is picked', () => {
    const html = render('whatsapp_shop', {}, {}, { loading: true });
    expect(html).toContain('Loading stores…');
    expect(html).toMatch(/disabled=""[^>]*>Pick products/);
  });
  it('shows each saved product with price and retailer id, and the wait choices', () => {
    const html = render('woocommerce', {
      storeId: U(1),
      abandonedWaitMinutes: 60,
      productItems: [
        { retailer_id: 'R1', name: 'Mug', image: null, price_minor: 1250, currency: 'EUR' },
      ],
    });
    expect(html).toContain('EUR 12.50 · R1');
    for (const t of ['5 minutes', '15 minutes', '1 hour', '4 hours', '1 day'])
      expect(html).toContain(t);
    expect(html).toContain('Max 30 products per node. Tap × to remove.');
  });
});

describe('Book appointment form', () => {
  it('offers every service, inactive ones marked, with its length', () => {
    const html = render(
      'book_appointment',
      { bookingTypeId: '' },
      {
        bookingTypes: [
          { id: U(1), name: 'Consult', duration: 30, active: true },
          { id: U(2), name: 'Old', duration: 45, active: false },
        ],
      },
    );
    expect(html).toContain('— all my services (customer picks) —');
    expect(html).toContain('Consult · 30 min');
    expect(html).toContain('Old (inactive) · 45 min');
  });
});

describe('WhatsApp form form', () => {
  it('lists drafts too and marks them', () => {
    const html = render(
      'wa_form',
      { formId: '' },
      {
        forms: [
          { id: U(1), title: 'Lead', isPublished: true },
          { id: U(2), title: 'WIP', isPublished: false },
        ],
      },
    );
    expect(html).toContain('>Lead<');
    expect(html).toContain('WIP (draft)');
    expect(html).toContain('Only published forms appear here.');
  });
});

describe('Deal form', () => {
  const stages = (pipelines: string[]) =>
    pipelines.map((p, i) => ({ id: U(i + 1), name: 'Won', pipeline: p }));
  it('shows bare stage names with one pipeline', () => {
    const html = render('deal', { stageId: '' }, { stages: stages(['Sales']) });
    expect(html).toContain('>Won<');
    expect(html).not.toContain('Sales · Won');
  });
  it('prefixes the pipeline when there are several, and explains the action', () => {
    const html = render(
      'deal',
      { stageId: '', action: 'move' },
      { stages: stages(['Sales', 'Renewals']) },
    );
    expect(html).toContain('Sales · Won');
    expect(html).toContain('Renewals · Won');
    expect(html).toContain('Re-stages the contact&#x27;s most recent open deal.');
  });
});

describe('Hand-off to WhatsApp (WD-FLB-062, 064, 065)', () => {
  it('Instagram hides Instagram and call flows only', () => {
    const html = render('ig_to_whatsapp', { mode: 'direct', waFlowId: '' }, { flows });
    expect(html).toContain('Welcome · live');
    expect(html).toContain('Drip · draft');
    expect(html).toContain('LINE bot · live');
    expect(html).toContain('TG bot · live');
    expect(html).not.toContain('IG bot');
    expect(html).not.toContain('Voice');
  });
  it('Facebook keeps LINE flows but hides Telegram ones (WaDesk quirk)', () => {
    const html = render('fb_to_whatsapp', { mode: 'direct', waFlowId: '' }, { flows });
    expect(html).toContain('LINE bot · live');
    expect(html).not.toContain('TG bot');
  });
  it('the deep-link mode hints name the DM like WaDesk', () => {
    expect(render('ig_to_whatsapp', { mode: 'deeplink' })).toContain(
      'The IG DM sent with the wa.me link.',
    );
    expect(render('fb_to_whatsapp', { mode: 'deeplink' })).toContain(
      'The Messenger DM sent with the wa.me link.',
    );
  });
});

describe('Google nodes while Google is not connected', () => {
  it('Sheets, Docs and Forms say so and fall back to an id box (no invented list)', () => {
    googleFails = true;
    for (const [type, noun] of [
      ['google_sheets', 'sheets'],
      ['google_docs', 'docs'],
      ['google_form', 'forms'],
    ] as const) {
      const html = render(type, { mode: 'write', sheetId: '', templateId: '', formId: '' });
      expect(html, type).toContain(
        `Google isn&#x27;t connected for this workspace, so your ${noun} can&#x27;t be listed`,
      );
      expect(html, type).not.toContain('Leads sheet');
    }
  });
  it('when Google answers, the picker lists the files', () => {
    googleFails = false;
    const html = render('google_sheets', { mode: 'write', sheetId: '' });
    expect(html).toContain('Leads sheet');
    expect(html).toContain('…or paste a Spreadsheet URL / ID');
    googleFails = true;
  });
  it('the Google Form node shows the one-time Apps Script setup once a form is chosen', () => {
    expect(render('google_form', { formId: '' })).not.toContain('One-time setup');
    const html = render('google_form', { formId: '1FAIpQLSc_abc-123' });
    expect(html).toContain('One-time setup — paste this into your Form&#x27;s Script editor');
    expect(html).toContain(
      'href="/api/v2/flows/builder-context/google/forms/1FAIpQLSc_abc-123/apps-script"',
    );
    expect(html).toContain('onFormSubmit');
  });
});

describe('Call-flow, Instagram, Facebook and Telegram forms render their WaDesk fields', () => {
  it('cf_menu: route-by choices and the branch rows', () => {
    const html = render('cf_menu', { mode: 'digit', options: [{ match: '1', label: 'Sales' }] });
    for (const t of [
      'What the caller says (AI intent)',
      'Keyword match',
      'Key press (1,2,3…)',
      'Add branch',
    ])
      expect(html).toContain(t);
  });
  it('ig_buttons caps at three buttons (the add button disappears)', () => {
    const three = Array.from({ length: 3 }, (_, i) => ({
      type: 'web_url',
      title: `B${i}`,
      url: 'https://x',
    }));
    expect(render('ig_buttons', { text: 'x', buttons: three })).not.toContain('Add button');
    expect(render('ig_buttons', { text: 'x', buttons: three.slice(0, 2) })).toContain('Add button');
  });
  it('fb_gallery caps at ten cards', () => {
    const ten = Array.from({ length: 10 }, () => ({ title: 't' }));
    expect(render('fb_gallery', { cards: ten })).not.toContain('Add card');
    expect(render('fb_gallery', { cards: ten.slice(0, 9) })).toContain('Add card');
  });
  it('tg_payment: the pay-link text only appears in pay-link mode', () => {
    expect(render('tg_payment', { mode: 'invoice' })).not.toContain('Message before the link');
    expect(render('tg_payment', { mode: 'paylink' })).toContain('Message before the link');
  });
});

describe('Legacy Instagram nodes stay editable (hidden from the palette, still on old flows)', () => {
  it('ig_send_dm, ig_quick, ig_ai and ig_ask have their WaDesk fields', () => {
    expect(render('ig_send_dm', { text: 'Hi' })).toContain(
      'The DM text. {{variables}} from earlier nodes are substituted.',
    );
    const quick = render('ig_quick', {
      text: 'x',
      options: [{ title: 'Pricing', payload: 'PRICING' }],
    });
    for (const t of ['Quick replies', 'Add quick reply', 'PAYLOAD']) expect(quick).toContain(t);
    const ai = render('ig_ai', {
      model: 'gpt-4o-mini',
      prompt: '',
      assistant: '',
      save: 'ai_reply',
    });
    for (const t of [
      'Model',
      'Instructions (system prompt)',
      'Knowledge base (optional)',
      'Save reply to',
    ])
      expect(ai).toContain(t);
    const ask = render('ig_ask', { question: 'Name?', save: 'lead_name' });
    for (const t of ['Question', 'Save answer to variable']) expect(ask).toContain(t);
  });
});
