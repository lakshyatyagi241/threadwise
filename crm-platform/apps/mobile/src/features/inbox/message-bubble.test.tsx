import { fireEvent, screen } from '@testing-library/react-native';
import * as Linking from 'expo-linking';
import { initI18n } from '@/lib/i18n';
import { message, outgoing } from '@/test/inbox-fixtures';
import { renderApp } from '@/test/render';
import { MessageBubble } from './message-bubble';

jest.mock('@/lib/auth/session-manager', () => ({
  getAccessToken: jest.fn(() => Promise.resolve('tok')),
}));
jest.mock('expo-linking', () => ({ openURL: jest.fn() }));

const media = (over: Record<string, unknown> = {}) => ({
  url: '/api/v2/media/abc',
  mime: 'image/jpeg',
  sizeBytes: 2048,
  name: null,
  ...over,
});

beforeAll(async () => {
  await initI18n('en');
});
beforeEach(() => jest.clearAllMocks());

describe('MessageBubble: pictures and files', () => {
  it('draws a picture with the person’s token, from the address on the API', async () => {
    await renderApp(
      <MessageBubble message={message(1, { kind: 'image', body: 'Look', media: media() })} />,
    );
    const picture = await screen.findByTestId('message-picture');
    // A list of one source, so Android sends the header (a single object would lose it).
    expect(picture.props.source).toEqual([
      { uri: 'http://api.test/v2/media/abc', headers: { Authorization: 'Bearer tok' } },
    ]);
    expect(screen.getByText('Look')).toBeTruthy();
    // The picture is the message: the word "Photo" is only for a screen reader.
    expect(screen.queryByText('Photo')).toBeNull();
    expect(screen.getByLabelText(/^Received: Photo: Look/)).toBeTruthy();
  });

  it('draws a picture at its own proportions once it has said how big it is', async () => {
    await renderApp(
      <MessageBubble message={message(1, { kind: 'image', body: null, media: media() })} />,
    );
    const heightOf = async () => {
      const picture = await screen.findByTestId('message-picture');
      return [picture.props.style].flat().find((s) => s && 'height' in s)?.height;
    };
    // Until then: 4 by 3.
    expect(await heightOf()).toBe(180);
    const loaded = (width: number, height: number) =>
      fireEvent(screen.getByTestId('message-picture'), 'load', {
        nativeEvent: { source: { width, height } },
      });
    await loaded(600, 300);
    expect(await heightOf()).toBe(120);
    // A very tall photo is cut off at the limit, not stretched down the screen.
    await loaded(300, 1200);
    expect(await heightOf()).toBe(320);
    // A very wide one is not squashed flat.
    await loaded(2000, 100);
    expect(await heightOf()).toBe(120);
  });

  it('puts a tile with the word for it in place of a picture that cannot be loaded', async () => {
    await renderApp(
      <MessageBubble message={message(1, { kind: 'image', body: null, media: media() })} />,
    );
    await fireEvent(await screen.findByTestId('message-picture'), 'error');
    expect(await screen.findByText('Photo')).toBeTruthy();
    expect(screen.queryByTestId('message-picture')).toBeNull();
  });

  it('shows a document as a tile with its name and size', async () => {
    await renderApp(
      <MessageBubble
        message={outgoing(2, {
          kind: 'document',
          body: null,
          media: media({ mime: 'application/pdf', name: 'Brochure.pdf' }),
        })}
      />,
    );
    expect(screen.getByText('Brochure.pdf')).toBeTruthy();
    expect(screen.getByText('2 KB · application/pdf')).toBeTruthy();
  });

  it('says when a file is still coming, and when it could not be fetched', async () => {
    await renderApp(
      <>
        <MessageBubble message={message(1, { kind: 'image', body: null, mediaState: 'pending' })} />
        <MessageBubble message={message(2, { kind: 'image', body: null, mediaState: 'failed' })} />
      </>,
    );
    expect(screen.getByText('The file is still being downloaded.')).toBeTruthy();
    expect(screen.getByText("The file couldn't be downloaded.")).toBeTruthy();
  });

  it('shows a place and a shared contact', async () => {
    await renderApp(
      <>
        <MessageBubble
          message={message(1, {
            kind: 'location',
            body: null,
            location: { latitude: 18.5, longitude: 73.8, name: 'Head office', address: 'Pune' },
          })}
        />
        <MessageBubble
          message={message(2, {
            kind: 'contact',
            body: null,
            contacts: [{ name: 'Meera Iyer', phones: ['+919800000001'] }],
          })}
        />
      </>,
    );
    expect(screen.getByText('Head office')).toBeTruthy();
    expect(screen.getByText('Pune')).toBeTruthy();
    expect(screen.getByText('Meera Iyer')).toBeTruthy();
    expect(screen.getByText('+919800000001')).toBeTruthy();
  });

  it('writes only a note for a deleted message, not its picture', async () => {
    await renderApp(
      <MessageBubble
        message={message(1, {
          kind: 'image',
          body: 'x',
          media: media(),
          deletedAt: '2026-10-12T10:00:00.000Z',
        })}
      />,
    );
    expect(screen.queryByTestId('message-picture')).toBeNull();
    expect(screen.getByText('This message was deleted')).toBeTruthy();
  });
});

