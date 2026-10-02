import { describe, expect, it, vi } from 'vitest';
import {
  BRANDING_FOOTER_MAX,
  brandingFooterTextSchema,
  footerLength,
  updateBrandingRequestSchema,
} from '@crm/contracts';
import { MetaCloudProvider } from '../../../src/infra/providers/whatsapp/meta-cloud.provider';
import type { OutboundSendGuard } from '../../../src/infra/providers/whatsapp/send-guard.port';
import { SendGuard } from '../../../src/modules/auth/security/send-guard.module';
import {
  BrandingFooterService,
  FooterKeys,
  bustFooterCache,
  capFooter,
  pickFooter,
  platformFooterFrom,
} from '../../../src/modules/auth/security/branding-footer.service';

describe('footer length counts characters, not UTF-16 units (WD-AUTH-029)', () => {
  it('accepts 60 emoji and refuses 61', () => {
    expect(footerLength('😀'.repeat(60))).toBe(60);
    expect('😀'.repeat(60).length).toBe(120);
    expect(brandingFooterTextSchema.safeParse('😀'.repeat(BRANDING_FOOTER_MAX)).success).toBe(true);
    expect(brandingFooterTextSchema.safeParse('😀'.repeat(BRANDING_FOOTER_MAX + 1)).success).toBe(
      false,
    );
    expect(updateBrandingRequestSchema.safeParse({ messageFooter: 'é'.repeat(61) }).success).toBe(
      false,
    );
  });

  it('trims, allows blank and null, and measures after trimming', () => {
    expect(
      updateBrandingRequestSchema.parse({ messageFooter: `  ${'a'.repeat(60)}  ` }).messageFooter,
    ).toBe('a'.repeat(60));
    expect(updateBrandingRequestSchema.parse({ messageFooter: '   ' }).messageFooter).toBe('');
    expect(updateBrandingRequestSchema.parse({ messageFooter: null }).messageFooter).toBeNull();
  });

  it('cuts a longer stored value at the limit without splitting a character', () => {
    expect(capFooter(`${'😀'.repeat(70)}`)).toBe('😀'.repeat(60));
    expect(capFooter('  hi  ')).toBe('hi');
  });
});

describe('which footer a workspace sends', () => {
  const platform = 'Sent via Acme';

  it('gives a plan that cannot remove branding the platform footer, whatever it saved', () => {
    expect(pickFooter({ removesBranding: false, own: 'Mine', platform })).toBe(platform);
    expect(pickFooter({ removesBranding: false, own: '', platform })).toBe(platform);
    expect(pickFooter({ removesBranding: false, own: null, platform: null })).toBeNull();
  });

  it('gives a plan that removes branding its own text, and NO footer when it has none (never the platform default)', () => {
    expect(pickFooter({ removesBranding: true, own: '  Our shop  ', platform })).toBe('Our shop');
    expect(pickFooter({ removesBranding: true, own: null, platform })).toBeNull();
    expect(pickFooter({ removesBranding: true, own: undefined, platform })).toBeNull();
    expect(pickFooter({ removesBranding: true, own: '', platform })).toBeNull();
    expect(pickFooter({ removesBranding: true, own: '   ', platform })).toBeNull();
  });

  it('reads the platform footer: never saved is "Sent via <app>", saved blank is none', () => {
    expect(platformFooterFrom(undefined, 'Acme')).toBe('Sent via Acme');
    expect(platformFooterFrom(null, 'Acme')).toBe('Sent via Acme');
    expect(platformFooterFrom('', 'Acme')).toBeNull();
    expect(platformFooterFrom('  ', 'Acme')).toBeNull();
    expect(platformFooterFrom('Powered by us', 'Acme')).toBe('Powered by us');
  });
});

/** The service with every collaborator replaced by a counter-keeping fake. */
function makeService(state: {
  removes?: boolean;
  own?: string | null;
  saved?: string | undefined;
  versions?: Record<string, string>;
  failEntitlements?: boolean;
}) {
  const reads = { entitlements: 0, org: 0 };
  const db = {
    txAs: async (_t: unknown, fn: (tx: unknown) => Promise<unknown>) => {
      reads.org++;
      return fn({ execute: async () => ({ rows: [{ footer: state.own ?? null }] }) });
    },
  };
  const entitlements = {
    featureEnabled: async () => {
      reads.entitlements++;
      if (state.failEntitlements) throw new Error('db down');
      return state.removes ?? false;
    },
  };
  const settings = { get: async () => state.saved };
  const versions = state.versions ?? {};
  const redis = {
    mget: async (...keys: string[]) => keys.map((k) => versions[k] ?? null),
    incr: async (k: string) => {
      versions[k] = String(Number(versions[k] ?? 0) + 1);
      return Number(versions[k]);
    },
  };
  const service = new BrandingFooterService(
    db as never,
    settings as never,
    entitlements as never,
    redis as never,
    { get: () => 'Acme' } as never,
  );
  return { service, reads, versions, redis, state };
}

