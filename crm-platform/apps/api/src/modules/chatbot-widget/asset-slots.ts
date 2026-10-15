/**
 * The pictures a widget can carry, by slot: a WhatsApp button's `logo` and `popup`; a website bot's `logo`, `avatar` and `background`
 * and the callout `popup`; and one picture each for up to five notification cards (`nb0`..`nb4`), menu entries (`qm0`..`qm4`) and
 * banner slides (`bn0`..`bn4`).
 */
export const isAssetSlot = (slot: string): boolean =>
  /^(logo|popup|avatar|background|(nb|qm|bn)[0-4]|bi[0-9a-f]{8})$/.test(slot);

/** The slots only a website chat window has (a WhatsApp button has no window to draw them in). */
export const isWindowSlot = (slot: string): boolean => slot !== 'logo' && slot !== 'popup';
