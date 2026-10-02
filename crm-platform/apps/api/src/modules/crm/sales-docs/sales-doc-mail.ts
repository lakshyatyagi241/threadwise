import { esc, groupMajor } from './sales-doc-render';

/** The mail that carries a share link. Plain layout so it survives every client; wording is original. */
export interface QuoteMail {
  kindLabel: string;
  number: string;
  title: string | null;
  sellerName: string;
  buyerName: string | null;
  currency: string;
  totalMajor: string;
  validUntil: string | null;
  link: string;
  message: string | null;
}

export function composeQuoteMail(m: QuoteMail): { subject: string; text: string; html: string } {
  const what = m.title ? `${m.kindLabel} ${m.number}: ${m.title}` : `${m.kindLabel} ${m.number}`;
  const total = `${m.currency} ${groupMajor(m.totalMajor)}`;
  const greeting = m.buyerName ? `Hello ${m.buyerName},` : 'Hello,';
  const intro = `${m.sellerName} has prepared ${what} for you. The total is ${total}${
    m.validUntil ? ` and the offer is valid until ${m.validUntil}` : ''
  }.`;
  const text = [
    greeting,
    '',
    m.message ?? '',
    m.message ? '' : null,
    intro,
    '',
    `Review it, and accept or decline, here: ${m.link}`,
  ]
    .filter((l): l is string => l !== null)
    .join('\n');
  const html = `<!doctype html><html><body style="margin:0;background:#f1f5f9;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif">
  <div style="max-width:520px;margin:32px auto;background:#fff;border-radius:12px;padding:32px;color:#0f172a">
    <div style="font-weight:700;color:#0f766e;margin-bottom:20px">${esc(m.sellerName)}</div>
    <p>${esc(greeting)}</p>
    ${m.message ? `<p style="white-space:pre-wrap">${esc(m.message)}</p>` : ''}
    <p>${esc(intro)}</p>
    <p style="margin:28px 0"><a href="${esc(m.link)}" style="background:#0f766e;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;display:inline-block;font-weight:600">Review ${esc(m.kindLabel.toLowerCase())}</a></p>
    <p style="color:#64748b;font-size:13px">If the button does not work, paste this address into your browser:<br><span style="word-break:break-all">${esc(m.link)}</span></p>
  </div></body></html>`;
  return { subject: `${what} from ${m.sellerName}`, text, html };
}
