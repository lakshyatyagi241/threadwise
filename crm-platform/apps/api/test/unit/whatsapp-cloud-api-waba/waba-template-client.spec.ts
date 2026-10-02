import { describe, expect, it } from 'vitest';
import { readWabaEnv } from '../../../src/config/domains/whatsapp-cloud-api-waba.env';
import type { WabaConnection } from '../../../src/infra/providers/whatsapp-cloud-api-waba/waba-admin.port';
import {
  WabaHttp,
  type FetchLike,
} from '../../../src/infra/providers/whatsapp-cloud-api-waba/waba-http';
import { WabaTemplateClient } from '../../../src/infra/providers/whatsapp-cloud-api-waba/waba-template.client';

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  json: unknown;
  body: unknown;
}

function setup(replies: Array<[number, unknown]>) {
  const calls: Call[] = [];
  const env = readWabaEnv({ META_APP_ID: 'app1' });
  const http = new WabaHttp(env);
  const impl: FetchLike = async (url, init) => {
    calls.push({
      url,
      method: String(init?.method),
      headers: Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>)),
      json: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
      body: init?.body,
    });
    const [status, body] = replies[Math.min(calls.length - 1, replies.length - 1)]!;
    return new Response(JSON.stringify(body), { status });
  };
  http.fetchImpl = impl;
  return { calls, client: new WabaTemplateClient(http, env) };
}

const meta: WabaConnection = {
  provider: 'meta',
  wabaId: '111',
  phoneNumberId: '222',
  accessToken: 'tok',
};
const interakt: WabaConnection = {
  provider: 'interakt',
  wabaId: '111',
  phoneNumberId: '222',
  authKey: 'partner',
};

describe('WabaTemplateClient', () => {
  it('creates with the category-change flag Geta drops, and returns Meta id and status', async () => {
    const { calls, client } = setup([[200, { id: 't1', status: 'pending', category: 'UTILITY' }]]);
    const r = await client.create(meta, {
      name: 'a_b',
      language: 'en_US',
      category: 'UTILITY',
      components: [{ type: 'BODY', text: 'x' }],
      allowCategoryChange: true,
      parameterFormat: 'POSITIONAL',
    });
    expect(r).toEqual({ id: 't1', status: 'PENDING', category: 'UTILITY' });
    expect(calls[0]!.url).toBe('https://graph.facebook.com/v25.0/111/message_templates');
    expect(calls[0]!.headers.authorization).toBe('Bearer tok');
    expect(calls[0]!.json).toMatchObject({
      allow_category_change: true,
      parameter_format: 'POSITIONAL',
    });
  });

  it('uses the partner key and WABA header on the Interakt route', async () => {
    const { calls, client } = setup([[200, { id: 't1', status: 'PENDING' }]]);
    await client.create(interakt, {
      name: 'a',
      language: 'en',
      category: 'MARKETING',
      components: [],
    });
    expect(calls[0]!.url).toContain('amped-express.interakt.ai/api/v25.0/111/message_templates');
    expect(calls[0]!.headers['x-access-token']).toBe('partner');
    expect(calls[0]!.headers['x-waba-id']).toBe('111');
    expect(calls[0]!.headers.authorization).toBeUndefined();
  });

  it('pages by cursor, never by paging.next', async () => {
    const page = (ids: string[], after?: string, more = true) =>
      [
        200,
        {
          data: ids.map((id) => ({
            id,
            name: `n${id}`,
            status: 'approved',
            language: 'en',
            components: [],
          })),
          paging: {
            cursors: { after },
            ...(more ? { next: 'https://graph.facebook.com/v25.0/never-follow' } : {}),
          },
        },
      ] as [number, unknown];
    const { calls, client } = setup([page(['1', '2'], 'C1'), page(['3'], 'C2', false)]);
    const all = await client.listAll(meta);
    expect(all.map((t) => t.id)).toEqual(['1', '2', '3']);
    expect(all[0]!.status).toBe('APPROVED');
    expect(calls).toHaveLength(2);
    expect(calls[1]!.url).toContain('after=C1');
    expect(calls.every((c) => c.url.startsWith('https://graph.facebook.com/v25.0/111/'))).toBe(
      true,
    );
  });

  it('stops when the cursor does not advance', async () => {
    const same: [number, unknown] = [
      200,
      { data: [{ id: '1', name: 'a' }], paging: { cursors: { after: 'X' }, next: 'u' } },
    ];
    const { calls, client } = setup([same]);
    await client.listAll(meta);
    expect(calls.length).toBeLessThanOrEqual(2);
  });

  it('reads quality and rejection details', async () => {
    const { client } = setup([
      [
        200,
        {
          data: [
            {
              id: '1',
              name: 'a',
              status: 'REJECTED',
              quality_score: { score: 'red' },
              rejected_reason: 'INVALID_FORMAT',
              category: 'marketing',
            },
          ],
        },
      ],
    ]);
    const t = await client.getByName(meta, 'a');
    expect(t).toMatchObject({
      qualityScore: 'RED',
      rejectedReason: 'INVALID_FORMAT',
      category: 'MARKETING',
    });
  });

  it('deletes by name, optionally one language by hsm id', async () => {
    const { calls, client } = setup([[200, { success: true }]]);
    await client.deleteByName(meta, 'promo', '99');
    expect(calls[0]!.method).toBe('DELETE');
    expect(calls[0]!.url).toContain('/111/message_templates?name=promo&hsm_id=99');
  });

  it('Meta media upload is a session then raw bytes with an OAuth header', async () => {
    const { calls, client } = setup([
      [200, { id: 'upload:abc' }],
      [200, { h: '4::handle' }],
    ]);
    const h = await client.uploadHeaderMedia(meta, {
      bytes: new Uint8Array([1, 2, 3]),
      fileName: 'a.png',
      mimeType: 'image/png',
    });
    expect(h).toBe('4::handle');
    expect(calls[0]!.url).toContain(
      '/app1/uploads?file_name=a.png&file_length=3&file_type=image%2Fpng',
    );
    expect(calls[0]!.headers.authorization).toBe('OAuth tok');
    expect(calls[1]!.url).toContain('/upload:abc');
    expect(calls[1]!.headers.file_offset).toBe('0');
    expect(calls[1]!.body).toBeInstanceOf(Uint8Array);
  });

  it('Interakt media upload is one multipart call on the pinned older version', async () => {
    const { calls, client } = setup([[200, { h: '4::ih' }]]);
    const h = await client.uploadHeaderMedia(interakt, {
      bytes: new Uint8Array([1]),
      fileName: 'a.png',
      mimeType: 'image/png',
    });
    expect(h).toBe('4::ih');
    expect(calls[0]!.url).toContain('/api/v17.0/222/media_handle');
    expect(calls[0]!.body).toBeInstanceOf(FormData);
    expect(calls[0]!.headers['x-phone-number-id']).toBe('222');
  });
});
