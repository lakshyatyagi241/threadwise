import {
  PRIVACY_ERASE_PHRASE,
  type PrivacyDisposition,
  type PrivacyErasureLine,
  type PrivacyProof,
  type PrivacyRequest,
} from '@crm/contracts';

/** The text the person executing an erasure types: `ERASE <reference>`. */
export const erasePhrase = (reference: string) => `${PRIVACY_ERASE_PHRASE} ${reference}`;

/** The typed confirmation matches the phrase exactly (leading and trailing spaces ignored, case kept). */
export const phraseMatches = (typed: string, reference: string) =>
  typed.trim() === erasePhrase(reference);

export type StatusTone = 'neutral' | 'success' | 'warning' | 'danger';

export function statusTone(status: PrivacyRequest['status']): StatusTone {
  switch (status) {
    case 'completed':
      return 'success';
    case 'rejected':
    case 'expired':
      return 'danger';
    case 'verifying':
    case 'in_progress':
      return 'warning';
    default:
      return 'neutral';
  }
}

/** Open requests are the ones with a clock. */
export const isOpen = (r: Pick<PrivacyRequest, 'status'>) =>
  r.status === 'received' || r.status === 'verifying' || r.status === 'in_progress';

export interface LineGroup {
  holder: string;
  lines: PrivacyErasureLine[];
}

/** The lines of a dry run or proof grouped by module (holder), keeping the server's order. */
export function groupLines(lines: readonly PrivacyErasureLine[]): LineGroup[] {
  const out: LineGroup[] = [];
  for (const l of lines) {
    const g = out.find((x) => x.holder === l.holder);
    if (g) g.lines.push(l);
    else out.push({ holder: l.holder, lines: [l] });
  }
  return out;
}

/** Rows per disposition across all lines. */
export function countByDisposition(
  lines: readonly PrivacyErasureLine[],
): Record<PrivacyDisposition, number> {
  const out: Record<PrivacyDisposition, number> = {
    deleted: 0,
    anonymised: 0,
    cascaded: 0,
    retained: 0,
    unlinked: 0,
  };
  for (const l of lines) out[l.disposition] += l.count;
  return out;
}

/** The proof as the JSON file the person downloads (built in the browser, nothing is uploaded). */
export function proofFile(proof: PrivacyProof): { name: string; json: string } {
  return {
    name: `${proof.requestReference}-erasure-proof.json`,
    json: JSON.stringify(proof, null, 2),
  };
}

/** Saves text as a file from the browser. */
export function downloadText(name: string, text: string, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** What a typed value looks like, to choose the identifier kind for someone who is not in the contacts. */
export function identifierKind(value: string): 'email' | 'phone' {
  return value.includes('@') ? 'email' : 'phone';
}
