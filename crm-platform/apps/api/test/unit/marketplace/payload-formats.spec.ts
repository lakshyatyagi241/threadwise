import { describe, expect, it } from 'vitest';
import {
  guessFormat,
  parseForm,
  parseXml,
  readDelivery,
  unwrapXmlDocument,
  XmlError,
  type RawDelivery,
} from '../../../src/infra/providers/marketplace';

const delivery = (over: Partial<RawDelivery> & { text?: string }): RawDelivery => ({
  method: 'POST',
  contentType: undefined,
  body: Buffer.from(over.text ?? ''),
  query: '',
  ...over,
});

describe('which format a delivery is', () => {
  it('a GET is always its query string, and is empty without one', () => {
    expect(guessFormat(delivery({ method: 'GET', query: 'name=A&mobile=1' }))).toBe('query');
    expect(guessFormat(delivery({ method: 'GET', query: '' }))).toBe('empty');
  });

  it('follows the Content-Type', () => {
    expect(
      guessFormat(delivery({ contentType: 'application/json; charset=utf-8', text: '{}' })),
    ).toBe('json');
    expect(
      guessFormat(delivery({ contentType: 'application/x-www-form-urlencoded', text: 'a=1' })),
    ).toBe('form');
    expect(guessFormat(delivery({ contentType: 'application/xml', text: '<a/>' }))).toBe('xml');
    expect(guessFormat(delivery({ contentType: 'text/xml; charset=UTF-8', text: '<a/>' }))).toBe(
      'xml',
    );
    expect(guessFormat(delivery({ contentType: 'application/soap+xml', text: '<a/>' }))).toBe(
      'xml',
    );
  });

  it('never reads multipart', () => {
    expect(
      guessFormat(delivery({ contentType: 'multipart/form-data; boundary=x', text: '--x' })),
    ).toBe('multipart');
  });

  it('reads a sender with a wrong or missing Content-Type by the first character of the body', () => {
    expect(guessFormat(delivery({ contentType: 'text/plain', text: '  {"a":1}' }))).toBe('json');
    expect(guessFormat(delivery({ text: '[{"a":1}]' }))).toBe('json');
    expect(guessFormat(delivery({ text: '\uFEFF<?xml version="1.0"?><a/>' }))).toBe('xml');
    expect(guessFormat(delivery({ text: 'name=A&mobile=1' }))).toBe('form');
  });

  it('a POST with nothing in the body but a query string is that query string; with nothing at all it is empty', () => {
    expect(guessFormat(delivery({ query: 'a=1' }))).toBe('query');
    expect(guessFormat(delivery({}))).toBe('empty');
  });
});

describe('forms and query strings', () => {
  it('reads plain pairs, decoding plus and percent escapes', () => {
    expect(parseForm('name=Asha+Verma&city=M%C3%BCnchen&empty=')).toEqual({
      name: 'Asha Verma',
      city: 'München',
      empty: '',
    });
    expect(parseForm('?a=1')).toEqual({ a: '1' });
  });

  it('reads nested keys and lists (lead[phone], items[], items[2], a[b][c])', () => {
    expect(parseForm('lead[name]=A&lead[phone]=1&tags[]=x&tags[]=y&a[b][c]=2')).toEqual({
      lead: { name: 'A', phone: '1' },
      tags: ['x', 'y'],
      a: { b: { c: '2' } },
    });
    expect(parseForm('items[0][id]=7&items[0][qty]=2&items[1][id]=8')).toEqual({
      items: [{ id: '7', qty: '2' }, { id: '8' }],
    });
  });

  it('a name sent twice is a list; a key that is not a name is kept flat', () => {
    expect(parseForm('a=1&a=2&a=3')).toEqual({ a: ['1', '2', '3'] });
    expect(parseForm('weird[=1')).toEqual({ 'weird[': '1' });
  });

  it('never builds on the prototype chain, and ignores what it cannot decode', () => {
    const out = parseForm(
      '__proto__[polluted]=1&constructor[prototype][x]=1&a=%E0%A4%A&b=2',
    ) as Record<string, unknown>;
    expect(out).toEqual({ b: '2' });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(parseForm('toString=1&toString=2')).toEqual({ toString: ['1', '2'] });
  });

  it('is bounded: too many pairs are dropped, an overlong value is cut, an empty form is nothing', () => {
    const many = Array.from({ length: 500 }, (_v, i) => `k${i}=1`).join('&');
    expect(Object.keys(parseForm(many)!)).toHaveLength(200);
    expect((parseForm(`a=${'x'.repeat(50_000)}`)!.a as string).length).toBe(10_000);
    expect(parseForm('')).toBeNull();
    expect(parseForm('&&')).toBeNull();
  });
});

