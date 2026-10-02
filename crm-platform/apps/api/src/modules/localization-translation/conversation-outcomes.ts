/** What to store on the message and the conversation. Nothing here writes: the inbox domain owns those rows. */
export interface InboundOutcome {
  detectedLanguage: string | null;
  /** The team-language reading, only when the message is in another language. */
  translatedBody: string | null;
  isTranslated: boolean;
  /** Set only when the conversation had no language yet; later messages never move it. */
  pinLanguage: string | null;
}

export interface OutboundOutcome {
  /** What to deliver. */
  body: string;
  /** The agent's original, kept for the thread view; set only when the text was translated. */
  original: string | null;
  /** The language delivered, set only when translated. */
  language: string | null;
  isTranslated: boolean;
}
