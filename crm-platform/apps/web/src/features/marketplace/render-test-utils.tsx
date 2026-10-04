import { createElement, type ReactElement } from 'react';
import { ToastProvider } from '@crm/ui';
import {
  makeSession,
  renderAccount,
  type Seed,
} from '@/features/auth-registration-security/account/render-test-utils';

/** Shared by the render tests of this feature (never imported by app code): the workspace render helper with a toast host and the three Marketplace keys. */

export const READ = 'market.apps.read';
export const INSTALL = 'market.apps.install';
export const MANAGE = 'market.apps.manage';
export const ALL_KEYS = [READ, INSTALL, MANAGE] as const;

export interface MarketRenderOptions {
  locale?: 'en' | 'ar';
  /** The permission keys the signed-in person holds. Default: all three Marketplace keys. */
  permissions?: readonly string[];
  seed?: Seed;
}

export function renderMarket(element: ReactElement, options: MarketRenderOptions = {}): string {
  const keys = options.permissions ?? ALL_KEYS;
  return renderAccount(createElement(ToastProvider, { children: element }), {
    locale: options.locale,
    seed: options.seed,
    session: makeSession({ permissions: Object.fromEntries(keys.map((k) => [k, 'all' as const])) }),
  });
}

/** What an infinite query holds after one page: the shape `useCursorList` reads. */
export const onePage = <T,>(data: T[], hasMore = false) => ({
  pages: [{ data, page: { nextCursor: hasMore ? 'next' : null, hasMore, limit: 24 } }],
  pageParams: [undefined],
});
