import { describe, expect, it, vi } from 'vitest';
import { html } from './test-utils';
import { DesignedCanvas } from './designed-report';

// The real package pulls in a stylesheet that plain node cannot import; these tests need only its names.
vi.mock('@copilotkit/react-core/v2', () => ({
  OpenGenerativeUIActivityType: 'open-generative-ui',
  OpenGenerativeUIContentSchema: {},
  OpenGenerativeUIActivityRenderer: () => <div data-testid="sandbox-host" />,
}));

const done = {
  generating: false,
  htmlComplete: true,
  cssComplete: true,
  html: ['<head></head><body><h1>Q3</h1></body>'],
};

describe('DesignedCanvas', () => {
  it('offers Download HTML only once the page is finished, and says what is not available', () => {
    const writing = html(<DesignedCanvas id="m1" content={{ generating: true, html: ['<p>'] }} />);
    expect(writing).toMatch(/<button[^>]*disabled=""[^>]*>Download HTML/);
    expect(writing).toContain('The assistant is designing your report');

    const ready = html(<DesignedCanvas id="m1" content={done} />);
    expect(ready).not.toMatch(/<button[^>]*disabled=""[^>]*>Download HTML/);
    expect(ready).toContain('Download HTML');
    expect(ready).toContain('only available for structured reports');
  });

  it('does not offer the exports that only exist for a structured report', () => {
    const out = html(<DesignedCanvas id="m1" content={done} />);
    for (const label of ['Print / Save as PDF', 'Copy as Markdown', 'Download JSON'])
      expect(out).not.toContain(label);
  });

  it('draws the page on a white backing so a light page stays readable on a dark theme', () => {
    expect(html(<DesignedCanvas id="m1" content={done} />)).toContain('background:#fff');
  });
});
