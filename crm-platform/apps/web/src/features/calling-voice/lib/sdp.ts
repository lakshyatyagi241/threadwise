import { CALL_SDP_MIN_LENGTH } from '@crm/contracts';

/**
 * SDP helpers for the WhatsApp call peer (WD-CALL-009 rules 2, 3 and 5). Pure: no browser objects, so they are unit tested.
 * Meta's SDP is non-standard, so these quirks are Meta-specific and are kept as they are.
 */

/** Both ends of a call must hold an SDP at least this long (client and server). */
export const SDP_MIN_LENGTH = CALL_SDP_MIN_LENGTH;

export function isUsableSdp(sdp: string | null | undefined): sdp is string {
  return typeof sdp === 'string' && sdp.length >= SDP_MIN_LENGTH;
}

/** Chrome wants CRLF on every line and a trailing CRLF; Meta sends bare LF. */
export function foldToCrlf(sdp: string): string {
  const folded = sdp.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n/g, '\r\n');
  return folded.endsWith('\r\n') ? folded : `${folded}\r\n`;
}

/**
 * An answer must commit to a DTLS role: Meta's `a=setup:actpass` is rewritten to `a=setup:active`, otherwise the call shows
 * connected with no audio. A concrete active/passive from Meta is left alone.
 */
export function forceSetupActive(sdp: string): string {
  return sdp.replace(/^a=setup:actpass[ \t]*(?=\r?$)/gim, 'a=setup:active');
}

/** What goes into `setRemoteDescription`: folded, and for the ANSWER applied on an outbound call, with the DTLS role pinned. */
export function normalizeRemoteSdp(sdp: string, kind: 'offer' | 'answer'): string {
  const lf = sdp.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  return foldToCrlf(kind === 'answer' ? forceSetupActive(lf) : lf);
}

/** The codecs Meta accepts: Opus and telephone-event (DTMF). Its validator rejects the browser's default multi-codec offer. */
export function isMetaCodec(mimeType: string): boolean {
  return /audio\/opus/i.test(mimeType) || /telephone-event/i.test(mimeType);
}

export function keepOpusCodecs<T extends { mimeType: string }>(codecs: readonly T[]): T[] {
  return codecs.filter((c) => isMetaCodec(c.mimeType));
}
