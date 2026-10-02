import type { Consent } from './consent';

/**
 * Which analytics and ad scripts a page may load (TW-SET-033). The saved ids are interpolated into script text, so each
 * is checked against the shape the vendor really issues and silently skipped when it does not fit: an id can never carry
 * code. Everything is plain data (a source URL or inline text); the client component turns it into script elements.
 */
export type TrackerCategory = 'analytics' | 'marketing';

export interface TrackerScript {
  /** Unique, so a script is added once however many times the plan is recomputed. */
  key: string;
  category: TrackerCategory | 'google';
  src?: string;
  inline?: string;
  attrs?: Record<string, string>;
  /** `<noscript>` fallback pixel, for vendors that offer one (shown as a hidden image). */
  pixel?: string;
}

export interface TrackerIds {
  googleGa4?: string;
  googleGtm?: string;
  metaPixel?: string;
  microsoftClarity?: string;
  tiktokPixel?: string;
  linkedinPartner?: string;
  twitterPixel?: string;
  plausibleDomain?: string;
  posthogKey?: string;
  posthogHost?: string;
  mixpanelToken?: string;
  hotjarSiteId?: string;
}

const OK = {
  ga4: /^G-[A-Z0-9]{4,20}$/i,
  gtm: /^GTM-[A-Z0-9]{3,12}$/i,
  digits: /^\d{4,20}$/,
  token: /^[A-Za-z0-9_-]{4,64}$/,
  tiktok: /^[A-Z0-9]{8,32}$/i,
  twitter: /^[a-z0-9]{4,12}$/i,
  domain: /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/i,
  posthog: /^[A-Za-z0-9_-]{6,80}$/,
};
const js = (v: string) => JSON.stringify(v);
const clean = (v: string | undefined, re: RegExp) => {
  const t = (v ?? '').trim();
  return t !== '' && re.test(t) ? t : null;
};

/** Google Consent Mode v2 state: only a flag the visitor granted is "granted". */
export function consentModeState(c: Consent) {
  return {
    ad_storage: c.marketing ? 'granted' : 'denied',
    ad_user_data: c.marketing ? 'granted' : 'denied',
    ad_personalization: c.marketing ? 'granted' : 'denied',
    analytics_storage: c.analytics ? 'granted' : 'denied',
  };
}

/** `gtag('consent','update', ...)` for a change made after the Google tag has loaded. */
export const consentUpdateSnippet = (c: Consent) =>
  `window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag('consent','update',${JSON.stringify(consentModeState(c))});`;

