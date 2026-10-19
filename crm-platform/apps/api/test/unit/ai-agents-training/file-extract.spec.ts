import { describe, expect, it } from 'vitest';
import {
  docxToText,
  extractFileText,
  readZipEntry,
} from '../../../src/modules/ai-agents-training/file-extract';
import { decodeEntities } from '../../../src/modules/ai-agents-training/training-rules';
import { makeDocx, makePdf, makeZip } from './fixtures';

const code = async (p: Promise<unknown>) =>
  p.then(
    () => 'no error',
    (e: { code?: string }) => e.code,
  );

describe('file extraction (TW-AIAG-008)', () => {
  it('reads plain text types verbatim', async () => {
    expect(await extractFileText(Buffer.from('# Title\n\nbody, with, commas'), 'md')).toBe(
      '# Title\n\nbody, with, commas',
    );
    expect(await extractFileText(Buffer.from('a,b\n1,2'), 'csv')).toBe('a,b\n1,2');
  });

  it('a file that is binary under a text name is unreadable, not "knowledge"', async () => {
    expect(await code(extractFileText(Buffer.from([0x89, 0x50, 0x00, 0x01]), 'txt'))).toBe(
      'AIAG_FILE_UNREADABLE',
    );
  });

  it('HTML loses its scripts and styles', async () => {
    const text = await extractFileText(
      Buffer.from('<style>x{}</style><script>alert(1)</script><p>Hello &amp; welcome</p>'),
      'html',
    );
    expect(text).toBe('Hello & welcome');
  });

  it('DOCX: paragraphs become lines and entities are decoded', async () => {
    const text = await extractFileText(makeDocx(['First & foremost', 'Second <line>']), 'docx');
    expect(text).toBe('First & foremost\nSecond <line>');
  });

  it('DOCX stored (not deflated) entries are read too', async () => {
    const zip = makeZip([
      { name: 'word/document.xml', data: Buffer.from('<w:p>x</w:p>'), store: true },
    ]);
    expect((await readZipEntry(zip, 'word/document.xml'))?.toString()).toBe('<w:p>x</w:p>');
  });

  it('cleaning the XML in slices gives exactly what cleaning it whole gives (EL-B21)', async () => {
    // The original chain, whole-string, as the reference.
    const whole = (xml: string) =>
      decodeEntities(
        xml
          .replace(/<\/w:p>/g, '\n')
          .replace(/<w:tab\b[^>]*\/?>/g, '\t')
          .replace(/<w:br\b[^>]*\/?>/g, '\n')
          .replace(/<[^>]*>/g, ''),
      )
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    let seed = 7;
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    const pieces = [
      '<w:p><w:r><w:t>word</w:t></w:r></w:p>',
      '<w:p></w:p>',
      '<w:p><w:r><w:br/></w:r><w:r><w:br w:type="page"/></w:r></w:p>',
      '<w:p><w:r><w:tab/><w:t>a &amp; b &lt;c&gt; &#233; &#x1F600; &bogus;</w:t></w:r></w:p>',
      '<w:r><w:t>no paragraph end</w:t></w:r>',
      '<w:p><w:pPr><w:pStyle w:val="x"/></w:pPr><w:r><w:t xml:space="preserve">  spaced  </w:t></w:r></w:p>',
      '<w:p><w:r><w:t>&#10;&#10;&#10;newline entities</w:t></w:r></w:p>',
    ];
    for (let trial = 0; trial < 40; trial++) {
      const xml = `<w:document><w:body>${Array.from({ length: 30 + Math.floor(rnd() * 200) }, () => pieces[Math.floor(rnd() * pieces.length)]).join('')}</w:body></w:document>`;
      const zip = makeZip([{ name: 'word/document.xml', data: Buffer.from(xml) }]);
      for (const slice of [1, 17, 64, 400, 5_000, 10 ** 9]) {
        expect(await docxToText(zip, slice), `trial ${trial}, slice ${slice}`).toBe(whole(xml));
      }
    }
  });

  it('lets the event loop run while it cleans a large document', async () => {
    const xml = `<w:document>${'<w:p><w:r><w:t>some text here</w:t></w:r></w:p>'.repeat(60_000)}</w:document>`;
    const zip = makeZip([{ name: 'word/document.xml', data: Buffer.from(xml) }]);
    let ticks = 0;
    const timer = setInterval(() => {
      ticks += 1;
    }, 1);
    const text = await docxToText(zip, 32 * 1024);
    clearInterval(timer);
    expect(text.split('\n')).toHaveLength(60_000);
    expect(ticks).toBeGreaterThan(0);
  });

  it('a .docx that is not a zip, or has no body, is unreadable or empty', async () => {
    expect(await code(extractFileText(Buffer.from('not a zip at all, just words'), 'docx'))).toBe(
      'AIAG_FILE_UNREADABLE',
    );
    const noBody = makeZip([{ name: 'other.xml', data: Buffer.from('x') }]);
    expect(await extractFileText(noBody, 'docx')).toBe('');
  });

  it('a zip bomb (a part that inflates past the cap) is refused', async () => {
    const huge = Buffer.alloc(80 * 1024 * 1024, 0x61);
    // The compressed part is tiny; the claim is made by the deflate stream itself.
    const bomb = makeZip([{ name: 'word/document.xml', data: huge }]);
    expect(bomb.length).toBeLessThan(200_000);
    expect(await code(extractFileText(bomb, 'docx'))).toBe('AIAG_FILE_UNREADABLE');
  });

  it('an encrypted entry is refused', async () => {
    const zip = makeZip([{ name: 'word/document.xml', data: Buffer.from('x') }]);
    // general purpose flag bit 0 in the central directory = encrypted
    const cd = zip.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    zip.writeUInt16LE(1, cd + 8);
    expect(await code(extractFileText(zip, 'docx'))).toBe('AIAG_FILE_UNREADABLE');
  });

  it('PDF: the text layer is extracted', async () => {
    const text = await extractFileText(makePdf('Refunds take five days'), 'pdf');
    expect(text).toContain('Refunds take five days');
  });

  it('a damaged PDF is unreadable', async () => {
    expect(await code(extractFileText(Buffer.from('%PDF-1.4 garbage'), 'pdf'))).toBe(
      'AIAG_FILE_UNREADABLE',
    );
  });
});
