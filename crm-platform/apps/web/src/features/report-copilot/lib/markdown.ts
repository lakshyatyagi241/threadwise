/**
 * A deliberately small markdown reader for the text the model writes into a report section. It understands paragraphs, headings,
 * `-` and `1.` lists, `>` quotes, fenced code, **bold**, *italic*, `code` and [links](https://...). It produces plain data, never
 * markup: the components turn that data into React elements, so model text can only ever become text nodes. Raw HTML in the source
 * stays literal text, and a link is kept only when its address is http(s) or mailto.
 */

export type Inline =
  { t: 'text' | 'bold' | 'italic' | 'code'; v: string } | { t: 'link'; v: string; href: string };

export type Block =
  | { t: 'p'; inline: Inline[] }
  | { t: 'h'; level: 4 | 5 | 6; inline: Inline[] }
  | { t: 'ul' | 'ol'; items: Inline[][] }
  | { t: 'quote'; inline: Inline[] }
  | { t: 'code'; v: string };

/** Only addresses a reader can safely follow: no `javascript:`, `data:` or relative paths from model text. */
export function safeHref(raw: string): string | null {
  const href = raw.trim();
  if (!/^(https?:\/\/|mailto:)/i.test(href)) return null;
  try {
    const u = new URL(href);
    return u.protocol === 'http:' || u.protocol === 'https:' || u.protocol === 'mailto:'
      ? u.href
      : null;
  } catch {
    return null;
  }
}

const INLINE =
  /\*\*([^*\n]+)\*\*|`([^`\n]+)`|\[([^\]\n]+)\]\(([^)\s]+)\)|\*([^*\n]+)\*|(?<![\w])_([^_\n]+)_(?![\w])/g;

export function parseInline(src: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  const push = (v: string) => {
    if (v) out.push({ t: 'text', v });
  };
  for (const m of src.matchAll(INLINE)) {
    push(src.slice(last, m.index));
    if (m[1] !== undefined) out.push({ t: 'bold', v: m[1] });
    else if (m[2] !== undefined) out.push({ t: 'code', v: m[2] });
    else if (m[3] !== undefined) {
      const href = safeHref(m[4] ?? '');
      if (href) out.push({ t: 'link', v: m[3], href });
      else push(m[0]);
    } else out.push({ t: 'italic', v: (m[5] ?? m[6]) as string });
    last = (m.index ?? 0) + m[0].length;
  }
  push(src.slice(last));
  return out;
}

const HEADING = /^(#{1,6})\s+(.*\S)\s*$/;
const BULLET = /^\s*[-*+]\s+(.*)$/;
const ORDERED = /^\s*\d{1,3}[.)]\s+(.*)$/;
const QUOTE = /^\s*>\s?(.*)$/;
const FENCE = /^\s*```/;

export function parseMarkdown(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) blocks.push({ t: 'p', inline: parseInline(para.join(' ')) });
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (FENCE.test(line)) {
      flush();
      const body: string[] = [];
      i++;
      while (i < lines.length && !FENCE.test(lines[i] ?? '')) body.push(lines[i++] ?? '');
      blocks.push({ t: 'code', v: body.join('\n') });
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    const h = HEADING.exec(line);
    if (h) {
      flush();
      // A section already has its heading from the report, so body headings start one level below it.
      const level = Math.min(6, Math.max(4, (h[1] as string).length + 2)) as 4 | 5 | 6;
      blocks.push({ t: 'h', level, inline: parseInline(h[2] as string) });
      continue;
    }
    const kind = BULLET.test(line) ? 'ul' : ORDERED.test(line) ? 'ol' : null;
    if (kind) {
      flush();
      const re = kind === 'ul' ? BULLET : ORDERED;
      const items: Inline[][] = [];
      while (i < lines.length && re.test(lines[i] ?? '')) {
        items.push(parseInline((re.exec(lines[i] ?? '') as RegExpExecArray)[1] as string));
        i++;
      }
      i--;
      blocks.push({ t: kind, items });
      continue;
    }
    const q = QUOTE.exec(line);
    if (q) {
      flush();
      const text: string[] = [];
      while (i < lines.length && QUOTE.test(lines[i] ?? '')) {
        text.push((QUOTE.exec(lines[i] ?? '') as RegExpExecArray)[1] as string);
        i++;
      }
      i--;
      blocks.push({ t: 'quote', inline: parseInline(text.join(' ')) });
      continue;
    }
    para.push(line.trim());
  }
  flush();
  return blocks;
}
