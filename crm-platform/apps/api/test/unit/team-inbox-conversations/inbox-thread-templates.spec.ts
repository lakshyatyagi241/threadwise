import { describe, expect, it, vi } from 'vitest';
import { ERROR_CODES, INBOX_TEMPLATE_LIST_MAX, type SendMessageInput } from '@crm/contracts';
import {
  RequestContextStore,
  type RequestContext,
} from '../../../src/common/context/request-context';
import { InboxThreadService } from '../../../src/modules/team-inbox-conversations/inbox-thread.service';
import type { TemplateRow } from '../../../src/modules/message-templates';

const CONV = '6f1c7a52-3d7a-4a53-9b6e-2f0d2c1a9e10';
const TPL = '8a1c7a52-3d7a-4a53-9b6e-2f0d2c1a9e11';
const CLIENT = '9b1c7a52-3d7a-4a53-9b6e-2f0d2c1a9e12';
const WABA = 7;

const ctx: RequestContext = { requestId: 'r', orgId: 1, actorType: 'user', actorId: 5, userId: 5 };

const template = (over: Partial<TemplateRow> = {}): TemplateRow =>
  ({
    id: 11,
    uuid: TPL,
    templateName: 'order_shipped',
    language: 'en_US',
    header: null,
    templateBody: 'Hi {{1}}, order {{2}} shipped.',
    footer: null,
    buttons: [],
    variableMap: { body: [{ num: 1, key: 'first_name' }] },
    category: 'UTILITY',
    metaCategory: 'UTILITY',
    templateType: 'standard',
    attachmentType: 'none',
    parameterFormat: 'POSITIONAL',
    status: 'approved',
    metaStatus: 'APPROVED',
    pausedUntil: null,
    providerConfigId: WABA,
    ...over,
  }) as TemplateRow;

function setup(
  opts: { rows?: TemplateRow[]; found?: TemplateRow | null; channelWaba?: number | null } = {},
) {
  const enqueueOutbound = vi.fn().mockResolvedValue({ message: { id: 'm1' } });
  const listCalls: Array<Record<string, unknown>> = [];
  const tx = {};
  const service = new InboxThreadService(
    { tx: (fn: (t: unknown) => unknown) => fn(tx) } as never,
    {
      recordByUuid: async () => ({
        id: 1,
        assigneeUserId: 5,
        assigneeTeamId: null,
        channelOwnerUserId: null,
      }),
      byUuid: async () => ({ channelId: 3 }),
    } as never,
    {
      viewer: async () => ({}),
      assertVisible: () => undefined,
      assertCan: async () => undefined,
    } as never,
    {} as never,
    {
      findById: async () => ({
        wabaConfigId: opts.channelWaba === undefined ? WABA : opts.channelWaba,
      }),
    } as never,
    {
      list: async (_tx: unknown, _org: number, filter: Record<string, unknown>) => {
        listCalls.push(filter);
        return opts.rows ?? [template()];
      },
      findByUuid: async () => (opts.found === undefined ? template() : opts.found),
    } as never,
    {} as never,
    { enqueueOutbound } as never,
  );
  const send = (input: Partial<Extract<SendMessageInput, { kind: 'template' }>> = {}) =>
    RequestContextStore.run(ctx, () =>
      service.send(CONV, {
        kind: 'template',
        clientMessageId: CLIENT,
        templateId: TPL,
        variables: { '1': 'Ana', '2': 'A12' },
        ...input,
      } as SendMessageInput),
    );
  const list = (q: { q?: string } = {}) =>
    RequestContextStore.run(ctx, () => service.listTemplates(CONV, q));
  return { send, list, enqueueOutbound, listCalls };
}

