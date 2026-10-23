import { describe, expect, it, vi } from 'vitest';
import { renderIntl } from '../test-utils/intl';
import { emptyDoc, insertStep, newStep, updateStep } from '../lib/simple-model';
import { FaqsPanel, flowAgentIds } from './faqs-panel';

// The agent's entries come from the AI Training screen's own component; this file tests what the flow adds around it.
vi.mock('@/features/ai-agents-training/components/knowledge-step', () => ({
  KnowledgeStep: ({ assistantId, compact }: { assistantId: string; compact?: boolean }) => (
    <div data-testid="knowledge" data-agent={assistantId} data-compact={String(!!compact)} />
  ),
}));

const agents = [
  { id: 'a1', name: 'Support bot', sources: 3, status: null },
  { id: 'a2', name: 'Sales bot', sources: 0, status: null },
];

describe('flowAgentIds', () => {
  it('lists the agents of the AI and FAQ steps once each, in step order', () => {
    let d = emptyDoc();
    const s1 = newStep('ai', []);
    const s2 = newStep('faq', [s1]);
    const s3 = newStep('ai', [s1, s2]);
    d = insertStep(d, 0, 0, s1);
    d = insertStep(d, 0, 1, s2);
    d = insertStep(d, 0, 2, s3);
    d = updateStep(d, s1.id, { data: { assistant: 'a2' } });
    d = updateStep(d, s2.id, { data: { assistant: 'a1' } });
    d = updateStep(d, s3.id, { data: { assistant: 'a2' } });
    expect(flowAgentIds(d)).toEqual(['a2', 'a1']);
  });

  it('is empty when no step has an agent', () => {
    let d = emptyDoc();
    d = insertStep(d, 0, 0, newStep('ai', []));
    expect(flowAgentIds(d)).toEqual([]);
  });
});

describe('FaqsPanel', () => {
  it('says where to pick an agent when the flow has none', () => {
    const html = renderIntl(<FaqsPanel agentIds={[]} assistants={agents} canEdit />);
    expect(html).toContain('does not use an AI agent yet');
    expect(html).not.toContain('data-testid="knowledge"');
  });

  it('shows the one agent by name with its entries, without the AI Training step header', () => {
    const html = renderIntl(<FaqsPanel agentIds={['a1']} assistants={agents} canEdit />);
    expect(html).toContain('Support bot');
    expect(html).toContain('data-agent="a1"');
    expect(html).toContain('data-compact="true"');
    expect(html).toContain('href="/ai-training/a1/edit"');
    expect(html).not.toContain('<select');
  });

  it('lets a flow with several agents choose which one to look at, the first by default', () => {
    const html = renderIntl(<FaqsPanel agentIds={['a2', 'a1']} assistants={agents} canEdit />);
    expect(html).toContain('<select');
    expect(html).toContain('data-agent="a2"');
  });
});
