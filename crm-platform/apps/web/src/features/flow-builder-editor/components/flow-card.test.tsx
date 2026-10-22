import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { FlowFeatured, FlowSummary } from '@crm/contracts';
import { FeaturedCard, FlowCard, triggerLabelKey, type CardActions } from './flow-card';

// Messages are not loaded here: the key is the text, so the assertions read the structure.
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const flow = (over: Partial<FlowSummary> = {}): FlowSummary => ({
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Welcome',
  flowType: 'chat',
  builder: 'simple',
  category: 'welcome',
  state: 'live',
  isPublished: true,
  isActive: true,
  triggerKind: 'keyword',
  nodeCount: 3,
  edgeCount: 2,
  subscribers: { active: 0, completed: 0, failed: 0 },
  publishedAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  rowVersion: 1,
  ...over,
});
const fn = () => undefined;
const actions: CardActions = {
  onToggle: fn,
  onRename: fn,
  onDuplicate: fn,
  onExport: fn,
  onDelete: fn,
  can: { update: true, create: true, remove: true },
};
const card = (over: Partial<FlowSummary> = {}) =>
  renderToStaticMarkup(<FlowCard flow={flow(over)} actions={actions} />);

describe('flow card (TW-FLB-001)', () => {
  it('a WhatsApp bot carries the WhatsApp mark, an Advanced messaging flow the automation mark instead', () => {
    expect(card()).not.toContain('flow-card-automation');
    const advanced = card({ builder: 'advanced' });
    expect(advanced).toContain('data-testid="flow-card-automation"');
    expect(advanced).not.toContain('bg-[#25D366]');
  });

  it('a keyword bot opens in the Simple builder and links its analytics to the runtime page of that flow', () => {
    const html = card();
    expect(html).toContain('href="/flows/simple/11111111-1111-4111-8111-111111111111"');
    expect(html).toContain(
      'href="/flow-runtime/analytics?flowId=11111111-1111-4111-8111-111111111111"',
    );
    expect(html).not.toContain('data-flow-enroll');
  });

  it('a manual-enroll bot opens like any other bot, with no enroll button on the card', () => {
    const html = card({ triggerKind: 'manual_enroll' });
    expect(html).not.toContain('data-flow-enroll');
    expect(html).toContain('href="/flows/simple/11111111-1111-4111-8111-111111111111"');
    expect(html).not.toContain('href="/flow-runtime/flows/');
  });

  it('has no FAQs link: FAQs are entries in an AI agent now', () => {
    expect(card()).not.toContain('data-flow-faqs');
    expect(card({ flowType: 'web' })).not.toContain('tab=faqs');
  });

  it('an Instagram flow has no analytics link (it runs remotely) and carries the Instagram badge', () => {
    const html = card({ flowType: 'instagram' });
    expect(html).not.toContain('/flow-runtime/analytics');
    expect(html).toContain('>instagram<');
  });

  it('only instagram and call flows get a channel badge', () => {
    expect(card({ flowType: 'call' })).toContain('>call<');
    expect(card({ flowType: 'facebook' })).not.toMatch(/>(facebook|call|instagram)</);
  });

  it('QUIRK: every trigger kind but tag, group and manual reads "Keyword"', () => {
    expect(triggerLabelKey('tag_added')).toBe('triggerTag');
    expect(triggerLabelKey('group_join')).toBe('triggerGroup');
    expect(triggerLabelKey('manual_enroll')).toBe('triggerManual');
    for (const k of [
      'keyword',
      'contact_created',
      'opt_in',
      'order_placed',
      'deal_stage_changed',
      'away',
      'out_of_hours',
      'comment_to_dm',
    ]) {
      expect(triggerLabelKey(k)).toBe('triggerKeyword');
    }
  });

  it('state pills use the shared uppercase mono pill', () => {
    expect(card({ state: 'paused', isActive: false })).toContain('uppercase');
  });
});

describe('featured card (TW-FLB-002)', () => {
  const featured = (over: Partial<FlowFeatured> = {}): FlowFeatured => ({
    ...flow({ category: 'cart-recovery', name: 'Cart' }),
    steps: 6,
    messages: 1,
    waitMinutes: 150,
    preview: [
      { type: 'trigger', label: 'Trigger / keyword' },
      { type: 'delay', label: 'Wait 30 min' },
    ],
    ...over,
  });

  it('shows the category as "Cart recovery", the preview labels and the "more steps" line', () => {
    const html = renderToStaticMarkup(<FeaturedCard flow={featured()} actions={actions} />);
    expect(html).toContain('>Cart recovery<');
    expect(html).toContain('Trigger / keyword');
    expect(html).toContain('Wait 30 min');
    expect(html).toContain('~2.5 h total');
  });

  it('names the bot: a WhatsApp flow and a website flow each carry their own type pill', () => {
    const wa = renderToStaticMarkup(<FeaturedCard flow={featured()} actions={actions} />);
    expect(wa).toContain('data-testid="featured-flow-type"');
    expect(wa).toContain('contracts.flowTypes.chat');
    const web = renderToStaticMarkup(
      <FeaturedCard flow={featured({ flowType: 'web' })} actions={actions} />,
    );
    expect(web).toContain('contracts.flowTypes.web');
    expect(web).not.toContain('contracts.flowTypes.chat');
  });

  it('a flow with no category reads "Flow"', () => {
    expect(
      renderToStaticMarkup(<FeaturedCard flow={featured({ category: null })} actions={actions} />),
    ).toContain('>Flow<');
  });

  it('an empty graph shows the empty-preview note', () => {
    const html = renderToStaticMarkup(
      <FeaturedCard flow={featured({ preview: [], steps: 0, waitMinutes: 0 })} actions={actions} />,
    );
    expect(html).toContain('emptyPreview');
    expect(html).toContain('no waits');
  });
});