describe('InboxThreadService: sending a template', () => {
  it('hands the core the template, the values and the body as the customer reads it', async () => {
    const { send, enqueueOutbound } = setup();
    await send();
    expect(enqueueOutbound).toHaveBeenCalledOnce();
    const arg = enqueueOutbound.mock.calls[0]![0];
    expect(arg.conversationId).toBe(CONV);
    expect(arg.clientMessageId).toBe(CLIENT);
    expect(arg.content).toEqual({
      kind: 'template',
      name: 'order_shipped',
      language: 'en_US',
      variables: { '1': 'Ana', '2': 'A12' },
      body: 'Hi Ana, order A12 shipped.',
      templateId: 11,
    });
  });

  it('trims the values and drops any the template does not have', async () => {
    const { send, enqueueOutbound } = setup();
    await send({ variables: { '1': ' Ana ', '2': 'A12', '9': 'stray' } });
    expect(enqueueOutbound.mock.calls[0]![0].content.variables).toEqual({ '1': 'Ana', '2': 'A12' });
  });

  it('refuses a missing value before anything is stored', async () => {
    const { send, enqueueOutbound } = setup();
    await expect(send({ variables: { '1': 'Ana' } })).rejects.toMatchObject({
      code: ERROR_CODES.VALIDATION_FAILED,
    });
    expect(enqueueOutbound).not.toHaveBeenCalled();
  });

  it('refuses a template that is not found, of another number, or not approved', async () => {
    const cases: Array<[Parameters<typeof setup>[0], string]> = [
      [{ found: null }, 'not found'],
      [{ found: template({ providerConfigId: 99 }) }, 'another WhatsApp number'],
      [{ found: template({ status: 'pending', metaStatus: 'PENDING' }) }, 'not approved'],
      [{ channelWaba: null }, 'not on a WhatsApp number'],
    ];
    for (const [opts, text] of cases) {
      const { send, enqueueOutbound } = setup(opts);
      await expect(send()).rejects.toMatchObject({
        code: ERROR_CODES.INBOX_TEMPLATE_NOT_SENDABLE,
        message: expect.stringContaining(text),
      });
      expect(enqueueOutbound).not.toHaveBeenCalled();
    }
  });

  it('refuses a template the inbox cannot fill in', async () => {
    const { send } = setup({ found: template({ attachmentType: 'image' }) });
    await expect(send()).rejects.toMatchObject({
      code: ERROR_CODES.INBOX_TEMPLATE_NOT_SENDABLE,
      message: expect.stringContaining('media header'),
    });
  });
});

describe('InboxThreadService: listing templates', () => {
  it('offers the approved templates of this number, with the slots and the reason when blocked', async () => {
    const { list } = setup({
      rows: [
        template(),
        template({
          uuid: 'a2',
          templateName: 'pending_one',
          status: 'pending',
          metaStatus: 'PENDING',
        }),
        template({ uuid: 'a3', templateName: 'with_image', attachmentType: 'image' }),
      ],
    });
    const { data, hasMore } = await list();
    expect(hasMore).toBe(false);
    expect(data.map((t) => t.name)).toEqual(['order_shipped', 'with_image']);
    expect(data[0]).toMatchObject({
      sendable: true,
      reason: null,
      category: 'UTILITY',
      slots: [
        { key: '1', label: 'first name' },
        { key: '2', label: 'Variable 2' },
      ],
    });
    expect(data[1]).toMatchObject({ sendable: false, reason: 'media_header' });
  });

  it('narrows to the conversation’s number in the query, so other numbers never fill the page', async () => {
    const { list, listCalls } = setup();
    await list({ q: 'ship' });
    expect(listCalls).toEqual([
      { limit: INBOX_TEMPLATE_LIST_MAX, status: 'approved', providerConfigId: WABA, q: 'ship' },
    ]);
  });

  it('returns a full page and says there are more when the query found one row beyond it', async () => {
    const many = Array.from({ length: INBOX_TEMPLATE_LIST_MAX + 1 }, (_, i) =>
      template({ uuid: `t${i}`, templateName: `t_${i}` }),
    );
    const { list } = setup({ rows: many });
    const { data, hasMore } = await list();
    expect(data).toHaveLength(INBOX_TEMPLATE_LIST_MAX);
    expect(hasMore).toBe(true);
    expect(data.at(-1)?.name).toBe(`t_${INBOX_TEMPLATE_LIST_MAX - 1}`);
  });

  it('says there are no more when the page is exactly full', async () => {
    const exact = Array.from({ length: INBOX_TEMPLATE_LIST_MAX }, (_, i) =>
      template({ uuid: `t${i}`, templateName: `t_${i}` }),
    );
    const { list } = setup({ rows: exact });
    const { data, hasMore } = await list();
    expect(data).toHaveLength(INBOX_TEMPLATE_LIST_MAX);
    expect(hasMore).toBe(false);
  });

  it('offers nothing on a conversation that is not on a WhatsApp number', async () => {
    const { list } = setup({ channelWaba: null });
    expect(await list()).toEqual({ data: [], hasMore: false });
  });
});
