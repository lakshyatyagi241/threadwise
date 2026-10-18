import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PersonaProvider, usePersonaVisibility } from './persona-provider';
import { denyList, genericView, viewFrom } from './testing';

type View = Parameters<typeof PersonaProvider>[0]['view'];

/** Renders a probe under the provider (or none) and reads back what the hook answered for a few ids. */
function probe(view: View | 'no-provider') {
  function Probe() {
    const p = usePersonaVisibility();
    return (
      <output
        data-key={p.key ?? ''}
        data-section-meetings={String(p.isSectionHidden('meetings'))}
        data-section-deals={String(p.isSectionHidden('deals'))}
        data-card-flows={String(p.isCardHidden('flows'))}
        data-nav-deals={String(p.isHidden('nav:deals'))}
      />
    );
  }
  const html = renderToStaticMarkup(
    view === 'no-provider' ? (
      <Probe />
    ) : (
      <PersonaProvider view={view}>
        <Probe />
      </PersonaProvider>
    ),
  );
  const attr = (name: string) => new RegExp(`data-${name}="([^"]*)"`).exec(html)?.[1];
  return {
    key: attr('key'),
    meetings: attr('section-meetings'),
    deals: attr('section-deals'),
    flows: attr('card-flows'),
    navDeals: attr('nav-deals'),
  };
}

describe('usePersonaVisibility', () => {
  it('hides nothing without a provider', () => {
    expect(probe('no-provider')).toEqual({
      key: '',
      meetings: 'false',
      deals: 'false',
      flows: 'false',
      navDeals: 'false',
    });
  });

  it('hides nothing when the session carried no persona', () => {
    expect(probe(null).meetings).toBe('false');
    expect(probe(undefined).navDeals).toBe('false');
  });

  it('hides nothing for the generic persona', () => {
    expect(probe(genericView())).toEqual({
      key: 'generic',
      meetings: 'false',
      deals: 'false',
      flows: 'false',
      navDeals: 'false',
    });
  });

  it('hides what a test persona hides, and only that', () => {
    const view = viewFrom({
      definition: denyList(['section:contact.meetings', 'card:dashboard.flows']),
    });
    expect(probe(view)).toEqual({
      key: 'test',
      meetings: 'true',
      deals: 'false',
      flows: 'true',
      navDeals: 'false',
    });
  });
});
