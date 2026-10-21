// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useBulkSelection, type BulkSelection } from './use-bulk';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('@crm/ui', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('../components/parts', () => ({ useErrorText: () => (e: unknown) => String(e) }));
vi.mock('./service', () => ({ inboxApi: { bulk: vi.fn() } }));

const rows = ['a', 'b', 'c'].map((id) => ({ id }));

let root: Root;
let host: HTMLElement;
// Holds the result of the probe's latest render; the test creates it and the probe only hands values to it.
let latest: { value: BulkSelection | null };

function Probe(props: {
  rows: ReadonlyArray<{ id: string }>;
  onRender: (value: BulkSelection) => void;
}) {
  props.onRender(useBulkSelection(props.rows, 'view', vi.fn()));
  return null;
}

/** The hook result from the most recent render of the probe. */
function bulk(): BulkSelection {
  if (!latest.value) throw new Error('the probe has not rendered');
  return latest.value;
}

beforeEach(() => {
  latest = { value: null };
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() =>
    root.render(
      <Probe
        rows={rows}
        onRender={(value) => {
          latest.value = value;
        }}
      />,
    ),
  );
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('useBulkSelection toggleAll', () => {
  it('select all then select all again clears, and a Select-button mode stays on', () => {
    act(() => bulk().toggleSelecting());
    expect(bulk().selecting).toBe(true);

    act(() => bulk().toggleAll());
    expect([...bulk().selection].sort()).toEqual(['a', 'b', 'c']);
    expect(bulk().allInView).toBe(true);

    act(() => bulk().toggleAll());
    expect(bulk().selection.size).toBe(0);
    expect(bulk().selecting).toBe(true);
  });

  it('clearing a selection started by a row tick ends the select mode with it', () => {
    act(() => bulk().pick('a', false));
    expect(bulk().selecting).toBe(true);

    act(() => bulk().toggleAll());
    expect(bulk().allInView).toBe(true);
    expect(bulk().selecting).toBe(true);

    act(() => bulk().toggleAll());
    expect(bulk().selection.size).toBe(0);
    expect(bulk().selecting).toBe(false);
  });
});
