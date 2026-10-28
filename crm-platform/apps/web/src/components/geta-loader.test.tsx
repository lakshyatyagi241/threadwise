import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { GetaLoader } from '@crm/ui';

describe('GetaLoader', () => {
  it('is a labelled status with a ring and the logo', () => {
    const html = renderToStaticMarkup(
      <GetaLoader logoSrc="/images/geta-logo.png" label="Loading" />,
    );
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-label="Loading"');
    expect(html).toContain('geta-loader-ring');
    expect(html).toContain('src="/images/geta-logo.png"');
  });

  it('shows only the ring without a logo, and sizes the ring from the logo', () => {
    const html = renderToStaticMarkup(<GetaLoader logoSize={40} />);
    expect(html).not.toContain('<img');
    expect(html).toContain('width:74px');
  });

  it('stops the animation for people who ask for reduced motion', () => {
    expect(renderToStaticMarkup(<GetaLoader />)).toContain('prefers-reduced-motion: reduce');
  });
});
