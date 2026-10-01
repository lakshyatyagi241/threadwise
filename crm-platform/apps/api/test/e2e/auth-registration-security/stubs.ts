import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * Local HTTP servers standing in for the three places the sign-up code can be
 * delivered through: Meta's Graph API, Twilio and the Node bridge. The sender
 * config carries the base URL, so the real adapters talk to these over real
 * sockets. Each records every request (with a global sequence number so the
 * harness can list codes in the order they were sent).
 */

let seq = 0;

export interface Recorded {
  seq: number;
  method: string;
  path: string;
  query: string;
  headers: Record<string, string | string[] | undefined>;
  /** Parsed JSON, or the form fields for Twilio. */
  body: unknown;
}

export interface Reply {
  status: number;
  body?: unknown;
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

export abstract class StubServer {
  url = '';
  requests: Recorded[] = [];
  /** Forces the answer to the next request(s); each entry is used once, in order. */
  queue: Reply[] = [];
  /** Waits this long before answering: for timeout tests. */
  delayMs = 0;
  private server: Server | null = null;

  protected abstract handle(rec: Recorded): Reply;

  async start(): Promise<this> {
    this.server = createServer((req, res) => {
      void this.serve(req).then(async (reply) => {
        if (this.delayMs > 0) await new Promise((r) => setTimeout(r, this.delayMs));
        res.writeHead(reply.status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(reply.body ?? {}));
      });
    });
    await new Promise<void>((r) => this.server!.listen(0, '127.0.0.1', r));
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
    return this;
  }

  private async serve(req: IncomingMessage): Promise<Reply> {
    const raw = await readBody(req);
    const u = new URL(req.url ?? '/', 'http://stub.local');
    const type = req.headers['content-type'] ?? '';
    let body: unknown = raw;
    if (type.includes('application/json')) {
      try {
        body = JSON.parse(raw);
      } catch {
        body = raw;
      }
    } else if (type.includes('x-www-form-urlencoded')) {
      body = Object.fromEntries(new URLSearchParams(raw));
    }
    const rec: Recorded = {
      seq: ++seq,
      method: req.method ?? 'GET',
      path: u.pathname,
      query: u.search,
      headers: req.headers,
      body,
    };
    this.requests.push(rec);
    return this.queue.shift() ?? this.handle(rec);
  }

  reset(): void {
    this.requests.length = 0;
    this.queue.length = 0;
    this.delayMs = 0;
  }

  close(): Promise<void> {
    return new Promise((r) => {
      if (!this.server) return r();
      this.server.closeAllConnections();
      this.server.close(() => r());
    });
  }
}

// --- Meta Graph ---------------------------------------------------------------------------------------

export const GRAPH_TOKEN = 'EAAG-stub-access-token-0001';
export const GRAPH_PHONE_NUMBER_ID = '100200300';
export const GRAPH_WABA_ID = '555666777';

export class GraphStub extends StubServer {
  /** What GET /{template id} reports. */
  templateStatus = 'PENDING';
  templateRejectedReason: string | null = null;
  /** The id a created template gets; '' simulates Meta answering without one. */
  createdTemplateId = 'tpl_90001';

  override reset(): void {
    super.reset();
    this.templateStatus = 'PENDING';
    this.templateRejectedReason = null;
    this.createdTemplateId = 'tpl_90001';
  }

