import { createTranslator } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import { ERROR_CODES, MARKET_MATURITIES } from '@crm/contracts';
import { ApiError } from '@/lib/api/errors';
import { loadMessages } from '@/i18n/messages';
import { mktKeys } from '../api';
import {
  SENDER_FORMATS,
  accountManagerMessage,
  intervalParts,
  maturityView,
  syncNote,
  type MessageText,
} from '../lib/portals';
import { dismiss, setSaved, startReveal, type RevealPayload } from '../lib/secret-reveal';
import { INSTALL, MANAGE, READ, onePage, renderMarket } from '../render-test-utils';
import { HOOK_URL, ID, SECRET, URL_KEY, detail, installation } from '../test-fixtures';
import {
  BETA_NOTICE,
  PATH_FULL,
  PATH_SECRET,
  PATH_TAIL,
  SETUP_NOTICE,
  pathInstallation,
  portalCard,
  portalDetail,
  pullInstallation,
} from '../portal-fixtures';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => undefined, replace: () => undefined }),
  useSearchParams: () => new URLSearchParams(''),
  usePathname: () => `/marketplace/installed/${ID(50)}`,
}));

import { AppCard } from './app-card';
import { AppDetail } from './app-detail-page';
import { InstallFlow } from './install-page';
import { ManagePage } from './manage-page';
import { ProblemNotice } from './manage-parts';
import { SyncFeedback } from './portal-connection';
import { SecretReveal } from './secret-reveal';

/**
 * Static renders with the real English and Arabic messages: the lead-portal listings (maturity badge and notice), the private address
 * shown once after install and rotate, and the connection panel of a portal we poll or one that sends to us. There is no browser here,
 * so the clicks (Sync now, Copy) are covered by the pure helpers and the API test, and these renders prove what is drawn and said.
 */
const LOCALES = ['en', 'ar'] as const;
const WID = ID(50);
const noop = () => undefined;

