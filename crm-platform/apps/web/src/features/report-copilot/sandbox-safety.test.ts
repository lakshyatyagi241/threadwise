import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { DESIGNED_RENDERERS } from './components/designed-report';

// The real package pulls in a stylesheet that plain node cannot import; these tests need only its names.
vi.mock('@copilotkit/react-core/v2', () => ({
  OpenGenerativeUIActivityType: 'open-generative-ui',
  OpenGenerativeUIContentSchema: {},
  OpenGenerativeUIActivityRenderer: () => null,
}));

/**
 * The designed report is the model's own HTML and JavaScript. It is safe only because CopilotKit runs it in an iframe with
 * `sandbox="allow-scripts"` and nothing else. These tests read the installed packages, so a dependency update that loosens the sandbox
 * fails here instead of in production.
 */
const require = createRequire(import.meta.url);
const reactCore = dirname(require.resolve('@copilotkit/react-core'));
const websandboxEntry = createRequire(require.resolve('@copilotkit/react-core')).resolve(
  '@jetbrains/websandbox',
);

describe('the sandbox the designed report runs in', () => {
  const source = readFileSync(websandboxEntry, 'utf8');

  it('sets the iframe sandbox to allow-scripts only: no same-origin, forms, popups, modals or top navigation', () => {
    expect(source).toMatch(/\.sandbox\s*=\s*`allow-scripts \$\{/);
    expect(source).not.toMatch(/allow-same-origin/);
    expect(source).not.toMatch(
      /allow-(forms|popups|modals|top-navigation|downloads|storage-access)/,
    );
  });

  it("is never given extra sandbox flags or permissions by CopilotKit's renderer", () => {
    const chunk = readdirSync(reactCore)
      .filter((f) => f.endsWith('.mjs'))
      .map((f) => readFileSync(join(reactCore, f), 'utf8'))
      .find((s) => s.includes('OpenGenerativeUIActivityRendererInner'));
    expect(chunk).toBeTruthy();
    expect(chunk).not.toContain('sandboxAdditionalAttributes');
    expect(chunk).toContain('allowAdditionalAttributes: ""');
  });

  it('serves the page through an inline document (srcdoc) with a null origin, trusting only messages from its own frame', () => {
    expect(source).toContain("setAttribute('srcdoc'");
    expect(source).toContain("allowedSenderOrigin: 'null'");
    expect(source).toMatch(/event\.source !== this\.iframe\.contentWindow/);
  });
});

describe('what the page hands the sandbox', () => {
  it('registers no sandbox function, so the page has nothing of the app to call', () => {
    const src = readFileSync(join(__dirname, 'components/report-workbench.tsx'), 'utf8');
    expect(src).toContain('openGenerativeUI={OPEN_GENERATIVE_UI}');
    expect(src).not.toMatch(/sandboxFunctions\s*:/);
    expect(src).not.toMatch(/useSandboxFunctions/);
  });

  it('takes over the activity type so the page is drawn once, in the Report panel', () => {
    expect(DESIGNED_RENDERERS.map((r) => r.activityType)).toEqual(['open-generative-ui']);
  });
});