describe('MessageBubble: templates and buttons', () => {
  const template = (preview: unknown) => ({
    templateId: null,
    name: 'loan_offer',
    language: 'en',
    variables: {},
    preview,
  });

  it('draws a template as the customer sees it: header, words, footer and buttons', async () => {
    await renderApp(
      <MessageBubble
        message={outgoing(1, {
          kind: 'template',
          body: 'Hello 34567, your offer is ready.',
          template: template({
            header: { format: 'image', text: null },
            footer: 'Geta.ai',
            buttons: [
              { type: 'url', text: 'Check Details' },
              { type: 'quick_reply', text: 'Not Interested' },
            ],
          }) as never,
        })}
      />,
    );
    expect(screen.getByText('Hello 34567, your offer is ready.')).toBeTruthy();
    expect(screen.getByText('Photo')).toBeTruthy();
    expect(screen.getByText('Geta.ai')).toBeTruthy();
    expect(screen.getByLabelText('Check Details')).toBeTruthy();
    expect(screen.getByLabelText('Not Interested')).toBeTruthy();
    // It is drawn for real, so it is not also labelled "Template".
    expect(screen.queryByText('Template')).toBeNull();
  });

  it('writes the header of a template when it is text', async () => {
    await renderApp(
      <MessageBubble
        message={outgoing(1, {
          kind: 'template',
          body: 'Body',
          template: template({
            header: { format: 'text', text: 'Big sale' },
            footer: null,
            buttons: [],
          }) as never,
        })}
      />,
    );
    expect(screen.getByText('Big sale')).toBeTruthy();
  });

  it('opens a web link button the agent sent, and never another kind of address', async () => {
    await renderApp(
      <MessageBubble
        message={outgoing(1, {
          kind: 'interactive',
          body: 'Pick one',
          sentInteractive: {
            type: 'cta_url',
            header: null,
            body: 'Pick one',
            footer: 'Thanks',
            buttons: [
              { title: 'Open site', url: 'https://example.test/offer' },
              { title: 'Bad link', url: 'javascript:alert(1)' },
              { title: 'Yes', url: null },
            ],
          },
        })}
      />,
    );
    expect(screen.getByText('Thanks')).toBeTruthy();
    await fireEvent.press(screen.getByRole('link', { name: 'Open site' }));
    expect(Linking.openURL).toHaveBeenCalledWith('https://example.test/offer');
    expect(screen.queryByRole('link', { name: 'Bad link' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Yes' })).toBeNull();
    expect(screen.getByLabelText('Bad link')).toBeTruthy();
  });

  it('still names the kind of a template whose design is no longer stored', async () => {
    await renderApp(
      <MessageBubble message={message(1, { kind: 'template', body: 'Order shipped' })} />,
    );
    expect(screen.getByText('Template')).toBeTruthy();
    expect(screen.getByText('Order shipped')).toBeTruthy();
  });
});
