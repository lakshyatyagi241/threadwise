import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { HelpProvider, useHelpEntries, useHelpEntry } from './context';
import type { HelpIndexEntry } from './types';

const entry = (id: string): HelpIndexEntry => ({
  id,
  area: 'sales',
  order: 1,
  title: `Title ${id}`,
  summary: `Summary ${id}`,
  keywords: [],
  routes: [],
  headings: [],
  readMinutes: 1,
  fallback: false,
});

function Probe({ id }: { id: string }) {
  const found = useHelpEntry(id);
  return <span>{found ? found.title : 'none'}</span>;
}
function Count() {
  return <span>{useHelpEntries().length}</span>;
}

describe('HelpProvider', () => {
  it('hands the visible entries to useHelpEntry and useHelpEntries', () => {
    const html = renderToString(
      <HelpProvider entries={[entry('e1'), entry('e2')]}>
        <Probe id="e1" />
        <Probe id="missing" />
        <Count />
      </HelpProvider>,
    );
    expect(html).toContain('Title e1');
    expect(html).toContain('none');
    expect(html).toContain('<span>2</span>');
  });

  it('is empty outside a provider', () => {
    const html = renderToString(
      <>
        <Count />
        <Probe id="e1" />
      </>,
    );
    expect(html).toContain('<span>0</span>');
    expect(html).toContain('none');
  });
});
