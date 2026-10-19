import { describe, expect, it } from 'vitest';
import type { TemplateGalleryItem } from '@crm/contracts';
import { previewOf } from './form-model';
import { galleryToState } from './gallery-state';

const item = (over: Partial<TemplateGalleryItem> = {}): TemplateGalleryItem => ({
  id: 'order_out_for_delivery',
  name: 'order out for delivery',
  category: 'ecommerce',
  template_category: 'UTILITY',
  button_type: 'copy_code_url_quick_replies_etc',
  components: [
    { type: 'HEADER', format: 'TEXT', text: 'Order Out for Delivery!' },
    {
      type: 'BODY',
      text: 'Hello {{1}}, your order #{{2}} is on its way.',
      example: { body_text: [['name', 'id']] },
    },
    { type: 'FOOTER', text: 'Type STOP to unsubscribe' },
    {
      type: 'BUTTONS',
      buttons: [
        { type: 'URL', text: 'Track Order', url: 'https://example.com/{{1}}', example: ['abc'] },
        { type: 'QUICK_REPLY', text: 'Later' },
        { type: 'PHONE_NUMBER', text: 'Call us', phone_number: '+15550100100' },
      ],
    },
  ],
  ...over,
});

describe('using a default template', () => {
  it('fills the form: name, category, header, body with sample values, footer and buttons', () => {
    const s = galleryToState(item(), 'conn-1');
    expect(s.connectionId).toBe('conn-1');
    expect(s.name).toBe('order_out_for_delivery');
    expect(s.metaCategory).toBe('UTILITY');
    expect(s.headerKind).toBe('text');
    expect(s.headerText).toBe('Order Out for Delivery!');
    expect(s.body).toBe('Hello {{1}}, your order #{{2}} is on its way.');
    expect(s.bodySlots['1']).toEqual({ key: '1', example: 'name' });
    expect(s.bodySlots['2']).toEqual({ key: '2', example: 'id' });
    expect(s.footer).toBe('Type STOP to unsubscribe');
    expect(s.buttons.map((b) => [b.kind, b.text])).toEqual([
      ['url', 'Track Order'],
      ['quick_reply', 'Later'],
      ['phone', 'Call us'],
    ]);
    expect(s.buttons[0]!.url).toBe('https://example.com/{{1}}');
    expect(s.buttons[0]!.example).toBe('abc');
    expect(s.buttons[2]!.phone).toBe('+15550100100');
  });

  it('a picture header starts as an image header with nothing uploaded yet', () => {
    const s = galleryToState(
      item({
        components: [
          { type: 'HEADER', format: 'IMAGE' },
          { type: 'BODY', text: 'Hi {{1}}', example: { body_text: [['Name']] } },
        ],
      }),
    );
    expect(s.headerKind).toBe('image');
    expect(s.headerText).toBe('');
    expect(s.headerHandle).toBe('');
    expect(s.headerSampleUrl).toBe('');
  });

  it('a template with no header, footer, buttons or samples still opens', () => {
    const s = galleryToState(item({ components: [{ type: 'BODY', text: 'Hello {{1}}' }] }));
    expect(s.headerKind).toBe('none');
    expect(s.footer).toBe('');
    expect(s.buttons).toEqual([]);
    expect(s.bodySlots['1']).toEqual({ key: '1', example: '' });
  });

  it('the phone preview shows the samples in place of the variables', () => {
    expect(previewOf(galleryToState(item())).body).toBe(
      'Hello name, your order #id is on its way.',
    );
  });
});
