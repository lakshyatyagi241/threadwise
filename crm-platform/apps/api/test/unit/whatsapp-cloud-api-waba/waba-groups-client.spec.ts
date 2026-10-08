import { describe, expect, it } from 'vitest';
import { readWabaEnv } from '../../../src/config/domains/whatsapp-cloud-api-waba.env';
import type { WabaConnection } from '../../../src/infra/providers/whatsapp-cloud-api-waba/waba-admin.port';
import { WabaApiError } from '../../../src/infra/providers/whatsapp-cloud-api-waba/waba-errors';
import {
  describeGroupFailure,
  GROUP_ERROR_TEXT,
} from '../../../src/infra/providers/whatsapp-cloud-api-waba/waba-group-errors';
import { WabaGroupsClient } from '../../../src/infra/providers/whatsapp-cloud-api-waba/waba-groups.client';
import { WabaHttp } from '../../../src/infra/providers/whatsapp-cloud-api-waba/waba-http';
import { FakeWabaGroupsGateway } from '../../support/fake-waba-groups-gateway';

const conn: WabaConnection = {
  provider: 'meta',
  wabaId: 'W1',
  phoneNumberId: '555',
  accessToken: 'EAAG-token',
};

function setup() {
  const gw = new FakeWabaGroupsGateway();
  const http = new WabaHttp(readWabaEnv({ META_APP_ID: 'a', META_APP_SECRET: 's' }));
  http.fetchImpl = gw.fetch;
  return { gw, client: new WabaGroupsClient(http) };
}

describe('the Groups client (against a fake of the Graph edge; never run against real Meta)', () => {
  it('create: POST /{phone}/groups with the trimmed subject, the description and the mode, token in the header', async () => {
    const { gw, client } = setup();
    const { groupId } = await client.create(conn, {
      subject: '  VIP customers  ',
      description: 'For the best ones',
      joinApprovalMode: 'approval_required',
    });
    expect(groupId).toBeTruthy();
    const call = gw.calls[0]!;
    expect(call.method).toBe('POST');
    expect(call.path).toBe('/555/groups');
    expect(call.authorization).toBe('Bearer EAAG-token');
    expect(call.body).toEqual({
      messaging_product: 'whatsapp',
      subject: 'VIP customers',
      description: 'For the best ones',
      join_approval_mode: 'approval_required',
    });
  });

  it('create: cuts the subject at 128 characters and the description at 2048, by character (an emoji is not split)', async () => {
    const { gw, client } = setup();
    await client.create(conn, { subject: '😀'.repeat(200), description: 'd'.repeat(3000) });
    const body = gw.calls[0]!.body as { subject: string; description: string };
    expect(Array.from(body.subject)).toHaveLength(128);
    expect(body.description).toHaveLength(2048);
  });

  it('create: sends neither an empty description nor an unset mode', async () => {
    const { gw, client } = setup();
    await client.create(conn, { subject: 'Plain', description: '   ' });
    expect(gw.calls[0]!.body).toEqual({ messaging_product: 'whatsapp', subject: 'Plain' });
  });

  it('info asks for every documented field and reads the members and the count', async () => {
    const { gw, client } = setup();
    gw.seed({ id: 'G1', subject: 'S', participants: ['911', '922'] });
    const info = await client.info(conn, 'G1');
    expect(gw.calls[0]!.query.fields).toBe(
      'subject,description,participants,join_approval_mode,suspended,creation_timestamp,total_participant_count',
    );
    expect(info).toMatchObject({
      subject: 'S',
      totalParticipantCount: 2,
      suspended: false,
      participants: ['911', '922'],
    });
  });

  it('invite link: GET reads it, POST resets it', async () => {
    const { gw, client } = setup();
    gw.seed({ id: 'G1', inviteLink: 'https://chat.whatsapp.com/old' });
    expect(await client.inviteLink(conn, 'G1')).toBe('https://chat.whatsapp.com/old');
    const fresh = await client.resetInviteLink(conn, 'G1');
    expect(fresh).not.toBe('https://chat.whatsapp.com/old');
    expect(gw.calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      'GET /G1/invite_link',
      'POST /G1/invite_link',
    ]);
    expect(gw.calls[1]!.body).toEqual({ messaging_product: 'whatsapp' });
  });

  it('update sends only the fields given', async () => {
    const { gw, client } = setup();
    gw.seed({ id: 'G1' });
    await client.update(conn, 'G1', { subject: ' New name ' });
    expect(gw.calls[0]!.body).toEqual({ messaging_product: 'whatsapp', subject: 'New name' });
  });

  it('delete is DELETE /{group} and removes it', async () => {
    const { gw, client } = setup();
    gw.seed({ id: 'G1' });
    await client.delete(conn, 'G1');
    expect(gw.calls[0]).toMatchObject({ method: 'DELETE', path: '/G1' });
    expect(gw.groups.has('G1')).toBe(false);
  });

  it('approve is POST and reject is DELETE on /join_requests, both with the ids in the body', async () => {
    const { gw, client } = setup();
    gw.seed({ id: 'G1', joinRequests: ['j1', 'j2', 'j3'] });
    await client.approveJoinRequests(conn, 'G1', ['j1']);
    await client.rejectJoinRequests(conn, 'G1', ['j2']);
    expect(gw.calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      'POST /G1/join_requests',
      'DELETE /G1/join_requests',
    ]);
    expect(gw.calls[0]!.body).toEqual({ messaging_product: 'whatsapp', join_requests: ['j1'] });
    expect(gw.calls[1]!.body).toEqual({ messaging_product: 'whatsapp', join_requests: ['j2'] });
    expect(gw.groups.get('G1')!.joinRequests).toEqual(['j3']);
  });

  it('remove participants: DELETE with the ids in the body, at most 8, never an empty list', async () => {
    const { gw, client } = setup();
    gw.seed({ id: 'G1', participants: ['1', '2', '3'] });
    await client.removeParticipants(conn, 'G1', ['1', '2']);
    expect(gw.calls[0]).toMatchObject({ method: 'DELETE', path: '/G1/participants' });
    expect(gw.calls[0]!.body).toEqual({ messaging_product: 'whatsapp', participants: ['1', '2'] });
    await expect(
      client.removeParticipants(
        conn,
        'G1',
        Array.from({ length: 9 }, (_, i) => String(i)),
      ),
    ).rejects.toThrow(/at most 8/);
    await expect(client.removeParticipants(conn, 'G1', [])).rejects.toThrow();
    expect(gw.calls).toHaveLength(1);
  });

  it('eligibility: only 131215 is a definite "no"; a timeout or a rate limit is "unknown" (so it is never cached)', async () => {
    const { gw, client } = setup();
    expect(await client.probe(conn)).toBe('eligible');
    expect(gw.calls[0]).toMatchObject({ method: 'GET', path: '/555/groups' });
    expect(gw.calls[0]!.query.limit).toBe('1');
    gw.eligible = false;
    expect(await client.probe(conn)).toBe('not_eligible');
    gw.eligible = true;
    gw.failWith(/GET \/555\/groups/, 131208, 'slow down', 429);
    expect(await client.probe(conn)).toBe('unknown');
    gw.failWith(/GET \/555\/groups/, 1, 'boom', 500);
    expect(await client.probe(conn)).toBe('unknown');
  });

  it('a Meta error is thrown as WabaApiError with its code', async () => {
    const { gw, client } = setup();
    gw.failWith(/POST/, 131211, 'limit', 400);
    await expect(client.create(conn, { subject: 'x' })).rejects.toMatchObject({ code: 131211 });
  });
});

