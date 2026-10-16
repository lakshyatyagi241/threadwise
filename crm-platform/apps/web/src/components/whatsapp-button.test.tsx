import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { BubbleButton, BubbleButtonList } from './whatsapp-button';

const html = (el: React.ReactElement) => renderToStaticMarkup(el);

describe('BubbleButton', () => {
  it('is a link that opens a web page in a new tab, and dials a tel: link', () => {
    const web = html(
      <BubbleButtonList>
        <BubbleButton href="https://example.com" label="Visit" linkTestId="l" />
      </BubbleButtonList>,
    );
    expect(web).toContain('href="https://example.com"');
    expect(web).toContain('target="_blank"');
    expect(web).toContain('rel="noopener noreferrer"');
    const call = html(
      <BubbleButtonList>
        <BubbleButton href="tel:+919560644394" label="Call" linkTestId="l" />
      </BubbleButtonList>,
    );
    expect(call).toContain('href="tel:+919560644394"');
    expect(call).not.toContain('target=');
  });

  it('draws a row with no link when it has no target, in the link blue only when it is an action', () => {
    const plain = html(<BubbleButton href={null} label="+91 95606" tone="plain" />);
    expect(plain).not.toContain('href=');
    expect(plain).not.toContain('text-[#027eb5]');
    const action = html(<BubbleButton href={null} label="Quick reply" />);
    expect(action).toContain('text-[#027eb5]');
    expect(action).toContain('border-t');
  });

  it('spans the bubble edge with a hairline above each row', () => {
    const out = html(
      <BubbleButtonList>
        <BubbleButton href={null} label="A" />
      </BubbleButtonList>,
    );
    expect(out).toContain('-mx-3');
  });
});
