import type { FetchLike } from '../../src/infra/providers/whatsapp-cloud-api-waba/waba-http';

/**
 * A fake of Meta's Groups API at the HTTP edge (docs/specs/waba-groups-management.md 17). NOTHING here has been compared with real Meta:
 * there is no Official Business Account to test with (BL-030). The shapes follow the spec's section 6 and WaDesk's `GroupClient`; where the
 * spec marks a fact unverified (rate limits, per-code errors, the participant cap) this fake invents nothing beyond what a test sets.
 *
 * It keeps groups in memory so create -> info -> link -> join requests -> remove -> delete behave as a sequence, records every call
 * (method, path, query, body), and lets a test make the next matching call fail with a Meta error.
 */
export interface FakeCall {
  method: string;
  path: string;
  query: Record<string, string>;
  body: Record<string, unknown> | null;
  authorization: string | null;
}

export interface FakeGroup {
  id: string;
  subject: string;
  description: string | null;
  joinApprovalMode: string;
  suspended: boolean;
  inviteLink: string | null;
  participants: string[];
  joinRequests: string[];
}

interface Failure {
  match: RegExp;
  status: number;
  code: number;
  message: string;
  times: number;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export class FakeWabaGroupsGateway {
  readonly calls: FakeCall[] = [];
  readonly groups = new Map<string, FakeGroup>();
  /** `false`: the probe answers 131215 (not an Official Business Account). */
  eligible = true;
  private failures: Failure[] = [];
  private seq = 0;

  /** Makes the next `times` calls whose "METHOD /path" matches fail the way Meta does. */
  failWith(match: RegExp, code: number, message: string, status = 400, times = 1): void {
    this.failures.push({ match, status, code, message, times });
  }

  reset(): void {
    this.calls.length = 0;
    this.groups.clear();
    this.failures = [];
    this.eligible = true;
  }

  callsTo(match: RegExp): FakeCall[] {
    return this.calls.filter((c) => match.test(`${c.method} ${c.path}`));
  }

  /** A group Meta already has (made on a phone, say): not created through the API. */
  seed(g: Partial<FakeGroup> & { id: string }): FakeGroup {
    const group: FakeGroup = {
      subject: 'Seeded',
      description: null,
      joinApprovalMode: 'auto_approve',
      suspended: false,
      inviteLink: `https://chat.whatsapp.com/${g.id}`,
      participants: [],
      joinRequests: [],
      ...g,
    };
    this.groups.set(group.id, group);
    return group;
  }

  readonly fetch: FetchLike = async (input, init) => {
    const url = new URL(input);
    const path = url.pathname.replace(/^\/v\d+\.\d+/, '');
    const method = String(init?.method ?? 'GET');
    const body =
      typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : null;
    const headers = (init?.headers ?? {}) as Record<string, string>;
    this.calls.push({
      method,
      path,
      query: Object.fromEntries(url.searchParams.entries()),
      body,
      authorization: headers.authorization ?? null,
    });
    const key = `${method} ${path}`;
    const failure = this.failures.find((f) => f.times > 0 && f.match.test(key));
    if (failure) {
      failure.times -= 1;
      return json({ error: { message: failure.message, code: failure.code } }, failure.status);
    }
    return this.route(method, path, body);
  };

  private route(method: string, path: string, body: Record<string, unknown> | null): Response {
    const parts = path.split('/').filter(Boolean);
    const [first, second, third] = parts;
    // /{phone}/groups
    if (second === 'groups' && parts.length === 2) {
      if (!this.eligible) {
        return json(
          { error: { message: 'Groups API is not available for this business', code: 131215 } },
          400,
        );
      }
      if (method === 'GET')
        return json({ data: [...this.groups.values()].map((g) => ({ id: g.id })) });
      if (method === 'POST') {
        const id = `Y2hhdC${String(++this.seq).padStart(4, '0')}A${first}`;
        this.seed({
          id,
          subject: String(body?.subject ?? ''),
          description: (body?.description as string | undefined) ?? null,
          joinApprovalMode: String(body?.join_approval_mode ?? 'auto_approve'),
          // Meta issues the link on the lifecycle webhook, not in this answer.
          inviteLink: null,
        });
        return json({ messaging_product: 'whatsapp', id });
      }
    }
    const group = first ? this.groups.get(first) : undefined;
    if (!group) {
      return json({ error: { message: 'Group not found', code: 131041 } }, 400);
    }
    if (parts.length === 1) {
      if (method === 'GET') {
        return json({
          id: group.id,
          subject: group.subject,
          description: group.description ?? undefined,
          join_approval_mode: group.joinApprovalMode,
          suspended: group.suspended,
          creation_timestamp: 1_760_000_000,
          total_participant_count: group.participants.length,
          participants: group.participants.map((wa_id) => ({ wa_id })),
        });
      }
      if (method === 'POST') {
        if (typeof body?.subject === 'string') group.subject = body.subject;
        if (typeof body?.description === 'string') group.description = body.description;
        return json({ success: true });
      }
      if (method === 'DELETE') {
        this.groups.delete(group.id);
        return json({ success: true });
      }
    }
    if (second === 'invite_link') {
      if (method === 'GET') return json({ invite_link: group.inviteLink ?? undefined });
      if (method === 'POST') {
        group.inviteLink = `https://chat.whatsapp.com/${group.id}r${++this.seq}`;
        return json({ messaging_product: 'whatsapp', invite_link: group.inviteLink });
      }
    }
    if (second === 'join_requests' && (method === 'POST' || method === 'DELETE')) {
      const ids = (body?.join_requests as string[] | undefined) ?? [];
      group.joinRequests = group.joinRequests.filter((j) => !ids.includes(j));
      return json({ success: true });
    }
    if (second === 'participants' && method === 'DELETE' && !third) {
      const ids = (body?.participants as string[] | undefined) ?? [];
      group.participants = group.participants.filter((p) => !ids.includes(p));
      return json({ success: true });
    }
    return json({ error: { message: `unhandled ${method} ${path}`, code: 100 } }, 404);
  }
}
