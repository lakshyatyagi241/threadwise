import { describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@crm/contracts';
import { AppError } from '../../../src/common/errors/app-error';
import type {
  AiChatPort,
  AiChatReply,
  AiChatRequest,
} from '../../../src/infra/providers/chatbot-widget/ai-chat.port';
import type { AssistantProfile } from '../../../src/modules/chatbot-widget/_shims/tokens';
import { ERROR_FALLBACK } from '../../../src/modules/chatbot-widget/ai-prompt';
import { WidgetAiReplyService } from '../../../src/modules/chatbot-widget/widget-ai-reply.service';
import { AiChargeService } from '../../../src/modules/wallet-message-billing/ai-charge.service';

const assistant = (over: Partial<AssistantProfile> = {}): AssistantProfile => ({
  id: 1,
  uuid: 'u',
  name: 'Bot',
  systemPrompt: null,
  tone: null,
  language: null,
  aiProvider: 'openai',
  aiModel: 'gpt-4o-mini',
  replyMaxTokens: null,
  temperature: null,
  fallbackMessage: null,
  handoffEnabled: false,
  handoffKeyword: null,
  handoffMessage: null,
  ...over,
});

interface Setup {
  walletEmpty?: boolean;
  /** What the port returns; an Error is thrown. */
  answer?: AiChatReply | null | Error;
}

/** The real AiChargeService over a fake billing service, so what is asked and charged is the real rule. */
function build(s: Setup = {}) {
  const sent: AiChatRequest[] = [];
  const settled: Array<Record<string, unknown>> = [];
  const asked: string[] = [];
  const port: AiChatPort = {
    complete: async (req) => {
      sent.push(req);
      const a =
        s.answer === undefined
          ? { text: 'Hello there', promptTokens: 120, completionTokens: 30 }
          : s.answer;
      if (a instanceof Error) throw a;
      return a;
    },
  };
  const usage = {
    assertCanAfford: async (_org: number, kind: string) => {
      asked.push(kind);
      if (s.walletEmpty) throw new AppError(ERROR_CODES.WALLET_EMPTY, 'empty', 422);
    },
    settle: async (input: Record<string, unknown>) => {
      settled.push(input);
      return { status: 'charged', chargedMinor: 1, shortfallMinor: 0, balanceAfterMinor: 9 };
    },
  };
  const language = { replyLanguage: async () => null };
  const svc = new WidgetAiReplyService(
    port,
    language as never,
    new AiChargeService(usage as never),
  );
  return { svc, sent, settled, asked };
}

const input = (over: Partial<Parameters<WidgetAiReplyService['reply']>[0]> = {}) => ({
  orgId: 4,
  assistant: assistant(),
  knowledge: [],
  history: [],
  visitorMessage: 'Do you ship to Pune?',
  messageId: 321,
  ...over,
});

describe('WidgetAiReplyService and the wallet', () => {
  it('asks the wallet before the vendor and charges the answered call to the widget workspace', async () => {
    const { svc, sent, settled, asked } = build();
    expect(await svc.reply(input())).toBe('Hello there');
    expect(asked).toEqual(['ai']);
    expect(sent).toHaveLength(1);
    expect(settled).toHaveLength(1);
    expect(settled[0]).toMatchObject({
      orgId: 4,
      kind: 'ai',
      usageId: 'widget_ai:321',
      label: 'AI website chatbot',
      source: 'widget_ai',
      provider: 'openai',
    });
    // 120 prompt and 30 completion tokens on gpt-4o-mini: priced from the model, never zero.
    expect(settled[0]!.vendorCostUsd).toBeGreaterThan(0);
  });

  it("answers an empty wallet with the widget's own fallback message, without calling the vendor", async () => {
    const { svc, sent, settled } = build({ walletEmpty: true });
    const out = await svc.reply(
      input({ assistant: assistant({ fallbackMessage: 'We will get back to you.' }) }),
    );
    expect(out).toBe('We will get back to you.');
    expect(sent).toHaveLength(0);
    expect(settled).toHaveLength(0);
  });

  it('uses the built-in line when the assistant has no fallback message', async () => {
    const { svc } = build({ walletEmpty: true });
    expect(await svc.reply(input())).toBe(ERROR_FALLBACK);
  });

  it('charges one id per visitor message, so a repeat of the same message is not charged twice', async () => {
    const { svc, settled } = build();
    await svc.reply(input({ messageId: 7 }));
    await svc.reply(input({ messageId: 7 }));
    await svc.reply(input({ messageId: 8 }));
    expect(settled.map((c) => c.usageId)).toEqual(['widget_ai:7', 'widget_ai:7', 'widget_ai:8']);
  });

  it('estimates the tokens from the text, 4 characters each, when the vendor reports none', async () => {
    const reported = build({
      answer: { text: 'x'.repeat(400), promptTokens: 1000, completionTokens: 100 },
    });
    await reported.svc.reply(input());
    const estimated = build({
      answer: { text: 'x'.repeat(400), promptTokens: null, completionTokens: null },
    });
    await estimated.svc.reply(input());
    // Both are priced; the estimate (system prompt + question + 100 reply tokens) is far below the 1000 reported prompt tokens.
    expect(estimated.settled[0]!.vendorCostUsd).toBeGreaterThan(0);
    expect(estimated.settled[0]!.vendorCostUsd as number).toBeLessThan(
      reported.settled[0]!.vendorCostUsd as number,
    );
  });

  it('treats a reported zero as nothing reported and prices the text instead of giving the call away', async () => {
    const { svc, settled } = build({
      answer: { text: 'x'.repeat(400), promptTokens: 0, completionTokens: 0 },
    });
    await svc.reply(input());
    expect(settled).toHaveLength(1);
    expect(settled[0]!.vendorCostUsd).toBeGreaterThan(0);
  });

  it('charges an empty completion (the vendor billed the prompt) but still answers with the fallback', async () => {
    const { svc, settled } = build({
      answer: { text: '  ', promptTokens: 50, completionTokens: 0 },
    });
    const out = await svc.reply(input({ assistant: assistant({ fallbackMessage: 'Soon.' }) }));
    expect(out).toBe('Soon.');
    expect(settled).toHaveLength(1);
  });

  it('does not charge when no call was made (no key for the provider) or the vendor failed', async () => {
    const none = build({ answer: null });
    await none.svc.reply(input());
    expect(none.settled).toHaveLength(0);
    const down = build({ answer: new Error('AI provider answered 500') });
    expect(await down.svc.reply(input())).toBe(ERROR_FALLBACK);
    expect(down.settled).toHaveLength(0);
  });
});
