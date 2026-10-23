import { describe, expect, it } from 'vitest';
import { ERROR_CODES, type FlbAiGenerateRequest } from '@crm/contracts';
import { RequestContextStore } from '../../../src/common/context/request-context';
import { AppError } from '../../../src/common/errors/app-error';
import type {
  FlowAiPort,
  FlowAiRequest,
} from '../../../src/infra/providers/flow-builder-editor/flow-ai.port';
import { FlowAiService } from '../../../src/modules/flow-builder-editor/flow-ai.service';
import { CHAT_SYSTEM_PROMPT } from '../../../src/modules/flow-builder-editor/flow-ai-prompts';

interface Setup {
  /** Which key exists: the workspace's own, the platform's, or both (the workspace's wins). */
  own?: boolean;
  platform?: boolean;
  walletEmpty?: boolean;
  /** What the vendor answers; an Error is thrown. */
  answer?: string | null | Error;
}

const FLOW = JSON.stringify({ flowNodes: [{ id: 'a', type: 'trigger' }], flowEdges: [] });

function build(s: Setup = {}) {
  const sent: FlowAiRequest[] = [];
  const charged: Array<Record<string, unknown>> = [];
  const guarded: string[] = [];
  const tx = {
    execute: async (q: { queryChunks?: unknown[] }) => {
      const text = JSON.stringify(q.queryChunks ?? []);
      if (text.includes('ai_provider_keys')) return { rows: s.own ? [{ api_key: 'sk-mine' }] : [] };
      if (text.includes('admin_ai_keys'))
        return { rows: s.platform === false ? [] : [{ api_key: 'sk-platform' }] };
      return { rows: [] };
    },
  };
  const db = {
    tx: async (fn: (t: typeof tx) => unknown) => fn(tx),
    privileged: async (fn: (t: typeof tx) => unknown) => fn(tx),
  };
  const port: FlowAiPort = {
    generate: async (req) => {
      sent.push(req);
      const a = s.answer === undefined ? FLOW : s.answer;
      if (a instanceof Error) throw a;
      return a;
    },
  };
  const charge = {
    guardCall: async (_org: number, source: string) => {
      guarded.push(source);
      if (s.walletEmpty && source === 'admin') {
        throw new AppError(ERROR_CODES.WALLET_EMPTY, 'empty', 422);
      }
    },
    chargeCall: async (call: Record<string, unknown>) => {
      charged.push(call);
      return 0;
    },
  };
  const svc = new FlowAiService(
    db as never,
    { decrypt: (v: string) => v } as never,
    port,
    charge as never,
  );
  const run = <T>(fn: () => Promise<T>) =>
    RequestContextStore.run(
      { requestId: 'req-9', orgId: 3, actorType: 'user', actorId: 1, userId: 1 },
      fn,
    );
  return { svc, sent, charged, guarded, run };
}

const input = (): FlbAiGenerateRequest =>
  ({
    prompt: 'Greet the customer and ask for their name',
    model: 'gpt-4o-mini',
    provider: 'openai',
    flowType: 'chat',
  }) as FlbAiGenerateRequest;

describe('FlowAiService ("Generate with AI") and the wallet', () => {
  it("charges the platform's key to the workspace, with the tokens estimated from the text", async () => {
    const { svc, charged, guarded, run } = build();
    await run(() => svc.generate(input()));
    expect(guarded).toEqual(['admin']);
    expect(charged).toEqual([
      {
        orgId: 3,
        keySource: 'admin',
        label: 'AI flow generator',
        source: 'flow_ai',
        usageId: expect.stringMatching(/^flow_ai:[0-9a-f-]{36}$/),
        provider: 'openai',
        model: 'gpt-4o-mini',
        promptTokens: Math.ceil((CHAT_SYSTEM_PROMPT.length + input().prompt.length) / 4),
        completionTokens: Math.ceil(FLOW.length / 4),
      },
    ]);
  });

  it('names every call with a fresh id: the request id is whatever x-request-id the caller sent, so it must not name a charge', async () => {
    const { svc, charged, run } = build();
    await run(() => svc.generate(input()));
    await run(() => svc.generate(input()));
    expect(charged).toHaveLength(2);
    const ids = charged.map((c) => String(c.usageId));
    expect(new Set(ids).size).toBe(2);
    expect(ids.every((id) => !id.includes('req-9'))).toBe(true);
  });

  it('refuses an empty wallet with WALLET_EMPTY before the vendor is called', async () => {
    const { svc, sent, charged, run } = build({ walletEmpty: true });
    await expect(run(() => svc.generate(input()))).rejects.toMatchObject({
      code: ERROR_CODES.WALLET_EMPTY,
    });
    expect(sent).toHaveLength(0);
    expect(charged).toHaveLength(0);
  });

  it("keeps picking the workspace's own key first, and tells the charge it was not the platform's", async () => {
    const { svc, sent, charged, run } = build({ own: true, walletEmpty: true });
    await run(() => svc.generate(input()));
    expect(sent[0]!.apiKey).toBe('sk-mine');
    expect(charged[0]).toMatchObject({ keySource: 'workspace' });
  });

  it('still answers NO_KEY when neither side has a key, without asking the wallet', async () => {
    const { svc, guarded, run } = build({ platform: false });
    await expect(run(() => svc.generate(input()))).rejects.toMatchObject({
      code: ERROR_CODES.FLB_AI_NO_KEY,
    });
    expect(guarded).toHaveLength(0);
  });

  it('does not charge a vendor that failed or answered nothing', async () => {
    const down = build({ answer: new Error('provider answered HTTP 500') });
    await expect(down.run(() => down.svc.generate(input()))).rejects.toMatchObject({
      code: ERROR_CODES.FLB_AI_PROVIDER_FAILED,
    });
    expect(down.charged).toHaveLength(0);
    const empty = build({ answer: null });
    await expect(empty.run(() => empty.svc.generate(input()))).rejects.toMatchObject({
      code: ERROR_CODES.FLB_AI_PROVIDER_FAILED,
    });
    expect(empty.charged).toHaveLength(0);
  });

  it('charges an answer that is not a flow (the vendor was paid for it), then reports it as bad JSON', async () => {
    const { svc, charged, run } = build({ answer: 'I cannot do that' });
    await expect(run(() => svc.generate(input()))).rejects.toMatchObject({
      code: ERROR_CODES.FLB_AI_BAD_JSON,
    });
    expect(charged).toHaveLength(1);
  });
});
