import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/** Wiring that needs a running agent to exercise: guarded at the source. */
const src = readFileSync(join(__dirname, 'components/report-workbench.tsx'), 'utf8');

describe('Refresh data', () => {
  it('asks the assistant the original question again through the agent, so documents and live numbers are read afresh', () => {
    expect(src).toContain(
      "agent.addMessage({ id: crypto.randomUUID(), role: 'user', content: prompt })",
    );
    expect(src).toContain('copilotkit.runAgent({ agent })');
    expect(src).toContain('onRefresh={refresh}');
  });
  it('remembers the question and the time with each report', () => {
    expect(src).toContain('prompt: ctx.prompt');
    expect(src).toContain('generatedAt: Date.now()');
    expect(src).toContain('documents: readyDocsRef.current');
  });
});

describe('the default presentation', () => {
  it('registers the report blocks as tools and keeps render_report and the sandboxed page available', () => {
    expect(src).toContain('useBlockTools(');
    expect(src).toContain('name: RENDER_REPORT_ACTION');
    expect(src).toContain('renderActivityMessages={DESIGNED_RENDERERS}');
  });
});
