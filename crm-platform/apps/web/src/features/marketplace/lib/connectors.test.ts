import { describe, expect, it } from 'vitest';
import type { MarketAppCard } from '@crm/contracts';
import { NO_FILTERS } from './browse';
import {
  CONNECTOR_CATEGORY,
  FALLBACK_CONNECTOR_CATEGORY,
  connectorCategory,
  connectorCategoryCounts,
  filterConnectors,
  googleStatus,
  isGoogleConnector,
  meetingsStatus,
  mergeGrid,
  storeStatus,
  type ConnectorEntry,
} from './connectors';
import { INTEGRATION_TOOL_IDS } from './tools';

const entry = (id: string, over: Partial<ConnectorEntry> = {}): ConnectorEntry => ({
  id,
  name: id,
  description: `${id} description`,
  categorySlug: connectorCategory(id),
  href: `/${id}`,
  icon: 'dot',
  locked: false,
  comingSoon: false,
  status: 'unknown',
  ...over,
});
const card = (name: string) => ({ id: name, slug: name, name }) as unknown as MarketAppCard;

const ALL = [
  entry('shopify', { name: 'Shopify', status: 'connected' }),
  entry('woocommerce', { name: 'WooCommerce', status: 'not_connected' }),
  entry('google-sheets', { name: 'Google Sheets', description: 'Read rows' }),
  entry('video-meetings', { name: 'Video meetings', status: 'connected' }),
];

describe('connector categories', () => {
  it('maps every Integrations-tab connector to a listing category', () => {
    for (const id of INTEGRATION_TOOL_IDS) expect(CONNECTOR_CATEGORY[id], id).toBeTruthy();
  });

  it('puts an unmapped connector in the catch-all category instead of losing it', () => {
    expect(connectorCategory('brand-new')).toBe(FALLBACK_CONNECTOR_CATEGORY);
  });

  it('counts connectors per category for the category list', () => {
    expect(connectorCategoryCounts(ALL)).toEqual({
      'e-commerce': 2,
      productivity: 1,
      'calendar-and-meetings': 1,
    });
  });
});

describe('filterConnectors', () => {
  it('returns everything A-Z with no filter', () => {
    expect(filterConnectors(ALL, NO_FILTERS).map((e) => e.name)).toEqual([
      'Google Sheets',
      'Shopify',
      'Video meetings',
      'WooCommerce',
    ]);
  });

  it('searches the name and the description, ignoring case', () => {
    expect(filterConnectors(ALL, { ...NO_FILTERS, q: 'SHOP' }).map((e) => e.id)).toEqual([
      'shopify',
    ]);
    expect(filterConnectors(ALL, { ...NO_FILTERS, q: 'rows' }).map((e) => e.id)).toEqual([
      'google-sheets',
    ]);
    expect(filterConnectors(ALL, { ...NO_FILTERS, q: 'nothing' })).toEqual([]);
  });

  it('keeps one category', () => {
    expect(
      filterConnectors(ALL, { ...NO_FILTERS, category: 'e-commerce' }).map((e) => e.id),
    ).toEqual(['shopify', 'woocommerce']);
  });

  it('Installed keeps the connected ones; an unknown status is not connected', () => {
    expect(filterConnectors(ALL, { ...NO_FILTERS, installed: true }).map((e) => e.id)).toEqual([
      'shopify',
      'video-meetings',
    ]);
  });

  it('shows no connector under Available add-ons', () => {
    expect(filterConnectors(ALL, { ...NO_FILTERS, addons: true })).toEqual([]);
  });

  it('combines search, category and status', () => {
    expect(
      filterConnectors(ALL, {
        ...NO_FILTERS,
        q: 'o',
        category: 'e-commerce',
        installed: true,
      }).map((e) => e.id),
    ).toEqual(['shopify']);
  });
});

describe('mergeGrid', () => {
  const connectors = [entry('b', { name: 'Beta' }), entry('z', { name: 'Zed' })];
  const cards = [card('Alpha'), card('Gamma')];
  const label = (g: ReturnType<typeof mergeGrid>) =>
    g.map((i) => (i.type === 'card' ? `card:${i.card.name}` : `conn:${i.connector.name}`));

  it('by name, merges A-Z with the loaded cards and holds back what sorts after the last loaded card', () => {
    expect(label(mergeGrid(cards, connectors, 'name', true))).toEqual([
      'card:Alpha',
      'conn:Beta',
      'card:Gamma',
    ]);
  });

  it('by name, adds the rest once the last page is loaded', () => {
    expect(label(mergeGrid(cards, connectors, 'name', false))).toEqual([
      'card:Alpha',
      'conn:Beta',
      'card:Gamma',
      'conn:Zed',
    ]);
  });

  it('by every other sort, the connectors follow the listings, A-Z, once the last page is loaded', () => {
    for (const sort of ['popular', 'featured', 'new'] as const) {
      expect(label(mergeGrid(cards, connectors, sort, true))).toEqual(['card:Alpha', 'card:Gamma']);
      expect(label(mergeGrid(cards, connectors, sort, false))).toEqual([
        'card:Alpha',
        'card:Gamma',
        'conn:Beta',
        'conn:Zed',
      ]);
    }
  });

  it('shows only the connectors when there are no listings', () => {
    expect(label(mergeGrid([], connectors, 'popular', false))).toEqual(['conn:Beta', 'conn:Zed']);
    expect(label(mergeGrid([], connectors, 'name', false))).toEqual(['conn:Beta', 'conn:Zed']);
  });

  it('shows only the listings on the Mini apps tab (no connectors)', () => {
    expect(label(mergeGrid(cards, [], 'popular', false))).toEqual(['card:Alpha', 'card:Gamma']);
  });
});

describe('connector status', () => {
  const account = (status: string, granted: string[]) => ({
    status,
    capabilities: ['calendar', 'sheets', 'docs', 'forms'].map((key) => ({
      key,
      granted: granted.includes(key),
    })),
  });

  it('is unknown until the read has an answer', () => {
    expect(googleStatus('google-account', undefined)).toBe('unknown');
    expect(storeStatus(undefined)).toBe('unknown');
    expect(meetingsStatus(undefined)).toBe('unknown');
  });

  it('Google: the account card needs the connection, the others also their permission', () => {
    expect(googleStatus('google-account', account('connected', []))).toBe('connected');
    expect(googleStatus('google-sheets', account('connected', ['sheets']))).toBe('connected');
    expect(googleStatus('google-docs', account('connected', ['sheets']))).toBe('not_connected');
    expect(googleStatus('google-calendar', account('needs_reconnect', ['calendar']))).toBe(
      'not_connected',
    );
    expect(googleStatus('google-forms', account('disconnected', []))).toBe('not_connected');
    expect(isGoogleConnector('email')).toBe(false);
  });

  it('stores and video meetings say connected only when one is', () => {
    expect(storeStatus({ store: { connected: true } })).toBe('connected');
    expect(storeStatus({ store: { connected: false } })).toBe('not_connected');
    expect(storeStatus({ store: null })).toBe('not_connected');
    expect(meetingsStatus({ data: [{ status: 'not_installed' }] })).toBe('not_connected');
    expect(meetingsStatus({ data: [{ status: 'connected' }] })).toBe('connected');
  });
});
