import { describe, expect, it } from 'vitest';
import { connectCatalogSchema, saveAutomationSchema, type CatalogAutomation } from '@crm/contracts';
import {
  EMPTY_CONNECT_FORM,
  automationForm,
  automationProblems,
  buildAutomation,
  buildConnect,
  connectProblems,
} from './setup-forms';

const auto = (over: Partial<CatalogAutomation> = {}): CatalogAutomation => ({
  orderAckEnabled: true,
  orderAckPayUrl: null,
  conciergeEnabled: false,
  conciergeHeader: null,
  conciergeMax: 10,
  conciergeReplyOnEmpty: false,
  conciergeEmptyText: null,
  ...over,
});

describe('connect form', () => {
  const ok = {
    ...EMPTY_CONNECT_FORM,
    catalogId: '194836011239',
    accessToken: 'EAAxx'.padEnd(24, 'x'),
  };
  it('requires the catalog id and a token of at least 20 characters', () => {
    expect(connectProblems(EMPTY_CONNECT_FORM)).toEqual({
      catalogId: 'required',
      accessToken: 'required',
    });
    expect(connectProblems({ ...ok, accessToken: 'short-token' })).toEqual({
      accessToken: 'tooShort',
    });
    expect(connectProblems(ok)).toEqual({});
  });
  it('checks the maximum lengths', () => {
    expect(connectProblems({ ...ok, catalogId: '1'.repeat(65) }).catalogId).toBe('tooLong');
    expect(connectProblems({ ...ok, catalogName: 'n'.repeat(192) }).catalogName).toBe('tooLong');
    expect(connectProblems({ ...ok, wabaId: 'w'.repeat(65) }).wabaId).toBe('tooLong');
    expect(connectProblems({ ...ok, phoneNumberId: 'p'.repeat(65) }).phoneNumberId).toBe('tooLong');
  });
  it('posts blank optional ids as null and satisfies the contract', () => {
    const body = buildConnect({ ...ok, catalogName: ' Main ', wabaId: ' ' });
    expect(body).toMatchObject({
      provider: 'meta_cloud',
      catalogId: '194836011239',
      catalogName: 'Main',
      wabaId: null,
      phoneNumberId: null,
    });
    expect(connectCatalogSchema.safeParse(body).success).toBe(true);
  });
  it('supports the 360dialog provider', () => {
    expect(buildConnect({ ...ok, provider: 'dialog_360' }).provider).toBe('dialog_360');
  });
});

describe('automation form', () => {
  it('starts from the saved settings', () => {
    expect(automationForm(auto({ conciergeMax: 25, conciergeHeader: 'Hi' }))).toMatchObject({
      orderAckEnabled: true,
      conciergeMax: '25',
      conciergeHeader: 'Hi',
      orderAckPayUrl: '',
    });
  });
  it('rejects a maximum above 30 or below 1 and a bad link', () => {
    const f = automationForm(auto());
    expect(automationProblems({ ...f, conciergeMax: '50' })).toEqual({ conciergeMax: 'range' });
    expect(automationProblems({ ...f, conciergeMax: '0' })).toEqual({ conciergeMax: 'range' });
    expect(automationProblems({ ...f, conciergeMax: '2.5' })).toEqual({ conciergeMax: 'range' });
    expect(automationProblems({ ...f, orderAckPayUrl: 'pay now' })).toEqual({
      orderAckPayUrl: 'badUrl',
    });
    expect(automationProblems({ ...f, conciergeHeader: 'h'.repeat(61) })).toEqual({
      conciergeHeader: 'tooLong',
    });
    expect(automationProblems({ ...f, conciergeEmptyText: 'e'.repeat(1025) })).toEqual({
      conciergeEmptyText: 'tooLong',
    });
    expect(
      automationProblems({
        ...f,
        conciergeMax: '30',
        orderAckPayUrl: 'https://pay.example.com/checkout',
      }),
    ).toEqual({});
  });
  it('with nothing ticked and fields blank posts false, null and a maximum of 10', () => {
    const body = buildAutomation({
      orderAckEnabled: false,
      orderAckPayUrl: '',
      conciergeEnabled: false,
      conciergeHeader: ' ',
      conciergeMax: '',
      conciergeReplyOnEmpty: false,
      conciergeEmptyText: '',
    });
    expect(body).toEqual({
      orderAckEnabled: false,
      orderAckPayUrl: null,
      conciergeEnabled: false,
      conciergeHeader: null,
      conciergeMax: 10,
      conciergeReplyOnEmpty: false,
      conciergeEmptyText: null,
    });
    expect(saveAutomationSchema.safeParse(body).success).toBe(true);
  });
});
