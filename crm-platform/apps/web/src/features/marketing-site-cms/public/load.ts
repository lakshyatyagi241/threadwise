import 'server-only';
import {
  publicContentResponseSchema,
  publicFaqListResponseSchema,
  publicPricingResponseSchema,
  publicSiteInfoSchema,
  registrationConfigResponseSchema,
  type CmsPage,
} from '@crm/contracts';
import { EMPTY_CONTENT, type SiteContent } from '../site/content';
import type { SiteExtras } from '../site/site-ui';
import { cmsPublic, publicApi } from './api';

/** The published content of the site. Never throws: a page falls back to every shipped default. */
export async function loadSiteContent(): Promise<SiteContent> {
  return (await cmsPublic('/content', publicContentResponseSchema)) ?? EMPTY_CONTENT;
}

/** The data other domains own that a page's sections need (plans, FAQ table, company details, captcha). */
export async function loadExtras(page: CmsPage): Promise<SiteExtras> {
  const extras: SiteExtras = {};
  const jobs: Array<Promise<void>> = [];
  if (page === 'home' || page === 'pricing') {
    jobs.push(
      cmsPublic('/pricing', publicPricingResponseSchema).then((p) => void (extras.pricing = p)),
    );
  }
  if (page === 'pricing' || page === 'home') {
    jobs.push(
      publicApi('/public/pricing-faqs', publicFaqListResponseSchema, {
        for: page === 'pricing' ? 'pricing' : 'home',
      }).then((r) => {
        if (page === 'pricing') extras.tableFaqs = r?.data ?? [];
        else extras.homeFaqs = r?.data ?? [];
      }),
    );
  }
  if (page === 'contact') {
    jobs.push(
      cmsPublic('/site-info', publicSiteInfoSchema).then((s) => void (extras.siteInfo = s)),
      publicApi('/auth/registration-config', registrationConfigResponseSchema).then(
        (c) => void (extras.captcha = c?.captcha ?? null),
      ),
    );
  }
  await Promise.all(jobs);
  return extras;
}
