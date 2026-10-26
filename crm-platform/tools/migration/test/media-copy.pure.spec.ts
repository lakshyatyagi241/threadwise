import { describe, expect, it } from 'vitest';
import { mediaAsCopied } from '../reconcile/media-copy';

describe('flow media links after the file copy', () => {
  const expected = {
    flowNodes: [
      { id: 'n1', data: { url: 'https://assets.getalabs.com/org/3d6ed3_pic.jpeg', text: 'hi' } },
      { id: 'n2', data: { url: 'https://assets.getalabs.com/org/other.png' } },
    ],
  };

  it('counts a copied link as the Waboo link of the same file name', () => {
    const got = {
      flowNodes: [
        {
          id: 'n1',
          data: { url: 'https://pub-x.r2.dev/flow-media/90/waboo/abc/3d6ed3_pic.jpeg', text: 'hi' },
        },
        { id: 'n2', data: { url: 'https://assets.getalabs.com/org/other.png' } },
      ],
    };
    expect(mediaAsCopied(expected, got)).toEqual({
      flowNodes: [
        { id: 'n1', data: { url: 'https://assets.getalabs.com/org/3d6ed3_pic.jpeg', text: 'hi' } },
        { id: 'n2', data: { url: 'https://assets.getalabs.com/org/other.png' } },
      ],
    });
  });

  it('leaves a link alone when the file name is not the expected one', () => {
    const got = {
      flowNodes: [
        { id: 'n1', data: { url: 'https://pub-x.r2.dev/flow-media/90/waboo/abc/else.jpeg' } },
      ],
    };
    expect(mediaAsCopied(expected, got)).toEqual(got);
  });

  it('leaves text and non-media values exactly as they are', () => {
    const got = { flowNodes: [{ id: 'n1', data: { url: 'https://other.example/x', text: 'hi' } }] };
    expect(mediaAsCopied(expected, got)).toEqual(got);
  });
});