describe('Groups error mapping', () => {
  const err = (status: number, code: number | null, message = 'm') =>
    WabaApiError.fromResponse(status, code === null ? {} : { error: { message, code } });

  it('has an operator sentence for each of the 15 codes Reference translates', () => {
    expect(Object.keys(GROUP_ERROR_TEXT).map(Number)).toEqual([
      131020, 131041, 131059, 131201, 131202, 131204, 131207, 131208, 131209, 131210, 131211,
      131212, 131213, 131214, 131215,
    ]);
    for (const code of Object.keys(GROUP_ERROR_TEXT).map(Number)) {
      expect(describeGroupFailure(err(400, code, 'developer text')).message).toBe(
        GROUP_ERROR_TEXT[code],
      );
    }
  });

  it('maps the codes the API answers with', () => {
    const kind = (code: number) => describeGroupFailure(err(400, code)).kind;
    expect(kind(131215)).toBe('not_eligible');
    expect(kind(131041)).toBe('not_found');
    expect(kind(131207)).toBe('suspended');
    expect(kind(131204)).toBe('limit_reached');
    expect(kind(131211)).toBe('limit_reached');
    expect(kind(131208)).toBe('rate_limited');
    expect(kind(131213)).toBe('rejected');
    expect(kind(131214)).toBe('rejected');
  });

  it('uses Meta\'s own message for an unknown code and "HTTP n" when there is none', () => {
    expect(describeGroupFailure(err(400, 100, 'Invalid parameter')).message).toBe(
      'Invalid parameter',
    );
    expect(describeGroupFailure(err(502, null)).message).toBe('HTTP 502');
  });

  it('only a network failure or a 5xx is transient (worth one retry); a rejection never is', () => {
    expect(describeGroupFailure(WabaApiError.network(new Error('x'))).transient).toBe(true);
    expect(describeGroupFailure(err(503, null)).transient).toBe(true);
    expect(describeGroupFailure(err(400, 131201)).transient).toBe(false);
    expect(describeGroupFailure(err(400, 131208)).transient).toBe(false);
  });
});