describe('BrandingFooterService', () => {
  it('appends the footer as an italic last paragraph, and not twice', async () => {
    const { service } = makeService({ saved: 'Sent via Acme' });
    const once = await service.appendToBody(7, 'Hello');
    expect(once).toBe('Hello\n\n_Sent via Acme_');
    expect(await service.appendToBody(7, once)).toBe(once);
  });

  it('leaves the body alone when the workspace has no footer', async () => {
    const { service } = makeService({ removes: true, own: null });
    expect(await service.appendToBody(7, 'Hello')).toBe('Hello');
  });

  it('serves repeated sends from its cache, and a version bump (a save anywhere) drops it at once', async () => {
    const { service, reads, redis, state } = makeService({ removes: true, own: 'First' });
    expect(await service.resolve(5)).toBe('First');
    expect(await service.resolve(5)).toBe('First');
    expect(reads.org).toBe(1);

    state.own = 'Second';
    expect(await service.resolve(5)).toBe('First'); // nothing told it yet
    await bustFooterCache(redis as never, 5);
    expect(await service.resolve(5)).toBe('Second');
    expect(reads.org).toBe(2);
  });

  it('drops every workspace when the platform default changes, but only that workspace for its own change', async () => {
    const { service, reads, redis } = makeService({ saved: 'Platform one' });
    await service.resolve(1);
    await service.resolve(2);
    expect(reads.entitlements).toBe(2);
    await bustFooterCache(redis as never, 1);
    await service.resolve(1);
    await service.resolve(2);
    expect(reads.entitlements).toBe(3);
    await bustFooterCache(redis as never);
    await service.resolve(1);
    await service.resolve(2);
    expect(reads.entitlements).toBe(5);
  });

  it('reacts to the outbox events by bumping the matching version (idempotent)', async () => {
    const { service, versions } = makeService({});
    await service.onOutboxEvent('org.branding_footer.changed', 9);
    expect(versions[FooterKeys.org(9)]).toBe('1');
    await service.onOutboxEvent('platform.branding_footer.changed', null);
    expect(versions[FooterKeys.platform]).toBe('1');
    await service.onOutboxEvent('contact.created', 9);
    expect(Object.keys(versions).sort()).toEqual([FooterKeys.org(9), FooterKeys.platform].sort());
  });

  it('sends without a footer rather than failing or guessing when the lookup breaks', async () => {
    const { service } = makeService({ failEntitlements: true });
    expect(await service.resolve(3)).toBeNull();
    expect(await service.appendToBody(3, 'Hello')).toBe('Hello');
  });

  it('uses the platform default for a send with no workspace', async () => {
    const { service } = makeService({ saved: 'Platform line' });
    expect(await service.appendToBody(0, 'Hello')).toBe('Hello\n\n_Platform line_');
  });
});

describe('the footer at the WhatsApp provider boundary', () => {
  function build() {
    const calls: string[] = [];
    const guard: OutboundSendGuard = {
      beforeSend: async (i) => void calls.push(`screen:${i.body}`),
      withFooter: async (i) => {
        calls.push('footer');
        return `${i.body}\n\n_FOOT_`;
      },
    };
    class Probe extends MetaCloudProvider {
      sent: Array<Record<string, unknown>> = [];
      protected override async post(_c: never, payload: Record<string, unknown>) {
        this.sent.push(payload);
        return { providerMessageId: 'wamid.1', acceptedAt: new Date() };
      }
    }
    const provider = new Probe({ get: () => 'v21.0' } as never, guard);
    return { provider, calls };
  }
  const creds = { senderId: '1', accessToken: 't' };

  it("screens the sender's own words first, then puts the footer on plain text", async () => {
    const { provider, calls } = build();
    await provider.sendText(creds, { to: '+1', body: 'Hello', clientReference: 'r' });
    expect(calls).toEqual(['screen:Hello', 'footer']);
    expect(provider.sent[0]).toMatchObject({ type: 'text', text: { body: 'Hello\n\n_FOOT_' } });
  });

  it('never touches an approved template', async () => {
    const { provider, calls } = build();
    await provider.sendTemplate(creds, {
      to: '+1',
      templateName: 'order_update',
      language: 'en',
      variables: { '1': 'A' },
      clientReference: 'r',
    });
    // The template leaves through the provider's one `post`, which this probe captures.
    expect(calls).toEqual(['screen:A']);
    expect(provider.sent).toHaveLength(1);
    expect(provider.sent[0]).toMatchObject({ type: 'template' });
    expect(JSON.stringify(provider.sent[0])).not.toContain('FOOT');
  });

  it('still refuses when the guard refuses: no footer work, nothing sent', async () => {
    const guard: OutboundSendGuard = {
      beforeSend: vi.fn().mockRejectedValue(new Error('halted')),
      withFooter: vi.fn(),
    };
    class Probe extends MetaCloudProvider {
      posted = 0;
      protected override async post() {
        this.posted++;
        return { providerMessageId: 'x', acceptedAt: new Date() };
      }
    }
    const provider = new Probe({ get: () => 'v21.0' } as never, guard);
    await expect(
      provider.sendText(creds, { to: '+1', body: 'x', clientReference: 'r' }),
    ).rejects.toThrow('halted');
    expect(guard.withFooter).not.toHaveBeenCalled();
    expect(provider.posted).toBe(0);
  });

  it('the guard resolves the workspace from the request when the caller does not name one', async () => {
    const footers = { appendToBody: vi.fn(async (_o: number, b: string) => `${b}!`) };
    const guard = new SendGuard({} as never, {} as never, footers as never);
    expect(await guard.withFooter({ orgId: 4, body: 'a' })).toBe('a!');
    expect(footers.appendToBody).toHaveBeenCalledWith(4, 'a');
    await guard.withFooter({ body: 'b' }); // no request context in a unit test: platform footer
    expect(footers.appendToBody).toHaveBeenLastCalledWith(0, 'b');
  });
});
