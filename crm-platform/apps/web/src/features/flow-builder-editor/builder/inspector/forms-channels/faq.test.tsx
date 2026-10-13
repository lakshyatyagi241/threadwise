// @vitest-environment jsdom
import { useState } from 'react';
import { act } from 'react';
import { NextIntlClientProvider } from 'next-intl';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { faqNodeDataSchema, flbDefaultNodeData, flbValidateGraph } from '@crm/contracts';
import { enMessages } from '../../../test-utils/intl';
import { EMPTY_CONTEXT } from '../../../api/hooks';
import { NODE_FORMS } from '../registry';
import type { FormProps } from '../types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const faq = vi.hoisted(() => ({
  flowIds: [] as Array<string | null>,
  flowId: 'f1' as string | null,
  state: {
    isPending: false,
    isError: false,
    isSuccess: true,
    data: { categories: [] as string[], total: 0 },
    refetch: () => undefined as unknown,
  },
}));
vi.mock('../../../api/hooks', async (orig) => ({
  ...(await orig<typeof import('../../../api/hooks')>()),
  useFaqSummary: (flowId: string | null) => {
    faq.flowIds.push(flowId);
    return flowId === null ? { ...faq.state, isPending: false } : faq.state;
  },
}));
// The text field offers the workspace's merge tags: no request is made in a unit test.
vi.mock('@/features/contacts-attributes-tags', () => ({
  usePickerFeed: () => ({ data: undefined }),
}));

const writes: Array<[string, unknown]> = [];
let host: HTMLDivElement;
let root: Root;

function Harness({ initial }: { initial: Record<string, unknown> }) {
  const [data, setData] = useState(initial);
  const Form = NODE_FORMS.faq!;
  const props: FormProps = {
    node: { id: 'n1', type: 'faq', x: 0, y: 0, data } as never,
    data,
    set: (key, value) => {
      writes.push([key, value]);
      setData((d) => ({ ...d, [key]: value }));
    },
    setMany: () => undefined,
    addOption: () => undefined,
    removeOption: () => undefined,
    env: {
      ctx: EMPTY_CONTEXT,
      loading: false,
      mode: 'chat',
      openedAs: 'chat',
      channels: ['chat'],
      refresh: () => undefined,
      toast: () => undefined,
      uploadMedia: async () => ({ url: '', filename: '' }),
      nodes: [],
      flowId: faq.flowId,
    },
  };
  return <>{Form(props)}</>;
}

async function mount(data: Record<string, unknown> = flbDefaultNodeData('faq')) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" timeZone="UTC" messages={enMessages as never}>
        <Harness initial={data} />
      </NextIntlClientProvider>,
    );
  });
}

const setValue = (el: HTMLInputElement | HTMLSelectElement, value: string) =>
  act(async () => {
    const proto = el instanceof HTMLSelectElement ? HTMLSelectElement : HTMLInputElement;
    Object.getOwnPropertyDescriptor(proto.prototype, 'value')!.set!.call(el, value);
    el.dispatchEvent(
      new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }),
    );
  });
const click = (el: Element) => act(async () => void (el as HTMLElement).click());
const checkbox = (label: string) =>
  [...host.querySelectorAll('label')]
    .find((l) => l.textContent?.includes(label))!
    .querySelector('input') as HTMLInputElement;
const field = (label: string) =>
  [...host.querySelectorAll('label')]
    .find((l) => l.textContent === label)!
    .parentElement!.querySelector('input,select') as HTMLInputElement & HTMLSelectElement;

