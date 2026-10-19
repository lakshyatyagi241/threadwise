import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { TemplateGalleryResponse } from '@crm/contracts';

const state = vi.hoisted(() => ({
  can: true,
  gallery: { data: undefined, isPending: false, isError: false, refetch: () => undefined } as {
    data: unknown;
    isPending: boolean;
    isError: boolean;
    refetch: () => void;
  },
}));

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('@/features/auth-registration-security/shared/session-context', () => ({
  useCan: () => state.can,
}));
vi.mock('../api/hooks', () => ({
  useDebounced: (v: string) => v,
  useTemplateGallery: () => state.gallery,
}));

import { TemplateGalleryView } from './gallery-view';

const messages = JSON.parse(
  readFileSync(join(process.cwd(), 'messages', 'en', 'message-templates.json'), 'utf8'),
) as Record<string, Record<string, unknown>>;
const html = (el: ReactElement) =>
  renderToStaticMarkup(
    <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
      {el}
    </NextIntlClientProvider>,
  );

const data: TemplateGalleryResponse = {
  categorieList: [
    { id: 'ecommerce', name: 'Ecommerce' },
    { id: 'food_delivery', name: 'Food Delivery' },
    { id: 'travel', name: 'Travel' },
  ],
  pagination: { currentPage: 0, perPage: 10000, totalPages: 1, totalRecords: 3 },
  templateList: [
    {
      id: 'order_cancelled',
      name: 'order cancelled',
      category: 'ecommerce',
      template_category: 'UTILITY',
      button_type: 'x',
      components: [
        { type: 'HEADER', format: 'TEXT', text: 'Your order is Cancelled' },
        {
          type: 'BODY',
          text: 'Hi {{1}}, order #{{2}} was canceled.',
          example: { body_text: [['name', 'id']] },
        },
        { type: 'BUTTONS', buttons: [{ type: 'QUICK_REPLY', text: 'Confirm Order' }] },
      ],
    },
    {
      id: 'flash_sale',
      name: 'Flash Sale',
      category: 'ecommerce',
      template_category: 'MARKETING',
      button_type: 'none',
      components: [
        { type: 'BODY', text: 'Get 35% off, {{1}}!', example: { body_text: [['Name']] } },
      ],
    },
    {
      id: 'flight_delay',
      name: 'Flight Delay',
      category: 'travel',
      template_category: 'UTILITY',
      button_type: 'none',
      components: [{ type: 'BODY', text: 'Your flight is late.' }],
    },
  ],
};

const show = (over: Partial<typeof state.gallery> = {}, can = true) => {
  state.can = can;
  state.gallery = { data, isPending: false, isError: false, refetch: () => undefined, ...over };
  return html(<TemplateGalleryView />);
};

describe('Template gallery tab (the default templates)', () => {
  it('lays a column per category side by side in one row that scrolls sideways, with its count', () => {
    const out = show();
    expect(out).toContain('data-testid="gallery-columns"');
    expect(out).toContain('overflow-x-scroll');
    expect(out).toContain('2 templates');
    expect(out).toContain('1 template');
    expect(out).toContain('Ecommerce');
    expect(out).toContain('Travel');
    // A category with nothing in the answer has no column, but its chip is still there.
    expect(out).toContain('Food delivery');
    expect(out.match(/data-testid="gallery-card"/g)).toHaveLength(3);
  });

  it('draws each template as the customer sees it, with the sample values in place of the variables', () => {
    const out = show();
    expect(out).toContain('order cancelled');
    expect(out).toContain('Your order is Cancelled');
    expect(out).toContain('Hi name, order #id was canceled.');
    expect(out).toContain('Confirm Order');
  });

  it('"Use this template" opens the new-template form, and is left out without the right to create', () => {
    const out = show();
    expect(out).toContain('href="/templates/new?gallery=order_cancelled"');
    expect(out).toContain('Use this template');
    const read = show({}, false);
    expect(read).not.toContain('/templates/new?gallery=');
    expect(read).toContain('order cancelled');
  });

  it('says so while it loads, when it fails, and when nothing matches', () => {
    expect(show({ data: undefined, isPending: true })).toContain('Loading the gallery');
    expect(show({ data: undefined, isPending: false, isError: true })).toContain(
      'The gallery could not be loaded.',
    );
    expect(show({ data: { ...data, templateList: [] } })).toContain('No template matches');
  });
});
