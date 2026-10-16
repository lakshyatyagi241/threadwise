import { describe, expect, it } from 'vitest';
import type { PreviousSendOption, PreviousSendsAudience } from '@crm/contracts';
import { html, previousSends, uuid } from '../wizard/testing';
import { PreviousSendsPicker } from './previous-sends-picker';

const noop = () => undefined;
const render = (
  value: PreviousSendsAudience | null,
  options: PreviousSendOption[] = previousSends(),
) => html(<PreviousSendsPicker options={options} value={value} onChange={noop} />);

const campaign = (n: number): PreviousSendOption => ({
  ...previousSends()[1]!,
  id: uuid(100 + n),
  name: `Campaign ${n}`,
});

describe('PreviousSendsPicker', () => {
  it('lists each send with its name, a Broadcast or Campaign badge, recipients and the chosen outcome count', () => {
    const out = render({ sends: [], outcome: 'read' });
    expect(out).toContain('Diwali offer');
    expect(out).toContain('Spring win-back');
    expect(out).toContain('>Broadcast<');
    expect(out).toContain('>Campaign<');
    expect(out).toContain('500 recipients');
    expect(out).toContain('300 people read it');
    expect(out).toContain('120 people read it');
    expect(out).toContain('Oct 1, 2026');
  });

  it('explains the chosen outcome in one line', () => {
    expect(render({ sends: [], outcome: 'read' })).toContain('Read: the people who read it.');
    expect(render({ sends: [], outcome: 'not_read' })).toContain(
      'Did not read: the people it was sent to',
    );
  });

  it('shows the empty state when there are no earlier sends', () => {
    const out = render(null, []);
    expect(out).toContain('No earlier broadcasts or campaigns yet');
    expect(out).not.toContain('type="checkbox"');
  });

  it('adds a search box for a long list only', () => {
    const many = Array.from({ length: 7 }, (_, i) => campaign(i));
    expect(render(null, many)).toContain('aria-label="Search previous sends"');
    expect(render(null)).not.toContain('aria-label="Search previous sends"');
  });

  it('turns replied, not replied and clicked off while a broadcast is ticked, and says why', () => {
    const [b] = previousSends();
    const out = render({ sends: [{ kind: 'broadcast', id: b!.id }], outcome: 'all' });
    expect(out).toMatch(
      /<option value="replied" disabled="">Replied \(not for broadcasts\)<\/option>/,
    );
    expect(out).toMatch(/<option value="clicked" disabled="">/);
    expect(out).toMatch(/<option value="not_replied" disabled="">/);
    expect(out).toMatch(/<option value="read">Read<\/option>/);
    expect(out).toContain('A broadcast records delivery and reading only');
  });

  it('keeps every outcome open when only campaigns are ticked', () => {
    const [, c] = previousSends();
    const out = render({ sends: [{ kind: 'campaign', id: c!.id }], outcome: 'clicked' });
    expect(out).not.toMatch(/<option value="[a-z_]+" disabled/);
  });

  it('disables a broadcast, with the reason, while the outcome needs replies or clicks', () => {
    const out = render({ sends: [], outcome: 'replied' });
    expect(out).toContain('A broadcast has no replies or clicks');
    expect(out).toContain('Not recorded for a broadcast');
    expect(out.match(/disabled=""/g)?.length).toBe(1);
  });

  it('stops at 20 ticked: the rest are disabled and the limit is said', () => {
    const many = Array.from({ length: 22 }, (_, i) => campaign(i));
    const ticked = many.slice(0, 20).map((o) => ({ kind: o.kind, id: o.id }));
    const out = render({ sends: ticked, outcome: 'all' }, many);
    expect(out).toContain('20 of 20 chosen');
    expect(out).toContain('You can pick up to 20 sends');
    // the two un-ticked ones are off; the 20 ticked stay open so one can be un-ticked
    expect(out.match(/disabled=""/g)?.length).toBe(2);
  });

  it('shows how many are chosen below the limit', () => {
    const [b] = previousSends();
    const out = render({ sends: [{ kind: 'broadcast', id: b!.id }], outcome: 'all' });
    expect(out).toContain('1 of 20 chosen');
    expect(out).not.toContain('You can pick up to 20 sends');
  });
});
