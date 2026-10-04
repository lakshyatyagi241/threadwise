import { describe, expect, it } from 'vitest';
import {
  blockReason,
  bodySlots,
  checkVariables,
  cleanVariables,
  isApproved,
  renderBody,
  type TemplateFacts,
} from '../../../src/modules/team-inbox-conversations/inbox-template-rules';

const NOW = new Date('2026-10-04T10:00:00Z');

const base: TemplateFacts = {
  status: 'approved',
  metaStatus: 'APPROVED',
  pausedUntil: null,
  templateType: 'standard',
  attachmentType: 'none',
  header: null,
  templateBody: 'Hi {{1}}, your order {{2}} has shipped.',
  buttons: [],
  parameterFormat: 'POSITIONAL',
  variableMap: {
    body: [
      { num: 1, key: 'first_name' },
      { num: 2, key: '2' },
    ],
  },
};

describe('isApproved', () => {
  it('needs the local status and, when known, Meta’s', () => {
    expect(isApproved({ status: 'approved', metaStatus: 'APPROVED' })).toBe(true);
    expect(isApproved({ status: 'public', metaStatus: null })).toBe(true);
    expect(isApproved({ status: 'approved', metaStatus: 'PAUSED' })).toBe(false);
    expect(isApproved({ status: 'pending', metaStatus: 'PENDING' })).toBe(false);
    expect(isApproved({ status: 'rejected', metaStatus: 'REJECTED' })).toBe(false);
  });
});

describe('blockReason', () => {
  it('lets a plain body template through', () => {
    expect(blockReason(base, NOW)).toBeNull();
  });

  it('blocks a template Meta paused until the pause ends', () => {
    expect(blockReason({ ...base, pausedUntil: new Date('2026-10-05T00:00:00Z') }, NOW)).toBe(
      'paused',
    );
    expect(blockReason({ ...base, pausedUntil: new Date('2026-10-03T00:00:00Z') }, NOW)).toBeNull();
  });

  it('blocks what the inbox cannot fill in', () => {
    expect(blockReason({ ...base, templateType: 'auth' }, NOW)).toBe('authentication');
    expect(blockReason({ ...base, parameterFormat: 'NAMED' }, NOW)).toBe('named_variables');
    expect(blockReason({ ...base, attachmentType: 'image' }, NOW)).toBe('media_header');
    expect(blockReason({ ...base, attachmentType: 'location' }, NOW)).toBe('media_header');
    expect(blockReason({ ...base, header: 'Order {{1}}' }, NOW)).toBe('header_variable');
    expect(
      blockReason(
        { ...base, buttons: [{ type: 'URL', text: 'Track', url: 'https://x.co/{{1}}' }] },
        NOW,
      ),
    ).toBe('dynamic_button');
  });

  it('allows a plain text header, quick replies and a fixed link', () => {
    const t = {
      ...base,
      header: 'Order update',
      buttons: [
        { type: 'QUICK_REPLY', text: 'Thanks' },
        { type: 'URL', text: 'Open', url: 'https://example.com/orders' },
      ],
    };
    expect(blockReason(t, NOW)).toBeNull();
  });
});

describe('bodySlots', () => {
  it('has one slot per distinct token, labelled by the mapped attribute', () => {
    const slots = bodySlots(base.templateBody, base.variableMap);
    expect(slots.map((s) => [s.key, s.label])).toEqual([
      ['1', 'first name'],
      ['2', 'Variable 2'],
    ]);
  });

  it('counts a repeated token once and copes with no variables', () => {
    expect(bodySlots('{{1}} and {{1}} again', null)).toHaveLength(1);
    expect(bodySlots('No variables here', null)).toEqual([]);
  });
});

describe('checkVariables', () => {
  const slots = bodySlots(base.templateBody, base.variableMap);

  it('wants every slot filled', () => {
    expect(checkVariables(slots, { '1': 'Ana', '2': '' }).map((p) => p.key)).toEqual(['2']);
    expect(checkVariables(slots, {})).toHaveLength(2);
    expect(checkVariables(slots, { '1': '  ', '2': 'A1' }).map((p) => p.key)).toEqual(['1']);
  });

  it('refuses what WhatsApp refuses in a parameter', () => {
    expect(checkVariables(slots, { '1': 'a\nb', '2': 'x' })).toHaveLength(1);
    expect(checkVariables(slots, { '1': 'a\tb', '2': 'x' })).toHaveLength(1);
    expect(checkVariables(slots, { '1': 'a    b', '2': 'x' })).toHaveLength(1);
    expect(checkVariables(slots, { '1': 'a  b', '2': 'x' })).toEqual([]);
  });
});

describe('cleanVariables and renderBody', () => {
  const slots = bodySlots(base.templateBody, base.variableMap);

  it('keeps only the template’s slots, trimmed', () => {
    expect(cleanVariables(slots, { '1': ' Ana ', '2': 'A12', extra: 'ignored' })).toEqual({
      '1': 'Ana',
      '2': 'A12',
    });
  });

  it('renders the body the way the customer reads it', () => {
    expect(renderBody(base.templateBody, { '1': 'Ana', '2': 'A12' })).toBe(
      'Hi Ana, your order A12 has shipped.',
    );
    expect(renderBody('Hi {{1}} {{3}}', { '1': 'Ana' })).toBe('Hi Ana {{3}}');
  });
});