export function buildTrackers(ids: TrackerIds, consent: Consent): TrackerScript[] {
  const out: TrackerScript[] = [];
  const ga4 = clean(ids.googleGa4, OK.ga4);
  const gtm = clean(ids.googleGtm, OK.gtm);

  // Google tags always load, with Consent Mode saying what they may store (rule 2). Reference granted analytics storage to
  // everyone; here it follows the Analytics choice, which is what the admin screen and the docs promise.
  if (ga4 || gtm) {
    out.push({
      key: 'google-consent',
      category: 'google',
      inline: `window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag('consent','default',${JSON.stringify(
        {
          ...consentModeState(consent),
          wait_for_update: 500,
        },
      )});`,
    });
  }
  if (ga4) {
    out.push({
      key: 'ga4',
      category: 'google',
      src: `https://www.googletagmanager.com/gtag/js?id=${ga4}`,
      attrs: { async: '' },
    });
    out.push({
      key: 'ga4-config',
      category: 'google',
      inline: `gtag('js',new Date());gtag('config',${js(ga4)},{anonymize_ip:true});`,
    });
  }
  if (gtm) {
    out.push({
      key: 'gtm',
      category: 'google',
      inline: `(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s);j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer',${js(gtm)});`,
    });
  }

  if (consent.analytics) {
    const clarity = clean(ids.microsoftClarity, OK.token);
    if (clarity) {
      out.push({
        key: 'clarity',
        category: 'analytics',
        inline: `(function(c,l,a,r,i,t,y){c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};t=l.createElement(r);t.async=1;t.src='https://www.clarity.ms/tag/'+i;y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);})(window,document,'clarity','script',${js(clarity)});`,
      });
    }
    const plausible = clean(ids.plausibleDomain, OK.domain);
    if (plausible) {
      out.push({
        key: 'plausible',
        category: 'analytics',
        src: 'https://plausible.io/js/script.js',
        attrs: { defer: '', 'data-domain': plausible },
      });
    }
    const posthog = clean(ids.posthogKey, OK.posthog);
    if (posthog) {
      const host = /^https?:\/\/[^\s'"<>]+$/i.test((ids.posthogHost ?? '').trim())
        ? (ids.posthogHost ?? '').trim().replace(/\/+$/, '')
        : 'https://app.posthog.com';
      out.push({
        key: 'posthog',
        category: 'analytics',
        inline: `(function(){var s=document.createElement('script');s.async=true;s.src=${js(`${host}/static/array.js`)};s.onload=function(){window.posthog&&window.posthog.init(${js(posthog)},{api_host:${js(host)}})};document.head.appendChild(s);})();`,
      });
    }
    const hotjar = clean(ids.hotjarSiteId, OK.digits);
    if (hotjar) {
      out.push({
        key: 'hotjar',
        category: 'analytics',
        inline: `(function(h,o,t,j,a,r){h.hj=h.hj||function(){(h.hj.q=h.hj.q||[]).push(arguments)};h._hjSettings={hjid:${Number(hotjar)},hjsv:6};a=o.getElementsByTagName('head')[0];r=o.createElement('script');r.async=1;r.src=t+h._hjSettings.hjid+j+h._hjSettings.hjsv;a.appendChild(r);})(window,document,'https://static.hotjar.com/c/hotjar-','.js?sv=');`,
      });
    }
    const mixpanel = clean(ids.mixpanelToken, OK.posthog);
    if (mixpanel) {
      out.push({
        key: 'mixpanel',
        category: 'analytics',
        inline: `(function(){var s=document.createElement('script');s.async=true;s.src='https://cdn.mxpnl.com/libs/mixpanel-2-latest.min.js';s.onload=function(){window.mixpanel&&window.mixpanel.init(${js(mixpanel)},{track_pageview:true})};document.head.appendChild(s);})();`,
      });
    }
  }

  if (consent.marketing) {
    const meta = clean(ids.metaPixel, OK.digits);
    if (meta) {
      out.push({
        key: 'meta-pixel',
        category: 'marketing',
        inline: `!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init',${js(meta)});fbq('track','PageView');`,
        pixel: `https://www.facebook.com/tr?id=${meta}&ev=PageView&noscript=1`,
      });
    }
    const tiktok = clean(ids.tiktokPixel, OK.tiktok);
    if (tiktok) {
      out.push({
        key: 'tiktok-pixel',
        category: 'marketing',
        inline: `!function(w,d,t){w.TiktokAnalyticsObject=t;var ttq=w[t]=w[t]||[];ttq.methods=['page','track','identify'];ttq.setAndDefer=function(t,e){t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}};for(var i=0;i<ttq.methods.length;i++)ttq.setAndDefer(ttq,ttq.methods[i]);ttq.load=function(e){var n='https://analytics.tiktok.com/i18n/pixel/events.js';ttq._i=ttq._i||{};ttq._i[e]=[];ttq._t=ttq._t||{};ttq._t[e]=+new Date;var o=d.createElement('script');o.type='text/javascript';o.async=!0;o.src=n+'?sdkid='+e+'&lib='+t;var a=d.getElementsByTagName('script')[0];a.parentNode.insertBefore(o,a)};ttq.load(${js(tiktok)});ttq.page()}(window,document,'ttq');`,
      });
    }
    const linkedin = clean(ids.linkedinPartner, OK.digits);
    if (linkedin) {
      out.push({
        key: 'linkedin',
        category: 'marketing',
        inline: `window._linkedin_data_partner_ids=window._linkedin_data_partner_ids||[];window._linkedin_data_partner_ids.push(${js(linkedin)});(function(l){if(!l){window.lintrk=function(a,b){window.lintrk.q.push([a,b])};window.lintrk.q=[]}var s=document.getElementsByTagName('script')[0];var b=document.createElement('script');b.type='text/javascript';b.async=true;b.src='https://snap.licdn.com/li.lms-analytics/insight.min.js';s.parentNode.insertBefore(b,s);})(window.lintrk);`,
        pixel: `https://px.ads.linkedin.com/collect/?pid=${linkedin}&fmt=gif`,
      });
    }
    const twitter = clean(ids.twitterPixel, OK.twitter);
    if (twitter) {
      out.push({
        key: 'x-pixel',
        category: 'marketing',
        inline: `!function(e,t,n,s,u,a){e.twq||(s=e.twq=function(){s.exe?s.exe.apply(s,arguments):s.queue.push(arguments)},s.version='1.1',s.queue=[],u=t.createElement(n),u.async=!0,u.src='https://static.ads-twitter.com/uwt.js',a=t.getElementsByTagName(n)[0],a.parentNode.insertBefore(u,a))}(window,document,'script');twq('config',${js(twitter)});`,
      });
    }
  }
  return out;
}
