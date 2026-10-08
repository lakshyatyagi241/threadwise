import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RequestContextStore } from '../../../src/common/context/request-context';
import {
  CONVERSATIONS_FACADE,
  type ConversationsFacade,
} from '../../../src/modules/chat-conversations';
import { whatsappChannel } from '../chat-conversations/whatsapp-support';
import { AGENT, Api, Inbox, startHarness, type Harness, type Tenant } from './support';

/**
 * A template message in the thread is drawn from its stored template: the header, footer and buttons ride on `template.preview`,
 * while the body stays the text stored at send time. The worker does not run here, so a sent message stays `queued`.
 */
process.env.CHANNEL_SIMULATOR_ENABLED = 'true';

let h: Harness;
let api: Api;
let inbox: Inbox;
let t: Tenant;
let agent: { token: string; userId: number };
let conv: { id: number; uuid: string };
let channelUuid: string;
let templateUuid: string;
let templateId: number;

beforeAll(async () => {
  h = await startHarness();
  api = new Api(h);
  inbox = new Inbox(h, api);
  t = await api.signup('itb');
  agent = await api.member(t, 'agent', AGENT);
  const { number, channel } = await whatsappChannel(h as never, t.orgId, {
    phoneNumberId: '55501',
  });
  channelUuid = channel.uuid;
  conv = await inbox.conversation(t, channelUuid, { messages: 1 });
  const tpl = await h.owner.query(
    `INSERT INTO wa_templates (org_id, template_name, language, header, template_body, footer, buttons, category,
                               meta_category, template_type, attachment_type, status, meta_status, provider_config_id)
     VALUES ($1, 'order_shipped', 'en_US', 'Order update', 'Hi {{1}}, order {{2}} shipped.', 'Reply STOP to opt out',
             $3::jsonb, 'UTILITY', 'UTILITY', 'standard', 'none', 'approved', 'APPROVED', $2)
     RETURNING id, uuid`,
    [
      t.orgId,
      number.configId,
      JSON.stringify([
        { type: 'QUICK_REPLY', text: 'Thanks' },
        { type: 'URL', text: 'Track order', url: 'https://example.com/track' },
        { type: 'PHONE_NUMBER', text: 'Call us', phone_number: '+15550001111' },
        { type: 'COPY_CODE', example: 'ABC' },
      ]),
    ],
  );
  templateId = Number(tpl.rows[0].id);
  templateUuid = tpl.rows[0].uuid as string;
}, 240_000);

afterAll(async () => {
  await h?.stop();
});

interface TemplateMsg {
  id: string;
  kind: string;
  body: string | null;
  template: {
    templateId: string | null;
    name: string;
    variables: Record<string, string>;
    preview?: {
      header: { format: string; text?: string | null } | null;
      footer: string | null;
      buttons: Array<{ type: string; text: string }>;
    };
  } | null;
}

const thread = async (): Promise<TemplateMsg[]> => {
  const res = await api.as(agent.token).get(`/v2/inbox/conversations/${conv.uuid}/messages`);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.data as TemplateMsg[];
};

describe('a template sent from the inbox', () => {
  let messageId: string;

  it('is stored as a template message and the answer to the send already carries the preview', async () => {
    const res = await api
      .as(agent.token)
      .post(`/v2/inbox/conversations/${conv.uuid}/messages`)
      .send({
        kind: 'template',
        templateId: templateUuid,
        variables: { '1': 'Ana', '2': 'A12' },
        clientMessageId: randomUUID(),
      });
    expect(res.status, JSON.stringify(res.body)).toBeLessThan(300);
    messageId = res.body.id;
    expect(res.body.kind).toBe('template');
    expect(res.body.template.preview.footer).toBe('Reply STOP to opt out');
  });

  it('is read back with its header, body, footer and buttons', async () => {
    const m = (await thread()).find((x) => x.id === messageId)!;
    expect(m.body).toBe('Hi Ana, order A12 shipped.');
    expect(m.template).toMatchObject({
      templateId: templateUuid,
      name: 'order_shipped',
      variables: { '1': 'Ana', '2': 'A12' },
      preview: {
        header: { format: 'text', text: 'Order update' },
        footer: 'Reply STOP to opt out',
        buttons: [
          { type: 'quick_reply', text: 'Thanks' },
          { type: 'url', text: 'Track order' },
          { type: 'phone', text: 'Call us' },
          { type: 'copy_code', text: '' },
        ],
      },
    });
  });

  it('shows the header kind of a media template and never a file locator', async () => {
    await h.owner.query(
      `UPDATE wa_templates SET attachment_type = 'image', attachment_file = 'secret-handle',
              header_sample_url = 'https://cdn.example.com/private.png' WHERE id = $1`,
      [templateId],
    );
    const m = (await thread()).find((x) => x.id === messageId)!;
    expect(m.template!.preview!.header).toEqual({ format: 'image', text: null });
    expect(JSON.stringify(m)).not.toContain('secret-handle');
    expect(JSON.stringify(m)).not.toContain('private.png');
  });

  it('keeps the body and gives no preview once the template is deleted', async () => {
    await h.owner.query(`DELETE FROM wa_templates WHERE id = $1`, [templateId]);
    const m = (await thread()).find((x) => x.id === messageId)!;
    expect(m.kind).toBe('template');
    expect(m.body).toBe('Hi Ana, order A12 shipped.');
    expect(m.template!.name).toBe('order_shipped');
    expect(m.template!.preview).toBeUndefined();
  });
});

describe('a template recorded by another sender (the conversation core)', () => {
  it('is stored as a template message linked to the template, and a plain line stays text', async () => {
    const tpl = await h.owner.query(
      `INSERT INTO wa_templates (org_id, template_name, language, template_body, footer, status)
       VALUES ($1, 'promo', 'en', 'Sale today', 'Footer', 'approved') RETURNING uuid`,
      [t.orgId],
    );
    const facade = h.app.get<ConversationsFacade>(CONVERSATIONS_FACADE);
    const ctx = {
      requestId: randomUUID(),
      orgId: t.orgId,
      actorType: 'system' as const,
      actorId: null,
      userId: null,
    };
    const peer = (
      await h.owner.query(`SELECT peer_key FROM conversations WHERE id = $1`, [conv.id])
    ).rows[0].peer_key as string;
    const record = (extra: Record<string, unknown>) =>
      RequestContextStore.run(ctx, () =>
        facade.recordOutbound({
          channelId: channelUuid,
          peerKey: peer,
          source: 'campaign',
          ...extra,
        } as never),
      );

    const key = `test-${randomUUID()}`;
    await record({
      body: 'Sale today',
      providerMessageId: key,
      template: { templateId: tpl.rows[0].uuid, name: 'promo', language: 'en' },
    });
    // The ledger makes the same provider id a no-op.
    await record({ body: 'Sale today', providerMessageId: key, template: { name: 'promo' } });
    await record({ body: 'plain line', providerMessageId: `test-${randomUUID()}` });

    const msgs = await thread();
    const promo = msgs.filter((m) => m.template?.name === 'promo');
    expect(promo).toHaveLength(1);
    expect(promo[0]).toMatchObject({
      kind: 'template',
      body: 'Sale today',
      template: {
        templateId: tpl.rows[0].uuid,
        preview: { footer: 'Footer', header: null, buttons: [] },
      },
    });
    expect(msgs.find((m) => m.body === 'plain line')).toMatchObject({
      kind: 'text',
      template: null,
    });
  });
});