  protected handle(rec: Recorded): Reply {
    if (rec.headers.authorization !== `Bearer ${GRAPH_TOKEN}`) {
      return {
        status: 401,
        body: {
          error: { message: 'Invalid OAuth access token.', type: 'OAuthException', code: 190 },
        },
      };
    }
    const segs = rec.path.split('/').filter(Boolean); // v21.0, <id>, <edge?>
    if (rec.method === 'POST' && segs[2] === 'message_templates') {
      if (segs[1] !== GRAPH_WABA_ID) {
        return {
          status: 400,
          body: { error: { message: 'Unsupported post request.', code: 100 } },
        };
      }
      return {
        status: 200,
        body: {
          ...(this.createdTemplateId ? { id: this.createdTemplateId } : {}),
          status: 'PENDING',
          category: 'AUTHENTICATION',
        },
      };
    }
    if (rec.method === 'POST' && segs[2] === 'messages') {
      if (segs[1] !== GRAPH_PHONE_NUMBER_ID) {
        return {
          status: 400,
          body: { error: { message: 'Phone number id not found.', code: 100 } },
        };
      }
      return {
        status: 200,
        body: { messaging_product: 'whatsapp', messages: [{ id: 'wamid.stub' }] },
      };
    }
    if (rec.method === 'GET' && segs.length === 2) {
      return {
        status: 200,
        body: {
          id: segs[1],
          name: 'crm_signup_otp',
          status: this.templateStatus,
          ...(this.templateRejectedReason ? { rejected_reason: this.templateRejectedReason } : {}),
        },
      };
    }
    if (rec.method === 'POST' && segs.length === 2) return { status: 200, body: { success: true } };
    return { status: 404, body: { error: { message: 'Unknown path.' } } };
  }
}

// --- Twilio ----------------------------------------------------------------------------------------------

export const TWILIO_SID = 'AC' + '1'.repeat(32);
export const TWILIO_TOKEN = 'twilio-stub-auth-token-0002';
export const TWILIO_FROM = '+14155238886';

export class TwilioStub extends StubServer {
  protected handle(rec: Recorded): Reply {
    const expected = `Basic ${Buffer.from(`${TWILIO_SID}:${TWILIO_TOKEN}`).toString('base64')}`;
    if (rec.headers.authorization !== expected) {
      return { status: 401, body: { code: 20003, message: 'Authenticate', status: 401 } };
    }
    if (rec.path !== `/2010-04-01/Accounts/${TWILIO_SID}/Messages.json` || rec.method !== 'POST') {
      return { status: 404, body: { code: 20404, message: 'Not found' } };
    }
    return { status: 201, body: { sid: 'SMstub', status: 'queued' } };
  }
}

// --- Node bridge -----------------------------------------------------------------------------------------

export const BRIDGE_TOKEN = 'bridge-stub-node-token-0003';
export const BRIDGE_SENDER = '919000000001';

export class BridgeStub extends StubServer {
  protected handle(rec: Recorded): Reply {
    if (rec.headers['x-node-token'] !== BRIDGE_TOKEN) {
      return { status: 401, body: { success: false, message: 'Invalid node token' } };
    }
    if (rec.path !== `/api/send-message/${BRIDGE_SENDER}` || rec.method !== 'POST') {
      return { status: 404, body: { success: false, message: 'Unknown sender session' } };
    }
    return { status: 200, body: { success: true } };
  }
}

export interface Stubs {
  graph: GraphStub;
  twilio: TwilioStub;
  bridge: BridgeStub;
}

export async function startStubs(): Promise<Stubs> {
  const [graph, twilio, bridge] = await Promise.all([
    new GraphStub().start(),
    new TwilioStub().start(),
    new BridgeStub().start(),
  ]);
  return { graph, twilio, bridge };
}

// --- reading the codes back ------------------------------------------------------------------------------

export interface SentCode {
  seq: number;
  via: 'graph' | 'twilio' | 'bridge';
  to: string;
  code: string;
}

const firstCode = (text: string): string => text.match(/(?<!\d)\d{4,8}(?!\d)/)?.[0] ?? '';

/** The (to, code) of every delivery a stub recorded, in the order received. */
export function sentCodes(via: SentCode['via'], requests: Recorded[]): SentCode[] {
  const out: SentCode[] = [];
  for (const r of requests) {
    if (r.method !== 'POST') continue;
    if (via === 'graph' && r.path.endsWith('/messages')) {
      const b = r.body as {
        to: string;
        template: { components: Array<{ parameters: Array<{ text: string }> }> };
      };
      out.push({ seq: r.seq, via, to: b.to, code: b.template.components[0]!.parameters[0]!.text });
    } else if (via === 'twilio' && r.path.endsWith('/Messages.json')) {
      const b = r.body as { To: string; Body: string };
      out.push({ seq: r.seq, via, to: b.To.replace(/^whatsapp:/, ''), code: firstCode(b.Body) });
    } else if (via === 'bridge' && r.path.startsWith('/api/send-message/')) {
      const b = r.body as { targetPhoneNumber: string; message: string };
      out.push({ seq: r.seq, via, to: b.targetPhoneNumber, code: firstCode(b.message) });
    }
  }
  return out;
}
