import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { GetaLoader } from '@crm/ui';

describe('GetaLoader', () => {
  it('is a labelled status with the canvas of arcs and the logo', () => {
    const html = renderToStaticMarkup(
      <GetaLoader logoSrc="/images/geta-logo.png" label="Loading" />,
    );
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-label="Loading"');
    expect(html).toContain('<canvas');
    expect(html).toContain('src="/images/geta-logo.png"');
  });

  it('shows only the arcs without a logo', () => {
    expect(renderToStaticMarkup(<GetaLoader />)).not.toContain('<img');
  });

  it('is sized by `size`, with the logo a third of it unless told otherwise', () => {
    const html = renderToStaticMarkup(<GetaLoader size={120} logoSrc="/l.png" />);
    expect(html).toContain('width:120px');
    expect(html).toContain('width="40"');
    expect(
      renderToStaticMarkup(<GetaLoader size={120} logoSize={50} logoSrc="/l.png" />),
    ).toContain('width="50"');
  });
});
