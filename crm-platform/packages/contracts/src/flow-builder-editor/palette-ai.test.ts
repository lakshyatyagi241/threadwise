import { describe, expect, it } from 'vitest';
import { FLB_NODE_TYPE_LIST, flbPaletteFor } from './node-catalogue';

describe('the AI steps in the palette', () => {
  it('offers one AI-agent step: the AI assistant, not the old Chatbot hand-over', () => {
    const offered = flbPaletteFor('chat').map((d) => d.id);
    expect(offered).toContain('ai');
    expect(offered).not.toContain('chatbot');
  });

  it('still knows the Chatbot step, so a flow that already has one opens and runs', () => {
    expect(FLB_NODE_TYPE_LIST.find((d) => d.id === 'chatbot')?.hidden).toBe(true);
  });
});