/** React writes an apostrophe as `&#x27;`: tests look for the words a person reads. */
const words = (html: string) => html.replace(/&#x27;/g, "'").replace(/&quot;/g, '"');

const event = (n: number) => ({
  id: ID(200 + n),
  externalId: `lead-${n}`,
  status: 'accepted' as const,
  error: null,
  receivedAt: '2026-10-02T09:00:00.000Z',
});

const seedFor = (inst = pathInstallation()) =>
  [
    [mktKeys.installation(WID), inst],
    [mktKeys.app(inst.app.slug), portalDetail()],
    [[...mktKeys.events(WID), { limit: 25 }], onePage([event(1)])],
  ] as const;

const manage = (inst = pathInstallation(), permissions?: readonly string[], locale?: 'en' | 'ar') =>
  words(renderMarket(<ManagePage id={WID} />, { seed: seedFor(inst), permissions, locale }));

// --- the words the code picks by name -----------------------------------------------------------------------------------------------

describe('portal messages', () => {
  const at = (tree: unknown, path: string): unknown =>
    path.split('.').reduce<unknown>((node, key) => (node as Record<string, unknown>)?.[key], tree);

  it('has, in English and Arabic, every message the code chooses by the value it is drawing', () => {
    const keys = [
      ...MARKET_MATURITIES.flatMap((m) => {
        const badge = maturityView({ maturity: m }).badge;
        return badge ? [`maturity.${badge}`, `maturity.${badge}Hint`] : [];
      }),
      ...SENDER_FORMATS.map((f) => `formats.${f}`),
      ...(['seconds', 'minutes', 'hours'] as const).map((u) => `sync.duration.${u}`),
      ...[1, 60, 3600].map((s) => `sync.duration.${intervalParts(s).unit}`),
    ];
    expect(keys.length).toBeGreaterThanOrEqual(10);
    for (const locale of LOCALES) {
      const portals = at(loadMessages(locale), 'marketplace.portals');
      for (const key of keys) expect(at(portals, key), `${locale} ${key}`).toBeTypeOf('string');
    }
  });

  it('explains a listing that needs the portal in general words, in both languages, when no notice was written', () => {
    for (const locale of LOCALES) {
      const html = words(
        renderMarket(
          <AppDetail
            app={portalDetail({
              notice: null,
              listing: { ...portalDetail().listing, notice: null },
            })}
          />,
          { locale },
        ),
      );
      expect(html).toContain(
        locale === 'en'
          ? "Nothing arrives until the portal's own team switches it on for you."
          : 'لا يصل شيء حتى يفعّله فريق البوابة نفسه لك.',
      );
    }
  });
});

// --- maturity ---------------------------------------------------------------------------------------------------------------------

describe('maturity badge and notice', () => {
  for (const locale of LOCALES) {
    it(`draws the badge and the notice on a card, the app page and the install page in ${locale}`, () => {
      const app = portalDetail();
      for (const html of [
        renderMarket(<AppCard card={portalCard()} />, { locale }),
        renderMarket(<AppDetail app={app} />, { locale }),
        renderMarket(<InstallFlow app={app} />, { locale }),
      ]) {
        expect(html).toContain('data-testid="maturity-badge"');
      }
      expect(renderMarket(<AppDetail app={app} />, { locale })).toContain(
        'data-testid="maturity-notice"',
      );
      expect(renderMarket(<InstallFlow app={app} />, { locale })).toContain(
        'data-testid="maturity-notice"',
      );
    });
  }

  it('says "Needs portal setup" and puts the notice on the card as one line with the whole text as a tooltip', () => {
    const html = renderMarket(<AppCard card={portalCard()} />);
    expect(html).toContain('Needs portal setup');
    expect(html).toContain('line-clamp-1');
    expect(html).toContain(`title="${SETUP_NOTICE}"`);
    expect(html).toContain(SETUP_NOTICE);
  });

  it('says "Beta" as a warning on a beta listing and shows its notice on the app page above the details', () => {
    const app = portalDetail({ maturity: 'beta', notice: BETA_NOTICE });
    const html = renderMarket(<AppDetail app={app} />);
    expect(html).toContain('>Beta<');
    expect(html).not.toContain('Needs portal setup');
    expect(html).toMatch(
      /role="alert"[^>]*data-testid="maturity-notice"[^>]*>Built from the portal/,
    );
    expect(html.indexOf('maturity-notice')).toBeLessThan(html.indexOf('data-testid="scope-'));
  });

  it('shows the notice of a needs-portal-setup listing as plain information', () => {
    const html = renderMarket(<AppDetail app={portalDetail()} />);
    expect(html).toMatch(
      /role="status"[^>]*data-testid="maturity-notice"[^>]*>The portal team switches/,
    );
    expect(html).toContain(SETUP_NOTICE);
  });

  it('shows the notice, with its badge, on the install page before the permissions and the form', () => {
    const html = renderMarket(
      <InstallFlow app={portalDetail({ maturity: 'beta', notice: BETA_NOTICE })} />,
    );
    expect(html).toContain('>Beta<');
    expect(html).toContain(BETA_NOTICE);
    expect(html.indexOf('maturity-notice')).toBeLessThan(html.indexOf('id="mkt-consent"'));
  });

  it('shows the notice of the listing when the app itself carries none', () => {
    const app = portalDetail({
      notice: undefined,
      maturity: undefined,
      listing: { ...portalDetail().listing, maturity: 'beta', notice: BETA_NOTICE },
    });
    const html = renderMarket(<AppDetail app={app} />);
    expect(html).toContain('>Beta<');
    expect(html).toContain(BETA_NOTICE);
  });

  it('explains the badge in general words when the operator wrote no notice', () => {
    const html = words(
      renderMarket(
        <AppDetail
          app={portalDetail({
            maturity: 'beta',
            notice: null,
            listing: { ...portalDetail().listing, notice: null },
          })}
        />,
      ),
    );
    expect(html).toContain("Built from the portal's partial documentation");
  });

  it('draws nothing on a stable listing, and nothing on a listing with no maturity at all', () => {
    for (const html of [
      renderMarket(<AppCard card={portalCard({ maturity: 'stable', notice: null })} />),
      renderMarket(<AppCard card={portalCard({ maturity: undefined, notice: undefined })} />),
      renderMarket(<AppDetail app={detail()} />),
      renderMarket(<InstallFlow app={detail()} />),
    ]) {
      expect(html).not.toContain('maturity-badge');
      expect(html).not.toContain('maturity-notice');
    }
  });

  it('shows a stable listing the notice the operator wrote, without a badge', () => {
    const html = renderMarket(
      <AppDetail
        app={portalDetail({ maturity: 'stable', notice: 'Leads arrive within a minute.' })}
      />,
    );
    expect(html).not.toContain('maturity-badge');
    expect(html).toContain('Leads arrive within a minute.');
  });
});

// --- the private address, shown once ------------------------------------------------------------------------------------------------

describe('private address after install or rotate (secret in the path)', () => {
  const payload: RevealPayload = {
    secret: PATH_SECRET,
    url: HOOK_URL,
    tokenHeader: 'X-Marketplace-Token',
    signatureHeader: 'X-Marketplace-Signature',
    auth: 'path',
    methods: ['GET', 'POST'],
    formats: ['query', 'form', 'json'],
    portalName: 'JustDial',
  };
  const reveal = (p: RevealPayload = payload, locale?: 'en' | 'ar') =>
    words(
      renderMarket(<SecretReveal state={startReveal(p)} onState={noop} doneLabel="Continue" />, {
        locale,
      }),
    );

  it('shows the full address once, with its copy button, and says it is also the connection password', () => {
    const html = reveal();
    expect(html).toContain('data-testid="path-reveal"');
    expect(html).toContain(`value="${PATH_FULL}"`);
    expect(html).toContain('aria-label="Copy the private address"');
    expect(html).toContain('You will not see this address again.');
    expect(html).toContain("It is also the connection's password");
    expect(html.split(PATH_SECRET).length - 1).toBe(1);
  });

  it('is one thing to save: no separate secret row and no header instructions', () => {
    const html = reveal();
    expect(html).not.toContain('Copy the secret');
    expect(html).not.toContain('X-Marketplace-Token');
    expect(html).not.toContain('X-Marketplace-Signature');
    expect(html).not.toContain('HMAC');
    expect(html).toContain('I have saved the address.');
  });

  it('shows exactly how the sender calls it: the methods and the accepted formats', () => {
    const html = reveal();
    expect(html).toContain('Method: GET or POST');
    expect(html).toContain('Accepted formats: query-string parameters, form fields, and JSON');
    expect(reveal({ ...payload, methods: ['GET'], formats: ['query'] })).toContain('Method: GET<');
  });

  it('offers a message for the portal account manager, named after the portal of the installation', () => {
    const html = reveal();
    expect(html).toContain('data-testid="account-manager"');
    expect(html).toContain("Copy a message for your portal's account manager");
    expect(html).toContain("JustDial's own team switches this on, not you.");
    expect(reveal({ ...payload, portalName: undefined })).toContain(
      "the portal's own team switches this on",
    );
  });

  it('is complete in Arabic', () => {
    const html = reveal(payload, 'ar');
    expect(html).toContain('data-testid="path-reveal"');
    expect(html).toContain(`value="${PATH_FULL}"`);
    expect(html).toContain('نسخ رسالة لمدير حسابك في البوابة');
    expect(html).toContain('الطريقة: GET أو POST');
  });

  it('is gone with the address, the secret and its key once the person confirmed', () => {
    const gone = dismiss(setSaved(startReveal(payload), true));
    const html = renderMarket(<SecretReveal state={gone} onState={noop} doneLabel="Continue" />);
    expect(html).not.toContain(PATH_SECRET);
    expect(html).not.toContain(URL_KEY);
    expect(html).not.toContain('path-reveal');
  });

  it('keeps the reveal of a header-secret connection as it was', () => {
    const html = words(
      renderMarket(
        <SecretReveal
          state={startReveal({
            secret: SECRET,
            url: HOOK_URL,
            tokenHeader: 'X-Marketplace-Token',
            signatureHeader: 'X-Marketplace-Signature',
            auth: 'either',
            methods: ['POST'],
            formats: ['json'],
            portalName: 'Webhook',
          })}
          onState={noop}
          doneLabel="Continue"
        />,
      ),
    );
    expect(html).toContain(SECRET);
    expect(html).toContain('Copy the secret');
    expect(html).toContain('X-Marketplace-Token');
    expect(html).toContain('You will not see this secret again.');
    expect(html).not.toContain('path-reveal');
    expect(html).not.toContain('account-manager');
  });

  describe('the message to the account manager', () => {
    const textFor = (locale: 'en' | 'ar'): MessageText => {
      const t = createTranslator({
        locale,
        messages: loadMessages(locale) as never,
        namespace: 'marketplace.portals.message' as never,
      }) as unknown as (key: string, values: Record<string, string>) => string;
      return (key, values) => t(key, values);
    };
    const formatFor = (locale: 'en' | 'ar') => {
      const t = createTranslator({
        locale,
        messages: loadMessages(locale) as never,
        namespace: 'marketplace.portals.formats' as never,
      }) as unknown as (key: string) => string;
      return (f: string) => t(f);
    };
    const input = {
      portal: 'JustDial',
      address: PATH_FULL,
      methods: ['GET', 'POST'] as ('GET' | 'POST')[],
      formats: ['query', 'form'] as ('query' | 'form')[],
    };

    it('is a short plain-text email with the address, the methods and the request for a test lead', () => {
      const message = accountManagerMessage(input, textFor('en'), 'en', formatFor('en'));
      const [subject, ...rest] = message.split('\n\n');
      expect(subject).toBe('Subject: Lead delivery address for our JustDial account');
      expect(rest.join('\n\n')).toContain(PATH_FULL);
      expect(message).toContain('GET or POST');
      expect(message).toContain('query-string parameters and form fields');
      expect(message).toContain('one test lead');
      expect(message).toContain('no header, password or signature is needed');
      expect(message).not.toMatch(/[<>]/);
      expect(message.length).toBeLessThan(900);
    });

    it('is written in Arabic for an Arabic workspace', () => {
      const message = accountManagerMessage(input, textFor('ar'), 'ar', formatFor('ar'));
      expect(message).toContain(PATH_FULL);
      expect(message).toContain('JustDial');
      expect(message).toMatch(/[؀-ۿ]/);
      expect(message).toContain('GET أو POST');
    });
  });
});

// --- the manage page: the address of a path connection -------------------------------------------------------------------------------

describe('manage page, a connection whose secret is in the address', () => {
  for (const locale of LOCALES) {
    it(`shows the masked address, the sender details and the way to a new address in ${locale}`, () => {
      const html = manage(pathInstallation(), undefined, locale);
      expect(html).toContain('data-testid="path-inbound"');
      expect(html).toContain(`value="${HOOK_URL}/...${PATH_TAIL}"`);
    });
  }

  it('shows only the end of the secret and never the secret', () => {
    const html = manage();
    expect(html).not.toContain(PATH_SECRET);
    expect(html).toContain('The last part of the address is its password.');
    expect(html).toContain('Method: GET or POST');
    expect(html).toContain('Accepted formats: query-string parameters, form fields, and JSON');
  });

  it('gives no header or signature instructions', () => {
    const html = manage();
    expect(html).not.toContain('X-Marketplace-Token');
    expect(html).not.toContain('X-Marketplace-Signature');
    expect(html).not.toContain('HMAC');
    expect(html).not.toContain('The secret ends in');
    // The same panel for a header-secret connection keeps its instructions.
    const header = manage(pullInstallation());
    expect(header).toContain('X-Marketplace-Token');
    expect(header).toContain('The secret ends in cdef.');
  });

  it('turns Rotate into "Create a new address" and says what happens to the old one and who needs the new one', () => {
    const html = manage();
    expect(html).toContain('>Create a new address<');
    expect(html).not.toContain('>Rotate secret<');
    expect(html).toContain('Lost the address, or want to stop someone using it?');
    expect(html).toContain('Create a new address?');
    expect(html).toContain('the old one stops working immediately');
    expect(html).toContain("until the portal's team is given the new one");
    expect(html).not.toContain('Rotate the connection secret?');
  });

  it('keeps Rotate secret for a connection whose secret travels in a header', () => {
    const html = manage(pullInstallation());
    expect(html).toContain('>Rotate secret<');
    expect(html).toContain('Rotate the connection secret?');
    expect(html).not.toContain('Create a new address');
  });

  it('waits for the first lead and says the portal team has to switch it on', () => {
    for (const locale of LOCALES) {
      expect(manage(pathInstallation(), undefined, locale)).toContain(
        'data-testid="waiting-first-lead"',
      );
    }
    const html = manage();
    expect(html).toContain('Waiting for the first lead from JustDial');
    expect(html).toContain("JustDial's own team has to switch this on.");
  });

  it('stops waiting once a lead arrived, and never waits on a connection that fetches or relays', () => {
    const arrived = pathInstallation({}, { lastEventAt: '2026-10-02T09:00:00.000Z' });
    expect(manage(arrived)).not.toContain('waiting-first-lead');
    expect(manage(pullInstallation({}, { lastEventAt: null }))).not.toContain('waiting-first-lead');
  });
});

// --- the manage page: a connection we poll -----------------------------------------------------------------------------------------

describe('manage page, a connection the platform polls', () => {
  for (const locale of LOCALES) {
    it(`shows Sync now, the next check and how far leads were fetched in ${locale}`, () => {
      const html = manage(pullInstallation(), undefined, locale);
      expect(html).toContain('data-testid="connection"');
      expect(html).toContain(locale === 'en' ? 'Sync now' : 'مزامنة الآن');
    });
  }

  it('shows the next poll, how far leads were fetched, the last success and Sync now next to Test connection', () => {
    const html = manage(pullInstallation());
    expect(html).toContain('Next check');
    expect(html).toContain('Oct 4, 2026');
    expect(html).toContain('Leads fetched up to');
    expect(html).toContain('Last success');
    expect(html).toContain('Checks every');
    expect(html).toContain('>Sync now<');
    expect(html.indexOf('Test connection')).toBeLessThan(html.indexOf('>Sync now<'));
  });

  it('says so when nothing is scheduled or fetched yet', () => {
    const html = manage(pullInstallation({}, { nextPollAt: null, syncedThrough: null }));
    expect(html).toContain('Not scheduled');
    expect(html).toContain('Nothing fetched yet');
  });

  it('offers no Sync now and no poll facts on a connection that is not polled', () => {
    for (const inst of [pathInstallation(), installation()]) {
      const html = manage(inst);
      expect(html).not.toContain('Sync now');
      expect(html).not.toContain('Next check');
      expect(html).not.toContain('Leads fetched up to');
    }
  });

  it('hides Sync now from someone who may not manage, and names the permission', () => {
    const html = manage(pullInstallation(), [READ, INSTALL]);
    expect(html).not.toContain('Sync now');
    expect(html).toContain('market.apps.manage');
    expect(manage(pullInstallation(), [READ, MANAGE])).toContain('>Sync now<');
  });

  it('does not offer Sync now to a paused app, and says to resume it', () => {
    const html = manage(pullInstallation({ status: 'disabled' }));
    expect(html).not.toContain('>Sync now<');
    expect(html).toContain('Resume the app to sync now.');
  });

  it('shows the last error and what to try after a polled connection stopped on an error', () => {
    const stopped = pullInstallation(
      {},
      { status: 'error', lastError: 'The portal refused the key.', nextPollAt: null },
    );
    const html = manage(stopped);
    expect(html).toContain('The portal refused the key.');
    expect(html).toContain('>Error<');
    expect(html).toContain('Enter the key again in Credentials or press Sync now.');
    expect(html).toContain('>Sync now<');
    expect(html).toContain('Not scheduled');
  });

  it('does not tell someone who cannot press Sync now to press it', () => {
    const stopped = pullInstallation(
      {},
      { status: 'error', lastError: 'The portal refused the key.' },
    );
    const html = manage(stopped, [READ]);
    expect(html).toContain('Enter the key again in Credentials.');
    expect(html).not.toContain('press Sync now');
  });

  it('says nothing about keys when the connection works', () => {
    expect(manage(pullInstallation())).not.toContain('Enter the key again');
  });
});

// --- what Sync now answers -----------------------------------------------------------------------------------------------------------

describe('Sync now: the answer and the problems', () => {
  const NOW = Date.parse('2026-10-04T10:00:00.000Z');
  const note = (afterSeconds: number, minIntervalSeconds = 300) =>
    syncNote(
      {
        status: 'scheduled',
        runAt: new Date(NOW + afterSeconds * 1000).toISOString(),
        minIntervalSeconds,
      },
      NOW,
    );

  it('draws nothing before there is an answer', () => {
    expect(renderMarket(<SyncFeedback note={null} />)).not.toContain('sync-result');
  });

  it('says it starts right away when the portal allows a request now', () => {
    const html = renderMarket(<SyncFeedback note={note(0)} />);
    expect(html).toContain('data-testid="sync-result"');
    expect(html).toContain('Sync scheduled. It starts right away.');
    expect(html).not.toContain('allows one request');
  });

  it('says when it runs and that it has to wait for the interval the portal asks for, taken from the answer', () => {
    const html = renderMarket(<SyncFeedback note={note(240)} />);
    expect(html).toContain('Sync scheduled for Oct 4, 2026');
    expect(html).toContain('The portal allows one request every 5 minutes');
    const other = renderMarket(<SyncFeedback note={note(60, 900)} />);
    expect(other).toContain('one request every 15 minutes');
    expect(renderMarket(<SyncFeedback note={note(30, 45)} />)).toContain('every 45 seconds');
    expect(renderMarket(<SyncFeedback note={note(30, 3600)} />)).toContain('every 1 hour');
  });

  it('names no portal in the wait: the same words serve every portal', () => {
    const html = renderMarket(<SyncFeedback note={note(240)} />);
    expect(html).not.toContain('IndiaMART');
  });

  for (const locale of LOCALES) {
    it(`is complete in ${locale}, immediate and waiting`, () => {
      expect(renderMarket(<SyncFeedback note={note(0)} />, { locale })).toContain('sync-result');
      expect(renderMarket(<SyncFeedback note={note(240)} />, { locale })).toContain('sync-result');
    });
  }

  it('says in Arabic how long the portal asks us to wait, with the right plural', () => {
    expect(renderMarket(<SyncFeedback note={note(240)} />, { locale: 'ar' })).toContain('5 دقائق');
    expect(renderMarket(<SyncFeedback note={note(240, 120)} />, { locale: 'ar' })).toContain(
      'دقيقتين',
    );
  });

  const problem = (status: number, code: string) => new ApiError(status, code, 'x', 'req-9');
  const shows = (error: unknown) =>
    words(renderMarket(<ProblemNotice error={error} onReload={noop} />));

  it('tells a connection that cannot be synced what is wrong', () => {
    expect(shows(problem(409, ERROR_CODES.MKT_NO_CONNECTION))).toContain(
      'This installation has no connection that can do that.',
    );
  });

  it('tells a paused or stopped app to resume it or says it can only be uninstalled', () => {
    expect(shows(problem(409, ERROR_CODES.MKT_INSTALLATION_DISABLED))).toContain(
      'This app is paused. Resume it first.',
    );
    expect(shows(problem(409, ERROR_CODES.MKT_INSTALLATION_KILLED))).toContain(
      'It can only be uninstalled.',
    );
  });

  it('tells someone without the permission, and gives the request id for support', () => {
    const html = shows(problem(403, ERROR_CODES.FORBIDDEN));
    expect(html).toContain('You do not have permission to do this.');
    expect(html).toContain('req-9');
  });

  for (const locale of LOCALES) {
    it(`has a message for every refusal Sync now can get in ${locale}`, () => {
      for (const code of [
        ERROR_CODES.MKT_NO_CONNECTION,
        ERROR_CODES.MKT_INSTALLATION_DISABLED,
        ERROR_CODES.MKT_INSTALLATION_KILLED,
        ERROR_CODES.FORBIDDEN,
      ]) {
        expect(
          renderMarket(<ProblemNotice error={problem(409, code)} onReload={noop} />, { locale }),
        ).toContain('role="alert"');
      }
    });
  }
});
