import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider } from 'next-intl';
import { ContactCards } from './message-extras';

const messages = {
  'channel-whatsapp-cloud': { inbox: { contact: { unnamed: 'Unnamed', shared: 'Shared' } } },
};

const html = (el: React.ReactElement) =>
  renderToStaticMarkup(
    <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
      {el}
    </NextIntlClientProvider>,
  );

describe('ContactCards', () => {
  it('dials a shared number when it is a number', () => {
    const out = html(
      <ContactCards
        kind="contact"
        body={null}
        contacts={[{ name: 'Asha', phones: ['+919560644394'] }]}
      />,
    );
    expect(out).toContain('href="tel:+919560644394"');
    expect(out).toContain('data-testid="inbox-contact-phone"');
  });

  it('keeps a value that is not a number as text', () => {
    const out = html(
      <ContactCards
        kind="contact"
        body={null}
        contacts={[{ name: 'Asha', phones: ['tel:x; drop'] }]}
      />,
    );
    expect(out).not.toContain('href=');
    expect(out).toContain('tel:x; drop');
  });
});
