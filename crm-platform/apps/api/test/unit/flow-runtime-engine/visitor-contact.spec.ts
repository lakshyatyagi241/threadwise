import { describe, expect, it, vi } from 'vitest';
import { compileGraph } from '../../../src/modules/flow-runtime-engine/graph/compile-graph';
import {
  applyCustomReply,
  executeCurrent,
  type StepDeps,
  type StepOutcome,
} from '../../../src/modules/flow-runtime-engine/runtime/engine-core';
import { AskInputNode } from '../../../src/modules/flow-runtime-engine/runtime/nodes/actions/ask-input-node';
import {
  decodeInbound,
  type InboundInput,
} from '../../../src/modules/flow-runtime-engine/runtime/reply-router';
import type {
  InboundReply,
  OutboundMessage,
  RunState,
} from '../../../src/modules/flow-runtime-engine/runtime/types';
import {
  renderForChannel,
  profileOf,
} from '../../../src/modules/flow-runtime-engine/runtime/channel-render';
import { interpolate } from '../../../src/modules/flow-runtime-engine/runtime/variables';

/** A website chat visitor is made a contact only when they give an email or a phone inside the flow, not by trying the bot out. */

const graph = compileGraph({
  flowNodes: [
    { id: 't', type: 'trigger', isStart: true, data: {} },
    {
      id: 'a',
      type: 'ask',
      data: {
        prompt: 'Your email?',
        var: 'email',
        validate: 'email',
        saveProperty: true,
        propertyKey: 'email',
      },
    },
    { id: 'next', type: 'message', data: { text: 'thanks' } },
  ],
  flowEdges: [
    { source: 't', target: 'a' },
    { source: 'a', sourceHandle: 'out', target: 'next' },
  ],
});

function runOf(graph: ReturnType<typeof builder>, over: Partial<RunState> = {}): RunState {
  return {
    id: 1,
    uuid: 'run-uuid',
    orgId: 1,
    flowId: 1,
    subscriberId: null,
    contactId: null,
    channelId: 1,
    channelUuid: 'c',
    channelKind: 'webchat',
    contactUuid: null,
    peerKey: 'visitor-1',
    conversationId: 77,
    source: 'keyword',
    triggerText: null,
    status: 'running',
    graph,
    graphVersionId: null,
    nodeCount: 0,
    currentNodeId: 'a',
    stepSeq: 3,
    vars: {},
    visits: {},
    wait: null,
    menus: { latest: null, byNode: {} },
    lastOut: null,
    timeoutSeconds: 600,
    cooldownSeconds: 0,
    haltReason: null,
    startedAt: new Date(0),
    expiresAt: null,
    maxExpiresAt: new Date(1e13),
    resumeAt: null,
    ...over,
  };
}

function setup(channelKind = 'webchat', contactId: number | null = null) {
  const contacts = {
    setPropertyFromFlow: vi.fn(async () => true),
    ensureChannelContact: vi.fn(async () => 42),
  };
  const node = new AskInputNode(
    contacts as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  const sent: OutboundMessage[] = [];
  const deps: StepDeps = {
    send: async (_r, m) => {
      sent.push(m);
      return { ok: true };
    },
    paceMs: () => 0,
    now: () => new Date(0),
    executors: [node],
  };
  const run = runOf(graph, { channelKind, contactId });
  return { run, deps, contacts };
}

async function ask(h: ReturnType<typeof setup>, text: string) {
  const first = await executeCurrent(h.run, h.deps);
  if (first.transition.t === 'wait') {
    h.run.wait = first.transition.wait;
    h.run.status = 'waiting';
  }
  return applyCustomReply(h.run, decodeInbound({ kind: 'text', body: text })!, h.deps);
}

describe('the contact of a website chat visitor', () => {
  it('is made when they answer an email question, and the answer is saved on it', async () => {
    const h = setup();
    await ask(h, 'sam@example.com');
    expect(h.contacts.ensureChannelContact).toHaveBeenCalledWith(1, {
      channel: 'chatbot_widget',
      peerKey: 'visitor-1',
      conversationId: 77,
      email: 'sam@example.com',
    });
    expect(h.contacts.setPropertyFromFlow).toHaveBeenCalledWith(1, 42, 'email', 'sam@example.com');
  });

  it('is not made for a wrong answer, a contact that exists, or another channel', async () => {
    const wrong = setup();
    await ask(wrong, 'not an email');
    expect(wrong.contacts.ensureChannelContact).not.toHaveBeenCalled();
    const known = setup('webchat', 5);
    await ask(known, 'sam@example.com');
    expect(known.contacts.ensureChannelContact).not.toHaveBeenCalled();
    const whatsapp = setup('whatsapp_cloud');
    await ask(whatsapp, 'sam@example.com');
    expect(whatsapp.contacts.ensureChannelContact).not.toHaveBeenCalled();
  });
});
