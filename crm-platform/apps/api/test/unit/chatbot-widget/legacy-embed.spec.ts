import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/modules/chat-conversations', () => ({}));

import { WidgetPublicService } from '../../../src/modules/chatbot-widget/widget-public.service';

const make = (rows: unknown[]) => {
  const svc = Object.create(WidgetPublicService.prototype) as any;
  svc.db = { primary: { execute: vi.fn(async () => ({ rows })) } };
  svc.embedScript = vi.fn(async (token: string) => `script:${token}`);
  return svc as WidgetPublicService & { db: any; embedScript: any };
};

describe('legacyEmbedScript: an old embed id resolves to the widget own loader', () => {
  it('answers with the normal loader for the token the lookup returns', async () => {
    const svc = make([{ widget_token: 'tok123' }]);
    expect(await svc.legacyEmbedScript('64f0a1b2c3d4e5f607182930', 'https://x.test')).toBe(
      'script:tok123',
    );
    expect(svc.embedScript).toHaveBeenCalledWith('tok123', 'https://x.test');
  });

  it('answers null for an unknown id, without calling the loader', async () => {
    const svc = make([]);
    expect(await svc.legacyEmbedScript('unknown', 'https://x.test')).toBeNull();
    expect(svc.embedScript).not.toHaveBeenCalled();
  });

  it('never queries for an id of the wrong shape', async () => {
    const svc = make([{ widget_token: 'tok' }]);
    for (const bad of ['', "a'b", 'x'.repeat(65), '../etc', 'a b'])
      expect(await svc.legacyEmbedScript(bad, 'https://x.test')).toBeNull();
    expect(svc.db.primary.execute).not.toHaveBeenCalled();
  });
});