describe('XML', () => {
  it('turns a document into plain values: text, attributes, children, repeats', () => {
    const doc = parseXml(
      '<?xml version="1.0" encoding="UTF-8"?>\n<!-- a lead -->\n<lead id="L-1"><name>Asha</name><mobile> 98765 43210 </mobile><tag>a</tag><tag>b</tag><empty/></lead>',
    );
    expect(doc).toEqual({
      lead: { id: 'L-1', name: 'Asha', mobile: '98765 43210', tag: ['a', 'b'], empty: '' },
    });
  });

  it('reads CDATA, the five predefined entities and numeric references, and leaves any other entity as text', () => {
    expect(
      parseXml(
        '<m><a><![CDATA[1 < 2 & more]]></a><b>Tom &amp; Jerry &lt;3 &#65;&#x42;</b><c>&nbsp;&custom;</c></m>',
      ),
    ).toEqual({
      m: { a: '1 < 2 & more', b: 'Tom & Jerry <3 AB', c: '&nbsp;&custom;' },
    });
  });

  it('drops namespace prefixes and xmlns attributes; mixed text is _text', () => {
    expect(parseXml('<ns:lead xmlns:ns="urn:x" ns:id="9"><ns:name>A</ns:name></ns:lead>')).toEqual({
      lead: { id: '9', name: 'A' },
    });
    expect(parseXml('<p kind="x">hello <b>bold</b></p>')).toEqual({
      p: { kind: 'x', b: 'bold', _text: 'hello' },
    });
  });

  it('refuses a DOCTYPE or any entity declaration, the way in for entity expansion and external entities', () => {
    const bomb =
      '<?xml version="1.0"?><!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;&lol;&lol;">]><lolz>&lol2;</lolz>';
    expect(() => parseXml(bomb)).toThrow(XmlError);
    expect(() => parseXml('<!DOCTYPE a SYSTEM "http://169.254.169.254/x"><a/>')).toThrow(
      /doctype_refused/,
    );
    expect(() => parseXml('<!ENTITY x "y"><a/>')).toThrow(/doctype_refused/);
    // The predefined entity is plain text, never a lookup.
    expect(parseXml('<a>&xxe;</a>')).toEqual({ a: '&xxe;' });
  });

  it('refuses what is not a well-formed document', () => {
    for (const bad of [
      '',
      'just text',
      '<a><b></a></b>',
      '<a>',
      '<a></a><b></b>',
      '<a b=c></a>',
      '<a><!-- never closed </a>',
      '<1bad/>',
      '<a><![CDATA[never closed</a>',
      '</a>',
    ]) {
      expect(() => parseXml(bad), bad).toThrow(XmlError);
    }
  });

  it('is bounded in depth and in size', () => {
    const deep = `${'<a>'.repeat(40)}x${'</a>'.repeat(40)}`;
    expect(() => parseXml(deep)).toThrow(/too_deep/);
    const wide = `<r>${'<i>1</i>'.repeat(6000)}</r>`;
    expect(() => parseXml(wide)).toThrow(/too_many_nodes/);
  });

  it('unwraps a document to the lead, or the list of leads', () => {
    expect(unwrapXmlDocument(parseXml('<lead><name>A</name><mobile>1</mobile></lead>'))).toEqual({
      name: 'A',
      mobile: '1',
    });
    expect(
      unwrapXmlDocument(
        parseXml('<leads><lead><name>A</name></lead><lead><name>B</name></lead></leads>'),
      ),
    ).toEqual([{ name: 'A' }, { name: 'B' }]);
    expect(unwrapXmlDocument(parseXml('<response><lead><name>A</name></lead></response>'))).toEqual(
      { name: 'A' },
    );
    expect(unwrapXmlDocument(parseXml('<x>text</x>'))).toBe('text');
  });
});

describe('reading a delivery as its format', () => {
  it('json: an object or a list; anything else says why', () => {
    expect(readDelivery('json', delivery({ text: '{"a":1}' }))).toEqual({
      ok: true,
      value: { a: 1 },
    });
    expect(readDelivery('json', delivery({ text: '\uFEFF[{"a":1}]' }))).toEqual({
      ok: true,
      value: [{ a: 1 }],
    });
    expect(readDelivery('json', delivery({ text: '{nope' }))).toEqual({
      ok: false,
      reason: 'invalid_json',
    });
    expect(readDelivery('json', delivery({ text: '"abc"' }))).toEqual({
      ok: false,
      reason: 'not_an_object',
    });
    expect(readDelivery('json', delivery({ text: '  ' }))).toEqual({ ok: false, reason: 'empty' });
  });

  it('form, query and xml', () => {
    expect(readDelivery('form', delivery({ text: 'lead[phone]=1&name=A' }))).toEqual({
      ok: true,
      value: { lead: { phone: '1' }, name: 'A' },
    });
    expect(readDelivery('query', delivery({ method: 'GET', query: 'leadid=5&mobile=98' }))).toEqual(
      {
        ok: true,
        value: { leadid: '5', mobile: '98' },
      },
    );
    expect(readDelivery('query', delivery({ method: 'GET', query: '' }))).toEqual({
      ok: false,
      reason: 'empty',
    });
    expect(readDelivery('xml', delivery({ text: '<lead><name>A</name></lead>' }))).toEqual({
      ok: true,
      value: { name: 'A' },
    });
    expect(readDelivery('xml', delivery({ text: '<!DOCTYPE a><a/>' }))).toEqual({
      ok: false,
      reason: 'invalid_xml:doctype_refused',
    });
  });
});
