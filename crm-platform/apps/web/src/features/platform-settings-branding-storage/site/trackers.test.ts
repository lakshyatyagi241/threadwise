import { describe, expect, it } from 'vitest';
import { choice, DENIED } from './consent';
import { buildTrackers, consentModeState, consentUpdateSnippet } from './trackers';

const keys = (ids: Parameters<typeof buildTrackers>[0], c = DENIED) =>
  buildTrackers(ids, c).map((s) => s.key);

describe('tracker injection with consent gating (TW-SET-033)', () => {
  it('Clarity loads with analytics consent and not without', () => {
    expect(keys({ microsoftClarity: 'abc123xyz' }, choice(true, false))).toEqual(['clarity']);
    expect(keys({ microsoftClarity: 'abc123xyz' }, choice(false, false))).toEqual([]);
  });

  it('the Meta pixel needs marketing consent and brings its noscript image', () => {
    expect(keys({ metaPixel: '1234567890' }, choice(true, false))).toEqual([]);
    const on = buildTrackers({ metaPixel: '1234567890' }, choice(false, true));
    expect(on.map((s) => s.key)).toEqual(['meta-pixel']);
    expect(on[0]!.inline).toContain('fbq(\'init\',"1234567890")');
    expect(on[0]!.pixel).toContain('id=1234567890');
  });

  it('a GA4 id with no choice still loads the Google tag, with every ad flag and analytics denied', () => {
    const plan = buildTrackers({ googleGa4: 'G-ABC1234' }, DENIED);
    expect(plan.map((s) => s.key)).toEqual(['google-consent', 'ga4', 'ga4-config']);
    expect(plan[0]!.inline).toContain('"ad_storage":"denied"');
    expect(plan[0]!.inline).toContain('"ad_user_data":"denied"');
    expect(plan[0]!.inline).toContain('"ad_personalization":"denied"');
    expect(plan[0]!.inline).toContain('"analytics_storage":"denied"');
    expect(plan[0]!.inline).toContain('wait_for_update');
    expect(plan[1]!.src).toBe('https://www.googletagmanager.com/gtag/js?id=G-ABC1234');
    expect(plan[2]!.inline).toContain('anonymize_ip:true');
  });

  it('Consent Mode follows the visitor: marketing grants the ad flags, analytics grants analytics storage', () => {
    expect(consentModeState(choice(true, false))).toEqual({
      ad_storage: 'denied',
      ad_user_data: 'denied',
      ad_personalization: 'denied',
      analytics_storage: 'granted',
    });
    expect(consentModeState(choice(false, true)).ad_storage).toBe('granted');
    expect(consentUpdateSnippet(choice(true, true))).toContain("gtag('consent','update'");
  });

  it('GTM always loads its container', () => {
    expect(keys({ googleGtm: 'GTM-ABC123' })).toEqual(['google-consent', 'gtm']);
  });

  it('with everything granted every configured vendor is present, in two buckets', () => {
    const all = buildTrackers(
      {
        microsoftClarity: 'clar1234',
        plausibleDomain: 'acme.test',
        posthogKey: 'phc_abcdef123',
        posthogHost: 'https://eu.posthog.com',
        hotjarSiteId: '3456789',
        mixpanelToken: 'mixtoken1234',
        metaPixel: '1234567890',
        tiktokPixel: 'CABCDEF123456',
        linkedinPartner: '987654',
        twitterPixel: 'o1abc',
      },
      choice(true, true),
    );
    expect(all.map((s) => s.key)).toEqual([
      'clarity',
      'plausible',
      'posthog',
      'hotjar',
      'mixpanel',
      'meta-pixel',
      'tiktok-pixel',
      'linkedin',
      'x-pixel',
    ]);
    expect(all.filter((s) => s.category === 'analytics')).toHaveLength(5);
    expect(all.filter((s) => s.category === 'marketing')).toHaveLength(4);
    const posthog = all.find((s) => s.key === 'posthog')!;
    expect(posthog.inline).toContain('https://eu.posthog.com/static/array.js');
    expect(all.find((s) => s.key === 'plausible')!.attrs).toMatchObject({
      'data-domain': 'acme.test',
    });
    expect(all.find((s) => s.key === 'hotjar')!.inline).toContain('hjid:3456789');
  });

  it('an id that is not the shape the vendor issues is skipped, so an id can never carry code', () => {
    const hostile = ["x');alert(1);('", '1" onerror="x', '</script><script>x', 'a b'];
    for (const bad of hostile) {
      expect(
        keys(
          {
            googleGa4: bad,
            googleGtm: bad,
            microsoftClarity: bad,
            plausibleDomain: bad,
            posthogKey: bad,
            hotjarSiteId: bad,
            mixpanelToken: bad,
            metaPixel: bad,
            tiktokPixel: bad,
            linkedinPartner: bad,
            twitterPixel: bad,
          },
          choice(true, true),
        ),
      ).toEqual([]);
    }
  });

  it('a hostile PostHog host falls back to the default host', () => {
    const plan = buildTrackers(
      { posthogKey: 'phc_abcdef123', posthogHost: "javascript:alert('x')" },
      choice(true, false),
    );
    expect(plan[0]!.inline).toContain('https://app.posthog.com/static/array.js');
  });

  it('nothing configured, nothing loaded', () => {
    expect(buildTrackers({}, choice(true, true))).toEqual([]);
  });
});