beforeEach(() => {
  writes.length = 0;
  faq.flowIds.length = 0;
  faq.flowId = 'f1';
  faq.state = {
    isPending: false,
    isError: false,
    isSuccess: true,
    data: { categories: ['Billing', 'Shipping'], total: 12 },
    refetch: () => undefined,
  };
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

describe('Answer from FAQ form', () => {
  it('reads and links the FAQs of the flow the node sits in', async () => {
    await mount();
    expect(faq.flowIds.every((id) => id === 'f1')).toBe(true);
    expect(host.querySelector('a[href="/flows/simple/f1?tab=faqs"]')?.textContent).toBe(
      "Manage this flow's FAQs",
    );
    expect(host.textContent).toContain("categories come from this flow's FAQs");
  });

  it('before the first save there are no FAQs to read: it says so and links nowhere', async () => {
    faq.flowId = null;
    await mount();
    expect(faq.flowIds.every((id) => id === null)).toBe(true);
    expect(host.textContent).toContain('Save the flow first.');
    expect(host.querySelector('a[href*="tab=faqs"]')).toBeNull();
    expect(host.textContent).toContain("Manage this flow's FAQs");
    expect(host.textContent).not.toContain('Loading categories');
  });

  it('is registered, and its defaults are the data the contract expects', () => {
    expect(NODE_FORMS.faq).toBeDefined();
    expect(flbDefaultNodeData('faq')).toEqual({
      query: '{{user_message}}',
      category: '',
      minScore: null,
      sendAnswer: true,
      save: 'faq',
    });
    expect(faqNodeDataSchema.safeParse(flbDefaultNodeData('faq')).success).toBe(true);
  });

  it('shows the defaults and both exits', async () => {
    await mount();
    expect(field('Message to match').value).toBe('{{user_message}}');
    expect(field('Only these FAQs').value).toBe('');
    expect(host.textContent).toContain('All FAQs');
    expect(checkbox("Use this flow's setting").checked).toBe(true);
    expect(host.querySelector('input[type="number"]')).toBeNull();
    expect(checkbox('Send a matching text answer').checked).toBe(true);
    expect(field('Save the result as').value).toBe('faq');
    const exits = host.querySelector('ul[aria-label="Exits"]')!.textContent!;
    expect(exits).toContain('Answered');
    expect(exits).toContain('No match');
    // The variables the node creates, under the name it saves as.
    for (const v of ['answer', 'matched', 'question', 'score', 'id'])
      expect(host.textContent).toContain(`{{faq.${v}}}`);
  });

  it('writes the message to match, the save name and keeps the preview in step with it', async () => {
    await mount();
    await setValue(field('Message to match'), '{{answer}}');
    await setValue(field('Save the result as'), 'kb');
    expect(writes).toContainEqual(['query', '{{answer}}']);
    expect(writes).toContainEqual(['save', 'kb']);
    expect(host.textContent).toContain('{{kb.answer}}');
    expect(host.textContent).not.toContain('{{faq.answer}}');
  });

  it('a blank save name still previews the default one the runtime uses', async () => {
    await mount({ ...flbDefaultNodeData('faq'), save: '' });
    expect(host.textContent).toContain('{{faq.answer}}');
  });

  describe('categories', () => {
    it('lists the workspace categories and writes the one picked', async () => {
      await mount();
      const select = field('Only these FAQs');
      expect([...select.options].map((o) => o.textContent)).toEqual([
        'All FAQs',
        'Billing',
        'Shipping',
      ]);
      await setValue(select, 'Shipping');
      expect(writes).toContainEqual(['category', 'Shipping']);
      await setValue(field('Only these FAQs'), '');
      expect(writes).toContainEqual(['category', '']);
    });

    it('keeps a saved category that no FAQ uses any more, labelled', async () => {
      await mount({ ...flbDefaultNodeData('faq'), category: 'Old' });
      const select = field('Only these FAQs');
      expect(select.value).toBe('Old');
      expect([...select.options].map((o) => o.textContent)).toContain('Old (no FAQ uses it)');
    });

    it('says it is loading, without calling the saved category gone', async () => {
      faq.state = { ...faq.state, isPending: true, isSuccess: false, data: undefined as never };
      await mount({ ...flbDefaultNodeData('faq'), category: 'Old' });
      const labels = [...field('Only these FAQs').options].map((o) => o.textContent);
      expect(labels).toContain('Loading categories…');
      expect(labels).toContain('Old');
      expect(labels.join()).not.toContain('no FAQ uses it');
    });

    it('says the categories could not be loaded and retries', async () => {
      const refetch = vi.fn();
      faq.state = {
        ...faq.state,
        isError: true,
        isSuccess: false,
        data: undefined as never,
        refetch,
      };
      await mount();
      expect(host.textContent).toContain("This flow's FAQ categories could not be loaded.");
      await click([...host.querySelectorAll('button')].find((b) => b.textContent === 'Try again')!);
      expect(refetch).toHaveBeenCalledTimes(1);
      // The rest of the form still works.
      await setValue(field('Message to match'), 'x');
      expect(writes).toContainEqual(['query', 'x']);
    });
  });

  describe('minimum score', () => {
    it('turning the workspace setting off starts a score the author can edit', async () => {
      await mount();
      await click(checkbox("Use this flow's setting"));
      expect(writes).toContainEqual(['minScore', 0.5]);
      const input = host.querySelector('input[type="number"]') as HTMLInputElement;
      expect(input.min).toBe('0.05');
      expect(input.max).toBe('0.99');
      expect(input.value).toBe('0.5');
      await setValue(input, '0.72');
      expect(writes.at(-1)).toEqual(['minScore', 0.72]);
      expect(host.querySelector('[role="alert"]')).toBeNull();
    });

    it('turning it back on writes null again', async () => {
      await mount({ ...flbDefaultNodeData('faq'), minScore: 0.6 });
      expect(checkbox("Use this flow's setting").checked).toBe(false);
      await click(checkbox("Use this flow's setting"));
      expect(writes.at(-1)).toEqual(['minScore', null]);
      expect(host.querySelector('input[type="number"]')).toBeNull();
    });

    it.each([0.04, 1, 7])('flags %s as outside 0.05 to 0.99 inline', async (value) => {
      await mount({ ...flbDefaultNodeData('faq'), minScore: value });
      const alert = host.querySelector('[role="alert"]')!;
      expect(alert.textContent).toBe(
        "Enter a number from 0.05 to 0.99, or use this flow's setting.",
      );
      expect(host.querySelector('input[type="number"]')!.getAttribute('aria-invalid')).toBe('true');
    });

    it.each([0.05, 0.5, 0.99])('accepts %s', async (value) => {
      await mount({ ...flbDefaultNodeData('faq'), minScore: value });
      expect(host.querySelector('[role="alert"]')).toBeNull();
    });

    it('an emptied box keeps its place and writes a blank, which uses the workspace score', async () => {
      await mount({ ...flbDefaultNodeData('faq'), minScore: 0.6 });
      await setValue(host.querySelector('input[type="number"]') as HTMLInputElement, '');
      expect(writes.at(-1)).toEqual(['minScore', '']);
      expect(host.querySelector('input[type="number"]')).not.toBeNull();
      expect(host.querySelector('[role="alert"]')).toBeNull();
    });

    it('points at the FAQ test page and says scores depend on the embedding model', async () => {
      await mount();
      expect(host.querySelector('a[href="/flows/simple/f1?tab=faqs&view=test"]')).not.toBeNull();
      expect(host.textContent).toContain("platform's embedding model");
    });
  });

  it('the send toggle writes sendAnswer and explains what off means', async () => {
    await mount();
    expect(host.textContent).toContain('A matching text FAQ is sent to the customer.');
    await click(checkbox('Send a matching text answer'));
    expect(writes.at(-1)).toEqual(['sendAnswer', false]);
    expect(host.textContent).toContain('only saved in the variables below');
    await click(checkbox('Send a matching text answer'));
    expect(writes.at(-1)).toEqual(['sendAnswer', true]);
  });

  it('an old node without sendAnswer sends, like the runtime', async () => {
    await mount({ query: '{{user_message}}' });
    expect(checkbox('Send a matching text answer').checked).toBe(true);
  });

  describe('flow with no FAQs yet', () => {
    it('shows a hint with a link to add one, and the form stays usable', async () => {
      faq.state = { ...faq.state, data: { categories: [], total: 0 } };
      await mount();
      const hint = host.querySelector('a[href="/flows/simple/f1?tab=faqs&view=new"]')!;
      expect(hint.textContent).toBe('Add the first FAQ of this flow');
      expect(host.textContent).toContain('always leaves by no match');
      await setValue(field('Message to match'), 'hi');
      expect(writes).toContainEqual(['query', 'hi']);
    });

    it('shows no hint when there are FAQs, while loading, or when the list failed', async () => {
      await mount();
      expect(host.querySelector('a[href="/flows/simple/f1?tab=faqs&view=new"]')).toBeNull();
      faq.state = { ...faq.state, isPending: true, isSuccess: false, data: undefined as never };
      await mount();
      expect(host.querySelector('a[href="/flows/simple/f1?tab=faqs&view=new"]')).toBeNull();
      faq.state = { ...faq.state, isPending: false, isError: true, data: undefined as never };
      await mount();
      expect(host.querySelector('a[href="/flows/simple/f1?tab=faqs&view=new"]')).toBeNull();
    });
  });
});

describe('graph validation of the node', () => {
  const check = (data: Record<string, unknown>) =>
    JSON.stringify(
      flbValidateGraph([{ id: 'n1', type: 'faq', x: 0, y: 0, data }] as never, [], {
        senderAvailable: true,
        mode: 'chat',
      } as never),
    );

  it('blocks a minimum score outside 0.05 to 0.99 and lets a blank or valid one through', () => {
    expect(check({ minScore: 1.5 })).toContain('minimum score outside 0.05 to 0.99');
    expect(check({ minScore: 0.01 })).toContain('minimum score outside 0.05 to 0.99');
    expect(check({ minScore: 0.5 })).not.toContain('minimum score');
    expect(check({ minScore: null })).not.toContain('minimum score');
    expect(check({ minScore: '' })).not.toContain('minimum score');
  });
});
