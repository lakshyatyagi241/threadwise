import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { CryptoService } from '../../../src/common/crypto/crypto.service';
import type { FlowPipeline } from './support';

/** What the stub model was asked: the key it was called with, the model, both prompts and whether JSON mode was on. */
export interface ModelCall {
  authorization: string;
  model: string;
  system: string;
  user: string;
  jsonMode: boolean;
  maxTokens: number;
}

/**
 * A local stand-in for an OpenAI-compatible vendor. `answer` decides each reply from the call; a number answers with that HTTP status
 * instead. The adapter reads its base URL from the environment at call time, so a spec points it here after the app is up.
 */
export interface StubModel {
  calls: ModelCall[];
  answer: (call: ModelCall) => string | number;
  stop(): Promise<void>;
}

export async function startStubModel(): Promise<StubModel> {
  const stub: StubModel = {
    calls: [],
    answer: () => 'ok',
    stop: () => new Promise((r) => server.close(() => r())),
  };
  const server: Server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const j = JSON.parse(body || '{}') as {
        model: string;
        max_tokens: number;
        response_format?: unknown;
        messages: Array<{ role: string; content: string }>;
      };
      const call: ModelCall = {
        authorization: String(req.headers.authorization ?? ''),
        model: j.model,
        system: j.messages.find((m) => m.role === 'system')?.content ?? '',
        user: j.messages.find((m) => m.role === 'user')?.content ?? '',
        jsonMode: j.response_format !== undefined,
        maxTokens: j.max_tokens,
      };
      stub.calls.push(call);
      const a = stub.answer(call);
      if (typeof a === 'number') {
        res.writeHead(a, { 'content-type': 'application/json' }).end('{"error":"stub"}');
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' }).end(
        JSON.stringify({
          choices: [{ message: { content: a } }],
          usage: { prompt_tokens: 11, completion_tokens: 7 },
        }),
      );
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  process.env.FLR_AI_OPENAI_BASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return stub;
}

export const PLATFORM_KEY = 'sk-test-flr-platform-key-0123456789';

/** Gives the platform an active OpenAI key (sealed the way the keys screen seals it), or switches it off. */
export async function setPlatformKey(p: FlowPipeline, on: boolean): Promise<void> {
  const sealed = p.h.app.get(CryptoService).encrypt(PLATFORM_KEY);
  await p.h.owner.query(
    `UPDATE admin_ai_keys SET api_key = $1, is_active = $2 WHERE provider = 'openai'`,
    [on ? sealed : null, on],
  );
}
